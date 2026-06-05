export type MediaProcessingStatus = 'processing' | 'ready' | 'failed' | string | null | undefined;

export function isReusableMediaStatus(status: MediaProcessingStatus): boolean {
  return status === 'ready' || status === 'processing';
}

export function canAttachWithoutUpload(status: MediaProcessingStatus, alreadyOwnedByUser: boolean): boolean {
  return alreadyOwnedByUser && isReusableMediaStatus(status);
}

export function requiresTempArtifactProof(status: MediaProcessingStatus, alreadyOwnedByUser: boolean): boolean {
  return !alreadyOwnedByUser && isReusableMediaStatus(status);
}

export function shouldReprocessExistingMedia(status: MediaProcessingStatus): boolean {
  return status === 'failed';
}
