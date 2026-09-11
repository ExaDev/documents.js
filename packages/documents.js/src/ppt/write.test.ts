import { describe, expect, it } from "vitest";
import type { ContentDocument, ContentShape } from "document-schema.js";
import { readPptContent } from "./read";
import { writePptContent } from "./write";

// ExaDev/documents.js#1188: this package is the one place ppt-codec's own injected OLE-embedding ports (serialiseEmbeddedObject on write, decodeEmbeddedObject on read) get wired to real codecs -- doc-codec/xls-codec directly, and this module's own writePptContent/readPptContent recursively for a nested presentation. A genuine round trip through both wrappers, not a unit test of either port in isolation, is what actually proves the wiring: ppt-codec alone has no reader/writer for the nested document's own format, so only this package's composition can recover one.

function embeddedSpreadsheet(): ContentDocument {
  return {
    kind: "spreadsheet",
    metadata: {},
    sheets: [
      {
        name: "Sheet1",
        cells: [
          {
            row: 0,
            column: 0,
            value: { kind: "string", value: "Embedded via documents.js" },
            displayText: "Embedded via documents.js",
          },
        ],
        columns: [],
        rows: [],
        images: [],
        printSettings: {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 54, rightPt: 50.4, bottomPt: 54, leftPt: 50.4 },
          gridlines: false,
          headers: false,
          pageOrder: "downThenOver",
        },
      },
    ],
  };
}

describe("ppt/write + ppt/read: OLE-embedded objects", () => {
  it("round-trips a shape's embedded spreadsheet object through the wired doc-codec/xls-codec ports", () => {
    const document = embeddedSpreadsheet();
    const shape: ContentShape = {
      frame: { xPt: 72, yPt: 72, widthPt: 200, heightPt: 150 },
      insetLeftPt: 0,
      insetTopPt: 0,
      insetRightPt: 0,
      insetBottomPt: 0,
      blocks: [
        {
          kind: "embeddedObject",
          objectKind: "spreadsheet",
          document,
          frame: { xPt: 72, yPt: 72, widthPt: 200, heightPt: 150 },
        },
      ],
    };
    const content: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [
        { size: { widthPt: 720, heightPt: 540 }, shapes: [shape], notes: "" },
      ],
    };

    const bytes = writePptContent(content);
    const read = readPptContent(bytes);
    if (read.kind !== "presentation") {
      throw new Error("expected a presentation document");
    }
    const readBack = read.slides[0]?.shapes[0]?.blocks[0];
    if (
      readBack?.kind !== "embeddedObject" ||
      readBack.document.kind !== "spreadsheet"
    ) {
      throw new Error("expected a spreadsheet embeddedObject block");
    }
    expect(readBack.objectKind).toBe("spreadsheet");
    expect(readBack.document.sheets[0]?.cells[0]?.value).toEqual({
      kind: "string",
      value: "Embedded via documents.js",
    });
  });

  it("round-trips a shape's embedded presentation object through ppt-codec's own writer recursively", () => {
    const nested: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [
        {
          size: { widthPt: 720, heightPt: 540 },
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 400, heightPt: 100 },
              insetLeftPt: 0.1 * 72,
              insetTopPt: 0.05 * 72,
              insetRightPt: 0.1 * 72,
              insetBottomPt: 0.05 * 72,
              blocks: [{ kind: "paragraph", runs: [{ text: "Nested deck" }] }],
            },
          ],
          notes: "",
        },
      ],
    };
    const content: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [
        {
          size: { widthPt: 720, heightPt: 540 },
          shapes: [
            {
              frame: { xPt: 72, yPt: 72, widthPt: 200, heightPt: 150 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [
                {
                  kind: "embeddedObject",
                  objectKind: "presentation",
                  document: nested,
                  frame: { xPt: 72, yPt: 72, widthPt: 200, heightPt: 150 },
                },
              ],
            },
          ],
          notes: "",
        },
      ],
    };

    const read = readPptContent(writePptContent(content));
    if (read.kind !== "presentation") {
      throw new Error("expected a presentation document");
    }
    const readBack = read.slides[0]?.shapes[0]?.blocks[0];
    if (
      readBack?.kind !== "embeddedObject" ||
      readBack.document.kind !== "presentation"
    ) {
      throw new Error("expected a presentation embeddedObject block");
    }
    const nestedParagraph = readBack.document.slides[0]?.shapes[0]?.blocks[0];
    expect(
      nestedParagraph?.kind === "paragraph"
        ? nestedParagraph.runs[0]?.text
        : undefined,
    ).toBe("Nested deck");
  });
});
