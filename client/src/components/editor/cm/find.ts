import { StateEffect, StateField, type Text, type TransactionSpec } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { SearchCursor } from "@codemirror/search";

/** A span of the document in editor positions. */
export type Range = [start: number, end: number];

const MAX_MATCHES = 10_000;

/**
 * Every occurrence of `query` in `doc` (case-insensitive unless `matchCase`),
 * in editor positions. Matches starting before `from` are left out (used to
 * skip folded front matter).
 */
export function findInDoc(doc: Text, query: string, matchCase: boolean, from = 0): Range[] {
  if (!query) return [];
  const cursor = new SearchCursor(doc, query, from, doc.length, matchCase ? undefined : s => s.toLowerCase());
  const out: Range[] = [];
  while (out.length < MAX_MATCHES && !cursor.next().done) out.push([cursor.value.from, cursor.value.to]);
  return out;
}

/** Sets (or, with null, clears) the find matches painted in the editor. */
export const setFindHighlights = StateEffect.define<{ ranges: Range[]; current: number } | null>();

const matchMark = Decoration.mark({ class: "cm-find-match" });
const currentMark = Decoration.mark({ class: "cm-find-current" });

/** Find matches as decorations; they follow edits until the next update. */
export const findHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    marks = marks.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setFindHighlights)) continue;
      marks = effect.value
        ? Decoration.set(
          effect.value.ranges
            .filter(([from, to]) => to > from && to <= tr.state.doc.length)
            .map(([from, to], i) => (i === effect.value!.current ? currentMark : matchMark).range(from, to)),
          true,
        )
        : Decoration.none;
    }
    return marks;
  },
  provide: field => EditorView.decorations.from(field),
});

/** Replaces every range with `replacement` in one transaction (one undo step). */
export function replaceMatchesSpec(ranges: Range[], replacement: string): TransactionSpec {
  return {
    changes: ranges.map(([from, to]) => ({ from, to, insert: replacement })),
    userEvent: "input.replace",
    scrollIntoView: true,
  };
}
