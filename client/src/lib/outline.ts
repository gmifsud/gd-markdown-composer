/** A Markdown heading, for the Outline panel. */
export interface OutlineHeading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  /** 0-based line in the source. */
  line: number;
  /** How many earlier headings have the same text (to find it in the preview). */
  occurrence: number;
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
// Lines that can't be the text of a setext heading.
const NOT_PARAGRAPH = /^ {0,3}(#|>|[-*+][ \t]|\d+[.)][ \t]|`{3}|~{3}|\||<)/;

/** Inline Markdown to plain text, close to what the preview renders. */
function plainText(md: string) {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

/**
 * Finds ATX (# Heading) and setext (underlined) headings, skipping YAML
 * front matter and fenced code blocks.
 */
export function parseOutline(markdown: string): OutlineHeading[] {
  const lines = markdown.split(/\r?\n/);
  const headings: OutlineHeading[] = [];
  const seen = new Map<string, number>();
  let fence: string | null = null;
  let i = 0;

  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, idx) => idx > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (end > 0) i = end + 1;
  }

  const add = (level: number, raw: string, line: number) => {
    const text = plainText(raw);
    if (!text) return;
    const key = text.toLowerCase();
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    headings.push({ level: level as OutlineHeading["level"], text, line, occurrence });
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = FENCE.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }

    const atx = ATX.exec(line);
    if (atx) {
      add(atx[1].length, atx[2] ?? "", i);
      continue;
    }

    const setext = SETEXT.exec(line);
    const previous = lines[i - 1];
    if (setext && i > 0 && previous.trim() && !NOT_PARAGRAPH.test(previous) && !SETEXT.test(previous)) {
      // Only the line directly above counts, which covers ordinary one-line titles.
      const alreadyHeading = headings.length > 0 && headings[headings.length - 1].line === i - 1;
      if (!alreadyHeading) add(setext[1][0] === "=" ? 1 : 2, previous, i - 1);
    }
  }
  return headings;
}
