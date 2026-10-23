// Contract for /api/fs/xlsx (spreadsheets read on the server).

export interface XlsxCell {
  /** Displayed text. */
  v: string;
  b?: true;
  i?: true;
  /** Font colour (#RRGGBB). */
  c?: string;
  /** Fill colour (#RRGGBB). */
  bg?: string;
  a?: "left" | "center" | "right";
  /** Wrap text (set in Excel); otherwise the cell stays on one line. */
  w?: true;
}

export interface XlsxSheet {
  name: string;
  hidden: boolean;
  columns: { letter: string; width: number }[];
  rows: XlsxCell[][];
  /** Merged ranges such as "A1:C1". */
  merges: string[];
  /** Rows or columns beyond the shown limit were left out. */
  truncated: boolean;
  totalRows: number;
  totalColumns: number;
}

export interface XlsxResponse {
  sheets: XlsxSheet[];
}
