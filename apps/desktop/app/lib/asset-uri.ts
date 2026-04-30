import { useEffect, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';

const DEVICE_ID_KEY = 'clipmind:device:id';

let cachedDeviceId: string | null = null;
let inflight: Promise<string | null> | null = null;

async function loadDeviceId(): Promise<string | null> {
  if (cachedDeviceId) return cachedDeviceId;
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(DEVICE_ID_KEY);
    if (stored) {
      cachedDeviceId = stored;
      return stored;
    }
  }
  if (inflight) return inflight;
  inflight = (async () => {
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
      inflight = null;
    }
  })();
  return inflight;
}

export function useDeviceId(): string | null {
  const [id, setId] = useState<string | null>(cachedDeviceId);
  useEffect(() => {
    if (cachedDeviceId) return;
    loadDeviceId().then(setId);
  }, []);
  return id;
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
export function resolveAssetUri(asset: AssetLike, currentDeviceId: string | null): AssetUri {
  if (!asset) return { kind: 'unavailable', uri: null };
  const isLocalOrigin = !!asset.originDeviceId && !!currentDeviceId && asset.originDeviceId === currentDeviceId;
  if (isLocalOrigin && asset.localPath) {
    try {
      return { kind: 'local', uri: convertFileSrc(asset.localPath) };
    } catch {
      // convertFileSrc throws when not in a Tauri context — fall through to cloud/unavailable
    }
  }
  if (asset.backupStatus === 'backed_up') {
    const cloud = asset.videoOssUrl || asset.videoUrl;
    if (cloud) return { kind: 'cloud', uri: cloud };
  }
  return { kind: 'unavailable', uri: null };
}

export function useAssetUri(asset: AssetLike): AssetUri {
  const deviceId = useDeviceId();
  return resolveAssetUri(asset, deviceId);
}
