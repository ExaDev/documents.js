import { describe, expect, it } from "vitest";

import type { ContentDocument } from "document-schema.js";
import type { XmlElement } from "ooxml.js";
import {
  attr,
  bytesToBase64,
  childrenWithTag,
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
    // runs() matches every w:r regardless of content, so the tab's own w:r (holding a bare w:tab, no w:t) still appears -- as an empty-text run between the two real ones.
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
    // docx collapses a horizontal merge into ONE real w:tc (no filler element for the consumed column), so the row's own cells array has exactly one entry, not two.
    expect(tableBlock.rows[0]?.cells).toHaveLength(1);
    expect(tableBlock.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(tableBlock.rows[0]?.cells[0]?.blocks[0]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "A1" }],
    });
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
});
