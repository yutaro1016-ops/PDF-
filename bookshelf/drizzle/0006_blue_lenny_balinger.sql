CREATE TABLE `storage_operations` (
	`user_id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` text NOT NULL
);
