import type { Server } from "node:http";
import { createRestServer } from "./server";

export const DEFAULT_PORT = 3100;

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

/**
 * The real CLI entry logic, shared by both distribution shapes this package ships: `src/bin.ts` (the published npm `bin`, run under a real Node.js install) and `src/sea-entry.ts` (bundled into a Node single-executable application, which embeds its own Node runtime). Node's SEA feature runs only a CommonJS entry with no top-level await (see that file's own comment), so this function itself contains no top-level await of its own -- only `bin.ts` awaits calling it, at its own top level, which SEA never sees.
 *
 * Returns the listening `Server` rather than resolving `void` so a caller with a reason to stop it again (a test binding an ephemeral port for the duration of one assertion) can -- neither real distribution shape needs to, so both simply discard it.
 */
export async function main(): Promise<Server> {
  const args = process.argv.slice(2);
  const portArg = readFlag(args, "port");
  const port = portArg === undefined ? DEFAULT_PORT : parsePort(portArg);
  // Defaults to loopback-only, matching document-mcp's own --transport http listener: this process has no authentication or Host/Origin allowlisting of its own, so binding to 127.0.0.1 is the actual network boundary -- whatever fronts it for remote access (a tunnel, a reverse proxy) is responsible for authenticating callers before traffic ever reaches this process. --host exists so a container's own ENTRYPOINT can bind 0.0.0.0 instead: a loopback bind is unreachable from outside a container's network namespace no matter what port a `docker run -p` maps, since Docker's port mapping reaches the container's external interface, not its loopback.
  const host = readFlag(args, "host") ?? "127.0.0.1";

  const server = createRestServer();
  await new Promise<void>((resolve) => {
    server.listen(port, host, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error(
      "Expected the HTTP server to bind a TCP address, not a pipe or Unix socket",
    );
  }
  console.error(
    `document-rest listening on http://${host}:${String(address.port)}`,
  );
  return server;
}
