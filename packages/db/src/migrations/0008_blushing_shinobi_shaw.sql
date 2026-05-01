ALTER TABLE `media_files` ADD `video_oss_key` varchar(1024);--> statement-breakpoint
ALTER TABLE `media_files` ADD `backup_status` varchar(20) DEFAULT 'local_only' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_assets` DROP COLUMN `video_oss_key`;--> statement-breakpoint
ALTER TABLE `project_assets` DROP COLUMN `backup_status`;