CREATE TABLE `project_messages` (
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`role` varchar(20) NOT NULL,
	`content` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `updated_at` timestamp DEFAULT (now()) NOT NULL ON UPDATE CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE `project_messages` ADD CONSTRAINT `project_messages_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `basket_items` ADD CONSTRAINT `basket_items_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `basket_items` ADD CONSTRAINT `basket_items_asset_chunk_id_asset_chunks_id_fk` FOREIGN KEY (`asset_chunk_id`) REFERENCES `asset_chunks`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_outlines` ADD CONSTRAINT `project_outlines_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;