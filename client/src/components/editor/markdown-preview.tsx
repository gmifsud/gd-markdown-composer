import { createContext, memo, useContext, useMemo, useState, type ComponentPropsWithoutRef, type MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import { useLocation } from "wouter";
import { ChevronDown, ChevronRight, ImageOff, TextSelect } from "lucide-react";
import { DiagramBlock, DIAGRAM_LANGUAGES } from "@/components/editor/diagrams";
import { Expandable } from "@/components/editor/lightbox";
import { useFsStatus } from "@/lib/fs-api";
import { rewriteWikiEmbeds, splitFrontMatter, WIDTH_TITLE_PREFIX } from "@/lib/markdown-source";
import { useWorkspace, useWorkspaceActions } from "@/lib/workspace";
import rehypeHighlight from "rehype-highlight";

// Ids from the document (headings, footnotes, raw HTML) get a prefix, as on
// GitHub, so they can't collide with ids the app uses. `#section` links map to it.
const ID_PREFIX = "user-content-";

// Raw HTML in notes (<img>, <details>, <kbd>…) is rendered, then sanitised:
// scripts, event handlers and unsafe URLs are removed.
const sanitizeSchema = {
  ...defaultSchema,
  clobberPrefix: ID_PREFIX,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark", "u", "center", "figure", "figcaption"],
  attributes: {
    ...defaultSchema.attributes,
    img: [...(defaultSchema.attributes?.img ?? []), "title", "width", "height", "align", "className"],
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "align"],
  },
};

const remarkPlugins = [remarkGfm];
const rehypePlugins: NonNullable<ComponentPropsWithoutRef<typeof ReactMarkdown>["rehypePlugins"]> = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  [rehypeHighlight, { ignoreMissing: true }],
  // After sanitising, so heading ids get the prefix exactly once.
  [rehypeSlug, { prefix: ID_PREFIX }],
];
// Footnote ids are prefixed by the sanitiser, so don't prefix them here as well.
const remarkRehypeOptions = { clobberPrefix: "" };

const EXTERNAL_LINK = /^(https?:|mailto:)/i;
const IN_APP_DOCUMENT_LINK = /^\/d\/\d+$/;
const EXTERNAL_IMAGE = /^(https?:|data:|blob:)/i;

/** Where the document lives, so relative and ![[…]] images can be found. */
interface PreviewSource {
  docPath?: string;
  rootFolder?: string | null;
}

const PreviewSourceContext = createContext<PreviewSource>({});

type LinkProps = ComponentPropsWithoutRef<"a"> & { node?: unknown };

function PreviewLink({ href, children, node: _node, ...rest }: LinkProps) {
  const [, setLocation] = useLocation();

  if (!href) return <a {...rest}>{children}</a>;

  // In-page anchors (headings, footnotes) scroll inside the preview pane.
  if (href.startsWith("#")) {
    const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      const raw = decodeURIComponent(href.slice(1));
      const id = raw.startsWith(ID_PREFIX) ? raw : ID_PREFIX + raw;
      const root = e.currentTarget.closest("[data-preview-root]");
      root?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    return <a {...rest} href={href} onClick={onClick}>{children}</a>;
  }

  // Web and mail links open outside the app (a new browser tab, or the
  // system browser in the desktop app).
  if (EXTERNAL_LINK.test(href)) {
    return <a {...rest} href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  }

  // Links to other documents (/d/<id>) open them in the editor.
  if (IN_APP_DOCUMENT_LINK.test(href)) {
    const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      setLocation(href);
    };
    return <a {...rest} href={href} onClick={onClick}>{children}</a>;
  }

  // Relative file links can't be resolved yet; keep them from navigating the app away.
  return (
    <a
      {...rest}
      href={href}
      onClick={(e) => e.preventDefault()}
      title={`Relative links aren't supported yet: ${href}`}
      className="cursor-not-allowed"
    >
      {children}
    </a>
  );
}

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

/** ```mermaid, ```plantuml/```puml and ```drawio blocks render as diagrams; other code stays code. */
function PreviewPre({ node, children, ...rest }: ComponentPropsWithoutRef<"pre"> & { node?: unknown }) {
  const code = (node as HastNode | undefined)?.children?.[0];
  let language: string | undefined;
  if (code?.type === "element" && code.tagName === "code") {
    const classes = Array.isArray(code.properties?.className) ? (code.properties.className as string[]) : [];
    language = classes.find(c => c.startsWith("language-"))?.slice("language-".length).toLowerCase();
    const kind = language ? DIAGRAM_LANGUAGES[language as keyof typeof DIAGRAM_LANGUAGES] : undefined;
    if (kind) {
      const text = (code.children ?? []).map(c => c.value ?? "").join("").replace(/\n$/, "");
      return <DiagramBlock kind={kind} code={text} />;
    }
  }
  return (
    <div className="mdc-code-block not-prose my-4 overflow-hidden rounded-lg border border-slate-700 bg-[#0b1220] text-gray-100" data-code-block>
      <div className="flex h-8 items-center justify-between border-b border-slate-700 bg-slate-800/70 px-3 text-[11px] text-slate-300">
        <span className="font-mono uppercase tracking-wide" data-code-language>{language || "text"}</span>
        <button
          type="button"
          className="flex h-6 items-center gap-1 rounded px-1.5 text-slate-300 hover:bg-slate-700 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-400"
          title="Select all code"
          aria-label="Select all code"
          onClick={event => {
            const codeElement = event.currentTarget.closest("[data-code-block]")?.querySelector("code");
            if (!codeElement) return;
            const selection = window.getSelection();
            if (!selection) return;
            const range = window.document.createRange();
            range.selectNodeContents(codeElement);
            selection.removeAllRanges();
            selection.addRange(range);
          }}
          data-testid="select-code"
        >
          <TextSelect className="h-3.5 w-3.5" />
          <span>Select all</span>
        </button>
      </div>
      <pre {...rest} className="!m-0 !overflow-x-auto !rounded-none !bg-transparent !p-4">
        {children}
      </pre>
    </div>
  );
}

/** Local images load through the app's server, which finds them on disk. */
function useImageUrl(src: string | undefined) {
  const { docPath, rootFolder } = useContext(PreviewSourceContext);
  const { data: status } = useFsStatus();
  if (!src || EXTERNAL_IMAGE.test(src) || !docPath || !status?.imageToken) return src;
  const params = new URLSearchParams({ token: status.imageToken, doc: docPath, target: src });
  if (rootFolder) params.set("root", rootFolder);
  return `/api/fs/image?${params}`;
}

/** Images resolve against the document's folder and get an Expand button. */
function PreviewImage({ node: _node, src, alt, title, width, ...rest }: ComponentPropsWithoutRef<"img"> & { node?: unknown }) {
  const url = useImageUrl(src);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  // ![[image.png|300]] carries its width in the title.
  const widthHint = title?.startsWith(WIDTH_TITLE_PREFIX) ? title.slice(WIDTH_TITLE_PREFIX.length) : undefined;
  if (!url) return <img alt={alt} {...rest} />;
  if (failedUrl === url) {
    return (
      <span className="not-prose inline-flex items-center gap-1.5 rounded border border-dashed border-gray-300 px-2 py-1 text-[12px] text-gray-500" data-testid="image-missing">
        <ImageOff className="w-3.5 h-3.5" /> Image not found: {src}
      </span>
    );
  }
  return (
    <Expandable
      inline
      title={alt || "Image"}
      renderFull={() => <img className="w-full h-full object-contain" src={url} alt={alt} draggable={false} />}
    >
      <img
        src={url}
        alt={alt}
        title={widthHint ? alt : title}
        width={widthHint ?? width}
        loading="lazy"
        onError={() => setFailedUrl(url)}
        {...rest}
      />
    </Expandable>
  );
}

const components: Components = { a: PreviewLink, pre: PreviewPre, img: PreviewImage };

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** YAML front matter as a compact, collapsible "Properties" block. */
function FrontMatterCard({ data, raw }: { data: Record<string, unknown> | null; raw: string }) {
  const { state } = useWorkspace();
  const { setFrontMatterOpen } = useWorkspaceActions();
  const open = state.frontMatterOpen;
  const entries = data ? Object.entries(data) : [];
  const summary = entries.slice(0, 4).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : formatValue(v)}`).join(" · ");

  return (
    <div className="not-prose mb-4 rounded-md border border-gray-200 bg-gray-50/80 text-[12px] text-gray-600" data-front-matter data-testid="front-matter">
      <button
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-gray-100 rounded-md"
        onClick={() => setFrontMatterOpen(!open)}
        aria-expanded={open}
        data-testid="front-matter-toggle"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
        <span className="font-semibold text-gray-700 shrink-0">Properties</span>
        <span className="text-gray-400 shrink-0">({entries.length || "invalid YAML"})</span>
        {!open && <span className="truncate text-gray-500">{summary}</span>}
      </button>
      {open && (
        data ? (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 px-3 pb-2 pt-0.5">
            {entries.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-gray-500">{key}</dt>
                <dd className="min-w-0 break-words text-gray-800">
                  {Array.isArray(value)
                    ? <span className="flex flex-wrap gap-1">{value.map((v, i) => (
                        <span key={i} className="rounded-full bg-white border border-gray-200 px-1.5 leading-5">{formatValue(v)}</span>
                      ))}</span>
                    : formatValue(value)}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <pre className="px-3 pb-2 whitespace-pre-wrap font-mono text-[11px]">{raw}</pre>
        )
      )}
    </div>
  );
}

interface MarkdownPreviewProps {
  content: string;
  className?: string;
  /** Absolute path of the document, for resolving relative images. */
  docPath?: string;
  /** Workspace folder the document is in (an Obsidian vault root). */
  rootFolder?: string | null;
}

export const MarkdownPreview = memo(function MarkdownPreview({ content, className, docPath, rootFolder }: MarkdownPreviewProps) {
  const { block, body, data } = useMemo(() => splitFrontMatter(content), [content]);
  const markdown = useMemo(() => rewriteWikiEmbeds(body), [body]);
  const source = useMemo(() => ({ docPath, rootFolder }), [docPath, rootFolder]);

  return (
    <PreviewSourceContext.Provider value={source}>
      <div className={className} data-preview-root>
        {block && <FrontMatterCard data={data} raw={block} />}
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          remarkRehypeOptions={remarkRehypeOptions}
          components={components}
        >
          {markdown.trim() ? markdown : "*Nothing to preview*"}
        </ReactMarkdown>
      </div>
    </PreviewSourceContext.Provider>
  );
});
