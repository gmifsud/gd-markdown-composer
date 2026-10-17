import { memo, type ComponentPropsWithoutRef, type MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import { useLocation } from "wouter";
import { DiagramBlock, DIAGRAM_LANGUAGES } from "@/components/editor/diagrams";
import { Expandable } from "@/components/editor/lightbox";

// Heading ids get a prefix (as on GitHub) so a heading like "# Root" can't
// collide with ids used by the app itself. `#section` links are mapped to it.
const HEADING_ID_PREFIX = "user-content-";

const remarkPlugins = [remarkGfm];
const rehypePlugins: NonNullable<ComponentPropsWithoutRef<typeof ReactMarkdown>["rehypePlugins"]> = [
  [rehypeSlug, { prefix: HEADING_ID_PREFIX }],
];

const EXTERNAL_LINK = /^(https?:|mailto:)/i;
const IN_APP_DOCUMENT_LINK = /^\/d\/\d+$/;

type LinkProps = ComponentPropsWithoutRef<"a"> & { node?: unknown };

function PreviewLink({ href, children, node: _node, ...rest }: LinkProps) {
  const [, setLocation] = useLocation();

  if (!href) return <a {...rest}>{children}</a>;

  // In-page anchors scroll inside the preview pane.
  if (href.startsWith("#")) {
    const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      const id = HEADING_ID_PREFIX + decodeURIComponent(href.slice(1));
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
  if (code?.type === "element" && code.tagName === "code") {
    const classes = Array.isArray(code.properties?.className) ? (code.properties.className as string[]) : [];
    const lang = classes.find(c => c.startsWith("language-"))?.slice("language-".length).toLowerCase();
    const kind = lang ? DIAGRAM_LANGUAGES[lang as keyof typeof DIAGRAM_LANGUAGES] : undefined;
    if (kind) {
      const text = (code.children ?? []).map(c => c.value ?? "").join("").replace(/\n$/, "");
      return <DiagramBlock kind={kind} code={text} />;
    }
  }
  return <pre {...rest}>{children}</pre>;
}

/** Images get an Expand button that opens them full screen. */
function PreviewImage({ node: _node, src, alt, ...rest }: ComponentPropsWithoutRef<"img"> & { node?: unknown }) {
  if (!src) return <img alt={alt} {...rest} />;
  return (
    <Expandable
      inline
      title={alt || "Image"}
      renderFull={() => <img className="w-full h-full object-contain" src={src} alt={alt} draggable={false} />}
    >
      <img src={src} alt={alt} {...rest} />
    </Expandable>
  );
}

const components: Components = { a: PreviewLink, pre: PreviewPre, img: PreviewImage };

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

export const MarkdownPreview = memo(function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  return (
    <div className={className} data-preview-root>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {content || "*Nothing to preview*"}
      </ReactMarkdown>
    </div>
  );
});
