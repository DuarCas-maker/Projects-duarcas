CREATE TABLE `ai_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text,
	`suggestion_type` text NOT NULL,
	`title` text NOT NULL,
	`reason` text NOT NULL,
	`confidence` integer DEFAULT 70 NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`impact` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_suggestions_user_status` ON `ai_suggestions` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `calendar_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text,
	`title` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_calendar_user_start` ON `calendar_blocks` (`user_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `inbox_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`content` text NOT NULL,
	`input_type` text DEFAULT 'text' NOT NULL,
	`detected_project_id` text,
	`classification` text DEFAULT 'Sin clasificar' NOT NULL,
	`status` text DEFAULT 'unprocessed' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`detected_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_inbox_user_status` ON `inbox_items` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `knowledge_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`item_type` text NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`source_reference` text,
	`storage_key` text,
	`processing_status` text DEFAULT 'ready' NOT NULL,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_project` ON `knowledge_items` (`user_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`target_date` text,
	`completed_at` text,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_milestones_project` ON `milestones` (`user_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `project_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`event_type` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`source_type` text DEFAULT 'manual' NOT NULL,
	`source_id` text,
	`event_date` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_events_project_date` ON `project_events` (`user_id`,`project_id`,`event_date`);--> statement-breakpoint
CREATE TABLE `project_financials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`total_value` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'COP' NOT NULL,
	`payment_status` text DEFAULT 'not_applicable' NOT NULL,
	`amount_paid` integer DEFAULT 0 NOT NULL,
	`amount_pending` integer DEFAULT 0 NOT NULL,
	`payment_structure` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`short_code` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`project_type` text NOT NULL,
	`operational_status` text NOT NULL,
	`commercial_status` text NOT NULL,
	`priority` integer DEFAULT 3 NOT NULL,
	`strategic_priority` integer DEFAULT 3 NOT NULL,
	`target_end_date` text,
	`current_summary` text DEFAULT '' NOT NULL,
	`next_step_summary` text DEFAULT '' NOT NULL,
	`blocked_reason` text,
	`accent` text DEFAULT 'lime' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_projects_user_status` ON `projects` (`user_id`,`operational_status`);--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`provider` text DEFAULT 'github' NOT NULL,
	`owner` text NOT NULL,
	`repo` text NOT NULL,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`last_sync` text,
	`status` text DEFAULT 'disconnected' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task_dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`task_id` text NOT NULL,
	`depends_on_task_id` text NOT NULL,
	`dependency_type` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`depends_on_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_dependencies_task` ON `task_dependencies` (`user_id`,`task_id`);--> statement-breakpoint
CREATE TABLE `task_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`task_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_reference` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`milestone_id` text,
	`parent_task_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 3 NOT NULL,
	`urgency` integer DEFAULT 3 NOT NULL,
	`estimated_minutes` integer DEFAULT 30 NOT NULL,
	`deadline` text,
	`scheduled_start` text,
	`scheduled_end` text,
	`is_blocked` integer DEFAULT false NOT NULL,
	`blocking_reason` text,
	`source_type` text DEFAULT 'manual' NOT NULL,
	`source_id` text,
	`ai_generated` integer DEFAULT false NOT NULL,
	`approved` integer DEFAULT true NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_user_status_deadline` ON `tasks` (`user_id`,`status`,`deadline`);--> statement-breakpoint
CREATE INDEX `idx_tasks_project_status` ON `tasks` (`project_id`,`status`);--> statement-breakpoint
PRAGMA optimize;
