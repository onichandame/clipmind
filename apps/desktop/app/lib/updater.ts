import { useEffect, useState } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'none' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; downloaded: number; total: number | null }
  | { kind: 'installing' }
  | { kind: 'error'; message: string };

export function useUpdateCheck() {
  const [status, setStatus] = useState<UpdateStatus>({ kind: 'idle' });
  const [pending, setPending] = useState<Update | null>(null);

  useEffect(() => {
    // Skip in dev: tauri.conf.json's current_version (0.1.x) will lag behind
    // any published latest.json, so the plugin would prompt a "new version"
    // and clicking install would try to swap the debug binary with a prod
    // bundle — undefined behavior at best.
    if (import.meta.env.DEV) {
      setStatus({ kind: 'none' });
      return;
    }
    let cancelled = false;
    setStatus({ kind: 'checking' });
    check()
      .then((u) => {
        if (cancelled) return;
        if (u) {
          setPending(u);
          setStatus({ kind: 'available', version: u.version });
        } else {
          setStatus({ kind: 'none' });
        }
      })
      .catch((e) => {
        if (cancelled) return;
        // Network errors on startup are non-fatal; stay quiet to avoid noise.
        console.warn('[updater] check failed', e);
        setStatus({ kind: 'error', message: String(e) });
      });
    return () => { cancelled = true; };
  }, []);

  const install = async () => {
    if (!pending) return;
    let total: number | null = null;
    let downloaded = 0;
    setStatus({ kind: 'downloading', downloaded: 0, total: null });
    try {
      await pending.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? null;
          setStatus({ kind: 'downloading', downloaded: 0, total });
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          setStatus({ kind: 'downloading', downloaded, total });
        } else if (event.event === 'Finished') {
          setStatus({ kind: 'installing' });
        }
      });
      await relaunch();
    } catch (e) {
      console.error('[updater] install failed', e);
      setStatus({ kind: 'error', message: String(e) });
    }
  };

  return { status, install };
}
