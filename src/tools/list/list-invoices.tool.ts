import { z } from "zod";
import { listXeroInvoices } from "../../handlers/list-xero-invoices.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { listResponse } from "../../helpers/json-response.js";

const ListInvoicesTool = CreateXeroTool(
  "list-invoices",
  "List invoices in Xero. This includes Draft, Submitted, and Paid invoices. \
  Ask the user if they want to see invoices for a specific contact, \
  invoice number, or to see all invoices before running. \
  The response's `hasMore` is true when a full page of 1000 invoices was \
  returned — ask the user if they want the next page, then call this tool \
  again with the next page number and the contact or invoice number if one \
  was provided in the previous call.",
  {
    page: z.number(),
    contactIds: z.array(z.string()).optional(),
    invoiceNumbers: z
      .array(z.string())
      .optional()
      .describe("If provided, invoice line items will also be returned"),
  },
  async ({ page, contactIds, invoiceNumbers }) => {
    const response = await listXeroInvoices(page, contactIds, invoiceNumbers);
    if (response.error !== null) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing invoices: ${response.error}`,
          },
        ],
      };
    }

    return listResponse(response.result, 1000);
  },
);

export default ListInvoicesTool;
