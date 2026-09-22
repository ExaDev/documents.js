import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main, parsePort, readFlag } from "./cli";

vi.mock("@modelcontextprotocol/server/stdio", () => ({ serveStdio: vi.fn() }));

// The --transport http path is exercised against a real, closeable net.Server this file can assert against and tear down. The --transport stdio path (main()'s own default) has `@modelcontextprotocol/server/stdio`'s own serveStdio mocked at the top of this file instead of calling through for real: the real implementation wires MCP's stdio transport directly onto this process's own stdin/stdout and keeps the process alive on open handles, which src/tools/*.test.ts already exercises end to end via an in-memory transport and test/smoke.test.mjs exercises via a real stdio subprocess — mocking it here only proves main() reaches and calls it with the right factory, not that the real transport works.
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

  it("defaults to stdio transport and wires it to createServer when --transport is omitted entirely", async () => {
    const { serveStdio } = await import("@modelcontextprotocol/server/stdio");
    const { createServer } = await import("./server");
    process.argv = ["node", "bin.js"];
    const result = await main();
    expect(result).toBeUndefined();
    expect(serveStdio).toHaveBeenCalledWith(createServer);
  });

  it("only scans flags from argv[2] onward, never the node executable or script path themselves", async () => {
    // Deliberately shapes argv[0]/argv[1] (normally the node binary path and the script path, never flag-shaped) as a decoy --transport flag: with process.argv.slice(2) applied correctly, only the REAL flags starting at index 2 are ever scanned, so main() reaches http with "http". Without the slice, readFlag would find the decoy at index 0 first and treat "carrier-pigeon" as the transport instead, throwing.
    process.argv = [
      "--transport",
      "carrier-pigeon",
      "--transport",
      "http",
      "--port",
      "0",
    ];
    server = await main();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("document-mcp listening on http://127.0.0.1:"),
    );
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

    // No Accept header / body is a deliberately malformed MCP request — this only confirms something is actually listening and routes /mcp through the MCP SDK's own handler (a non-2xx JSON-RPC-shaped response), not a full protocol round trip, which src/tools/*.test.ts and test/smoke.test.mjs already cover via a real client.
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

describe("readFlag", () => {
  it("returns undefined when the flag is absent entirely", () => {
    expect(readFlag(["--other", "x"], "port")).toBeUndefined();
  });

  it("reads a --name value pair", () => {
    expect(readFlag(["--port", "3000"], "port")).toBe("3000");
  });

  it("reads a --name=value form", () => {
    expect(readFlag(["--port=3000"], "port")).toBe("3000");
  });

  it("returns an empty string for a --name value pair whose value is deliberately empty, distinct from the flag being absent", () => {
    expect(readFlag(["--host", ""], "host")).toBe("");
  });

  it("throws when --name is given with nothing after it at all", () => {
    expect(() => readFlag(["--port"], "port")).toThrow(
      "--port requires a value",
    );
  });

  it("finds the flag regardless of what precedes it in argv", () => {
    expect(readFlag(["--transport", "http", "--port", "0"], "port")).toBe("0");
  });
});

describe("parsePort", () => {
  it("accepts the lower boundary", () => {
    expect(parsePort("0")).toBe(0);
  });

  it("accepts the upper boundary", () => {
    expect(parsePort("65535")).toBe(65535);
  });

  it("rejects one above the upper boundary", () => {
    expect(() => parsePort("65536")).toThrow(
      '--port must be an integer between 0 and 65535, got "65536"',
    );
  });

  it("rejects a negative port", () => {
    expect(() => parsePort("-1")).toThrow(/--port must be an integer/);
  });

  it("rejects a non-numeric string", () => {
    expect(() => parsePort("not-a-number")).toThrow(
      /--port must be an integer/,
    );
  });

  // Number.parseInt("NaN", 10) is itself NaN, and String(NaN) === "NaN" — the one input where the raw string and the stringified parsed-back number agree despite not being a valid port at all, so this pins the isInteger check rather than only the round-trip string comparison the other cases above already exercise.
  it("rejects the literal string NaN, which round-trips through String() identically to what it parsed to", () => {
    expect(() => parsePort("NaN")).toThrow(/--port must be an integer/);
  });

  it("rejects a decimal port", () => {
    expect(() => parsePort("3.5")).toThrow(/--port must be an integer/);
  });

  it("rejects a port with a leading zero, since it round-trips to a different string", () => {
    expect(() => parsePort("007")).toThrow(/--port must be an integer/);
  });

  it("rejects trailing garbage after a valid number", () => {
    expect(() => parsePort("3000abc")).toThrow(/--port must be an integer/);
  });

  it("accepts a port padded with whitespace, trimmed before the round-trip comparison", () => {
    expect(parsePort(" 80")).toBe(80);
  });
});
