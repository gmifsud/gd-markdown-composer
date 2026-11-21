import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";
import { EditorView } from "@codemirror/view";
import {
  createEditorState, docText, reconfigure, restoreEditorState, type SavedEditor, type SourceEditorConfig,
} from "@/components/editor/cm/editor-state";
import { setFrontMatterHidden } from "@/components/editor/cm/front-matter-fold";
import { setFindHighlights, type Range } from "@/components/editor/cm/find";

interface SourceEditorProps extends SourceEditorConfig {
  value: string;
  /** Set to the live view while mounted, null otherwise. */
  viewRef: MutableRefObject<EditorView | null>;
  /** Survives remounts (layout switches): undo history, selection and scroll come back. */
  cache: MutableRefObject<SavedEditor | null>;
  highlights?: { ranges: Range[]; current: number };
  /** Red edge, for JSON/YAML that doesn't parse. */
  invalid?: boolean;
  className?: string;
  "data-testid"?: string;
}

/** CodeMirror 6 source editor. The view is created once per mount; props flow in as transactions. */
export function SourceEditor({
  value, viewRef, cache, highlights, invalid = false, className = "", "data-testid": testId, ...config
}: SourceEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Callbacks are read through a ref, so the extensions never need rebuilding for them.
  const latest = useRef(config);
  latest.current = config;
  // The last text this editor reported; a different `value` came from outside.
  const emitted = useRef(value);

  useLayoutEffect(() => {
    const stable: SourceEditorConfig = {
      ...latest.current,
      onDocChange: (text) => {
        emitted.current = text;
        latest.current.onDocChange(text);
      },
      onUnfoldFrontMatter: () => latest.current.onUnfoldFrontMatter(),
    };
    const saved = cache.current;
    const restored = saved ? restoreEditorState(saved.state, value, stable) : null;
    const created = new EditorView({ state: restored ?? createEditorState(value, stable), parent: host.current! });
    if (restored && saved) created.dispatch({ effects: saved.scroll });
    emitted.current = value;
    view.current = created;
    viewRef.current = created;
    return () => {
      cache.current = { state: created.state, scroll: created.scrollSnapshot() };
      created.destroy();
      view.current = null;
      if (viewRef.current === created) viewRef.current = null;
    };
    // The view is built once per mount; later prop changes are dispatched below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { readOnly, wrap, compact, fileType, frontMatterHidden } = config;
  useEffect(() => {
    view.current?.dispatch({ effects: reconfigure({ ...latest.current, readOnly, wrap, compact }) });
  }, [readOnly, wrap, compact]);

  useEffect(() => {
    const v = view.current;
    if (v && fileType === "md") v.dispatch({ effects: setFrontMatterHidden.of(frontMatterHidden) });
  }, [fileType, frontMatterHidden]);

  useEffect(() => {
    view.current?.dispatch({ effects: setFindHighlights.of(highlights ?? null) });
  }, [highlights]);

  // Text changed from outside (not by typing here): replace it, past the front-matter guard.
  useEffect(() => {
    const v = view.current;
    if (!v || value === emitted.current) return;
    emitted.current = value;
    if (docText(v.state) === value) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value }, filter: false });
  }, [value]);

  return (
    <div
      ref={host}
      className={`relative flex-1 min-h-0 overflow-hidden ${invalid ? "border-l-2 border-red-500" : ""} ${className}`}
      data-testid={testId}
    />
  );
}
