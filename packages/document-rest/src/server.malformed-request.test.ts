import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createRestServer } from "./server";

// createHttpServer(callback) attaches `callback` as a listener for the server's own "request" event (see Node's node:http docs), so emitting that event directly drives the real request handler with a request object we control -- the only way to reach the "no url or method" guard, since neither a real client nor Node's own http module can ever produce a genuine IncomingMessage missing either field.
function emitFakeRequest(
  server: ReturnType<typeof createRestServer>,
  overrides: Partial<Pick<IncomingMessage, "url" | "method">>,
): { status: () => number | undefined; body: () => string | undefined } {
  let status: number | undefined;
  let body: string | undefined;
  const req = {
    url: "/",
    method: "GET",
    ...overrides,
  } as IncomingMessage;
  const res = {
    writeHead: (code: number) => {
      status = code;
    },
    end: (text: string) => {
      body = text;
    },
  } as unknown as ServerResponse;
  server.emit("request", req, res);
  return { status: () => status, body: () => body };
}

describe("createRestServer malformed request handling", () => {
  it("returns 400 for a request with no url", async () => {
    const server = createRestServer();
    const result = emitFakeRequest(server, { url: undefined });
    await vi.waitFor(() => {
      expect(result.status()).toBe(400);
    });
    expect(JSON.parse(result.body() ?? "")).toEqual({
      error: "Malformed request: no url or method.",
    });
  });

  it("returns 400 for a request with no method", async () => {
    const server = createRestServer();
    const result = emitFakeRequest(server, { method: undefined });
    await vi.waitFor(() => {
      expect(result.status()).toBe(400);
    });
    expect(JSON.parse(result.body() ?? "")).toEqual({
      error: "Malformed request: no url or method.",
    });
  });
});
