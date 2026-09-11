import type { McpServer } from "@modelcontextprotocol/server";
import {
  metadataReadOperation,
  metadataWriteOperation,
} from "document-operations";
import { registerOperation } from "../register-operation";

export function registerMetadataTools(server: McpServer): void {
  registerOperation(server, metadataReadOperation);
  registerOperation(server, metadataWriteOperation);
}
