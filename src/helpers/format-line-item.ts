import { LineItem } from "xero-node";

export const formatLineItem = (lineItem: LineItem): string => {
  const tracking = lineItem.tracking?.length
    ? `Tracking: ${lineItem.tracking.map((t) => `${t.name}: ${t.option}`).join(", ")}`
    : "Tracking: No tracking";

  return [
    lineItem.item?.name ? `Item: ${lineItem.item.name}` : null,
    lineItem.itemCode ? `Item Code: ${lineItem.itemCode}` : "No item code",
    lineItem.description ? `Description: ${lineItem.description}` : "No description",
    `Quantity: ${lineItem.quantity}`,
    `Unit Amount: ${lineItem.unitAmount}`,
    lineItem.accountCode ? `Account Code: ${lineItem.accountCode}` : "No account code",
    lineItem.taxType ? `Tax Type: ${lineItem.taxType}` : "No tax type",
    tracking,
    `Line Amount: ${lineItem.lineAmount}`,
  ]
    .filter(Boolean)
    .join("\n");
};
