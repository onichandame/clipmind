// Shared asset type definitions used across AssetPickerWidget, AssetDetailModal, and asset-uri.

export interface Asset {
  id: string;               // project_assets.id
  mediaFileId: string;      // media_files.id (also used to look up per-device local path in Rust SQLite)
  filename: string;
  sha256: string;           // mirror of media_files.fileHash; used for strict relink verification
  backupStatus?: 'local_only' | 'uploading' | 'backed_up' | 'stale' | 'failed' | null;
  audioOssUrl?: string | null;
  thumbnailUrl?: string | null;
  videoOssUrl?: string | null;
  fileSize: number;
  duration: number;
  status: 'ready' | 'processing' | 'error';
  asrStatus?: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped' | null;
  createdAt: string;
  summary?: string | null;
}

export type AnalysisStage =
  | 'uploading'
  | 'analyzing'
  | 'analyzed'
  | 'analysis_failed'
  | 'upload_failed';

export function getAnalysisStage(asset: Pick<Asset, 'status' | 'asrStatus' | 'summary'>): AnalysisStage {
  if (asset.status === 'error') return 'upload_failed';
  if (asset.status !== 'ready') return 'uploading';
  if (asset.asrStatus === 'failed') return 'analysis_failed';
  if (asset.asrStatus === 'completed' && asset.summary) return 'analyzed';
  return 'analyzing';
}
