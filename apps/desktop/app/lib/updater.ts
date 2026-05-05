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
