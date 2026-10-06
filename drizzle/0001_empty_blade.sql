CREATE TABLE `ai_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`scope` text NOT NULL,
	`kind` text NOT NULL,
	`query` text NOT NULL,
	`result` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`day_key` text NOT NULL,
	`created_at` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ai_runs_user_day` ON `ai_runs` (`user_id`,`day_key`);--> statement-breakpoint
CREATE INDEX `idx_ai_runs_user_scope_created` ON `ai_runs` (`user_id`,`scope`,`created_at`);