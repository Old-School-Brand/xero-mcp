/*
Task: 3.1 — list-trial-balance.tool.ts: replace 4 content blocks with reportResponse, update description
Source: .specs/007-response-shape/backend/todo.md

Examples covered:
  - Example 1: Trial balance single minified block (AC 1)

Test plan:
  - test_success_returnsSingleMinifiedReportEnvelopeBlock: one content block, minified,
    report envelope shape (report/columns)

Task: 3.2 — Tool description documents the envelope shape (dedicated assertion)
Source: .specs/007-response-shape/backend/todo.md

Examples covered:
  - Example 15: Tool description documents the envelope (AC 6)

Test plan:
  - test_description_mentionsReportEnvelopeShape: description text mentions sections/columns
*/
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RowType, type ReportWithRow } from "xero-node";

const { listXeroTrialBalance } = vi.hoisted(() => ({ listXeroTrialBalance: vi.fn() }));

vi.mock("../../handlers/list-xero-trial-balance.handler.js", () => ({ listXeroTrialBalance }));

import ListTrialBalanceTool from "../../tools/list/list-trial-balance.tool.js";

function cell(value?: string) {
  return { value };
}

const report: ReportWithRow = {
  reportName: "Trial Balance",
  reportDate: "20 July 2026",
  rows: [
    {
      rowType: RowType.Header,
      cells: [cell("Account"), cell(""), cell("Debit"), cell("Credit")],
    },
    {
      rowType: RowType.Section,
      title: "Revenue",
      rows: [
        {
          rowType: RowType.Row,
          cells: [cell("Sales (200)"), cell(), cell(""), cell("5000.00")],
        },
      ],
    },
  ],
};

beforeEach(() => {
  listXeroTrialBalance.mockReset();
});

describe("list-trial-balance tool — report envelope", () => {
  it("test_success_returnsSingleMinifiedReportEnvelopeBlock", async () => {
    listXeroTrialBalance.mockResolvedValue({ result: report, isError: false, error: null });

    const result = await ListTrialBalanceTool().handler({} as never, {} as never);
    const content = result.content as { type: "text"; text: string }[];

    expect(content).toHaveLength(1);
    expect(content[0].text.startsWith('{"report":"Trial Balance"')).toBe(true);
    expect(content[0].text).not.toContain("\n");

    const parsed = JSON.parse(content[0].text) as { columns: string[] };
    expect(parsed.columns).toEqual(["Account", "label", "Debit", "Credit"]);
  });

  it("test_description_mentionsReportEnvelopeShape", () => {
    const description = ListTrialBalanceTool().description;

    expect(description).toMatch(/sections/i);
    expect(description).toMatch(/columns/i);
  });
});
