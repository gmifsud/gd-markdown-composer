// Scrolling helpers for "jump to" from the Outline and search results.

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

const MIRRORED_STYLES = [
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "tabSize",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
] as const;

/** Pixel offset of character `offset` inside a textarea, accounting for soft wrapping. */
function caretTop(ta: HTMLTextAreaElement, offset: number) {
  const style = getComputedStyle(ta);
  const mirror = document.createElement("div");
  for (const prop of MIRRORED_STYLES) mirror.style[prop] = style[prop];
  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    top: "0",
    left: "-99999px",
    boxSizing: "border-box",
    width: `${ta.clientWidth}px`,
    whiteSpace: ta.getAttribute("wrap") === "off" ? "pre" : "pre-wrap",
    overflowWrap: "break-word",
  });
  mirror.textContent = ta.value.slice(0, offset);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  mirror.remove();
  return top;
}

/** Selects a range in the source textarea and scrolls it to about a third of the way down. */
export function revealInTextarea(ta: HTMLTextAreaElement, [start, end]: [number, number]) {
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(start, end);
  ta.scrollTop = Math.max(0, caretTop(ta, start) - ta.clientHeight / 3);
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
