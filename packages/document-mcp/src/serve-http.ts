import { createServer as createHttpServer } from "node:http";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";

import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { createServer } from "./server";

// The path an HTTP/SSE-only client (Claude Web, Claude Mobile, ChatGPT) is told to add as a connector — see the README's remote transport section. A GET/DELETE (or POST) against this exact path falls through to createMcpHandler's own routing (legacy session operations, 405s, and so on); every other path on this listener 404s before nodeHandler ever sees it.
export const MCP_HTTP_PATH = "/mcp";

// The bound server alongside the concrete address it actually bound — returned together because http.Server#address()'s own return type (AddressInfo | string | null) covers a Unix domain socket or pipe bind, or a server never listened on or already closed, none of which this function's own TCP-only listen(port, host) call can ever produce; resolving with the narrowed value here means every caller works with a real AddressInfo directly, rather than each one repeating a defensive check against a shape this function's own contract already rules out.
export interface HttpServerBinding {
  readonly server: HttpServer;
  readonly address: AddressInfo;
}

// Binds a plain node:http listener over the same server factory src/bin.ts's stdio path uses (see src/server.ts), so both transports register the identical tool set from one place. Built on the SDK's own createMcpHandler + toNodeHandler composition rather than a hand-rolled `NodeStreamableHTTPServerTransport` per request: createMcpHandler already serves both the current protocol era and the older HTTP+SSE era's stateless fallback from one factory, which a hand-wired transport would otherwise have to reimplement to stay spec-compliant. createMcpHandler performs no Host/Origin validation of its own by design (see its own doc comment) — appropriate here because this listener's whole purpose, per the README, is remote access through an operator-supplied tunnel or reverse proxy presenting its own public hostname, which a localhost-only allowlist would reject outright. `host` defaults to the loopback interface as the actual network boundary in every ordinary case (only a same-machine tunnel process, or a reverse proxy explicitly configured to forward here, can ever reach the socket), but a container's own ENTRYPOINT passes 0.0.0.0 instead: a loopback bind is unreachable from outside a container's network namespace no matter what port a `docker run -p` maps.
// Just the pieces of an HTTP request/response routeHttpRequest itself needs to make its routing decision — a real IncomingMessage/ServerResponse satisfies both structurally, but a test can exercise the no-url guard, the /mcp path match, and the 404 fallback with plain objects instead of standing up a live socket.
interface RoutableRequest {
  readonly url?: string;
}
interface RoutableResponse {
  writeHead: (
    statusCode: number,
    headers: Record<string, string>,
  ) => { end: (chunk: string) => void };
}

// Routes one HTTP request to onMcpRequest for MCP_HTTP_PATH, or 404s any other path — extracted from serveHttp's own listener callback so this routing decision is directly unit-testable. onMcpRequest takes no arguments because the real caller already closes over whichever req/res it is routing.
export function routeHttpRequest(
  req: RoutableRequest,
  res: RoutableResponse,
  onMcpRequest: () => void,
): void {
  // req.url is `string | undefined` only because IncomingMessage is shared with the client-request side of node:http, where a request line genuinely may not have been parsed yet; a request a server callback receives always carries its own request-line path already parsed.
  if (req.url === undefined) {
    throw new Error("serveHttp: request has no url");
  }
  const url = new URL(req.url, "http://localhost");
  if (url.pathname !== MCP_HTTP_PATH) {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  onMcpRequest();
}

export function serveHttp(
  port: number,
  host: string,
): Promise<HttpServerBinding> {
  const handler = createMcpHandler(createServer);
  const nodeHandler = toNodeHandler(handler);

  const httpServer = createHttpServer((req, res) => {
    routeHttpRequest(req, res, () => {
      void nodeHandler(req, res);
    });
  });

  return new Promise((resolve) => {
    httpServer.listen(port, host, () => {
      // Guaranteed AddressInfo per this function's own HttpServerBinding comment above: this callback only runs once listen(port, host) has actually bound a TCP socket.
      resolve({
        server: httpServer,
        address: httpServer.address() as AddressInfo,
      });
    });
  });
}
