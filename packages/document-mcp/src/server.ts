import { McpServer } from "@modelcontextprotocol/server";

// resolveJsonModule lets rolldown (via tsdown) inline this package's own declared version straight into the bundle at build time -- no runtime fs read, no import-attribute syntax that would otherwise need to differ between the ESM and CJS build outputs. Matches document-cli's own src/program.ts convention.
import { version } from "../package.json";
import { registerComputeFormulaTools } from "./tools/compute-formula";
import { registerConvertTools } from "./tools/convert";
import { registerDocxExtrasTools } from "./tools/docx-extras";
import { registerFontTools } from "./tools/fonts";
import { registerFromPackageTools } from "./tools/from-package";
import { registerMetadataTools } from "./tools/metadata";
import { registerOdbTools } from "./tools/odb";
import { registerOdbRenderReportTools } from "./tools/odb-render-report";
import { registerOdmTools } from "./tools/odm";
import { registerOutlineTools } from "./tools/outline";
import { registerPdfInspectTools } from "./tools/pdf-inspect";

// Builds a fresh MCP server instance advertising this package's own name and version. Never parses argv or connects a transport itself -- that is src/bin.ts's job, so this stays testable as pure construction and importable from anywhere, including both the stdio and HTTP entry points, which each call it once per connection/request rather than sharing one instance.
export function createServer(): McpServer {
  const server = new McpServer({ name: "document-mcp", version });

  registerComputeFormulaTools(server);
  registerConvertTools(server);
  registerDocxExtrasTools(server);
  registerFontTools(server);
  registerFromPackageTools(server);
  registerMetadataTools(server);
  registerOdbTools(server);
  registerOdbRenderReportTools(server);
  registerOdmTools(server);
  registerOutlineTools(server);
  registerPdfInspectTools(server);

  return server;
}
