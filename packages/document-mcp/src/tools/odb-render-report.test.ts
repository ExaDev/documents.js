import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { ContentBlock, ContentDocument } from "documents.js";
import {
  bytesToBase64,
  decodeDocumentPackage,
  decodePackage,
  OdbReportNotSpecifiedError,
  readDocxContent,
  readOdtContent,
  readPdf,
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
  FORM_AND_REPORT_ODB_PATH,
  FORM_AND_REPORT_REPORT_NAME,
  loadFormAndReportOdbBytes,
} from "../test-support/odb-fixture";
import {
  odbReportNotSpecifiedResult,
  OdbRenderReportOutputSchema,
} from "./odb-render-report";

// Drives the real, fully-assembled MCP server (createServer(), the same entry point src/bin.ts uses) through a genuine in-memory client/server JSON-RPC round trip -- not the tool callback in isolation -- so this proves the wiring: that `odb_render_report` is registered under that name, that it reaches documents.js's real readOdbReportContent/odbReportToDocx/odbReportToOdt/odbReportToPdf, and that the output really decodes as the report's own data, not merely non-empty bytes. Ground truth for the fixture's own SalesByRegion report (region/quarter groups, group totals, grand total) is documents.js's own src/odb/report/content.test.ts, which renders and hand-verifies the identical report against the identical fixture. Mirrors src/tools/odm.test.ts's own connection harness.

interface ConnectedPair {
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function connect(): Promise<ConnectedPair> {
  const server = createServer();
  const client = new Client({
    name: "odb-render-report-test-client",
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

// Recursively collects every run's own text out of a ContentBlock -- a top-level paragraph, or (a report band's own shape) a single-row table whose cells each carry a paragraph.
function collectBlockText(block: ContentBlock, texts: string[]): void {
  if (block.kind === "paragraph") {
    for (const run of block.runs) {
      texts.push(run.text);
    }
    return;
  }
  if (block.kind === "table") {
    for (const row of block.rows) {
      for (const cell of row.cells) {
        for (const cellBlock of cell.blocks) {
          collectBlockText(cellBlock, texts);
        }
      }
    }
  }
}

// Every run of text across a wordprocessing ContentDocument's sections, space-joined -- used to assert the rendered report's real band content (region names, quarter/region/grand totals) survived into real docx/odt bytes, not just that the file is non-empty.
function wordprocessingText(document: ContentDocument): string {
  if (document.kind !== "wordprocessing") {
    throw new Error(
      `expected a wordprocessing ContentDocument, got "${document.kind}"`,
    );
  }
  const texts: string[] = [];
  for (const section of document.sections) {
    for (const block of section.blocks) {
      collectBlockText(block, texts);
    }
  }
  return texts.join(" ");
}

// The same real, unfiltered-by-decimal-formatting figures documents.js's own report content test computes by hand from the fixture's SALES table, over the report's own HighValueSales-filtered, REGION/QUARTER/AMOUNT-DESC-ordered rows.
const EXPECTED_REPORT_STRINGS = [
  "Sales by region",
  "North",
  "South",
  "Region total:",
  "4290.75",
  "1810",
  "Grand total:",
  "6100.75",
];

function expectReportText(text: string): void {
  for (const expected of EXPECTED_REPORT_STRINGS) {
    expect(text).toContain(expected);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("odb_render_report", () => {
  let workspace: string;

  let pair: ConnectedPair;

  beforeAll(async () => {
    workspace = await mkdtemp(
      join(tmpdir(), "document-mcp-odb-render-report-"),
    );
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

  it("renders the fixture's single report to docx via a filesystem path source, with no report name given (auto-selected)", async () => {
    const result = await pair.client.callTool({
      name: "odb_render_report",
      arguments: {
        source: { path: FORM_AND_REPORT_ODB_PATH },
        targetFormat: "docx",
      },
    });

    expect(result.isError).toBeFalsy();
    const structured = OdbRenderReportOutputSchema.parse(
      result.structuredContent,
    );
    if (!("bytesBase64" in structured)) {
      throw new Error("expected an inline bytesBase64 result");
    }
    expect(structured.mathDiagnostics).toStrictEqual([]);
    expect(structured.fontSubstitutions).toStrictEqual([]);
    expect(structured.charSubstitutions).toStrictEqual([]);

    const docxBytes = Buffer.from(structured.bytesBase64, "base64");
    const document = readDocxContent(decodePackage(new Uint8Array(docxBytes)));
    expectReportText(wordprocessingText(document));

    // content mirrors structuredContent as JSON text -- the same "content is JSON.stringify(structuredContent)" convention every other tool in this repo follows.
    const [block] = result.content;
    expect(block?.type).toBe("text");
    expect(
      block?.type === "text" ? JSON.parse(block.text) : undefined,
    ).toStrictEqual(result.structuredContent);
  });

  it("renders the fixture's single report to pdf via inline base64 bytes, with the report named explicitly, writing to outputPath", async () => {
    const outputPath = join(workspace, "sales-by-region.pdf");

    const result = await pair.client.callTool({
      name: "odb_render_report",
      arguments: {
        source: {
          bytesBase64: bytesToBase64(loadFormAndReportOdbBytes()),
          format: "pdf",
        },
        report: FORM_AND_REPORT_REPORT_NAME,
        targetFormat: "pdf",
        output: { outputPath },
      },
    });

    expect(result.isError).toBeFalsy();
    const structured = OdbRenderReportOutputSchema.parse(
      result.structuredContent,
    );
    if (!("path" in structured)) {
      throw new Error("expected a written-path result");
    }
    expect(structured.path).toBe(outputPath);
    expect(structured.byteLength).toBeGreaterThan(0);
    expect(structured.mathDiagnostics).toStrictEqual([]);
    expect(structured.fontSubstitutions).toStrictEqual([]);
    expect(structured.charSubstitutions).toStrictEqual([]);

    const layout = readPdf(new Uint8Array(await readFile(outputPath)));
    expect(layout.pages.length).toBeGreaterThan(0);
    const text = layout.pages
      .flatMap((page) => page.items)
      .filter((item) => item.kind === "text")
      .map((item) => item.text)
      .join(" ");
    expectReportText(text);
  });

  it("renders the fixture's single report to odt", async () => {
    const result = await pair.client.callTool({
      name: "odb_render_report",
      arguments: {
        source: { path: FORM_AND_REPORT_ODB_PATH },
        targetFormat: "odt",
      },
    });

    expect(result.isError).toBeFalsy();
    const structured = OdbRenderReportOutputSchema.parse(
      result.structuredContent,
    );
    if (!("bytesBase64" in structured)) {
      throw new Error("expected an inline bytesBase64 result");
    }
    const odtBytes = Buffer.from(structured.bytesBase64, "base64");
    const document = readOdtContent(
      decodeDocumentPackage("odt", new Uint8Array(odtBytes)),
    );
    expectReportText(wordprocessingText(document));
  });

  it("returns an isError result naming the offending name when an unrecognised report is requested", async () => {
    const result = await pair.client.callTool({
      name: "odb_render_report",
      arguments: {
        source: { path: FORM_AND_REPORT_ODB_PATH },
        report: "NoSuchReport",
        targetFormat: "docx",
      },
    });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    expect(block?.type).toBe("text");
    expect(block?.type === "text" ? block.text : undefined).toContain(
      "NoSuchReport",
    );
    expect(block?.type === "text" ? block.text : undefined).toContain(
      FORM_AND_REPORT_REPORT_NAME,
    );
  });
});

// The fixture this repo checks in declares exactly one report, so selectReport's own "declares no report at all, or more than one with none named" OdbReportNotSpecifiedError branch is unreachable through a real client/server round trip against it. Tested directly here instead, against a real OdbReportNotSpecifiedError instance -- no I/O, no fixture, just the exported helper this tool's own callback delegates to.
describe("odbReportNotSpecifiedResult", () => {
  it("reports isError: true, the error message verbatim, and availableReports in structuredContent", () => {
    const error = new OdbReportNotSpecifiedError([
      "SalesByRegion",
      "SalesByCustomer",
    ]);

    const result = odbReportNotSpecifiedResult(error);

    expect(result.isError).toBe(true);
    expect(result.content).toStrictEqual([
      { type: "text", text: error.message },
    ]);
    expect(
      result.content[0]?.type === "text" ? result.content[0].text : undefined,
    ).toContain("SalesByRegion");
    expect(
      result.content[0]?.type === "text" ? result.content[0].text : undefined,
    ).toContain("SalesByCustomer");
    if (!isRecord(result.structuredContent)) {
      throw new Error("expected structuredContent to be a record");
    }
    expect(result.structuredContent.availableReports).toStrictEqual([
      "SalesByRegion",
      "SalesByCustomer",
    ]);
  });

  it("names no available reports when the .odb declares none at all", () => {
    const error = new OdbReportNotSpecifiedError([]);

    const result = odbReportNotSpecifiedResult(error);

    expect(result.isError).toBe(true);
    expect(
      result.content[0]?.type === "text" ? result.content[0].text : undefined,
    ).toBe("readOdbReportContent: this .odb declares no reports at all");
    if (!isRecord(result.structuredContent)) {
      throw new Error("expected structuredContent to be a record");
    }
    expect(result.structuredContent.availableReports).toStrictEqual([]);
  });
});
