import { parse as parseYaml } from "yaml";
import { isImagePath } from "@shared/fs";

/** Leading YAML front matter (between --- lines) split from the body. */
export interface FrontMatter {
  /** The block including its closing --- line and line break, or "" if there is none. */
  block: string;
  /** Lines the block takes up. */
  lines: number;
  body: string;
  /** Parsed values (null if the YAML is invalid). */
  data: Record<string, unknown> | null;
}

const FRONT_MATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

export function splitFrontMatter(markdown: string): FrontMatter {
  const match = FRONT_MATTER.exec(markdown);
  if (!match) return { block: "", lines: 0, body: markdown, data: null };
  const block = match[0];
  let data: Record<string, unknown> | null = null;
  try {
    const parsed = parseYaml(match[1]);
    data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    data = null;
  }
  return { block, lines: block.split("\n").length - (block.endsWith("\n") ? 1 : 0), body: markdown.slice(block.length), data };
}

/** Width hint carried in an image title, from Obsidian's ![[image.png|300]]. */
export const WIDTH_TITLE_PREFIX = "mdc-width:";

const WIKI_EMBED = /!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Rewrites Obsidian image embeds (![[path/image.png]] and ![[image.png|300]])
 * as standard Markdown images, outside fenced code blocks. Embeds of notes
 * (not images) are left as they are.
 */
export function rewriteWikiEmbeds(markdown: string): string {
  if (!markdown.includes("![[")) return markdown;
  let fence: string | null = null;
  return markdown.split("\n").map(line => {
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      return line;
    }
    if (f) {
      fence = f[1];
      return line;
    }
    return line.replace(WIKI_EMBED, (whole, target: string, alias?: string) => {
      const file = target.trim();
      if (!isImagePath(file)) return whole;
      const size = alias?.trim().match(/^(\d+)(?:x\d+)?$/);
      const alt = size || !alias ? file.split("/").pop() ?? file : alias.trim();
      const title = size ? ` "${WIDTH_TITLE_PREFIX}${size[1]}"` : "";
      return `![${alt.replace(/[[\]]/g, "")}](<${file}>${title})`;
    });
  }).join("\n");
}
