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
import { buildOdtWithEmbeddedFont } from "../test-support/embedded-font-fixture";
import { vendoredFontBytes } from "../test-support/font-fixture";

// Drives the real, fully-assembled MCP server (createServer(), the same entry point src/bin.ts uses) through a genuine in-memory client/server JSON-RPC round trip -- not the tool callbacks in isolation -- so this proves the wiring: that `fonts` and `describe_font_file` are registered under those names on the server createServer() returns, that `fonts` reads a real odt through documents.js's own extractSourceFontsForFormat, and that `describe_font_file` reads a real font file through documents.js's own describeFontFace.

interface ConnectedPair {
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function connect(): Promise<ConnectedPair> {
  const server = createServer();
  const client = new Client({ name: "fonts-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return { client, close: async () => client.close() };
}

const FIXTURE_FONT_FAMILY = "DocumentMcpTestFace";

describe("fonts", () => {
  let workspace: string;
  let odtPath: string;
  let fontBytes: Uint8Array<ArrayBuffer>;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "document-mcp-fonts-"));
    fontBytes = vendoredFontBytes();
    odtPath = join(workspace, "embedded.odt");
    await writeFile(
      odtPath,
      buildOdtWithEmbeddedFont({ family: FIXTURE_FONT_FAMILY, fontBytes }),
    );
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

  it("lists the one embedded face the odt fixture declares, via a filesystem path", async () => {
    const result = await pair.client.callTool({
      name: "fonts",
      arguments: { source: { path: odtPath } },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toStrictEqual({
      faces: [
        {
          family: FIXTURE_FONT_FAMILY,
          bold: false,
          italic: false,
          byteLength: fontBytes.length,
        },
      ],
    });

    // content mirrors structuredContent as JSON text -- the same "content is JSON.stringify(structuredContent)" convention every other tool in this package follows.
    const [block] = result.content;
    if (block?.type !== "text") {
      throw new Error("expected a text content block");
    }
    expect(JSON.parse(block.text)).toStrictEqual(result.structuredContent);
  });

  it("lists the one embedded face the odt fixture declares, via inline base64 bytes", async () => {
    const odtBytes = buildOdtWithEmbeddedFont({
      family: FIXTURE_FONT_FAMILY,
      fontBytes,
    });

    const result = await pair.client.callTool({
      name: "fonts",
      arguments: {
        source: { bytesBase64: bytesToBase64(odtBytes), format: "odt" },
      },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toStrictEqual({
      faces: [
        {
          family: FIXTURE_FONT_FAMILY,
          bold: false,
          italic: false,
          byteLength: fontBytes.length,
        },
      ],
    });
  });

  it("returns an isError result naming the rejected format for a format with no source-embedded-font concept", async () => {
    const result = await pair.client.callTool({
      name: "fonts",
      arguments: {
        source: {
          bytesBase64: bytesToBase64(new Uint8Array([0])),
          format: "xlsx",
        },
      },
    });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    if (block?.type !== "text") {
      throw new Error("expected a text content block");
    }
    expect(block.text).toContain("xlsx");
    expect(block.text).toContain("docx, pptx, odt, odp, ods, odg");
  });
});

describe("describe_font_file", () => {
  let workspace: string;
  let fontPath: string;
  let fontBytes: Uint8Array<ArrayBuffer>;

  beforeAll(async () => {
    workspace = await mkdtemp(
      join(tmpdir(), "document-mcp-describe-font-file-"),
    );
    fontBytes = vendoredFontBytes();
    fontPath = join(workspace, "Caladea-Regular.ttf");
    await writeFile(fontPath, fontBytes);
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

  it("reads a real vendored font file via a filesystem path", async () => {
    const result = await pair.client.callTool({
      name: "describe_font_file",
      arguments: { source: { path: fontPath } },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toStrictEqual({
      family: "Caladea",
      bold: false,
      italic: false,
    });
  });

  it("reads a real vendored font file via inline base64 bytes", async () => {
    const result = await pair.client.callTool({
      name: "describe_font_file",
      arguments: { source: { bytesBase64: bytesToBase64(fontBytes) } },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toStrictEqual({
      family: "Caladea",
      bold: false,
      italic: false,
    });
  });

  it("returns an isError result for bytes that are not a recognised sfnt font at all", async () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

    const result = await pair.client.callTool({
      name: "describe_font_file",
      arguments: { source: { bytesBase64: bytesToBase64(garbage) } },
    });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    if (block?.type !== "text") {
      throw new Error("expected a text content block");
    }
    expect(block.text).toContain("not a TrueType/OpenType font file");
  });

  it("returns an isError result naming a TrueType Collection as its own actionable case, not a bare parse failure", async () => {
    const ttc = new Uint8Array(12);
    new DataView(ttc.buffer).setUint32(0, 0x74746366); // 'ttcf'

    const result = await pair.client.callTool({
      name: "describe_font_file",
      arguments: { source: { bytesBase64: bytesToBase64(ttc) } },
    });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    if (block?.type !== "text") {
      throw new Error("expected a text content block");
    }
    expect(block.text).toContain("TrueType Collection");
  });
});
