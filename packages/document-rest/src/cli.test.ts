import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli";

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
        "document-rest listening on http://127.0.0.1:3100",
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
    expect(console.error).toHaveBeenCalled();
  });

  it("rejects a non-integer --port", async () => {
    process.argv = ["node", "bin.js", "--port", "not-a-number"];
    await expect(main()).rejects.toThrow(/--port must be an integer/);
  });

  it("rejects --port with no value", async () => {
    process.argv = ["node", "bin.js", "--port"];
    await expect(main()).rejects.toThrow(/--port requires a value/);
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
