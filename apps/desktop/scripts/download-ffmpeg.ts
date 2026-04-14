import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function getTargetTriple() {
  // 1. 优先从环境变量获取（支持 CI 透传或 Tauri v2 注入）
  const envTriple = process.env.TARGET_TRIPLE || process.env.TAURI_ENV_TARGET_TRIPLE;
  if (envTriple) return envTriple;

  // 2. 兜底逻辑：仅在本地开发且未指定目标时探测宿主机
  try {
    const rustcOut = execSync('rustc -vV').toString();
    const hostLine = rustcOut.split('\n').find(l => l.startsWith('host:'));
    return hostLine?.split(' ')[1].trim() || 'x86_64-unknown-linux-gnu';
  } catch (e) {
    return 'x86_64-unknown-linux-gnu';
  }
}

async function download() {
  const triple = await getTargetTriple();
  
  // 根据目标三元组决定文件名后缀和下载源，而非 process.platform
  const isWin = triple.includes('windows');
  const isMac = triple.includes('apple-darwin');
  
  const extension = isWin ? '.exe' : '';
  const targetName = `ffmpeg-${triple}${extension}`;
  const destPath = path.join(__dirname, '../src-tauri/bin', targetName);

  if (fs.existsSync(destPath)) {
    console.log(`✅ FFmpeg sidecar already exists: ${targetName}`);
    return;
  }

  let staticPlatform = 'linux-x64';
  if (isWin) {
    staticPlatform = 'win32-x64';
  } else if (isMac) {
    // 根据三元组前缀精准锁定 Mac 架构
    staticPlatform = triple.startsWith('aarch64') ? 'darwin-arm64' : 'darwin-x64';
  }

  const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-${staticPlatform}`;
  console.log(`🚀 Downloading FFmpeg for ${triple} from ${url}...`);

  try {
    const binDir = path.dirname(destPath);
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
      console.log(`📁 Created missing directory: ${binDir}`);
    }
    execSync(`curl -L -# -o "${destPath}" "${url}"`, { stdio: 'inherit' });
    if (process.platform !== 'win32') {
      fs.chmodSync(destPath, 0o755);
      console.log(`✅ Automatically set executable permissions (0755)`);
    }
    console.log(`🎉 Successfully downloaded and installed FFmpeg sidecar to: ${destPath}`);
  } catch (error) {
    console.error(`❌ Download failed. Please check your network connection to GitHub.`);
    process.exit(1);
  }
}

download();
