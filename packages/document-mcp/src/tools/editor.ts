import type { McpServer } from "@modelcontextprotocol/server";
import {
  documentAppendParagraphsOperation,
  documentCreateOperation,
} from "document-operations";
import { registerOperation } from "../register-operation";

export function registerEditorTools(server: McpServer): void {
  registerOperation(server, documentCreateOperation);
  registerOperation(server, documentAppendParagraphsOperation);
}
