import ExcelJS from "exceljs";
import type { XlsxCell, XlsxResponse, XlsxSheet } from "@shared/office";

// Spreadsheets are read here (not in the page) so the browser bundle stays
// small. Big sheets are cut to these limits and flagged.
const MAX_ROWS = 2000;
const MAX_COLUMNS = 100;

function argbToCss(argb: string | undefined) {
  return argb && /^[0-9a-f]{8}$/i.test(argb) ? `#${argb.slice(2)}` : undefined;
}

function columnLetters(index: number) {
  let n = index;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Shown text for a cell: formula results, rich text and dates included. */
function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    return value.toISOString().replace("T00:00:00.000Z", "").replace("T", " ").replace(/\.\d+Z$/, "");
  }
  if (typeof value === "object") {
    if ("result" in value) return value.result === undefined || value.result === null ? "" : String(value.result instanceof Date ? value.result.toISOString().slice(0, 10) : value.result);
    if ("richText" in value) return value.richText.map(r => r.text).join("");
    if ("text" in value) return String(value.text);
    if ("error" in value) return String(value.error);
  }
  return cell.text ?? String(value);
}

export async function readWorkbook(filePath: string): Promise<XlsxResponse> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheets: XlsxSheet[] = workbook.worksheets.map(ws => {
    const rowCount = Math.min(ws.actualRowCount ? ws.rowCount : 0, MAX_ROWS);
    const columnCount = Math.min(ws.columnCount, MAX_COLUMNS);
    const rows: XlsxCell[][] = [];
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const cells: XlsxCell[] = [];
      for (let c = 1; c <= columnCount; c++) {
        const cell = row.getCell(c);
        const out: XlsxCell = { v: cellText(cell) };
        if (cell.font?.bold) out.b = true;
        if (cell.font?.italic) out.i = true;
        const color = argbToCss(cell.font?.color?.argb);
        if (color && color !== "#000000") out.c = color;
        const fill = cell.fill?.type === "pattern" ? argbToCss(cell.fill.fgColor?.argb) : undefined;
        if (fill && fill !== "#FFFFFF") out.bg = fill;
        const align = cell.alignment?.horizontal;
        if (align === "center" || align === "right" || align === "left") out.a = align;
        else if (typeof cell.value === "number") out.a = "right";
        if (cell.alignment?.wrapText) out.w = true;
        cells.push(out);
      }
      rows.push(cells);
    }
    const merges: string[] = (ws.model as { merges?: string[] }).merges ?? [];
    return {
      name: ws.name,
      hidden: ws.state !== "visible",
      columns: Array.from({ length: columnCount }, (_, i) => ({
        letter: columnLetters(i + 1),
        // Excel widths are in characters; ~7px each.
        width: Math.round(Math.min(600, Math.max(40, (ws.getColumn(i + 1).width ?? 10) * 7.5))),
      })),
      rows,
      merges,
      truncated: ws.rowCount > MAX_ROWS || ws.columnCount > MAX_COLUMNS,
      totalRows: ws.rowCount,
      totalColumns: ws.columnCount,
    };
  });

  return { sheets };
}
