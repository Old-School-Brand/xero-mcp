import { RowType, type ReportWithRow, type ReportCell, type ReportRows } from "xero-node";
import { formatDate, formatDateTime } from "./format-date.js";

/** The structured, lossless JSON shape report tools return (ADR-0006). */
export interface ReportEnvelope {
  report: string;
  date?: string;
  updatedAt?: string;
  columns: string[];
  sections: ReportSection[];
}

export interface ReportSection {
  title: string;
  rows?: ReportDataRow[];
  total?: ReportDataRow;
}

// Each key is a column title (or "label" for the empty-title column).
export type ReportDataRow = Record<string, string> & {
  attributes?: Record<string, string>;
};

// Xero's Header row cells carry the column titles; an empty title keys as
// "label" and repeats within a comparative report are suffixed " (2)", " (3)", …
// so no cell value is ever silently overwritten by a key collision.
function buildColumns(report: ReportWithRow): string[] {
  const header = report.rows?.find((row) => row.rowType === RowType.Header);
  const seen = new Map<string, number>();

  return (header?.cells ?? []).map((cell) => {
    const title = cell.value || "label";
    const count = (seen.get(title) ?? 0) + 1;
    seen.set(title, count);
    return count === 1 ? title : `${title} (${count})`;
  });
}

// Maps a row's cells onto its column titles by index (defensive fallback to
// the index itself if a report has no Header row). Cells with an empty or
// missing value are skipped — the jsonResponse replacer would drop them
// anyway, but skipping here avoids ever creating the key in the first place.
function cellsToRow(cells: ReportCell[] | undefined, columns: string[]): ReportDataRow {
  const row: ReportDataRow = {};

  (cells ?? []).forEach((cell, index) => {
    if (!cell.value) return;
    const key = columns[index] ?? String(index);
    row[key] = cell.value;
  });

  return row;
}

function transformSection(section: ReportRows, columns: string[]): ReportSection {
  const result: ReportSection = { title: section.title ?? "" };
  const rows: ReportDataRow[] = [];

  for (const row of section.rows ?? []) {
    switch (row.rowType) {
      case RowType.Row:
        rows.push(cellsToRow(row.cells, columns));
        break;
      case RowType.SummaryRow:
        result.total = cellsToRow(row.cells, columns);
        break;
      default:
        console.warn(`Unknown nested rowType in report section: ${String(row.rowType)}`);
    }
  }

  if (rows.length > 0) result.rows = rows;
  return result;
}

export function transformReport(report: ReportWithRow): ReportEnvelope {
  const columns = buildColumns(report);
  const sections: ReportSection[] = [];

  for (const row of report.rows ?? []) {
    switch (row.rowType) {
      case RowType.Header:
        break; // already consumed by buildColumns
      case RowType.Section:
        sections.push(transformSection(row, columns));
        break;
      case RowType.SummaryRow:
        // Structurally possible but unobserved in the 5 live reports: a
        // top-level summary with no owning section. Wrapped so the data is
        // never dropped.
        sections.push({ title: "", total: cellsToRow(row.cells, columns) });
        break;
      default:
        console.warn(`Unknown top-level rowType in report: ${String(row.rowType)}`);
    }
  }

  return {
    report: report.reportName ?? "",
    date: formatDate(report.reportDate),
    updatedAt: formatDateTime(report.updatedDateUTC),
    columns,
    sections,
  };
}
