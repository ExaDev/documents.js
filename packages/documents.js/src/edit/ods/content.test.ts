import type { ContentDocument } from "document-schema.js";

import {
  attrValue,
  bytesToBase64,
  elementsWithTag,
  readOdsContent,
  rootElement,
} from "odf.js";
import { describe, expect, it } from "vitest";
import { formulaDocument } from "../../model/formula";
import { buildOdsPackage } from "./content";

type SpreadsheetDocument = Extract<ContentDocument, { kind: "spreadsheet" }>;

function spreadsheetDocument(): SpreadsheetDocument {
  return {
    kind: "spreadsheet",
    metadata: {},
    sheets: [
      {
        name: "Data",
        images: [],
        columns: [],
        rows: [],
        printSettings: {
          pageSize: { widthPt: 595, heightPt: 842 },
          margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
          gridlines: false,
          headers: false,
          pageOrder: "downThenOver",
        },
        cells: [
          {
            row: 0,
            column: 0,
            value: { kind: "string", value: "Name" },
            displayText: "Name",
          },
          {
            row: 0,
            column: 1,
            value: { kind: "number", value: 42 },
            displayText: "42",
          },
          {
            row: 1,
            column: 0,
            value: { kind: "currency", value: 9.99, currency: "USD" },
            displayText: "$9.99",
          },
          {
            row: 1,
            column: 1,
            value: { kind: "string", value: "formula result" },
            formula: "of:=1+1",
            displayText: "formula result",
          },
          {
            row: 2,
            column: 0,
            value: { kind: "string", value: "Merged" },
            displayText: "Merged",
            colSpan: 2,
          },
        ],
      },
      {
        name: "Second",
        images: [],
        columns: [],
        rows: [],
        printSettings: {
          pageSize: { widthPt: 595, heightPt: 842 },
          margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
          gridlines: false,
          headers: false,
          pageOrder: "downThenOver",
        },
        cells: [
          {
            row: 0,
            column: 0,
            value: { kind: "boolean", value: true },
            displayText: "TRUE",
          },
        ],
      },
    ],
  };
}

describe("buildOdsPackage", () => {
  it("throws for a non-spreadsheet ContentDocument", () => {
    expect(() =>
      buildOdsPackage({ kind: "wordprocessing", metadata: {}, sections: [] }),
    ).toThrow(/requires a spreadsheet/);
  });

  it("builds a package that reads back through odf.js's own readOdsContent with every sheet, cell value, and formula intact", () => {
    const pkg = buildOdsPackage(spreadsheetDocument());
    const document = readOdsContent(pkg);
    expect(document.sheets.map((s) => s.name)).toEqual(["Data", "Second"]);

    const dataSheet = document.sheets[0]!;
    const byPosition = new Map(
      dataSheet.cells.map((c) => [`${c.row},${c.column}`, c]),
    );
    expect(byPosition.get("0,0")?.value).toEqual({
      kind: "string",
      value: "Name",
    });
    expect(byPosition.get("0,1")?.value).toEqual({ kind: "number", value: 42 });
    expect(byPosition.get("1,0")?.value).toEqual({
      kind: "currency",
      value: 9.99,
      currency: "USD",
    });
    expect(byPosition.get("1,1")?.formula).toBe("of:=1+1");
    expect(byPosition.get("2,0")?.colSpan).toBe(2);
    // The merge's covered position never appears in cells[] at all -- matching readOdsContent's own "nothing to emit for a covered cell" convention.
    expect(byPosition.has("2,1")).toBe(false);

    const secondSheet = document.sheets[1]!;
    expect(secondSheet.cells[0]?.value).toEqual({
      kind: "boolean",
      value: true,
    });
  });

  it("an empty content.sheets array keeps the scaffold's own single default sheet", () => {
    const pkg = buildOdsPackage({
      kind: "spreadsheet",
      metadata: {},
      sheets: [],
    });
    const document = readOdsContent(pkg);
    expect(document.sheets).toHaveLength(1);
    expect(document.sheets[0]?.name).toBe("Sheet1");
    expect(document.sheets[0]?.cells).toEqual([]);
  });

  it("writes column/row hidden state, reading back through odf.js's own readOdsContent", () => {
    const content = spreadsheetDocument();
    content.sheets[0]!.columns.push({ index: 0, widthPt: 50, hidden: true });
    content.sheets[0]!.rows.push({ index: 3, heightPt: 12, hidden: true });

    const document = readOdsContent(buildOdsPackage(content));
    const dataSheet = document.sheets[0]!;
    expect(dataSheet.columns.find((c) => c.index === 0)?.hidden).toBe(true);
    expect(dataSheet.rows.find((r) => r.index === 3)?.hidden).toBe(true);
  });

  it("writes a ContentSheetImage as a real floating draw:frame under table:shapes", () => {
    const content = spreadsheetDocument();
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
    ]);
    content.sheets[0]!.images.push({
      kind: "image",
      format: "png",
      base64: bytesToBase64(pngBytes),
      widthPt: 40,
      heightPt: 30,
      anchorRow: 0,
      anchorColumn: 0,
      offsetXPt: 0,
      offsetYPt: 0,
    });

    const pkg = buildOdsPackage(content);
    const part = pkg.parts["content.xml"];
    if (part?.kind !== "xml") {
      throw new Error("expected content.xml");
    }
    const contentRootElement = rootElement(part.nodes);
    if (contentRootElement === undefined) {
      throw new Error("expected a content.xml root element");
    }
    const frame = elementsWithTag([contentRootElement], "draw:frame")[0];
    expect(frame).toBeDefined();
    expect(attrValue(frame!, "svg:width")).toBe("40pt");
    expect(pkg.parts["Pictures/image1.png"]?.kind).toBe("binary");

    // odf.js 2.2.0's readOds (now readOdsContent) genuinely reads a floating shape back (it previously hardcoded images: []), so this is now a real write-then-reread round trip rather than a structural check alone: the recovered image carries its own bytes, its declared size, and the anchor quartet buildOdsPackage wrote it at.
    const recovered = readOdsContent(pkg).sheets[0]!.images;
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.format).toBe("png");
    expect(recovered[0]!.base64).toBe(bytesToBase64(pngBytes));
    expect(recovered[0]!.widthPt).toBeCloseTo(40, 3);
    expect(recovered[0]!.heightPt).toBeCloseTo(30, 3);
    expect({
      anchorRow: recovered[0]!.anchorRow,
      anchorColumn: recovered[0]!.anchorColumn,
    }).toEqual({ anchorRow: 0, anchorColumn: 0 });
  });

  it("writes a formula-kind embeddedObject as a real ODF formula sub-document", () => {
    const content = spreadsheetDocument();
    content.sheets[0]!.embeddedObjects = [
      {
        objectKind: "formula",
        document: formulaDocument({
          mathml: [
            {
              type: "element",
              tag: "mi",
              attributes: [],
              children: [{ type: "text", value: "x" }],
            },
          ],
        }),
        frame: { xPt: 0, yPt: 0, widthPt: 20, heightPt: 10 },
      },
    ];

    const pkg = buildOdsPackage(content);
    expect(pkg.parts["Object 1/content.xml"]?.kind).toBe("xml");
  });
});
