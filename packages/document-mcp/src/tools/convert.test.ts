import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  base64ToBytes,
  bytesToBase64,
  createDocx,
  decodeDocumentPackage,
  readDocxContent,
} from "documents.js";
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
import {
  ConvertDocumentOutputSchema,
  ListDocumentConversionsOutputSchema,
} from "./convert";

// Drives the real, fully-assembled MCP server (createServer(), the same entry point src/bin.ts uses) through a genuine in-memory client/server JSON-RPC round trip -- not the tool callback in isolation -- so this proves the wiring: that convert_document and list_document_conversions are registered under those names, that convert_document dispatches to a real documents.js DocumentConverter (createLocalDocumentConverter), and that the resolved output/diagnostics/font-substitution data reaches the caller as structuredContent matching each tool's own declared outputSchema.

interface ConnectedPair {
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function connect(): Promise<ConnectedPair> {
  const server = createServer();
  const client = new Client({ name: "convert-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return { client, close: async () => client.close() };
}

function buildFixtureDocx(): Uint8Array<ArrayBuffer> {
  const editor = createDocx();
  editor.body.appendParagraph().appendRun({ text: "Hello from document-mcp." });
  return editor.toBytes();
}

describe("convert_document", () => {
  let workspace: string;
  let fixtureDocxPath: string;
  let pair: ConnectedPair;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "document-mcp-convert-"));
    fixtureDocxPath = join(workspace, "fixture.docx");
    await writeFile(fixtureDocxPath, buildFixtureDocx());
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  beforeEach(async () => {
    pair = await connect();
  });

  afterEach(async () => {
    await pair.close();
  });

  it("converts a document read from a filesystem path to inline base64 bytes", async () => {
    const result = await pair.client.callTool({
      name: "convert_document",
      arguments: { source: { path: fixtureDocxPath }, targetFormat: "pdf" },
    });

    expect(result.isError).toBeFalsy();
    const structured = ConvertDocumentOutputSchema.parse(
      result.structuredContent,
    );
    expect(structured.targetFormat).toBe("pdf");
    expect(Array.isArray(structured.diagnostics)).toBe(true);
    expect(structured.output.byteLength).toBeGreaterThan(0);
    if (!("bytesBase64" in structured.output)) {
      throw new Error(
        "expected an inline bytesBase64 output when no outputPath was given",
      );
    }
    expect(structured.output.bytesBase64.length).toBeGreaterThan(0);

    // content mirrors structuredContent as JSON text -- the same "content is JSON.stringify(structuredContent)" convention every other tool in this package follows.
    const [block] = result.content;
    expect(block?.type).toBe("text");
    expect(
      block?.type === "text" ? JSON.parse(block.text) : undefined,
    ).toStrictEqual(result.structuredContent);
  });

  it("converts inline base64 document bytes to a file written at outputPath", async () => {
    const outputPath = join(workspace, "converted.pdf");

    const result = await pair.client.callTool({
      name: "convert_document",
      arguments: {
        source: {
          bytesBase64: bytesToBase64(buildFixtureDocx()),
          format: "docx",
        },
        targetFormat: "pdf",
        output: { outputPath },
      },
    });

    expect(result.isError).toBeFalsy();
    const structured = ConvertDocumentOutputSchema.parse(
      result.structuredContent,
    );
    if (!("path" in structured.output)) {
      throw new Error(
        "expected a written path output when outputPath was given",
      );
    }
    expect(structured.output.path).toBe(outputPath);

    const written = await readFile(outputPath);
    expect(written.byteLength).toBe(structured.output.byteLength);
    expect(new TextDecoder().decode(written.subarray(0, 5))).toBe("%PDF-");
  });

  it("reports a structured font substitution when asked, for a family this package vendors a metric-compatible substitute for", async () => {
    // 'Calibri' resolves through pdf-codec's vendored substitute path (Carlito, genuinely metric-compatible) whenever the source document does not itself embed a Calibri face -- reliably reason: 'vendored-substitute', unlike an arbitrary unknown family name, which resolves through the plain standard-14 fallback and fires no substitution event at all (see pdf-codec's own font-registry.ts: onSubstitution only fires for a matched-family-wrong-style face or a vendored substitute, never for the bare standard-14 fallback).
    const editor = createDocx();
    const run = editor.body
      .appendParagraph()
      .appendRun({ text: "Styled text." });
    run.fontFamily = "Calibri";

    const result = await pair.client.callTool({
      name: "convert_document",
      arguments: {
        source: {
          bytesBase64: bytesToBase64(editor.toBytes()),
          format: "docx",
        },
        targetFormat: "pdf",
        onSubstitutionDiagnostics: true,
      },
    });

    expect(result.isError).toBeFalsy();
    const structured = ConvertDocumentOutputSchema.parse(
      result.structuredContent,
    );
    expect(structured.fontSubstitutions).toBeDefined();
    expect(
      structured.fontSubstitutions?.some(
        (substitution) =>
          substitution.requestedFamily === "Calibri" &&
          substitution.reason === "vendored-substitute",
      ),
    ).toBe(true);
    // The diagnostics channel reports the same event too, regardless of onSubstitutionDiagnostics -- both channels fire together, never one in place of the other.
    expect(
      structured.diagnostics.some(
        (diagnostic) => diagnostic.code === "font/substituted",
      ),
    ).toBe(true);
  });

  it("omits fontSubstitutions entirely when onSubstitutionDiagnostics is not set, even though the diagnostic still fires", async () => {
    const editor = createDocx();
    const run = editor.body
      .appendParagraph()
      .appendRun({ text: "Styled text." });
    run.fontFamily = "Calibri";

    const result = await pair.client.callTool({
      name: "convert_document",
      arguments: {
        source: {
          bytesBase64: bytesToBase64(editor.toBytes()),
          format: "docx",
        },
        targetFormat: "pdf",
      },
    });

    expect(result.isError).toBeFalsy();
    const structured = ConvertDocumentOutputSchema.parse(
      result.structuredContent,
    );
    expect(structured.fontSubstitutions).toBeUndefined();
    expect(
      structured.diagnostics.some(
        (diagnostic) => diagnostic.code === "font/substituted",
      ),
    ).toBe(true);
  });

  it("embeds a markdown source's own relative-path image when its bytes are supplied via the images map", async () => {
    // An MCP caller has no filesystem context, so a non-data: image must be supplied explicitly as a destination -> base64 entry in `images`. A 1x1 PNG (the same one markdown-codec's own tests resolve) keyed by the destination used in the markdown.
    const onePixelPngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const markdown = new TextEncoder().encode(
      "![a local image](./local.png)\n",
    );

    const result = await pair.client.callTool({
      name: "convert_document",
      arguments: {
        source: { bytesBase64: bytesToBase64(markdown), format: "markdown" },
        targetFormat: "docx",
        images: { "./local.png": onePixelPngBase64 },
      },
    });

    expect(result.isError).toBeFalsy();
    const structured = ConvertDocumentOutputSchema.parse(
      result.structuredContent,
    );
    if (!("bytesBase64" in structured.output)) {
      throw new Error("expected inline bytesBase64 output");
    }
    // Read the produced docx back through documents.js's own reader and confirm the image became a real ContentImageBlock rather than degrading to alt text.
    const content = readDocxContent(
      decodeDocumentPackage(
        "docx",
        base64ToBytes(structured.output.bytesBase64),
      ),
    );
    if (content.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const hasImage = content.sections.some((section) =>
      section.blocks.some((block) => block.kind === "image"),
    );
    expect(hasImage).toBe(true);
  });
});

describe("list_document_conversions", () => {
  let pair: ConnectedPair;

  beforeEach(async () => {
    pair = await connect();
  });

  afterEach(async () => {
    await pair.close();
  });

  it("lists every source/target pair the local DocumentConverter port supports", async () => {
    const result = await pair.client.callTool({
      name: "list_document_conversions",
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const structured = ListDocumentConversionsOutputSchema.parse(
      result.structuredContent,
    );
    expect(structured.conversions.length).toBeGreaterThan(0);
    expect(structured.conversions).toContainEqual({
      source: "docx",
      target: "pdf",
    });
    expect(structured.conversions).toContainEqual({
      source: "pdf",
      target: "docx",
    });
  });
});
