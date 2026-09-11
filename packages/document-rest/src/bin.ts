#!/usr/bin/env node
import { createRestServer } from "./server";

const DEFAULT_PORT = 3100;

// Reads a `--name value` or `--name=value` flag from argv, whichever form the caller used. Mirrors document-mcp's own src/bin.ts readFlag exactly.
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const portArg = readFlag(args, "port");
  const port = portArg === undefined ? DEFAULT_PORT : parsePort(portArg);

  const server = createRestServer();
  await new Promise<void>((resolve) => {
    // Loopback-only, matching document-mcp's own --transport http listener: this process has no authentication or Host/Origin allowlisting of its own, so binding to 127.0.0.1 is the actual network boundary -- whatever fronts it for remote access (a tunnel, a reverse proxy) is responsible for authenticating callers before traffic ever reaches this process.
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error(
      "Expected the HTTP server to bind a TCP address, not a pipe or Unix socket",
    );
  }
  console.error(
    `document-rest listening on http://127.0.0.1:${String(address.port)}`,
  );
}

await main();
