import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";

import { ToolDefinition } from "../types/tool-definition.js";
import { CreateTools } from "./create/index.js";
import { DeleteTools } from "./delete/index.js";
import { GetTools } from "./get/index.js";
import { ListTools } from "./list/index.js";
import { UpdateTools } from "./update/index.js";

export function ToolFactory(server: McpServer) {
  const register = (tool: ToolDefinition<ZodRawShapeCompat>) =>
    server.tool(tool.name, tool.description, tool.schema, tool.handler);

  // Read tools (Get + List) are always available.
  GetTools.map((tool) => tool()).forEach(register);
  ListTools.map((tool) => tool()).forEach(register);

  // Read-only is the default posture. Write tools (Create/Update/Delete) are
  // registered only when writes are explicitly enabled with XERO_READONLY=false.
  if (process.env.XERO_READONLY === "false") {
    CreateTools.map((tool) => tool()).forEach(register);
    UpdateTools.map((tool) => tool()).forEach(register);
    DeleteTools.map((tool) => tool()).forEach(register);
  }
}
