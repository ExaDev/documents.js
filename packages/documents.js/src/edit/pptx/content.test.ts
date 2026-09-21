import { describe, expect, it } from "vitest";

import type {
  ContentDocument,
  ContentEmbeddedObjectBlock,
  ContentTable,
  ContentTableCell,
} from "document-schema.js";
import { walkTableGrid } from "document-schema.js";
import type { Package, XmlElement } from "ooxml.js";
import {
  attr,
  base64ToBytes,
  buildDocxPackageFromContent,
  bytesToBase64,
  decodePackage,
  encodePackage,
  readDocxContent,
  rootElement,
} from "ooxml.js";
import { readPptxContent } from "../../ooxml/pptx/read";
import { collectDrawingMlVectors } from "../../test-support/drawingml-vector";
import { VECTOR_FIXTURE, vectorDrawingBlock } from "../../test-support/vectors";
import { walkElements } from "../../xml/query";
import { buildPptxPackage, embeddedPresentationSerialiser } from "./content";
import { PptxEditor } from "./editor";

function presentationDoc(
  slides: Extract<ContentDocument, { kind: "presentation" }>["slides"],
): ContentDocument {
  return { kind: "presentation", metadata: {}, slides };
}

function firstSlideRoot(pkg: Package): XmlElement {
  const root = rootElement(pkg.parts["ppt/slides/slide1.xml"]);
  if (root === undefined) {
    throw new Error("expected a ppt/slides/slide1.xml root element");
  }
  return root;
}

const ZERO_INSETS = {
  insetLeftPt: 0,
  insetTopPt: 0,
  insetRightPt: 0,
  insetBottomPt: 0,
};
const SLIDE_SIZE = { widthPt: 960, heightPt: 540 };

describe("buildPptxPackage", () => {
  it("throws for a wordprocessing ContentDocument", () => {
    expect(() =>
      buildPptxPackage({ kind: "wordprocessing", metadata: {}, sections: [] }),
    ).toThrow(/presentation/);
  });

  it("sets the deck-wide slide size from the first slide", () => {
    const content = presentationDoc([
      { size: { widthPt: 612, heightPt: 792 }, shapes: [], notes: "" },
    ]);
    const editor = new PptxEditor(buildPptxPackage(content));
    expect(editor.slideSize).toEqual({ widthPt: 612, heightPt: 792 });
  });

  it("builds a text shape with multiple styled paragraphs", () => {
    const content = presentationDoc([
      {
        size: { widthPt: 960, heightPt: 540 },
        notes: "",
        shapes: [
          {
            frame: { xPt: 10, yPt: 10, widthPt: 200, heightPt: 100 },
            ...ZERO_INSETS,
            blocks: [
              {
                kind: "paragraph",
                alignment: "center",
                runs: [{ text: "Title", bold: true, sizePt: 24 }],
              },
              {
                kind: "paragraph",
                runs: [{ text: "Body text", color: { r: 0, g: 0, b: 1 } }],
              },
            ],
          },
        ],
      },
    ]);
    const editor = new PptxEditor(buildPptxPackage(content));
    const [slide] = editor.slides();
    const [shape] = slide!.shapes();
    expect(shape?.frame).toEqual({
      xPt: 10,
      yPt: 10,
      widthPt: 200,
      heightPt: 100,
    });
    expect(shape?.text).toBe("TitleBody text");
  });

  it("builds an image-only shape as a picture, not a text box", () => {
    const content = presentationDoc([
      {
        size: { widthPt: 960, heightPt: 540 },
        notes: "",
        shapes: [
          {
            frame: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 50 },
            ...ZERO_INSETS,
            blocks: [
              {
                kind: "image",
                format: "png",
                base64: bytesToBase64(new Uint8Array([1, 2, 3])),
                widthPt: 50,
                heightPt: 50,
              },
            ],
          },
        ],
      },
    ]);
    const pkg = buildPptxPackage(content);
    const mediaParts = Object.keys(pkg.parts).filter((p) =>
      p.startsWith("ppt/media/"),
    );
    expect(mediaParts).toHaveLength(1);
  });

  it("builds one slide per ContentSlide and carries notes through", () => {
    const content = presentationDoc([
      {
        size: { widthPt: 960, heightPt: 540 },
        shapes: [],
        notes: "First slide notes",
      },
      { size: { widthPt: 960, heightPt: 540 }, shapes: [], notes: "" },
    ]);
    const editor = new PptxEditor(buildPptxPackage(content));
    const slides = editor.slides();
    expect(slides).toHaveLength(2);
    expect(slides[0]!.notes).toBe("First slide notes");
    expect(slides[1]!.notes).toBe("");
  });

  it("writes a shape carrying a recovered drawing as real DrawingML vector shapes that survive a build-then-read round trip", () => {
    const content = presentationDoc([
      {
        size: SLIDE_SIZE,
        notes: "",
        shapes: [
          {
            frame: { xPt: 0, yPt: 0, ...SLIDE_SIZE },
            ...ZERO_INSETS,
            blocks: [vectorDrawingBlock(SLIDE_SIZE)],
          },
        ],
      },
    ]);
    // Re-encoded and re-decoded, so what is read back has genuinely been through the zip/XML serialiser rather than being the same in-memory tree the writer produced.
    const pkg = decodePackage(encodePackage(buildPptxPackage(content)));
    expect(collectDrawingMlVectors(firstSlideRoot(pkg), "p:spPr")).toEqual(
      VECTOR_FIXTURE,
    );
  });

  it("recovers a written drawing block back out through readPptxContent, not just through the test-support oracle", () => {
    const content = presentationDoc([
      {
        size: SLIDE_SIZE,
        notes: "",
        shapes: [
          {
            frame: { xPt: 10, yPt: 10, widthPt: 200, heightPt: 50 },
            ...ZERO_INSETS,
            blocks: [{ kind: "paragraph", runs: [{ text: "Before" }] }],
          },
          {
            frame: { xPt: 0, yPt: 0, ...SLIDE_SIZE },
            ...ZERO_INSETS,
            blocks: [vectorDrawingBlock(SLIDE_SIZE)],
          },
          {
            frame: { xPt: 10, yPt: 500, widthPt: 200, heightPt: 50 },
            ...ZERO_INSETS,
            blocks: [{ kind: "paragraph", runs: [{ text: "After" }] }],
          },
        ],
      },
    ]);
    const pkg = decodePackage(encodePackage(buildPptxPackage(content)));
    const roundTripped = readPptxContent(pkg);
    if (roundTripped.kind !== "presentation") {
      throw new Error("expected a presentation ContentDocument");
    }
    const shapes = roundTripped.slides[0]!.shapes;
    // The five bare vector shapes this package's own writer emits (no wrapper) collapse back into ONE synthetic drawing shape, at the position they occupied among the slide's real shapes.
    expect(shapes.map((shape) => shape.blocks[0]?.kind)).toEqual([
      "paragraph",
      "embeddedObject",
      "paragraph",
    ]);
    const drawingShape = shapes[1];
    const drawingBlock = drawingShape?.blocks[0];
    if (
      drawingBlock?.kind !== "embeddedObject" ||
      drawingBlock.document.kind !== "drawing"
    ) {
      throw new Error("expected a drawing-kind embeddedObject block");
    }
    expect(drawingBlock.document.pages[0]?.vectors).toEqual(VECTOR_FIXTURE);
  });

  it("translates a recovered drawing by its containing shape's own frame, and adds no empty text box for it", () => {
    const content = presentationDoc([
      {
        size: SLIDE_SIZE,
        notes: "",
        shapes: [
          {
            frame: { xPt: 100, yPt: 50, widthPt: 400, heightPt: 300 },
            ...ZERO_INSETS,
            blocks: [vectorDrawingBlock({ widthPt: 400, heightPt: 300 })],
          },
        ],
      },
    ]);
    const pkg = decodePackage(encodePackage(buildPptxPackage(content)));
    const [firstVector] = collectDrawingMlVectors(
      firstSlideRoot(pkg),
      "p:spPr",
    );
    const [firstFixture] = VECTOR_FIXTURE;
    if (firstVector?.kind !== "rect" || firstFixture?.kind !== "rect") {
      throw new Error("expected the fixture to start with a rect");
    }
    expect(firstVector.frame.xPt).toBeCloseTo(firstFixture.frame.xPt + 100, 6);
    expect(firstVector.frame.yPt).toBeCloseTo(firstFixture.frame.yPt + 50, 6);
    // Every p:sp on the slide is a vector shape: the containing ContentShape becomes the vectors themselves, never a wrapper text box of its own.
    const shapes = [...walkElements(firstSlideRoot(pkg).children)].filter(
      (cursor) => cursor.node.tag === "p:sp",
    );
    expect(shapes).toHaveLength(VECTOR_FIXTURE.length);
    expect(
      shapes.every((cursor) =>
        cursor.node.children.every(
          (child) => child.type !== "element" || child.tag !== "p:txBody",
        ),
      ),
    ).toBe(true);
  });

  // Pins the actual markup, not just this package's own oracle round-tripping against itself: the DrawingML reader in test-support is written alongside the writer, so at least one test has to assert the literal attribute values a real PowerPoint or LibreOffice would read.
  it("expresses each vector kind through its own real DrawingML geometry element", () => {
    const content = presentationDoc([
      {
        size: SLIDE_SIZE,
        notes: "",
        shapes: [
          {
            frame: { xPt: 0, yPt: 0, ...SLIDE_SIZE },
            ...ZERO_INSETS,
            blocks: [vectorDrawingBlock(SLIDE_SIZE)],
          },
        ],
      },
    ]);
    const pkg = decodePackage(encodePackage(buildPptxPackage(content)));
    const geometry = [...walkElements(firstSlideRoot(pkg).children)]
      .filter(
        (cursor) =>
          cursor.node.tag === "a:prstGeom" || cursor.node.tag === "a:custGeom",
      )
      .map((cursor) =>
        cursor.node.tag === "a:custGeom"
          ? "custGeom"
          : attr(cursor.node, "prst"),
      );
    expect(geometry).toEqual(["rect", "ellipse", "line", "custGeom", "rect"]);
    // The path's own subpath becomes real a:moveTo/a:cubicBezTo/a:lnTo/a:close commands, not a polygon approximation.
    const pathCommands = [...walkElements(firstSlideRoot(pkg).children)]
      .filter((cursor) => cursor.node.tag === "a:path")
      .flatMap((cursor) =>
        cursor.node.children
          .filter((child) => child.type === "element")
          .map((child) => child.tag),
      );
    expect(pathCommands).toEqual([
      "a:moveTo",
      "a:cubicBezTo",
      "a:lnTo",
      "a:close",
    ]);
    // The rotated rect carries a:xfrm/@rot in DrawingML's own 60,000ths of a degree.
    const rotations = [...walkElements(firstSlideRoot(pkg).children)]
      .filter((cursor) => cursor.node.tag === "a:xfrm")
      .map((cursor) => attr(cursor.node, "rot"));
    expect(rotations).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      "1800000",
    ]);
    // The line runs up and to the left, which DrawingML can only express as a flipped bounding-box diagonal.
    const lineXfrm = [...walkElements(firstSlideRoot(pkg).children)].filter(
      (cursor) => cursor.node.tag === "a:xfrm",
    )[2]!.node;
    expect(attr(lineXfrm, "flipH")).toBe("1");
    expect(attr(lineXfrm, "flipV")).toBe("1");
  });
});

describe("embeddedPresentationSerialiser", () => {
  it("round-trips a docx embedded presentation through ooxml.js's docx writer, the nested deck re-serialised by buildPptxPackage", () => {
    // The wiring half of #742's port: ooxml.js's docx writer accepts an injected presentation serialiser because it cannot depend on the one pptx builder in the ecosystem -- this package's own buildPptxPackage -- without inverting the family's layering. This value IS that wiring, so the proof has to be the whole loop: a presentation embed built into a docx through ooxml.js's writer with the serialiser injected, then re-read, with the deck's own content surviving.
    const deck = presentationDoc([
      {
        size: SLIDE_SIZE,
        notes: "",
        shapes: [
          {
            frame: { xPt: 10, yPt: 10, widthPt: 200, heightPt: 100 },
            ...ZERO_INSETS,
            blocks: [{ kind: "paragraph", runs: [{ text: "Embedded deck" }] }],
          },
        ],
      },
    ]);
    const block: ContentEmbeddedObjectBlock = {
      kind: "embeddedObject",
      objectKind: "presentation",
      document: deck,
      frame: { xPt: 0, yPt: 0, widthPt: 96, heightPt: 60 },
    };
    const pkg = buildDocxPackageFromContent(
      {
        sections: [
          {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
            blocks: [block],
          },
        ],
      },
      { serialiseEmbeddedPresentation: embeddedPresentationSerialiser },
    );

    const after = readDocxContent(pkg);
    // The w:object rides a run inside its own paragraph, so the reader lifts the embed as the sibling after that paragraph's own (run-text-empty) block.
    const embedded = after.sections[0]?.blocks[1];
    expect(embedded?.kind).toBe("embeddedObject");
    expect(
      embedded?.kind === "embeddedObject" ? embedded.objectKind : undefined,
    ).toBe("presentation");
    // The nested document is the genuinely decoded pptx the serialiser built, not an envelope: the deck's one slide and its text both survive.
    const slide =
      embedded?.kind === "embeddedObject" &&
      embedded.document.kind === "presentation"
        ? embedded.document.slides[0]
        : undefined;
    expect(slide?.shapes[0]?.blocks[0]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "Embedded deck" }],
    });
    // The payload really is a pptx built by this package's own builder: it re-reads through this package's own pptx reader too.
    const payloadPart = pkg.parts["word/embeddings/oleObject1.pptx"];
    expect(payloadPart?.kind).toBe("binary");
    const reread =
      payloadPart?.kind === "binary"
        ? readPptxContent(decodePackage(base64ToBytes(payloadPart.base64)))
        : undefined;
    expect(reread?.kind).toBe("presentation");
  });
});

// ContentTable's grid rule (ContentTableCell in document-schema.js): a row's `cells` holds one entry per grid column, so each entry's array index is its a:tc's own column, and the merge attributes follow from walkTableGrid's classification of the entries.
describe("buildPptxPackage: table merges follow the dense grid", () => {
  function textCell(
    text: string,
    extra: Partial<ContentTableCell> = {},
  ): ContentTableCell {
    return { blocks: [{ kind: "paragraph", runs: [{ text }] }], ...extra };
  }

  function builtCells(table: ContentTable): XmlElement[][] {
    const pkg = buildPptxPackage(
      presentationDoc([
        {
          size: SLIDE_SIZE,
          notes: "",
          shapes: [
            {
              frame: { xPt: 10, yPt: 10, widthPt: 300, heightPt: 100 },
              ...ZERO_INSETS,
              blocks: [table],
            },
          ],
        },
      ]),
    );
    return [...walkElements(firstSlideRoot(pkg).children)]
      .filter((cursor) => cursor.node.tag === "a:tr")
      .map((row) =>
        row.node.children.filter(
          (child): child is XmlElement =>
            child.type === "element" && child.tag === "a:tc",
        ),
      );
  }

  // The merge attributes an a:tc states, as one comparable string.
  function mergeAttributes(cell: XmlElement | undefined): string {
    if (cell === undefined) {
      throw new Error("expected an a:tc");
    }
    return ["gridSpan", "rowSpan", "hMerge", "vMerge"]
      .flatMap((name) => {
        const value = attr(cell, name);
        return value === undefined ? [] : [`${name}=${value}`];
      })
      .join(" ");
  }

  const empty: ContentTableCell = { blocks: [] };

  it("marks the position a horizontal merge covers hMerge and leaves its neighbours plain", () => {
    const cells = builtCells({
      kind: "table",
      columnWidthsPt: [100, 100, 100],
      rows: [
        { cells: [textCell("A", { colSpan: 2 }), empty, textCell("C")] },
        { cells: [textCell("D"), textCell("E"), textCell("F")] },
      ],
    });
    expect(cells[0]!.map(mergeAttributes)).toEqual([
      "gridSpan=2",
      "hMerge=1",
      "",
    ]);
    expect(cells[1]!.map(mergeAttributes)).toEqual(["", "", ""]);
  });

  it("marks the position a vertical merge covers in the rows below vMerge", () => {
    const cells = builtCells({
      kind: "table",
      columnWidthsPt: [100, 100],
      rows: [
        { cells: [textCell("A", { rowSpan: 3 }), textCell("B")] },
        { cells: [empty, textCell("D")] },
        { cells: [empty, textCell("F")] },
      ],
    });
    expect(cells.map((row) => mergeAttributes(row[0]))).toEqual([
      "rowSpan=3",
      "vMerge=1",
      "vMerge=1",
    ]);
    expect(cells.map((row) => mergeAttributes(row[1]))).toEqual(["", "", ""]);
  });

  it("marks a 2x2 merge's covered positions by the side of the region they lie on, the interior one on both", () => {
    const cells = builtCells({
      kind: "table",
      columnWidthsPt: [100, 100, 100],
      rows: [
        {
          cells: [
            textCell("A", { colSpan: 2, rowSpan: 2 }),
            empty,
            textCell("C"),
          ],
        },
        { cells: [empty, empty, textCell("F")] },
      ],
    });
    expect(cells[0]!.map(mergeAttributes)).toEqual([
      "gridSpan=2 rowSpan=2",
      "hMerge=1",
      "",
    ]);
    expect(cells[1]!.map(mergeAttributes)).toEqual([
      "vMerge=1",
      "hMerge=1 vMerge=1",
      "",
    ]);
  });

  it("writes a covered entry's own background and borders onto its a:tc", () => {
    const fill = { kind: "solid", color: { r: 1, g: 0, b: 0 } } as const;
    const borders = {
      left: { color: { r: 0, g: 0, b: 1 }, widthPt: 2 },
    } as const;
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [100, 100],
      rows: [
        {
          cells: [
            textCell("A", { colSpan: 2 }),
            { blocks: [], background: fill, borders },
          ],
        },
      ],
    };
    const covered = builtCells(table)[0]![1]!;
    const tcPr = covered.children.find(
      (child): child is XmlElement =>
        child.type === "element" && child.tag === "a:tcPr",
    );
    expect(tcPr).toBeDefined();
    const tcPrTags = tcPr!.children.flatMap((child) =>
      child.type === "element" ? [child.tag] : [],
    );
    expect(tcPrTags).toContain("a:solidFill");
    expect(tcPrTags).toContain("a:lnL");
  });

  it("reads a 2x2 merge back as one entry per grid column, the anchor carrying both spans", () => {
    const pkg = buildPptxPackage(
      presentationDoc([
        {
          size: SLIDE_SIZE,
          notes: "",
          shapes: [
            {
              frame: { xPt: 10, yPt: 10, widthPt: 300, heightPt: 100 },
              ...ZERO_INSETS,
              blocks: [
                {
                  kind: "table",
                  columnWidthsPt: [100, 100, 100],
                  rows: [
                    {
                      cells: [
                        textCell("A", { colSpan: 2, rowSpan: 2 }),
                        empty,
                        textCell("C"),
                      ],
                    },
                    { cells: [empty, empty, textCell("F")] },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    );
    const reread = readPptxContent(pkg);
    if (reread.kind !== "presentation") {
      throw new Error("expected a presentation ContentDocument");
    }
    const block = reread.slides[0]!.shapes[0]!.blocks[0];
    if (block?.kind !== "table") {
      throw new Error("expected a table block");
    }
    for (const row of block.rows) {
      expect(row.cells).toHaveLength(block.columnWidthsPt.length);
    }
    expect(block.rows[0]?.cells[0]).toMatchObject({ colSpan: 2, rowSpan: 2 });
    expect(
      walkTableGrid(block)
        .flat()
        .filter((position) => position.anchorRowIndex !== undefined)
        .map(
          (position) =>
            `${String(position.rowIndex)},${String(position.columnIndex)}`,
        ),
    ).toEqual(["0,1", "1,0", "1,1"]);
  });
});

describe("buildPptxPackage: a slide table breaking the grid rule", () => {
  it("refuses the table, naming the entry point and the fault, rather than dropping the covered content", () => {
    expect(() =>
      buildPptxPackage(
        presentationDoc([
          {
            size: { widthPt: 720, heightPt: 540 },
            notes: "",
            shapes: [
              {
                frame: { xPt: 36, yPt: 36, widthPt: 480, heightPt: 240 },
                ...ZERO_INSETS,
                blocks: [
                  {
                    kind: "table",
                    columnWidthsPt: [100, 100],
                    rows: [
                      {
                        cells: [
                          {
                            blocks: [
                              { kind: "paragraph", runs: [{ text: "anchor" }] },
                            ],
                            colSpan: 2,
                          },
                          {
                            blocks: [
                              { kind: "paragraph", runs: [{ text: "copy" }] },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ]),
      ),
    ).toThrow(
      "buildPptxPackage: table breaks the grid rule (the cell at row 0, column 1 lies inside the merged region anchored at row 0, column 0 but carries content of its own, and a merged region's content belongs to its anchor)",
    );
  });
});
