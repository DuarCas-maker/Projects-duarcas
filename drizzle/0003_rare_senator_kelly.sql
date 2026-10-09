CREATE TABLE `knowledge_search` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`knowledge_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`normalized_content` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`indexed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_search_user` ON `knowledge_search` (`user_id`,`knowledge_id`);