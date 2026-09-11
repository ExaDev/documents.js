import type { McpServer } from "@modelcontextprotocol/server";
import { OdmUnresolvedSectionError } from "documents.js";
import { odmToPdfOperation } from "document-operations";
import { registerOperation } from "../register-operation";

export function registerOdmTools(server: McpServer): void {
  registerOperation(server, odmToPdfOperation, {
    // odmToPdf's own OdmUnresolvedSectionError is enriched with an MCP-specific remediation hint and its own hrefs field, rather than left to the SDK's default isError wrapping -- mirrors odb-render-report.ts's own OdbReportNotSpecifiedError handling.
    mapError: (error) =>
      error instanceof OdmUnresolvedSectionError
        ? {
            isError: true,
            content: [
              {
                type: "text",
                text: `${error.message}\nPass chaptersDir <dir> containing these files, or an explicit chapters override, for each href.`,
              },
            ],
            structuredContent: { hrefs: error.hrefs },
          }
        : undefined,
  });
}
