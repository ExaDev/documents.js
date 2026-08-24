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
import {
  buildDocxWithExtras,
  DOCX_EXTRAS_FIXTURE,
} from "../test-support/docx-extras-fixture";

// Drives the real, fully-assembled MCP server (createServer(), the same entry point src/bin.ts uses) through a genuine in-memory client/server JSON-RPC round trip -- not the tool callback in isolation -- so this proves the wiring: that `docx_extras` is registered under that name on the server createServer() returns, that it reads a real docx through documents.js's decodePackage/readDocxExtras, and that the real DocxExtras data reaches the caller as structuredContent.

interface ConnectedPair {
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function connect(): Promise<ConnectedPair> {
  const server = createServer();
  const client = new Client({
    name: "docx-extras-test-client",
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

describe("docx_extras", () => {
  let workspace: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "document-mcp-docx-extras-"));
    await writeFile(join(workspace, "extras.docx"), buildDocxWithExtras());
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

  it("reads the fixture's own comments, footnotes, header/footer parts, and numbering via a filesystem path", async () => {
    const result = await pair.client.callTool({
      name: "docx_extras",
      arguments: { source: { path: join(workspace, "extras.docx") } },
    });

    expect(result.isError).toBeFalsy();
    // toEqual, not toStrictEqual: the reader materialises every schema-optional paragraph/run property as an explicit undefined key, and structuredContent carries that object across the in-memory transport without a JSON boundary -- a strict comparison would demand every optional key be spelled undefined here, which the JSON mirror below (where JSON.stringify has already dropped them) could never satisfy.
    expect(result.structuredContent).toEqual({
      // Each comment and note carries its own w:id, the key a comment extent's or note reference's anchor name joins its body back through.
      comments: [
        {
          id: "0",
          author: DOCX_EXTRAS_FIXTURE.commentAuthor,
          text: DOCX_EXTRAS_FIXTURE.commentWithAuthorText,
        },
        { id: "1", text: DOCX_EXTRAS_FIXTURE.commentWithoutAuthorText },
      ],
      footnotes: [{ id: "1", text: DOCX_EXTRAS_FIXTURE.footnoteText }],
      // The fixture writes word/header1.xml/word/footer1.xml with no relationships at all, so these parts surface through the unreferenced-part walk; its scaffold styles.xml has no docDefaults, so the part runs resolve bare. sectionHeaderFooters is positional -- createDocx's single sectPr spells no references, hence [{}].
      headerFooterParts: [
        {
          path: "word/footer1.xml",
          kind: "footer",
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: DOCX_EXTRAS_FIXTURE.footerText }],
            },
          ],
        },
        {
          path: "word/header1.xml",
          kind: "header",
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: DOCX_EXTRAS_FIXTURE.headerText }],
            },
          ],
        },
      ],
      sectionHeaderFooters: [{}],
      numbering: {
        [DOCX_EXTRAS_FIXTURE.numId]: {
          levels: {
            "0": {
              format: DOCX_EXTRAS_FIXTURE.numberingLevel.format,
              text: DOCX_EXTRAS_FIXTURE.numberingLevel.text,
              startAt: 1,
            },
          },
        },
      },
    });

    // content mirrors structuredContent as JSON text -- the same "content is JSON.stringify(structuredContent)" convention every other tool in this package follows. Same toEqual reasoning as above: JSON.stringify drops the undefined-valued optional keys structuredContent still carries.
    const [block] = result.content;
    expect(block?.type).toBe("text");
    expect(block?.type === "text" ? JSON.parse(block.text) : undefined).toEqual(
      result.structuredContent,
    );
  });

  it("reads a plain docx with none of the five kinds of extra data, via inline base64 bytes", async () => {
    const plain = createDocx();
    plain.body.appendParagraph().appendRun({ text: "Nothing extra here." });

    const result = await pair.client.callTool({
      name: "docx_extras",
      arguments: {
        source: { bytesBase64: bytesToBase64(plain.toBytes()), format: "docx" },
      },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toStrictEqual({
      comments: [],
      footnotes: [],
      headerFooterParts: [],
      sectionHeaderFooters: [{}],
      numbering: {},
    });
  });
});
