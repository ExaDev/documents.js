import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import type { DocumentOperation } from "document-operations";

// Wraps a thrown error into an isError CallToolResult, carrying the thrown message verbatim -- the same shape @modelcontextprotocol/server's own registerTool dispatcher would produce automatically for an uncaught throw (see https://ts.sdk.modelcontextprotocol.io/v2/servers/errors), made explicit here so registerOperation's own mapError hook has a well-defined fallback to defer to.
function toErrorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Registers one document-operations DocumentOperation as an MCP tool: `title`/`description`/`inputSchema`/`outputSchema` come straight from the operation, and a successful `run()` result is wrapped in the identical `{ content: [...], structuredContent }` shape every tool in this package already returned before the operations moved out to document-operations.
 *
 * `mapError` lets a caller special-case one of the operation's own thrown error types into an enriched result (e.g. odb_render_report's OdbReportNotSpecifiedError, odm_to_pdf's OdmUnresolvedSectionError) -- return undefined to fall through to the default `toErrorResult` wrapping for every other error.
 */
export function registerOperation(
  server: McpServer,
  operation: DocumentOperation,
  options?: {
    readonly mapError?: (error: unknown) => CallToolResult | undefined;
  },
): void {
  server.registerTool(
    operation.name,
    {
      title: operation.title,
      description: operation.description,
      inputSchema: operation.inputSchema,
      ...(operation.outputSchema === undefined
        ? {}
        : { outputSchema: operation.outputSchema }),
    },
    async (args: unknown, ctx) => {
      try {
        const result = await operation.run(args, {
          signal: ctx.mcpReq.signal,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return options?.mapError?.(error) ?? toErrorResult(error);
      }
    },
  );
}
