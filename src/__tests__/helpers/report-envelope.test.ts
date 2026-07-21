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
import { describe, it, expect, vi } from "vitest";
import { RowType, type ReportWithRow, type ReportAttribute } from "xero-node";
import { transformReport, reportResponse } from "../../helpers/report-envelope.js";

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

/*
Task: 2.5 — transformReport: SummaryRow becomes the section's total
Source: .specs/007-response-shape/backend/todo.md

Examples covered:
  - Example 6: Section total from SummaryRow (AC 4)

Test plan:
  - test_summaryRowInSection_becomesSectionTotal_notInRows: a section's SummaryRow is
    stored as `total`, not appended to `rows`

Task: 2.6 — transformReport: label-only sections and computed rows in empty-title sections
Source: .specs/007-response-shape/backend/todo.md

Examples covered:
  - Example 7: Label-only section preserved (AC 4)
  - Example 8: Computed row stays as ordinary row (AC 4)

Test plan:
  - test_sectionWithNoRows_serializesAsTitleOnly: a Section with no nested rows produces
    { title } only
  - test_computedRowInEmptyTitleSection_staysInRows: a Section titled "" containing an
    ordinary Row keeps that row in `rows`, not `total`

Task: 2.7 — transformReport: empty report (Section present, zero data rows)
Source: .specs/007-response-shape/backend/todo.md

Examples covered:
  - Example 12: Report with no data rows (empty report) (AC 6)

Test plan:
  - test_sectionWithEmptyRowsArray_omitsRowsKey: a Section whose Xero `rows` is `[]`
    produces no `rows` key in the envelope

Task: 2.8 — Unknown rowType at top level and nested: console.warn + skip
Source: .specs/007-response-shape/backend/todo.md

Examples covered:
  - (none numbered in design.md — covers the Error Handling table's "Unknown rowType" row)

Test plan:
  - test_unknownTopLevelRowType_skippedWithWarning_noThrow: an unrecognised top-level
    rowType is skipped, console.warn fires once, no exception is thrown

Task: 2.9 — reportResponse(report) composes transformReport + jsonResponse
Source: .specs/007-response-shape/backend/todo.md

Examples covered:
  - Example 14: reportResponse composes transform + serialize (AC 1, AC 4)

Test plan:
  - test_reportResponse_returnsSingleMinifiedContentBlock: wraps transformReport's output
    as one minified JSON text content block

Task: 2.10 — transformReport: top-level SummaryRow wrapped as a synthetic section total
Source: .specs/007-response-shape/backend/todo.md

Examples covered:
  - Example 17: Top-level SummaryRow wrapped as synthetic section total (AC 6)

Test plan:
  - test_topLevelSummaryRow_wrappedAsSyntheticSectionTotal_noWarning: a top-level
    SummaryRow (no owning Section) becomes a section with only a `total`; no warning fires
*/
describe("transformReport — SummaryRow becomes section total", () => {
  it("test_summaryRowInSection_becomesSectionTotal_notInRows", () => {
    const report: ReportWithRow = {
      reportName: "Balance Sheet",
      rows: [
        {
          rowType: RowType.Header,
          cells: [cell(""), cell("Amount")],
        },
        {
          rowType: RowType.Section,
          title: "Bank",
          rows: [
            { rowType: RowType.Row, cells: [cell("Business Account"), cell("5000.00")] },
            { rowType: RowType.SummaryRow, cells: [cell("Total Bank"), cell("10000.00")] },
          ],
        },
      ],
    };

    const envelope = transformReport(report);

    expect(envelope.sections[0].total).toEqual({ label: "Total Bank", Amount: "10000.00" });
    expect(envelope.sections[0].rows).toEqual([{ label: "Business Account", Amount: "5000.00" }]);
  });
});

describe("transformReport — label-only sections and computed rows", () => {
  it("test_sectionWithNoRows_serializesAsTitleOnly", () => {
    const report: ReportWithRow = {
      reportName: "Balance Sheet",
      rows: [
        { rowType: RowType.Header, cells: [cell("Account"), cell("Amount")] },
        { rowType: RowType.Section, title: "Assets" },
      ],
    };

    const envelope = transformReport(report);

    expect(envelope.sections[0]).toEqual({ title: "Assets" });
  });

  it("test_computedRowInEmptyTitleSection_staysInRows", () => {
    const report: ReportWithRow = {
      reportName: "Balance Sheet",
      rows: [
        { rowType: RowType.Header, cells: [cell(""), cell("Amount")] },
        {
          rowType: RowType.Section,
          title: "",
          rows: [{ rowType: RowType.Row, cells: [cell("Net Assets"), cell("500000.00")] }],
        },
      ],
    };

    const envelope = transformReport(report);

    expect(envelope.sections[0]).toEqual({
      title: "",
      rows: [{ label: "Net Assets", Amount: "500000.00" }],
    });
  });
});

describe("transformReport — empty report", () => {
  it("test_sectionWithEmptyRowsArray_omitsRowsKey", () => {
    const report: ReportWithRow = {
      reportName: "Profit and Loss",
      rows: [
        { rowType: RowType.Header, cells: [cell("Account"), cell("Amount")] },
        { rowType: RowType.Section, title: "Revenue", rows: [] },
      ],
    };

    const envelope = transformReport(report);

    expect(envelope.sections).toEqual([{ title: "Revenue" }]);
  });
});

describe("transformReport — unknown rowType", () => {
  it("test_unknownTopLevelRowType_skippedWithWarning_noThrow", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const report: ReportWithRow = {
      reportName: "Trial Balance",
      rows: [
        { rowType: RowType.Header, cells: [cell("Account")] },
        { rowType: "Weird" as unknown as RowType, title: "Unrecognised" },
      ],
    };

    const envelope = transformReport(report);

    expect(envelope.sections).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});

describe("reportResponse", () => {
  it("test_reportResponse_returnsSingleMinifiedContentBlock", () => {
    const report: ReportWithRow = {
      reportName: "Balance Sheet",
      rows: [
        { rowType: RowType.Header, cells: [cell("Account"), cell("Amount")] },
        { rowType: RowType.Section, title: "Assets" },
      ],
    };

    const result = reportResponse(report);

    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).not.toContain("\n");
    const parsed = JSON.parse(result.content[0].text) as {
      report: string;
      sections: unknown[];
    };
    expect(parsed.report).toBe("Balance Sheet");
    expect(parsed.sections).toEqual([{ title: "Assets" }]);
  });
});

describe("transformReport — top-level SummaryRow", () => {
  it("test_topLevelSummaryRow_wrappedAsSyntheticSectionTotal_noWarning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const report: ReportWithRow = {
      reportName: "Trial Balance",
      rows: [
        { rowType: RowType.Header, cells: [cell(""), cell("Amount")] },
        { rowType: RowType.SummaryRow, cells: [cell("Grand Total"), cell("999.00")] },
      ],
    };

    const envelope = transformReport(report);

    expect(envelope.sections).toEqual([{ title: "", total: { label: "Grand Total", Amount: "999.00" } }]);
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
