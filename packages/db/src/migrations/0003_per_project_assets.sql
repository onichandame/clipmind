-- Migration: replace assets table with media_files + project_assets (per-project isolation + dedup by file hash)

-- 1. Drop FK on asset_chunks that pointed to assets
ALTER TABLE `asset_chunks` DROP FOREIGN KEY `asset_chunks_asset_id_assets_id_fk`;
--> statement-breakpoint

-- 2. Drop old index on asset_chunks.asset_id
DROP INDEX `idx_asset_chunks_asset` ON `asset_chunks`;
--> statement-breakpoint

-- 3. Remove old asset_id column from asset_chunks
ALTER TABLE `asset_chunks` DROP COLUMN `asset_id`;
--> statement-breakpoint

-- 4. Drop legacy assets table (cascade-delete its own FK to users is already in DB)
DROP TABLE `assets`;
--> statement-breakpoint

-- 5. Create media_files (dedup unit keyed by userId + fileHash)
CREATE TABLE `media_files` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`file_hash` varchar(64) NOT NULL,
	`audio_oss_key` varchar(1024),
	`thumbnail_oss_key` varchar(1024),
	`file_size` int NOT NULL,
	`duration` int,
	`status` varchar(20) DEFAULT 'processing',
	`asr_task_id` varchar(128),
	`asr_status` varchar(20) DEFAULT 'pending',
	`summary` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `media_files_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint

-- 6. Create project_assets (per-project UI reference into media_files)
CREATE TABLE `project_assets` (
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`media_file_id` varchar(36) NOT NULL,
	`filename` varchar(255) NOT NULL,
	`local_path` varchar(1024),
	`origin_device_id` varchar(64),
	`video_oss_key` varchar(1024),
	`backup_status` varchar(20) NOT NULL DEFAULT 'local_only',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_assets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint

-- 7. Add media_file_id column to asset_chunks (replaces asset_id)
ALTER TABLE `asset_chunks` ADD `media_file_id` varchar(36) NOT NULL;
--> statement-breakpoint

-- 8. Foreign key constraints
ALTER TABLE `media_files` ADD CONSTRAINT `media_files_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `project_assets` ADD CONSTRAINT `project_assets_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `project_assets` ADD CONSTRAINT `project_assets_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `project_assets` ADD CONSTRAINT `project_assets_media_file_id_media_files_id_fk` FOREIGN KEY (`media_file_id`) REFERENCES `media_files`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `asset_chunks` ADD CONSTRAINT `asset_chunks_media_file_id_media_files_id_fk` FOREIGN KEY (`media_file_id`) REFERENCES `media_files`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- 9. Indexes
CREATE INDEX `idx_media_files_user` ON `media_files` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_media_files_user_hash` ON `media_files` (`user_id`,`file_hash`);
--> statement-breakpoint
CREATE INDEX `idx_project_assets_project` ON `project_assets` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_project_assets_user` ON `project_assets` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_project_assets_media_file` ON `project_assets` (`media_file_id`);
--> statement-breakpoint
CREATE INDEX `idx_asset_chunks_media_file` ON `asset_chunks` (`media_file_id`);
