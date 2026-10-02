CREATE TABLE `account_lifecycle` (
	`user_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`nonce_hash` text,
	`nonce_expires` integer DEFAULT 0 NOT NULL,
	`job_id` text,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
