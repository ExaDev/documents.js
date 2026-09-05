import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { bytesToBase64, createDocx } from "documents.js";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createServer } from "../server";
import { odfFormulaBytes } from "../test-support/odf-formula-fixture";

// Drives the real, fully-assembled MCP server (createServer(), the same entry point src/bin.ts uses) through a genuine in-memory client/server JSON-RPC round trip -- proving compute_formula is registered under that name, reads a document's real embedded formulas via documents.js's own readNativeDocumentTree + document-schema.js's flattenTree, and evaluates each through a real document-compute.js evaluate() call. Mirrors src/tools/metadata.test.ts's own connection harness.

interface ConnectedPair {
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function connect(): Promise<ConnectedPair> {
  const server = createServer();
  const client = new Client({
    name: "compute-formula-test-client",
    version: "0.0.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return { client, close: async () => client.close() };
}

// A tool result's structuredContent is typed `unknown` on the wire, so every assertion below narrows through this guard first rather than reaching for a type assertion.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Array.isArray itself narrows `unknown` to `any[]`, not `readonly unknown[]` -- indexing straight into that trips @typescript-eslint/no-unsafe-assignment. This local guard keeps the element type honestly `unknown` instead, matching src/tools/pdf-inspect.test.ts's own precedent.
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

// One $$ ... $$ fenced display-math block, matching markdown-codec's own block grammar (the delimiter must be alone on its own line) -- the identical helper document-compute.js's own harness/corpus.test.ts uses to build its markdown fixtures.
function mathBlock(latex: string): string {
  return `$$\n${latex}\n$$`;
}

function markdownBytes(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

describe("compute_formula", () => {
  let workspace: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "document-mcp-compute-formula-"));
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  let pair: ConnectedPair;

  beforeEach(async () => {
    pair = await connect();
  });

  afterEach(async () => {
    await pair.close();
  });

  it("evaluates a fully closed formula with no bindings required", async () => {
    const result = await pair.client.callTool({
      name: "compute_formula",
      arguments: {
        source: {
          bytesBase64: markdownBytes(mathBlock("2 + 3")),
          format: "markdown",
        },
      },
    });

    expect(result.isError).toBeFalsy();
    const output = result.structuredContent;
    if (!isRecord(output)) {
      throw new Error("expected compute_formula to return structuredContent");
    }
    expect(output.sourceFormat).toBe("markdown");
    expect(output.documentKind).toBe("wordprocessing");
    expect(output.formulaCount).toBe(1);
    if (!isUnknownArray(output.formulas)) {
      throw new Error("expected formulas to be an array");
    }
    const entry = output.formulas[0];
    if (!isRecord(entry) || !isRecord(entry.outcome)) {
      throw new Error("expected one formula entry with an outcome");
    }
    expect(entry.outcome.status).toBe("evaluated");
    expect(entry.outcome.result).toEqual({
      kind: "quantity",
      magnitude: 5,
      dimension: {},
    });

    // content mirrors structuredContent as JSON text -- the same convention every other tool in this package follows.
    const [block] = result.content;
    expect(block?.type).toBe("text");
    expect(block?.type === "text" ? JSON.parse(block.text) : undefined).toEqual(
      result.structuredContent,
    );
  });

  it("evaluates a formula referencing symbols once their values are supplied via bindings", async () => {
    const result = await pair.client.callTool({
      name: "compute_formula",
      arguments: {
        source: {
          bytesBase64: markdownBytes(mathBlock("m \\times a")),
          format: "markdown",
        },
        bindings: {
          "symbols:m": {
            kind: "quantity",
            magnitude: 2,
            dimension: { mass: 1 },
          },
          "symbols:a": {
            kind: "quantity",
            magnitude: 3,
            dimension: { length: 1, time: -2 },
          },
        },
      },
    });

    expect(result.isError).toBeFalsy();
    const output = result.structuredContent;
    if (!isRecord(output) || !isUnknownArray(output.formulas)) {
      throw new Error("expected compute_formula to return a formulas array");
    }
    const entry = output.formulas[0];
    if (!isRecord(entry) || !isRecord(entry.outcome)) {
      throw new Error("expected one formula entry with an outcome");
    }
    expect(entry.outcome.status).toBe("evaluated");
    expect(entry.outcome.result).toEqual({
      kind: "quantity",
      magnitude: 6,
      dimension: { mass: 1, length: 1, time: -2 },
    });
  });

  it("reports an UnboundSymbolError outcome for a symbol-referencing formula with no bindings supplied, without failing the whole call", async () => {
    const result = await pair.client.callTool({
      name: "compute_formula",
      arguments: {
        source: {
          bytesBase64: markdownBytes(mathBlock("m \\times a")),
          format: "markdown",
        },
      },
    });

    expect(result.isError).toBeFalsy();
    const output = result.structuredContent;
    if (!isRecord(output) || !isUnknownArray(output.formulas)) {
      throw new Error("expected compute_formula to return a formulas array");
    }
    const entry = output.formulas[0];
    if (!isRecord(entry) || !isRecord(entry.outcome)) {
      throw new Error("expected one formula entry with an outcome");
    }
    expect(entry.outcome.status).toBe("error");
    expect(entry.outcome.errorType).toBe("UnboundSymbolError");
    expect(entry.outcome.message).toContain("symbols:m");
  });

  it("reports a no-content outcome for a formula whose semantic layer was never lowered, from a standalone odf formula document", async () => {
    const result = await pair.client.callTool({
      name: "compute_formula",
      arguments: {
        source: {
          bytesBase64: bytesToBase64(odfFormulaBytes()),
          format: "odf",
        },
      },
    });

    expect(result.isError).toBeFalsy();
    const output = result.structuredContent;
    if (!isRecord(output) || !isUnknownArray(output.formulas)) {
      throw new Error("expected compute_formula to return a formulas array");
    }
    expect(output.documentKind).toBe("formula");
    expect(output.formulaCount).toBe(1);
    const entry = output.formulas[0];
    if (!isRecord(entry) || !isRecord(entry.outcome)) {
      throw new Error("expected one formula entry with an outcome");
    }
    expect(entry.outcome.status).toBe("no-content");
    // A standalone formula document has no embedding block, so there is no sourcePath to report.
    expect(entry.sourcePath).toBeUndefined();
  });

  it("returns an empty formula list, not an error, for a document with no formulas at all", async () => {
    const sourcePath = join(workspace, "no-formulas.docx");
    await writeFile(sourcePath, createDocx().toBytes());

    const result = await pair.client.callTool({
      name: "compute_formula",
      arguments: { source: { path: sourcePath } },
    });

    expect(result.isError).toBeFalsy();
    const output = result.structuredContent;
    if (!isRecord(output)) {
      throw new Error("expected compute_formula to return structuredContent");
    }
    expect(output.sourceFormat).toBe("docx");
    expect(output.formulaCount).toBe(0);
    expect(output.formulas).toEqual([]);
  });

  it("surfaces a read failure as an isError result, exactly like every other document-input tool", async () => {
    const result = await pair.client.callTool({
      name: "compute_formula",
      arguments: {
        source: { path: join(workspace, "does-not-exist.docx") },
      },
    });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    expect(block?.type).toBe("text");
  });
});
