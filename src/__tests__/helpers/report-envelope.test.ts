/*
Task: 2.1 — transformReport: header fields + columns (Header row, empty-title-as-"label", duplicate-title suffixing)
Source: .specs/007-response-shape/backend/todo.md

Examples covered:
  - Example 1: Trial balance single minified block (columns portion only; full single-block
    assertion is covered by Task 3.2's tool-level test) (AC 1)
  - Example 16: Duplicate column titles are suffixed, no cell lost (AC 6)

Test plan:
  - test_headerRow_buildsColumnsAndReportName: Header cells map to columns; "" maps to "label"
  - test_duplicateColumnTitles_areSuffixed_noCellLost: repeated Header titles get " (2)", " (3)", ...
*/
import { describe, it, expect } from "vitest";
import { RowType, type ReportWithRow } from "xero-node";
import { transformReport } from "../../helpers/report-envelope.js";

function cell(value?: string) {
  return { value };
}

describe("transformReport — header fields and columns", () => {
  it("test_headerRow_buildsColumnsAndReportName", () => {
    const report: ReportWithRow = {
      reportName: "Trial Balance",
      reportDate: "20 July 2026",
      rows: [
        {
          rowType: RowType.Header,
          cells: [cell("Account"), cell(""), cell("Debit"), cell("Credit")],
        },
      ],
    };

    const envelope = transformReport(report);

    expect(envelope.report).toBe("Trial Balance");
    expect(envelope.columns).toEqual(["Account", "label", "Debit", "Credit"]);
  });

  it("test_duplicateColumnTitles_areSuffixed_noCellLost", () => {
    const report: ReportWithRow = {
      reportName: "Comparative",
      rows: [
        {
          rowType: RowType.Header,
          cells: [cell("Account"), cell("31 Jul 2026"), cell("31 Jul 2026")],
        },
        {
          rowType: RowType.Section,
          title: "Revenue",
          rows: [
            {
              rowType: RowType.Row,
              cells: [cell("Sales"), cell("100.00"), cell("90.00")],
            },
          ],
        },
      ],
    };

    const envelope = transformReport(report);

    expect(envelope.columns).toEqual(["Account", "31 Jul 2026", "31 Jul 2026 (2)"]);
    expect(envelope.sections[0].rows?.[0]).toEqual({
      Account: "Sales",
      "31 Jul 2026": "100.00",
      "31 Jul 2026 (2)": "90.00",
    });
  });
});
