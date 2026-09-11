import type { McpServer } from "@modelcontextprotocol/server";
import { docxExtrasOperation } from "document-operations";
import { registerOperation } from "../register-operation";

export function registerDocxExtrasTools(server: McpServer): void {
  registerOperation(server, docxExtrasOperation);
}
