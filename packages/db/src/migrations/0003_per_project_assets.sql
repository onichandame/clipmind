-- Migration: replace assets table with media_files + project_assets (per-project isolation + dedup by file hash)
-- The legacy-cleanup section is wrapped in a stored procedure to dynamically resolve
-- FK/index/column names from information_schema, so it survives schema variations
-- (e.g. databases originally bootstrapped via drizzle-kit push instead of migrations).

DROP PROCEDURE IF EXISTS `__mig_0003_cleanup`;
--> statement-breakpoint

CREATE PROCEDURE `__mig_0003_cleanup`()
BEGIN
    DECLARE v_fk VARCHAR(64) DEFAULT NULL;
    DECLARE v_col INT DEFAULT 0;
    DECLARE v_idx INT DEFAULT 0;

    -- Drop ANY FK on asset_chunks.asset_id (constraint name is variable)
    SELECT CONSTRAINT_NAME INTO v_fk
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'asset_chunks'
      AND COLUMN_NAME = 'asset_id'
      AND REFERENCED_TABLE_NAME IS NOT NULL
    LIMIT 1;
    IF v_fk IS NOT NULL THEN
        SET @sql = CONCAT('ALTER TABLE `asset_chunks` DROP FOREIGN KEY `', v_fk, '`');
        PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
    END IF;

    -- Drop legacy index on asset_chunks.asset_id (idempotent)
    SELECT COUNT(*) INTO v_idx
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'asset_chunks'
      AND INDEX_NAME = 'idx_asset_chunks_asset';
    IF v_idx > 0 THEN
        SET @sql = 'DROP INDEX `idx_asset_chunks_asset` ON `asset_chunks`';
        PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
    END IF;

    -- Drop legacy asset_id column (idempotent)
    SELECT COUNT(*) INTO v_col
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'asset_chunks'
      AND COLUMN_NAME = 'asset_id';
    IF v_col > 0 THEN
        SET @sql = 'ALTER TABLE `asset_chunks` DROP COLUMN `asset_id`';
        PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
    END IF;
END;
--> statement-breakpoint

CALL `__mig_0003_cleanup`();
--> statement-breakpoint

DROP PROCEDURE `__mig_0003_cleanup`;
--> statement-breakpoint

-- Drop legacy assets table (its FK from asset_chunks was removed by the procedure above)
DROP TABLE IF EXISTS `assets`;
--> statement-breakpoint

-- Create media_files (dedup unit keyed by userId + fileHash)
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

-- Create project_assets (per-project UI reference into media_files)
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

-- Add new media_file_id column to asset_chunks (replaces asset_id)
ALTER TABLE `asset_chunks` ADD `media_file_id` varchar(36) NOT NULL;
--> statement-breakpoint

-- Foreign keys
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

-- Indexes
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
