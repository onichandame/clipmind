use reqwest::{
    header::{CONTENT_LENGTH, CONTENT_TYPE},
    Client,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::sqlite::SqlitePool;
use std::collections::VecDeque;
use std::fs;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tokio::sync::Semaphore;
use tokio_util::codec::{BytesCodec, FramedRead};
use uuid::Uuid;

mod local_db;
mod local_file_server;

fn env_tag() -> String {
    format!("[{}/{}]", std::env::consts::OS, std::env::consts::ARCH)
}

// Streaming SHA-256 of a file. Reused by import (preflight hash) and relink
// (verifies a user-picked replacement actually matches the known media_file).
async fn compute_sha256(path: &str) -> Result<String, String> {
    use tokio::io::AsyncReadExt;
    let mut hasher = Sha256::new();
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|e| format!("{} 无法打开文件计算哈希 ({}): {}", env_tag(), path, e))?;
    let mut buf = vec![0u8; 65536];
    loop {
        let n = file
            .read(&mut buf)
            .await
            .map_err(|e| format!("{} 读取文件哈希失败 ({}): {}", env_tag(), path, e))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
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
//
// 备份状态机（写入 media_files.backup_status，per-content）：
//   local_only -> uploading (本函数开头 notify_backup_status)
//   uploading  -> backed_up (oss-callback HMAC 路径 -- 唯一可信源)
//   uploading  -> failed    (本函数末尾 notify_backup_status，PUT/callback 失败)
#[tauri::command]
async fn backup_video_to_cloud(
    app: AppHandle,
    media_file_id: String,
    local_path: String,
    filename: String,
    server_url: String,
    session_token: String,
) -> Result<(), String> {
    if session_token.trim().is_empty() {
        return Err(format!("{} 缺少登录态，无法备份", env_tag()));
    }
    let client = Client::new();

    // 1. 先把 uploading 持久化到服务端，让其它会话/设备立刻看到「正在备份」。
    notify_backup_status(&client, &server_url, &session_token, &media_file_id, "uploading").await?;

    // 2. 上传 + 回调（带进度事件）。
    let upload_result = upload_file_and_notify_with_progress(
        &app, &client, &server_url, &session_token,
        &media_file_id, "video-backup", &local_path, &filename,
    ).await;

    // 3. 失败时回写 failed（best-effort，吞错以不掩盖原始错误）。成功时由 oss-callback 写 backed_up。
    if upload_result.is_err() {
        let _ = notify_backup_status(&client, &server_url, &session_token, &media_file_id, "failed").await;
    }
    upload_result
}

async fn notify_backup_status(
    client: &Client,
    server_url: &str,
    session_token: &str,
    media_file_id: &str,
    status: &str,
) -> Result<(), String> {
    let res = client
        .post(format!("{}/api/assets/{}/backup-status", server_url, media_file_id))
        .bearer_auth(session_token)
        .json(&serde_json::json!({ "status": status }))
        .send()
        .await
        .map_err(|e| format!("{} backup-status 网络错误: {}", env_tag(), e))?;
    if !res.status().is_success() {
        let s = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("{} backup-status 拒绝: {} {}", env_tag(), s, body));
    }
    Ok(())
}

// 用户在 AssetDetailModal 主动从云端拉回原片到本机时触发。流式下载 + 边写边算 SHA-256，
// 哈希不匹配则丢弃临时文件；命中后原子重命名 + 写入桌面端 SQLite，让 useLocalAsset 立刻看到。
//
// 目标路径：app_data_dir/{userId}/assets/{mediaFileId}.{ext}
//
// 进度事件：emit("download-progress", { mediaFileId, sent, total })，节流 ≥500ms。
#[tauri::command]
async fn download_asset_to_local(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    media_file_id: String,
    user_id: String,
    download_url: String,
    filename: String,
    expected_sha256: String,
    expected_size: i64,
) -> Result<local_db::LocalAsset, String> {
    use tokio::io::AsyncWriteExt;

    if user_id.trim().is_empty() {
        return Err(format!("{} 缺少登录态，无法下载", env_tag()));
    }

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位 app data dir: {}", e))?;
    let asset_dir = app_data.join(&user_id).join("assets");
    tokio::fs::create_dir_all(&asset_dir)
        .await
        .map_err(|e| format!("创建 assets 目录失败: {}", e))?;

    let ext = filename
        .rsplit('.')
        .next()
        .filter(|s| !s.is_empty() && s.len() <= 8)
        .unwrap_or("mp4");
    let target = asset_dir.join(format!("{}.{}", media_file_id, ext));
    let tmp = asset_dir.join(format!("{}.{}.partial", media_file_id, ext));

    let client = Client::new();
    let mut res = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("{} 下载请求失败: {}", env_tag(), e))?;
    if !res.status().is_success() {
        return Err(format!("{} 下载被拒绝: {}", env_tag(), res.status()));
    }
    let total = res.content_length().unwrap_or(expected_size.max(0) as u64);

    let mut file = tokio::fs::File::create(&tmp)
        .await
        .map_err(|e| format!("无法创建临时文件: {}", e))?;
    let mut hasher = Sha256::new();
    let mut sent: u64 = 0;
    let mut last_emit = Instant::now();

    loop {
        let chunk_opt = res
            .chunk()
            .await
            .map_err(|e| format!("{} 下载流错误: {}", env_tag(), e))?;
        let Some(chunk) = chunk_opt else { break };
        if let Err(e) = file.write_all(&chunk).await {
            // best-effort cleanup on write failure
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(format!("写入文件失败: {}", e));
        }
        hasher.update(&chunk);
        sent += chunk.len() as u64;
        let done = total > 0 && sent >= total;
        if last_emit.elapsed().as_millis() >= 500 || done {
            let _ = app.emit(
                "download-progress",
                serde_json::json!({
                    "mediaFileId": &media_file_id,
                    "sent": sent,
                    "total": total,
                }),
            );
            last_emit = Instant::now();
        }
    }
    if let Err(e) = file.flush().await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(format!("刷新文件失败: {}", e));
    }
    drop(file);

    // 内容校验：服务端给的 sha256 是 media_files.fileHash，下载内容必须严格一致。
    let actual = format!("{:x}", hasher.finalize());
    if actual != expected_sha256 {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(format!(
            "hash_mismatch: 下载内容与服务端不一致 (expected {} got {})",
            expected_sha256, actual
        ));
    }

    let actual_size = tokio::fs::metadata(&tmp)
        .await
        .map_err(|e| format!("读取下载文件大小失败: {}", e))?
        .len();

    // 已存在 target 时直接覆盖（rename 在 Linux/macOS 是 atomic replace；Windows 需 remove）
    #[cfg(windows)]
    {
        let _ = tokio::fs::remove_file(&target).await;
    }
    tokio::fs::rename(&tmp, &target)
        .await
        .map_err(|e| format!("移动文件失败: {}", e))?;

    let target_str = target.to_string_lossy().to_string();
    local_db::upsert(
        pool.inner(),
        &media_file_id,
        &target_str,
        actual_size as i64,
        &expected_sha256,
    )
    .await
    .map_err(|e| format!("写入本地资产记录失败: {}", e))
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
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreflightResponse {
    dedup_hit: bool,
    asset_id: Option<String>,
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
    /// True only for kind=video-backup when another user already has the same
    /// SHA-256 backed up. Server has already flipped this user's media_files
    /// row to backed_up; Rust skips the PUT and the oss-callback entirely.
    #[serde(default)]
    already_uploaded: bool,
    /// Present when already_uploaded == false.
    upload_url: Option<String>,
    /// Server returns this for client-side reference; Rust no longer needs it
    /// (the callback now reads objectKey from the HMAC-verified payload).
    #[allow(dead_code)]
    object_key: String,
    /// Present when already_uploaded == false.
    content_type: Option<String>,
    /// Present when already_uploaded == false.
    callback_token: Option<String>,
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

    // alreadyUploaded only fires for kind=video-backup; audio/thumbnail always
    // get a real upload URL. Defensive unwraps below match the server contract.
    let upload_url = token_res.upload_url.ok_or_else(|| {
        format!("{} upload-token 缺少 uploadUrl ({})", env_tag(), kind)
    })?;
    let content_type = token_res.content_type.ok_or_else(|| {
        format!("{} upload-token 缺少 contentType ({})", env_tag(), kind)
    })?;
    let callback_token = token_res.callback_token.ok_or_else(|| {
        format!("{} upload-token 缺少 callbackToken ({})", env_tag(), kind)
    })?;

    let stream = FramedRead::new(file, BytesCodec::new());
    let body = reqwest::Body::wrap_stream(stream);
    let put_res = client
        .put(&upload_url)
        .header(CONTENT_LENGTH, size)
        .header(CONTENT_TYPE, &content_type)
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
        callback_token: &callback_token,
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

// 视频原片上传专用变体：在 PUT body 上挂一层进度计数器，每 ≥500ms 通过 Tauri event
// 把字节数发给前端做进度条。audio/thumbnail 不需要这条路径（小文件、不在 UI 主轴）。
async fn upload_file_and_notify_with_progress(
    app: &AppHandle,
    client: &Client,
    server_url: &str,
    session_token: &str,
    media_file_id: &str,
    kind: &str,
    file_path: &str,
    filename_for_token: &str,
) -> Result<(), String> {
    use futures_util::StreamExt;

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
        asset_id: media_file_id,
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

    // Cross-user dedup short-circuit: another user already uploaded this
    // SHA-256 to OSS. The server has flipped this user's media_files row to
    // backed_up directly. We don't PUT, don't fire the HMAC callback. Emit
    // one final 100% progress so the UI's progress bar finishes cleanly.
    if token_res.already_uploaded {
        let _ = app.emit(
            "backup-progress",
            serde_json::json!({
                "mediaFileId": media_file_id,
                "sent": size,
                "total": size,
            }),
        );
        return Ok(());
    }

    let upload_url = token_res.upload_url.ok_or_else(|| {
        format!("{} upload-token 缺少 uploadUrl ({})", env_tag(), kind)
    })?;
    let content_type = token_res.content_type.ok_or_else(|| {
        format!("{} upload-token 缺少 contentType ({})", env_tag(), kind)
    })?;
    let callback_token = token_res.callback_token.ok_or_else(|| {
        format!("{} upload-token 缺少 callbackToken ({})", env_tag(), kind)
    })?;

    // Wrap FramedRead so each chunk increments a counter; throttle emit to ≥500ms,
    // plus one final 100% emit when the stream finishes.
    let app_handle = app.clone();
    let asset_id_owned = media_file_id.to_string();
    let mut sent: u64 = 0;
    let mut last_emit = Instant::now();
    let stream = FramedRead::new(file, BytesCodec::new()).map(move |chunk| {
        if let Ok(ref bytes) = chunk {
            sent += bytes.len() as u64;
            let done = sent >= size;
            if last_emit.elapsed().as_millis() >= 500 || done {
                let _ = app_handle.emit(
                    "backup-progress",
                    serde_json::json!({
                        "mediaFileId": &asset_id_owned,
                        "sent": sent,
                        "total": size,
                    }),
                );
                last_emit = Instant::now();
            }
        }
        chunk
    });
    let body = reqwest::Body::wrap_stream(stream);

    let put_res = client
        .put(&upload_url)
        .header(CONTENT_LENGTH, size)
        .header(CONTENT_TYPE, &content_type)
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
        callback_token: &callback_token,
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
//   0.5 POST /api/assets/preflight — 命中即记录本地路径到 SQLite 后返回
//   1. FFmpeg 抽取音频 + 缩略图（视频原片不动）
//   2. POST /api/assets 预登记资产行（携带 fileSize / duration），返回 mediaFileId
//      → 立刻 upsert (mediaFileId, localPath, fileSize, sha256) 到桌面端 SQLite
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
    let _ = app.emit("upload-progress", serde_json::json!({ "id": &job_id, "progress": 2 }));
    let file_hash = compute_sha256(&local_path).await?;
    let file_size_bytes = tokio::fs::metadata(&local_path)
        .await
        .map_err(|e| format!("{} 读取源文件大小失败: {}", env_tag(), e))?
        .len();

    // Step 0.5: Preflight — short-circuit FFmpeg if the same hash already exists
    // for this user. On hit, the server creates the project_assets row and we
    // return immediately, skipping FFmpeg + audio/thumbnail uploads entirely.
    {
        let preflight_client = Client::new();
        let preflight_payload = PreflightPayload {
            project_id: &project_id,
            file_hash: &file_hash,
            filename: &filename,
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
            let media_file_id = preflight_resp.media_file_id.ok_or_else(||
                format!("{} preflight 命中但缺少 mediaFileId", env_tag()))?;
            // Bind this device's local copy to the deduped media_file. Backend
            // doesn't carry per-device paths anymore; this is the source of truth.
            let pool = app.state::<SqlitePool>();
            if let Err(e) = local_db::upsert(
                pool.inner(),
                &media_file_id,
                &local_path,
                file_size_bytes as i64,
                &file_hash,
            )
            .await
            {
                eprintln!("[local_db] dedup-hit upsert 失败: {}", e);
            }
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
        file_size: file_size_bytes,
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

    // Persist the local-path → media_file_id mapping. Backend no longer
    // carries this; the local SQLite store is the source of truth.
    {
        let pool = app.state::<SqlitePool>();
        if let Err(e) = local_db::upsert(
            pool.inner(),
            &create_resp.media_file_id,
            &local_path,
            file_size_bytes as i64,
            &file_hash,
        )
        .await
        {
            eprintln!("[local_db] post-create upsert 失败: {}", e);
        }
    }

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

// ===================================================================
// Local asset DB commands — per-device SQLite, keyed by media_file_id.
//
// Backend MySQL no longer carries (local_path, origin_device_id) because the
// same media_file may live at different paths on each of a user's devices.
// These commands are the only path the frontend uses to learn "is this asset
// on my disk, and where?".
// ===================================================================

#[tauri::command]
async fn local_assets_get(
    pool: State<'_, SqlitePool>,
    media_file_id: String,
) -> Result<Option<local_db::LocalAsset>, String> {
    local_db::get(pool.inner(), &media_file_id)
        .await
        .map_err(|e| format!("local_assets_get failed: {e}"))
}

#[tauri::command]
async fn local_assets_get_many(
    pool: State<'_, SqlitePool>,
    media_file_ids: Vec<String>,
) -> Result<std::collections::HashMap<String, local_db::LocalAsset>, String> {
    local_db::get_many(pool.inner(), &media_file_ids)
        .await
        .map_err(|e| format!("local_assets_get_many failed: {e}"))
}

#[tauri::command]
async fn local_assets_set(
    pool: State<'_, SqlitePool>,
    media_file_id: String,
    local_path: String,
    file_size: i64,
    sha256: String,
) -> Result<local_db::LocalAsset, String> {
    local_db::upsert(pool.inner(), &media_file_id, &local_path, file_size, &sha256)
        .await
        .map_err(|e| format!("local_assets_set failed: {e}"))
}

#[tauri::command]
async fn local_assets_delete(
    pool: State<'_, SqlitePool>,
    media_file_id: String,
) -> Result<(), String> {
    local_db::delete(pool.inner(), &media_file_id)
        .await
        .map_err(|e| format!("local_assets_delete failed: {e}"))
}

// Strict relink: the picked file must SHA-256 match the known media_file hash.
// Stops users from accidentally binding a different file to a media_file row,
// which would silently play wrong content under the same asset card.
#[tauri::command]
async fn local_assets_relink(
    pool: State<'_, SqlitePool>,
    media_file_id: String,
    expected_sha256: String,
    new_path: String,
) -> Result<local_db::LocalAsset, String> {
    let meta = tokio::fs::metadata(&new_path)
        .await
        .map_err(|e| format!("relink: 读取文件元数据失败: {e}"))?;
    let size = meta.len() as i64;
    let actual = compute_sha256(&new_path).await?;
    if actual != expected_sha256 {
        return Err("hash_mismatch: 选中的文件不是这个素材原片".to_string());
    }
    local_db::upsert(pool.inner(), &media_file_id, &new_path, size, &actual)
        .await
        .map_err(|e| format!("local_assets_relink upsert failed: {e}"))
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
            download_asset_to_local,
            get_local_file_server_info,
            local_assets_get,
            local_assets_get_many,
            local_assets_set,
            local_assets_delete,
            local_assets_relink,
        ])
        .setup(|app| {
            // 启动即探测：将最优编码器与并发管理器挂载至全局
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let encoder = detect_best_video_encoder(&handle).await;
                handle.manage(VideoEncoderState(encoder));
                handle.manage(ProcessingManager::new());
            });

            // Per-device asset metadata SQLite. Sits next to device_id under
            // app_data_dir. Fail hard on init error: silent fallback would
            // break local playback resolution.
            let db_path = app
                .path()
                .app_data_dir()
                .expect("无法定位 app data dir")
                .join("local_assets.sqlite");
            if let Some(parent) = db_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let pool = tauri::async_runtime::block_on(local_db::open_and_migrate(&db_path))
                .expect("local SQLite init failed");
            app.manage(pool);

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
