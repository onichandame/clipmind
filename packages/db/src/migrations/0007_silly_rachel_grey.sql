ALTER TABLE `assets` DROP FOREIGN KEY `assets_project_id_projects_id_fk`;
--> statement-breakpoint
ALTER TABLE `assets` DROP COLUMN `project_id`;