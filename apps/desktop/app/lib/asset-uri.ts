import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useQuery } from '@tanstack/react-query';

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

// Retained for any future analytics/backup-attribution callers; the asset-uri
// resolver no longer uses it because "is this asset on my disk" is answered by
// the per-device SQLite store, not by device-id equality.
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
// shell exposes a tiny localhost HTTP server with on-the-fly H.264 transcoding,
// and we rewrite local-origin asset URIs to
// http://127.0.0.1:PORT/file?token=...&path=...
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

// ============================================================================
// Local asset DB (per-device SQLite owned by Rust). Tells us whether this
// device has a copy of a given media_file and where it is on disk.
// ============================================================================

export interface LocalAsset {
  localPath: string;
  fileSize: number;
  sha256: string;
  updatedAt: number;
}

export function useLocalAsset(mediaFileId: string | null | undefined) {
  return useQuery({
    queryKey: ['local-assets', mediaFileId ?? '__null'],
    enabled: !!mediaFileId,
    queryFn: async (): Promise<LocalAsset | null> => {
      if (!mediaFileId) return null;
      const result = await invoke<LocalAsset | null>('local_assets_get', { mediaFileId });
      return result ?? null;
    },
    staleTime: 60_000,
  });
}

export function useLocalAssets(mediaFileIds: string[]) {
  return useQuery({
    queryKey: ['local-assets', 'batch', [...mediaFileIds].sort()],
    enabled: mediaFileIds.length > 0,
    queryFn: async (): Promise<Record<string, LocalAsset>> => {
      if (mediaFileIds.length === 0) return {};
      const result = await invoke<Record<string, LocalAsset>>('local_assets_get_many', {
        mediaFileIds,
      });
      return result ?? {};
    },
    staleTime: 60_000,
  });
}

export interface AssetLike {
  id?: string;
  mediaFileId?: string | null;
  backupStatus?: string | null;
  videoOssUrl?: string | null;
  videoUrl?: string | null;
}

export type AssetUriKind = 'local' | 'cloud' | 'unavailable';
export interface AssetUri {
  kind: AssetUriKind;
  uri: string | null;
}

// Pure resolver. Prefers the local file when this device has a row for the
// asset's media_file in its SQLite store; otherwise falls back to a signed
// cloud URL when the asset is backed up. Otherwise unavailable.
//
// `localPath` of null means "we don't have a local copy" — pass it from
// useLocalAsset(asset.mediaFileId).
export function resolveAssetUri(
  asset: AssetLike,
  localPath: string | null,
  localServer: LocalFileServerInfo | null,
): AssetUri {
  if (!asset) return { kind: 'unavailable', uri: null };
  if (localPath) {
    return {
      kind: 'local',
      uri: localServer ? buildLocalFileUrl(localPath, localServer) : null,
    };
  }
  if (asset.backupStatus === 'backed_up') {
    const cloud = asset.videoOssUrl || asset.videoUrl;
    if (cloud) return { kind: 'cloud', uri: cloud };
  }
  return { kind: 'unavailable', uri: null };
}

export function useAssetUri(asset: AssetLike): AssetUri {
  const localServer = useLocalServerInfo();
  const local = useLocalAsset(asset?.mediaFileId ?? null);
  return resolveAssetUri(asset, local.data?.localPath ?? null, localServer);
}
