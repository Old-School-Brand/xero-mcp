/*
Task: 2.1-2.2 formatLineItem: tracking render, item rendering, empty-field fallbacks
Source: .specs/004-response-formatting-fixes/backend/todo.md

Examples covered:
  - Example 1: Single tracking entry on a line item (AC 1)
  - Example 2: Multiple tracking entries on a line item (AC 2)
  - Example 3: Absent tracking on a line item (AC 3)
  - Example 4: Empty tracking array on a line item (AC 3)
  - Example 5: Missing itemCode and taxType fallbacks (AC 5)
  - Example 6: All line item fields present (AC 5)

Test plan:
  - test_single_tracking_entry_renders_name_option: one tracking entry renders "Tracking: Region: South"
  - test_multiple_tracking_entries_join_with_comma: two entries render "Tracking: Region: South, Channel: Online"
  - test_undefined_tracking_renders_no_tracking: tracking undefined renders "Tracking: No tracking"
  - test_empty_tracking_array_renders_no_tracking: tracking [] renders "Tracking: No tracking"
  - test_missing_item_code_and_tax_type_render_fallbacks: absent itemCode/taxType render "No item code"/"No tax type", no literal "undefined"
  - test_item_present_renders_item_name: lineItem.item = {name} renders "Item: <name>"
  - test_item_absent_omits_item_line: lineItem.item absent has no "Item:" line
  - test_all_fields_present_render_full_output_with_no_undefined: full example renders every field, no "undefined"/"[object Object]"
*/
import { describe, it, expect } from "vitest";
import { LineItem } from "xero-node";
import { formatLineItem } from "../format-line-item.js";

describe("formatLineItem tracking", () => {
  it("test_single_tracking_entry_renders_name_option", () => {
    const lineItem = { tracking: [{ name: "Region", option: "South" }] } as LineItem;
    expect(formatLineItem(lineItem)).toContain("Tracking: Region: South");
  });

  it("test_multiple_tracking_entries_join_with_comma", () => {
    const lineItem = {
      tracking: [
        { name: "Region", option: "South" },
        { name: "Channel", option: "Online" },
      ],
    } as LineItem;
    expect(formatLineItem(lineItem)).toContain(
      "Tracking: Region: South, Channel: Online",
    );
  });

  it("test_undefined_tracking_renders_no_tracking", () => {
    const lineItem = { tracking: undefined } as LineItem;
    expect(formatLineItem(lineItem)).toContain("Tracking: No tracking");
  });

  it("test_empty_tracking_array_renders_no_tracking", () => {
    const lineItem = { tracking: [] } as unknown as LineItem;
    expect(formatLineItem(lineItem)).toContain("Tracking: No tracking");
  });
});

describe("formatLineItem fallbacks and item rendering", () => {
  it("test_missing_item_code_and_tax_type_render_fallbacks", () => {
    const lineItem = {
      itemCode: undefined,
      taxType: undefined,
      quantity: 1,
      unitAmount: 5,
      lineAmount: 5,
    } as LineItem;
    const result = formatLineItem(lineItem);
    expect(result).toContain("No item code");
    expect(result).toContain("No tax type");
    expect(result).toContain("No description");
    expect(result).toContain("No account code");
    expect(result).not.toContain("undefined");
  });

  it("test_item_present_renders_item_name", () => {
    const lineItem = { item: { name: "Widget", itemID: "abc-123" } } as LineItem;
    expect(formatLineItem(lineItem)).toContain("Item: Widget");
  });

  it("test_item_absent_omits_item_line", () => {
    const lineItem = {} as LineItem;
    expect(formatLineItem(lineItem)).not.toContain("Item:");
  });

  it("test_all_fields_present_render_full_output_with_no_undefined", () => {
    const lineItem = {
      description: "Widget",
      quantity: 2,
      unitAmount: 10.0,
      accountCode: "200",
      taxType: "OUTPUT2",
      itemCode: "WIDGET-001",
      lineAmount: 20.0,
      tracking: [{ name: "Region", option: "South" }],
      item: { name: "Widget", itemID: "abc-123" },
    } as LineItem;

    const result = formatLineItem(lineItem);

    expect(result).not.toContain("undefined");
    expect(result).not.toContain("[object Object]");
    expect(result).toContain("Item: Widget");
    expect(result).toContain("Item Code: WIDGET-001");
    expect(result).toContain("Description: Widget");
    expect(result).toContain("Quantity: 2");
    expect(result).toContain("Unit Amount: 10");
    expect(result).toContain("Account Code: 200");
    expect(result).toContain("Tax Type: OUTPUT2");
    expect(result).toContain("Tracking: Region: South");
    expect(result).toContain("Line Amount: 20");
  });
});
