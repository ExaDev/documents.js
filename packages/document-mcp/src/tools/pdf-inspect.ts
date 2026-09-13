import type { McpServer } from "@modelcontextprotocol/server";
import { pdfInspectOperation } from "document-operations";
import { registerOperation } from "../register-operation";

export function registerPdfInspectTools(server: McpServer): void {
  registerOperation(server, pdfInspectOperation);
}
