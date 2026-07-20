import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { Account } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";

async function listAccounts(where?: string): Promise<Account[]> {
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
  where?: string,
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
