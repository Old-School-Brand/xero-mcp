import { z } from "zod";
import { listXeroProfitAndLoss } from "../../handlers/list-xero-profit-and-loss.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { reportResponse } from "../../helpers/report-envelope.js";

const ListProfitAndLossTool = CreateXeroTool(
  "list-profit-and-loss",
  "Lists profit and loss report in Xero. This provides a summary of revenue, expenses, and " +
    "profit or loss over a specified period of time. Returns a report envelope: " +
    "{report, date, updatedAt, columns, sections: [{title, rows, total}]}.",
  {
    fromDate: z.string().optional().describe("Optional start date in YYYY-MM-DD format"),
    toDate: z.string().optional().describe("Optional end date in YYYY-MM-DD format"),
    periods: z.number().optional().describe("Optional number of periods to compare"),
    timeframe: z.enum(["MONTH", "QUARTER", "YEAR"]).optional().describe("Optional timeframe for the report (MONTH, QUARTER, YEAR)"),
    standardLayout: z.boolean().optional().describe("Optional flag to use standard layout"),
    paymentsOnly: z.boolean().optional().describe("Optional flag to include only accounts with payments"),
  },
  async (args) => {
    const response = await listXeroProfitAndLoss(
      args?.fromDate,
      args?.toDate,
      args?.periods,
      args?.timeframe,
      args?.standardLayout,
      args?.paymentsOnly,
    );

    if (response.error !== null) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing profit and loss report: ${response.error}`,
          },
        ],
      };
    }

    return reportResponse(response.result);
  },
);

export default ListProfitAndLossTool;
