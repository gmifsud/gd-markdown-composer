import { useMemo, useRef, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, FileWarning, Loader2 } from "lucide-react";
import { Editor, type EditorSource } from "@/components/editor/editor";
import { ImageFileView } from "@/components/editor/image-view";
import { Button } from "@/components/ui/button";
import { useDocument, saveDocument, cacheSavedDocument } from "@/hooks/use-documents";
import type { Saver } from "@/hooks/use-autosave";
import { fsApi, fsKeys, baseName, copyText, FsNotFoundError } from "@/lib/fs-api";
import { dbUri, useWorkspaceActions } from "@/lib/workspace";
import { isUnlocked, markUnlocked } from "@/lib/unlocked-files";
import { fileKindOf, opensEditable, type FsReadResponse } from "@shared/fs";

function Loading({ label }: { label: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center space-y-4">
      <Loader2 className="w-8 h-8 animate-spin text-gray-300" />
      <p className="text-sm text-gray-400 font-medium">{label}</p>
    </div>
  );
}

function Message({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-gray-50/50">
      <div className="w-16 h-16 bg-white shadow-sm rounded-2xl flex items-center justify-center border border-gray-100 mb-4 text-gray-400">
        {icon}
      </div>
      <h2 className="text-lg font-semibold mb-1 text-gray-900 tracking-tight">{title}</h2>
      <div className="text-gray-500 text-sm max-w-md break-words">{children}</div>
    </div>
  );
}

// ── Database documents ───────────────────────────────────────────────────────

export function DocumentEditor({ id }: { id: number }) {
  const { data: doc, isLoading } = useDocument(id);
  const queryClient = useQueryClient();

  const source = useMemo<EditorSource | null>(() => {
    if (!doc) return null;
    const save: Saver = async (snapshot, { keepalive }) => {
      const saved = await saveDocument(id, snapshot, { keepalive });
      cacheSavedDocument(queryClient, saved);
    };
    return {
      uri: dbUri(id),
      title: doc.title || "",
      titleEditable: true,
      fileType: (doc.fileType as EditorSource["fileType"]) ?? "md",
      content: doc.content || "",
      save,
    };
    // Built once per document: the editor keeps its own state after mounting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);

  if (isLoading) return <Loading label="Loading document..." />;
  if (!source) {
    return (
      <Message icon={<FileText className="w-8 h-8" />} title="Document Not Found">
        The document you're looking for doesn't exist or was deleted.
      </Message>
    );
  }
  return <Editor source={source} />;
}

// ── Files on disk ────────────────────────────────────────────────────────────

export function FileEditor({ path, uri }: { path: string; uri: string }) {
  return fileKindOf(path) === "image" ? <ImageFileView path={path} /> : <TextFileEditor path={path} uri={uri} />;
}

function TextFileEditor({ path, uri }: { path: string; uri: string }) {
  const queryClient = useQueryClient();
  const { close } = useWorkspaceActions();
  // Always read fresh from disk when a file tab is shown again.
  const { data, isLoading, error } = useQuery({
    queryKey: fsKeys.file(path),
    queryFn: () => fsApi.read(path),
    staleTime: 0,
    gcTime: 0,
  });

  const mtime = useRef<number | null>(null);

  const source = useMemo<EditorSource | null>(() => {
    if (!data || data.content === null) return null;
    mtime.current = data.mtimeMs;
    const kind = fileKindOf(path) as EditorSource["fileType"];
    const save: Saver = async (snapshot, { keepalive, force }) => {
      const res = await fsApi.write(
        { path, content: snapshot.content, expectedMtimeMs: force ? undefined : mtime.current ?? undefined },
        { keepalive },
      );
      mtime.current = res.mtimeMs;
      queryClient.setQueryData<FsReadResponse>(fsKeys.file(path), prev =>
        prev ? { ...prev, content: snapshot.content, mtimeMs: res.mtimeMs, size: res.size } : prev);
    };
    return {
      uri,
      title: baseName(path),
      titleEditable: false,
      fileType: kind,
      content: data.content,
      path,
      save,
      // Markdown/JSON/YAML open ready to edit; anything else needs a click on Edit first.
      startLocked: !opensEditable(kind) && !isUnlocked(path),
      onUnlock: () => markUnlocked(path),
    };
    // Built once per loaded file: the editor keeps its own state after mounting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, data !== undefined]);

  if (isLoading) return <Loading label="Opening file..." />;

  if (error || !data) {
    const missing = error instanceof FsNotFoundError;
    return (
      <Message icon={<FileWarning className="w-8 h-8" />} title={missing ? "File Not Found" : "Couldn't Open File"}>
        <p className="mb-4">{missing ? path : (error as Error)?.message ?? path}</p>
        <Button size="sm" variant="secondary" onClick={() => close([uri])}>Close tab</Button>
      </Message>
    );
  }

  if (!source) {
    return (
      <Message
        icon={<FileWarning className="w-8 h-8" />}
        title={data.reason === "too-large" ? "File Too Large" : "Binary File"}
      >
        <p className="mb-4">
          {data.reason === "too-large"
            ? `${baseName(path)} is ${(data.size / 1024 / 1024).toFixed(1)} MB, larger than the 20 MB the editor opens.`
            : `${baseName(path)} isn't a text file, so it can't be shown here.`}
        </p>
        <Button size="sm" variant="secondary" onClick={() => void copyText(path)}>Copy path</Button>
      </Message>
    );
  }

  return <Editor source={source} />;
}
