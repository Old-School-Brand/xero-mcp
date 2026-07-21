import { z } from "zod";
import { listXeroTrialBalance } from "../../handlers/list-xero-trial-balance.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { reportResponse } from "../../helpers/report-envelope.js";

const ListTrialBalanceTool = CreateXeroTool(
  "list-trial-balance",
  "Lists trial balance in Xero. This provides a snapshot of the general ledger, showing debit " +
    "and credit balances for each account. Returns a report envelope: " +
    "{report, date, updatedAt, columns, sections: [{title, rows, total}]}.",
  {
    date: z.string().optional().describe("Optional date in YYYY-MM-DD format"),
    paymentsOnly: z.boolean().optional().describe("Optional flag to include only accounts with payments"),
  },
  async (args) => {
    const response = await listXeroTrialBalance(args?.date, args?.paymentsOnly);
    if (response.error !== null) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing trial balance: ${response.error}`,
          },
        ],
      };
    }

    return reportResponse(response.result);
  },
);

export default ListTrialBalanceTool;
