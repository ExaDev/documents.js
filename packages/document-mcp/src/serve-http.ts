import { createServer as createHttpServer } from "node:http";
import type { Server as HttpServer } from "node:http";

import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { createServer } from "./server";

// The path an HTTP/SSE-only client (Claude Web, Claude Mobile, ChatGPT) is told to add as a connector -- see the README's remote transport section. A path other than this, or a GET/DELETE against it, falls through to createMcpHandler's own routing (legacy session operations, 405s, and so on); everything else on this listener 404s.
export const MCP_HTTP_PATH = "/mcp";

// Binds a plain node:http listener over the same server factory src/bin.ts's stdio path uses (see src/server.ts), so both transports register the identical tool set from one place. Built on the SDK's own createMcpHandler + toNodeHandler composition rather than a hand-rolled `NodeStreamableHTTPServerTransport` per request: createMcpHandler already serves both the current protocol era and the older HTTP+SSE era's stateless fallback from one factory, which a hand-wired transport would otherwise have to reimplement to stay spec-compliant. createMcpHandler performs no Host/Origin validation of its own by design (see its own doc comment) -- appropriate here because this listener's whole purpose, per the README, is remote access through an operator-supplied tunnel or reverse proxy presenting its own public hostname, which a localhost-only allowlist would reject outright. Binding to the loopback interface is the actual network boundary: only a same-machine tunnel process (or a reverse proxy explicitly configured to forward here) can ever reach the socket.
export function serveHttp(port: number): Promise<HttpServer> {
  const handler = createMcpHandler(createServer);
  const nodeHandler = toNodeHandler(handler);

  const httpServer = createHttpServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== MCP_HTTP_PATH) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    void nodeHandler(req, res);
  });

  httpServer.on("close", () => {
    void handler.close();
  });

  return new Promise((resolve) => {
    httpServer.listen(port, "127.0.0.1", () => {
      resolve(httpServer);
    });
  });
}
