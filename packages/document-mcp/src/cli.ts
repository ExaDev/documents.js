import { serveStdio } from "@modelcontextprotocol/server/stdio";

import type { Server } from "node:http";
import { MCP_HTTP_PATH, serveHttp } from "./serve-http";
import { createServer } from "./server";

const DEFAULT_HTTP_PORT = 3000;

// Reads a `--name value` or `--name=value` flag from argv, whichever form the caller used. Returns undefined when the flag is absent at all, distinct from a flag present with no value (an empty string), so a caller can tell "not given" from "given empty" rather than the two collapsing into one absent case.
function readFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const [index, arg] of args.entries()) {
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
    if (arg === `--${name}`) {
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error(`--${name} requires a value`);
      }
      return value;
    }
  }
  return undefined;
}

function parsePort(raw: string): number {
  const port = Number.parseInt(raw, 10);
  if (
    !Number.isInteger(port) ||
    String(port) !== raw.trim() ||
    port < 0 ||
    port > 65535
  ) {
    throw new Error(
      `--port must be an integer between 0 and 65535, got "${raw}"`,
    );
  }
  return port;
}

/**
 * The real CLI entry logic, shared by both distribution shapes this package ships: `src/bin.ts` (the published npm `bin`, run under a real Node.js install) and `src/sea-entry.ts` (bundled into a Node single-executable application, which embeds its own Node runtime). Node's SEA feature runs only a CommonJS entry with no top-level await (see that file's own comment), so this function itself contains no top-level await of its own -- only `bin.ts` awaits calling it, at its own top level, which SEA never sees.
 *
 * Returns the bound `http.Server` for the `--transport http` path so a caller with a reason to stop it again (a test binding an ephemeral port for the duration of one assertion) can; `undefined` for `--transport stdio`, which has no equivalent handle to return -- `serveStdio` wires the process's own stdin/stdout directly and keeps the process alive on its own.
 */
export async function main(): Promise<Server | undefined> {
  const args = process.argv.slice(2);
  const transport = readFlag(args, "transport") ?? "stdio";

  if (transport === "stdio") {
    serveStdio(createServer);
    return undefined;
  }

  if (transport === "http") {
    const portArg = readFlag(args, "port");
    const port = portArg === undefined ? DEFAULT_HTTP_PORT : parsePort(portArg);
    const host = readFlag(args, "host") ?? "127.0.0.1";
    const httpServer = await serveHttp(port, host);
    const address = httpServer.address();
    if (address === null || typeof address === "string") {
      throw new Error(
        "Expected the HTTP server to bind a TCP address, not a pipe or Unix socket",
      );
    }
    console.error(
      `document-mcp listening on http://${host}:${String(address.port)}${MCP_HTTP_PATH}`,
    );
    return httpServer;
  }

  throw new Error(
    `Unknown --transport "${transport}". Supported values: stdio, http.`,
  );
}
