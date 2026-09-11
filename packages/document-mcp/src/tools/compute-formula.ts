import type { McpServer } from "@modelcontextprotocol/server";
import { computeFormulaOperation } from "document-operations";
import { registerOperation } from "../register-operation";

export function registerComputeFormulaTools(server: McpServer): void {
  registerOperation(server, computeFormulaOperation);
}
