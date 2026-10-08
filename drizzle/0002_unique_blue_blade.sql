CREATE TABLE `brain_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload_hash` text NOT NULL,
	`status` text NOT NULL,
	`day_key` text NOT NULL,
	`created_at` text NOT NULL,
	`lease_until` text NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL,
	`result` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_brain_requests_user_day` ON `brain_requests` (`user_id`,`day_key`);--> statement-breakpoint
CREATE TABLE `project_brain_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`knowledge_id` text NOT NULL,
	`title` text NOT NULL,
	`brain_id` text NOT NULL,
	`source_id` text NOT NULL,
	`source_type` text NOT NULL,
	`external_reference` text NOT NULL,
	`content_hash` text NOT NULL,
	`request_id` text NOT NULL,
	`status` text NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`indexed_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_brain_sources_user_project` ON `project_brain_sources` (`user_id`,`project_id`);