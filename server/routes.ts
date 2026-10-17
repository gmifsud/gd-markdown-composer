import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { registerFsRoutes } from "./fs-routes";
import { api } from "@shared/routes";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  registerFsRoutes(app);

  app.get(api.documents.list.path, async (req, res) => {
    const docs = await storage.getDocuments();
    res.json(docs);
  });

  app.get(api.documents.get.path, async (req, res) => {
    const doc = await storage.getDocument(Number(req.params.id));
    if (!doc) {
      return res.status(404).json({ message: "Document not found" });
    }
    res.json(doc);
  });

  app.post(api.documents.create.path, async (req, res) => {
    try {
      const input = api.documents.create.input.parse(req.body);
      const doc = await storage.createDocument(input);
      res.status(201).json(doc);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.put(api.documents.update.path, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const existingDoc = await storage.getDocument(id);
      if (!existingDoc) {
        return res.status(404).json({ message: "Document not found" });
      }

      const input = api.documents.update.input.parse(req.body);
      const doc = await storage.updateDocument(id, input);
      res.status(200).json(doc);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.delete(api.documents.delete.path, async (req, res) => {
    const id = Number(req.params.id);
    const existingDoc = await storage.getDocument(id);
    if (!existingDoc) {
      return res.status(404).json({ message: "Document not found" });
    }

    await storage.deleteDocument(id);
    res.status(204).send();
  });

  // Seed database
  try {
    const existingDocs = await storage.getDocuments();
    if (existingDocs.length === 0) {
      await storage.createDocument({
        title: "Welcome to Markdown Editor",
        fileType: "md",
        content: "# Welcome to Your Markdown Editor!\n\nThis is a simple, clean **Markdown Editor**. You can use it to write rich text content using the Markdown syntax.\n\n## Features\n\n- **Real-time Preview**: See how your markdown looks as you type.\n- **Document Management**: Create, edit, and delete documents using the sidebar.\n- **Auto-saving**: Keep your progress safe without hitting a save button.\n\n### Formatting Examples\n\nYou can format text in *italics* or **bold**.\n\n> Blockquotes are great for quotes.\n\n1. First item\n2. Second item\n3. Third item\n\n```js\n// Code blocks look great too\nconsole.log('Hello World!');\n```",
      });
      await storage.createDocument({
        title: "Project Ideas",
        fileType: "md",
        content: "## Cool Ideas\n\n- Build a markdown editor\n- Build a task manager\n- Learn Rust\n\n*Note: Need more ideas.*",
      });
      await storage.createDocument({
        title: "Config Example",
        fileType: "json",
        content: JSON.stringify({
          name: "My Project",
          version: "1.0.0",
          description: "A sample JSON configuration file",
          settings: {
            debug: true,
            timeout: 5000
          },
          features: ["auth", "api", "database"]
        }, null, 2),
      });
    }
  } catch (err) {
    console.error("Failed to seed database:", err);
  }

  return httpServer;
}