// Shared asset type definitions used across AssetPickerWidget, AssetDetailModal, and asset-uri.

export interface Asset {
  id: string;               // user_media_files.id for material library reads
  userMediaFileId?: string;
  projectAssetId?: string;
  projectAssetIds?: string[];
  mediaFileId: string;      // media_files.id; local identity is sha256
  filename: string;
  sha256: string;           // mirror of media_files.fileHash; used for strict relink verification
  backupStatus?: 'local_only' | 'uploading' | 'backed_up' | 'stale' | 'failed' | null;
  audioOssUrl?: string | null;
  thumbnailUrl?: string | null;
  videoOssUrl?: string | null;
  fileSize: number;
  duration: number;
  status: 'ready' | 'processing' | 'failed';
  transcriptKind?: 'speech' | 'empty' | 'skipped' | null;
  processingStage?: 'upload' | 'thumbnail' | 'asr' | 'embedding' | 'qdrant' | 'processing' | null;
  failureStage?: 'upload' | 'thumbnail' | 'asr' | 'embedding' | 'qdrant' | 'processing' | null;
  failureReason?: string | null;
  createdAt: string;
  summary?: string | null;
}

export type AnalysisStage =
  | 'uploading'
  | 'analyzing'
  | 'analyzed'
  | 'analysis_failed'
  | 'upload_failed';

export function getAnalysisStage(asset: Pick<Asset, 'status' | 'transcriptKind' | 'failureStage' | 'summary'>): AnalysisStage {
  if (asset.status === 'failed') {
    return asset.failureStage === 'asr'
      || asset.failureStage === 'embedding'
      || asset.failureStage === 'qdrant'
      || asset.failureStage === 'processing'
      ? 'analysis_failed'
      : 'upload_failed';
  }
  if (asset.status !== 'ready') return 'uploading';
  if (asset.transcriptKind && asset.summary) return 'analyzed';
  return 'analyzing';
}
