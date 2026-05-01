// 本地文件 HTTP 流服务（仅监听 127.0.0.1）。
//
// 为什么需要这个东西：
// WebKitGTK 的 <video> 元素拒绝从 Tauri 默认 asset://localhost/... 自定义协议加载
// 媒体源（errorCode=4 / MEDIA_ERR_SRC_NOT_SUPPORTED），但能正常加载真正的
// http://127.0.0.1:PORT/... 流。
//
// 另外 WebKitGTK 不支持 HEVC（iPhone 默认录制格式），因此本服务在响应每个 /file
// 请求时强制把源视频通过 FFmpeg 实时转码为 H.264 fragmented MP4 再回传，确保
// 任何容器/编码的视频都能在 Linux WebView 里被 <video> 直接播放。
//
// 取舍：on-the-fly 转码不再支持 HTTP Range 寻址（输出码率不可预测，无法把字节
// 偏移翻译成时间），所以预览只能从头线性播放、不能拖动进度条。这是用户在
// "Option B" 时显式接受的代价；以后想要 seek 体验可以再切到 Option A
// （导入时预先压一份 H.264 缓存）。
//
// 安全：只 bind 127.0.0.1（同机进程才能访问），并要求 ?token=... 匹配启动时
// 生成的随机 token，避免同机其他进程或浏览器误读用户视频。

use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::thread;

use tiny_http::{Header, Method, Response, Server, StatusCode};
use uuid::Uuid;

#[derive(Clone)]
pub struct LocalFileServerInfo {
    pub base_url: String,
    pub token: String,
}

static SERVER_INFO: OnceLock<LocalFileServerInfo> = OnceLock::new();
static FFMPEG_PATH: OnceLock<PathBuf> = OnceLock::new();

pub fn set_ffmpeg_path(path: PathBuf) {
    let _ = FFMPEG_PATH.set(path);
}

pub fn start() -> Result<LocalFileServerInfo, String> {
    if let Some(info) = SERVER_INFO.get() {
        return Ok(info.clone());
    }
    let server = Server::http("127.0.0.1:0").map_err(|e| format!("绑定本地视频服务失败: {}", e))?;
    let port = server
        .server_addr()
        .to_ip()
        .ok_or_else(|| "本地视频服务未拿到端口".to_string())?
        .port();
    let token = Uuid::new_v4().to_string();
    let info = LocalFileServerInfo {
        base_url: format!("http://127.0.0.1:{}/file", port),
        token: token.clone(),
    };
    let _ = SERVER_INFO.set(info.clone());

    thread::spawn(move || {
        for request in server.incoming_requests() {
            handle_request(request, &token);
        }
    });

    Ok(info)
}

fn handle_request(request: tiny_http::Request, expected_token: &str) {
    let url = request.url().to_string();
    let method = request.method().clone();
    let method_str = method.as_str().to_string();
    eprintln!("[local_file_server] >>> {} {}", method_str, url);

    let (path_part, query_part) = url.split_once('?').unwrap_or((url.as_str(), ""));
    if path_part != "/file" {
        let _ = request.respond(Response::empty(StatusCode(404)));
        return;
    }
    if !matches!(method, Method::Get | Method::Head) {
        let _ = request.respond(Response::empty(StatusCode(405)));
        return;
    }

    let mut token = None;
    let mut file_path = None;
    for kv in query_part.split('&') {
        let (k, v) = match kv.split_once('=') {
            Some(t) => t,
            None => continue,
        };
        match k {
            "token" => token = Some(v.to_string()),
            "path" => {
                file_path = urlencoding::decode(v).ok().map(|c| c.into_owned());
            }
            _ => {}
        }
    }

    if token.as_deref() != Some(expected_token) {
        eprintln!("[local_file_server] <<< 403 (bad token)");
        let _ = request.respond(Response::empty(StatusCode(403)));
        return;
    }
    let path = match file_path {
        Some(p) if !p.is_empty() => PathBuf::from(p),
        _ => {
            let _ = request.respond(Response::empty(StatusCode(400)));
            return;
        }
    };
    if !path.exists() {
        eprintln!("[local_file_server] <<< 404 (file missing) {:?}", path);
        let _ = request.respond(Response::empty(StatusCode(404)));
        return;
    }

    let ffmpeg = match FFMPEG_PATH.get() {
        Some(p) => p,
        None => {
            eprintln!("[local_file_server] <<< 500 (ffmpeg path not set)");
            let _ = request.respond(Response::empty(StatusCode(500)));
            return;
        }
    };

    // HEAD: just declare the content type so WebKit's media probe knows what's
    // coming. We don't know transcoded length, so omit Content-Length and don't
    // advertise Accept-Ranges (transcoding can't honor byte ranges).
    if matches!(method, Method::Head) {
        let response: Response<std::io::Empty> = Response::new(
            StatusCode(200),
            vec![],
            std::io::empty(),
            None,
            None,
        )
        .with_header(Header::from_bytes(&b"Content-Type"[..], &b"video/mp4"[..]).unwrap())
        .with_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap());
        eprintln!("[local_file_server] <<< 200 HEAD (transcode pending)");
        let _ = request.respond(response);
        return;
    }

    // Sanity: file must be readable; if not, bail before spawning ffmpeg.
    if let Err(e) = fs::File::open(&path) {
        eprintln!("[local_file_server] <<< 500 (open failed: {})", e);
        let _ = request.respond(Response::empty(StatusCode(500)));
        return;
    }

    let path_str = match path.to_str() {
        Some(s) => s.to_string(),
        None => {
            let _ = request.respond(Response::empty(StatusCode(400)));
            return;
        }
    };

    eprintln!("[local_file_server] === transcoding {:?}", path);
    let mut child = match Command::new(ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            &path_str,
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "28",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            // Fragmented MP4 so the player can start without waiting for moov.
            "-movflags",
            "frag_keyframe+empty_moov+default_base_moof",
            "-f",
            "mp4",
            // stdout
            "-",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[local_file_server] !!! ffmpeg spawn failed: {}", e);
            let _ = request.respond(Response::empty(StatusCode(500)));
            return;
        }
    };

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let _ = request.respond(Response::empty(StatusCode(500)));
            return;
        }
    };

    // Drain stderr in a side thread so ffmpeg doesn't block on a full stderr
    // pipe and so we get useful diagnostics if encoding chokes.
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                eprintln!("[ffmpeg] {}", line);
            }
        });
    }

    let response = Response::new(StatusCode(200), vec![], stdout, None, None)
        .with_header(Header::from_bytes(&b"Content-Type"[..], &b"video/mp4"[..]).unwrap())
        .with_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap())
        .with_header(Header::from_bytes(&b"Cache-Control"[..], &b"no-store"[..]).unwrap());

    eprintln!("[local_file_server] <<< 200 streaming transcoded mp4");
    let _ = request.respond(response);

    // Reap the child. If respond returned because ffmpeg's stdout closed,
    // ffmpeg has exited; if respond returned because the client hung up,
    // ffmpeg will get SIGPIPE on the next stdout write and exit shortly.
    let _ = child.kill();
    let _ = child.wait();
    eprintln!("[local_file_server] === transcode finished");
}
