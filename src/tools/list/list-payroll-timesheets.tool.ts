import {
  listXeroPayrollTimesheets,
} from "../../handlers/list-xero-timesheets.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { listResponse } from "../../helpers/json-response.js";

const ListPayrollTimesheetsTool = CreateXeroTool(
  "list-timesheets",
  `List all payroll timesheets in Xero.
This retrieves comprehensive timesheet details including timesheet IDs, employee IDs, start and end dates, total hours, and the last updated date.`,
  {},
  async () => {
    const response = await listXeroPayrollTimesheets();

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing timesheets: ${response.error}`,
          },
        ],
      };
    }

    return listResponse(response.result);
  },
);

export default ListPayrollTimesheetsTool;
