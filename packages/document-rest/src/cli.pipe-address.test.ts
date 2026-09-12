import type * as http from "node:http";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

// Isolated from cli.test.ts because it needs to replace node:http's own createServer for the whole file: main() always calls server.listen(port, host, ...) with a numeric port, so server.address() can never genuinely return a string (a named pipe) or null once listening -- the branch handling that is otherwise permanently unreachable. Wrapping the real createServer lets this test force exactly that unreachable case without faking the rest of Node's http behaviour.
const state = vi.hoisted(() => ({
  forcePipeAddress: false,
  createdServer: undefined as Server | undefined,
}));

vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof http>();
  return {
    ...actual,
    createServer: (
      ...args: Parameters<typeof actual.createServer>
    ): ReturnType<typeof actual.createServer> => {
      const server = actual.createServer(...args);
      state.createdServer = server;
      if (state.forcePipeAddress) {
        server.address = (): string => "/tmp/document-rest-test.sock";
      }
      return server;
    },
  };
});

describe("main", () => {
  afterEach(async () => {
    state.forcePipeAddress = false;
    // The server behind the mocked address() call is a genuine, still-listening TCP server (only .address() itself was faked) -- close it so this test never leaks an open handle into the rest of the suite.
    if (state.createdServer !== undefined) {
      await new Promise<void>((resolve) => {
        state.createdServer?.close(() => {
          resolve();
        });
      });
      state.createdServer = undefined;
    }
  });

  it("throws when the underlying server binds a pipe/Unix socket address instead of a TCP one", async () => {
    state.forcePipeAddress = true;
    const { main } = await import("./cli");
    process.argv = ["node", "bin.js", "--port", "0"];
    await expect(main()).rejects.toThrow(
      "Expected the HTTP server to bind a TCP address, not a pipe or Unix socket",
    );
  });
});
