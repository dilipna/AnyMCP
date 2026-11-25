// How a table looks on screen, as a grid: which heading is over each column and which cell is in each place.
// Used by the recorder (the headings offered when a table is picked) and the engine (reading the rows), so both see
// the same columns. Merged cells (colspan / rowspan) occupy every place they cover. Reading cells by their position in
// a row's own children instead put values under the wrong heading after any merged cell, and that was returned as a
// success (2026-11-25, e2e/site-patterns.spec.ts).

import { norm, visibleText } from "./locator";

const isCell = (e: Element) => e.localName === "td" || e.localName === "th";
const span = (v: number, max: number) => (Number.isFinite(v) && v >= 1 ? Math.min(Math.floor(v), max) : 1);

/** Places of a set of rows: grid[r][c] is the cell covering row r, column c (merged cells repeat). */
function grid(rows: Element[]): (Element | undefined)[][] {
  const out: (Element | undefined)[][] = rows.map(() => []);
  rows.forEach((tr, r) => {
    let c = 0;
    for (const cell of [...tr.children].filter(isCell)) {
      while (out[r]![c]) c++;
      const cs = span((cell as HTMLTableCellElement).colSpan, 1000);
      const raw = (cell as HTMLTableCellElement).rowSpan;
      const rs = raw === 0 ? rows.length - r : span(raw, rows.length - r); // rowspan="0": to the end of the section
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) out[r + dr]![c + dc] = cell;
      c += cs;
    }
  });
  return out;
}

export interface TableLayout {
  /** One heading per column. Under a heading that spans several columns, the heading above is put in front
   * ("Population 2020"). Headings that would still repeat get " (2)", " (3)"; blank ones stay "". */
  headers: string[];
  /** Every heading cell's full text (hidden parts included) with the first column it covers: finds the columns of
   * tools recorded before 2026-11-25, which named a column by the top heading row only, with hidden text. */
  headingCells: { text: string; col: number }[];
  /** The data rows (not the heading rows, not <tfoot>), each as its places. */
  rows: (Element | undefined)[][];
}

export function tableLayout(table: Element): TableLayout | null {
  const own = [...table.querySelectorAll("tr")].filter((tr) => tr.closest("table") === table);
  const section = (tr: Element) => tr.parentElement?.localName;
  const theadRows = own.filter((tr) => section(tr) === "thead");
  const headRows = theadRows.length ? theadRows : own.slice(0, 1);
  if (!headRows.length) return null;
  const head = grid(headRows);
  const width = Math.max(0, ...head.map((r) => r.length));
  const headers: string[] = [];
  for (let c = 0; c < width; c++) {
    const covering: Element[] = [];
    for (const row of head) {
      const cell = row[c];
      if (cell && !covering.includes(cell) && visibleText(cell)) covering.push(cell);
    }
    headers.push(covering.map((x) => visibleText(x)).join(" "));
  }
  const seen = new Map<string, number>();
  const unique = headers.map((h) => {
    if (!h) return h;
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n === 1 ? h : `${h} (${n})`;
  });
  const headingCells: TableLayout["headingCells"] = [];
  for (const row of head)
    row.forEach((cell, c) => {
      if (cell && row[c - 1] !== cell) headingCells.push({ text: norm(cell.textContent), col: c });
    });
  const bodyRows = own.filter((tr) => !headRows.includes(tr) && section(tr) !== "tfoot");
  return { headers: unique, headingCells, rows: grid(bodyRows) };
}

/** The column a recorded heading names: its current heading, else (older tools) a heading cell with that text. */
export function columnOf(layout: TableLayout, header: string): number {
  const i = layout.headers.indexOf(header);
  if (i >= 0) return i;
  return layout.headingCells.find((h) => h.text === header)?.col ?? -1;
}
