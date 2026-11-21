import { Compartment, EditorState, Facet, Prec, StateEffect, type Extension } from "@codemirror/state";
import {
  EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { linter, lintGutter } from "@codemirror/lint";
import type { FileKind } from "@shared/fs";
import { jsonDiagnostics, yamlDiagnostics } from "@/lib/structured";
import { markdownFormattingKeymap } from "./markdown-commands";
import { frontMatterFold } from "./front-matter-fold";
import { findHighlightField } from "./find";
import { languageFor, languageLabel } from "./languages";
import { editorHighlight, editorTheme } from "./theme";

export interface SourceEditorConfig {
  fileType: FileKind;
  readOnly: boolean;
  /** Soft-wrap long lines (off for plain text files). */
  wrap: boolean;
  compact: boolean;
  placeholder?: string;
  frontMatterHidden: boolean;
  onUnfoldFrontMatter(): void;
  /** Called with the full text (in the file's own line endings) after every change. */
  onDocChange(text: string): void;
}

/** What a closed editor leaves behind, so reopening it keeps undo history and scroll. */
export interface SavedEditor {
  state: EditorState;
  scroll: StateEffect<unknown>;
}

/**
 * The file's own line break. CodeMirror stores lines without their endings
 * (and splits on \r\n, \r and \n alike), so the editor always counts a line
 * break as one position; text is written back with this separator.
 */
export function lineSeparatorOf(text: string): "\r\n" | "\n" {
  const lf = text.indexOf("\n");
  return lf > 0 && text[lf - 1] === "\r" ? "\r\n" : "\n";
}

const fileLineBreak = Facet.define<string, string>({ combine: values => values[0] ?? "\n" });

/** The document as file text, in the file's own line endings. */
export function docText(state: EditorState): string {
  return state.doc.sliceString(0, state.doc.length, state.facet(fileLineBreak));
}

// Module-level so their identity survives StateEffect.reconfigure (saved states).
const themeSlot = new Compartment();
const wrapSlot = new Compartment();
const readOnlySlot = new Compartment();

const themeFor = (config: SourceEditorConfig) => editorTheme(config.compact);
const wrapFor = (config: SourceEditorConfig) => (config.wrap ? EditorView.lineWrapping : []);
const readOnlyFor = (config: SourceEditorConfig) => [
  EditorState.readOnly.of(config.readOnly),
  EditorView.editable.of(!config.readOnly),
];

function buildExtensions(text: string, config: SourceEditorConfig): Extension[] {
  const { fileType } = config;
  const isMarkdown = fileType === "md";
  const diagnostics = fileType === "json" ? jsonDiagnostics : fileType === "yaml" ? yamlDiagnostics : null;
  return [
    fileLineBreak.of(lineSeparatorOf(text)),
    history(),
    drawSelection(),
    highlightActiveLine(),
    isMarkdown ? [] : [lineNumbers(), highlightActiveLineGutter()],
    bracketMatching(),
    indentOnInput(),
    // Above the default keymap, whose Mod-i would select the parent syntax node.
    isMarkdown ? Prec.high(keymap.of(markdownFormattingKeymap)) : [],
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    // markdown() also adds its own keymap: Enter continues lists, Backspace removes markup.
    languageFor(fileType),
    editorHighlight,
    themeSlot.of(themeFor(config)),
    wrapSlot.of(wrapFor(config)),
    readOnlySlot.of(readOnlyFor(config)),
    config.placeholder ? placeholder(config.placeholder) : [],
    isMarkdown
      ? frontMatterFold({ initiallyHidden: config.frontMatterHidden, onUnfold: () => config.onUnfoldFrontMatter() })
      : [],
    findHighlightField,
    // Diagnostics read the "\n"-joined text, so their offsets are editor positions.
    diagnostics ? [linter(view => diagnostics(view.state.doc.toString()), { delay: 300 }), lintGutter()] : [],
    EditorView.contentAttributes.of({ "aria-label": `${languageLabel(fileType)} source` }),
    EditorView.updateListener.of(update => {
      if (update.docChanged) config.onDocChange(docText(update.state));
    }),
  ];
}

export function createEditorState(text: string, config: SourceEditorConfig): EditorState {
  return EditorState.create({ doc: text, extensions: buildExtensions(text, config) });
}

/** Effects that apply new read-only, wrap and spacing settings to a running editor. */
export function reconfigure(config: SourceEditorConfig): StateEffect<unknown>[] {
  return [
    themeSlot.reconfigure(themeFor(config)),
    wrapSlot.reconfigure(wrapFor(config)),
    readOnlySlot.reconfigure(readOnlyFor(config)),
  ];
}

/**
 * A saved state with fresh extensions (new callbacks), keeping its undo
 * history, selection and folds. Null when the text has changed since it was
 * saved, so the caller starts over.
 */
export function restoreEditorState(saved: EditorState, text: string, config: SourceEditorConfig): EditorState | null {
  if (docText(saved) !== text) return null;
  return saved.update({ effects: StateEffect.reconfigure.of(buildExtensions(text, config)) }).state;
}
