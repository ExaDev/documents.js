import type { McpServer } from "@modelcontextprotocol/server";
import { outlineDocumentOperation } from "document-operations";
import { registerOperation } from "../register-operation";

export function registerOutlineTools(server: McpServer): void {
  registerOperation(server, outlineDocumentOperation);
}
