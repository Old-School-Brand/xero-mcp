import { listXeroPayrollEmployees } from "../../handlers/list-xero-payroll-employees.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { listResponse } from "../../helpers/json-response.js";

const ListPayrollEmployeesTool = CreateXeroTool(
  "list-payroll-employees",
  `List all payroll employees in Xero.
This retrieves comprehensive employee details including names, User IDs, dates of birth, email addresses, gender, phone numbers, start dates, engagement types (Permanent, FixedTerm, or Casual), titles, and when records were last updated.
The response presents a complete overview of all staff currently registered in your Xero payroll, with their personal and employment information. If there are many employees, ask the user if they would like to see more detailed information about specific employees before proceeding.`,
  {},
  async () => {
    const response = await listXeroPayrollEmployees();

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing payroll employees: ${response.error}`,
          },
        ],
      };
    }

    return listResponse(response.result);
  },
);

export default ListPayrollEmployeesTool;
