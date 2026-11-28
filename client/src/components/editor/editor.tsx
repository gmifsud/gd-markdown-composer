import { useState, useMemo, useRef, useEffect, useDeferredValue } from "react";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import {
  Check, Loader2, CheckCircle2, AlertCircle, Zap, Lock, LockOpen, PenLine, Columns2, Eye, MoveHorizontal,
  FoldVertical, ChevronRight, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { MarkdownPreview } from "@/components/editor/markdown-preview";
import { DrawioFileView, MermaidFileView } from "@/components/editor/diagrams";
import { SaveButton } from "@/components/editor/save-button";
import { FindBar, clearPreviewPaint, paintPreview, previewRanges } from "@/components/editor/find";
import { SourceEditor } from "@/components/editor/source-editor";
import type { SavedEditor } from "@/components/editor/cm/editor-state";
import { findInDoc, replaceMatchesSpec, type Range } from "@/components/editor/cm/find";
import { frontMatterEnd } from "@/components/editor/cm/front-matter-fold";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useRootFolderOf } from "@/components/layout/path-actions";
import { useRevealInExplorer } from "@/components/layout/explorer-reveal";
import { splitFrontMatter } from "@/lib/markdown-source";
import { EMPTY_ANALYSIS, analyzeJson, analyzeYaml } from "@/lib/structured";
import { useAutosave, type Saver } from "@/hooks/use-autosave";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace, useWorkspaceActions, type EditorMode } from "@/lib/workspace";
import { clearActiveEditor, publishActiveEditor, registerRevealHandler } from "@/lib/active-editor";
import { useRegisterCommands } from "@/lib/commands";
import type { FileKind } from "@shared/fs";
import {
  lineRangeInDoc, needsSourceForReveal, occurrencesBefore, revealHeadingInPreview, revealInEditor, revealTextInPreview,
} from "@/components/editor/reveal";

/** What the editor shows and how it saves: a database document or a file on disk. */
export interface EditorSource {
  /** Tab URI (db:<id> or file:<path>), used by the Outline and search to jump here. */
  uri: string;
  title: string;
  /** Database documents can be renamed from the header; files can't (yet). */
  titleEditable: boolean;
  /** "drawio"/"mermaid" render the diagram, "html" a sandboxed page; "text" is any other text file, shown without a preview. */
  fileType: FileKind;
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

const DOWNLOAD_TYPES = {
  md: { ext: ".md", mime: "text/markdown" },
  json: { ext: ".json", mime: "application/json" },
  yaml: { ext: ".yaml", mime: "application/yaml" },
  html: { ext: ".html", mime: "text/html" },
} as const;

const noopSave: Saver = async () => {};
const HTML_PREVIEW_POLICY =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data: https:; style-src 'unsafe-inline' https:; font-src data: https:; media-src data: https:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'\">";

function htmlPreviewDocument(html: string) {
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/i, match => `${match}${HTML_PREVIEW_POLICY}`);
  }
  if (/<!doctype[^>]*>/i.test(html)) {
    return html.replace(/<!doctype[^>]*>/i, match => `${match}${HTML_PREVIEW_POLICY}`);
  }
  return `${HTML_PREVIEW_POLICY}${html}`;
}

// Tighter Markdown preview: smaller type and less space between blocks.
const COMPACT_PROSE =
  "prose-sm leading-snug prose-p:my-1.5 prose-headings:mt-4 prose-headings:mb-1.5 prose-h1:mb-3 " +
  "prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0 prose-pre:my-2 prose-blockquote:my-2 prose-hr:my-4 " +
  "prose-table:my-2 prose-img:my-2";

const MODES: { mode: EditorMode; label: string; icon: JSX.Element }[] = [
  { mode: "edit", label: "Edit only", icon: <PenLine className="w-3.5 h-3.5" /> },
  { mode: "split", label: "Edit and preview side by side", icon: <Columns2 className="w-3.5 h-3.5" /> },
  { mode: "preview", label: "Preview only", icon: <Eye className="w-3.5 h-3.5" /> },
];

const LAYOUT_COMMANDS: { mode: EditorMode; id: string; title: string }[] = [
  { mode: "edit", id: "view.editOnly", title: "Layout: Edit Only" },
  { mode: "split", id: "view.split", title: "Layout: Split" },
  { mode: "preview", id: "view.previewOnly", title: "Layout: Preview Only" },
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
  const { setEditorMode, setDiagramMode, setPreviewFullWidth, setCompact, setFrontMatterOpen } = useWorkspaceActions();
  const isDrawio = source.fileType === "drawio";
  const isHtml = source.fileType === "html";
  const isMermaid = source.fileType === "mermaid";
  // Diagram files remember their own layout (they usually want the diagram only).
  const isDiagramFile = isDrawio || isMermaid;
  const mode = isDiagramFile ? workspace.diagramMode : workspace.editorMode;
  const setMode = isDiagramFile ? setDiagramMode : setEditorMode;
  const fullWidth = workspace.previewFullWidth;
  const compact = workspace.compact;
  const rootFolderOf = useRootFolderOf();
  const revealInExplorer = useRevealInExplorer();
  const rootFolder = source.path ? rootFolderOf(source.path)?.folder ?? null : null;

  // Markdown front matter can be folded away in the source. The editor always
  // holds the whole file; folding hides the block and protects it from edits.
  const isMarkdown = source.fileType === "md";
  const frontMatter = useMemo(() => (isMarkdown ? splitFrontMatter(content) : null), [isMarkdown, content]);
  const hideFrontMatter = !!frontMatter?.block && !workspace.frontMatterOpen;
  const frontMatterRef = useRef({ hidden: hideFrontMatter, lines: frontMatter?.lines ?? 0, body: frontMatter?.body ?? content });
  frontMatterRef.current = { hidden: hideFrontMatter, lines: frontMatter?.lines ?? 0, body: frontMatter?.body ?? content };
  const splitGroup = useRef<ImperativePanelGroupHandle>(null);

  const [locked, setLocked] = useState(!!source.startLocked);
  // The source editor's view while it is shown, and what it leaves behind when
  // a layout switch unmounts it (undo history, selection, scroll).
  const viewRef = useRef<EditorView | null>(null);
  const editorCache = useRef<SavedEditor | null>(null);
  // Bumped when the editor mounts or unmounts (layout switches), so values
  // computed from viewRef during render are recomputed.
  const [viewVersion, setViewVersion] = useState(0);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);

  // Share the live text with the Outline panel.
  useEffect(() => {
    publishActiveEditor({ uri: source.uri, fileType: source.fileType, title, content });
  }, [source.uri, source.fileType, title, content]);
  useEffect(() => () => clearActiveEditor(source.uri), [source.uri]);

  // Jumps from the Outline and search results: select the line in the source
  // (when shown) and scroll the preview to the heading or matching text.
  // The handler below is registered once per document; it reads the current setter from here.
  const revealLayout = useRef({ setMode });
  revealLayout.current = { setMode };
  useEffect(() => registerRevealHandler(source.uri, function reveal(target, retried = false) {
    const fm = frontMatterRef.current;
    // Lines are counted in the whole file; the preview never shows front matter.
    const bodyLine = target.line - fm.lines;
    if (fm.hidden && bodyLine < 0) {
      // The target is inside the folded front matter: unfold it, then try again.
      setFrontMatterOpen(true);
      setTimeout(() => reveal(target), 30);
      return;
    }
    // Go to Line in the preview-only layout: show the source beside the
    // preview, then try again (once, in case the source can't be shown).
    if (needsSourceForReveal(target, !!viewRef.current) && !retried) {
      revealLayout.current.setMode("split");
      setTimeout(() => reveal(target, true), 30);
      return;
    }
    // The editor holds the whole file, so whole-file line numbers apply.
    const view = viewRef.current;
    if (view) revealInEditor(view, lineRangeInDoc(view.state.doc, target.line, target.query));
    const preview = previewScrollRef.current?.querySelector<HTMLElement>("[data-preview-root]")
      ? previewScrollRef.current
      : null;
    if (!preview) return;
    if (target.heading) revealHeadingInPreview(preview, target.heading.text, target.heading.occurrence);
    else if (target.query && bodyLine >= 0) {
      revealTextInPreview(preview, target.query, occurrencesBefore(fm.body, bodyLine, target.query), !viewRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [source.uri]);
  // ── Find in document (Ctrl+F, F3 / Shift+F3) ──────────────────────────────
  const readOnly = !source.save || locked;
  const [find, setFind] = useState({
    open: false, query: "", matchCase: false, index: 0, focus: 0, replaceOpen: false, replacement: "",
  });
  const [previewMatchCount, setPreviewMatchCount] = useState(0);
  // The source pane is where matches are counted and stepped through when it
  // is visible; in preview-only layout the preview's own text is used.
  const sourceShown = isMobile || source.fileType === "text" || mode !== "preview";
  // Matches are found in the editor's own document (editor positions), skipping
  // folded front matter, which can't be seen or edited.
  const matchesIn = (view: EditorView | null, query: string, matchCase: boolean): Range[] =>
    view ? findInDoc(view.state.doc, query, matchCase, hideFrontMatter ? frontMatterEnd(view.state.doc) : 0) : [];
  const sourceMatches = useMemo(
    () => (find.open ? matchesIn(viewRef.current, find.query, find.matchCase) : []),
    // `content` changes with every edit, so the matches follow the text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [find.open, content, find.query, find.matchCase, hideFrontMatter, viewVersion],
  );
  const findTotal = sourceShown ? sourceMatches.length : previewMatchCount;
  const findIndex = findTotal ? Math.min(find.index, findTotal - 1) : -1;

  const firstMatchFromCaret = (query: string, matchCase: boolean) => {
    const view = viewRef.current;
    const caret = view?.state.selection.main.head ?? 0;
    const at = matchesIn(view, query, matchCase).findIndex(([start]) => start >= caret);
    return at < 0 ? 0 : at;
  };

  // Replace edits the source, so it needs an editable source on screen.
  const canReplace = !readOnly && sourceShown;

  const openFind = (withReplace = false) => {
    const view = viewRef.current;
    const sel = view?.state.selection.main;
    const selected = view && sel && view.hasFocus ? view.state.sliceDoc(sel.from, sel.to) : "";
    const query = selected && selected.length <= 200 && !selected.includes("\n") ? selected : find.query;
    setFind(f => ({
      ...f, open: true, query, index: firstMatchFromCaret(query, f.matchCase), focus: f.focus + 1,
      replaceOpen: withReplace ? canReplace : f.replaceOpen,
    }));
  };

  const replaceCurrent = () => {
    const view = viewRef.current;
    const match = sourceMatches[findIndex];
    if (!canReplace || !view || !match) return;
    // Put the caret after the replacement, then carry on from there, so a
    // replacement that contains the query ("a" → "aa") moves forward.
    view.dispatch({ ...replaceMatchesSpec([match], find.replacement), selection: { anchor: match[0] + find.replacement.length } });
    setFind(f => ({ ...f, index: firstMatchFromCaret(f.query, f.matchCase) }));
  };

  const replaceAll = () => {
    const view = viewRef.current;
    if (!canReplace || !view || !sourceMatches.length) return;
    const n = sourceMatches.length;
    view.dispatch(replaceMatchesSpec(sourceMatches, find.replacement));
    toast({ description: `Replaced ${n} occurrence${n === 1 ? "" : "s"}` });
  };
  const stepFind = (delta: number) => {
    if (!findTotal) return;
    setFind(f => ({ ...f, open: true, index: (Math.max(0, Math.min(f.index, findTotal - 1)) + delta + findTotal) % findTotal }));
  };
  const closeFind = () => {
    const match = sourceShown ? sourceMatches[findIndex] : undefined;
    setFind(f => ({ ...f, open: false }));
    clearPreviewPaint();
    // Leave the current match selected in the source, as editors do.
    const view = viewRef.current;
    if (view && match) {
      view.dispatch({ selection: EditorSelection.range(match[0], match[1]) });
      view.focus();
    }
  };

  const findKeys = useRef({ openFind, stepFind, hasQuery: false });
  findKeys.current = { openFind, stepFind, hasQuery: !!find.query };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The find box handles its own keys (Enter, F3) and marks them handled.
      if (e.defaultPrevented) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        findKeys.current.openFind();
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "h") {
        // Also keeps the browser's History shortcut from opening.
        e.preventDefault();
        findKeys.current.openFind(true);
      } else if (e.key === "F3" && findKeys.current.hasQuery) {
        e.preventDefault();
        findKeys.current.stepFind(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Scroll the source to the current match (without taking focus from the find box).
  useEffect(() => {
    if (!find.open || !sourceShown) return;
    const view = viewRef.current;
    const match = sourceMatches[findIndex];
    if (!view || !match) return;
    view.dispatch({ effects: EditorView.scrollIntoView(match[0], { y: "start", yMargin: view.scrollDOM.clientHeight / 3 }) });
  }, [find.open, sourceShown, sourceMatches, findIndex]);

  // Highlight matches in the preview; in preview-only layout, step through them there.
  useEffect(() => {
    const container = previewScrollRef.current;
    if (!find.open || !container) {
      clearPreviewPaint();
      return;
    }
    const ranges = previewRanges(container, find.query, find.matchCase);
    setPreviewMatchCount(ranges.length);
    // The preview never shows front matter: when it is unfolded in the source,
    // matches inside it have no counterpart in the preview.
    const view = viewRef.current;
    const fmEnd = view && !hideFrontMatter ? frontMatterEnd(view.state.doc) : 0;
    const inFrontMatter = sourceMatches.filter(([start]) => start < fmEnd).length;
    const current = sourceShown
      ? (sourceMatches[findIndex] && findIndex >= inFrontMatter ? Math.min(findIndex - inFrontMatter, ranges.length - 1) : -1)
      : Math.min(find.index, ranges.length - 1);
    paintPreview(ranges, current);
    const range = ranges[current];
    if (range) {
      const box = container.getBoundingClientRect();
      const rect = range.getBoundingClientRect();
      if (rect.top < box.top || rect.bottom > box.bottom) container.scrollTop += rect.top - box.top - box.height / 3;
    }
  });
  useEffect(() => () => clearPreviewPaint(), []);

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

  // Previews, diagrams and validation render from a deferred copy of the text:
  // React renders them at low priority, so typing in a large document never
  // waits for a full Markdown parse (or JSON/YAML pass) per keystroke.
  const deferredContent = useDeferredValue(content);

  const analyze = (text: string) => (isJson ? analyzeJson(text) : isYaml ? analyzeYaml(text) : EMPTY_ANALYSIS);
  const analysis = useMemo(
    () => analyze(deferredContent),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isJson, isYaml, deferredContent],
  );

  const handleFormat = () => {
    // Format the live text, not the deferred copy, so a keystroke made just
    // before clicking is never lost.
    const current = analyze(content);
    if (current.error) {
      toast({ description: `Cannot format invalid ${formatLabel}`, variant: "destructive" });
      return;
    }
    if (!current.formatted) return;
    // Through the editor, so Ctrl+Z undoes the formatting.
    const view = viewRef.current;
    if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: current.formatted }, userEvent: "input.format" });
    else setContent(current.formatted);
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

  // Palette commands. They read `live` when listed or run, so they are
  // registered once per document instead of on every keystroke.
  const liveNow = {
    flush, openFind, setMode, mode, readOnly, canReplace, isPlainText, isMobile, isMarkdown, compact, fullWidth,
    frontMatterOpen: workspace.frontMatterOpen, hasFrontMatter: !!frontMatter?.block,
    fullWidthAvailable: !isPlainText && !isStructured && !isDiagramFile && !isMobile && mode !== "edit",
  };
  const live = useRef(liveNow);
  live.current = liveNow;
  useRegisterCommands([
    { id: "file.save", title: "Save", category: "File", keys: "Mod+S", when: () => !live.current.readOnly, run: () => void live.current.flush() },
    ...LAYOUT_COMMANDS.map(m => ({
      id: m.id,
      title: m.title,
      category: "View",
      when: () => !live.current.isPlainText && !live.current.isMobile && live.current.mode !== m.mode,
      run: () => live.current.setMode(m.mode),
    })),
    {
      id: "view.toggleCompact", title: "Toggle Compact Spacing", category: "View",
      when: () => live.current.isMarkdown && !live.current.isMobile, run: () => setCompact(!live.current.compact),
    },
    {
      id: "view.toggleFullWidth", title: "Toggle Full-Width Preview", category: "View",
      when: () => live.current.fullWidthAvailable, run: () => setPreviewFullWidth(!live.current.fullWidth),
    },
    {
      id: "view.foldFrontMatter", title: "Fold Front Matter", category: "View",
      when: () => live.current.hasFrontMatter && live.current.frontMatterOpen, run: () => setFrontMatterOpen(false),
    },
    {
      id: "view.unfoldFrontMatter", title: "Unfold Front Matter", category: "View",
      when: () => live.current.hasFrontMatter && !live.current.frontMatterOpen, run: () => setFrontMatterOpen(true),
    },
    { id: "search.find", title: "Find in Document", category: "Search", keys: "Mod+F", run: () => live.current.openFind() },
    {
      id: "search.replace", title: "Replace in Document", category: "Search", keys: "Mod+H",
      when: () => live.current.canReplace, run: () => live.current.openFind(true),
    },
  ], [source.uri]);

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

  const paneLabelClass = `${compact ? "h-8 px-4" : "h-10 px-6"} border-b border-gray-50 flex items-center justify-between gap-2 bg-[#fcfcfc] shrink-0 text-[10px] font-semibold tracking-widest text-gray-400 uppercase`;

  const frontMatterToggle = frontMatter?.block ? (
    <button
      className="flex items-center gap-1 normal-case tracking-normal text-[11px] font-medium text-gray-500 hover:text-gray-800 rounded px-1.5 py-0.5 hover:bg-gray-100"
      onClick={() => setFrontMatterOpen(!workspace.frontMatterOpen)}
      aria-expanded={workspace.frontMatterOpen}
      title={workspace.frontMatterOpen ? "Fold the front matter away" : "Show and edit the front matter"}
      data-testid="source-front-matter-toggle"
    >
      {workspace.frontMatterOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      Front matter · {frontMatter.lines} lines
    </button>
  ) : null;

  // One editor at a time is mounted (the layouts below are exclusive); they all
  // share viewRef and the saved state, so switching layout keeps undo history.
  const findHighlights = useMemo(
    () => (find.open ? { ranges: sourceMatches, current: findIndex } : undefined),
    [find.open, sourceMatches, findIndex],
  );
  const sourceEditor = ({ compact: tight, invalid = false, wrap = true }: { compact: boolean; invalid?: boolean; wrap?: boolean }) => (
    <SourceEditor
      value={content}
      onDocChange={setContent}
      fileType={source.fileType}
      readOnly={readOnly}
      wrap={wrap}
      compact={tight}
      placeholder={placeholder}
      frontMatterHidden={hideFrontMatter}
      onUnfoldFrontMatter={() => setFrontMatterOpen(true)}
      highlights={findHighlights}
      invalid={invalid}
      viewRef={viewRef}
      cache={editorCache}
      onViewChange={() => setViewVersion(v => v + 1)}
      data-testid="source-editor"
    />
  );

  const sourcePane = (
    <div className="flex-1 h-full flex flex-col min-h-0 min-w-0" data-testid="source-pane">
      <div className={paneLabelClass}>
        <span>{isStructured ? formatLabel : isDrawio ? "Draw.io XML" : isMermaid ? "Mermaid" : isHtml ? "HTML" : "Markdown"}</span>
        {frontMatterToggle}
      </div>
      {sourceEditor({ compact, invalid: !!analysis.error })}
    </div>
  );

  const previewPane = (
    <div className="flex-1 h-full flex flex-col min-h-0 min-w-0 bg-[#fafafa]" data-testid="preview-pane">
      <div className={paneLabelClass}>
        {isStructured ? "Formatted" : isDiagramFile ? "Diagram" : isHtml ? "HTML" : "Preview"}
      </div>
      {isHtml ? (
        <iframe
          title={`${title} preview`}
          srcDoc={htmlPreviewDocument(deferredContent)}
          sandbox=""
          referrerPolicy="no-referrer"
          className="flex-1 min-h-0 w-full border-0 bg-white"
          data-testid="html-preview"
        />
      ) : isDiagramFile ? (
        <div className="flex-1 min-h-0 p-3">
          {isDrawio ? <DrawioFileView xml={deferredContent} /> : <MermaidFileView code={deferredContent} />}
        </div>
      ) : (
        <div ref={previewScrollRef} className={`flex-1 overflow-y-auto ${compact ? "px-4 py-3 md:px-6" : "p-6 md:p-8"}`}>
          {isStructured ? structuredPreview : (
            <MarkdownPreview
              content={deferredContent}
              docPath={source.path}
              rootFolder={rootFolder}
              className={`prose prose-slate prose-headings:tracking-tight prose-a:text-blue-600 prose-pre:bg-gray-900 prose-pre:text-gray-100 ${
                compact ? COMPACT_PROSE : "prose-sm md:prose-base"
              } ${fullWidth ? "max-w-none" : `max-w-[80ch] ${mode === "preview" ? "mx-auto" : ""}`}`}
            />
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-white shadow-sm ring-1 ring-black/[0.03] z-10 m-0 md:m-4 md:rounded-2xl overflow-hidden">
      {/* Editor Header */}
      <div className={`${compact ? "h-11 md:px-5" : "h-14 md:px-6"} border-b border-gray-100 flex items-center px-4 justify-between gap-3 bg-white shrink-0`}>
        {source.titleEditable ? (
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            className={`font-bold ${compact ? "text-base" : "text-lg"} focus:outline-none bg-transparent placeholder:text-gray-300 text-gray-900 w-1/2 tracking-tight`}
            placeholder="Untitled Document"
          />
        ) : (
          <div className="min-w-0 w-1/2 flex flex-col">
            <span className={`font-bold ${compact ? "text-base" : "text-lg"} text-gray-900 tracking-tight truncate`} title={source.path}>
              {title}
            </span>
            {source.path && !compact && (
              <button
                className="text-left text-[11px] text-gray-400 hover:text-[#007fd4] truncate"
                onClick={() => revealInExplorer(source.uri)}
                title={`${source.path}\nClick to reveal in Explorer`}
                data-testid="editor-path"
              >
                {source.path}
              </button>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          {!isPlainText && !isMobile && <ModeSwitch mode={mode} onChange={setMode} />}
          {!isPlainText && !isStructured && !isDiagramFile && !isMobile && mode !== "edit" && (
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
          {isMarkdown && !isMobile && (
            <button
              className={`hidden sm:flex items-center justify-center w-8 h-8 rounded-full transition-colors ${
                compact ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:text-gray-800"
              }`}
              onClick={() => setCompact(!compact)}
              aria-pressed={compact}
              title={compact ? "Use roomier spacing" : "Use tighter spacing"}
              data-testid="button-compact"
            >
              <FoldVertical className="w-3.5 h-3.5" />
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
              className="h-7 rounded-full px-3 text-xs font-semibold transition-all shadow-sm hidden sm:flex"
              data-testid="button-prettify"
            >
              <Zap className="w-3.5 h-3.5 mr-1.5" />
              Format
            </Button>
          )}
          <SaveButton
            canSave={!readOnly && (status === "dirty" || status === "conflict")}
            onSave={() => void flush()}
            onSaveAs={handleSaveAs}
            compact={compact}
          />
        </div>
      </div>

      {/* Editor Body - plain text viewer / Split Desktop / Tabbed Mobile */}
      <div className="relative flex-1 flex flex-col min-h-0 bg-white">
        {find.open && (
          <FindBar
            query={find.query}
            matchCase={find.matchCase}
            current={findIndex}
            total={findTotal}
            focusRequest={find.focus}
            onQuery={(query) => setFind(f => ({ ...f, query, index: firstMatchFromCaret(query, f.matchCase) }))}
            onMatchCase={(matchCase) => setFind(f => ({ ...f, matchCase, index: firstMatchFromCaret(f.query, matchCase) }))}
            onNext={() => stepFind(1)}
            onPrevious={() => stepFind(-1)}
            onClose={closeFind}
            replaceOpen={find.replaceOpen}
            replacement={find.replacement}
            canReplace={canReplace}
            onReplacement={(replacement) => setFind(f => ({ ...f, replacement }))}
            onToggleReplace={() => setFind(f => ({ ...f, replaceOpen: !f.replaceOpen }))}
            onReplace={replaceCurrent}
            onReplaceAll={replaceAll}
          />
        )}
        {isPlainText ? (
          sourceEditor({ compact: false, wrap: false })
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
                  <TabsTrigger value="preview" className="text-xs rounded shadow-sm data-[state=active]:bg-white">{isStructured ? "Formatted" : isDiagramFile ? "Diagram" : isHtml ? "HTML" : "Preview"}</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="edit" className="flex-1 p-0 m-0 data-[state=active]:flex flex-col min-h-0">
                {sourceEditor({ compact: false, invalid: !!analysis.error })}
              </TabsContent>
              <TabsContent ref={previewScrollRef} value="preview" className="flex-1 overflow-y-auto p-5 m-0 data-[state=active]:block min-h-0 bg-[#fafafa]">
                {isHtml ? (
                  <iframe
                    title={`${title} preview`}
                    srcDoc={htmlPreviewDocument(deferredContent)}
                    sandbox=""
                    referrerPolicy="no-referrer"
                    className="h-full min-h-0 w-full border-0 bg-white"
                    data-testid="html-preview"
                  />
                ) : isDrawio ? <DrawioFileView xml={deferredContent} />
                  : isMermaid ? <div className="h-[70vh]"><MermaidFileView code={deferredContent} /></div>
                  : isStructured ? structuredPreview : (
                  <MarkdownPreview
                    content={deferredContent}
                    docPath={source.path}
                    rootFolder={rootFolder}
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
