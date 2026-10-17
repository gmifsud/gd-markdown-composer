import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { navigate } from "wouter/use-browser-location";
import {
  api, buildUrl,
  type DocumentInput, type DocumentResponse, type DocumentUpdateInput, type DocumentsListResponse,
} from "@shared/routes";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { z } from "zod";

// Safe Zod parsing that falls back to raw data to prevent UI crashes 
// from minor type mismatches (like date strings vs objects)
function parseWithLogging<T>(schema: z.ZodSchema<T>, data: unknown, label: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(`[Zod] ${label} validation failed:`, result.error.format());
    return data as T;
  }
  return result.data;
}

export function useDocuments() {
  return useQuery({
    queryKey: [api.documents.list.path],
    queryFn: async () => {
      const res = await fetch(api.documents.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch documents");
      const data = await res.json();
      return parseWithLogging(api.documents.list.responses[200], data, "documents.list");
    }
  });
}

export function useDocument(id: number | null) {
  return useQuery({
    queryKey: [api.documents.get.path, id],
    queryFn: async () => {
      if (!id) return null;
      const url = buildUrl(api.documents.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch document");
      const data = await res.json();
      return parseWithLogging(api.documents.get.responses[200], data, "documents.get");
    },
    enabled: !!id
  });
}

export function useCreateDocument() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: (input: Partial<DocumentInput> = {}) => createDocument(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.documents.list.path] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create document", variant: "destructive" });
    }
  });
}

export class DocumentNotFoundError extends Error {
  constructor() {
    super("Document not found");
  }
}

/** Browsers cap in-flight keepalive request bodies at 64 KiB in total. */
export const KEEPALIVE_BODY_LIMIT = 60 * 1024;

export function encodedSize(body: string): number {
  return new TextEncoder().encode(body).length;
}

/**
 * Sends a document update. With `keepalive`, the request outlives the page
 * (for flushing on unload); callers must keep the body under KEEPALIVE_BODY_LIMIT.
 */
export async function saveDocument(
  id: number,
  updates: DocumentUpdateInput,
  options: { keepalive?: boolean } = {},
): Promise<DocumentResponse> {
  const res = await fetch(buildUrl(api.documents.update.path, { id }), {
    method: api.documents.update.method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
    credentials: "include",
    keepalive: options.keepalive,
  });
  if (res.status === 404) throw new DocumentNotFoundError();
  if (!res.ok) throw new Error("Failed to update document");
  const data = await res.json();
  return parseWithLogging(api.documents.update.responses[200], data, "documents.update");
}

/** Writes a saved document into the cache so reopening it never shows stale content. */
export function cacheSavedDocument(queryClient: QueryClient, doc: DocumentResponse) {
  queryClient.setQueryData([api.documents.get.path, doc.id], doc);
  queryClient.invalidateQueries({ queryKey: [api.documents.list.path] });
}

export function useUpdateDocument() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ id, ...updates }: { id: number } & DocumentUpdateInput) => saveDocument(id, updates),
    onSuccess: (data) => cacheSavedDocument(queryClient, data),
    onError: () => {
      toast({ title: "Error", description: "Failed to save document", variant: "destructive" });
    }
  });
}

async function createDocument(input: Partial<DocumentInput>): Promise<DocumentResponse> {
  const res = await fetch(api.documents.create.path, {
    method: api.documents.create.method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    credentials: "include"
  });
  if (!res.ok) throw new Error("Failed to create document");
  const data = await res.json();
  return parseWithLogging(api.documents.create.responses[201], data, "documents.create");
}

async function getDocumentSnapshot(queryClient: QueryClient, id: number): Promise<DocumentResponse | null> {
  const cached = queryClient.getQueryData<DocumentResponse | null>([api.documents.get.path, id]);
  if (cached) return cached;
  const listed = queryClient
    .getQueryData<DocumentsListResponse>([api.documents.list.path])
    ?.find(d => d.id === id);
  if (listed) return listed;
  const res = await fetch(buildUrl(api.documents.get.path, { id }), { credentials: "include" });
  return res.ok ? await res.json() : null;
}

/**
 * Deletes a document and shows a toast with an Undo action. Undo re-creates
 * the document (title, content, type) under a new id and opens it.
 */
export function useDeleteDocument() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const snapshot = await getDocumentSnapshot(queryClient, id);
      const url = buildUrl(api.documents.delete.path, { id });
      const res = await fetch(url, {
        method: api.documents.delete.method,
        credentials: "include"
      });
      if (res.status === 404) throw new Error("Document not found");
      if (!res.ok) throw new Error("Failed to delete document");
      return snapshot;
    },
    onSuccess: (snapshot, id) => {
      queryClient.removeQueries({ queryKey: [api.documents.get.path, id] });
      queryClient.invalidateQueries({ queryKey: [api.documents.list.path] });

      const title = snapshot?.title || "Untitled";
      const undo = async () => {
        if (!snapshot) return;
        try {
          const restored = await createDocument({
            title: snapshot.title,
            content: snapshot.content,
            fileType: snapshot.fileType as DocumentInput["fileType"],
          });
          queryClient.invalidateQueries({ queryKey: [api.documents.list.path] });
          navigate(`/d/${restored.id}`);
        } catch {
          toast({ title: "Error", description: `Could not restore "${title}"`, variant: "destructive" });
        }
      };

      toast({
        description: `Deleted "${title}".`,
        action: snapshot
          ? <ToastAction altText="Undo delete" onClick={undo}>Undo</ToastAction>
          : undefined,
      });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete document", variant: "destructive" });
    }
  });
}
