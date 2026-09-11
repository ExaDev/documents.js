import type { McpServer } from "@modelcontextprotocol/server";
import { describeFontFileOperation, fontsOperation } from "document-operations";
import { registerOperation } from "../register-operation";

export function registerFontTools(server: McpServer): void {
  registerOperation(server, fontsOperation);
  registerOperation(server, describeFontFileOperation);
}
