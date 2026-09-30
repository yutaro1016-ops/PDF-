import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const books = sqliteTable("books", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  pageCount: integer("page_count").notNull().default(0),
  indexedPages: integer("indexed_pages").notNull().default(0),
  status: text("status").notNull().default("uploading"),
  uploadId: text("upload_id"),
  createdAt: text("created_at").notNull(),
  shelfId: text("shelf_id"),
  bookColor: text("book_color"),
  textColor: text("text_color"),
  bookDesign: text("book_design"),
  bookIcon: text("book_icon"),
  coverImage: text("cover_image"),
  bookOrder: integer("book_order").notNull().default(0),
  tags: text("tags").notNull().default("[]"),
  updatedAt: text("updated_at"),
  lastOpenedAt: text("last_opened_at"),
}, (table) => [index("idx_books_user_created").on(table.userId, table.createdAt)]);

export const shelves = sqliteTable("shelves", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  shelfOrder: integer("shelf_order").notNull().default(0),
  color: text("color").notNull().default("#e9edf0"),
  boardColor: text("board_color").notNull().default("#a8b7bd"),
  textColor: text("text_color").notNull().default("#172d43"),
  design: text("design").notNull().default("simple"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_shelves_user_order").on(table.userId, table.shelfOrder)]);

export const pages = sqliteTable("pages", {
  bookId: text("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  pageNumber: integer("page_number").notNull(),
  body: text("body").notNull(),
  normalized: text("normalized").notNull(),
}, (table) => [primaryKey({ columns: [table.bookId, table.pageNumber] })]);

export const shares = sqliteTable('shares', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  shelfJson: text('shelf_json'),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at'),
  revokedAt: text('revoked_at'),
}, table => [index('idx_shares_owner').on(table.userId, table.createdAt), index('idx_shares_token').on(table.tokenHash)]);
export const shareBooks = sqliteTable('share_books', {
  shareId: text('share_id').notNull().references(() => shares.id, {onDelete:'cascade'}),
  bookId: text('book_id').notNull(),
  position: integer('position').notNull(),
}, table => [primaryKey({columns:[table.shareId,table.bookId]})]);
export const importJobs = sqliteTable('import_jobs', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), shareId: text('share_id').notNull(),
  shelfId: text('shelf_id'), status: text('status').notNull().default('pending'),
  leaseToken: text('lease_token'), leaseUntil: integer('lease_until').notNull().default(0),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, table => [index('idx_import_jobs_owner_share').on(table.userId,table.shareId), uniqueIndex('idx_import_jobs_active').on(table.userId,table.shareId).where(sql`${table.status} = 'pending'`)]);
export const importItems = sqliteTable('import_items', {
  jobId: text('job_id').notNull().references(() => importJobs.id, {onDelete:'cascade'}),
  sourceId: text('source_id').notNull(), targetId: text('target_id').notNull(), position: integer('position').notNull(),
  metadata: text('metadata').notNull(), status: text('status').notNull().default('pending'),
  uploadId: text('upload_id'), parts: text('parts').notNull().default('[]'),
  pageCursor: integer('page_cursor').notNull().default(0),
}, table => [primaryKey({columns:[table.jobId,table.sourceId]})]);

// Empty by default. A lifecycle tombstone prevents concurrent new writes during closure.
export const accountLifecycle = sqliteTable('account_lifecycle', {
  userId: text('user_id').primaryKey(), status: text('status').notNull().default('active'),
  nonceHash: text('nonce_hash'), nonceExpires: integer('nonce_expires').notNull().default(0),
  jobId: text('job_id'), leaseToken: text('lease_token'), leaseUntil: integer('lease_until').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});
