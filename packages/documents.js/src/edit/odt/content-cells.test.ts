import type {
  ContentDocument,
  ContentTable,
  ContentTableCell,
  ContentVector,
} from "document-schema.js";
import type { Package } from "odf.js";
import {
  bytesToBase64,
  childrenWithTag,
  decodePackage,
  encodePackage,
  elementsWithTag,
  findChildElement,
  readDrawPageContent,
  rootElement,
} from "odf.js";
import { attr, decodeEntities } from "ooxml.js";
import type { XmlElement } from "odf.js";
import { encodePng } from "byte-codec";
import { describe, expect, it } from "vitest";
import { readOdtContent } from "../../odf/odt/read";
import {
  rotationsOf,
  VECTOR_FIXTURE,
  vectorDrawingBlock,
  withoutRotation,
} from "../../test-support/vectors";
import { buildOdtPackage } from "./content";
import { OdtEditor } from "./editor";
function tinyPngBase64(): string {
  return bytesToBase64(
    encodePng({
      width: 2,
      height: 2,
      channels: 3,
      data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]),
    }),
  );
}

function wordDoc(
  sections: Extract<ContentDocument, { kind: "wordprocessing" }>["sections"],
): ContentDocument {
  return { kind: "wordprocessing", metadata: {}, sections };
}

function contentRoot(pkg: Package): XmlElement {
  const part = pkg.parts["content.xml"];
  const root = part?.kind === "xml" ? rootElement(part.nodes) : undefined;
  if (root === undefined) {
    throw new Error("expected an xml content.xml part with a root element");
  }
  return root;
}

function officeText(pkg: Package): XmlElement {
  const root = contentRoot(pkg);
  const body = findChildElement(root.children, "office:body");
  const text =
    body === undefined
      ? undefined
      : findChildElement(body.children, "office:text");
  if (text === undefined) {
    throw new Error("expected an office:body/office:text element");
  }
  return text;
}

// Every vector this package wrote into a text document's flow, read back through odf.js's OWN readDrawPageContent — the same reader readOdgContent uses for a real drawing page — rather than through an inverse written alongside the writer. A text-anchored vector lives inside the text:p it is anchored to (see OdtBody.appendVectors), so this hands that paragraph's children to the reader exactly as readOdg hands it a draw:page's.
function readFlowVectors(pkg: Package): ContentVector[] {
  return childrenWithTag(officeText(pkg), "text:p").flatMap(
    (paragraph) => readDrawPageContent(paragraph.children, pkg).vectors,
  );
}

describe("buildOdtPackage", () => {
  // The table block a built package reads back as, for asserting on the grid the ODF reader hands back.
  function roundTrippedTable(table: ContentTable): ContentTable {
    const roundTripped = readOdtContent(
      buildOdtPackage(
        wordDoc([
          {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
            blocks: [table],
          },
        ]),
      ),
    );
    if (roundTripped.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const block = roundTripped.sections[0]!.blocks[0];
    if (block?.kind !== "table") {
      throw new Error("expected a table block");
    }
    return block;
  }

  function textCell(text: string, extra: object = {}) {
    return {
      blocks: [{ kind: "paragraph" as const, runs: [{ text }] }],
      ...extra,
    };
  }
  it("a covered entry's own background and borders are written onto its table:covered-table-cell and read back", () => {
    const fill = { kind: "solid", color: { r: 1, g: 0, b: 0 } } as const;
    const borders = {
      left: { color: { r: 0, g: 0, b: 1 }, widthPt: 2, style: "solid" },
    } as const;
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 50 }, { widthPt: 50 }],
      rows: [
        {
          cells: [
            textCell("A", { colSpan: 2 }),
            { blocks: [], background: fill, borders },
          ],
        },
      ],
    };
    const pkg = buildOdtPackage(
      wordDoc([
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
          blocks: [table],
        },
      ]),
    );
    const covered = elementsWithTag(
      contentRoot(pkg).children,
      "table:covered-table-cell",
    )[0];
    expect(covered).toBeDefined();
    expect(attr(covered!, "table:style-name")).toBeDefined();

    const reread = roundTrippedTable(table);
    expect(reread.rows[0]?.cells[1]).toMatchObject({
      blocks: [],
      background: fill,
      borders,
    });
  });

  it("inserts an image block as media, referenced from its own paragraph, and reads back through readOdtContent", () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: "image",
            format: "png",
            base64: tinyPngBase64(),
            widthPt: 100,
            heightPt: 50,
          },
        ],
      },
    ]);
    const pkg = buildOdtPackage(content);
    const mediaParts = Object.keys(pkg.parts).filter((p) =>
      p.startsWith("Pictures/"),
    );
    expect(mediaParts).toHaveLength(1);
    // A bare image block with no preceding paragraph still gets one real text:p to anchor into (appendBlock's own 'image' case, mirroring buildDocxPackage's identical fallback) — exactly one physical paragraph was written.
    expect(new OdtEditor(pkg).paragraphs()).toHaveLength(1);

    const recovered = readOdtContent(decodePackage(encodePackage(pkg)));
    if (recovered.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    // readOdtContent's own image detection never consumes the paragraph it finds the image in (see src/odf/odt/read.ts's own top-of-file comment) — so the single physical text:p reads back as an empty paragraph block immediately followed by the image block, the identical two-block shape ooxml.js's own readDocx produces for a docx inline image with no surrounding text.
    expect(recovered.sections[0]!.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "image",
    ]);
    expect(recovered.sections[0]!.blocks[1]).toMatchObject({
      kind: "image",
      format: "png",
      widthPt: 100,
      heightPt: 50,
    });
  });

  it("merges a real paragraph immediately followed by an image into one physical paragraph, not two", () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          { kind: "paragraph", runs: [{ text: "Before" }] },
          { kind: "paragraph", styleId: "Standard", runs: [{ text: "" }] },
          {
            kind: "image",
            format: "png",
            base64: tinyPngBase64(),
            widthPt: 100,
            heightPt: 50,
          },
          { kind: "paragraph", runs: [{ text: "After" }] },
        ],
      },
    ]);
    const pkg = buildOdtPackage(content);
    // Exactly three real text:p elements were written — if the merge failed, the empty run-carrying paragraph and its image would have landed as two separate paragraphs, producing four.
    const editor = new OdtEditor(pkg);
    expect(editor.paragraphs().map((p) => p.text)).toEqual([
      "Before",
      "",
      "After",
    ]);

    // Reading the three physical paragraphs back splits the merged one into its own [paragraph, image] pair again (see the test above), so the four LOGICAL blocks the source declared survive exactly — the merge only ever avoids an extra spurious PHYSICAL paragraph, never a logical one.
    const recovered = readOdtContent(decodePackage(encodePackage(pkg)));
    if (recovered.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    expect(recovered.sections[0]!.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "paragraph",
      "image",
      "paragraph",
    ]);
  });

  it("writes an image inside a table cell, unlike buildDocxPackage's own documented table-cell limitation", () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: "table",
            columns: [{ widthPt: 200 }, { widthPt: 200 }],
            rows: [
              {
                cells: [
                  {
                    blocks: [
                      {
                        kind: "image",
                        format: "png",
                        base64: tinyPngBase64(),
                        widthPt: 100,
                        heightPt: 50,
                      },
                    ],
                  },
                  { blocks: [{ kind: "paragraph", runs: [{ text: "B1" }] }] },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const pkg = buildOdtPackage(content);
    const mediaParts = Object.keys(pkg.parts).filter((p) =>
      p.startsWith("Pictures/"),
    );
    expect(mediaParts).toHaveLength(1);

    const editor = new OdtEditor(pkg);
    const [table] = editor.tables();
    const [row] = table!.rows();
    const [firstCell, secondCell] = row!.cells();
    expect(firstCell!.paragraphs()).toHaveLength(1); // the image reused the cell's own pre-built first paragraph, no stray blank one alongside it
    expect(secondCell!.text).toBe("B1");
  });

  it("writes a recovered drawing block as real draw: vector primitives that survive a build-then-read round trip", () => {
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
    const pkg = decodePackage(encodePackage(buildOdtPackage(content)));
    const recovered = readFlowVectors(pkg);
    expect(withoutRotation(recovered)).toEqual(withoutRotation(VECTOR_FIXTURE));
    expect(rotationsOf(recovered)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      expect.closeTo(30, 4),
    ]);
    // The surrounding text is untouched: the vectors sit in one anchor paragraph of their own between the two real ones.
    expect(new OdtEditor(pkg).paragraphs().map((p) => p.text)).toEqual([
      "Before",
      "",
      "After",
    ]);
  });

  it("recovers a written drawing block back out through readOdtContent, not just through odf.js's own readDrawPageContent", () => {
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
    const pkg = decodePackage(encodePackage(buildOdtPackage(content)));
    const roundTripped = readOdtContent(pkg);
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
    expect(
      withoutRotation(drawingBlock.document.pages[0]?.vectors ?? []),
    ).toEqual(withoutRotation(VECTOR_FIXTURE));
    expect(rotationsOf(drawingBlock.document.pages[0]?.vectors ?? [])).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      expect.closeTo(30, 4),
    ]);
  });

  // A vector's coordinates are page-absolute (that is what reconstructWordprocessing recovers), so an anchor paragraph is not enough on its own: without style:vertical-rel="page" every shape would be measured from wherever its anchor paragraph flowed to instead.
  it("anchors each vector to its paragraph but positions it against the page, behind the text", () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [vectorDrawingBlock({ widthPt: 612, heightPt: 792 })],
      },
    ]);
    const pkg = decodePackage(encodePackage(buildOdtPackage(content)));
    const [anchorParagraph] = childrenWithTag(officeText(pkg), "text:p");
    const vectorElements = anchorParagraph!.children.filter(
      (child): child is XmlElement => child.type === "element",
    );
    expect(vectorElements.map((element) => element.tag)).toEqual([
      "draw:rect",
      "draw:ellipse",
      "draw:line",
      "draw:path",
      "draw:rect",
    ]);
    expect(
      vectorElements.map((element) => attr(element, "text:anchor-type")),
    ).toEqual(Array.from(vectorElements, () => "paragraph"));

    const automaticStyles = findChildElement(
      contentRoot(pkg).children,
      "office:automatic-styles",
    );
    if (automaticStyles === undefined) {
      throw new Error("expected an office:automatic-styles element");
    }
    const graphicProperties = childrenWithTag(automaticStyles, "style:style")
      .filter((style) => attr(style, "style:family") === "graphic")
      .flatMap((style) => childrenWithTag(style, "style:graphic-properties"));
    expect(graphicProperties).toHaveLength(vectorElements.length);
    for (const properties of graphicProperties) {
      expect(attr(properties, "style:horizontal-rel")).toBe("page");
      expect(attr(properties, "style:vertical-rel")).toBe("page");
      expect(attr(properties, "style:run-through")).toBe("background");
      expect(attr(properties, "style:wrap")).toBe("run-through");
    }
  });
  it("writes a bookmark construct marker pair as office:text-level text:bookmark-start/-end around the blocks it spans", () => {
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
              name: "Ziel",
            },
          },
          { kind: "paragraph", runs: [{ text: "inside the bookmark" }] },
          { kind: "constructEnd" },
          { kind: "paragraph", runs: [{ text: "outside" }] },
        ],
      },
    ]);
    const pkg = buildOdtPackage(content);
    const text = officeText(pkg);
    const starts = childrenWithTag(text, "text:bookmark-start");
    const ends = childrenWithTag(text, "text:bookmark-end");
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(attr(starts[0]!, "text:name")).toBe("Ziel");
    expect(attr(ends[0]!, "text:name")).toBe("Ziel");
    const tags = text.children
      .filter((child): child is XmlElement => child.type === "element")
      .map((child) => child.tag);
    expect(tags.indexOf("text:bookmark-start")).toBeLessThan(
      tags.indexOf("text:p"),
    );
    expect(tags.indexOf("text:bookmark-end")).toBeGreaterThan(
      tags.indexOf("text:p"),
    );
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
              name: "Aussen",
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
    const pkg = buildOdtPackage(content);
    const text = officeText(pkg);
    expect(childrenWithTag(text, "text:bookmark-start")).toHaveLength(1);
    expect(childrenWithTag(text, "text:bookmark-end")).toHaveLength(1);
  });
  it("XML-escapes a bookmark name carrying markup, so it cannot inject elements or attributes into content.xml", () => {
    const hostile = 'x"/><text:p>injected</text:p>';
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
    const pkg = buildOdtPackage(content);
    const text = officeText(pkg);
    const starts = childrenWithTag(text, "text:bookmark-start");
    expect(starts).toHaveLength(1);
    expect(childrenWithTag(text, "text:bookmark-end")).toHaveLength(1);
    expect(
      text.children.filter(
        (child) => child.type === "element" && child.tag === "text:p",
      ),
    ).toHaveLength(1);
    const stored = attr(starts[0]!, "text:name");
    expect(stored).toContain("&lt;text:p");
    expect(decodeEntities(stored ?? "")).toBe(hostile);
  });
});

describe("buildOdtPackage: a table breaking the grid rule", () => {
  // A merged header whose covered position carries a second copy of the anchor's content, which a table:covered-table-cell has no room for.
  const coveredContentTable: ContentTable = {
    kind: "table",
    columns: [{ widthPt: 100 }, { widthPt: 100 }],
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

  it("refuses the table, naming the fault, rather than dropping the covered content", () => {
    expect(() =>
      buildOdtPackage(
        wordDoc([
          {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
            blocks: [coveredContentTable],
          },
        ]),
      ),
    ).toThrow(
      "populateOdtTable: table breaks the grid rule (the cell at row 0, column 1 lies inside the merged region anchored at row 0, column 0 but carries content of its own, and a merged region's content belongs to its anchor)",
    );
  });
});

describe("buildOdtPackage: a table that states no column widths", () => {
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
    const reread = readOdtContent(buildOdtPackage(documentOf(table)));
    if (reread.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const block = reread.sections[0]?.blocks[0];
    if (block?.kind !== "table") {
      throw new Error("expected the section to hold a table");
    }
    return block;
  }

  function cellTexts(table: ContentTable): string[][] {
    return table.rows.map((row) =>
      row.cells.map((cell) =>
        cell.blocks
          .flatMap((block) =>
            block.kind === "paragraph" ? block.runs.map((run) => run.text) : [],
          )
          .join(""),
      ),
    );
  }

  it("is written with one column per grid column the rows state, rather than dropped", () => {
    const written = writtenTable({
      kind: "table",
      columns: [],
      rows: [
        { cells: [cellOf("a"), cellOf("b")] },
        { cells: [cellOf("c"), cellOf("d")] },
      ],
    });
    expect(written.columns).toHaveLength(2);
    expect(cellTexts(written)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("gives each column with no stated width a positive width", () => {
    const written = writtenTable({
      kind: "table",
      columns: [],
      rows: [{ cells: [cellOf("a"), cellOf("b")] }],
    });
    for (const { widthPt } of written.columns) {
      expect(widthPt).toBeGreaterThan(0);
    }
  });

  it("writes a merged region across columns the rows state and the widths do not", () => {
    const written = writtenTable({
      kind: "table",
      columns: [],
      rows: [
        { cells: [{ ...cellOf("wide"), colSpan: 2 }, { blocks: [] }] },
        { cells: [cellOf("c"), cellOf("d")] },
      ],
    });
    expect(written.columns).toHaveLength(2);
    expect(written.rows[0]?.cells[0]).toMatchObject({ colSpan: 2 });
    expect(cellTexts(written)[1]).toEqual(["c", "d"]);
  });

  it("widens a grid whose stated widths are fewer than the columns the rows occupy, keeping the widths it does state", () => {
    const written = writtenTable({
      kind: "table",
      columns: [{ widthPt: 100 }],
      rows: [{ cells: [cellOf("a"), cellOf("b")] }],
    });
    expect(written.columns).toHaveLength(2);
    expect(written.columns[0]?.widthPt).toBe(100);
  });

  it("writes the stated widths unchanged when the table states one per column", () => {
    const written = writtenTable({
      kind: "table",
      columns: [{ widthPt: 50 }, { widthPt: 70 }],
      rows: [{ cells: [cellOf("a"), cellOf("b")] }],
    });
    expect(written.columns.map((c) => c.widthPt)).toEqual([50, 70]);
  });

  it("still reports a grid fault in a table with no widths, rather than dropping it", () => {
    expect(() =>
      buildOdtPackage(
        documentOf({
          kind: "table",
          columns: [],
          rows: [
            { cells: [cellOf("a"), cellOf("b")] },
            { cells: [cellOf("c")] },
          ],
        }),
      ),
    ).toThrow(
      "populateOdtTable: table breaks the grid rule (row 1 holds 1 cells where the widest row holds 2, but every row of a table covers the same grid)",
    );
  });

  it("refuses a table with no rows, with or without stated widths, rather than dropping it", () => {
    for (const columnWidthsPt of [[] as number[], [100, 100]]) {
      expect(() =>
        buildOdtPackage(
          documentOf({
            kind: "table",
            columns: columnWidthsPt.map((widthPt) => ({ widthPt })),
            rows: [],
          }),
        ),
      ).toThrow(
        "buildOdtPackage: table has no rows, and ODF requires a table:table to hold at least one table:table-row",
      );
    }
  });
});
