import {
  EditorSelection, EditorState, Facet, RangeSet, StateEffect, StateField, Transaction,
  type ChangeSpec, type Extension, type Text,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { splitFrontMatter } from "@/lib/markdown-source";

/** Front matter larger than this is not looked for (it would be scanned on every fold). */
const SCAN_LIMIT = 200_000;

/**
 * Position just after the leading YAML front matter block (its closing line
 * break included), or 0 when there is none. Measured in editor positions,
 * where every line break counts as one, whatever the file's line endings.
 */
export function frontMatterEnd(doc: Text): number {
  return splitFrontMatter(doc.sliceString(0, Math.min(doc.length, SCAN_LIMIT))).block.length;
}

export const setFrontMatterHidden = StateEffect.define<boolean>();

interface FoldConfig { initiallyHidden: boolean; onUnfold(): void }

const foldConfig = Facet.define<FoldConfig, FoldConfig>({
  combine: values => values[0] ?? { initiallyHidden: false, onUnfold() {} },
});

/**
 * Whether the front matter is folded away, and where it ends. Defined once at
 * module level, so it survives `StateEffect.reconfigure` (saved editor states).
 */
export const frontMatterField = StateField.define<{ hidden: boolean; end: number }>({
  create: state => {
    const hidden = state.facet(foldConfig).initiallyHidden;
    return { hidden, end: hidden ? frontMatterEnd(state.doc) : 0 };
  },
  update(value, tr) {
    let { hidden, end } = value;
    let recompute = false;
    for (const effect of tr.effects) {
      if (effect.is(setFrontMatterHidden)) {
        hidden = effect.value;
        recompute = true;
      }
    }
    // While folded, only unfiltered transactions (whole-document updates,
    // undo/redo) can reach the block; anything after it leaves `end` alone.
    if (hidden && tr.docChanged && tr.changes.touchesRange(0, end)) recompute = true;
    if (recompute) end = hidden ? frontMatterEnd(tr.state.doc) : 0;
    return hidden === value.hidden && end === value.end ? value : { hidden, end };
  },
});

/** Last position the fold covers: the end of the closing `---` line. */
function foldedTo(state: EditorState, end: number) {
  return state.doc.lineAt(end - 1).to;
}

class FrontMatterWidget extends WidgetType {
  constructor(readonly lines: number, readonly onUnfold: () => void) {
    super();
  }
  eq(other: FrontMatterWidget) {
    return other.lines === this.lines;
  }
  toDOM() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-front-matter-fold";
    button.textContent = `Front matter · ${this.lines} lines — click to show`;
    button.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.onUnfold();
    });
    return button;
  }
  ignoreEvent() {
    return true;
  }
}

const foldDecorations = EditorView.decorations.compute([frontMatterField, foldConfig], state => {
  const { hidden, end } = state.field(frontMatterField);
  if (!hidden || !end) return Decoration.none;
  const to = foldedTo(state, end);
  const widget = new FrontMatterWidget(state.doc.lineAt(to).number, state.facet(foldConfig).onUnfold);
  return Decoration.set(Decoration.replace({ block: true, widget }).range(0, to));
});

const foldAtomic = EditorView.atomicRanges.of(view => {
  const { hidden, end } = view.state.field(frontMatterField);
  if (!hidden || !end) return RangeSet.empty;
  return RangeSet.of(Decoration.mark({}).range(0, foldedTo(view.state, end)));
});

/**
 * Keeps folded front matter out of reach. A selection can only reach the
 * hidden block from position 0 (it is atomic), so changes starting there
 * (select-all + type or delete, typing at the very top) are moved to the
 * start of the body. Any other change that reaches into the block comes from
 * a command (Backspace at the top of the body, Alt+Up, transpose) and the
 * whole transaction is dropped, so it can't half-apply. Front matter with no
 * final line break gets one before the first text typed after it, so the
 * closing --- line stays intact. Undo and redo pass through, so history stays
 * consistent.
 */
const protectFolded = EditorState.transactionFilter.of(tr => {
  if (!tr.docChanged || tr.isUserEvent("undo") || tr.isUserEvent("redo")) return tr;
  const start = tr.startState;
  const { hidden, end } = start.field(frontMatterField);
  if (!hidden || !end) return tr;
  const openEnded = end === start.doc.length && start.sliceDoc(end - 1, end) !== "\n";
  let reachesIn = false;
  let fromTop = false;
  let appendsToOpenEnd = false;
  tr.changes.iterChanges((fromA, _toA, _fromB, _toB, inserted) => {
    if (fromA === 0) fromTop = true;
    else if (fromA < end) reachesIn = true;
    if (openEnded && fromA === end && inserted.length) appendsToOpenEnd = true;
  });
  if (reachesIn) return [];
  if (!fromTop && !appendsToOpenEnd) return tr;
  const changes: ChangeSpec[] = [];
  let needsBreak = openEnded;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const from = Math.max(fromA, end);
    const to = Math.max(toA, from);
    let insert = inserted.sliceString(0);
    if (needsBreak && from === end && insert) {
      insert = "\n" + insert;
      needsBreak = false;
    }
    if (from !== to || insert) changes.push({ from, to, insert });
  });
  const set = tr.startState.changes(changes);
  return {
    changes: set,
    selection: EditorSelection.cursor(set.mapPos(end, 1)),
    scrollIntoView: tr.scrollIntoView,
    userEvent: tr.annotation(Transaction.userEvent),
  };
});

/** Folds leading YAML front matter into a one-line button, protected from edits. */
export function frontMatterFold(config: FoldConfig): Extension {
  return [foldConfig.of(config), frontMatterField, foldDecorations, foldAtomic, protectFolded];
}
