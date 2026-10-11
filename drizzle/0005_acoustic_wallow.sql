CREATE TABLE `project_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_operations_owner_project` ON `project_operations` (`user_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `project_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`person_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`window_start` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_shares_token` ON `project_shares` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_shares_person` ON `project_shares` (`user_id`,`project_id`,`person_id`);