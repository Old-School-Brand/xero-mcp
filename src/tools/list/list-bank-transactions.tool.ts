import { z } from "zod";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { listXeroBankTransactions } from "../../handlers/list-xero-bank-transactions.handler.js";
import { listResponse } from "../../helpers/json-response.js";

const ListBankTransactionsTool = CreateXeroTool(
  "list-bank-transactions",
  `List all bank transactions in Xero.
  Ask the user if they want to see bank transactions for a specific bank account,
  or to see all bank transactions before running.
  The response's \`hasMore\` is true when a full page of 1000 bank transactions
  was returned — ask the user if they want the next page, then call this tool
  again with the next page number and the bank account if one was provided in
  the previous call.`,
  {
    page: z.number(),
    bankAccountId: z.string().optional()
  },
  async ({ bankAccountId, page }) => {
    const response = await listXeroBankTransactions(page, bankAccountId);
    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing bank transactions: ${response.error}`
          }
        ]
      };
    }

    return listResponse(response.result, 1000);
  }
);

export default ListBankTransactionsTool;
