import { type InsertDocument, type Document } from "@shared/schema";
import { db, documents, dbType } from "./db";
import { eq } from "drizzle-orm";

export interface IStorage {
  getDocuments(): Promise<Document[]>;
  getDocument(id: number): Promise<Document | undefined>;
  createDocument(doc: InsertDocument): Promise<Document>;
  updateDocument(id: number, doc: Partial<InsertDocument>): Promise<Document>;
  deleteDocument(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getDocuments(): Promise<Document[]> {
    return await db.select().from(documents).orderBy(documents.createdAt);
  }

  async getDocument(id: number): Promise<Document | undefined> {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    return doc;
  }

  async createDocument(insertDoc: InsertDocument): Promise<Document> {
    const [doc] = await db.insert(documents).values(insertDoc).returning();
    return doc;
  }

  async updateDocument(id: number, updateDoc: Partial<InsertDocument>): Promise<Document> {
    // SQLite stores dates as ISO strings; PostgreSQL uses Date objects
    const updatedAt = dbType === "sqlite" ? new Date().toISOString() : new Date();
    const [doc] = await db
      .update(documents)
      .set({ ...updateDoc, updatedAt } as any)
      .where(eq(documents.id, id))
      .returning();
    return doc as unknown as Document;
  }

  async deleteDocument(id: number): Promise<void> {
    await db.delete(documents).where(eq(documents.id, id));
  }
}

export const storage = new DatabaseStorage();