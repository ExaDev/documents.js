import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentDocument,
  ContentEmbeddedObject,
} from "./content";
import type {
  ContentSheetCell,
  ContentSheetImage,
  ContentSheetPrintSettings,
} from "./content-sheet";
import type { ContentShape } from "./content-drawing";

import { decompose, decomposeSheet } from "./decompose";
import { flattenTree } from "./flatten";
import { isSlideGroupNode, type SheetGroupNode } from "./package-node";

// The bijection laws (bijection.test.ts) pin round-trip fidelity, not grouping semantics — a degenerate decompose whose section groups carried flat, ungrouped children would satisfy every law just as well. These tests pin the TREE SHAPE itself: mandatory section groups, per-container stacks, the never-cross-a-shape-boundary rule, and the ownership discipline. Ported from document-outline.js's phase-1 decompose tests, adapted to schema 4 (decompose takes the flat ContentDocument; the envelope rides the package root).

const SECTION_GEOMETRY = {
  pageSize: { widthPt: 595, heightPt: 842 },
  margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
};

function run(text: string): { text: string } {
  return { text };
}

function paragraph(
  text: string,
  options: Readonly<{ headingLevel?: number; listLevel?: number }> = {},
): ContentBlock {
  return {
    kind: "paragraph",
    runs: [run(text)],
    ...(options.headingLevel !== undefined
      ? { headingLevel: options.headingLevel }
      : {}),
    // numId omitted deliberately on list paragraphs: schema 4.0.0 made it optional, and OOXML drawing paragraphs carry only a level — the exact slide-body shape the presentation decomposition nests by.
    ...(options.listLevel !== undefined
      ? { list: { level: options.listLevel } }
      : {}),
  };
}

function table(text: string): ContentBlock {
  return {
    kind: "table",
    rows: [{ cells: [{ blocks: [paragraph(text)] }] }],
    columns: [{ widthPt: 80 }],
  };
}

function wordprocessingDoc(
  blocksPerSection: readonly ContentBlock[][],
): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: blocksPerSection.map((blocks) => ({
      ...SECTION_GEOMETRY,
      blocks,
    })),
  };
}

function shape(blocks: readonly ContentBlock[]): ContentShape {
  return {
    frame: { xPt: 0, yPt: 0, widthPt: 600, heightPt: 400 },
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks: [...blocks],
  };
}

describe("wordprocessing decomposition", () => {
  it("makes one section group per section, carrying the section geometry on the descriptor", () => {
    const doc = wordprocessingDoc([
      [paragraph("first")],
      [paragraph("second")],
    ]);
    expect(decompose(doc)).toEqual([
      {
        node: {
          kind: "section",
          pageSize: SECTION_GEOMETRY.pageSize,
          margins: SECTION_GEOMETRY.margins,
        },
        children: [paragraph("first")],
      },
      {
        node: {
          kind: "section",
          pageSize: SECTION_GEOMETRY.pageSize,
          margins: SECTION_GEOMETRY.margins,
        },
        children: [paragraph("second")],
      },
    ]);
  });

  it("resets the heading stack at each section boundary instead of flowing sections into one tree", () => {
    const doc = wordprocessingDoc([
      [
        paragraph("Chapter", { headingLevel: 1 }),
        paragraph("section one body"),
      ],
      [paragraph("Method", { headingLevel: 2 }), paragraph("section two body")],
    ]);
    const [first, second] = decompose(doc);
    // An H2 directly at a section root is the observable difference from a table-of-contents tree, where the same H2 would nest under the still-open H1 of the previous section: decompose groups per container, so each section starts with an empty stack.
    expect(second).toEqual({
      node: {
        kind: "section",
        pageSize: SECTION_GEOMETRY.pageSize,
        margins: SECTION_GEOMETRY.margins,
      },
      children: [
        {
          node: paragraph("Method", { headingLevel: 2 }),
          children: [paragraph("section two body")],
        },
      ],
    });
    expect(first).toEqual({
      node: {
        kind: "section",
        pageSize: SECTION_GEOMETRY.pageSize,
        margins: SECTION_GEOMETRY.margins,
      },
      children: [
        {
          node: paragraph("Chapter", { headingLevel: 1 }),
          children: [paragraph("section one body")],
        },
      ],
    });
  });

  it("nests headings, lists, and leaves with the stack semantics", () => {
    const h1 = paragraph("Chapter", { headingLevel: 1 });
    const a = paragraph("A", { listLevel: 0 });
    const b = paragraph("B", { listLevel: 1 });
    const plain = paragraph("plain closes the list");
    const cells = table("x");
    const img: ContentBlock = {
      kind: "image",
      format: "png",
      base64: "aW1hZ2U=",
      widthPt: 100,
      heightPt: 60,
    };
    const h4 = paragraph("Deep", { headingLevel: 4 });
    const doc = wordprocessingDoc([[h1, a, b, cells, plain, img, h4]]);
    expect(decompose(doc)).toEqual([
      {
        node: {
          kind: "section",
          pageSize: SECTION_GEOMETRY.pageSize,
          margins: SECTION_GEOMETRY.margins,
        },
        children: [
          {
            node: h1,
            children: [
              { node: a, children: [{ node: b, children: [cells] }] },
              plain,
              img,
              // An H4 with no open heading shallower than 4 attaches flat under the heading scope (its own group with the H1 still open above it), the builder's pop rule verbatim.
              { node: h4, children: [] },
            ],
          },
        ],
      },
    ]);
  });

  it("pops a single open heading of equal level — two consecutive H1s are siblings, not nested", () => {
    // With exactly one heading on the stack when the second H1 arrives, the pop loop must read that one entry (stack top, not stack[1] — an empty read past a single-element stack would never enter the loop at all, leaving the first H1 wrongly still open).
    const h1a = paragraph("First", { headingLevel: 1 });
    const h1b = paragraph("Second", { headingLevel: 1 });
    const doc = wordprocessingDoc([[h1a, h1b]]);
    expect(decompose(doc)).toEqual([
      {
        node: { kind: "section", ...SECTION_GEOMETRY },
        children: [
          { node: h1a, children: [] },
          { node: h1b, children: [] },
        ],
      },
    ]);
  });

  it("pops two open headings in a row — the pop loop's own re-check (not just its first read) must see the stack shrink to one element and keep popping", () => {
    // H1 -> H2 (nested under it) -> H1: the second H1 must pop BOTH the H2 and the first H1, ending as a sibling of the first H1 at the section root. After the loop's first pop (H2 gone, stack now [h1a], length 1), the loop's own re-check re-reads the stack top — a wrong index there (reading position 1 of a 1-element array) would see undefined and stop after only one pop, wrongly leaving the new H1 nested under the first one instead of a sibling of it.
    const h1a = paragraph("First", { headingLevel: 1 });
    const h2 = paragraph("Nested", { headingLevel: 2 });
    const h1b = paragraph("Second", { headingLevel: 1 });
    const doc = wordprocessingDoc([[h1a, h2, h1b]]);
    expect(decompose(doc)).toEqual([
      {
        node: { kind: "section", ...SECTION_GEOMETRY },
        children: [
          { node: h1a, children: [{ node: h2, children: [] }] },
          { node: h1b, children: [] },
        ],
      },
    ]);
  });

  it("pops a single open list item of equal level — two consecutive same-level items are siblings, not nested", () => {
    const first = paragraph("First item", { listLevel: 0 });
    const second = paragraph("Second item", { listLevel: 0 });
    const doc = wordprocessingDoc([[first, second]]);
    expect(decompose(doc)).toEqual([
      {
        node: { kind: "section", ...SECTION_GEOMETRY },
        children: [
          { node: first, children: [] },
          { node: second, children: [] },
        ],
      },
    ]);
  });

  it("pops two open list items in a row — the pop loop's own re-check must see the stack shrink to one element and keep popping", () => {
    // level0 -> level1 (nested) -> level0: the same multi-pop boundary as the heading test above, on the list stack this time.
    const first = paragraph("First", { listLevel: 0 });
    const nested = paragraph("Nested", { listLevel: 1 });
    const second = paragraph("Second", { listLevel: 0 });
    const doc = wordprocessingDoc([[first, nested, second]]);
    expect(decompose(doc)).toEqual([
      {
        node: { kind: "section", ...SECTION_GEOMETRY },
        children: [
          { node: first, children: [{ node: nested, children: [] }] },
          { node: second, children: [] },
        ],
      },
    ]);
  });

  it("attaches a non-paragraph leaf inside a single open list item's own children, not at the section root", () => {
    // Exactly one list item open (stack length 1) when the leaf is encountered — the same single-element-stack boundary the heading/list pop loops above are pinned against, this time for the plain top-of-stack read walkSectionBlocks uses to route a non-paragraph leaf.
    const item = paragraph("Item", { listLevel: 0 });
    const img: ContentBlock = {
      kind: "image",
      format: "png",
      base64: "aW1hZ2U=",
      widthPt: 10,
      heightPt: 10,
    };
    const doc = wordprocessingDoc([[item, img]]);
    expect(decompose(doc)).toEqual([
      {
        node: { kind: "section", ...SECTION_GEOMETRY },
        children: [{ node: item, children: [img] }],
      },
    ]);
  });

  it("decomposes an empty document to an empty root array (the envelope carries the kind)", () => {
    expect(
      decompose({ kind: "wordprocessing", metadata: {}, sections: [] }),
    ).toEqual([]);
    expect(
      flattenTree({ kind: "wordprocessing", metadata: {}, children: [] }),
    ).toEqual({ kind: "wordprocessing", metadata: {}, sections: [] });
  });
});

describe("presentation decomposition", () => {
  it("attaches a non-paragraph leaf inside a shape's own single open list item, not at the shape root", () => {
    // The shape-flow analogue of the identical section-flow boundary test above: exactly one list item open on the shape's own list stack when the leaf is encountered.
    const item = paragraph("Item", { listLevel: 0 });
    const img: ContentBlock = {
      kind: "image",
      format: "png",
      base64: "aW1hZ2U=",
      widthPt: 10,
      heightPt: 10,
    };
    const doc: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [
        {
          size: { widthPt: 960, heightPt: 540 },
          shapes: [shape([item, img])],
          notes: "",
        },
      ],
    };
    const [slideGroup] = decompose(doc);
    if (
      slideGroup === undefined ||
      !isSlideGroupNode(slideGroup) ||
      slideGroup.children.length !== 1
    )
      throw new Error("expected one shape group back");
    const [shapeGroup] = slideGroup.children;
    expect(shapeGroup?.children).toEqual([{ node: item, children: [img] }]);
  });

  it("groups each shape separately and never flattens a slide across its shapes", () => {
    const shapeA = shape([
      paragraph("A top", { listLevel: 0 }),
      paragraph("A nested", { listLevel: 1 }),
    ]);
    const headingInShape = paragraph(
      "a heading-styled paragraph is an ordinary leaf here",
      { headingLevel: 2 },
    );
    const shapeB = shape([paragraph("B plain"), headingInShape]);
    const doc: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [
        {
          size: { widthPt: 960, heightPt: 540 },
          shapes: [shapeA, shapeB],
          notes: "notes ride the descriptor",
        },
      ],
    };
    expect(decompose(doc)).toEqual([
      {
        node: {
          kind: "slide",
          size: { widthPt: 960, heightPt: 540 },
          notes: "notes ride the descriptor",
        },
        children: [
          {
            node: {
              frame: shapeA.frame,
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
            },
            children: [
              {
                node: paragraph("A top", { listLevel: 0 }),
                children: [
                  {
                    node: paragraph("A nested", { listLevel: 1 }),
                    children: [],
                  },
                ],
              },
            ],
          },
          // headingLevel inside a shape is deliberately present and deliberately not a grouping signal: shapes carry list nesting only, so the paragraph stays a bare leaf carrying the field.
          {
            node: {
              frame: shapeB.frame,
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
            },
            children: [paragraph("B plain"), headingInShape],
          },
        ],
      },
    ]);
  });
});

describe("spreadsheet decomposition", () => {
  it("rides the grid on the sheet node and carries images then embedded objects as children", () => {
    const printSettings: ContentSheetPrintSettings = {
      pageSize: { widthPt: 595, heightPt: 842 },
      margins: { topPt: 20, rightPt: 20, bottomPt: 20, leftPt: 20 },
      gridlines: true,
      headers: true,
      pageOrder: "downThenOver",
    };
    const cell: ContentSheetCell = {
      row: 0,
      column: 0,
      value: { kind: "number", value: 1 },
      displayText: "1",
    };
    const image: ContentSheetImage = {
      kind: "image",
      format: "png",
      base64: "aW1hZ2U=",
      widthPt: 10,
      heightPt: 10,
      anchorRow: 0,
      anchorColumn: 0,
      offsetXPt: 0,
      offsetYPt: 0,
    };
    const embedded: ContentEmbeddedObject = {
      objectKind: "drawing",
      document: { kind: "drawing", metadata: {}, pages: [] },
      frame: { xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 },
    };
    const emptyGrid = {
      cells: [],
      columns: [],
      rows: [],
      images: [],
      printSettings,
    };
    const doc: ContentDocument = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Data",
          cells: [cell],
          columns: [{ index: 0, widthPt: 60 }],
          rows: [{ index: 0, heightPt: 12 }],
          images: [image],
          printSettings,
        },
        { name: "Model", ...emptyGrid, embeddedObjects: [embedded] },
        { name: "Declared empty", ...emptyGrid, embeddedObjects: [] },
      ],
    };
    expect(decompose(doc)).toEqual([
      {
        // The descriptor carries the grid (cells/columns/rows/printSettings) minus the two arrays whose members became children.
        node: {
          kind: "sheet",
          name: "Data",
          cells: [cell],
          columns: [{ index: 0, widthPt: 60 }],
          rows: [{ index: 0, heightPt: 12 }],
          printSettings,
        },
        children: [image],
      },
      {
        node: {
          kind: "sheet",
          name: "Model",
          cells: [],
          columns: [],
          rows: [],
          printSettings,
        },
        children: [embedded],
      },
      {
        node: {
          kind: "sheet",
          name: "Declared empty",
          cells: [],
          columns: [],
          rows: [],
          printSettings,
        },
        children: [],
      },
    ]);
    // A present-but-empty embeddedObjects array round-trips to the field ABSENT: decompose concatenated images and embedded objects into one children array, so a declared-empty field is indistinguishable from an absent one — the bijection's one declared normalisation, pinned here in its stripping direction. (images rebuilds as the always-present empty array because the flat form requires it.)
    const flat = flattenTree({
      kind: "spreadsheet",
      metadata: {},
      children: doc.sheets.map(decomposeSheet),
    });
    expect(flat.kind).toBe("spreadsheet");
    if (flat.kind !== "spreadsheet")
      throw new Error("expected a spreadsheet document");
    expect(flat.sheets[2]).not.toHaveProperty("embeddedObjects");
    expect(flat.sheets[1]).toHaveProperty("embeddedObjects");
    expect(flat.sheets[2]).toHaveProperty("images");
  });

  it("refuses a style ref on a sheet group loudly — a sheet holds no block flow to resolve it onto", () => {
    // The schema permits style on every group node, but the spreadsheet arm builds no resolution chain (a sheet's children are images and embedded objects, not paragraphs), so a ref there could only be passed by silently — losing the styled content with no signal. The refusal mirrors entryOf's missing-table rule: resolution runs completely or not at all. Minting never stamps such a ref (a sheet group's extent is always empty); this guard is for hand-built trees.
    const sheet: SheetGroupNode = {
      node: {
        kind: "sheet",
        name: "Data",
        cells: [],
        columns: [],
        rows: [],
        printSettings: {
          pageSize: { widthPt: 595, heightPt: 842 },
          margins: { topPt: 20, rightPt: 20, bottomPt: 20, leftPt: 20 },
          gridlines: true,
          headers: true,
          pageOrder: "downThenOver",
        },
      },
      children: [],
      style: "s1",
    };
    expect(() =>
      flattenTree({ kind: "spreadsheet", metadata: {}, children: [sheet] }),
    ).toThrow(/no block flow/);
  });
});

// document-schema.js 4.1.0 added SectionConstructGroupNode/ShapeConstructGroupNode (docx SDTs, ODF fields, tracked changes, and the rest of document-schema.js#22's fidelity-construct vocabulary) to the tree; 4.2.0 gave ContentBlock the matching flat carrier, the constructStart/constructEnd marker pair, so the boundary is now a promotion like every other grouping signal rather than a shape only a hand-built tree could hold. These tests pin the promotion's SHAPE — which scope a construct attaches at, what its interior groups by, and what the outer stacks do while it is open. Round-trip fidelity itself is the bijection suite's job (bijection.test.ts carries the construct corpus entries).
