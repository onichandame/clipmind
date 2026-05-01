use reqwest::{
    header::{CONTENT_LENGTH, CONTENT_TYPE},
    Client,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::fs;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tokio::sync::Semaphore;
use tokio_util::codec::{BytesCodec, FramedRead};
use uuid::Uuid;

mod local_file_server;

fn env_tag() -> String {
    format!("[{}/{}]", std::env::consts::OS, std::env::consts::ARCH)
}

// 生成/复用稳定的本机设备 UUID。写入 app_data_dir/device_id，跨重启稳定。
fn ensure_device_id(app: &AppHandle) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位 app data dir: {}", e))?;
    fs::create_dir_all(&data_dir).map_err(|e| format!("创建 app data dir 失败: {}", e))?;
    let id_path = data_dir.join("device_id");
    if let Ok(s) = fs::read_to_string(&id_path) {
        let trimmed = s.trim().to_string();
        if !trimmed.is_empty() {
            return Ok(trimmed);
        }
    }
    let new_id = Uuid::new_v4().to_string();
    fs::write(&id_path, &new_id).map_err(|e| format!("写入 device_id 失败: {}", e))?;
    Ok(new_id)
}

#[tauri::command]
fn get_device_id(app: AppHandle) -> Result<String, String> {
    ensure_device_id(&app)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalFileServerInfoFront {
    base_url: String,
    token: String,
}

// Frontend uses this to build playable http://127.0.0.1:PORT/file?token=...&path=...
// URLs for <video src=...> on Linux WebKitGTK where asset:// is rejected.
#[tauri::command]
fn get_local_file_server_info() -> Result<LocalFileServerInfoFront, String> {
    let info = local_file_server::start()?;
    Ok(LocalFileServerInfoFront {
        base_url: info.base_url,
        token: info.token,
    })
}

// 用户在 AssetDetailModal 主动开启云备份时触发：把本地原片走 video-backup 上传通道。
#[tauri::command]
async fn backup_video_to_cloud(
    asset_id: String,
    local_path: String,
    filename: String,
    server_url: String,
    session_token: String,
) -> Result<(), String> {
    if session_token.trim().is_empty() {
        return Err(format!("{} 缺少登录态，无法备份", env_tag()));
    }
    let client = Client::new();
    upload_file_and_notify(
        &client,
        &server_url,
        &session_token,
        &asset_id,
        "video-backup",
        &local_path,
        &filename,
    )
    .await
}

pub async fn detect_best_video_encoder(app: &tauri::AppHandle) -> String {
    let fallback = "libx264".to_string();

    let cmd = match app.shell().sidecar("ffmpeg") {
        Ok(cmd) => cmd,
        Err(e) => {
            eprintln!("Failed to initialize ffmpeg sidecar: {}", e);
            return fallback;
        }
    };

    let output = match cmd.args(["-encoders"]).output().await {
        Ok(out) => out,
        Err(e) => {
            eprintln!("Failed to execute ffmpeg -encoders: {}", e);
            return fallback;
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);

    let priorities = if cfg!(target_os = "macos") {
        vec!["hevc_videotoolbox", "h264_videotoolbox"]
    } else {
        vec![
            "hevc_nvenc",
            "h264_nvenc",
            "hevc_amf",
            "h264_amf",
            "h264_qsv",
            "h264_vaapi",
        ]
    };

    for encoder in priorities {
        if stdout.contains(encoder) {
            return encoder.to_string();
        }
    }

    fallback
}

#[allow(dead_code)]
struct VideoEncoderState(String);

// --- 核心流转架构：并发隔离与状态 ---
pub struct ProcessingManager {
    pub semaphore: Semaphore,
}

impl ProcessingManager {
    pub fn new() -> Self {
        Self {
            semaphore: Semaphore::new(1),
        }
    }
}

// ============== Server contract structs ==============

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetCreatePayload {
    project_id: String,
    file_hash: String,
    filename: String,
    local_path: String,
    origin_device_id: String,
    file_size: u64,
    duration: Option<i32>,
    asr_status: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetCreateResponse {
    asset_id: String,       // project_assets.id
    media_file_id: String,  // media_files.id
    already_processed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreflightPayload<'a> {
    project_id: &'a str,
    file_hash: &'a str,
    filename: &'a str,
    local_path: &'a str,
    origin_device_id: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreflightResponse {
    dedup_hit: bool,
    asset_id: Option<String>,
    #[allow(dead_code)]
    media_file_id: Option<String>,
    #[allow(dead_code)]
    already_processed: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadTokenRequest<'a> {
    kind: &'a str, // "audio" | "thumbnail" | "video-backup"
    asset_id: &'a str,
    filename: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadTokenResponse {
    upload_url: String,
    /// Server returns this for client-side reference; Rust no longer needs it
    /// (the callback now reads objectKey from the HMAC-verified payload).
    #[allow(dead_code)]
    object_key: String,
    content_type: String,
    callback_token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OssCallbackPayload<'a> {
    /// Server reads userId/assetId/kind/objectKey from the HMAC-verified payload;
    /// the body carries only the opaque token now.
    callback_token: &'a str,
}

// 通用上传 helper：拿 upload-token → PUT 到 OSS → 触发 HMAC-verified callback。
async fn upload_file_and_notify(
    client: &Client,
    server_url: &str,
    session_token: &str,
    asset_id: &str,
    kind: &str,
    file_path: &str,
    filename_for_token: &str,
) -> Result<(), String> {
    let file = tokio::fs::File::open(file_path)
        .await
        .map_err(|e| format!("{} 无法打开 {} ({}): {}", env_tag(), kind, file_path, e))?;
    let size = file
        .metadata()
        .await
        .map_err(|e| format!("{} 读取 {} 元数据失败: {}", env_tag(), kind, e))?
        .len();

    let token_req = UploadTokenRequest {
        kind,
        asset_id,
        filename: filename_for_token,
    };

    let token_res = client
        .post(format!("{}/api/upload-token", server_url))
        .bearer_auth(session_token)
        .json(&token_req)
        .send()
        .await
        .map_err(|e| format!("{} upload-token 请求失败 ({}): {}", env_tag(), kind, e))?;
    if !token_res.status().is_success() {
        let status = token_res.status();
        let err_text = token_res.text().await.unwrap_or_default();
        return Err(format!(
            "{} upload-token 拒绝 ({}): {} {}",
            env_tag(),
            kind,
            status,
            err_text
        ));
    }
    let token_res: UploadTokenResponse = token_res
        .json()
        .await
        .map_err(|e| format!("{} upload-token 响应解析失败 ({}): {}", env_tag(), kind, e))?;

    let stream = FramedRead::new(file, BytesCodec::new());
    let body = reqwest::Body::wrap_stream(stream);
    let put_res = client
        .put(&token_res.upload_url)
        .header(CONTENT_LENGTH, size)
        .header(CONTENT_TYPE, &token_res.content_type)
        .body(body)
        .send()
        .await
        .map_err(|e| format!("{} {} 直传网络错误: {}", env_tag(), kind, e))?;
    if !put_res.status().is_success() {
        let status = put_res.status();
        let err_text = put_res.text().await.unwrap_or_default();
        return Err(format!(
            "{} {} 直传被 OSS 拒绝! 状态码: {}, 错误信息: {}",
            env_tag(),
            kind,
            status,
            err_text
        ));
    }

    let cb_payload = OssCallbackPayload {
        callback_token: &token_res.callback_token,
    };
    let cb_res = client
        .post(format!("{}/api/oss-callback", server_url))
        .bearer_auth(session_token)
        .json(&cb_payload)
        .send()
        .await
        .map_err(|e| format!("{} oss-callback 请求失败 ({}): {}", env_tag(), kind, e))?;
    if !cb_res.status().is_success() {
        let status = cb_res.status();
        let err_text = cb_res.text().await.unwrap_or_default();
        return Err(format!(
            "{} oss-callback 拒绝 ({}): {} {}",
            env_tag(),
            kind,
            status,
            err_text
        ));
    }

    Ok(())
}

// ===================================================================
// Tauri command: process_video_asset (local-first)
//
// Flow:
//   0. SHA-256 哈希（在拿 CPU 信号量之前完成）
//   0.5 POST /api/assets/preflight — 命中即直接挂一条 project_assets 然后返回
//   1. FFmpeg 抽取音频 + 缩略图（视频原片不动）
//   2. POST /api/assets 预登记资产行（携带 localPath / originDeviceId / fileSize / duration）
//   3. 后台并发上传 audio (if any) + thumbnail（仅元数据轨上云，video 留在本地）
// ===================================================================
#[tauri::command]
async fn process_video_asset(
    app: AppHandle,
    state: State<'_, ProcessingManager>,
    job_id: String,
    filename: String,
    local_path: String,
    project_id: String,
    server_url: String,
    session_token: String,
) -> Result<String, String> {
    if session_token.trim().is_empty() {
        return Err(format!("{} 缺少登录态，无法上传", env_tag()));
    }

    // Step 0: Compute SHA-256 of source file (before acquiring CPU semaphore)
    let file_hash = {
        let _ = app.emit("upload-progress", serde_json::json!({ "id": &job_id, "progress": 2 }));
        let mut hasher = Sha256::new();
        let mut file = tokio::fs::File::open(&local_path)
            .await
            .map_err(|e| format!("{} 无法打开源文件计算哈希: {}", env_tag(), e))?;
        let mut buf = vec![0u8; 65536];
        loop {
            use tokio::io::AsyncReadExt;
            let n = file.read(&mut buf).await
                .map_err(|e| format!("{} 读取文件哈希失败: {}", env_tag(), e))?;
            if n == 0 { break; }
            hasher.update(&buf[..n]);
        }
        format!("{:x}", hasher.finalize())
    };

    // Step 0.5: Preflight — short-circuit FFmpeg if the same hash already exists
    // for this user. On hit, the server creates the project_assets row and we
    // return immediately, skipping FFmpeg + audio/thumbnail uploads entirely.
    let device_id = ensure_device_id(&app).map_err(|e| format!("[Job {}] {}", job_id, e))?;
    {
        let preflight_client = Client::new();
        let preflight_payload = PreflightPayload {
            project_id: &project_id,
            file_hash: &file_hash,
            filename: &filename,
            local_path: &local_path,
            origin_device_id: &device_id,
        };
        let preflight_res = preflight_client
            .post(format!("{}/api/assets/preflight", server_url))
            .bearer_auth(&session_token)
            .json(&preflight_payload)
            .send()
            .await
            .map_err(|e| format!("{} preflight 网络错误: {}", env_tag(), e))?;
        if !preflight_res.status().is_success() {
            let status = preflight_res.status();
            let err_text = preflight_res.text().await.unwrap_or_default();
            return Err(format!(
                "{} preflight 被服务器拒绝! 状态码: {}, 错误: {}",
                env_tag(),
                status,
                err_text
            ));
        }
        let preflight_resp: PreflightResponse = preflight_res
            .json()
            .await
            .map_err(|e| format!("{} preflight 响应解析失败: {}", env_tag(), e))?;
        if preflight_resp.dedup_hit {
            let asset_id = preflight_resp.asset_id.ok_or_else(||
                format!("{} preflight 命中但缺少 assetId", env_tag()))?;
            let _ = app.emit(
                "upload-progress",
                serde_json::json!({ "id": &job_id, "progress": 100 }),
            );
            println!("[Job {}] preflight 命中，跳过 FFmpeg 与上传。asset_id={}", job_id, asset_id);
            return Ok(asset_id);
        }
    }

    println!("[Job {}] 准备排队获取 Semaphore 锁...", job_id);
    let _permit = state.semaphore.acquire().await.unwrap();
    println!("[Job {}] 🟢 独占 CPU 开始执行预处理...", job_id);

    let tmp_dir = std::env::temp_dir();
    let temp_audio = tmp_dir
        .join(format!("clipmind_{}.aac", job_id))
        .to_string_lossy()
        .into_owned();
    let temp_thumb = tmp_dir
        .join(format!("clipmind_{}_thumb.jpg", job_id))
        .to_string_lossy()
        .into_owned();

    let app_clone = app.clone();
    let app_ffmpeg = app.clone();
    let local_path_clone = local_path.clone();

    // --- Pass 1: 音频抽取 + 时长 + 音频流探测 ---
    let (mut rx_audio, _child_audio) = app_ffmpeg
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("{} 无法初始化 FFmpeg Sidecar (audio): {}", env_tag(), e))?
        .args([
            "-i",
            &local_path_clone,
            "-vn",
            "-c:a",
            "aac",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-b:a",
            "32k",
            &temp_audio,
            "-y",
        ])
        .spawn()
        .map_err(|e| format!("{} FFmpeg audio spawn failed: {}", env_tag(), e))?;

    let mut last_emit = Instant::now();
    let mut extracted_duration = 0.0;
    let mut audio_exit_code: Option<i32> = None;
    let mut source_has_audio_stream = false;
    const STDERR_TAIL_CAP: usize = 40;
    let mut stderr_tail: VecDeque<String> = VecDeque::with_capacity(STDERR_TAIL_CAP);

    while let Some(event) = rx_audio.recv().await {
        match event {
            CommandEvent::Stderr(line_bytes) => {
                let line = String::from_utf8_lossy(&line_bytes);

                if line.contains("Duration: ") {
                    if let Some(d_str) = line
                        .split("Duration: ")
                        .nth(1)
                        .and_then(|s| s.split(',').next())
                    {
                        let parts: Vec<&str> = d_str.trim().split(':').collect();
                        if parts.len() == 3 {
                            let h: f64 = parts[0].parse().unwrap_or(0.0);
                            let m: f64 = parts[1].parse().unwrap_or(0.0);
                            let s: f64 = parts[2].parse().unwrap_or(0.0);
                            extracted_duration = h * 3600.0 + m * 60.0 + s;
                        }
                    }
                }

                if line.contains("Stream") && line.contains("Audio:") {
                    source_has_audio_stream = true;
                }

                if stderr_tail.len() == STDERR_TAIL_CAP {
                    stderr_tail.pop_front();
                }
                stderr_tail.push_back(line.trim_end().to_string());

                if last_emit.elapsed() > Duration::from_millis(500) {
                    let _ = app_ffmpeg.emit(
                        "ffmpeg-progress",
                        serde_json::json!({ "log": line.to_string() }),
                    );
                    last_emit = Instant::now();
                }
            }
            CommandEvent::Terminated(payload) => {
                audio_exit_code = payload.code;
                println!("[Probe-FFmpeg] Audio exit code: {:?}", audio_exit_code);
            }
            _ => {}
        }
    }

    if audio_exit_code != Some(0) {
        if source_has_audio_stream {
            let tail = stderr_tail.iter().cloned().collect::<Vec<_>>().join("\n");
            return Err(format!(
                "{} FFmpeg 音频抽取退出码非0: {:?}，音视频分离失败\n--- FFmpeg stderr (tail) ---\n{}",
                env_tag(),
                audio_exit_code,
                tail
            ));
        }
        println!(
            "[Probe-FFmpeg] 源文件无音频流，退出码 {:?} 为预期行为，跳过音频抽取",
            audio_exit_code
        );
    }

    // --- Pass 2: 缩略图截帧 ---
    let (mut rx_thumb, _child_thumb) = app_ffmpeg
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("{} 无法初始化 FFmpeg Sidecar (thumb): {}", env_tag(), e))?
        .args([
            "-ss",
            "00:00:00.500",
            "-i",
            &local_path_clone,
            "-vframes",
            "1",
            "-q:v",
            "2",
            &temp_thumb,
            "-y",
        ])
        .spawn()
        .map_err(|e| format!("{} FFmpeg thumb spawn failed: {}", env_tag(), e))?;

    let mut thumb_exit_code: Option<i32> = None;
    while let Some(event) = rx_thumb.recv().await {
        if let CommandEvent::Terminated(payload) = event {
            thumb_exit_code = payload.code;
            println!("[Probe-FFmpeg] Thumb exit code: {:?}", thumb_exit_code);
        }
    }
    if thumb_exit_code != Some(0) {
        println!(
            "[Probe-FFmpeg] ⚠️ 缩略图截帧失败（退出码 {:?}），继续上传流程",
            thumb_exit_code
        );
    }

    println!(
        "[Job {}] FFmpeg 双轨分离完毕，准备进入直传队列...",
        job_id
    );
    drop(_permit);

    // ===== 预登记资产行（preflight 已确认是新文件，这里只是创建 media_files + project_assets）=====
    let video_size = tokio::fs::metadata(&local_path)
        .await
        .map_err(|e| format!("{} 读取原始视频元数据失败: {}", env_tag(), e))?
        .len();

    let has_audio = matches!(
        tokio::fs::metadata(&temp_audio).await,
        Ok(m) if m.len() > 0
    );
    let asr_status_hint = if has_audio { "pending" } else { "skipped" }.to_string();

    let create_client = Client::new();
    let create_payload = AssetCreatePayload {
        project_id: project_id.clone(),
        file_hash: file_hash.clone(),
        filename: filename.clone(),
        local_path: local_path.clone(),
        origin_device_id: device_id.clone(),
        file_size: video_size,
        duration: Some(extracted_duration as i32),
        asr_status: Some(asr_status_hint),
    };
    let create_res = create_client
        .post(format!("{}/api/assets", server_url))
        .bearer_auth(&session_token)
        .json(&create_payload)
        .send()
        .await
        .map_err(|e| format!("{} 资产预登记网络错误: {}", env_tag(), e))?;
    if !create_res.status().is_success() {
        let status = create_res.status();
        let err_text = create_res.text().await.unwrap_or_default();
        return Err(format!(
            "{} 资产预登记被服务器拒绝! 状态码: {}, 错误: {}",
            env_tag(),
            status,
            err_text
        ));
    }
    let create_resp: AssetCreateResponse = create_res
        .json()
        .await
        .map_err(|e| format!("{} 资产预登记响应解析失败: {}", env_tag(), e))?;

    // Race fallback: preflight missed, but a concurrent upload of the same hash
    // won the ER_DUP_ENTRY race and finished processing before we got here.
    // Skip our redundant audio/thumbnail upload.
    if create_resp.already_processed {
        let _ = app_clone.emit(
            "upload-progress",
            serde_json::json!({ "id": &job_id, "progress": 100 }),
        );
        let _ = fs::remove_file(&temp_audio);
        let _ = fs::remove_file(&temp_thumb);
        println!("[Job {}] 并发去重命中，跳过上传。asset_id={}", job_id, create_resp.asset_id);
        return Ok(create_resp.asset_id);
    }

    // 立即让前端从"压缩中"翻到"上传中"
    let _ = app_clone.emit(
        "upload-progress",
        serde_json::json!({ "id": &job_id, "progress": 10 }),
    );

    let project_asset_id_for_return = create_resp.asset_id.clone();
    let media_file_id_for_spawn = create_resp.media_file_id.clone();
    let job_id_clone = job_id.clone();
    let temp_audio_clone = temp_audio.clone();
    let temp_thumb_clone = temp_thumb.clone();
    let server_url_clone = server_url.clone();
    let session_token_clone = session_token.clone();
    let has_audio_for_spawn = has_audio;

    // 后台并发上传 audio + thumbnail（视频原片留本地，无需上传）
    tokio::spawn(async move {
        let client = Client::new();
        let job_id_for_err = job_id_clone.clone();

        let async_flow: Result<(), String> = async {
            let has_audio = has_audio_for_spawn;
            let has_thumb = matches!(
                tokio::fs::metadata(&temp_thumb_clone).await,
                Ok(m) if m.len() > 0
            );

            if has_thumb {
                upload_file_and_notify(
                    &client,
                    &server_url_clone,
                    &session_token_clone,
                    &media_file_id_for_spawn,
                    "thumbnail",
                    &temp_thumb_clone,
                    "thumb.jpg",
                )
                .await?;
                let _ = app_clone.emit(
                    "upload-progress",
                    serde_json::json!({ "id": &job_id_clone, "progress": 50 }),
                );
                println!("[Probe-Upload] 缩略图上传成功");
            } else {
                println!("[Probe-Upload] 无缩略图，跳过");
            }

            if has_audio {
                upload_file_and_notify(
                    &client,
                    &server_url_clone,
                    &session_token_clone,
                    &media_file_id_for_spawn,
                    "audio",
                    &temp_audio_clone,
                    "audio.aac",
                )
                .await?;
                println!("[Probe-Upload] 音频轨道上传成功");
            } else {
                println!("[Probe-Upload] 源文件无音频流，跳过音频上传");
            }

            let _ = app_clone.emit(
                "upload-progress",
                serde_json::json!({ "id": &job_id_clone, "progress": 100 }),
            );
            Ok(())
        }
        .await;

        if let Err(err) = async_flow {
            eprintln!("[Probe-Error] Cloud upload pipeline failed: {}", err);
            let _ = app_clone.emit(
                "upload-error",
                serde_json::json!({ "id": job_id_for_err, "message": err }),
            );
        } else {
            println!("[Probe-Upload] 整个上传任务成功结束。");
        }

        // 清理临时音频/缩略图（视频原片留在用户目录）
        let _ = fs::remove_file(&temp_audio_clone);
        let _ = fs::remove_file(&temp_thumb_clone);
    });

    Ok(project_asset_id_for_return)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            process_video_asset,
            get_device_id,
            backup_video_to_cloud,
            get_local_file_server_info,
        ])
        .setup(|app| {
            // 启动即探测：将最优编码器与并发管理器挂载至全局
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let encoder = detect_best_video_encoder(&handle).await;
                handle.manage(VideoEncoderState(encoder));
                handle.manage(ProcessingManager::new());
            });

            // Resolve the bundled ffmpeg sidecar path so the local file server
            // can spawn it for on-the-fly transcoding. Tauri places the sidecar
            // next to the app binary in both dev and bundled builds.
            if let Ok(exe) = std::env::current_exe() {
                if let Some(dir) = exe.parent() {
                    // Probe both the un-suffixed name (dev: `target/debug/ffmpeg`)
                    // and the triple-suffixed name (some bundle layouts).
                    let candidates: Vec<std::path::PathBuf> = if cfg!(target_os = "windows") {
                        vec![dir.join("ffmpeg.exe"), dir.join("ffmpeg")]
                    } else {
                        vec![
                            dir.join("ffmpeg"),
                            dir.join("ffmpeg-x86_64-unknown-linux-gnu"),
                            dir.join("ffmpeg-aarch64-unknown-linux-gnu"),
                            dir.join("ffmpeg-aarch64-apple-darwin"),
                            dir.join("ffmpeg-x86_64-apple-darwin"),
                        ]
                    };
                    for p in candidates {
                        if p.exists() {
                            eprintln!("[local_file_server] ffmpeg resolved at {:?}", p);
                            local_file_server::set_ffmpeg_path(p);
                            break;
                        }
                    }
                }
            }

            // Eagerly start the localhost file server so the first preview
            // doesn't pay the bind+token cost. Fail-soft: log and continue.
            if let Err(e) = local_file_server::start() {
                eprintln!("[local_file_server] failed to start: {}", e);
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
