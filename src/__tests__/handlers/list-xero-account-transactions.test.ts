/*
 * Tasks: 1.2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 * Source: .specs/005-xero-usability/backend/todo.md
 *
 * Examples covered:
 *   - Example 1: GL month-end happy path (account code) (AC 1)
 *   - Example 2: Account by UUID (AC 2)
 *   - Example 3: Account identifier detection: code vs UUID (AC 2)
 *   - Example 4: Continuation cursor (page budget exhausted) (AC 3)
 *   - Example 5: Continuation: final slice (AC 3)
 *   - Example 6: Empty period, scan exhausted (AC 4)
 *   - Example 6b: Empty slice but more to scan (sparse account, budget exhausted) (AC 3)
 *   - Example 7: Missing journals scope (403) (AC 5)
 *   - Example 8: ifModifiedSince derivation (AC 1)
 *   - Example 9: Date filtering excludes out-of-range journals (AC 1)
 *   - Example 10: Row shape (AC 1)
 *
 * Test plan:
 *   - test_missingJournalsScope_returnsFormattedError: 403 from getJournals surfaces via formatError (Task 1.2)
 *   - test_accountCode_matchesByAccountCode: non-UUID account filters lines by AccountCode (Task 2.1, 2.5)
 *   - test_accountUUID_matchesByAccountID: uppercase UUID account filters lines by AccountID (Task 2.1, 2.5)
 *   - test_fromDateProvided_callsGetJournalsWithIfModifiedSinceDate: ifModifiedSince = new Date(fromDate) (Task 2.2)
 *   - test_fromDateOmitted_callsGetJournalsWithUndefinedIfModifiedSince: ifModifiedSince = undefined (Task 2.2)
 *   - test_fullPagesUntilBudget_returnsNonNullNextOffset: budget exhausted mid-scan → nextOffset is highest JournalNumber seen (Task 2.3, 2.6)
 *   - test_secondCallResumesFromNextOffset: second call passes offset through to getJournals (Task 2.3)
 *   - test_partialPageOnFirstCall_stopsAfterOneCall: <100 journals on first call stops the loop (Task 2.3)
 *   - test_outOfRangeJournals_excludedFromRows: journals dated outside [fromDate, toDate] are dropped (Task 2.4)
 *   - test_matchingLine_assembledIntoExactRowShape: row fields match Example 10's fixture exactly (Task 2.5)
 *   - test_emptyPeriodScanExhausted_returnsNullNextOffset: partial page, no matches → nextOffset null (Task 2.6)
 *   - test_sparseAccountBudgetExhausted_showingZeroWithNonNullNextOffset: full pages, no matches, budget exhausted → nextOffset non-null (Task 2.6)
 *   - test_fromDateOmitted_stillReturnsMatchingLines: fromDate omitted still returns matching lines (guards the !fromDate prefix) (review iter-2)
 *   - test_dateInput_normalisedToIsoDateString: Date-typed journalDate normalised to YYYY-MM-DD (review iter-2)
 *   - test_accountUUID_matchesByAccountID: uppercase-UUID input matches lowercase Xero AccountID (case-normalisation guard) (review iter-2)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Journal } from "xero-node";

const { getJournals, authenticate } = vi.hoisted(() => ({
  getJournals: vi.fn(),
  authenticate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../clients/xero-client.js", () => ({
  xeroClient: {
    tenantId: "test-tenant-id",
    authenticate,
    accountingApi: { getJournals },
  },
}));

import { listXeroAccountTransactions } from "../../handlers/list-xero-account-transactions.handler.js";

// xero-node deserialises Xero's /Date(...)/ wire format into a real JS Date at runtime,
// even though the SDK types journalDate as `string`. wireDate reproduces that runtime
// reality in fixtures (a Date value in a string-typed field) so tests exercise formatDate's
// Date branch — the path that actually runs in production.
const wireDate = (iso: string): string => new Date(iso) as unknown as string;

function journal(overrides: Partial<Journal> = {}): Journal {
  return {
    journalID: "journal-id",
    journalDate: wireDate("2026-06-15T00:00:00.000Z"),
    journalNumber: 1,
    sourceType: Journal.SourceTypeEnum.ACCREC,
    journalLines: [],
    ...overrides,
  };
}

function fullPage(journalNumberStart: number): Journal[] {
  return Array.from({ length: 100 }, (_, i) =>
    journal({ journalNumber: journalNumberStart + i, journalLines: [] }),
  );
}

beforeEach(() => {
  getJournals.mockReset();
  authenticate.mockClear();
});

describe("listXeroAccountTransactions", () => {
  it("test_missingJournalsScope_returnsFormattedError", async () => {
    getJournals.mockRejectedValue({
      response: { statusCode: 403 },
    });

    const response = await listXeroAccountTransactions("631", "2026-06-01");

    expect(response.isError).toBe(true);
    expect(response.error).toBe(
      "You don't have permission to access this resource in Xero.",
    );
  });

  it("test_accountCode_matchesByAccountCode", async () => {
    getJournals.mockResolvedValueOnce({
      body: {
        journals: [
          journal({
            journalLines: [{ accountCode: "631", accountID: "some-uuid" }],
          }),
        ],
      },
    });

    const response = await listXeroAccountTransactions("631", "2026-06-01");

    expect(response.isError).toBe(false);
    expect(response.result?.rows).toHaveLength(1);
    expect(response.result?.rows[0]?.accountCode).toBe("631");
  });

  it("test_accountUUID_matchesByAccountID", async () => {
    // Caller passes an uppercase UUID; Xero returns AccountID as a lowercase GUID.
    // The handler must normalise both sides — regression guard for the case-sensitivity fix.
    const uuidInput = "A1B2C3D4-E5F6-7890-ABCD-EF1234567890";
    getJournals.mockResolvedValueOnce({
      body: {
        journals: [
          journal({
            journalLines: [
              { accountCode: "631", accountID: uuidInput.toLowerCase(), accountName: "Advertising" },
            ],
          }),
        ],
      },
    });

    const response = await listXeroAccountTransactions(uuidInput, "2026-06-01");

    expect(response.isError).toBe(false);
    expect(response.result?.rows).toHaveLength(1);
    expect(response.result?.rows[0]?.accountName).toBe("Advertising");
  });

  it("test_fromDateProvided_callsGetJournalsWithIfModifiedSinceDate", async () => {
    getJournals.mockResolvedValueOnce({ body: { journals: [] } });

    await listXeroAccountTransactions("631", "2026-06-01");

    expect(getJournals).toHaveBeenCalledWith(
      "test-tenant-id",
      new Date("2026-06-01"),
      0,
      false,
      expect.anything(),
    );
  });

  it("test_fromDateOmitted_callsGetJournalsWithUndefinedIfModifiedSince", async () => {
    getJournals.mockResolvedValueOnce({ body: { journals: [] } });

    await listXeroAccountTransactions("631");

    expect(getJournals).toHaveBeenCalledWith(
      "test-tenant-id",
      undefined,
      0,
      false,
      expect.anything(),
    );
  });

  it("test_fromDateOmitted_stillReturnsMatchingLines", async () => {
    // Guards the `!fromDate` prefix in isWithinRange: without it, `journalDay >= undefined`
    // is false and every journal would be silently excluded.
    getJournals.mockResolvedValueOnce({
      body: {
        journals: [journal({ journalLines: [{ accountCode: "631" }] })],
      },
    });

    const response = await listXeroAccountTransactions("631");

    expect(response.isError).toBe(false);
    expect(response.result?.showing).toBe(1);
    expect(response.result?.rows[0]?.accountCode).toBe("631");
  });

  it("test_dateInput_normalisedToIsoDateString", async () => {
    // journalDate arrives as a JS Date (production wire format); formatDate must
    // normalise it to a YYYY-MM-DD string for both the range filter and row.date.
    getJournals.mockResolvedValueOnce({
      body: {
        journals: [
          journal({
            journalDate: wireDate("2026-06-15T09:30:00.000Z"),
            journalLines: [{ accountCode: "631" }],
          }),
        ],
      },
    });

    const response = await listXeroAccountTransactions("631", "2026-06-01", "2026-06-30");

    expect(response.result?.rows).toHaveLength(1);
    expect(response.result?.rows[0]?.date).toBe("2026-06-15");
  });

  it("test_fullPagesUntilBudget_returnsNonNullNextOffset", async () => {
    for (let page = 0; page < 10; page++) {
      getJournals.mockResolvedValueOnce({
        body: { journals: fullPage(page * 100 + 1) },
      });
    }

    const response = await listXeroAccountTransactions("631", "2026-06-01");

    expect(getJournals).toHaveBeenCalledTimes(10);
    expect(response.result?.nextOffset).toBe(1000);
  });

  it("test_secondCallResumesFromNextOffset", async () => {
    for (let page = 0; page < 10; page++) {
      getJournals.mockResolvedValueOnce({
        body: { journals: fullPage(page * 100 + 1) },
      });
    }
    const first = await listXeroAccountTransactions("631", "2026-06-01");
    const resumeOffset = first.result?.nextOffset;
    expect(resumeOffset).not.toBeNull();

    getJournals.mockReset();
    getJournals.mockResolvedValueOnce({ body: { journals: [] } });
    await listXeroAccountTransactions("631", "2026-06-01", undefined, resumeOffset!);

    expect(getJournals).toHaveBeenCalledWith(
      "test-tenant-id",
      new Date("2026-06-01"),
      resumeOffset,
      false,
      expect.anything(),
    );
  });

  it("test_partialPageOnFirstCall_stopsAfterOneCall", async () => {
    getJournals.mockResolvedValueOnce({
      body: { journals: [journal({ journalNumber: 42 })] },
    });

    const response = await listXeroAccountTransactions("631", "2026-06-01");

    expect(getJournals).toHaveBeenCalledTimes(1);
    expect(response.result?.nextOffset).toBeNull();
  });

  it("test_outOfRangeJournals_excludedFromRows", async () => {
    getJournals.mockResolvedValueOnce({
      body: {
        journals: [
          journal({
            journalNumber: 1,
            journalDate: "2026-05-31",
            journalLines: [{ accountCode: "631" }],
          }),
          journal({
            journalNumber: 2,
            journalDate: "2026-07-01",
            journalLines: [{ accountCode: "631" }],
          }),
          journal({
            journalNumber: 3,
            journalDate: "2026-06-15",
            journalLines: [{ accountCode: "631" }],
          }),
        ],
      },
    });

    const response = await listXeroAccountTransactions(
      "631",
      "2026-06-01",
      "2026-06-30",
    );

    expect(response.result?.rows).toHaveLength(1);
    expect(response.result?.rows[0]?.date).toBe("2026-06-15");
  });

  it("test_matchingLine_assembledIntoExactRowShape", async () => {
    getJournals.mockResolvedValueOnce({
      body: {
        journals: [
          journal({
            journalNumber: 12345,
            journalDate: "2026-06-15",
            sourceType: Journal.SourceTypeEnum.ACCREC,
            journalLines: [
              {
                accountCode: "631",
                accountName: "Advertising",
                description: "Facebook Ads",
                netAmount: 500,
                grossAmount: 575,
                taxAmount: 75,
                taxType: "OUTPUT2",
              },
            ],
          }),
        ],
      },
    });

    const response = await listXeroAccountTransactions("631", "2026-06-01");

    expect(response.result?.rows[0]).toEqual({
      date: "2026-06-15",
      journalNumber: 12345,
      accountCode: "631",
      accountName: "Advertising",
      description: "Facebook Ads",
      netAmount: 500,
      grossAmount: 575,
      taxAmount: 75,
      taxType: "OUTPUT2",
      sourceType: "ACCREC",
    });
  });

  it("test_emptyPeriodScanExhausted_returnsNullNextOffset", async () => {
    getJournals.mockResolvedValueOnce({
      body: {
        journals: [
          journal({ journalNumber: 1, journalLines: [{ accountCode: "631" }] }),
        ],
      },
    });

    const response = await listXeroAccountTransactions(
      "999",
      "2026-06-01",
      "2026-06-30",
    );

    expect(response.result).toEqual({
      account: "999",
      showing: 0,
      nextOffset: null,
      complete: false,
      warning: expect.any(String),
      rows: [],
    });
  });

  it("test_completeFlag_reflectsFromDateNarrowing", async () => {
    getJournals.mockResolvedValue({ body: { journals: [] } });

    // fromDate provided -> ifModifiedSince narrowing -> may under-report -> complete:false + warning
    const narrowed = await listXeroAccountTransactions("631", "2026-06-01");
    expect(narrowed.result?.complete).toBe(false);
    expect(narrowed.result?.warning).toEqual(expect.any(String));

    // fromDate omitted -> exhaustive scan -> complete:true, no warning
    const exhaustive = await listXeroAccountTransactions("631");
    expect(exhaustive.result?.complete).toBe(true);
    expect(exhaustive.result?.warning).toBeNull();
  });

  it("test_sparseAccountBudgetExhausted_showingZeroWithNonNullNextOffset", async () => {
    for (let page = 0; page < 10; page++) {
      getJournals.mockResolvedValueOnce({
        body: { journals: fullPage(page * 100 + 1) },
      });
    }

    const response = await listXeroAccountTransactions("999", "2026-06-01");

    expect(response.result?.showing).toBe(0);
    expect(response.result?.rows).toEqual([]);
    expect(response.result?.nextOffset).not.toBeNull();
  });
});
