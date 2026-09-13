import type { McpServer } from "@modelcontextprotocol/server";
import {
  convertDocumentOperation,
  listDocumentConversionsOperation,
} from "document-operations";
import { registerOperation } from "../register-operation";

export function registerConvertTools(server: McpServer): void {
  registerOperation(server, convertDocumentOperation);
  registerOperation(server, listDocumentConversionsOperation);
}
