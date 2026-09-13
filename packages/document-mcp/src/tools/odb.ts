import type { McpServer } from "@modelcontextprotocol/server";
import {
  odbFormsOperation,
  odbQueryOperation,
  odbReportsOperation,
  odbTablesOperation,
  odbToCsvOperation,
  odbToXlsxOperation,
} from "document-operations";
import { registerOperation } from "../register-operation";

export function registerOdbTools(server: McpServer): void {
  registerOperation(server, odbTablesOperation);
  registerOperation(server, odbFormsOperation);
  registerOperation(server, odbReportsOperation);
  registerOperation(server, odbQueryOperation);
  registerOperation(server, odbToCsvOperation);
  registerOperation(server, odbToXlsxOperation);
}
