import { describe, expect, it, vi } from "vitest";
import { MCP_HTTP_PATH, routeHttpRequest } from "./serve-http";

// Exercises routeHttpRequest's own routing decision directly, with plain objects standing in for a real IncomingMessage/ServerResponse — see the function's own comment for why its parameter types accept these. main()'s own end-to-end HTTP tests in src/cli.test.ts already prove the real socket wiring; this covers the routing branches those tests don't reach (the malformed-no-url guard) or don't assert precisely (the exact 404 status/headers/body).
function fakeResponse() {
  const end = vi.fn();
  const writeHead = vi.fn(() => ({ end }));
  return { writeHead, end };
}

describe("routeHttpRequest", () => {
  it("throws when the request carries no url at all", () => {
    const res = fakeResponse();
    const onMcpRequest = vi.fn<() => void>();

    expect(() => {
      routeHttpRequest({ url: undefined }, res, onMcpRequest);
    }).toThrow("serveHttp: request has no url");
    expect(onMcpRequest).not.toHaveBeenCalled();
  });

  it("404s a path other than MCP_HTTP_PATH with an exact plain-text response", () => {
    const res = fakeResponse();
    const onMcpRequest = vi.fn<() => void>();

    routeHttpRequest({ url: "/other" }, res, onMcpRequest);

    expect(res.writeHead).toHaveBeenCalledWith(404, {
      "content-type": "text/plain",
    });
    expect(res.end).toHaveBeenCalledWith("Not found");
    expect(onMcpRequest).not.toHaveBeenCalled();
  });

  it("dispatches to onMcpRequest for MCP_HTTP_PATH itself, without touching the response directly", () => {
    const res = fakeResponse();
    const onMcpRequest = vi.fn<() => void>();

    routeHttpRequest({ url: MCP_HTTP_PATH }, res, onMcpRequest);

    expect(onMcpRequest).toHaveBeenCalledTimes(1);
    expect(res.writeHead).not.toHaveBeenCalled();
  });

  it("dispatches a query string on MCP_HTTP_PATH too, matching on pathname alone", () => {
    const res = fakeResponse();
    const onMcpRequest = vi.fn<() => void>();

    routeHttpRequest(
      { url: `${MCP_HTTP_PATH}?sessionId=abc` },
      res,
      onMcpRequest,
    );

    expect(onMcpRequest).toHaveBeenCalledTimes(1);
    expect(res.writeHead).not.toHaveBeenCalled();
  });
});
