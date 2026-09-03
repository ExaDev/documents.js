import type { ContentSheet } from "document-schema.js";
import { describe, expect, it } from "vitest";

import {
  type XlsContentDocument,
  isXlsFile,
  readXlsContent,
  writeXlsContent,
} from "../../src/index";

// The write path run inside workerd -- the real Cloudflare Workers runtime -- mirroring test/workers/read.test.ts's own rationale for the read path: if writeXlsContent, buildWorkbookGlobals, buildWorksheetSubstream, or archive-codec's writeCompoundFile beneath them reached for a Node-only API, this isolate would throw rather than the test passing. This is a genuine round trip (write, then read back through this package's own reader), not a byte-shape assertion, so it also proves the writer and reader agree with each other inside the real target runtime, not only under Node.

const PRINT_SETTINGS: ContentSheet["printSettings"] = {
  pageSize: { widthPt: 612, heightPt: 792 },
  margins: { topPt: 54, rightPt: 50.4, bottomPt: 54, leftPt: 50.4 },
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver",
};

function document(): XlsContentDocument {
  return {
    kind: "spreadsheet",
    metadata: {},
    sheets: [
      {
        name: "Sheet1",
        cells: [
          { row: 0, column: 0, value: { kind: "number", value: 42 }, displayText: "42" },
          {
            row: 0,
            column: 1,
            value: { kind: "string", value: "Hi from workerd" },
            displayText: "Hi from workerd",
          },
          {
            row: 1,
            column: 0,
            value: { kind: "date", value: "2026-09-03" },
            displayText: "2026-09-03",
          },
        ],
        columns: [],
        rows: [],
        images: [],
        printSettings: PRINT_SETTINGS,
      },
    ],
  };
}

describe("xls-codec write path inside workerd", () => {
  const bytes = writeXlsContent(document());

  it("produces bytes this package's own reader recognises as a workbook", () => {
    expect(isXlsFile(bytes)).toBe(true);
  });

  it("round-trips a number cell", () => {
    const content = readXlsContent(bytes);
    expect(content.sheets[0]?.cells.find((c) => c.column === 0 && c.row === 0)?.value).toEqual({
      kind: "number",
      value: 42,
    });
  });

  it("round-trips a string cell through the shared string table", () => {
    const content = readXlsContent(bytes);
    expect(
      content.sheets[0]?.cells.find((c) => c.column === 1 && c.row === 0)?.value,
    ).toEqual({ kind: "string", value: "Hi from workerd" });
  });

  it("round-trips a date cell through its own number format", () => {
    const content = readXlsContent(bytes);
    expect(content.sheets[0]?.cells.find((c) => c.column === 0 && c.row === 1)?.value).toEqual({
      kind: "date",
      value: "2026-09-03",
    });
  });

  it('round-trips document metadata through a real "\\x05SummaryInformation" stream, with no Node-only API', () => {
    const input: XlsContentDocument = {
      ...document(),
      metadata: { title: "Workers isolate title", author: "xls-codec" },
    };
    const metadataBytes = writeXlsContent(input);
    const content = readXlsContent(metadataBytes);
    expect(content.metadata).toEqual(input.metadata);
  });

  it("round-trips a cell's background and borders, with no Node-only API", () => {
    const decorated: XlsContentDocument = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [
            {
              row: 0,
              column: 0,
              value: { kind: "string", value: "Decorated" },
              displayText: "Decorated",
              background: { r: 1, g: 0, b: 0 },
              borders: {
                left: { color: { r: 0, g: 0, b: 1 }, widthPt: 0.75 },
              },
            },
          ],
          columns: [],
          rows: [],
          images: [],
          printSettings: PRINT_SETTINGS,
        },
      ],
    };
    const decoratedBytes = writeXlsContent(decorated);
    const content = readXlsContent(decoratedBytes);
    const cell = content.sheets[0]?.cells.find(
      (c) => c.column === 0 && c.row === 0,
    );
    expect(cell?.background).toEqual({ r: 1, g: 0, b: 0 });
    expect(cell?.borders).toEqual({
      left: { color: { r: 0, g: 0, b: 1 }, widthPt: 0.75 },
    });
  });
});
