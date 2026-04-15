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
ALTER TABLE `editing_plans` ADD CONSTRAINT `editing_plans_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;