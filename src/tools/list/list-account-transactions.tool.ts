import { z } from "zod";
import { listXeroAccountTransactions } from "../../handlers/list-xero-account-transactions.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListAccountTransactionsTool = CreateXeroTool(
  "list-account-transactions",
  `Lists general-ledger lines for one account. Supply \`fromDate\` for a fast month-end pull — but note \`fromDate\` narrows by *modification* date, so journals posted before \`fromDate\` with a \`JournalDate\` in range (future-dated/back-dated entries, bulk imports) are not returned. For a complete, exhaustive extract, omit \`fromDate\` (slower — scans the ledger by offset). Use \`offset\` from the previous call's \`nextOffset\` to continue; \`showing: 0\` with a non-null \`nextOffset\` means keep going (the account was inactive in that slice, not that you are done). The response envelope carries \`complete\` (false when \`fromDate\` narrowing may omit journals) and a \`warning\` string in that case — treat the figures as potentially incomplete for reconciliation unless \`complete\` is true.`,
  {
    account: z.string().describe('Xero account code (e.g. "631") or AccountID UUID'),
    fromDate: z
      .string()
      .optional()
      .describe(
        "YYYY-MM-DD. Narrows server-side via ifModifiedSince and filters JournalDate >= fromDate",
      ),
    toDate: z
      .string()
      .optional()
      .describe("YYYY-MM-DD. Filters JournalDate <= toDate. Open-ended when omitted"),
    offset: z
      .number()
      .optional()
      .describe("Continuation cursor from a previous call's nextOffset"),
  },
  async ({ account, fromDate, toDate, offset }) => {
    const response = await listXeroAccountTransactions(
      account,
      fromDate,
      toDate,
      offset,
    );

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing account transactions: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(response.result),
        },
      ],
    };
  },
);

export default ListAccountTransactionsTool;
