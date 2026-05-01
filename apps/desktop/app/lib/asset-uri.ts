import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

const DEVICE_ID_KEY = 'clipmind:device:id';

let cachedDeviceId: string | null = null;
let inflightDevice: Promise<string | null> | null = null;

async function loadDeviceId(): Promise<string | null> {
  if (cachedDeviceId) return cachedDeviceId;
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(DEVICE_ID_KEY);
    if (stored) {
      cachedDeviceId = stored;
      return stored;
    }
  }
  if (inflightDevice) return inflightDevice;
  inflightDevice = (async () => {
    try {
      const id = await invoke<string>('get_device_id');
      cachedDeviceId = id;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(DEVICE_ID_KEY, id);
      }
      return id;
    } catch (e) {
      console.warn('[device] failed to load device_id:', e);
      return null;
    } finally {
      inflightDevice = null;
    }
  })();
  return inflightDevice;
}

export function useDeviceId(): string | null {
  const [id, setId] = useState<string | null>(cachedDeviceId);
  useEffect(() => {
    if (cachedDeviceId) return;
    loadDeviceId().then(setId);
  }, []);
  return id;
}

// Localhost file server: WebKitGTK on Linux refuses to play media from
// asset://localhost/... URLs (errorCode 4 / SRC_NOT_SUPPORTED), so the Rust
// shell exposes a tiny localhost HTTP server with Range support, and we
// rewrite local-origin asset URIs to http://127.0.0.1:PORT/file?token=...&path=...
interface LocalFileServerInfo {
  baseUrl: string;
  token: string;
}
let cachedLocalServer: LocalFileServerInfo | null = null;
let inflightLocalServer: Promise<LocalFileServerInfo | null> | null = null;

async function loadLocalServerInfo(): Promise<LocalFileServerInfo | null> {
  if (cachedLocalServer) return cachedLocalServer;
  if (inflightLocalServer) return inflightLocalServer;
  inflightLocalServer = (async () => {
    try {
      const info = await invoke<LocalFileServerInfo>('get_local_file_server_info');
      cachedLocalServer = info;
      return info;
    } catch (e) {
      console.warn('[local-file-server] failed to load info:', e);
      return null;
    } finally {
      inflightLocalServer = null;
    }
  })();
  return inflightLocalServer;
}

function buildLocalFileUrl(localPath: string, info: LocalFileServerInfo): string {
  const path = encodeURIComponent(localPath);
  const token = encodeURIComponent(info.token);
  return `${info.baseUrl}?token=${token}&path=${path}`;
}

// Eagerly request the localhost server info on module load so the first
// preview click doesn't pay the IPC roundtrip. No-op in non-Tauri contexts.
if (typeof window !== 'undefined') {
  loadLocalServerInfo();
}

function useLocalServerInfo(): LocalFileServerInfo | null {
  const [info, setInfo] = useState<LocalFileServerInfo | null>(cachedLocalServer);
  useEffect(() => {
    if (cachedLocalServer) return;
    loadLocalServerInfo().then((v) => {
      if (v) setInfo(v);
    });
  }, []);
  return info;
}

export interface AssetLike {
  id?: string;
  localPath?: string | null;
  originDeviceId?: string | null;
  backupStatus?: string | null;
  videoOssUrl?: string | null;
  videoUrl?: string | null;
}

export type AssetUriKind = 'local' | 'cloud' | 'unavailable';
export interface AssetUri {
  kind: AssetUriKind;
  uri: string | null;
}

// Pure resolver: prefers local file when origin matches current device, falls back to
// signed cloud URL when the asset has been backed up. Otherwise unavailable.
//
// Local URLs require localServer to have loaded; until then, kind === 'local'
// but uri === null so callers know to wait (the hook re-renders when the info
// resolves).
export function resolveAssetUri(
  asset: AssetLike,
  currentDeviceId: string | null,
  localServer: LocalFileServerInfo | null,
): AssetUri {
  if (!asset) return { kind: 'unavailable', uri: null };
  const isLocalOrigin = !!asset.originDeviceId && !!currentDeviceId && asset.originDeviceId === currentDeviceId;
  if (isLocalOrigin && asset.localPath) {
    return {
      kind: 'local',
      uri: localServer ? buildLocalFileUrl(asset.localPath, localServer) : null,
    };
  }
  if (asset.backupStatus === 'backed_up') {
    const cloud = asset.videoOssUrl || asset.videoUrl;
    if (cloud) return { kind: 'cloud', uri: cloud };
  }
  return { kind: 'unavailable', uri: null };
}

export function useAssetUri(asset: AssetLike): AssetUri {
  const deviceId = useDeviceId();
  const localServer = useLocalServerInfo();
  return resolveAssetUri(asset, deviceId, localServer);
}
