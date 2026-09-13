import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { version } from "../package.json";
import { createServer } from "./server";

// createServer()'s own advertised identity (name/version) is otherwise never asserted -- every src/tools/*.test.ts file connects through it but only ever inspects tool results, never the server's own self-reported Implementation from the initialize handshake.
describe("createServer", () => {
  it("advertises itself as document-mcp at this package's own version", async () => {
    const server = createServer();
    const client = new Client({ name: "server-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    expect(client.getServerVersion()).toEqual({
      name: "document-mcp",
      version,
    });

    await client.close();
  });
});
