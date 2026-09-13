import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PORT, main } from "./cli";

// Reads back the TCP port a listening server actually bound, failing loudly if it somehow bound a pipe/Unix socket instead -- every test below only ever binds a numeric port, so this can never legitimately see anything else.
function boundPort(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return address.port;
}

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

  it("binds the default port when --port is omitted", async () => {
    process.argv = ["node", "bin.js"];
    server = await main();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        `document-rest listening on http://127.0.0.1:${String(DEFAULT_PORT)}`,
      ),
    );
  });

  it("binds an OS-assigned port when --port 0 is given, and the server actually accepts connections", async () => {
    process.argv = ["node", "bin.js", "--port", "0"];
    server = await main();
    const [message] = vi.mocked(console.error).mock.calls[0] as [string];
    const port = Number(/:(\d+)$/.exec(message)?.[1]);
    expect(port).toBeGreaterThan(0);

    const response = await fetch(`http://127.0.0.1:${String(port)}/`);
    expect(response.status).toBe(200);
  });

  it("accepts --port=<value> form", async () => {
    process.argv = ["node", "bin.js", "--port=0"];
    server = await main();
    // An OS-assigned ephemeral port is never the fixed default -- this fails if the "--port=" flag form is silently ignored and the server falls back to DEFAULT_PORT instead of actually parsing "0".
    expect(boundPort(server)).not.toBe(DEFAULT_PORT);
  });

  it("rejects a non-canonical --port string, such as a leading zero", async () => {
    process.argv = ["node", "bin.js", "--port", "007"];
    await expect(main()).rejects.toThrow(/--port must be an integer/);
  });

  it("accepts a --port value with surrounding whitespace", async () => {
    process.argv = ["node", "bin.js", "--port", " 0"];
    server = await main();
    expect(boundPort(server)).toBeGreaterThanOrEqual(0);
  });

  it("rejects a negative --port", async () => {
    process.argv = ["node", "bin.js", "--port", "-1"];
    await expect(main()).rejects.toThrow(/--port must be an integer/);
  });

  it("rejects a --port value greater than 65535", async () => {
    process.argv = ["node", "bin.js", "--port", "70000"];
    await expect(main()).rejects.toThrow(/--port must be an integer/);
  });

  it("accepts the maximum valid --port value of 65535", async () => {
    process.argv = ["node", "bin.js", "--port", "65535"];
    server = await main();
    expect(boundPort(server)).toBe(65535);
  });

  it("rejects a non-integer --port", async () => {
    process.argv = ["node", "bin.js", "--port", "not-a-number"];
    await expect(main()).rejects.toThrow(/--port must be an integer/);
  });

  it("rejects --port with no value", async () => {
    process.argv = ["node", "bin.js", "--port"];
    await expect(main()).rejects.toThrow(/--port requires a value/);
  });

  it("ignores argv[0]/argv[1], the node binary and script path, rather than treating them as flags", async () => {
    // Standing in for the real ["node", "/path/to/bin.js", ...userArgs] shape: exactly two elements here, so `.slice(2)` leaves no arguments at all -- if it silently stopped slicing, these two entries would be searched for flags in their own right.
    process.argv = ["--port", "9999"];
    server = await main();
    expect(boundPort(server)).toBe(DEFAULT_PORT);
  });

  it("binds the given --host instead of the loopback default", async () => {
    process.argv = ["node", "bin.js", "--host", "0.0.0.0", "--port", "0"];
    server = await main();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("document-rest listening on http://0.0.0.0:"),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a TCP address");
    }
    expect(address.address).toBe("0.0.0.0");
  });
});
