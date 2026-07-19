import { listXeroManualJournals } from "../../handlers/list-xero-manual-journals.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { listResponse } from "../../helpers/json-response.js";
import { z } from "zod";

const ListManualJournalsTool = CreateXeroTool(
  "list-manual-journals",
  `List all manual journals from Xero.
Ask the user if they want to see a specific manual journal or all manual journals before running.
Can optionally pass in manual journal ID to retrieve a specific journal, or a date to filter journals modified after that date.
The response presents a complete overview of all manual journals currently registered in your Xero account, with their details.
The response's \`hasMore\` is true when a full page of 1000 manual journals was returned — ask the user if they want the next page, then call this tool again with the next page number, modified date, and the manual journal ID if one was provided in the previous call.`,
  {
    manualJournalId: z
      .string()
      .optional()
      .describe("Optional ID of the manual journal to retrieve"),
    modifiedAfter: z
      .string()
      .optional()
      .describe(
        "Optional date YYYY-MM-DD to filter journals modified after this date",
      ),
    page: z.number().optional().describe("Optional page number for pagination"),
    // TODO: where, order
  },
  async (args) => {
    const response = await listXeroManualJournals(
      args?.page,
      args?.manualJournalId,
      args?.modifiedAfter,
    );

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing manual journals: ${response.error}`,
          },
        ],
      };
    }

    return listResponse(response.result, 1000);
  },
);

export default ListManualJournalsTool;
