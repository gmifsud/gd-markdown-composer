import { useState, useMemo } from "react";
import { parseAllDocuments } from "yaml";
import { Check, Loader2, Save, Download, CheckCircle2, AlertCircle, Zap, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarkdownPreview } from "@/components/editor/markdown-preview";
import { useAutosave, type Saver } from "@/hooks/use-autosave";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";

/** What the editor shows and how it saves: a database document or a file on disk. */
export interface EditorSource {
  title: string;
  /** Database documents can be renamed from the header; files can't (yet). */
  titleEditable: boolean;
  /** "text" is any other text file: shown read-only without a preview. */
  fileType: "md" | "json" | "yaml" | "text";
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

/** Mount with a `key` per document: state is initialised from the source once. */
export function Editor({ source }: EditorProps) {
  const [content, setContent] = useState(source.content);
  const [title, setTitle] = useState(source.title);
  const isMobile = useIsMobile();
  const { toast } = useToast();

  const readOnly = !source.save;
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
          {readOnly ? (
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
            className="flex-1 resize-none p-5 md:p-8 font-mono text-[13px] leading-relaxed focus:outline-none bg-transparent text-gray-700 whitespace-pre"
            value={content}
            readOnly
            spellCheck={false}
            wrap="off"
            data-testid="editor-textarea"
          />
        ) : !isMobile ? (
          <div className="flex flex-1 min-h-0">
            <div className="flex-1 flex flex-col min-h-0 border-r border-gray-100/80 group">
              <div className="h-10 border-b border-gray-50 flex items-center px-6 bg-[#fcfcfc] shrink-0 text-[10px] font-semibold tracking-widest text-gray-400 uppercase">
                {isStructured ? formatLabel : "Markdown"}
              </div>
              <textarea
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

            <div className="flex-1 flex flex-col min-h-0 bg-[#fafafa]">
              <div className="h-10 border-b border-gray-50 flex items-center px-6 bg-[#fcfcfc] shrink-0 text-[10px] font-semibold tracking-widest text-gray-400 uppercase">
                {isStructured ? "Formatted" : "Preview"}
              </div>
              <div className="flex-1 overflow-y-auto p-6 md:p-8">
                {isStructured ? structuredPreview : (
                  <MarkdownPreview
                    content={content}
                    className="prose prose-sm md:prose-base prose-slate max-w-[80ch] prose-headings:tracking-tight prose-a:text-blue-600 prose-pre:bg-gray-900 prose-pre:text-gray-100"
                  />
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col min-h-0 bg-white">
            <Tabs defaultValue="edit" className="flex-1 flex flex-col min-h-0">
              <div className="px-3 py-2 border-b border-gray-100 bg-[#fafafa] shrink-0">
                <TabsList className="grid w-full grid-cols-2 bg-gray-200/50 p-1">
                  <TabsTrigger value="edit" className="text-xs rounded shadow-sm data-[state=active]:bg-white">Edit</TabsTrigger>
                  <TabsTrigger value="preview" className="text-xs rounded shadow-sm data-[state=active]:bg-white">{isStructured ? "Formatted" : "Preview"}</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="edit" className="flex-1 p-0 m-0 data-[state=active]:flex flex-col min-h-0">
                <textarea
                  className="flex-1 resize-none p-5 font-mono text-[13px] leading-relaxed focus:outline-none bg-transparent placeholder:text-gray-300 text-gray-700"
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  placeholder={placeholder}
                  spellCheck={false}
                />
              </TabsContent>
              <TabsContent value="preview" className="flex-1 overflow-y-auto p-5 m-0 data-[state=active]:block min-h-0 bg-[#fafafa]">
                {isStructured ? structuredPreview : (
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
