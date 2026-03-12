import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  title: text("title").notNull().default("Untitled Document"),
  content: text("content").notNull().default(""),
  fileType: text("file_type").notNull().default("md"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const fileTypeEnum = z.enum(["md", "json", "yaml"]);

export const insertDocumentSchema = createInsertSchema(documents).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
}).extend({
  fileType: fileTypeEnum
});

export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;

export type CreateDocumentRequest = InsertDocument;
export type UpdateDocumentRequest = Partial<InsertDocument>;

export type DocumentResponse = Document;
export type DocumentsListResponse = Document[];
