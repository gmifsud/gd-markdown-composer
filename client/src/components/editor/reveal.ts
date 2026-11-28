// Scrolling helpers for "jump to" from the Outline and search results.
import { EditorSelection, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Range } from "@/components/editor/cm/find";

/** Editor range of `line` (0-based, clamped), narrowed to the first case-insensitive match of `query` on it. */
export function lineRangeInDoc(doc: Text, line: number, query?: string): Range {
  const { from, to, text } = doc.line(Math.max(1, Math.min(line + 1, doc.lines)));
  if (query) {
    const at = text.toLowerCase().indexOf(query.toLowerCase());
    if (at >= 0) return [from + at, from + at + query.length];
  }
  return [from, to];
}

/**
 * A jump to a bare line (Go to Line) can only be shown in the source; headings
 * and search matches can also be found in the preview. True when the source
 * editor has to be brought on screen first.
 */
export function needsSourceForReveal(target: { line: number; query?: string; heading?: unknown }, hasEditor: boolean) {
  return !hasEditor && !target.heading && !target.query;
}

/** Selects a range in the source editor and scrolls it to about a third of the way down. */
export function revealInEditor(view: EditorView, [from, to]: Range, opts: { focus?: boolean } = {}) {
  view.dispatch({
    selection: EditorSelection.range(from, to),
    effects: EditorView.scrollIntoView(from, { y: "start", yMargin: view.scrollDOM.clientHeight / 3 }),
  });
  if (opts.focus !== false) view.focus();
}

/** Character range of `line` (0-based), narrowed to the first match of `query` on it if given. */
export function lineRange(content: string, line: number, query?: string): [number, number] {
  let start = 0;
  for (let i = 0; i < line; i++) {
    const next = content.indexOf("\n", start);
    if (next < 0) break;
    start = next + 1;
  }
  const lineEnd = content.indexOf("\n", start);
  const end = lineEnd < 0 ? content.length : lineEnd;
  if (query) {
    const at = content.slice(start, end).toLowerCase().indexOf(query.toLowerCase());
    if (at >= 0) return [start + at, start + at + query.length];
  }
  return [start, end];
}

function scrollIntoContainer(container: HTMLElement, rect: DOMRect) {
  const box = container.getBoundingClientRect();
  container.scrollTop += rect.top - box.top - 16;
}

function flash(el: Element) {
  el.classList.remove("mdc-flash");
  // Restart the animation if it is already running.
  void (el as HTMLElement).offsetWidth;
  el.classList.add("mdc-flash");
}

/** Scrolls the preview to the `occurrence`-th heading whose text is `text`. */
export function revealHeadingInPreview(container: HTMLElement, text: string, occurrence: number) {
  const wanted = text.trim().toLowerCase();
  const headings = Array.from(container.querySelectorAll("h1, h2, h3, h4, h5, h6"))
    .filter(h => (h.textContent ?? "").trim().toLowerCase() === wanted);
  const target = headings[occurrence] ?? headings[0];
  if (!target) return false;
  scrollIntoContainer(container, target.getBoundingClientRect());
  flash(target);
  return true;
}

/**
 * Scrolls the preview to the `occurrence`-th place `query` appears in its text.
 * With `select`, the text is selected (preview-only layout); otherwise its
 * block flashes, because a page selection would clear the source selection.
 */
export function revealTextInPreview(container: HTMLElement, query: string, occurrence: number, select: boolean) {
  const needle = query.toLowerCase();
  // The Properties card shows front matter, which isn't part of the counted body text.
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("[data-front-matter]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let seen = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue ?? "").toLowerCase();
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
      if (seen++ < occurrence) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + query.length);
      scrollIntoContainer(container, range.getBoundingClientRect());
      if (select) {
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      } else if (node.parentElement) {
        flash(node.parentElement.closest("p, li, td, th, h1, h2, h3, h4, h5, h6, pre, blockquote") ?? node.parentElement);
      }
      return true;
    }
  }
  return false;
}

/** How many times `query` appears (case-insensitively) before `line`, plus the first on that line. */
export function occurrencesBefore(content: string, line: number, query: string) {
  const [lineStart] = lineRange(content, line);
  const before = content.slice(0, lineStart).toLowerCase();
  const needle = query.toLowerCase();
  let count = 0;
  for (let at = before.indexOf(needle); at >= 0; at = before.indexOf(needle, at + needle.length)) count++;
  return count;
}
