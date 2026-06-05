DROP TABLE IF EXISTS `migration_0009_duplicate_file_hashes`;--> statement-breakpoint
CREATE TABLE `migration_0009_duplicate_file_hashes` AS
SELECT
  `file_hash`,
  COUNT(*) AS `duplicate_count`,
  GROUP_CONCAT(`id` ORDER BY `created_at` DESC SEPARATOR ',') AS `media_file_ids`
FROM `media_files`
GROUP BY `file_hash`
HAVING COUNT(*) > 1;--> statement-breakpoint
DROP TABLE IF EXISTS `migration_0009_duplicate_asr_task_ids`;--> statement-breakpoint
CREATE TABLE `migration_0009_duplicate_asr_task_ids` AS
SELECT
  `asr_task_id`,
  COUNT(*) AS `duplicate_count`,
  GROUP_CONCAT(`id` ORDER BY `created_at` DESC SEPARATOR ',') AS `media_file_ids`
FROM `media_files`
WHERE `asr_task_id` IS NOT NULL
GROUP BY `asr_task_id`
HAVING COUNT(*) > 1;--> statement-breakpoint
DROP TEMPORARY TABLE IF EXISTS `migration_0009_media_canonical`;--> statement-breakpoint
CREATE TEMPORARY TABLE `migration_0009_media_canonical` AS
SELECT
  mf.`file_hash`,
  SUBSTRING_INDEX(
    GROUP_CONCAT(
      mf.`id`
      ORDER BY
        CASE
          WHEN mf.`status` = 'ready' AND mf.`asr_status` = 'completed' AND EXISTS (SELECT 1 FROM `asset_chunks` c WHERE c.`media_file_id` = mf.`id`) THEN 1
          WHEN mf.`status` = 'ready' AND mf.`asr_status` IN ('completed', 'skipped') THEN 2
          WHEN mf.`status` = 'ready' THEN 3
          WHEN mf.`status` = 'error' THEN 5
          ELSE 4
        END ASC,
        mf.`created_at` DESC
      SEPARATOR ','
    ),
    ',',
    1
  ) AS `canonical_id`
FROM `media_files` mf
GROUP BY mf.`file_hash`;--> statement-breakpoint
DROP TEMPORARY TABLE IF EXISTS `migration_0009_media_merge`;--> statement-breakpoint
CREATE TEMPORARY TABLE `migration_0009_media_merge` AS
SELECT
  `file_hash`,
  MAX(`audio_oss_key`) AS `audio_oss_key`,
  MAX(`thumbnail_oss_key`) AS `thumbnail_oss_key`,
  MAX(`video_oss_key`) AS `video_oss_key`,
  MAX(CASE WHEN `backup_status` = 'backed_up' THEN `video_oss_key` ELSE NULL END) AS `verified_video_oss_key`,
  MAX(`summary`) AS `summary`
FROM `media_files`
GROUP BY `file_hash`;--> statement-breakpoint
UPDATE `media_files` canonical
INNER JOIN `migration_0009_media_canonical` mc ON mc.`canonical_id` = canonical.`id`
INNER JOIN `migration_0009_media_merge` mm ON mm.`file_hash` = mc.`file_hash`
SET
  canonical.`audio_oss_key` = COALESCE(canonical.`audio_oss_key`, mm.`audio_oss_key`),
  canonical.`thumbnail_oss_key` = COALESCE(canonical.`thumbnail_oss_key`, mm.`thumbnail_oss_key`),
  canonical.`video_oss_key` = CASE
    WHEN mm.`verified_video_oss_key` IS NOT NULL THEN mm.`verified_video_oss_key`
    ELSE COALESCE(canonical.`video_oss_key`, mm.`video_oss_key`)
  END,
  canonical.`backup_status` = CASE WHEN mm.`verified_video_oss_key` IS NOT NULL THEN 'backed_up' ELSE canonical.`backup_status` END,
  canonical.`summary` = COALESCE(canonical.`summary`, mm.`summary`);--> statement-breakpoint
UPDATE `project_assets` pa
INNER JOIN `media_files` mf ON mf.`id` = pa.`media_file_id`
INNER JOIN `migration_0009_media_canonical` mc ON mc.`file_hash` = mf.`file_hash`
SET pa.`media_file_id` = mc.`canonical_id`
WHERE pa.`media_file_id` <> mc.`canonical_id`;--> statement-breakpoint
DELETE c FROM `asset_chunks` c
INNER JOIN `media_files` mf ON mf.`id` = c.`media_file_id`
INNER JOIN `migration_0009_media_canonical` mc ON mc.`file_hash` = mf.`file_hash`
WHERE c.`media_file_id` <> mc.`canonical_id`;--> statement-breakpoint
DELETE mf FROM `media_files` mf
INNER JOIN `migration_0009_media_canonical` mc ON mc.`file_hash` = mf.`file_hash`
WHERE mf.`id` <> mc.`canonical_id`;--> statement-breakpoint
DROP TEMPORARY TABLE IF EXISTS `migration_0009_asr_task_canonical`;--> statement-breakpoint
CREATE TEMPORARY TABLE `migration_0009_asr_task_canonical` AS
SELECT
  mf.`asr_task_id`,
  SUBSTRING_INDEX(
    GROUP_CONCAT(mf.`id` ORDER BY mf.`created_at` DESC SEPARATOR ','),
    ',',
    1
  ) AS `canonical_id`
FROM `media_files` mf
WHERE mf.`asr_task_id` IS NOT NULL
GROUP BY mf.`asr_task_id`;--> statement-breakpoint
UPDATE `media_files` mf
INNER JOIN `migration_0009_asr_task_canonical` atc ON atc.`asr_task_id` = mf.`asr_task_id`
SET mf.`asr_task_id` = NULL
WHERE mf.`id` <> atc.`canonical_id`;--> statement-breakpoint
ALTER TABLE `media_files` ADD `transcript_kind` varchar(20);--> statement-breakpoint
ALTER TABLE `media_files` ADD `processing_stage` varchar(20);--> statement-breakpoint
ALTER TABLE `media_files` ADD `failure_stage` varchar(20);--> statement-breakpoint
ALTER TABLE `media_files` ADD `failure_reason` text;--> statement-breakpoint
ALTER TABLE `asset_chunks` ADD `asr_task_id` varchar(128);--> statement-breakpoint
UPDATE `asset_chunks` c
INNER JOIN `media_files` mf ON mf.`id` = c.`media_file_id`
SET c.`asr_task_id` = mf.`asr_task_id`;--> statement-breakpoint
UPDATE `media_files` mf
SET mf.`transcript_kind` = CASE
  WHEN mf.`asr_status` = 'skipped' THEN 'skipped'
  WHEN mf.`asr_status` = 'completed' AND EXISTS (SELECT 1 FROM `asset_chunks` c WHERE c.`media_file_id` = mf.`id`) THEN 'speech'
  WHEN mf.`asr_status` = 'completed' THEN 'empty'
  ELSE NULL
END;--> statement-breakpoint
UPDATE `media_files`
SET
  `status` = 'failed',
  `transcript_kind` = NULL,
  `failure_stage` = CASE
    WHEN `asr_status` = 'failed' THEN 'asr'
    WHEN `status` = 'error' THEN 'processing'
    ELSE 'processing'
  END,
  `failure_reason` = CASE
    WHEN `asr_status` = 'failed' THEN 'Migrated from legacy failed ASR state'
    WHEN `status` = 'error' THEN 'Migrated from legacy error state'
    ELSE 'Migrated from legacy unfinished processing state'
  END
WHERE `status` <> 'ready' OR `asr_status` IN ('pending', 'processing', 'failed');--> statement-breakpoint
UPDATE `media_files`
SET `status` = 'ready'
WHERE `status` = 'ready' AND `asr_status` IN ('completed', 'skipped');--> statement-breakpoint
ALTER TABLE `project_assets` DROP FOREIGN KEY `project_assets_media_file_id_media_files_id_fk`;--> statement-breakpoint
ALTER TABLE `project_assets` ADD CONSTRAINT `project_assets_media_file_id_media_files_id_fk` FOREIGN KEY (`media_file_id`) REFERENCES `media_files`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE `media_files` DROP FOREIGN KEY `media_files_user_id_users_id_fk`;--> statement-breakpoint
DROP INDEX `idx_media_files_user` ON `media_files`;--> statement-breakpoint
DROP INDEX `idx_media_files_user_hash` ON `media_files`;--> statement-breakpoint
ALTER TABLE `media_files` DROP COLUMN `user_id`;--> statement-breakpoint
ALTER TABLE `media_files` MODIFY COLUMN `file_size` bigint NOT NULL;--> statement-breakpoint
ALTER TABLE `media_files` MODIFY COLUMN `status` varchar(20) NOT NULL DEFAULT 'processing';--> statement-breakpoint
ALTER TABLE `media_files` DROP COLUMN `asr_status`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_files_file_hash_unique` ON `media_files` (`file_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_files_asr_task_id_unique` ON `media_files` (`asr_task_id`);--> statement-breakpoint
CREATE INDEX `idx_asset_chunks_asr_task_id` ON `asset_chunks` (`asr_task_id`);
