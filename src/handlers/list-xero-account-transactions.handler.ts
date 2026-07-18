import { Journal } from "xero-node";
import { xeroClient } from "../clients/xero-client.js";
import { formatDate } from "../helpers/format-date.js";
import { formatError } from "../helpers/format-error.js";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";

// Caps getJournals calls per tool invocation to bound Xero API-call rate cost,
// not response size (see design.md A1.4).
const MAX_PAGES_PER_CALL = 10;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AccountTransactionRow {
  date: string | undefined;
  journalNumber: number | undefined;
  accountCode: string | undefined;
  accountName: string | undefined;
  description: string | undefined;
  netAmount: number | undefined;
  grossAmount: number | undefined;
  taxAmount: number | undefined;
  taxType: string | undefined;
  sourceType: string | undefined;
}

export interface AccountTransactionsEnvelope {
  account: string;
  showing: number;
  nextOffset: number | null;
  rows: AccountTransactionRow[];
}

/**
 * Pages the Journals endpoint from `offset`, up to `MAX_PAGES_PER_CALL` calls.
 * Returns every journal seen and the continuation cursor: `null` once Xero
 * returns a partial (<100) page (the true last page), otherwise the highest
 * `JournalNumber` seen (the page budget ran out — more may remain).
 */
async function fetchJournalPages(
  ifModifiedSince: Date | undefined,
  offset: number,
): Promise<{ journals: Journal[]; nextOffset: number | null }> {
  await xeroClient.authenticate();

  let currentOffset = offset;
  const journals: Journal[] = [];

  for (let page = 0; page < MAX_PAGES_PER_CALL; page++) {
    const response = await xeroClient.accountingApi.getJournals(
      xeroClient.tenantId,
      ifModifiedSince,
      currentOffset,
      false, // paymentsOnly — accrual basis
      getClientHeaders(),
    );

    const pageJournals = response.body.journals ?? [];
    journals.push(...pageJournals);
    if (pageJournals.length === 0) return { journals, nextOffset: null };

    currentOffset = Math.max(
      ...pageJournals.map((journal) => journal.journalNumber ?? currentOffset),
    );
    if (pageJournals.length < 100) return { journals, nextOffset: null };
  }

  return { journals, nextOffset: currentOffset };
}

// Both bounds optional — an omitted fromDate/toDate does not exclude the journal.
function isWithinRange(
  journalDay: string | undefined,
  fromDate: string | undefined,
  toDate: string | undefined,
): boolean {
  if (journalDay === undefined) return false;
  return (!fromDate || journalDay >= fromDate) && (!toDate || journalDay <= toDate);
}

/**
 * Filters journals to their in-range date and, within those, the lines
 * matching the requested account (by AccountID when `account` is a UUID,
 * otherwise by AccountCode), flattened into row objects.
 */
function collectRows(
  journals: Journal[],
  account: string,
  isUUID: boolean,
  fromDate: string | undefined,
  toDate: string | undefined,
): AccountTransactionRow[] {
  const rows: AccountTransactionRow[] = [];

  for (const journal of journals) {
    // Normalise once per journal: xero-node deserialises Xero's /Date(...)/
    // wire format into a real JS Date despite the SDK's declared `string`
    // type, so a raw string compare on journal.journalDate would misfilter.
    const journalDay = formatDate(journal.journalDate);
    if (!isWithinRange(journalDay, fromDate, toDate)) continue;

    for (const line of journal.journalLines ?? []) {
      const matches = isUUID
        ? line.accountID === account
        : line.accountCode === account;
      if (!matches) continue;

      rows.push({
        date: journalDay,
        journalNumber: journal.journalNumber,
        accountCode: line.accountCode,
        accountName: line.accountName,
        description: line.description,
        netAmount: line.netAmount,
        grossAmount: line.grossAmount,
        taxAmount: line.taxAmount,
        taxType: line.taxType,
        // ObjectSerializer deserializes SourceTypeEnum as a plain string at runtime.
        sourceType: journal.sourceType as string | undefined,
      });
    }
  }

  return rows;
}

/**
 * Lists general-ledger lines for one account, over Xero's Journals endpoint.
 * See the tool description (list-account-transactions.tool.ts) for the
 * ifModifiedSince completeness caveat and the nextOffset continuation contract.
 */
export async function listXeroAccountTransactions(
  account: string,
  fromDate?: string,
  toDate?: string,
  offset?: number,
): Promise<XeroClientResponse<AccountTransactionsEnvelope>> {
  try {
    const isUUID = UUID_PATTERN.test(account);
    const ifModifiedSince = fromDate ? new Date(fromDate) : undefined;

    const { journals, nextOffset } = await fetchJournalPages(
      ifModifiedSince,
      offset ?? 0,
    );
    const rows = collectRows(journals, account, isUUID, fromDate, toDate);

    return {
      result: { account, showing: rows.length, nextOffset, rows },
      isError: false,
      error: null,
    };
  } catch (error) {
    return {
      result: null,
      isError: true,
      error: formatError(error),
    };
  }
}
