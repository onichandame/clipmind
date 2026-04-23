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
CREATE INDEX `idx_hotspots_active_category` ON `hotspots` (`is_active`,`category`,`heat_score`);--> statement-breakpoint
CREATE INDEX `idx_hotspots_batch` ON `hotspots` (`batch_id`);