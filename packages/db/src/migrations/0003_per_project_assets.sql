-- Migration: replace assets table with media_files + project_assets (per-project isolation + dedup by file hash)
-- Wrapped in a stored procedure so every DDL is idempotent — required because:
--   1. MySQL auto-commits DDL even inside Drizzle's wrapping transaction, so a
--      mid-migration failure can leave a partial state that retry must tolerate.
--   2. Pre-existing FK names may differ between drizzle-kit-generate and
--      drizzle-kit-push installations.
-- The procedure checks information_schema before every change and is dropped
-- on completion, leaving no lingering schema artifact.

DROP PROCEDURE IF EXISTS `__mig_0003`;
--> statement-breakpoint

CREATE PROCEDURE `__mig_0003`()
BEGIN
    DECLARE v_fk VARCHAR(64) DEFAULT NULL;
    DECLARE v_count INT DEFAULT 0;

    -- ===== 1. Legacy cleanup (asset_chunks.asset_id + assets table) =====

    -- Drop FK on asset_chunks.asset_id (constraint name is variable across deployments)
    SET v_fk = NULL;
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

    -- Drop legacy index on asset_chunks.asset_id
    SELECT COUNT(*) INTO v_count FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asset_chunks' AND INDEX_NAME = 'idx_asset_chunks_asset';
    IF v_count > 0 THEN
        ALTER TABLE `asset_chunks` DROP INDEX `idx_asset_chunks_asset`;
    END IF;

    -- Drop legacy asset_id column
    SELECT COUNT(*) INTO v_count FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asset_chunks' AND COLUMN_NAME = 'asset_id';
    IF v_count > 0 THEN
        ALTER TABLE `asset_chunks` DROP COLUMN `asset_id`;
    END IF;

    -- Drop legacy assets table
    DROP TABLE IF EXISTS `assets`;

    -- ===== 2. Create new tables (idempotent) =====

    CREATE TABLE IF NOT EXISTS `media_files` (
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

    CREATE TABLE IF NOT EXISTS `project_assets` (
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

    -- ===== 3. Add media_file_id column to asset_chunks (idempotent) =====

    SELECT COUNT(*) INTO v_count FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asset_chunks' AND COLUMN_NAME = 'media_file_id';
    IF v_count = 0 THEN
        ALTER TABLE `asset_chunks` ADD `media_file_id` varchar(36) NOT NULL;
    END IF;

    -- ===== 4. Foreign keys (idempotent via information_schema lookup) =====

    SELECT COUNT(*) INTO v_count FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_files' AND CONSTRAINT_NAME = 'media_files_user_id_users_id_fk';
    IF v_count = 0 THEN
        ALTER TABLE `media_files` ADD CONSTRAINT `media_files_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade;
    END IF;

    SELECT COUNT(*) INTO v_count FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_assets' AND CONSTRAINT_NAME = 'project_assets_project_id_projects_id_fk';
    IF v_count = 0 THEN
        ALTER TABLE `project_assets` ADD CONSTRAINT `project_assets_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade;
    END IF;

    SELECT COUNT(*) INTO v_count FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_assets' AND CONSTRAINT_NAME = 'project_assets_user_id_users_id_fk';
    IF v_count = 0 THEN
        ALTER TABLE `project_assets` ADD CONSTRAINT `project_assets_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade;
    END IF;

    SELECT COUNT(*) INTO v_count FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_assets' AND CONSTRAINT_NAME = 'project_assets_media_file_id_media_files_id_fk';
    IF v_count = 0 THEN
        ALTER TABLE `project_assets` ADD CONSTRAINT `project_assets_media_file_id_media_files_id_fk` FOREIGN KEY (`media_file_id`) REFERENCES `media_files`(`id`) ON DELETE cascade;
    END IF;

    SELECT COUNT(*) INTO v_count FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asset_chunks' AND CONSTRAINT_NAME = 'asset_chunks_media_file_id_media_files_id_fk';
    IF v_count = 0 THEN
        -- Pre-existing chunks reference the dropped `assets` table and were left
        -- with empty `media_file_id` after ADD COLUMN. They're orphaned; clear
        -- them before the FK is enforced so the FK creation can succeed. The
        -- corresponding Qdrant vectors are dead under the new schema anyway —
        -- users will need to re-import media files.
        TRUNCATE TABLE `asset_chunks`;
        ALTER TABLE `asset_chunks` ADD CONSTRAINT `asset_chunks_media_file_id_media_files_id_fk` FOREIGN KEY (`media_file_id`) REFERENCES `media_files`(`id`) ON DELETE cascade;
    END IF;

    -- ===== 5. Indexes (idempotent) =====

    SELECT COUNT(*) INTO v_count FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_files' AND INDEX_NAME = 'idx_media_files_user';
    IF v_count = 0 THEN CREATE INDEX `idx_media_files_user` ON `media_files` (`user_id`); END IF;

    SELECT COUNT(*) INTO v_count FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_files' AND INDEX_NAME = 'idx_media_files_user_hash';
    IF v_count = 0 THEN CREATE INDEX `idx_media_files_user_hash` ON `media_files` (`user_id`,`file_hash`); END IF;

    SELECT COUNT(*) INTO v_count FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_assets' AND INDEX_NAME = 'idx_project_assets_project';
    IF v_count = 0 THEN CREATE INDEX `idx_project_assets_project` ON `project_assets` (`project_id`); END IF;

    SELECT COUNT(*) INTO v_count FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_assets' AND INDEX_NAME = 'idx_project_assets_user';
    IF v_count = 0 THEN CREATE INDEX `idx_project_assets_user` ON `project_assets` (`user_id`); END IF;

    SELECT COUNT(*) INTO v_count FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_assets' AND INDEX_NAME = 'idx_project_assets_media_file';
    IF v_count = 0 THEN CREATE INDEX `idx_project_assets_media_file` ON `project_assets` (`media_file_id`); END IF;

    SELECT COUNT(*) INTO v_count FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asset_chunks' AND INDEX_NAME = 'idx_asset_chunks_media_file';
    IF v_count = 0 THEN CREATE INDEX `idx_asset_chunks_media_file` ON `asset_chunks` (`media_file_id`); END IF;
END;
--> statement-breakpoint

CALL `__mig_0003`();
--> statement-breakpoint

DROP PROCEDURE `__mig_0003`;
