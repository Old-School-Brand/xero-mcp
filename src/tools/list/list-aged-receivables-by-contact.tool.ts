import { z } from "zod";
import { listXeroAgedReceivablesByContact } from "../../handlers/list-aged-receivables-by-contact.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { reportResponse } from "../../helpers/report-envelope.js";

const ListAgedReceivablesByContact = CreateXeroTool(
  "list-aged-receivables-by-contact",
  `Lists the aged receivables in Xero.
  This shows aged receivables for a certain contact up to a report date, optionally
  filtered to invoices between invoicesFromDate and invoicesToDate.
  Returns a report envelope: {report, date, updatedAt, columns, sections: [{title, rows, total}]}.`,
  {
    contactId: z.string(),
    reportDate: z.string().optional()
      .describe("Optional date to retrieve aged receivables in YYYY-MM-DD format. If none is provided, defaults to end of the current month."),
    invoicesFromDate: z.string().optional()
      .describe("Optional from date in YYYY-MM-DD format. If provided, will only show payable invoices after this date for the contact."),
    invoicesToDate: z.string().optional()
      .describe("Optional to date in YYYY-MM-DD format. If provided, will only show payable invoices before this date for the contact."),
  },
  async ({ contactId, reportDate, invoicesFromDate, invoicesToDate }) => {
    const response = await listXeroAgedReceivablesByContact(contactId, reportDate, invoicesFromDate, invoicesToDate);

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing aged receivables by contact: ${response.error}`,
          },
        ],
      };
    }

    return reportResponse(response.result);
  }
);

export default ListAgedReceivablesByContact;
