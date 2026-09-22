import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import type { DocumentOperation } from "document-operations";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { registerOperation } from "./register-operation";

// Exercises registerOperation directly against a real McpServer + in-memory client/server round trip, the same connection pattern every src/tools/*.test.ts file already uses — proving the wrapper's own wiring (outputSchema forwarding, the abort signal handed to run(), and the mapError/toErrorResult fallback), independent of any one real DocumentOperation's own business logic.
describe("registerOperation", () => {
  let client: Client;
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({
      name: "register-operation-test",
      version: "0.0.0",
    });
  });

  afterEach(async () => {
    await client.close();
  });

  async function connect(): Promise<void> {
    client = new Client({
      name: "register-operation-test-client",
      version: "0.0.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  }

  function operationOf(
    overrides: Partial<
      DocumentOperation<{ value: string }, { echoed: string }>
    >,
  ): DocumentOperation<{ value: string }, { echoed: string }> {
    return {
      name: "echo",
      title: "Echo",
      description: "Echoes its input back",
      inputSchema: z.object({ value: z.string() }),
      run: (input) => Promise.resolve({ echoed: input.value }),
      ...overrides,
    };
  }

  it("advertises the operation's own outputSchema when it declares one", async () => {
    registerOperation(
      server,
      operationOf({ outputSchema: z.object({ echoed: z.string() }) }),
    );
    await connect();

    const listed = await client.listTools();
    const tool = listed.tools.find((candidate) => candidate.name === "echo");
    expect(tool?.outputSchema).toBeDefined();
  });

  it("advertises no outputSchema at all for an operation that declares none", async () => {
    registerOperation(server, operationOf({}));
    await connect();

    const listed = await client.listTools();
    const tool = listed.tools.find((candidate) => candidate.name === "echo");
    expect(tool?.outputSchema).toBeUndefined();
  });

  it("wraps a successful run() result as both structuredContent and its JSON-text equivalent", async () => {
    registerOperation(
      server,
      operationOf({ outputSchema: z.object({ echoed: z.string() }) }),
    );
    await connect();

    const result = await client.callTool({
      name: "echo",
      arguments: { value: "hello" },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ echoed: "hello" });
    const [block] = result.content;
    expect(block?.type).toBe("text");
    expect(block?.type === "text" ? JSON.parse(block.text) : undefined).toEqual(
      {
        echoed: "hello",
      },
    );
  });

  it("forwards the real MCP request's own abort signal to run(), not an empty options object", async () => {
    let observedSignal: AbortSignal | undefined;
    registerOperation(
      server,
      operationOf({
        run: (input, context) => {
          observedSignal = context?.signal;
          return Promise.resolve({ echoed: input.value });
        },
      }),
    );
    await connect();

    await client.callTool({ name: "echo", arguments: { value: "hi" } });

    expect(observedSignal).toBeInstanceOf(AbortSignal);
  });

  it("defers to the caller's mapError for a thrown error it chooses to handle", async () => {
    registerOperation(
      server,
      operationOf({
        run: () => {
          throw new Error("boom");
        },
      }),
      {
        mapError: (error) => ({
          content: [{ type: "text", text: `mapped: ${String(error)}` }],
          isError: true,
        }),
      },
    );
    await connect();

    const result = await client.callTool({
      name: "echo",
      arguments: { value: "x" },
    });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    expect(block?.type === "text" ? block.text : undefined).toBe(
      "mapped: Error: boom",
    );
  });

  it("falls back to toErrorResult when mapError declines to handle the error", async () => {
    registerOperation(
      server,
      operationOf({
        run: () => {
          throw new Error("boom");
        },
      }),
      { mapError: () => undefined },
    );
    await connect();

    const result = await client.callTool({
      name: "echo",
      arguments: { value: "x" },
    });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    expect(block?.type === "text" ? block.text : undefined).toBe("boom");
  });

  it("falls back to toErrorResult when no mapError is supplied at all", async () => {
    registerOperation(
      server,
      operationOf({
        run: () => {
          throw new Error("boom");
        },
      }),
    );
    await connect();

    const result = await client.callTool({
      name: "echo",
      arguments: { value: "x" },
    });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    expect(block?.type === "text" ? block.text : undefined).toBe("boom");
  });
});
