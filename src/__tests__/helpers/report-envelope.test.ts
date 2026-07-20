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

Task: 2.2 — transformReport: Section rows, cell-to-column-keyed-object, attribute hoist/dedup
Source: .specs/007-response-shape/backend/todo.md

Examples covered:
  - Example 5: Attributes hoisted and deduplicated per row (AC 3)

Test plan:
  - test_rowAttributes_hoistedAndDeduped_emptyValueDropped: 5-cell row's attributes merge into
    one deduplicated object; an empty-value attribute (fromDate) is dropped

Task: 2.3 — transformReport: attribute id collision is first-wins
Source: .specs/007-response-shape/backend/todo.md

Examples covered:
  - Example 9: Attribute id collision: first wins (AC 3)

Test plan:
  - test_attributeIdCollision_firstCellWins: two cells share an attribute id with
    different values; the first cell's value is kept

Task: 2.4 — transformReport: verbatim cell values, no numeric coercion
Source: .specs/007-response-shape/backend/todo.md

Examples covered:
  - Example 13: Cell values are verbatim strings, never parsed (AC 6)

Test plan:
  - test_cellValues_remainVerbatimStrings_neverCoerced: numeric-looking cell values
    ("123", "0.00") stay strings, untouched
*/
import { describe, it, expect } from "vitest";
import { RowType, type ReportWithRow, type ReportAttribute } from "xero-node";
import { transformReport } from "../../helpers/report-envelope.js";

function cell(value?: string, attributes?: ReportAttribute[]) {
  return { value, attributes };
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

describe("transformReport — attribute hoist and dedup", () => {
  it("test_rowAttributes_hoistedAndDeduped_emptyValueDropped", () => {
    const report: ReportWithRow = {
      reportName: "Trial Balance",
      rows: [
        {
          rowType: RowType.Header,
          cells: [cell("Account"), cell("Debit"), cell("Credit"), cell("YTD Debit"), cell("YTD Credit")],
        },
        {
          rowType: RowType.Section,
          title: "Equity",
          rows: [
            {
              rowType: RowType.Row,
              cells: [
                cell("Retained Earnings (960)", [{ id: "account", value: "0aa0e7a2-xxx" }]),
                cell("", [
                  { id: "account", value: "0aa0e7a2-xxx" },
                  { id: "toDate", value: "2/28/2026" },
                ]),
                cell("100.00", [
                  { id: "account", value: "0aa0e7a2-xxx" },
                  { id: "toDate", value: "2/28/2026" },
                  { id: "fromDate", value: "" },
                ]),
                cell("", [
                  { id: "account", value: "0aa0e7a2-xxx" },
                  { id: "toDate", value: "2/28/2026" },
                  { id: "fromDate", value: "" },
                ]),
                cell("200.00", [
                  { id: "account", value: "0aa0e7a2-xxx" },
                  { id: "toDate", value: "2/28/2026" },
                  { id: "fromDate", value: "" },
                ]),
              ],
            },
          ],
        },
      ],
    };

    const envelope = transformReport(report);

    expect(envelope.sections[0].rows?.[0].attributes).toEqual({
      account: "0aa0e7a2-xxx",
      toDate: "2/28/2026",
    });
  });

  it("test_attributeIdCollision_firstCellWins", () => {
    const report: ReportWithRow = {
      reportName: "Trial Balance",
      rows: [
        {
          rowType: RowType.Header,
          cells: [cell("Account"), cell("Debit")],
        },
        {
          rowType: RowType.Section,
          title: "Revenue",
          rows: [
            {
              rowType: RowType.Row,
              cells: [
                cell("Sales", [{ id: "account", value: "aaa" }]),
                cell("100.00", [{ id: "account", value: "bbb" }]),
              ],
            },
          ],
        },
      ],
    };

    const envelope = transformReport(report);

    expect(envelope.sections[0].rows?.[0].attributes).toEqual({ account: "aaa" });
  });
});

describe("transformReport — verbatim cell values", () => {
  it("test_cellValues_remainVerbatimStrings_neverCoerced", () => {
    const report: ReportWithRow = {
      reportName: "Trial Balance",
      rows: [
        {
          rowType: RowType.Header,
          cells: [cell("Account"), cell("Debit")],
        },
        {
          rowType: RowType.Section,
          title: "Revenue",
          rows: [
            {
              rowType: RowType.Row,
              cells: [cell("123"), cell("0.00")],
            },
          ],
        },
      ],
    };

    const envelope = transformReport(report);

    expect(envelope.sections[0].rows?.[0]).toEqual({ Account: "123", Debit: "0.00" });
  });
});
