/*
Task: 9 — rewrite list-invoices.tool.test.ts for the JSON envelope
Source: .specs/006-json-everywhere/backend/todo.md

Examples covered:
  - AC1: list-invoices({page:1}) returns one content block of minified JSON
    {"showing":N,"hasMore":bool,"rows":[…]}, and a paid invoice's amountDue:0 survives.

Test plan:
  - test_fullPage_returnsEnvelopeWithHasMoreTrue: 1000 rows (pageSize) sets hasMore true, rows intact
  - test_partialPage_returnsEnvelopeWithHasMoreFalse: fewer than 1000 rows sets hasMore false
  - test_zeroValuedAmountDue_survivesInRows: a mocked invoice with amountDue:0 is not dropped
*/

import { describe, it, expect, vi, beforeEach } from "vitest";

const { listXeroInvoices } = vi.hoisted(() => ({ listXeroInvoices: vi.fn() }));

vi.mock("../../handlers/list-xero-invoices.handler.js", () => ({ listXeroInvoices }));

import ListInvoicesTool from "../../tools/list/list-invoices.tool.js";

function invoices(n: number) {
  return Array.from({ length: n }, (_, i) => ({ invoiceID: `inv-${i}`, total: 0 }));
}

async function runPage(page: number) {
  const result = await ListInvoicesTool().handler({ page } as never, {} as never);
  const content = result.content as { type: "text"; text: string }[];
  expect(content).toHaveLength(1);
  return JSON.parse(content[0].text) as {
    showing: number;
    hasMore: boolean;
    rows: unknown[];
  };
}

beforeEach(() => {
  listXeroInvoices.mockReset();
});

describe("list-invoices tool — JSON envelope", () => {
  it("test_fullPage_returnsEnvelopeWithHasMoreTrue", async () => {
    listXeroInvoices.mockResolvedValue({
      result: invoices(1000),
      isError: false,
      error: null,
    });

    const envelope = await runPage(1);

    expect(envelope.showing).toBe(1000);
    expect(envelope.hasMore).toBe(true);
    expect(envelope.rows).toEqual(invoices(1000));
  });

  it("test_partialPage_returnsEnvelopeWithHasMoreFalse", async () => {
    listXeroInvoices.mockResolvedValue({
      result: invoices(42),
      isError: false,
      error: null,
    });

    const envelope = await runPage(1);

    expect(envelope.showing).toBe(42);
    expect(envelope.hasMore).toBe(false);
  });

  it("test_zeroValuedAmountDue_survivesInRows", async () => {
    const invoice = { invoiceID: "inv-paid", amountDue: 0 };
    listXeroInvoices.mockResolvedValue({
      result: [invoice],
      isError: false,
      error: null,
    });

    const envelope = await runPage(1);

    expect(envelope.rows).toEqual([invoice]);
    expect((envelope.rows[0] as { amountDue: number }).amountDue).toBe(0);
  });
});
