ALTER TABLE `project_messages` ADD `message` json NOT NULL;--> statement-breakpoint
ALTER TABLE `project_messages` DROP COLUMN `role`;--> statement-breakpoint
ALTER TABLE `project_messages` DROP COLUMN `content`;--> statement-breakpoint
ALTER TABLE `project_messages` DROP COLUMN `tool_invocations`;