import type { McpServer } from "@modelcontextprotocol/server";
import { fromPackageOperation } from "document-operations";
import { registerOperation } from "../register-operation";

export function registerFromPackageTools(server: McpServer): void {
  registerOperation(server, fromPackageOperation);
}
