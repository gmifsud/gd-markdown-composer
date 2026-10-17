import { useState, useMemo, useRef, useEffect } from "react";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import { parseAllDocuments } from "yaml";
import { Check, Loader2, Save, Download, CheckCircle2, AlertCircle, Zap, Lock, LockOpen, PenLine, Columns2, Eye, MoveHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { MarkdownPreview } from "@/components/editor/markdown-preview";
import { DrawioFileView } from "@/components/editor/diagrams";
import { useAutosave, type Saver } from "@/hooks/use-autosave";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace, useWorkspaceActions, type EditorMode } from "@/lib/workspace";
import { clearActiveEditor, publishActiveEditor, registerRevealHandler } from "@/lib/active-editor";
import {
  lineRange, occurrencesBefore, revealHeadingInPreview, revealInTextarea, revealTextInPreview,
} from "@/components/editor/reveal";

/** What the editor shows and how it saves: a database document or a file on disk. */
export interface EditorSource {
  /** Tab URI (db:<id> or file:<path>), used by the Outline and search to jump here. */
  uri: string;
  title: string;
  /** Database documents can be renamed from the header; files can't (yet). */
  titleEditable: boolean;
  /** "drawio" renders the diagram; "text" is any other text file, shown without a preview. */
  fileType: "md" | "json" | "yaml" | "drawio" | "text";
  /** Open read-only with an Edit button (other text files and diagrams). */
  startLocked?: boolean;
  /** Called when the user unlocks a locked source for editing. */
  onUnlock?(): void;
  content: string;
  /** Absolute path, for files on disk. */
  path?: string;
  /** Persists edits; omitted for read-only sources. */
  save?: Saver;
}

interface EditorProps {
  source: EditorSource;
}

interface Analysis {
  /** Error message, or null when the text parses. */
  error: string | null;
  /** Formatted text; empty when the input is empty or invalid. */
  formatted: string;
}

const EMPTY_ANALYSIS: Analysis = { error: null, formatted: "" };

function analyzeJson(text: string): Analysis {
  if (!text.trim()) return EMPTY_ANALYSIS;
  try {
    return { error: null, formatted: JSON.stringify(JSON.parse(text), null, 2) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid JSON", formatted: "" };
  }
}

function analyzeYaml(text: string): Analysis {
  if (!text.trim()) return EMPTY_ANALYSIS;
  // parseAllDocuments handles multi-document files (separated by ---) and
  // keeps comments, so formatting only normalises indentation and spacing.
  const parsed = parseAllDocuments(text);
  const docs = Array.isArray(parsed) ? parsed : [parsed];
  const error = docs.flatMap(doc => doc.errors)[0];
  if (error) {
    return { error: error.message.split("\n")[0].replace(/:$/, ""), formatted: "" };
  }
  return {
    error: null,
    formatted: docs.map(doc => doc.toString({ indent: 2, lineWidth: 0 })).join(""),
  };
}

const DOWNLOAD_TYPES = {
  md: { ext: ".md", mime: "text/markdown" },
  json: { ext: ".json", mime: "application/json" },
  yaml: { ext: ".yaml", mime: "application/yaml" },
} as const;

const noopSave: Saver = async () => {};

const MODES: { mode: EditorMode; label: string; icon: JSX.Element }[] = [
  { mode: "edit", label: "Edit only", icon: <PenLine className="w-3.5 h-3.5" /> },
  { mode: "split", label: "Edit and preview side by side", icon: <Columns2 className="w-3.5 h-3.5" /> },
  { mode: "preview", label: "Preview only", icon: <Eye className="w-3.5 h-3.5" /> },
];

/** Segmented control for the editor layout; the choice applies to every document. */
function ModeSwitch({ mode, onChange }: { mode: EditorMode; onChange(mode: EditorMode): void }) {
  return (
    <div className="hidden sm:flex items-center rounded-full bg-gray-100 p-0.5" role="radiogroup" aria-label="Editor layout">
      {MODES.map(m => (
        <button
          key={m.mode}
          role="radio"
          aria-checked={mode === m.mode}
          title={m.label}
          onClick={() => onChange(m.mode)}
          className={`flex items-center justify-center w-8 h-7 rounded-full transition-colors ${
            mode === m.mode ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-800"
          }`}
          data-testid={`mode-${m.mode}`}
        >
          {m.icon}
        </button>
      ))}
    </div>
  );
}

/** Mount with a `key` per document: state is initialised from the source once. */
export function Editor({ source }: EditorProps) {
  const [content, setContent] = useState(source.content);
  const [title, setTitle] = useState(source.title);
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const { state: workspace } = useWorkspace();
  const { setEditorMode, setDiagramMode, setPreviewFullWidth } = useWorkspaceActions();
  const isDrawio = source.fileType === "drawio";
  const mode = isDrawio ? workspace.diagramMode : workspace.editorMode;
  const setMode = isDrawio ? setDiagramMode : setEditorMode;
  const fullWidth = workspace.previewFullWidth;
  const splitGroup = useRef<ImperativePanelGroupHandle>(null);

  const [locked, setLocked] = useState(!!source.startLocked);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  // Share the live text with the Outline panel.
  useEffect(() => {
    publishActiveEditor({ uri: source.uri, fileType: source.fileType, title, content });
  }, [source.uri, source.fileType, title, content]);
  useEffect(() => () => clearActiveEditor(source.uri), [source.uri]);

  // Jumps from the Outline and search results: select the line in the source
  // (when shown) and scroll the preview to the heading or matching text.
  useEffect(() => registerRevealHandler(source.uri, (target) => {
    const text = contentRef.current;
    if (textareaRef.current) revealInTextarea(textareaRef.current, lineRange(text, target.line, target.query));
    const preview = previewScrollRef.current?.querySelector<HTMLElement>("[data-preview-root]")
      ? previewScrollRef.current
      : null;
    if (!preview) return;
    if (target.heading) revealHeadingInPreview(preview, target.heading.text, target.heading.occurrence);
    else if (target.query) {
      revealTextInPreview(preview, target.query, occurrencesBefore(text, target.line, target.query), !textareaRef.current);
    }
  }), [source.uri]);
  const readOnly = !source.save || locked;
  const unlock = () => {
    setLocked(false);
    source.onUnlock?.();
  };
  const isPlainText = source.fileType === "text";
  const isJson = source.fileType === "json";
  const isYaml = source.fileType === "yaml";
  const isStructured = isJson || isYaml;
  const formatLabel = isJson ? "JSON" : "YAML";

  const { status, flush } = useAutosave(
    { content, title },
    { content: source.content, title: source.title },
    source.save ?? noopSave,
    { enabled: !readOnly },
  );

  const analysis = useMemo(
    () => (isJson ? analyzeJson(content) : isYaml ? analyzeYaml(content) : EMPTY_ANALYSIS),
    [isJson, isYaml, content],
  );

  const handleFormat = () => {
    if (analysis.error) {
      toast({ description: `Cannot format invalid ${formatLabel}`, variant: "destructive" });
      return;
    }
    if (!analysis.formatted) return;
    setContent(analysis.formatted);
    toast({ description: `${formatLabel} formatted successfully` });
  };

  const handleSaveAs = () => {
    try {
      const known = DOWNLOAD_TYPES[source.fileType as keyof typeof DOWNLOAD_TYPES];
      // Files keep their own name and extension; database documents get one from their type.
      const { ext, mime } = source.path || !known ? { ext: "", mime: known?.mime ?? "text/plain" } : known;
      const filename = (title.trim() || "document").replace(/[\\/:*?"<>|]/g, "_");
      // A Blob URL works for any size; data: URIs fail for large files.
      const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
      const element = window.document.createElement("a");
      element.href = url;
      element.download = `${filename}${ext}`;
      element.style.display = "none";
      window.document.body.appendChild(element);
      element.click();
      window.document.body.removeChild(element);
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast({ description: `Downloaded "${filename}${ext}"` });
    } catch (err) {
      toast({
        description: "Failed to download file",
        variant: "destructive"
      });
    }
  };

  const placeholder = isJson ? "Start writing JSON..." : isYaml ? "Start writing YAML..." : "Start writing...";

  const structuredPreview = (
    <div className={`font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-words ${
      analysis.error ? "text-red-600" : "text-gray-700"
    }`}>
      {analysis.error ? (
        <div className="text-red-600">
          <div className="font-bold mb-2">{formatLabel} Error:</div>
          <div className="text-sm">{analysis.error}</div>
        </div>
      ) : analysis.formatted ? (
        analysis.formatted
      ) : (
        <span className="text-gray-400">Formatted {formatLabel} will appear here</span>
      )}
    </div>
  );

  const sourcePane = (
    <div className="flex-1 h-full flex flex-col min-h-0 min-w-0" data-testid="source-pane">
      <div className="h-10 border-b border-gray-50 flex items-center px-6 bg-[#fcfcfc] shrink-0 text-[10px] font-semibold tracking-widest text-gray-400 uppercase">
        {isStructured ? formatLabel : isDrawio ? "Draw.io XML" : "Markdown"}
      </div>
      <textarea
        ref={textareaRef}
        className={`flex-1 resize-none p-6 md:p-8 font-mono text-[13px] leading-relaxed focus:outline-none bg-transparent placeholder:text-gray-200 text-gray-700 transition-colors ${
          analysis.error ? "border-l-2 border-red-500" : ""
        }`}
        value={content}
        onChange={e => setContent(e.target.value)}
        readOnly={readOnly}
        placeholder={placeholder}
        spellCheck={false}
        data-testid="editor-textarea"
      />
    </div>
  );

  const previewPane = (
    <div className="flex-1 h-full flex flex-col min-h-0 min-w-0 bg-[#fafafa]" data-testid="preview-pane">
      <div className="h-10 border-b border-gray-50 flex items-center px-6 bg-[#fcfcfc] shrink-0 text-[10px] font-semibold tracking-widest text-gray-400 uppercase">
        {isStructured ? "Formatted" : isDrawio ? "Diagram" : "Preview"}
      </div>
      {isDrawio ? (
        <div className="flex-1 min-h-0 p-3">
          <DrawioFileView xml={content} />
        </div>
      ) : (
        <div ref={previewScrollRef} className="flex-1 overflow-y-auto p-6 md:p-8">
          {isStructured ? structuredPreview : (
            <MarkdownPreview
              content={content}
              className={`prose prose-sm md:prose-base prose-slate prose-headings:tracking-tight prose-a:text-blue-600 prose-pre:bg-gray-900 prose-pre:text-gray-100 ${
                fullWidth ? "max-w-none" : `max-w-[80ch] ${mode === "preview" ? "mx-auto" : ""}`
              }`}
            />
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-white shadow-sm ring-1 ring-black/[0.03] z-10 m-0 md:m-4 md:rounded-2xl overflow-hidden">
      {/* Editor Header */}
      <div className="h-16 border-b border-gray-100 flex items-center px-4 md:px-8 justify-between bg-white shrink-0">
        {source.titleEditable ? (
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="font-bold text-lg md:text-xl focus:outline-none bg-transparent placeholder:text-gray-300 text-gray-900 w-1/2 tracking-tight"
            placeholder="Untitled Document"
          />
        ) : (
          <div className="min-w-0 w-1/2 flex flex-col">
            <span className="font-bold text-lg md:text-xl text-gray-900 tracking-tight truncate" title={source.path}>
              {title}
            </span>
            {source.path && (
              <span className="text-[11px] text-gray-400 truncate" title={source.path} data-testid="editor-path">
                {source.path}
              </span>
            )}
          </div>
        )}
        <div className="flex items-center gap-3 md:gap-5">
          {!isPlainText && !isMobile && <ModeSwitch mode={mode} onChange={setMode} />}
          {!isPlainText && !isStructured && !isDrawio && !isMobile && mode !== "edit" && (
            <button
              className={`hidden sm:flex items-center justify-center w-8 h-8 rounded-full transition-colors ${
                fullWidth ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:text-gray-800"
              }`}
              onClick={() => setPreviewFullWidth(!fullWidth)}
              aria-pressed={fullWidth}
              title={fullWidth ? "Use a readable column width" : "Use the full width of the pane"}
              data-testid="button-full-width"
            >
              <MoveHorizontal className="w-3.5 h-3.5" />
            </button>
          )}
          {isStructured && analysis.error && (
            <span className="text-[11px] md:text-xs font-medium text-red-500 items-center gap-1.5 hidden sm:flex" title={analysis.error}>
              <AlertCircle className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Invalid {formatLabel}</span>
            </span>
          )}
          {isStructured && !analysis.error && content.trim() && (
            <span className="text-[11px] md:text-xs font-medium text-green-500 items-center gap-1.5 hidden sm:flex">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Valid {formatLabel}</span>
            </span>
          )}
          {readOnly && source.save ? (
            <button
              className="text-[11px] md:text-xs font-medium text-gray-600 flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 rounded-full pl-2.5 pr-3 py-1 transition-colors whitespace-nowrap shrink-0"
              onClick={unlock}
              title="This file opened read-only. Click to edit it (changes save to disk)."
              data-testid="button-unlock"
            >
              <Lock className="w-3 h-3" /> Read-only
              <span className="flex items-center gap-1 text-[#007fd4]"><LockOpen className="w-3 h-3" /> Edit</span>
            </button>
          ) : readOnly ? (
            <span className="text-[11px] md:text-xs font-medium text-gray-500 flex items-center gap-1.5 bg-gray-100 rounded-full px-2.5 py-1" data-testid="read-only-badge">
              <Lock className="w-3 h-3" /> Read-only
            </span>
          ) : (
          <span className="text-[11px] md:text-xs font-medium text-gray-400 flex items-center gap-1.5 md:gap-2" data-testid="save-status">
            {status === "saving" ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> <span className="hidden md:inline">Saving...</span></>
            ) : status === "conflict" ? (
              <><AlertCircle className="w-3.5 h-3.5 text-red-500" /> <span className="hidden md:inline text-red-500">Changed on disk</span></>
            ) : status === "dirty" ? (
              <><div className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]" /> <span className="hidden md:inline">Unsaved</span></>
            ) : (
              <><Check className="w-3.5 h-3.5 text-green-500" /> <span className="hidden md:inline">Saved</span></>
            )}
          </span>
          )}
          {isStructured && !readOnly && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleFormat}
              className="h-8 rounded-full px-3 md:px-5 text-xs font-semibold transition-all shadow-sm hidden sm:flex"
              data-testid="button-prettify"
            >
              <Zap className="w-3.5 h-3.5 mr-1.5" />
              Format
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={handleSaveAs}
            className="h-8 rounded-full px-3 md:px-5 text-xs font-semibold transition-all shadow-sm hidden sm:flex"
            data-testid="button-save-as"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Save As
          </Button>
          {!readOnly && (
            <Button
              size="sm"
              variant={status === "dirty" || status === "conflict" ? "default" : "secondary"}
              onClick={() => void flush()}
              disabled={status !== "dirty" && status !== "conflict"}
              className="h-8 rounded-full px-3 md:px-5 text-xs font-semibold transition-all shadow-sm hidden sm:flex"
              title="Save (Ctrl+S)"
              data-testid="button-save"
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              Save
            </Button>
          )}
        </div>
      </div>

      {/* Editor Body - plain text viewer / Split Desktop / Tabbed Mobile */}
      <div className="flex-1 flex flex-col min-h-0 bg-white">
        {isPlainText ? (
          <textarea
            ref={textareaRef}
            className="flex-1 resize-none p-5 md:p-8 font-mono text-[13px] leading-relaxed focus:outline-none bg-transparent text-gray-700 whitespace-pre"
            value={content}
            onChange={e => setContent(e.target.value)}
            readOnly={readOnly}
            spellCheck={false}
            wrap="off"
            data-testid="editor-textarea"
          />
        ) : !isMobile ? (
          mode === "edit" ? sourcePane
          : mode === "preview" ? previewPane
          : (
            // The split position is saved in localStorage by autoSaveId.
            <ResizablePanelGroup direction="horizontal" autoSaveId="mdc-editor-split" ref={splitGroup} className="flex-1 min-h-0">
              <ResizablePanel defaultSize={50} minSize={15} className="flex flex-col min-h-0">
                {sourcePane}
              </ResizablePanel>
              <ResizableHandle
                withHandle
                className="w-1.5 bg-gray-100 hover:bg-[#007fd4]/50 data-[resize-handle-state=drag]:bg-[#007fd4]/70 transition-colors"
                onDoubleClick={() => splitGroup.current?.setLayout([50, 50])}
                title="Drag to resize · double-click to reset"
                data-testid="split-handle"
              />
              <ResizablePanel defaultSize={50} minSize={15} className="flex flex-col min-h-0">
                {previewPane}
              </ResizablePanel>
            </ResizablePanelGroup>
          )
        ) : (
          <div className="flex flex-1 flex-col min-h-0 bg-white">
            <Tabs defaultValue="edit" className="flex-1 flex flex-col min-h-0">
              <div className="px-3 py-2 border-b border-gray-100 bg-[#fafafa] shrink-0">
                <TabsList className="grid w-full grid-cols-2 bg-gray-200/50 p-1">
                  <TabsTrigger value="edit" className="text-xs rounded shadow-sm data-[state=active]:bg-white">Edit</TabsTrigger>
                  <TabsTrigger value="preview" className="text-xs rounded shadow-sm data-[state=active]:bg-white">{isStructured ? "Formatted" : isDrawio ? "Diagram" : "Preview"}</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="edit" className="flex-1 p-0 m-0 data-[state=active]:flex flex-col min-h-0">
                <textarea
                  ref={textareaRef}
                  className="flex-1 resize-none p-5 font-mono text-[13px] leading-relaxed focus:outline-none bg-transparent placeholder:text-gray-300 text-gray-700"
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  readOnly={readOnly}
                  placeholder={placeholder}
                  spellCheck={false}
                />
              </TabsContent>
              <TabsContent ref={previewScrollRef} value="preview" className="flex-1 overflow-y-auto p-5 m-0 data-[state=active]:block min-h-0 bg-[#fafafa]">
                {isDrawio ? <DrawioFileView xml={content} /> : isStructured ? structuredPreview : (
                  <MarkdownPreview
                    content={content}
                    className="prose prose-sm prose-slate max-w-none prose-headings:tracking-tight"
                  />
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    </div>
  );
}
