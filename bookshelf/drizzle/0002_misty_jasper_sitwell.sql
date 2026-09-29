CREATE TABLE `shelves` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`shelf_order` integer DEFAULT 0 NOT NULL,
	`color` text DEFAULT '#e9edf0' NOT NULL,
	`board_color` text DEFAULT '#a8b7bd' NOT NULL,
	`text_color` text DEFAULT '#172d43' NOT NULL,
	`design` text DEFAULT 'simple' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_shelves_user_order` ON `shelves` (`user_id`,`shelf_order`);--> statement-breakpoint
ALTER TABLE `books` ADD `shelf_id` text;--> statement-breakpoint
ALTER TABLE `books` ADD `book_color` text;--> statement-breakpoint
ALTER TABLE `books` ADD `text_color` text;--> statement-breakpoint
ALTER TABLE `books` ADD `book_design` text;--> statement-breakpoint
ALTER TABLE `books` ADD `book_icon` text;--> statement-breakpoint
ALTER TABLE `books` ADD `cover_image` text;--> statement-breakpoint
ALTER TABLE `books` ADD `book_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `books` ADD `tags` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `books` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `books` ADD `last_opened_at` text;