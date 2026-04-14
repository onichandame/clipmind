ALTER TABLE `assets` ADD `asr_task_id` varchar(128);--> statement-breakpoint
ALTER TABLE `assets` ADD `asr_status` varchar(20) DEFAULT 'pending';