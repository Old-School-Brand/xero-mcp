/*
 * Guards the paginationHint wiring in the five transaction tool files (review iter-2, staff finding).
 * list-invoices is the representative case; the other four (manual-journals, bank-transactions,
 * credit-notes, payments) use the identical `...(hint ? [{...}] : [])` append pattern. These tool
 * files are upstream-owned and have no other test coverage, so this guards the "showing N — call
 * page X" messaging from a silent regression on an upstream merge.
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
  return (result.content as { type: "text"; text: string }[]).map((c) => c.text);
}

beforeEach(() => {
  listXeroInvoices.mockReset();
});

describe("list-invoices tool — paginationHint wiring", () => {
  it("appends the pagination hint when a full page (100) is returned", async () => {
    listXeroInvoices.mockResolvedValue({ result: invoices(1000), isError: false, error: null });

    const texts = await runPage(1);

    expect(texts.some((t) => t.includes("call with page 2"))).toBe(true);
  });

  it("omits the pagination hint when fewer than 100 are returned", async () => {
    listXeroInvoices.mockResolvedValue({ result: invoices(42), isError: false, error: null });

    const texts = await runPage(1);

    expect(texts.some((t) => t.includes("call with page"))).toBe(false);
  });
});
