import { useEffect, useMemo, useRef, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command as Cmdk, defaultFilter, useCommandState } from "cmdk";
import { File, Library } from "lucide-react";
import { useDocuments } from "@/hooks/use-documents";
import { useFsStatus } from "@/lib/fs-api";
import { getActiveEditor, requestReveal, useActiveEditor } from "@/lib/active-editor";
import { parseOutline } from "@/lib/outline";
import {
  IS_MAC, commandRegistry, formatKeys, useCommandRegistryVersion, useRegisterCommands, type Command,
} from "@/lib/commands";
import { useWorkspace, useWorkspaceActions } from "@/lib/workspace";
import { buildQuickOpenItems, clampLine, paletteKeyFor, parsePaletteQuery, type QuickOpenItem } from "./palette-logic";
import { closePalette, openPalette, setPaletteInput, takeReturnFocus, usePaletteState } from "./palette-store";
import { currentFolderFiles, useFolderFileSearch } from "./use-folder-file-search";

/**
 * Quick Open (Ctrl/Cmd+P) and the command palette (Ctrl/Cmd+Shift+P, F1):
 * one dialog whose mode is picked by the first character typed — nothing
 * for files, ">" for commands, "@" for headings, ":" for a line.
 */
export function CommandPalette() {
  const { open, input } = usePaletteState();
  // The chosen action runs once the dialog has closed and focus is back
  // (see onCloseAutoFocus), so an action that moves focus keeps it.
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = paletteKeyFor(e);
      if (!target) return;
      // Also keeps the browser's Print dialog from opening.
      e.preventDefault();
      openPalette(target === "commands" ? ">" : "");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useRegisterCommands([
    { id: "go.file", title: "Go to File…", category: "Go", keys: "Mod+P", run: () => openPalette("") },
    {
      id: "go.line", title: "Go to Line…", category: "Go",
      when: ctx => !!ctx.activeUri && getActiveEditor()?.uri === ctx.activeUri,
      run: () => openPalette(":"),
    },
    {
      id: "go.heading", title: "Go to Heading…", category: "Go",
      when: ctx => getActiveEditor()?.uri === ctx.activeUri && getActiveEditor()?.fileType === "md",
      run: () => openPalette("@"),
    },
  ], []);

  const choose = (action: () => void) => {
    pending.current = action;
    closePalette();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) closePalette(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/20" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[12%] z-50 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl focus:outline-none"
          aria-describedby={undefined}
          // The input focuses itself with the caret after any prefix.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => {
            // Give focus back to what had it (the editor, say), then run the
            // chosen action, so an action that moves focus elsewhere keeps it.
            e.preventDefault();
            const target = takeReturnFocus();
            if (target?.isConnected) target.focus();
            const action = pending.current;
            pending.current = null;
            if (action) setTimeout(action, 0);
          }}
          data-testid="command-palette"
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <PaletteBody input={input} onChoose={choose} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

const PLACEHOLDERS = {
  files: "Search files by name — > commands, @ headings, : line",
  commands: "Run a command",
  headings: "Go to heading",
  line: "Go to line",
} as const;

const itemClass =
  "flex items-center gap-2 h-7 px-2 rounded text-[13px] text-gray-800 cursor-pointer select-none " +
  "data-[selected=true]:bg-[#e4effb] data-[selected=true]:text-gray-950";
const groupClass =
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 " +
  "[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-gray-500";

function Note({ children }: { children: ReactNode }) {
  return <div className="px-3 py-2 text-[12px] text-gray-500">{children}</div>;
}

/** Shown when cmdk filtered every local item out and nothing else is listed. */
function EmptyWhenNothingShown({ others, children }: { others: number; children: ReactNode }) {
  const count = useCommandState(s => s.filtered.count);
  return count === 0 && others === 0 ? <Note>{children}</Note> : null;
}

function PaletteBody({ input, onChoose }: { input: string; onChoose(action: () => void): void }) {
  const query = parsePaletteQuery(input);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  return (
    <Cmdk
      label="Command palette"
      loop
      // cmdk's vim bindings claim Ctrl+P (previous item), which must switch modes instead.
      vimBindings={false}
      shouldFilter={query.mode !== "line"}
      // cmdk sees the raw input; rank against the text after the prefix.
      filter={(value, _search, keywords) => (query.text ? defaultFilter(value, query.text, keywords) : 1)}
    >
      <div className="border-b border-gray-200">
        <Cmdk.Input
          ref={inputRef}
          value={input}
          onValueChange={setPaletteInput}
          placeholder={PLACEHOLDERS[query.mode]}
          className="w-full h-10 px-3 text-[14px] bg-transparent outline-none placeholder:text-gray-400"
          data-testid="command-palette-input"
        />
      </div>
      <Cmdk.List className="max-h-[min(420px,60vh)] overflow-y-auto p-1">
        {query.mode === "files" && <FileItems text={query.text} onChoose={onChoose} />}
        {query.mode === "commands" && <CommandItems onChoose={onChoose} />}
        {query.mode === "headings" && <HeadingItems onChoose={onChoose} />}
        {query.mode === "line" && <LineItem line={query.line} onChoose={onChoose} />}
      </Cmdk.List>
    </Cmdk>
  );
}

// ── Files ────────────────────────────────────────────────────────────────────

const FILE_GROUPS: { source: QuickOpenItem["source"]; heading: string }[] = [
  { source: "tab", heading: "Open tabs" },
  { source: "recent", heading: "Recently opened" },
  { source: "document", heading: "Documents" },
  { source: "folder", heading: "In folders" },
];

function FileItems({ text, onChoose }: { text: string; onChoose(action: () => void): void }) {
  const { state } = useWorkspace();
  const { open } = useWorkspaceActions();
  const { data: documents } = useDocuments();
  const { data: fsStatus } = useFsStatus();
  const folderSearch = useFolderFileSearch(text, state.folders, !!fsStatus?.enabled);
  const folderFiles = currentFolderFiles(folderSearch, text);

  const items = useMemo(() => buildQuickOpenItems({
    openTabs: state.openTabs,
    recent: state.recent,
    documents: (documents ?? []).map(d => ({ id: d.id, title: d.title })),
    folderFiles,
    query: text,
  }), [state.openTabs, state.recent, documents, folderFiles, text]);
  const folderCount = items.filter(i => i.source === "folder").length;

  return (
    <>
      {FILE_GROUPS.map(({ source, heading }) => {
        const rows = items.filter(i => i.source === source);
        if (rows.length === 0) return null;
        const forceMount = source === "folder";
        return (
          <Cmdk.Group key={source} heading={heading} className={groupClass} forceMount={forceMount}>
            {rows.map(item => (
              <Cmdk.Item
                key={item.uri}
                value={item.uri}
                keywords={[item.label]}
                forceMount={forceMount}
                onSelect={() => onChoose(() => open(item.uri))}
                className={itemClass}
                title={item.detail === "Document" ? item.label : `${item.detail}${item.detail.includes("\\") ? "\\" : "/"}${item.label}`}
              >
                {item.uri.startsWith("db:")
                  ? <Library className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                  : <File className="w-3.5 h-3.5 shrink-0 text-gray-400" />}
                <span className="truncate shrink-0 max-w-[60%]">{item.label}</span>
                <span className="truncate text-[11px] text-gray-400">{item.detail}</span>
              </Cmdk.Item>
            ))}
          </Cmdk.Group>
        );
      })}
      {folderSearch.loading && <Note>Searching folders…</Note>}
      {!folderSearch.loading && folderSearch.truncated && <Note>More matches — keep typing</Note>}
      {!folderSearch.loading && (
        <EmptyWhenNothingShown others={folderCount}>
          No matching files. Type &gt; for commands, @ for headings, : for a line.
        </EmptyWhenNothingShown>
      )}
    </>
  );
}

// ── Commands ─────────────────────────────────────────────────────────────────

function CommandItems({ onChoose }: { onChoose(action: () => void): void }) {
  const { activeUri } = useWorkspace();
  const version = useCommandRegistryVersion();
  const groups = useMemo(() => {
    const ctx = { activeUri };
    const byCategory = new Map<string, Command[]>();
    for (const command of commandRegistry.enabled(ctx)) {
      byCategory.set(command.category, [...(byCategory.get(command.category) ?? []), command]);
    }
    return Array.from(byCategory);
    // `version` changes whenever commands are added or removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUri, version]);

  return (
    <>
      {groups.map(([category, commands]) => (
        <Cmdk.Group key={category} heading={category} className={groupClass}>
          {commands.map(command => (
            <Cmdk.Item
              key={command.id}
              // Ranked on "Category: Title", as VS Code does; ids never take part in matching.
              value={`${category}: ${command.title}`}
              onSelect={() => onChoose(() => command.run({ activeUri }))}
              className={itemClass}
            >
              <span className="truncate">{command.title}</span>
              {command.keys && (
                <kbd className="ml-auto shrink-0 font-sans text-[11px] text-gray-400 tracking-wide">
                  {formatKeys(command.keys, IS_MAC)}
                </kbd>
              )}
            </Cmdk.Item>
          ))}
        </Cmdk.Group>
      ))}
      <EmptyWhenNothingShown others={0}>No matching commands.</EmptyWhenNothingShown>
    </>
  );
}

// ── Headings (@) and lines (:) ───────────────────────────────────────────────

/** The editor for the active tab, if it has published its text. */
function useEditorForActiveTab() {
  const active = useActiveEditor();
  const { activeUri } = useWorkspace();
  return active && active.uri === activeUri ? active : null;
}

function HeadingItems({ onChoose }: { onChoose(action: () => void): void }) {
  const active = useEditorForActiveTab();
  const isMarkdown = active?.fileType === "md";
  const headings = useMemo(() => (active && isMarkdown ? parseOutline(active.content) : []), [active, isMarkdown]);

  if (!active || !isMarkdown) return <Note>Open a Markdown document to jump to its headings.</Note>;
  if (headings.length === 0) return <Note>No headings in this document.</Note>;
  const minLevel = headings.reduce((m, h) => Math.min(m, h.level), 6);
  return (
    <>
      {headings.map(h => (
        <Cmdk.Item
          key={`${h.line}`}
          // cmdk ranks on the value too, so it is the heading text (the line keeps repeats unique).
          value={`${h.text} #${h.line}`}
          onSelect={() => onChoose(() => requestReveal(active.uri, { line: h.line, heading: { text: h.text, occurrence: h.occurrence } }))}
          className={itemClass}
          style={{ paddingLeft: 8 + (h.level - minLevel) * 14 }}
        >
          <span className="shrink-0 w-5 text-[9px] font-mono text-gray-400">H{h.level}</span>
          <span className="truncate">{h.text}</span>
          <span className="ml-auto shrink-0 text-[11px] text-gray-400">{h.line + 1}</span>
        </Cmdk.Item>
      ))}
      <EmptyWhenNothingShown others={0}>No matching headings.</EmptyWhenNothingShown>
    </>
  );
}

function LineItem({ line, onChoose }: { line: number | null; onChoose(action: () => void): void }) {
  const active = useEditorForActiveTab();
  if (!active) return <Note>Open a document to go to a line.</Note>;
  const lineCount = active.content.split(/\r?\n/).length;
  if (line === null) return <Note>Type a line number between 1 and {lineCount}.</Note>;
  const target = clampLine(line, lineCount);
  return (
    <Cmdk.Item
      value="go-to-line"
      forceMount
      onSelect={() => onChoose(() => requestReveal(active.uri, { line: target - 1 }))}
      className={itemClass}
    >
      Go to line {target}
      <span className="ml-auto text-[11px] text-gray-400">of {lineCount}</span>
    </Cmdk.Item>
  );
}
