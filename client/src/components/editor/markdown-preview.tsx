import { memo, type ComponentPropsWithoutRef, type MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import { useLocation } from "wouter";

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

const components: Components = { a: PreviewLink };

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
