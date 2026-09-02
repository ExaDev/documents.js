import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  type Box,
  bytesToBase64,
  createDocx,
  createOdg,
  createOdp,
  createOds,
  createOdt,
  createPptx,
  DOCUMENT_FORMATS,
  type DocumentFormat,
  encodeMarkdownText,
  odgToSvg,
  odsToXlsx,
  writeEpubContent,
} from "documents.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../server";
import { odfFormulaBytes } from "../test-support/odf-formula-fixture";
import { buildMultiPagePdf } from "../test-support/pdf-fixture";

// Drives the real, fully-assembled MCP server (createServer(), the same entry point src/bin.ts uses) through a genuine in-memory client/server JSON-RPC round trip -- proving `outline_document` is registered under that name, reads a real source document through the converter port, and answers with document-outline.js's buildOutline TOC projection as structured JSON an MCP client can render directly.

interface ConnectedPair {
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function connect(): Promise<ConnectedPair> {
  const server = createServer();
  const client = new Client({ name: "outline-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return { client, close: async () => client.close() };
}

describe("outline_document", () => {
  let pair: ConnectedPair;

  beforeEach(async () => {
    pair = await connect();
  });

  afterEach(async () => {
    await pair.close();
  });

  it("outlines a markdown document heading, list, and leaf structure exactly", async () => {
    // encodeMarkdownText is the same encoder document-cli's stdin path uses; the fixture exercises every wordprocessing grouping signal -- two heading levels, a list nested inside the deeper heading, plain paragraphs as leaves -- so the assertion pins the whole projected shape, not a fragment of it.
    const markdown =
      "# Chapter One\n\nIntro.\n\n## Section A\n\n- item one\n  - nested item\n\n# Chapter Two\n\nClosing.\n";
    const result = await pair.client.callTool({
      name: "outline_document",
      arguments: {
        source: {
          bytesBase64: bytesToBase64(encodeMarkdownText(markdown)),
          format: "markdown",
        },
      },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      sourceFormat: "markdown",
      kind: "wordprocessing",
      outline: [
        {
          text: "Chapter One",
          level: 1,
          children: [
            { kind: "paragraph", text: "Intro." },
            {
              text: "Section A",
              level: 2,
              children: [
                {
                  text: "item one",
                  level: 0,
                  children: [{ text: "nested item", level: 1, children: [] }],
                },
              ],
            },
          ],
        },
        {
          text: "Chapter Two",
          level: 1,
          children: [{ kind: "paragraph", text: "Closing." }],
        },
      ],
    });
  });

  it("outlines a spreadsheet as one group per sheet, labelled with the sheet name", async () => {
    const editor = createOds();
    const sheet = editor.sheets()[0];
    if (sheet === undefined) {
      throw new Error("createOds() did not produce a default sheet");
    }
    sheet.cell(0, 0).value = {
      kind: "string",
      value: "Cells are addressable data, not outline content",
    };

    const result = await pair.client.callTool({
      name: "outline_document",
      arguments: {
        source: { bytesBase64: bytesToBase64(editor.toBytes()), format: "ods" },
      },
    });

    expect(result.isError).toBeFalsy();
    // A sheet's cells ride the sheet node and never appear in the outline -- only the sheet group itself, empty here because the sheet carries no images or embedded objects.
    expect(result.structuredContent).toEqual({
      sourceFormat: "ods",
      kind: "spreadsheet",
      outline: [{ text: "Sheet1", level: 1, children: [] }],
    });
  });

  it("outlines a multi-page drawing, one group per page -- the odg regression: buildSvgText refuses more than one page, so the internal probe target routes odg through pdf, not svg", async () => {
    const editor = createOdg();
    editor.addPage();
    editor.addPage();
    editor.addPage();

    const result = await pair.client.callTool({
      name: "outline_document",
      arguments: {
        source: { bytesBase64: bytesToBase64(editor.toBytes()), format: "odg" },
      },
    });

    expect(result.isError).toBeFalsy();
    // Every page reports empty children, since none carries a shape -- the same "empty because there is nothing on it yet" convention the spreadsheet test above uses.
    expect(result.structuredContent).toEqual({
      sourceFormat: "odg",
      kind: "drawing",
      outline: [
        { text: "Page 1", level: 1, children: [] },
        { text: "Page 2", level: 1, children: [] },
        { text: "Page 3", level: 1, children: [] },
      ],
    });
  });

  it("answers an isError result for source bytes no conversion can read", async () => {
    const result = await pair.client.callTool({
      name: "outline_document",
      arguments: {
        source: {
          bytesBase64: bytesToBase64(
            new TextEncoder().encode("this is not a docx"),
          ),
          format: "docx",
        },
      },
    });

    expect(result.isError).toBe(true);
    // The docx reader's own failure text surfaces verbatim -- 'invalid zip data', what fflate says for bytes that are not a zip at all -- so the caller learns what actually failed to read rather than a generic wrapper message.
    const [block] = result.content;
    expect(block?.type === "text" ? block.text : undefined).toContain(
      "invalid zip data",
    );
  });

  it("is advertised by the server alongside the other tools", async () => {
    const listed = await pair.client.listTools();
    const tool = listed.tools.find(
      (candidate) => candidate.name === "outline_document",
    );
    expect(tool?.description).toContain("table of contents");
  });
});

const SHAPE_FRAME: Box = { xPt: 0, yPt: 0, widthPt: 100, heightPt: 20 };

// One real, minimal source document per DocumentFormat not already pinned exactly by a test above (markdown and ods carry their own deep structural assertion; odg carries its own regression pin) -- every OUTLINE_PROBE_TARGETS entry the tool actually dispatches through gets driven at least once, which is exactly the coverage gap that let the odg target ship broken: the two pre-existing deep tests only ever touched 2 of the then-12 entries.
function buildFormatFixtures(): Record<
  Exclude<DocumentFormat, "markdown" | "ods" | "odg">,
  { readonly bytes: Uint8Array<ArrayBuffer>; readonly kind: string }
> {
  const docxBytes = (() => {
    const editor = createDocx();
    editor.body
      .appendParagraph()
      .appendRun({ text: "A paragraph of ordinary body text." });
    return editor.toBytes();
  })();

  const odtBytes = (() => {
    const editor = createOdt();
    editor.body
      .appendParagraph()
      .appendRun({ text: "A paragraph of ordinary body text." });
    return editor.toBytes();
  })();

  const pptxBytes = (() => {
    const editor = createPptx();
    editor.addSlide().addTextBox({ frame: SHAPE_FRAME, text: "Slide text." });
    return editor.toBytes();
  })();

  const odpBytes = (() => {
    const editor = createOdp();
    editor.addSlide().addTextBox({ frame: SHAPE_FRAME, text: "Slide text." });
    return editor.toBytes();
  })();

  const singlePageOdgBytes = (() => {
    const editor = createOdg();
    editor.addPage().addTextBox({ frame: SHAPE_FRAME, text: "Drawing text." });
    return editor.toBytes();
  })();

  const xlsxBytes = (() => {
    const editor = createOds();
    const sheet = editor.sheets()[0];
    if (sheet === undefined) {
      throw new Error("createOds() did not produce a default sheet");
    }
    sheet.cell(0, 0).value = { kind: "string", value: "A cell." };
    return odsToXlsx(editor.toBytes());
  })();

  const epubBytes = writeEpubContent({
    kind: "wordprocessing",
    metadata: {},
    sections: [
      {
        pageSize: { widthPt: 595, heightPt: 842 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        blocks: [
          {
            kind: "paragraph",
            runs: [{ text: "A paragraph of ordinary body text." }],
          },
        ],
      },
    ],
  });

  return {
    csv: {
      bytes: new TextEncoder().encode("Name,Age\nAlice,30\n"),
      kind: "spreadsheet",
    },
    docx: { bytes: docxBytes, kind: "wordprocessing" },
    epub: { bytes: epubBytes, kind: "wordprocessing" },
    odf: { bytes: odfFormulaBytes(), kind: "formula" },
    odp: { bytes: odpBytes, kind: "presentation" },
    odt: { bytes: odtBytes, kind: "wordprocessing" },
    pdf: { bytes: buildMultiPagePdf(), kind: "wordprocessing" },
    pptx: { bytes: pptxBytes, kind: "presentation" },
    svg: { bytes: odgToSvg(singlePageOdgBytes), kind: "drawing" },
    xlsx: { bytes: xlsxBytes, kind: "spreadsheet" },
  };
}

describe("outline_document across every source format", () => {
  let pair: ConnectedPair;

  beforeEach(async () => {
    pair = await connect();
  });

  afterEach(async () => {
    await pair.close();
  });

  const fixtures = buildFormatFixtures();

  it("the fixture table plus the deep-asserted markdown/ods/odg cases above cover every DocumentFormat this port exposes", () => {
    expect(
      new Set([...Object.keys(fixtures), "markdown", "ods", "odg"]),
    ).toEqual(new Set(DOCUMENT_FORMATS));
  });

  it.each(Object.entries(fixtures))(
    "outlines a %s source without error, reporting the source's own content kind",
    async (format, fixture) => {
      const result = await pair.client.callTool({
        name: "outline_document",
        arguments: {
          source: { bytesBase64: bytesToBase64(fixture.bytes), format },
        },
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        sourceFormat: format,
        kind: fixture.kind,
      });
    },
  );
});
