CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`file_name` text NOT NULL,
	`file_size` integer NOT NULL,
	`page_count` integer DEFAULT 0 NOT NULL,
	`indexed_pages` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'uploading' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_books_user_created` ON `books` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `pages` (
	`book_id` text NOT NULL,
	`page_number` integer NOT NULL,
	`body` text NOT NULL,
	`normalized` text NOT NULL,
	PRIMARY KEY(`book_id`, `page_number`),
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
