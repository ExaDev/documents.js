import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { DOCUMENT_OPERATIONS } from "document-operations";
import type { DocumentOperation } from "document-operations";
import {
  OdbReportNotSpecifiedError,
  OdmUnresolvedSectionError,
} from "documents.js";
import { z } from "zod";

const OPERATIONS_BY_NAME: ReadonlyMap<string, DocumentOperation> = new Map(
  DOCUMENT_OPERATIONS.map((operation) => [operation.name, operation]),
);

// A caller-facing error mapping for one operation's own typed error -- the REST counterpart to document-mcp's own registerOperation `mapError` hooks (packages/document-mcp/src/register-operation.ts). Returns undefined to fall through to the default 400 { error: message } body.
interface RestErrorMapping {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

// Keyed by operation name rather than a per-operation registration call (document-mcp's own convention): document-rest has no per-operation registration step of its own to hang a mapError option off, since every operation is dispatched generically through OPERATIONS_BY_NAME.
const ERROR_MAPPERS: ReadonlyMap<
  string,
  (error: unknown) => RestErrorMapping | undefined
> = new Map([
  [
    "odb_render_report",
    (error: unknown): RestErrorMapping | undefined => {
      if (!(error instanceof OdbReportNotSpecifiedError)) return undefined;
      return {
        status: 400,
        body: {
          error: error.message,
          availableReports: error.availableReports,
        },
      };
    },
  ],
  [
    "odm_to_pdf",
    (error: unknown): RestErrorMapping | undefined => {
      if (!(error instanceof OdmUnresolvedSectionError)) return undefined;
      return {
        status: 400,
        body: {
          error: `${error.message} Pass chaptersDir containing these files, or an explicit chapters override, for each href.`,
          hrefs: error.hrefs,
        },
      };
    },
  ],
]);

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf-8");
  if (text.length === 0) return {};
  return JSON.parse(text);
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
}

// A signal that aborts if the client disconnects before the operation finishes -- node:http's IncomingMessage carries no AbortSignal of its own, only a 'close' event, so this bridges the two the same way Node's own fetch-adjacent APIs (e.g. Request.signal in undici) are built internally.
function abortSignalFor(req: IncomingMessage): AbortSignal {
  const controller = new AbortController();
  req.once("close", () => {
    controller.abort();
  });
  return controller.signal;
}

async function handleOperationRequest(
  req: IncomingMessage,
  res: ServerResponse,
  operation: DocumentOperation,
): Promise<void> {
  let rawBody: unknown;
  try {
    rawBody = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, {
      error: `Request body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }

  const parsed = operation.inputSchema.safeParse(rawBody);
  if (!parsed.success) {
    sendJson(res, 400, {
      error: "Request body failed validation.",
      issues: z.treeifyError(parsed.error),
    });
    return;
  }

  try {
    const result = await operation.run(parsed.data, {
      signal: abortSignalFor(req),
    });
    sendJson(res, 200, { result: result });
  } catch (error) {
    const mapped = ERROR_MAPPERS.get(operation.name)?.(error);
    if (mapped !== undefined) {
      sendJson(res, mapped.status, mapped.body);
      return;
    }
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function listOperations(): Record<string, unknown> {
  return {
    operations: DOCUMENT_OPERATIONS.map((operation) => ({
      name: operation.name,
      title: operation.title,
      description: operation.description,
    })),
  };
}

/**
 * Builds a REST API server exposing every document-operations DocumentOperation as `POST /<name>`: the JSON request body is validated against the operation's own inputSchema, `run()` is called with the parsed input, and the result is returned as `{ result }`. `GET /` lists every available operation (name/title/description) for discovery. Never started -- `src/bin.ts` binds it to a port; a test binds it to an ephemeral one.
 */
export function createRestServer(): Server {
  return createHttpServer((req, res) => {
    void (async () => {
      if (req.url === undefined || req.method === undefined) {
        sendJson(res, 400, { error: "Malformed request: no url or method." });
        return;
      }
      const url = new URL(req.url, "http://localhost");

      if (url.pathname === "/" && req.method === "GET") {
        sendJson(res, 200, listOperations());
        return;
      }

      const name = url.pathname.replace(/^\//, "");
      const operation = OPERATIONS_BY_NAME.get(name);
      if (operation === undefined) {
        sendJson(res, 404, {
          error: `No operation named "${name}". GET / lists every available operation.`,
        });
        return;
      }

      if (req.method !== "POST") {
        sendJson(res, 405, {
          error: `${name} only accepts POST, received ${req.method}.`,
        });
        return;
      }

      await handleOperationRequest(req, res, operation);
    })();
  });
}
