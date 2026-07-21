import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { Account } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";

// Closed union, not `string` — the only pre-built clause callers may pass. This
// makes it a compile-time error to thread unsanitized user input into the Xero
// API's `where` filter (which does not distinguish it from a query expression).
type AccountsWhereFilter = 'Status=="ACTIVE"';

async function listAccounts(where?: AccountsWhereFilter): Promise<Account[]> {
  await xeroClient.authenticate();

  const response = await xeroClient.accountingApi.getAccounts(
    xeroClient.tenantId,
    undefined, // ifModifiedSince
    where,
    undefined, // order
    getClientHeaders(),
  );

  const accounts = response.body.accounts ?? [];
  return accounts;
}

/**
 * List all accounts from Xero
 * @param where Optional Xero API `where` filter clause, e.g. `Status=="ACTIVE"`
 */
export async function listXeroAccounts(
  where?: AccountsWhereFilter,
): Promise<XeroClientResponse<Account[]>> {
  try {
    const accounts = await listAccounts(where);

    return {
      result: accounts,
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
