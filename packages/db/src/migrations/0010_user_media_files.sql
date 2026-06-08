CREATE TABLE `user_media_files` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`media_file_id` varchar(36) NOT NULL,
	`filename` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_media_files_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_media_files_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
	CONSTRAINT `user_media_files_media_file_id_media_files_id_fk` FOREIGN KEY (`media_file_id`) REFERENCES `media_files`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION
);--> statement-breakpoint
INSERT INTO `user_media_files` (`id`, `user_id`, `media_file_id`, `filename`, `created_at`)
SELECT
  UUID(),
  pa.`user_id`,
  pa.`media_file_id`,
  SUBSTRING_INDEX(GROUP_CONCAT(pa.`filename` ORDER BY pa.`created_at` ASC SEPARATOR '\n'), '\n', 1),
  MIN(pa.`created_at`)
FROM `project_assets` pa
GROUP BY pa.`user_id`, pa.`media_file_id`;--> statement-breakpoint
ALTER TABLE `project_assets` ADD `user_media_file_id` varchar(36);--> statement-breakpoint
UPDATE `project_assets` pa
INNER JOIN `user_media_files` umf
  ON umf.`user_id` = pa.`user_id`
  AND umf.`media_file_id` = pa.`media_file_id`
SET pa.`user_media_file_id` = umf.`id`;--> statement-breakpoint
ALTER TABLE `project_assets` MODIFY COLUMN `user_media_file_id` varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `project_assets` DROP FOREIGN KEY `project_assets_media_file_id_media_files_id_fk`;--> statement-breakpoint
DROP INDEX `idx_project_assets_media_file` ON `project_assets`;--> statement-breakpoint
ALTER TABLE `project_assets` DROP COLUMN `media_file_id`;--> statement-breakpoint
CREATE INDEX `idx_user_media_files_user` ON `user_media_files` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_user_media_files_media_file` ON `user_media_files` (`media_file_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_media_files_user_media_unique` ON `user_media_files` (`user_id`,`media_file_id`);--> statement-breakpoint
CREATE INDEX `idx_project_assets_user_media_file` ON `project_assets` (`user_media_file_id`);--> statement-breakpoint
ALTER TABLE `project_assets` ADD CONSTRAINT `project_assets_user_media_file_id_user_media_files_id_fk` FOREIGN KEY (`user_media_file_id`) REFERENCES `user_media_files`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;
