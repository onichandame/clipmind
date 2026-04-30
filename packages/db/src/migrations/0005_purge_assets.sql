-- Migration: purge all asset rows so dev environments can re-run ASR + chunk
-- vectorization end-to-end. Required after a bug in asset-processor.ts wrote
-- `payload.assetId = undefined` into Qdrant chunk points; existing media_files
-- rows would otherwise short-circuit dedup on re-upload and skip the pipeline.
--
-- FK cascades from media_files wipe project_assets + asset_chunks automatically.
-- editing_plans and projects.{selectedAssetIds, retrievedAssetIds} are left
-- intact — they may now contain stale ID references, treated as missing by the
-- frontend (harmless empty state).

DELETE FROM `media_files`;
