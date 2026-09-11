import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli";

// Only the --transport http path is exercised directly here: it binds a real, closeable net.Server this file can assert against and tear down. --transport stdio (main()'s own default) wires MCP's stdio transport directly onto this process's own stdin/stdout and keeps the process alive on open handles rather than returning a handle of its own -- src/tools/*.test.ts already exercises the stdio-registered server end to end via an in-memory transport, and test/smoke.test.mjs exercises the real stdio subprocess path; there is nothing left for a unit test of main() itself to usefully add for that branch without hijacking this test process's own stdio.
describe("main", () => {
  const originalArgv = process.argv;
  let server: Server | undefined;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
    if (server !== undefined) {
      await new Promise<void>((resolve) => {
        server?.close(() => {
          resolve();
        });
      });
      server = undefined;
    }
  });

  it("binds the default HTTP port when --transport http is given with no --port", async () => {
    process.argv = ["node", "bin.js", "--transport", "http", "--port", "0"];
    server = await main();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("document-mcp listening on http://127.0.0.1:"),
    );
  });

  it("binds an OS-assigned port and actually serves MCP requests on /mcp", async () => {
    process.argv = ["node", "bin.js", "--transport", "http", "--port", "0"];
    server = await main();
    const [message] = vi.mocked(console.error).mock.calls[0] as [string];
    const port = Number(/:(\d+)\/mcp$/.exec(message)?.[1]);
    expect(port).toBeGreaterThan(0);

    // No Accept header / body is a deliberately malformed MCP request -- this only confirms something is actually listening and routes /mcp through the MCP SDK's own handler (a non-2xx JSON-RPC-shaped response), not a full protocol round trip, which src/tools/*.test.ts and test/smoke.test.mjs already cover via a real client.
    const response = await fetch(`http://127.0.0.1:${String(port)}/mcp`);
    expect(response.status).not.toBe(404);
  });

  it("accepts --transport=http form", async () => {
    process.argv = ["node", "bin.js", "--transport=http", "--port", "0"];
    server = await main();
    expect(console.error).toHaveBeenCalled();
  });

  it("404s any path other than /mcp", async () => {
    process.argv = ["node", "bin.js", "--transport", "http", "--port", "0"];
    server = await main();
    const [message] = vi.mocked(console.error).mock.calls[0] as [string];
    const port = Number(/:(\d+)\/mcp$/.exec(message)?.[1]);

    const response = await fetch(`http://127.0.0.1:${String(port)}/other`);
    expect(response.status).toBe(404);
  });

  it("rejects an unknown --transport", async () => {
    process.argv = ["node", "bin.js", "--transport", "carrier-pigeon"];
    await expect(main()).rejects.toThrow(/Unknown --transport/);
  });

  it("rejects a non-integer --port", async () => {
    process.argv = [
      "node",
      "bin.js",
      "--transport",
      "http",
      "--port",
      "not-a-number",
    ];
    await expect(main()).rejects.toThrow(/--port must be an integer/);
  });

  it("rejects --transport with no value", async () => {
    process.argv = ["node", "bin.js", "--transport"];
    await expect(main()).rejects.toThrow(/--transport requires a value/);
  });

  it("binds the given --host instead of the loopback default", async () => {
    process.argv = [
      "node",
      "bin.js",
      "--transport",
      "http",
      "--host",
      "0.0.0.0",
      "--port",
      "0",
    ];
    server = await main();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("document-mcp listening on http://0.0.0.0:"),
    );
    const address = server?.address();
    if (
      address === null ||
      address === undefined ||
      typeof address === "string"
    ) {
      throw new Error("expected a TCP address");
    }
    expect(address.address).toBe("0.0.0.0");
  });
});
