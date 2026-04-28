CREATE TABLE `asset_chunks` (
	`id` varchar(36) NOT NULL,
	`asset_id` varchar(36) NOT NULL,
	`start_time` int NOT NULL,
	`end_time` int NOT NULL,
	`transcript_text` text NOT NULL,
	CONSTRAINT `asset_chunks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`filename` varchar(255) NOT NULL,
	`local_path` varchar(1024),
	`origin_device_id` varchar(64),
	`video_oss_key` varchar(1024),
	`audio_oss_url` varchar(1024),
	`thumbnail_url` varchar(1024),
	`file_size` int NOT NULL,
	`duration` int,
	`status` varchar(20) DEFAULT 'processing',
	`asr_task_id` varchar(128),
	`asr_status` varchar(20) DEFAULT 'pending',
	`backup_status` varchar(20) NOT NULL DEFAULT 'local_only',
	`summary` text,
	`checksum` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `assets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `editing_plans` (
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`title` varchar(255) NOT NULL,
	`platform` varchar(100),
	`target_duration` int,
	`clips` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `editing_plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `hotspots` (
	`id` varchar(36) NOT NULL,
	`batch_id` varchar(36) NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`category` varchar(40) NOT NULL,
	`title` varchar(200) NOT NULL,
	`description` text NOT NULL,
	`source` varchar(20) NOT NULL,
	`source_urls` json NOT NULL,
	`heat_metric` varchar(50) NOT NULL,
	`heat_score` int NOT NULL,
	`rationale` text,
	`raw_context` json,
	`fetched_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `hotspots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `project_outlines` (
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`content_md` text NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	CONSTRAINT `project_outlines_id` PRIMARY KEY(`id`),
	CONSTRAINT `project_outlines_project_id_unique` UNIQUE(`project_id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`title` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`workflow_mode` varchar(20),
	`ui_messages` json DEFAULT ('[]'),
	`retrieved_clips` json DEFAULT ('[]'),
	`retrieved_asset_ids` json DEFAULT ('[]'),
	`selected_asset_ids` json DEFAULT ('[]'),
	`editing_plans` json DEFAULT ('[]'),
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`user_agent` varchar(255),
	`last_seen_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp NOT NULL,
	`revoked_at` timestamp,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sessions_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`email` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`email_verified_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `webhook_nonces` (
	`nonce` varchar(64) NOT NULL,
	`consumed_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `webhook_nonces_nonce` PRIMARY KEY(`nonce`)
);
--> statement-breakpoint
ALTER TABLE `asset_chunks` ADD CONSTRAINT `asset_chunks_asset_id_assets_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assets` ADD CONSTRAINT `assets_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `editing_plans` ADD CONSTRAINT `editing_plans_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_outlines` ADD CONSTRAINT `project_outlines_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_asset_chunks_asset` ON `asset_chunks` (`asset_id`);--> statement-breakpoint
CREATE INDEX `idx_assets_user` ON `assets` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_hotspots_active_category` ON `hotspots` (`is_active`,`category`,`heat_score`);--> statement-breakpoint
CREATE INDEX `idx_hotspots_batch` ON `hotspots` (`batch_id`);--> statement-breakpoint
CREATE INDEX `idx_projects_user` ON `projects` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_projects_user_updated` ON `projects` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user` ON `sessions` (`user_id`);