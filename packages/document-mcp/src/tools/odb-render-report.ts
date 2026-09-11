import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { OdbReportNotSpecifiedError } from "documents.js";
import { odbRenderReportOperation } from "document-operations";
import { registerOperation } from "../register-operation";

// The one place OdbReportNotSpecifiedError is turned into a tool result rather than left to propagate to the SDK's default isError wrapping: readOdbReportContent throws it when the .odb declares no report at all, or declares more than one and the caller named none -- mirroring odm.ts's own handling of OdmUnresolvedSectionError, and document-cli's own reportOdbReportError (src/commands/odb.ts), which special-cases exactly this error to name every available report rather than let a bare "no such report" message through. error.message already lists every available report by name (see documents.js's own src/odb/report/content.ts), and availableReports is surfaced again in structuredContent so a caller can pick one programmatically without re-parsing the message text. Exported (rather than kept private) so this file's own test can exercise the exact isError shape directly against a real OdbReportNotSpecifiedError instance, without needing a multi-report or zero-report .odb fixture (the one real fixture this repo checks in declares exactly one report, so this branch is otherwise unreachable through the full client/server round trip).
export function odbReportNotSpecifiedResult(
  error: OdbReportNotSpecifiedError,
): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: error.message }],
    structuredContent: { availableReports: error.availableReports },
  };
}

export function registerOdbRenderReportTools(server: McpServer): void {
  registerOperation(server, odbRenderReportOperation, {
    mapError: (error) =>
      error instanceof OdbReportNotSpecifiedError
        ? odbReportNotSpecifiedResult(error)
        : undefined,
  });
}
