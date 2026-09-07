import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  base64ToBytes,
  bytesToBase64,
  createDocx,
  createOdt,
  openDocx,
  openMarkdown,
  openOdt,
  readMarkdownContent,
} from "documents.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../server";

// Drives the real, fully-assembled MCP server through a genuine in-memory client/server JSON-RPC round trip, matching metadata.test.ts's own connection harness.

interface ConnectedPair {
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function connect(): Promise<ConnectedPair> {
  const server = createServer();
  const client = new Client({ name: "editor-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return { client, close: async () => client.close() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inlineBytes(structuredContent: unknown): Uint8Array<ArrayBuffer> {
  if (
    !isRecord(structuredContent) ||
    typeof structuredContent.bytesBase64 !== "string"
  ) {
    throw new Error("expected an inline bytesBase64 result");
  }
  return base64ToBytes(structuredContent.bytesBase64);
}

describe("document_create / document_append_paragraphs", () => {
  let pair: ConnectedPair;

  beforeEach(async () => {
    pair = await connect();
  });

  afterEach(async () => {
    await pair.close();
  });

  it("creates a real, readable, empty docx via the live createDocx() editor", async () => {
    const result = await pair.client.callTool({
      name: "document_create",
      arguments: { format: "docx" },
    });

    expect(result.isError).toBeFalsy();
    const bytes = inlineBytes(result.structuredContent);
    const editor = openDocx(bytes);
    expect(editor.paragraphs()).toHaveLength(0);
  });

  it("appends a plain-text paragraph to a docx and reads it back through the real live-view editor", async () => {
    const sourceBytes = createDocx().toBytes();

    const result = await pair.client.callTool({
      name: "document_append_paragraphs",
      arguments: {
        source: { bytesBase64: bytesToBase64(sourceBytes), format: "docx" },
        targetFormat: "docx",
        paragraphs: [{ text: "Hello from MCP" }],
      },
    });

    expect(result.isError).toBeFalsy();
    const editor = openDocx(inlineBytes(result.structuredContent));
    const paragraph = editor.paragraphs()[0];
    expect(paragraph?.text).toBe("Hello from MCP");
  });

  it("appends a paragraph built from several independently-formatted runs to a docx", async () => {
    const sourceBytes = createDocx().toBytes();

    const result = await pair.client.callTool({
      name: "document_append_paragraphs",
      arguments: {
        source: { bytesBase64: bytesToBase64(sourceBytes), format: "docx" },
        targetFormat: "docx",
        paragraphs: [
          {
            headingLevel: 1,
            runs: [
              { text: "Bold red ", bold: true, colorHex: "ff0000" },
              { text: "plain" },
            ],
          },
        ],
      },
    });

    expect(result.isError).toBeFalsy();
    const editor = openDocx(inlineBytes(result.structuredContent));
    const paragraph = editor.paragraphs()[0];
    expect(paragraph?.headingLevel).toBe(1);
    const runs = paragraph?.runs() ?? [];
    expect(runs[0]?.text).toBe("Bold red ");
    expect(runs[0]?.bold).toBe(true);
    expect(runs[0]?.color).toEqual({ r: 1, g: 0, b: 0 });
    expect(runs[1]?.text).toBe("plain");
  });

  it("appends to odt through the identical field set docx uses", async () => {
    const sourceBytes = createOdt().toBytes();

    const result = await pair.client.callTool({
      name: "document_append_paragraphs",
      arguments: {
        source: { bytesBase64: bytesToBase64(sourceBytes), format: "odt" },
        targetFormat: "odt",
        paragraphs: [{ runs: [{ text: "Underlined", underline: true }] }],
      },
    });

    expect(result.isError).toBeFalsy();
    const editor = openOdt(inlineBytes(result.structuredContent));
    const runs = editor.paragraphs()[0]?.runs() ?? [];
    expect(runs[0]?.text).toBe("Underlined");
    expect(runs[0]?.underline).toBe(true);
  });

  it("appends to markdown using markdown's own field set", async () => {
    const sourceBytes = new TextEncoder().encode("Existing line\n");

    const result = await pair.client.callTool({
      name: "document_append_paragraphs",
      arguments: {
        source: {
          bytesBase64: bytesToBase64(sourceBytes),
          format: "markdown",
        },
        targetFormat: "markdown",
        paragraphs: [
          { runs: [{ text: "a link", hyperlink: "https://example.com" }] },
        ],
      },
    });

    expect(result.isError).toBeFalsy();
    const editor = openMarkdown(
      new TextDecoder().decode(inlineBytes(result.structuredContent)),
    );
    const runs = editor.paragraphs().at(-1)?.runs() ?? [];
    expect(runs[0]?.text).toBe("a link");
    expect(runs[0]?.hyperlink).toBe("https://example.com");

    // A real round trip through markdown-codec's own writer, not just the live in-memory object.
    const rendered = readMarkdownContent(editor.toMarkdownText());
    expect(rendered.kind).toBe("wordprocessing");
  });

  it("rejects a docx/odt-only field (colorHex) targeted at markdown, naming the field rather than silently dropping it", async () => {
    const sourceBytes = new TextEncoder().encode("");

    const result = await pair.client.callTool({
      name: "document_append_paragraphs",
      arguments: {
        source: {
          bytesBase64: bytesToBase64(sourceBytes),
          format: "markdown",
        },
        targetFormat: "markdown",
        paragraphs: [{ runs: [{ text: "x", colorHex: "00ff00" }] }],
      },
    });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    expect(block?.type === "text" ? block.text : undefined).toContain(
      "colorHex",
    );
  });

  it("rejects a markdown-only field (hyperlink) targeted at docx, naming the field rather than silently dropping it", async () => {
    const sourceBytes = createDocx().toBytes();

    const result = await pair.client.callTool({
      name: "document_append_paragraphs",
      arguments: {
        source: { bytesBase64: bytesToBase64(sourceBytes), format: "docx" },
        targetFormat: "docx",
        paragraphs: [
          { runs: [{ text: "x", hyperlink: "https://example.com" }] },
        ],
      },
    });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    expect(block?.type === "text" ? block.text : undefined).toContain(
      "hyperlink",
    );
  });

  it("rejects a format mismatch between the source document and targetFormat -- it never converts format", async () => {
    const sourceBytes = createDocx().toBytes();

    const result = await pair.client.callTool({
      name: "document_append_paragraphs",
      arguments: {
        source: { bytesBase64: bytesToBase64(sourceBytes), format: "docx" },
        targetFormat: "odt",
        paragraphs: [{ text: "x" }],
      },
    });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    expect(block?.type === "text" ? block.text : undefined).toContain(
      "never converts format",
    );
  });
});
