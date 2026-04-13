ALTER TABLE `assets` ADD `project_id` varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `audio_oss_url` varchar(1024);--> statement-breakpoint
ALTER TABLE `assets` ADD CONSTRAINT `assets_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;