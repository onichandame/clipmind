use reqwest::Client;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tokio::io::AsyncReadExt;

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
    input: String,
    output_video: String,
    output_audio: String,
) -> Result<f64, String> {
    let sidecar_command = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("无法构建 sidecar: {}", e))?
        .args([
            "-y", // 强制覆盖已有残留文件
            "-i",
            &input,
            // 视频轨道：剔除音频 (-an) (MVP 阶段兜底使用 libx264，后续可针对 OS 开启硬件加速)
            "-c:v",
            "libx264",
            "-an",
            &output_video,
            // 音频轨道：剔除视频 (-vn)，强制降维至 16kHz 32kbps 单声道 AAC，专门喂给后端 ASR
            "-vn",
            "-c:a",
            "aac",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-b:a",
            "32k",
            &output_audio,
        ]);

    let (mut rx, _child) = sidecar_command
        .spawn()
        .map_err(|e| format!("进程启动失败: {}", e))?;

    let mut is_success = false;
    let mut extracted_duration = 0.0;

    // 注入高频防御：IPC 节流阀
    let mut last_emit = std::time::Instant::now();
    let throttle_duration = std::time::Duration::from_millis(150);

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
                    let _ = app.emit("ffmpeg-progress", serde_json::json!({ "log": line.to_string() }));
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
) -> Result<(), String> {
    let client = Client::new();
    let payload = serde_json::json!({
      "filename": filename,
      "objectKey": object_key,
      "fileSize": file_size,
      "duration": duration as u64
    });

    let res = client
        .post("http://localhost:8787/api/oss-callback")
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init()) // 💡 核心修复：重新注册 Shell 插件
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            process_asset,
            upload_asset,
            notify_webhook
        ])
        .setup(|app| {
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
