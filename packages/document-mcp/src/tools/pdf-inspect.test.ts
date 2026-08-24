import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { bytesToBase64 } from "documents.js";
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
import { buildMultiPagePdf } from "../test-support/pdf-fixture";

// Drives the real, fully-assembled MCP server (createServer(), the same entry point src/bin.ts uses) through a genuine in-memory client/server JSON-RPC round trip -- not the tool callback in isolation -- so this proves the wiring: that `pdf_inspect` is registered under that name on the server createServer() returns, that it reads a real PDF through documents.js's own readPdf, and that both the summary and the full parsed LayoutDocument reach the caller as structuredContent.

interface ConnectedPair {
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function connect(): Promise<ConnectedPair> {
  const server = createServer();
  const client = new Client({
    name: "pdf-inspect-test-client",
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

// result.structuredContent is typed unknown by the client SDK (SEP-2106) -- narrowed here rather than cast, per this repo's own "no type assertions" convention.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Array.isArray itself narrows `unknown` to `any[]`, not `readonly unknown[]` -- destructuring straight out of that trips @typescript-eslint/no-unsafe-assignment. This local guard keeps the element type honestly `unknown` instead.
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

describe("pdf_inspect", () => {
  let workspace: string;
  let pdfPath: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "document-mcp-pdf-inspect-"));
    pdfPath = join(workspace, "sample.pdf");
    await writeFile(pdfPath, buildMultiPagePdf());
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

  it("summarises page count, per-page item-kind histogram, metadata, and image formats -- via a filesystem path", async () => {
    const result = await pair.client.callTool({
      name: "pdf_inspect",
      arguments: { source: { path: pdfPath } },
    });

    expect(result.isError).toBeFalsy();
    const summary = result.structuredContent;
    if (!isRecord(summary)) {
      throw new Error(
        "expected pdf_inspect to return a structured summary object",
      );
    }
    expect(summary.pageCount).toBe(2);

    const pages = summary.pages;
    if (!isUnknownArray(pages)) {
      throw new Error("expected pdf_inspect summary.pages to be an array");
    }
    expect(pages).toHaveLength(2);

    const [page1, page2] = pages;
    if (!isRecord(page1) || !isRecord(page2)) {
      throw new Error("expected each page summary to be an object");
    }
    expect(page1.widthPt).toBeGreaterThan(0);
    expect(page1.heightPt).toBeGreaterThan(0);
    expect(page2.widthPt).toBe(page1.widthPt);
    expect(page2.heightPt).toBe(page1.heightPt);

    const page1Kinds = page1.itemKinds;
    const page2Kinds = page2.itemKinds;
    if (!isRecord(page1Kinds) || !isRecord(page2Kinds)) {
      throw new Error(
        "expected each page summary to carry an itemKinds histogram",
      );
    }
    // Page 1 carries the fixture's own embedded image alongside its two text boxes; page 2 is text-only.
    expect(page1Kinds.text).toBeGreaterThan(0);
    expect(page1Kinds.image).toBe(1);
    expect(page2Kinds.text).toBeGreaterThan(0);
    expect(page2Kinds.image).toBeUndefined();

    const metadata = summary.metadata;
    if (!isRecord(metadata)) {
      throw new Error("expected pdf_inspect summary.metadata to be an object");
    }
    expect(typeof metadata.createdIso).toBe("string");

    const imagesByFormat = summary.imagesByFormat;
    if (!isRecord(imagesByFormat)) {
      throw new Error(
        "expected pdf_inspect summary.imagesByFormat to be an object",
      );
    }
    expect(imagesByFormat.png).toBe(1);

    // content mirrors structuredContent as JSON text -- the same convention every other tool in this package follows. toEqual, not toStrictEqual: a JSON round trip cannot distinguish an explicitly-undefined optional metadata field (readPdf's own in-memory LayoutMetadata carries title/author/subject/creator/keywords as explicit `undefined`) from a genuinely missing key (what JSON.stringify/JSON.parse produces for it instead) -- an inherent property of JSON, not a defect. Mirrors document-cli's own src/commands/pdf-inspect.test.ts note on the identical distinction.
    const [block] = result.content;
    expect(block?.type).toBe("text");
    expect(block?.type === "text" ? JSON.parse(block.text) : undefined).toEqual(
      result.structuredContent,
    );
  });

  it("returns the full parsed LayoutDocument via inline base64 bytes when full: true", async () => {
    const pdfBytes = buildMultiPagePdf();
    const result = await pair.client.callTool({
      name: "pdf_inspect",
      arguments: {
        source: { bytesBase64: bytesToBase64(pdfBytes), format: "pdf" },
        full: true,
      },
    });

    expect(result.isError).toBeFalsy();
    const layout = result.structuredContent;
    if (!isRecord(layout)) {
      throw new Error(
        "expected pdf_inspect --full to return a structured LayoutDocument object",
      );
    }
    // No $schema any more: the layout-document schema family moved to pdf-codec in the schema-4 major and pdf-codec publishes no .schema.json URI to stamp -- the value's own formatVersion literal (still 1) is its version marker.
    expect(layout.$schema).toBeUndefined();
    expect(layout.formatVersion).toBe(1);

    const pages = layout.pages;
    if (!isUnknownArray(pages)) {
      throw new Error("expected the LayoutDocument to carry a pages array");
    }
    expect(pages).toHaveLength(2);
  });

  it("rejects a non-PDF source", async () => {
    const result = await pair.client.callTool({
      name: "pdf_inspect",
      arguments: {
        source: {
          bytesBase64: bytesToBase64(new Uint8Array([1, 2, 3])),
          format: "docx",
        },
      },
    });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    expect(block?.type === "text" ? block.text : undefined).toContain(
      "requires a PDF document",
    );
  });
});
