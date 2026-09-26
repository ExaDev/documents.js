import { describe, expect, it } from "vitest";
import type { ContentDocument } from "document-schema.js";
import type { XmlElement } from "ooxml.js";
import {
  attr,
  bytesToBase64,
  childrenWithTag,
  rootElement,
  textContent,
} from "ooxml.js";
import { readDocxContent } from "../../ooxml/docx/read";
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
            columns: [{ widthPt: 100 }, { widthPt: 100 }],
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
            columns: [{ widthPt: 100 }, { widthPt: 100 }],
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
            columns: [{ widthPt: 100 }, { widthPt: 100 }],
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
            columns: [{ widthPt: 100 }, { widthPt: 100 }, { widthPt: 100 }],
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
            columns: [{ widthPt: 100 }, { widthPt: 100 }, { widthPt: 100 }],
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
            columns: [{ widthPt: 100 }],
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
            columns: [{ widthPt: 100 }, { widthPt: 100 }],
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
});
