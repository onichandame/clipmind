// Shared asset import pipeline.
//
// Single trigger function (selectAndImportAssets) callable from any component
// that wants to kick off the local-first video import flow — opens the system
// file dialog, registers UploadJobs in the global store, and asks Rust to
// pre-process + background-upload audio/thumbnail tracks.
//
// Tauri progress events (upload-progress / ffmpeg-progress / upload-error) are
// wired up ONCE at the root via useGlobalAssetImportListeners() so any caller
// — chat widget, library page, future entry points — sees the same progress
// state without each having to mount its own listeners.

import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRevalidator } from 'react-router';
import { env } from '../env';
import { getToken } from './auth';
import { useCanvasStore, type UploadJob, type JobStatus } from '../store/useCanvasStore';

const VIDEO_EXTS = ['mp4', 'mov', 'MP4', 'MOV'];

export async function selectAndImportAssets(): Promise<void> {
  const selected = await open({
    multiple: true,
    filters: [{ name: 'Videos', extensions: VIDEO_EXTS }],
  });
  if (!selected) return;
  const paths = Array.isArray(selected) ? selected : [selected];

  const newJobs: UploadJob[] = paths.map((p) => ({
    id: crypto.randomUUID(),
    filename: p.split(/[\\/]/).pop() || 'video.mp4',
    sourcePath: p,
    status: 'queued',
    progress: 0,
  }));

  useCanvasStore.getState().setUploadJobs((prev) => [...prev, ...newJobs]);
  newJobs.forEach(processJob);
}

async function processJob(job: UploadJob): Promise<void> {
  const update = useCanvasStore.getState().updateUploadJob;
  try {
    update(job.id, { status: 'compressing', progress: 0 });
    const sessionToken = getToken() || '';
    await invoke('process_video_asset', {
      jobId: job.id,
      filename: job.filename,
      localPath: job.sourcePath,
      serverUrl: env.VITE_API_BASE_URL,
      sessionToken,
    });
    update(job.id, { status: 'uploading', progress: 0 });
  } catch (error: any) {
    const msg = typeof error === 'string' ? error : error?.message ?? String(error);
    update(job.id, { status: 'error', errorMessage: msg });
  }
}

// Wire Tauri progress events globally. Mount once near the app root.
export function useGlobalAssetImportListeners() {
  const queryClient = useQueryClient();
  const revalidator = useRevalidator();
  const setJobs = useCanvasStore((s) => s.setUploadJobs);
  const updateJob = useCanvasStore((s) => s.updateUploadJob);

  useEffect(() => {
    let unlistenUpload: undefined | (() => void);
    let unlistenFFmpeg: undefined | (() => void);
    let unlistenError: undefined | (() => void);

    listen<{ id: string; progress: number }>('upload-progress', (event) => {
      const isComplete = event.payload.progress >= 100;
      if (isComplete) {
        // Refresh active route loaders + the chat widget's asset-library query.
        revalidator.revalidate();
        queryClient.invalidateQueries({ queryKey: ['assets-library'] });
      }
      setJobs((current) =>
        current.map((j) => {
          if (j.id !== event.payload.id) return j;
          let nextStatus: JobStatus = j.status;
          if (isComplete) nextStatus = 'ready';
          else if (j.status === 'compressing' || j.status === 'queued') nextStatus = 'uploading';
          return { ...j, progress: event.payload.progress, status: nextStatus };
        }),
      );
    }).then((fn) => { unlistenUpload = fn; });

    listen<{ log: string }>('ffmpeg-progress', () => {
      // Visual compensation: bump compressing jobs slightly so the bar moves.
      setJobs((current) =>
        current.map((j) =>
          j.status === 'compressing' && j.progress < 90 ? { ...j, progress: j.progress + 2 } : j,
        ),
      );
    }).then((fn) => { unlistenFFmpeg = fn; });

    listen<{ id: string; message: string }>('upload-error', (event) => {
      updateJob(event.payload.id, { status: 'error', errorMessage: event.payload.message });
    }).then((fn) => { unlistenError = fn; });

    return () => {
      unlistenUpload?.();
      unlistenFFmpeg?.();
      unlistenError?.();
    };
  }, [queryClient, revalidator, setJobs, updateJob]);
}
