import { EditorSelection, type ChangeSpec, type EditorState, type StateCommand } from "@codemirror/state";
import type { KeyBinding } from "@codemirror/view";

/**
 * True when `marker` sits at [from, from + marker.length) and is not part of a
 * longer run of the same character (so "*" never matches half of a "**").
 */
function exactMarkerAt(state: EditorState, from: number, marker: string): boolean {
  const to = from + marker.length;
  if (from < 0 || to > state.doc.length) return false;
  if (state.sliceDoc(from, to) !== marker) return false;
  const ch = marker[0];
  const before = from > 0 ? state.sliceDoc(from - 1, from) : "";
  const after = to < state.doc.length ? state.sliceDoc(to, to + 1) : "";
  return before !== ch && after !== ch;
}

/**
 * Wraps each selection in `marker` (e.g. "**" for bold), or removes the marker
 * when the selection is already wrapped, whether the markers are selected too
 * or sit just outside. An empty selection gets a pair with the cursor inside.
 */
export function toggleInlineMarkup(marker: string): StateCommand {
  const m = marker.length;
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const tr = state.changeByRange(range => {
      const { from, to } = range;
      // Markers are part of the selection: "**word**" selected.
      if (to - from >= 2 * m && exactMarkerAt(state, from, marker) && exactMarkerAt(state, to - m, marker)) {
        return {
          changes: [{ from, to: from + m }, { from: to - m, to }],
          range: EditorSelection.range(from, to - 2 * m),
        };
      }
      // Markers sit just outside the selection: "word" selected inside "**word**".
      if (exactMarkerAt(state, from - m, marker) && exactMarkerAt(state, to, marker)) {
        return {
          changes: [{ from: from - m, to: from }, { from: to, to: to + m }],
          range: EditorSelection.range(from - m, to - m),
        };
      }
      return {
        changes: [{ from, insert: marker }, { from: to, insert: marker }],
        range: EditorSelection.range(from + m, to + m),
      };
    });
    dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}

const URL_LIKE = /^(https?:\/\/|mailto:|\.{0,2}\/)\S+$/;

/**
 * Turns each selection into a Markdown link. Selected text becomes the link
 * text with "url" selected for typing; a selected URL becomes the target with
 * the cursor in the (empty) link text.
 */
export const insertLink: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const tr = state.changeByRange(({ from, to }) => {
    const text = state.sliceDoc(from, to);
    if (URL_LIKE.test(text)) {
      return { changes: { from, to, insert: `[](${text})` }, range: EditorSelection.cursor(from + 1) };
    }
    if (!text) {
      return { changes: { from, insert: "[](url)" }, range: EditorSelection.cursor(from + 1) };
    }
    const urlStart = from + text.length + 3;
    return {
      changes: { from, to, insert: `[${text}](url)` },
      range: EditorSelection.range(urlStart, urlStart + 3),
    };
  });
  dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
  return true;
};

const HEADING_PREFIX = /^#{1,6}[ \t]+/;

/** Makes every line the selection touches a heading of `level` (0 = plain paragraph). */
export function setHeading(level: 0 | 1 | 2 | 3 | 4 | 5 | 6): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const prefix = level ? `${"#".repeat(level)} ` : "";
    const changes: ChangeSpec[] = [];
    const seen = new Set<number>();
    for (const range of state.selection.ranges) {
      for (let pos = range.from; ;) {
        const line = state.doc.lineAt(pos);
        if (!seen.has(line.number)) {
          seen.add(line.number);
          const existing = HEADING_PREFIX.exec(line.text)?.[0] ?? "";
          if (existing !== prefix) changes.push({ from: line.from, to: line.from + existing.length, insert: prefix });
        }
        if (line.to >= range.to) break;
        pos = line.to + 1;
      }
    }
    if (!changes.length) return true;
    dispatch(state.update({ changes, scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}

/** Formatting shortcuts for Markdown sources. */
export const markdownFormattingKeymap: readonly KeyBinding[] = [
  { key: "Mod-b", run: toggleInlineMarkup("**") },
  { key: "Mod-i", run: toggleInlineMarkup("*") },
  { key: "Mod-e", run: toggleInlineMarkup("`") },
  { key: "Mod-k", run: insertLink },
  ...([0, 1, 2, 3, 4, 5, 6] as const).map(level => ({ key: `Mod-Alt-${level}`, run: setHeading(level) })),
];
