import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function getTargetTriple() {
  try {
    const rustcOut = execSync('rustc -vV').toString();
    const hostLine = rustcOut.split('\n').find(l => l.startsWith('host:'));
    return hostLine?.split(' ')[1].trim();
  } catch (e) {
    const platform = process.platform;
    const arch = process.arch;
    if (platform === 'win32') return 'x86_64-pc-windows-msvc';
    if (platform === 'darwin') return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
    return 'x86_64-unknown-linux-gnu';
  }
}

async function download() {
  const triple = await getTargetTriple();
  const extension = process.platform === 'win32' ? '.exe' : '';
  const targetName = `ffmpeg-${triple}${extension}`;
  const destPath = path.join(__dirname, '../src-tauri/bin', targetName);

  if (fs.existsSync(destPath)) {
    console.log(`✅ FFmpeg sidecar already exists: ${targetName}`);
    return;
  }

  let staticPlatform = 'linux-x64';
  if (process.platform === 'win32') staticPlatform = 'win32-x64';
  else if (process.platform === 'darwin') staticPlatform = process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';

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
