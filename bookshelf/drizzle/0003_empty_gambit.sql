CREATE TABLE `import_items` (
	`job_id` text NOT NULL,
	`source_id` text NOT NULL,
	`target_id` text NOT NULL,
	`position` integer NOT NULL,
	`metadata` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`upload_id` text,
	`parts` text DEFAULT '[]' NOT NULL,
	`page_cursor` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`job_id`, `source_id`),
	FOREIGN KEY (`job_id`) REFERENCES `import_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`share_id` text NOT NULL,
	`shelf_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_import_jobs_owner_share` ON `import_jobs` (`user_id`,`share_id`);--> statement-breakpoint
CREATE TABLE `share_books` (
	`share_id` text NOT NULL,
	`book_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`share_id`, `book_id`),
	FOREIGN KEY (`share_id`) REFERENCES `shares`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`shelf_json` text,
	`created_at` text NOT NULL,
	`expires_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_shares_owner` ON `shares` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_shares_token` ON `shares` (`token_hash`);