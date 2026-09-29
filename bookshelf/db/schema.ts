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
