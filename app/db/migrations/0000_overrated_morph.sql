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
	`filename` varchar(255) NOT NULL,
	`oss_url` varchar(1024) NOT NULL,
	`file_size` int NOT NULL,
	`status` varchar(20) DEFAULT 'processing',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `assets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `basket_items` (
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`asset_chunk_id` varchar(36) NOT NULL,
	`sort_rank` varchar(255) NOT NULL,
	`added_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `basket_items_id` PRIMARY KEY(`id`)
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
	`title` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
