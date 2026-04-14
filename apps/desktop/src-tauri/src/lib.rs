use reqwest::{
    header::{CONTENT_LENGTH, CONTENT_TYPE},
    Client,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tokio::io::AsyncReadExt;
use tokio::sync::Semaphore;
use tokio_util::codec::{BytesCodec, FramedRead};

#[tauri::command]
async fn upload_asset(
    app: AppHandle,
    job_id: String,
    path: String,
    url: String,
    content_type: String,
) -> Result<u64, String> {
    // 1. 获取文件大小
    let file_size = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("读取元数据失败: {}", e))?
        .len();

    let app_handle = app.clone();
    let id_for_emit = job_id.clone();
    let stream_path = path.clone(); // FIX: 克隆路径以剥离流媒体与底层清理的生命周期绑定

    // 2. 构造底层的 Stream 并强制注入泛型类型，彻底摧毁编译器的推断黑洞
    let async_stream = async_stream::stream! {
      let mut file = match tokio::fs::File::open(&stream_path).await {
        Ok(f) => f,
        Err(e) => {
          yield Err(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()));
          return;
        }
      };

      let mut buffer = vec![0; 256 * 1024]; // 显式开辟 256KB 缓存块
      let mut uploaded: u64 = 0;
      let mut last_emit = std::time::Instant::now();
      let throttle = std::time::Duration::from_millis(150);

      loop {
        let bytes_read = match file.read(&mut buffer).await {
          Ok(n) => n,
          Err(e) => {
            yield Err(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()));
            return;
          }
        };

        if bytes_read == 0 { break; } // EOF

        uploaded += bytes_read as u64;

        if last_emit.elapsed() >= throttle || uploaded == file_size {
          let progress = ((uploaded as f64 / file_size as f64) * 100.0) as u8;
          let _ = app_handle.emit("upload-progress", serde_json::json!({ "id": &id_for_emit, "progress": progress }));
          last_emit = std::time::Instant::now();
        }

        // 核心修复：明确指明 Yield 的类型是 Result<Bytes, std::io::Error>
        yield Ok::<bytes::Bytes, std::io::Error>(bytes::Bytes::copy_from_slice(&buffer[..bytes_read]));
      }
    };

    // 3. 发起请求
    let res = Client::new()
        .put(&url)
        .header("Content-Type", content_type)
        .header("Content-Length", file_size)
        .body(reqwest::Body::wrap_stream(async_stream))
        .send()
        .await
        .map_err(|e| format!("上传请求失败: {}", e))?;

    if res.status().is_success() {
        // [阶段清理] 直传 OSS 成功后，物理清理本地临时音视频文件
        let _ = tokio::fs::remove_file(&path).await;
        Ok(file_size)
    } else {
        Err(format!("OSS 返回错误: {}", res.status()))
    }
}

#[tauri::command]
async fn process_asset(
    app: AppHandle,
    encoder_state: tauri::State<'_, VideoEncoderState>,
    input: String,
    output_video: String,
    output_audio: String,
) -> Result<f64, String> {
    let encoder = &encoder_state.0;

    let mut args = vec![
        "-y".to_string(), // 强制覆盖已有残留文件
        "-i".to_string(),
        input,
    ];

    // 视频轨道：基于全局状态注入自适应硬件加速或软件兜底
    args.push("-c:v".to_string());
    args.push(encoder.clone());

    // 针对特定硬件加速器注入额外的质量控制参数 (VBR/Preset)
    if encoder.contains("videotoolbox") {
        args.push("-q:v".to_string());
        args.push("50".to_string());
    } else if encoder.contains("nvenc") || encoder.contains("amf") || encoder.contains("qsv") {
        args.push("-preset".to_string());
        args.push("fast".to_string());
    }

    args.extend(vec![
        "-an".to_string(),
        output_video,
        // 音频轨道：强制降维至 16kHz 32kbps 单声道 AAC，专门喂给后端 ASR
        "-vn".to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-ac".to_string(),
        "1".to_string(),
        "-ar".to_string(),
        "16000".to_string(),
        "-b:a".to_string(),
        "32k".to_string(),
        output_audio,
    ]);

    let sidecar_command = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("无法构建 sidecar: {}", e))?
        .args(args);

    let (mut rx, _child) = sidecar_command
        .spawn()
        .map_err(|e| format!("进程启动失败: {}", e))?;

    let mut is_success = false;
    let mut extracted_duration = 0.0;

    // 注入高频防御：IPC 节流阀
    let mut last_emit = std::time::Instant::now();
    let _throttle_duration = std::time::Duration::from_millis(150);

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stderr(line_bytes) => {
                let line = String::from_utf8_lossy(&line_bytes);

                // 正则轻量级替代方案：探测 FFmpeg 输出的 Duration 字段
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

                // 核心修复：阻断 IPC 风暴，防止 V8 引擎 OOM 崩溃
                // 将频率限制延长至 500ms，并使用 JSON 包装确保跨语言序列化安全
                if last_emit.elapsed() >= std::time::Duration::from_millis(500) {
                    println!("[Rust FFmpeg 探针] {}", line); // 满足你查看底层返回的要求
                    let _ = app.emit(
                        "ffmpeg-progress",
                        serde_json::json!({ "log": line.to_string() }),
                    );
                    last_emit = std::time::Instant::now();
                }
            }
            CommandEvent::Terminated(payload) => {
                is_success = payload.code == Some(0);
            }
            CommandEvent::Error(err) => {
                return Err(format!("进程异常中止: {}", err));
            }
            _ => {}
        }
    }

    if is_success {
        Ok(extracted_duration)
    } else {
        Err("FFmpeg 执行失败，请检查 frontend 日志".to_string())
    }
}

#[tauri::command]
async fn notify_webhook(
    filename: String,
    object_key: String,
    file_size: u64,
    duration: f64,
    server_url: String,
) -> Result<(), String> {
    let client = Client::new();
    let payload = serde_json::json!({
      "filename": filename,
      "objectKey": object_key,
      "fileSize": file_size,
      "duration": duration as u64
    });

    let res = client
        .post(format!("{}/api/oss-callback", server_url))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Webhook请求失败: {}", e))?;

    if res.status().is_success() {
        Ok(())
    } else {
        Err(format!("Webhook返回错误状态码: {}", res.status()))
    }
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadTokenResponse {
    asset_id: String,
    video_upload_url: String,
    video_object_key: String,
    audio_upload_url: String,
    audio_object_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReportPayload {
    id: String,
    filename: String,
    duration: i32,
    oss_url: String,
    audio_oss_url: String,
    file_size: u64,
}

#[tauri::command]
async fn process_video_asset(
    app: AppHandle,
    state: State<'_, ProcessingManager>,
    job_id: String,
    local_path: String,
    server_url: String,
) -> Result<(), String> {
    println!("[Job {}] 准备排队获取 Semaphore 锁...", job_id);

    let _permit = state.semaphore.acquire().await.unwrap();
    println!("[Job {}] 🟢 独占 CPU 开始执行预处理...", job_id);

    // 物理隔离：只生成音频临时文件，原视频将直接从原始路径上传
    let temp_audio = format!("temp_{}.aac", job_id);

    let app_clone = app.clone(); // 留给 tokio::spawn 异步上传使用
    let app_ffmpeg = app.clone(); // 专供 FFmpeg 闭包使用
    let local_path_clone = local_path.clone();

    println!("[Probe-FFmpeg] 开始提取音频轨道，源路径: {}", local_path_clone);

    // 核心架构回归：使用 Tauri 官方 Shell 插件异步执行 Sidecar
    let sidecar_command = app_ffmpeg
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("无法初始化 FFmpeg Sidecar: {}", e))?;

    // 调整为纯音频提取模式，原视频不进行任何处理
    let (mut rx, _child) = sidecar_command
        .args([
            "-i", &local_path_clone,
            "-vn",                      // 禁用视频流输出
            "-c:a", "aac",              // 提取音频为 aac
            "-b:a", "128k",             // 阿里云 ASR 推荐码率
            &temp_audio,                // 输出到临时音频文件
            "-y",                       // 强制覆盖
        ])
        .spawn()
        .map_err(|e| format!("FFmpeg Sidecar spawn failed: {}", e))?;

    let mut last_emit = Instant::now();
    // 原生 async 循环，天生防假死，不再需要 spawn_blocking 丑陋的包裹
    while let Some(event) = rx.recv().await {
        if let CommandEvent::Stderr(line_bytes) = event {
            let line = String::from_utf8_lossy(&line_bytes);
            if last_emit.elapsed() > Duration::from_millis(500) {
                let _ = app_ffmpeg.emit("ffmpeg-progress", &line);
                last_emit = Instant::now();
            }
        }
    }

    println!(
        "[Job {}] FFmpeg 极速双轨分离完毕，准备进入直传队列...",
        job_id
    );

    // 约束 4: STT 完成后必须释放并发许可
    drop(_permit);
    println!(
        "[Task {}] 🔴 预处理完成，已释放 Semaphore 锁。进入后台并发直传阶段。",
        job_id
    );

    // 约束 4 & 5: 开启 tokio::spawn 异步上传，不阻塞主流程
    tokio::spawn(async move {
        let client = Client::new();

        let async_flow: Result<(), String> = async {
            let token_payload = serde_json::json!({ "filename": "video.mp4" });
            let token_res = client
                .post(format!("{}/api/upload-token", server_url))
                .json(&token_payload)
                .send()
                .await
                .map_err(|e| e.to_string())?
                .json::<UploadTokenResponse>()
                .await
                .map_err(|e| e.to_string())?;

            // 轨道 1: 视频直传 (直接读取原始物理文件，实现 0 拷贝和 0 损耗)
            let file = tokio::fs::File::open(&local_path_clone)
                .await
                .map_err(|e| format!("无法打开原始视频文件: {}", e))?;

            let file_size = file.metadata().await.map_err(|e| e.to_string())?.len();

            let stream = FramedRead::new(file, BytesCodec::new());
            let body = reqwest::Body::wrap_stream(stream);

            // 动态匹配 Content-Type 以迎合 OSS 签名 (防 403 挂起)
            let mime_type = if local_path_clone.to_lowercase().ends_with(".mov") {
                "video/quicktime"
            } else {
                "video/mp4"
            };

            let _ = app_clone.emit(
                "upload-progress",
                serde_json::json!({ "id": job_id, "progress": 10 }),
            );

            client
                .put(&token_res.video_upload_url)
                .header(CONTENT_LENGTH, file_size)
                .header(CONTENT_TYPE, mime_type)
                .body(body)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            let _ = app_clone.emit(
                "upload-progress",
                serde_json::json!({ "id": job_id, "progress": 90 }),
            );

            let report_payload = ReportPayload {
                id: token_res.asset_id,
                filename: format!("video_{}.mp4", job_id),
                duration: 0,
                oss_url: token_res.video_object_key,
                audio_oss_url: token_res.audio_object_key,
                file_size,
            };

            println!("[Probe-Upload] 准备向 Hono 报告落盘...");
            let report_res = client
                .post(format!("{}/api/assets/report", server_url))
                .json(&report_payload)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            println!(
                "[Probe-Upload] Hono 报告响应状态码: {}",
                report_res.status()
            );

            println!("[Probe-Upload] 发送最终 100% 进度...");
            let _ = app_clone.emit(
                "upload-progress",
                serde_json::json!({ "id": job_id, "progress": 100 }),
            );

            Ok(())
        }
        .await;

        if let Err(err) = async_flow {
            eprintln!("[Probe-Error] Cloud upload pipeline failed: {}", err);
        } else {
            println!("[Probe-Upload] 整个上传任务成功结束。");
        }

        // 终极清理：只清理音频，原始视频文件需保留在用户目录
        let _ = fs::remove_file(&temp_audio);
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init()) // 💡 核心修复：重新注册 Shell 插件
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            process_asset,
            upload_asset,
            notify_webhook,
            process_video_asset
        ])
        .setup(|app| {
            // [架构升级] 启动即探测：将最优编码器挂载至全局内存，实现业务管线零延迟调用
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let encoder = detect_best_video_encoder(&handle).await;
                handle.manage(VideoEncoderState(encoder));

                // 挂载核心流水线并发管理器
                handle.manage(ProcessingManager::new());
            });

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
