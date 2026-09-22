import { describe, expect, it } from "vitest";

import type {
  ContentDocument,
  ContentTable,
  ContentTableCell,
} from "document-schema.js";
import type { XmlElement } from "ooxml.js";
import {
  attr,
  bytesToBase64,
  childrenWithTag,
  decodeEntities,
  decodePackage,
  encodePackage,
  rootElement,
  textContent,
} from "ooxml.js";
import { readDocxContent } from "../../ooxml/docx/read";
import { collectDrawingMlVectors } from "../../test-support/drawingml-vector";
import { VECTOR_FIXTURE, vectorDrawingBlock } from "../../test-support/vectors";
import { walkElements } from "../../xml/query";
import { buildDocxPackage } from "./content";
import { DocxEditor } from "./editor";

function wordDoc(
  sections: Extract<ContentDocument, { kind: "wordprocessing" }>["sections"],
): ContentDocument {
  return { kind: "wordprocessing", metadata: {}, sections };
}

function descendants(root: XmlElement, tag: string): XmlElement[] {
  return [...walkElements(root.children)]
    .filter((cursor) => cursor.node.tag === tag)
    .map((cursor) => cursor.node);
}

describe("buildDocxPackage", () => {
  it("throws for a presentation ContentDocument", () => {
    expect(() =>
      buildDocxPackage({ kind: "presentation", metadata: {}, slides: [] }),
    ).toThrow(/wordprocessing/);
  });

  it("builds a paragraph with styled runs", () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: "paragraph",
            alignment: "center",
            runs: [
              { text: "Bold red ", bold: true, color: { r: 1, g: 0, b: 0 } },
              { text: "plain", fontFamily: "Georgia", sizePt: 14 },
            ],
          },
        ],
      },
    ]);
    const editor = new DocxEditor(buildDocxPackage(content));
    const [paragraph] = editor.paragraphs();
    expect(paragraph?.text).toBe("Bold red plain");
    expect(paragraph?.alignment).toBe("center");
    const runs = paragraph!.runs();
    expect(runs[0]).toMatchObject({
      text: "Bold red ",
      bold: true,
      color: { r: 1, g: 0, b: 0 },
    });
    expect(runs[1]).toMatchObject({
      text: "plain",
      fontFamily: "Georgia",
      sizePt: 14,
    });
  });

  it("inserts a real w:tab element for a run whose text is exactly a tab character", () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: "paragraph",
            runs: [{ text: "Left" }, { text: "\t" }, { text: "Right" }],
          },
        ],
      },
    ]);
    const editor = new DocxEditor(buildDocxPackage(content));
    const [paragraph] = editor.paragraphs();
    // runs() matches every w:r regardless of content, so the tab's own w:r (holding a bare w:tab, no w:t) still appears — as an empty-text run between the two real ones.
    expect(paragraph!.runs().map((r) => r.text)).toEqual(["Left", "", "Right"]);
    expect(paragraph!.text).toBe("LeftRight"); // textContent has no WordprocessingML-specific knowledge of w:tab, so it contributes no characters
  });

  it("inserts an image block as media, referenced from its own paragraph", () => {
    const pngBytes = new Uint8Array([1, 2, 3, 4]);
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: "image",
            format: "png",
            base64: bytesToBase64(pngBytes),
            widthPt: 100,
            heightPt: 50,
          },
        ],
      },
    ]);
    const pkg = buildDocxPackage(content);
    const mediaParts = Object.keys(pkg.parts).filter((p) =>
      p.startsWith("word/media/"),
    );
    expect(mediaParts).toHaveLength(1);
  });

  it("inserts a page break between sections", () => {
    const content: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
          blocks: [{ kind: "paragraph", runs: [{ text: "Section one" }] }],
        },
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
          blocks: [{ kind: "paragraph", runs: [{ text: "Section two" }] }],
        },
      ],
    };
    const editor = new DocxEditor(buildDocxPackage(content));
    const paragraphTexts = editor.paragraphs().map((p) => p.text);
    expect(paragraphTexts).toContain("Section one");
    expect(paragraphTexts).toContain("Section two");
  });

  it("builds a table with the right row/column count and cell text", () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: "table",
            columnWidthsPt: [100, 100],
            rows: [
              {
                cells: [
                  { blocks: [{ kind: "paragraph", runs: [{ text: "A1" }] }] },
                  { blocks: [{ kind: "paragraph", runs: [{ text: "B1" }] }] },
                ],
              },
              {
                cells: [
                  { blocks: [{ kind: "paragraph", runs: [{ text: "A2" }] }] },
                  { blocks: [{ kind: "paragraph", runs: [{ text: "B2" }] }] },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const editor = new DocxEditor(buildDocxPackage(content));
    const [table] = editor.tables();
    const rows = table!.rows();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.cells()).toHaveLength(2);
    expect(rows[0]!.cells()[0]!.text).toBe("A1");
    expect(rows[1]!.cells()[1]!.text).toBe("B2");
  });

  it("a vertically merged (rowSpan) cell survives a build-then-read round trip as merged, not as two ordinary cells", () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: "table",
            columnWidthsPt: [100, 100],
            rows: [
              {
                cells: [
                  {
                    blocks: [{ kind: "paragraph", runs: [{ text: "A1" }] }],
                    rowSpan: 2,
                  },
                  { blocks: [{ kind: "paragraph", runs: [{ text: "B1" }] }] },
                ],
              },
              {
                cells: [
                  { blocks: [] },
                  { blocks: [{ kind: "paragraph", runs: [{ text: "B2" }] }] },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const pkg = buildDocxPackage(content);
    const roundTripped = readDocxContent(pkg);
    if (roundTripped.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const tableBlock = roundTripped.sections[0]!.blocks[0];
    expect(tableBlock?.kind).toBe("table");
    if (tableBlock?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(tableBlock.rows[0]?.cells[0]?.rowSpan).toBe(2);
    expect(tableBlock.rows[0]?.cells[0]?.blocks[0]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "A1" }],
    });
    expect(tableBlock.rows[1]?.cells[0]?.rowSpan).toBeUndefined();
    expect(tableBlock.rows[1]?.cells[0]?.blocks).toEqual([]);
    expect(tableBlock.rows[0]?.cells[1]?.blocks[0]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "B1" }],
    });
    expect(tableBlock.rows[1]?.cells[1]?.blocks[0]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "B2" }],
    });
  });

  it("a horizontally merged (colSpan) cell survives a build-then-read round trip as merged, not as two ordinary cells", () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: "table",
            columnWidthsPt: [100, 100],
            rows: [
              {
                cells: [
                  {
                    blocks: [{ kind: "paragraph", runs: [{ text: "A1" }] }],
                    colSpan: 2,
                  },
                  { blocks: [] },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const pkg = buildDocxPackage(content);
    const roundTripped = readDocxContent(pkg);
    if (roundTripped.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const tableBlock = roundTripped.sections[0]!.blocks[0];
    expect(tableBlock?.kind).toBe("table");
    if (tableBlock?.kind !== "table") {
      throw new Error("expected a table block");
    }
    // The row reads back dense: the anchor at column 0 and an empty covered cell at the column its w:gridSpan reaches.
    expect(tableBlock.rows[0]?.cells).toHaveLength(2);
    expect(tableBlock.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(tableBlock.rows[0]?.cells[0]?.blocks[0]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "A1" }],
    });
    expect(tableBlock.rows[0]?.cells[1]).toEqual({ blocks: [] });
  });

  it("writes one w:tc per anchor for a dense row with a horizontal merge, none for the position the merge covers", () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: "table",
            columnWidthsPt: [100, 100, 100],
            rows: [
              {
                cells: [
                  { blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }] },
                  {
                    blocks: [{ kind: "paragraph", runs: [{ text: "B" }] }],
                    colSpan: 2,
                  },
                  { blocks: [] },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const documentRoot = rootElement(
      buildDocxPackage(content).parts["word/document.xml"],
    );
    if (documentRoot === undefined) {
      throw new Error("expected a word/document.xml root element");
    }
    const [row] = descendants(documentRoot, "w:tr");
    const cells = childrenWithTag(row!, "w:tc");
    expect(cells.map((cell) => textContent(cell))).toEqual(["A", "B"]);
    const gridSpans = cells.map((cell) => {
      const gridSpan = descendants(cell, "w:gridSpan")[0];
      return gridSpan === undefined ? undefined : attr(gridSpan, "w:val");
    });
    expect(gridSpans).toEqual([undefined, "2"]);
  });

  it("writes a bare w:vMerge continuation at the covering anchor's first column only, as wide as the anchor, for a region spanning rows and columns", () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: "table",
            columnWidthsPt: [100, 100, 100],
            rows: [
              {
                cells: [
                  {
                    blocks: [{ kind: "paragraph", runs: [{ text: "Big" }] }],
                    colSpan: 2,
                    rowSpan: 2,
                  },
                  { blocks: [] },
                  { blocks: [{ kind: "paragraph", runs: [{ text: "R1" }] }] },
                ],
              },
              {
                cells: [
                  { blocks: [] },
                  { blocks: [] },
                  { blocks: [{ kind: "paragraph", runs: [{ text: "R2" }] }] },
                ],
              },
              {
                cells: [
                  { blocks: [{ kind: "paragraph", runs: [{ text: "X" }] }] },
                  { blocks: [{ kind: "paragraph", runs: [{ text: "Y" }] }] },
                  { blocks: [{ kind: "paragraph", runs: [{ text: "Z" }] }] },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const pkg = buildDocxPackage(content);
    const documentRoot = rootElement(pkg.parts["word/document.xml"]);
    if (documentRoot === undefined) {
      throw new Error("expected a word/document.xml root element");
    }
    const rows = descendants(documentRoot, "w:tr").map((row) =>
      childrenWithTag(row, "w:tc").map((cell) => ({
        text: textContent(cell),
        gridSpan: attr(descendants(cell, "w:gridSpan")[0] ?? cell, "w:val"),
        vMerge: descendants(cell, "w:vMerge").map(
          (vMerge) => attr(vMerge, "w:val") ?? "continue",
        ),
      })),
    );
    expect(rows).toEqual([
      [
        { text: "Big", gridSpan: "2", vMerge: ["restart"] },
        { text: "R1", gridSpan: undefined, vMerge: [] },
      ],
      [
        { text: "", gridSpan: "2", vMerge: ["continue"] },
        { text: "R2", gridSpan: undefined, vMerge: [] },
      ],
      [
        { text: "X", gridSpan: undefined, vMerge: [] },
        { text: "Y", gridSpan: undefined, vMerge: [] },
        { text: "Z", gridSpan: undefined, vMerge: [] },
      ],
    ]);
    const roundTripped = readDocxContent(pkg);
    if (roundTripped.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const tableBlock = roundTripped.sections[0]!.blocks[0];
    if (tableBlock?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(tableBlock.rows.map((row) => row.cells.length)).toEqual([3, 3, 3]);
    expect(tableBlock.rows[0]?.cells[0]).toMatchObject({
      colSpan: 2,
      rowSpan: 2,
    });
  });

  it("writes a row's own height, and none for a row that states no height", () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: "table",
            columnWidthsPt: [100],
            rows: [
              { heightPt: 30, cells: [{ blocks: [] }] },
              { cells: [{ blocks: [] }] },
            ],
          },
        ],
      },
    ]);
    const documentRoot = rootElement(
      buildDocxPackage(content).parts["word/document.xml"],
    );
    if (documentRoot === undefined) {
      throw new Error("expected a word/document.xml root element");
    }
    const rows = descendants(documentRoot, "w:tr").map((row) =>
      descendants(row, "w:trHeight").map((height) => attr(height, "w:val")),
    );
    expect(rows).toEqual([["600"], []]);
  });

  it("writes a cell's own borders, and none for a cell that states none", () => {
    const red = { r: 1, g: 0, b: 0 };
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: "table",
            columnWidthsPt: [100, 100],
            rows: [
              {
                cells: [
                  { blocks: [], borders: { top: { color: red, widthPt: 1 } } },
                  { blocks: [] },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const documentRoot = rootElement(
      buildDocxPackage(content).parts["word/document.xml"],
    );
    if (documentRoot === undefined) {
      throw new Error("expected a word/document.xml root element");
    }
    const [row] = descendants(documentRoot, "w:tr");
    expect(
      childrenWithTag(row!, "w:tc").map(
        (cell) => descendants(cell, "w:tcBorders").length,
      ),
    ).toEqual([1, 0]);
  });

  it("writes a covered position's own shading on the continuation w:tc it becomes", () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: "table",
            columnWidthsPt: [100],
            rows: [
              {
                cells: [
                  {
                    blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }],
                    rowSpan: 2,
                  },
                ],
              },
              {
                cells: [
                  {
                    blocks: [],
                    background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const roundTripped = readDocxContent(buildDocxPackage(content));
    if (roundTripped.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const tableBlock = roundTripped.sections[0]!.blocks[0];
    if (tableBlock?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(tableBlock.rows[1]?.cells[0]?.background).toBeDefined();
  });

  it("writes a recovered drawing block as real DrawingML vector shapes that survive a build-then-read round trip", () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          { kind: "paragraph", runs: [{ text: "Before" }] },
          vectorDrawingBlock({ widthPt: 612, heightPt: 792 }),
          { kind: "paragraph", runs: [{ text: "After" }] },
        ],
      },
    ]);
    // Re-encoded and re-decoded, so what is read back has genuinely been through the zip/XML serialiser rather than being the same in-memory tree the writer produced.
    const pkg = decodePackage(encodePackage(buildDocxPackage(content)));
    const documentRoot = rootElement(pkg.parts["word/document.xml"]);
    if (documentRoot === undefined) {
      throw new Error("expected a word/document.xml root element");
    }
    expect(collectDrawingMlVectors(documentRoot, "wps:spPr")).toEqual(
      VECTOR_FIXTURE,
    );
    // The surrounding text is untouched: the anchors hang off one paragraph of their own between the two real ones.
    expect(new DocxEditor(pkg).paragraphs().map((p) => p.text)).toEqual([
      "Before",
      "",
      "After",
    ]);
  });

  it("recovers a written drawing block back out through readDocxContent, not just through the test-support oracle", () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          { kind: "paragraph", runs: [{ text: "Before" }] },
          vectorDrawingBlock({ widthPt: 612, heightPt: 792 }),
          { kind: "paragraph", runs: [{ text: "After" }] },
        ],
      },
    ]);
    const pkg = decodePackage(encodePackage(buildDocxPackage(content)));
    const roundTripped = readDocxContent(pkg);
    if (roundTripped.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const blocks = roundTripped.sections[0]!.blocks;
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "embeddedObject",
      "paragraph",
    ]);
    const drawingBlock = blocks[1];
    if (
      drawingBlock?.kind !== "embeddedObject" ||
      drawingBlock.document.kind !== "drawing"
    ) {
      throw new Error("expected a drawing-kind embeddedObject block");
    }
    expect(drawingBlock.document.pages[0]?.vectors).toEqual(VECTOR_FIXTURE);
    expect(
      blocks[0]?.kind === "paragraph"
        ? blocks[0].runs.map((r) => r.text).join("")
        : undefined,
    ).toBe("Before");
    expect(
      blocks[2]?.kind === "paragraph"
        ? blocks[2].runs.map((r) => r.text).join("")
        : undefined,
    ).toBe("After");
  });

  // Pins the actual markup, not just this package's own oracle round-tripping against itself: the DrawingML reader in test-support is written alongside the writer, so at least one test has to assert the literal attribute values a real Word/LibreOffice would read.
  it("anchors each vector shape to the page at its own recovered coordinates, behind the text", () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [vectorDrawingBlock({ widthPt: 612, heightPt: 792 })],
      },
    ]);
    const pkg = decodePackage(encodePackage(buildDocxPackage(content)));
    const documentRoot = rootElement(pkg.parts["word/document.xml"]);
    if (documentRoot === undefined) {
      throw new Error("expected a word/document.xml root element");
    }
    const anchors = descendants(documentRoot, "wp:anchor");
    expect(anchors).toHaveLength(VECTOR_FIXTURE.length);
    const [first] = anchors;
    expect(attr(first!, "behindDoc")).toBe("1");
    expect(childrenWithTag(first!, "wp:wrapNone")).toHaveLength(1);
    const positionH = childrenWithTag(first!, "wp:positionH")[0]!;
    const positionV = childrenWithTag(first!, "wp:positionV")[0]!;
    expect(attr(positionH, "relativeFrom")).toBe("page");
    expect(attr(positionV, "relativeFrom")).toBe("page");
    // The first fixture vector's frame is (10pt, 20pt); 1pt is 12,700 EMU.
    expect(textContent(childrenWithTag(positionH, "wp:posOffset")[0]!)).toBe(
      "127000",
    );
    expect(textContent(childrenWithTag(positionV, "wp:posOffset")[0]!)).toBe(
      "254000",
    );
    // A shape lives in the wordprocessingShape extension part, the only DrawingML vocabulary WordprocessingML has for a non-picture shape.
    const graphicData = descendants(anchors[0]!, "a:graphicData")[0]!;
    expect(attr(graphicData, "uri")).toBe(
      "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
    );
    expect(descendants(graphicData, "wps:wsp")).toHaveLength(1);
    // relativeHeight is Word's own z-order among floating objects, stamped from each vector's position in the recovered paint order.
    expect(anchors.map((anchor) => attr(anchor, "relativeHeight"))).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
    ]);
  });
  it("writes a bookmark construct marker pair as body-level w:bookmarkStart/w:bookmarkEnd around the blocks it spans", () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: "constructStart",
            descriptor: {
              kind: "anchor",
              anchorType: "bookmark",
              name: "TargetA",
            },
          },
          { kind: "paragraph", runs: [{ text: "inside the bookmark" }] },
          { kind: "constructEnd" },
          { kind: "paragraph", runs: [{ text: "outside" }] },
        ],
      },
    ]);
    const pkg = buildDocxPackage(content);
    const documentRoot = rootElement(pkg.parts["word/document.xml"]);
    if (documentRoot === undefined) {
      throw new Error("expected a word/document.xml root element");
    }
    const starts = descendants(documentRoot, "w:bookmarkStart");
    const ends = descendants(documentRoot, "w:bookmarkEnd");
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    const nameOf = (element: XmlElement) =>
      element.attributes.find((attribute) => attribute.name === "w:name")
        ?.value;
    const idOf = (element: XmlElement) =>
      element.attributes.find((attribute) => attribute.name === "w:id")?.value;
    expect(nameOf(starts[0]!)).toBe("TargetA");
    expect(idOf(starts[0]!)).toBe(idOf(ends[0]!));
    // The pair brackets the paragraph: in the body's child order, start precedes the paragraph's w:p and end follows it.
    const body = documentRoot.children.find(
      (child): child is XmlElement =>
        child.type === "element" && child.tag === "w:body",
    );
    if (body === undefined) {
      throw new Error("expected a w:body element");
    }
    const tags = body.children
      .filter((child): child is XmlElement => child.type === "element")
      .map((child) => child.tag);
    expect(tags.indexOf("w:bookmarkStart")).toBeLessThan(tags.indexOf("w:p"));
    expect(tags.indexOf("w:bookmarkEnd")).toBeGreaterThan(tags.indexOf("w:p"));
  });

  it("round-trips a contentControl construct pair through a real w:sdt region", () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: "constructStart",
            descriptor: {
              kind: "contentControl",
              controlType: "dropDown",
              tag: "region",
              alias: "Region picker",
              options: ["North", "South"],
              lock: "content",
            },
          },
          { kind: "paragraph", runs: [{ text: "inside the control" }] },
          { kind: "constructEnd" },
          { kind: "paragraph", runs: [{ text: "outside" }] },
        ],
      },
    ]);
    const rereadDoc = readDocxContent(buildDocxPackage(content));
    if (rereadDoc.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }

    const kinds = rereadDoc.sections[0]!.blocks.map((block) => block.kind);
    expect(kinds).toEqual([
      "constructStart",
      "paragraph",
      "constructEnd",
      "paragraph",
    ]);
    const marker = rereadDoc.sections[0]!.blocks[0];
    if (marker?.kind !== "constructStart") {
      throw new Error("expected the first block to be the construct marker");
    }
    expect(marker.descriptor).toEqual({
      kind: "contentControl",
      controlType: "dropDown",
      tag: "region",
      alias: "Region picker",
      options: ["North", "South"],
      lock: "content",
    });
    // The bracketed paragraph is genuinely INSIDE the control: its w:p lives under w:sdtContent, and the outside paragraph stays a direct body child.
    const pkg = buildDocxPackage(content);
    const documentRoot = rootElement(pkg.parts["word/document.xml"]);
    if (documentRoot === undefined) {
      throw new Error("expected a word/document.xml root element");
    }
    const sdts = descendants(documentRoot, "w:sdt");
    expect(sdts).toHaveLength(1);
    const insideText = textContent(
      childrenWithTag(sdts[0]!, "w:sdtContent")[0]!,
    );
    expect(insideText).toContain("inside the control");
    expect(insideText).not.toContain("outside");
  });

  it("round-trips a tracked-change construct pair through a real w:del region, with delText spelling", () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: "constructStart",
            descriptor: {
              kind: "provenance",
              change: "deletion",
              author: "A. N. Author",
              dateIso: "2026-09-10T10:00:00Z",
            },
          },
          { kind: "paragraph", runs: [{ text: "gone in this revision" }] },
          { kind: "constructEnd" },
          { kind: "paragraph", runs: [{ text: "still here" }] },
        ],
      },
    ]);
    const rereadDoc = readDocxContent(buildDocxPackage(content));
    if (rereadDoc.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const marker = rereadDoc.sections[0]!.blocks[0];
    if (marker?.kind !== "constructStart") {
      throw new Error("expected the first block to be the construct marker");
    }
    expect(marker.descriptor).toEqual({
      kind: "provenance",
      change: "deletion",
      author: "A. N. Author",
      dateIso: "2026-09-10T10:00:00Z",
    });

    // The deleted paragraph is genuinely inside the w:del, its runs spell w:delText, and the live paragraph stays outside with plain w:t.
    const pkg = buildDocxPackage(content);
    const documentRoot = rootElement(pkg.parts["word/document.xml"]);
    if (documentRoot === undefined) {
      throw new Error("expected a word/document.xml root element");
    }
    const dels = descendants(documentRoot, "w:del");
    expect(dels).toHaveLength(1);
    expect(textContent(dels[0]!)).toContain("gone in this revision");
    expect(
      dels[0]!.children.some((c) => c.type === "element" && c.tag === "w:p"),
    ).toBe(true);
    expect(descendants(dels[0]!, "w:delText")).toHaveLength(1);
    expect(descendants(dels[0]!, "w:t")).toHaveLength(0);
    const liveTexts = descendants(documentRoot, "w:t");
    expect(liveTexts.some((t) => textContent(t) === "still here")).toBe(true);
  });

  it("round-trips an insertion region as w:ins with author and date", () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: "constructStart",
            descriptor: { kind: "provenance", change: "insertion" },
          },
          { kind: "paragraph", runs: [{ text: "newly added" }] },
          { kind: "constructEnd" },
        ],
      },
    ]);
    const rereadDoc = readDocxContent(buildDocxPackage(content));
    if (rereadDoc.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const marker = rereadDoc.sections[0]!.blocks[0];
    if (marker?.kind !== "constructStart") {
      throw new Error("expected the first block to be the construct marker");
    }
    // An author/date-free insertion reads back with exactly the fields the source stated — no invented author, no minted date.
    expect(marker.descriptor).toEqual({
      kind: "provenance",
      change: "insertion",
    });
    const pkg = buildDocxPackage(content);
    const documentRoot = rootElement(pkg.parts["word/document.xml"]);
    if (documentRoot === undefined) {
      throw new Error("expected a word/document.xml root element");
    }
    const insElements = descendants(documentRoot, "w:ins");
    expect(insElements).toHaveLength(1);
    expect(textContent(insElements[0]!)).toContain("newly added");
    // An insertion's runs stay plain w:t — only deletions and move-froms re-spell.
    expect(descendants(insElements[0]!, "w:t")).toHaveLength(1);
    expect(descendants(insElements[0]!, "w:delText")).toHaveLength(0);
  });

  it("drops a formatChange pair by name rather than half-writing it", () => {
    // formatChange has no block-level element (its Word spellings are property-layer w:rPrChange/w:pPrChange), so the pair restores nothing on read and the written document carries no wrapper for it.
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: "constructStart",
            descriptor: { kind: "provenance", change: "formatChange" },
          },
          { kind: "paragraph", runs: [{ text: "reformatted" }] },
          { kind: "constructEnd" },
        ],
      },
    ]);
    const pkg = buildDocxPackage(content);
    const documentRoot = rootElement(pkg.parts["word/document.xml"]);
    if (documentRoot === undefined) {
      throw new Error("expected a word/document.xml root element");
    }
    for (const tag of ["w:ins", "w:del", "w:moveFrom", "w:moveTo"]) {
      expect(descendants(documentRoot, tag)).toHaveLength(0);
    }
    // The paragraph itself still writes — dropping the pair is not dropping the content it bracketed.
    expect(
      descendants(documentRoot, "w:t").some(
        (t) => textContent(t) === "reformatted",
      ),
    ).toBe(true);
  });

  it("round-trips nested contentControl regions and a checkbox control's state", () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: "constructStart",
            descriptor: { kind: "contentControl", controlType: "richText" },
          },
          { kind: "paragraph", runs: [{ text: "outer" }] },
          {
            kind: "constructStart",
            descriptor: {
              kind: "contentControl",
              controlType: "checkbox",
              checked: true,
            },
          },
          { kind: "paragraph", runs: [{ text: "inner" }] },
          { kind: "constructEnd" },
          { kind: "constructEnd" },
        ],
      },
    ]);
    const rereadDoc = readDocxContent(buildDocxPackage(content));
    if (rereadDoc.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }

    const kinds = rereadDoc.sections[0]!.blocks.map((block) => block.kind);
    expect(kinds).toEqual([
      "constructStart",
      "paragraph",
      "constructStart",
      "paragraph",
      "constructEnd",
      "constructEnd",
    ]);
    const blocks = rereadDoc.sections[0]!.blocks;
    const outer = blocks[0];
    const inner = blocks[2];
    if (outer?.kind !== "constructStart" || inner?.kind !== "constructStart") {
      throw new Error("expected nested construct markers");
    }
    expect(outer.descriptor).toEqual({
      kind: "contentControl",
      controlType: "richText",
    });
    expect(inner.descriptor).toEqual({
      kind: "contentControl",
      controlType: "checkbox",
      checked: true,
    });
  });

  it("drops a non-bookmark construct marker without disturbing an enclosing bookmark's pairing", () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: "constructStart",
            descriptor: {
              kind: "anchor",
              anchorType: "bookmark",
              name: "Outer",
            },
          },
          {
            kind: "constructStart",
            descriptor: { kind: "division", name: "dropped" },
          },
          { kind: "paragraph", runs: [{ text: "inner" }] },
          { kind: "constructEnd" },
          { kind: "constructEnd" },
        ],
      },
    ]);
    const pkg = buildDocxPackage(content);
    const documentRoot = rootElement(pkg.parts["word/document.xml"]);
    if (documentRoot === undefined) {
      throw new Error("expected a word/document.xml root element");
    }
    expect(descendants(documentRoot, "w:bookmarkStart")).toHaveLength(1);
    expect(descendants(documentRoot, "w:bookmarkEnd")).toHaveLength(1);
  });
  it("XML-escapes a bookmark name carrying markup, so it cannot inject elements or attributes into document.xml", () => {
    const hostile = 'x"/><w:p><w:fldSimple w:instr="WEBSERVICE">';
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: "constructStart",
            descriptor: {
              kind: "anchor",
              anchorType: "bookmark",
              name: hostile,
            },
          },
          { kind: "paragraph", runs: [{ text: "body" }] },
          { kind: "constructEnd" },
        ],
      },
    ]);
    const pkg = buildDocxPackage(content);
    const documentRoot = rootElement(pkg.parts["word/document.xml"]);
    if (documentRoot === undefined) {
      throw new Error("expected a word/document.xml root element");
    }
    // The model stores the pre-encoded attribute (this package's processEntities:false convention — el() never encodes), so the name arrives as data with its markup neutralised, and exactly one bookmarkStart exists: the name injected no extra element.
    const starts = descendants(documentRoot, "w:bookmarkStart");
    expect(starts).toHaveLength(1);
    const stored = starts[0]!.attributes.find(
      (a) => a.name === "w:name",
    )?.value;
    expect(stored).toContain("&lt;w:fldSimple");
    expect(stored).not.toContain("<w:fldSimple");
    expect(decodeEntities(stored ?? "")).toBe(hostile);
  });
});

describe("buildDocxPackage: a table breaking the grid rule", () => {
  // A merged header whose covered position carries a second copy of the anchor's content, which a docx horizontal merge has no cell to hold.
  const coveredContentTable: ContentTable = {
    kind: "table",
    columnWidthsPt: [100, 100],
    rows: [
      {
        cells: [
          {
            blocks: [{ kind: "paragraph", runs: [{ text: "anchor" }] }],
            colSpan: 2,
          },
          { blocks: [{ kind: "paragraph", runs: [{ text: "copy" }] }] },
        ],
      },
    ],
  };

  it("refuses the table, naming the entry point and the fault, rather than dropping the covered content", () => {
    expect(() =>
      buildDocxPackage(
        wordDoc([
          {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
            blocks: [coveredContentTable],
          },
        ]),
      ),
    ).toThrow(
      "buildDocxPackage: table breaks the grid rule (the cell at row 0, column 1 lies inside the merged region anchored at row 0, column 0 but carries content of its own, and a merged region's content belongs to its anchor)",
    );
  });

  it("refuses a table with no declared columns rather than skipping it silently", () => {
    expect(() =>
      buildDocxPackage(
        wordDoc([
          {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
            blocks: [{ ...coveredContentTable, columnWidthsPt: [] }],
          },
        ]),
      ),
    ).toThrow(/^buildDocxPackage: table breaks the grid rule/);
  });
});

describe("buildDocxPackage: a table that states no column widths", () => {
  function cellOf(text: string): ContentTableCell {
    return { blocks: [{ kind: "paragraph", runs: [{ text }] }] };
  }

  function documentOf(table: ContentTable): ContentDocument {
    return wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [table],
      },
    ]);
  }

  function writtenTable(table: ContentTable): ContentTable {
    const reread = readDocxContent(buildDocxPackage(documentOf(table)));
    if (reread.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const block = reread.sections[0]?.blocks[0];
    if (block?.kind !== "table") {
      throw new Error("expected the section to hold a table");
    }
    return block;
  }

  function gridColumns(table: ContentTable): number {
    const root = rootElement(
      buildDocxPackage(documentOf(table)).parts["word/document.xml"],
    );
    if (root === undefined) {
      throw new Error("expected a word/document.xml root element");
    }
    return descendants(root, "w:gridCol").length;
  }

  it("is written with one w:gridCol per grid column the rows state, rather than dropped", () => {
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [],
      rows: [
        { cells: [cellOf("a"), cellOf("b")] },
        { cells: [cellOf("c"), cellOf("d")] },
      ],
    };
    expect(gridColumns(table)).toBe(2);
    const written = writtenTable(table);
    expect(written.columnWidthsPt).toHaveLength(2);
    for (const widthPt of written.columnWidthsPt) {
      expect(widthPt).toBeGreaterThan(0);
    }
    expect(written.rows.map((row) => row.cells.length)).toEqual([2, 2]);
  });

  it("writes a merged region across columns the rows state and the widths do not", () => {
    const written = writtenTable({
      kind: "table",
      columnWidthsPt: [],
      rows: [
        { cells: [{ ...cellOf("wide"), colSpan: 2 }, { blocks: [] }] },
        { cells: [cellOf("c"), cellOf("d")] },
      ],
    });
    expect(written.columnWidthsPt).toHaveLength(2);
    expect(written.rows[0]?.cells[0]).toMatchObject({ colSpan: 2 });
  });

  it("widens a grid whose stated widths are fewer than the columns the rows occupy, keeping the widths it does state", () => {
    const written = writtenTable({
      kind: "table",
      columnWidthsPt: [100],
      rows: [{ cells: [cellOf("a"), cellOf("b")] }],
    });
    expect(written.columnWidthsPt).toHaveLength(2);
    expect(written.columnWidthsPt[0]).toBe(100);
  });

  it("writes the stated widths unchanged when the table states one per column", () => {
    const written = writtenTable({
      kind: "table",
      columnWidthsPt: [50, 70],
      rows: [{ cells: [cellOf("a"), cellOf("b")] }],
    });
    expect(written.columnWidthsPt).toEqual([50, 70]);
  });

  it("still reports a grid fault in a table with no widths, rather than dropping it", () => {
    expect(() =>
      buildDocxPackage(
        documentOf({
          kind: "table",
          columnWidthsPt: [],
          rows: [
            { cells: [cellOf("a"), cellOf("b")] },
            { cells: [cellOf("c")] },
          ],
        }),
      ),
    ).toThrow(
      "buildDocxPackage: table breaks the grid rule (row 1 holds 1 cells where the widest row holds 2, but every row of a table covers the same grid)",
    );
  });

  it("refuses a table with no rows, with or without stated widths, rather than dropping it", () => {
    for (const columnWidthsPt of [[], [100, 100]]) {
      expect(() =>
        buildDocxPackage(
          documentOf({ kind: "table", columnWidthsPt, rows: [] }),
        ),
      ).toThrow(
        "buildDocxPackage: table has no rows, and a table with no rows cannot be written in every word-processing format (ODF requires at least one table:table-row)",
      );
    }
  });
});
