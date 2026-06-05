ALTER TABLE `media_files` ADD `video_oss_key` varchar(1024);--> statement-breakpoint
ALTER TABLE `media_files` ADD `backup_status` varchar(20) DEFAULT 'local_only' NOT NULL;--> statement-breakpoint
UPDATE `media_files` mf
INNER JOIN `project_assets` pa ON pa.`media_file_id` = mf.`id`
SET
  mf.`video_oss_key` = COALESCE(mf.`video_oss_key`, pa.`video_oss_key`),
  mf.`backup_status` = CASE WHEN pa.`video_oss_key` IS NOT NULL THEN 'failed' ELSE mf.`backup_status` END
WHERE pa.`video_oss_key` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `project_assets` DROP COLUMN `video_oss_key`;--> statement-breakpoint
ALTER TABLE `project_assets` DROP COLUMN `backup_status`;
