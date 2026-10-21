import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Copy, ExternalLink, Loader2 } from "lucide-react";
import { baseName, copyText, desktop, fsApi } from "@/lib/fs-api";
import type { XlsxCell, XlsxSheet } from "@shared/office";

/** Shared frame: title, path and actions above a read-only view. */
function OfficeFrame({ path, app, children }: { path: string; app: string; children: ReactNode }) {
  return (
    <div className="flex-1 flex flex-col min-w-0 bg-white shadow-sm ring-1 ring-black/[0.03] z-10 m-0 md:m-4 md:rounded-2xl overflow-hidden">
      <div className="h-14 border-b border-gray-100 flex items-center px-4 md:px-6 justify-between gap-4 shrink-0">
        <div className="min-w-0 flex flex-col">
          <span className="font-bold text-lg text-gray-900 tracking-tight truncate" title={path}>{baseName(path)}</span>
          <span className="text-[11px] text-gray-400 truncate" title={path}>{path}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-[12px]">
          <span className="text-gray-500 bg-gray-100 rounded-full px-2.5 py-1">Read-only view</span>
          {desktop?.openPath && (
            <button
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-gray-900 text-white hover:bg-gray-800"
              onClick={() => void desktop?.openPath?.(path)}
              title={`Open in ${app} to edit`}
              data-testid="button-open-external"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open in {app}
            </button>
          )}
          <button
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700"
            onClick={() => void copyText(path)}
          >
            <Copy className="w-3.5 h-3.5" /> Copy path
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

function Status({ error, label }: { error?: unknown; label: string }) {
  return (
    <div className="flex-1 flex items-center justify-center gap-2 text-sm text-gray-500 p-8 text-center">
      {error
        ? <><AlertCircle className="w-4 h-4 text-red-500 shrink-0" /> {(error as Error).message}</>
        : <><Loader2 className="w-4 h-4 animate-spin" /> {label}</>}
    </div>
  );
}

// ── Word (.docx) ─────────────────────────────────────────────────────────────

/** Renders a .docx with Word-like pages (docx-preview, loaded on first use). */
export function DocxView({ path }: { path: string }) {
  const body = useRef<HTMLDivElement>(null);
  const styles = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ loading: boolean; error?: unknown }>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    Promise.all([fsApi.raw(path), import("docx-preview")])
      .then(async ([bytes, { renderAsync }]) => {
        if (cancelled || !body.current || !styles.current) return;
        body.current.replaceChildren();
        styles.current.replaceChildren();
        await renderAsync(bytes, body.current, styles.current, {
          className: "docx",
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          useBase64URL: true,
        });
        if (!cancelled) setState({ loading: false });
      })
      .catch(error => { if (!cancelled) setState({ loading: false, error }); });
    return () => { cancelled = true; };
  }, [path]);

  return (
    <OfficeFrame path={path} app="Word">
      {(state.loading || !!state.error) && <Status error={state.error} label="Opening document…" />}
      <div ref={styles} hidden />
      <div
        ref={body}
        className={`flex-1 min-h-0 overflow-auto bg-[#f3f4f6] [&_.docx-wrapper]:bg-transparent [&_.docx-wrapper]:py-6 ${state.loading || !!state.error ? "hidden" : ""}`}
        // Links inside the document must not navigate the app away.
        onClick={(e) => {
          const link = (e.target as HTMLElement).closest("a");
          if (!link) return;
          e.preventDefault();
          const href = link.getAttribute("href") ?? "";
          if (/^(https?:|mailto:)/i.test(href)) window.open(href, "_blank", "noopener,noreferrer");
        }}
        data-testid="docx-view"
      />
    </OfficeFrame>
  );
}

// ── Excel (.xlsx) ────────────────────────────────────────────────────────────

interface Span { rowSpan: number; colSpan: number }

/** "B2:D4" → cell spans for the top-left cell and the set of cells it covers. */
function mergeLayout(merges: string[]) {
  const toIndex = (ref: string) => {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (!m) return null;
    const col = m[1].split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    return { row: Number(m[2]) - 1, col };
  };
  const spans = new Map<string, Span>();
  const covered = new Set<string>();
  for (const merge of merges) {
    const [a, b] = merge.split(":").map(toIndex);
    if (!a || !b) continue;
    spans.set(`${a.row}:${a.col}`, { rowSpan: b.row - a.row + 1, colSpan: b.col - a.col + 1 });
    for (let r = a.row; r <= b.row; r++) {
      for (let c = a.col; c <= b.col; c++) if (r !== a.row || c !== a.col) covered.add(`${r}:${c}`);
    }
  }
  return { spans, covered };
}

function SheetTable({ sheet }: { sheet: XlsxSheet }) {
  const { spans, covered } = useMemo(() => mergeLayout(sheet.merges), [sheet.merges]);
  const style = (cell: XlsxCell) => ({
    fontWeight: cell.b ? 600 : undefined,
    fontStyle: cell.i ? "italic" : undefined,
    color: cell.c,
    backgroundColor: cell.bg,
    textAlign: cell.a,
  });

  if (sheet.rows.length === 0) return <div className="p-6 text-sm text-gray-500">This sheet is empty.</div>;

  return (
    // Fixed layout so columns keep their Excel widths and long text is clipped, as in Excel.
    <table
      className="table-fixed border-separate border-spacing-0 text-[12px] text-gray-800"
      style={{ width: 44 + sheet.columns.reduce((sum, c) => sum + c.width, 0) }}
      data-testid="xlsx-table"
    >
      <colgroup>
        <col style={{ width: 44 }} />
        {sheet.columns.map(c => <col key={c.letter} style={{ width: c.width }} />)}
      </colgroup>
      <thead>
        <tr>
          <th className="sticky top-0 left-0 z-20 bg-gray-100 border-b border-r border-gray-300" />
          {sheet.columns.map(c => (
            <th key={c.letter} className="sticky top-0 z-10 bg-gray-100 border-b border-r border-gray-300 font-medium text-gray-500 px-1 h-6">
              {c.letter}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sheet.rows.map((row, r) => (
          <tr key={r}>
            <th className="sticky left-0 z-10 bg-gray-100 border-b border-r border-gray-300 font-medium text-gray-500 text-right pr-1.5">
              {r + 1}
            </th>
            {row.map((cell, c) => {
              const key = `${r}:${c}`;
              if (covered.has(key)) return null;
              const span = spans.get(key);
              return (
                <td
                  key={c}
                  rowSpan={span?.rowSpan}
                  colSpan={span?.colSpan}
                  className={`border-b border-r border-gray-200 px-1.5 py-0.5 align-top ${
                    cell.w ? "whitespace-pre-wrap break-words" : "whitespace-nowrap overflow-hidden text-ellipsis"
                  }`}
                  style={style(cell)}
                  title={cell.v || undefined}
                >
                  {cell.v}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A workbook's sheets as tables, with sheet tabs along the bottom like Excel. */
export function XlsxView({ path }: { path: string }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ["fs-xlsx", path],
    queryFn: () => fsApi.xlsx(path),
    staleTime: 0,
    gcTime: 0,
  });
  const [active, setActive] = useState(0);
  const sheets = data?.sheets ?? [];
  const sheet = sheets[Math.min(active, sheets.length - 1)];

  return (
    <OfficeFrame path={path} app="Excel">
      {isLoading || error ? <Status error={error} label="Reading workbook…" /> : (
        <>
          <div className="flex-1 min-h-0 overflow-auto" data-testid="xlsx-view">
            {sheet ? <SheetTable sheet={sheet} /> : <div className="p-6 text-sm text-gray-500">This workbook has no sheets.</div>}
          </div>
          <div className="h-8 shrink-0 flex items-stretch border-t border-gray-200 bg-gray-50 overflow-x-auto text-[12px]" role="tablist">
            {sheets.map((s, i) => (
              <button
                key={s.name}
                role="tab"
                aria-selected={i === active}
                className={`px-3 border-r border-gray-200 whitespace-nowrap ${
                  i === active ? "bg-white text-gray-900 font-medium border-t-2 border-t-emerald-600 -mt-px" : "text-gray-600 hover:bg-gray-100"
                } ${s.hidden ? "italic opacity-60" : ""}`}
                onClick={() => setActive(i)}
                title={s.hidden ? `${s.name} (hidden sheet)` : s.name}
                data-testid="xlsx-sheet-tab"
              >
                {s.name}
              </button>
            ))}
            {sheet?.truncated && (
              <span className="ml-auto self-center px-3 text-amber-600 whitespace-nowrap">
                Showing the first {sheet.rows.length} of {sheet.totalRows} rows and {sheet.columns.length} of {sheet.totalColumns} columns
              </span>
            )}
          </div>
        </>
      )}
    </OfficeFrame>
  );
}
