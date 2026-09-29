import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
}, (table) => [index("idx_books_user_created").on(table.userId, table.createdAt)]);

export const pages = sqliteTable("pages", {
  bookId: text("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  pageNumber: integer("page_number").notNull(),
  body: text("body").notNull(),
  normalized: text("normalized").notNull(),
}, (table) => [primaryKey({ columns: [table.bookId, table.pageNumber] })]);
