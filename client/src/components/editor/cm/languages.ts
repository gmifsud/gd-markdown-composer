import type { Extension } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { html } from "@codemirror/lang-html";
import { xml } from "@codemirror/lang-xml";
import { languages } from "@codemirror/language-data";
import type { FileKind } from "@shared/fs";

/**
 * Syntax support for a file type. Fenced code blocks in Markdown load their
 * language on demand (language-data uses dynamic imports, one chunk each).
 * Mermaid and plain text get none.
 */
export function languageFor(fileType: FileKind): Extension {
  switch (fileType) {
    case "md": return markdown({ base: markdownLanguage, codeLanguages: languages });
    case "json": return json();
    case "yaml": return yaml();
    case "html": return html();
    case "drawio": return xml();
    default: return [];
  }
}

/** Name used in the editor's accessible label. */
export function languageLabel(fileType: FileKind): string {
  switch (fileType) {
    case "md": return "Markdown";
    case "json": return "JSON";
    case "yaml": return "YAML";
    case "html": return "HTML";
    case "drawio": return "Draw.io XML";
    case "mermaid": return "Mermaid";
    default: return "Text";
  }
}
