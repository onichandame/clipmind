ALTER TABLE `projects` ADD `title_initialized` boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `projects` SET `title_initialized` = true;
