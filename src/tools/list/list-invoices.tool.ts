import { z } from "zod";
import { listXeroInvoices } from "../../handlers/list-xero-invoices.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { formatLineItem } from "../../helpers/format-line-item.js";
import { formatDate, formatDateTime } from "../../helpers/format-date.js";
import { paginationHint } from "../../helpers/pagination-hint.js";

const ListInvoicesTool = CreateXeroTool(
  "list-invoices",
  "List invoices in Xero. This includes Draft, Submitted, and Paid invoices. \
  Ask the user if they want to see invoices for a specific contact, \
  invoice number, or to see all invoices before running. \
  Ask the user if they want the next page of invoices after running this tool \
  if 100 invoices are returned. \
  If they want the next page, call this tool again with the next page number \
  and the contact or invoice number if one was provided in the previous call.",
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

    const invoices = response.result;
    const returnLineItems = (invoiceNumbers?.length ?? 0) > 0;

    const hint = paginationHint(invoices?.length ?? 0, page);

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${invoices?.length || 0} invoices:`,
        },
        ...(invoices?.map((invoice) => ({
          type: "text" as const,
          text: [
            `Invoice ID: ${invoice.invoiceID}`,
            `Invoice: ${invoice.invoiceNumber}`,
            invoice.reference ? `Reference: ${invoice.reference}` : null,
            `Type: ${invoice.type || "Unknown"}`,
            `Status: ${invoice.status || "Unknown"}`,
            invoice.contact
              ? `Contact: ${invoice.contact.name} (${invoice.contact.contactID})`
              : null,
            invoice.date ? `Date: ${formatDate(invoice.date)}` : null,
            invoice.dueDate ? `Due Date: ${formatDate(invoice.dueDate)}` : null,
            invoice.lineAmountTypes
              ? `Line Amount Types: ${invoice.lineAmountTypes}`
              : null,
            invoice.subTotal ? `Sub Total: ${invoice.subTotal}` : null,
            invoice.totalTax ? `Total Tax: ${invoice.totalTax}` : null,
            `Total: ${invoice.total || 0}`,
            invoice.totalDiscount
              ? `Total Discount: ${invoice.totalDiscount}`
              : null,
            invoice.currencyCode ? `Currency: ${invoice.currencyCode}` : null,
            invoice.currencyRate
              ? `Currency Rate: ${invoice.currencyRate}`
              : null,
            invoice.updatedDateUTC
              ? `Last Updated: ${formatDateTime(invoice.updatedDateUTC)}`
              : null,
            invoice.fullyPaidOnDate
              ? `Fully Paid On: ${formatDate(invoice.fullyPaidOnDate)}`
              : null,
            invoice.amountDue ? `Amount Due: ${invoice.amountDue}` : null,
            invoice.amountPaid ? `Amount Paid: ${invoice.amountPaid}` : null,
            invoice.amountCredited
              ? `Amount Credited: ${invoice.amountCredited}`
              : null,
            invoice.hasErrors ? "Has Errors: Yes" : null,
            invoice.isDiscounted ? "Is Discounted: Yes" : null,
            returnLineItems
              ? invoice.lineItems?.length
                ? `Line Items:\n${invoice.lineItems.map(formatLineItem).join("\n\n")}`
                : "Line Items: No line items"
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
        ...(hint ? [{ type: "text" as const, text: hint }] : []),
      ],
    };
  },
);

export default ListInvoicesTool;
