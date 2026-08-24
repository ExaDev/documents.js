import { describe, expect, it } from "vitest";
import type { ConstructDescriptor } from "./construct";
import type {
  ContentBlock,
  ContentDocument,
  ContentEmbeddedObject,
  ContentFormula,
  ContentSection,
  ContentShape,
  ContentSheetCell,
  ContentSheetImage,
  ContentSheetPrintSettings,
  ContentVector,
} from "./content";
import {
  ConstructMarkerImbalanceError,
  decompose,
  decomposeSection,
  decomposeSheet,
  isHeadingParagraph,
} from "./decompose";
import { flattenTree } from "./flatten";
import type { DocumentTree } from "./package";
import {
  isHeadingGroupNode,
  isListGroupNode,
  isSectionConstructGroupNode,
  type SheetGroupNode,
} from "./package-node";

// The bijection laws (bijection.test.ts) pin round-trip fidelity, not grouping semantics -- a degenerate decompose whose section groups carried flat, ungrouped children would satisfy every law just as well. These tests pin the TREE SHAPE itself: mandatory section groups, per-container stacks, the never-cross-a-shape-boundary rule, and the ownership discipline. Ported from document-outline.js's phase-1 decompose tests, adapted to schema 4 (decompose takes the flat ContentDocument; the envelope rides the package root).

const SECTION_GEOMETRY = {
  pageSize: { widthPt: 595, heightPt: 842 },
  margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
};

function run(text: string): { text: string } {
  return { text };
}

function paragraph(
  text: string,
  options: { headingLevel?: number; listLevel?: number } = {},
): ContentBlock {
  return {
    kind: "paragraph",
    runs: [run(text)],
    ...(options.headingLevel !== undefined
      ? { headingLevel: options.headingLevel }
      : {}),
    // numId omitted deliberately on list paragraphs: schema 4.0.0 made it optional, and OOXML drawing paragraphs carry only a level -- the exact slide-body shape the presentation decomposition nests by.
    ...(options.listLevel !== undefined
      ? { list: { level: options.listLevel } }
      : {}),
  };
}

function table(text: string): ContentBlock {
  return {
    kind: "table",
    rows: [{ cells: [{ blocks: [paragraph(text)] }] }],
    columnWidthsPt: [80],
  };
}

function constructStart(descriptor: ConstructDescriptor): ContentBlock {
  return { kind: "constructStart", descriptor };
}

const CONSTRUCT_END: ContentBlock = { kind: "constructEnd" };

function wordprocessingDoc(
  blocksPerSection: ContentBlock[][],
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

function shape(blocks: ContentBlock[]): ContentShape {
  return {
    frame: { xPt: 0, yPt: 0, widthPt: 600, heightPt: 400 },
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks,
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
    // A present-but-empty embeddedObjects array round-trips to the field ABSENT: decompose concatenated images and embedded objects into one children array, so a declared-empty field is indistinguishable from an absent one -- the bijection's one declared normalisation, pinned here in its stripping direction. (images rebuilds as the always-present empty array because the flat form requires it.)
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

  it("refuses a style ref on a sheet group loudly -- a sheet holds no block flow to resolve it onto", () => {
    // The schema permits style on every group node, but the spreadsheet arm builds no resolution chain (a sheet's children are images and embedded objects, not paragraphs), so a ref there could only be passed by silently -- losing the styled content with no signal. The refusal mirrors entryOf's missing-table rule: resolution runs completely or not at all. Minting never stamps such a ref (a sheet group's extent is always empty); this guard is for hand-built trees.
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

// document-schema.js 4.1.0 added SectionConstructGroupNode/ShapeConstructGroupNode (docx SDTs, ODF fields, tracked changes, and the rest of document-schema.js#22's fidelity-construct vocabulary) to the tree; 4.2.0 gave ContentBlock the matching flat carrier, the constructStart/constructEnd marker pair, so the boundary is now a promotion like every other grouping signal rather than a shape only a hand-built tree could hold. These tests pin the promotion's SHAPE -- which scope a construct attaches at, what its interior groups by, and what the outer stacks do while it is open. Round-trip fidelity itself is the bijection suite's job (bijection.test.ts carries the construct corpus entries).
describe("construct-boundary promotion", () => {
  it("promotes a marker pair into one group whose children are the delimited region decomposed on its own", () => {
    const insideHeading = paragraph("inside", { headingLevel: 1 });
    const doc = wordprocessingDoc([
      [
        paragraph("before"),
        constructStart({ kind: "field", instruction: "PAGE" }),
        insideHeading,
        paragraph("inside body"),
        CONSTRUCT_END,
        paragraph("after"),
      ],
    ]);
    expect(decompose(doc)).toEqual([
      {
        node: {
          kind: "section",
          pageSize: SECTION_GEOMETRY.pageSize,
          margins: SECTION_GEOMETRY.margins,
        },
        children: [
          paragraph("before"),
          // The construct's interior walks with FRESH heading/list stacks, so its own H1 groups inside it...
          {
            node: { kind: "field", instruction: "PAGE" },
            children: [
              { node: insideHeading, children: [paragraph("inside body")] },
            ],
          },
          // ...and closes with the region: `after` lands back at the section root rather than under the H1 the construct opened, which is what "the outer stacks are undisturbed" means in the one direction a leak would be invisible in the flat form.
          paragraph("after"),
        ],
      },
    ]);
  });

  it("leaves the enclosing heading and list stacks exactly where they were", () => {
    const h1 = paragraph("Chapter", { headingLevel: 1 });
    const first = paragraph("A", { listLevel: 0 });
    const second = paragraph("B", { listLevel: 1 });
    const doc = wordprocessingDoc([
      [
        h1,
        first,
        constructStart({ kind: "anchor", anchorType: "bookmark", name: "b1" }),
        paragraph("inside"),
        CONSTRUCT_END,
        second,
      ],
    ]);
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
              {
                node: first,
                // B still nests under A across the intervening construct: stepping through a region neither pops the list stack (as a plain paragraph would) nor the heading stack.
                children: [
                  {
                    node: {
                      kind: "anchor",
                      anchorType: "bookmark",
                      name: "b1",
                    },
                    children: [paragraph("inside")],
                  },
                  { node: second, children: [] },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("groups a construct inside a list item by list level alone -- the list-flow vocabulary its position admits", () => {
    // A list group's children are ListChild, which admits a ShapeConstructGroupNode and no heading group at all, so a heading paragraph inside a construct inside a list is ordinary content -- exactly what it already is anywhere else in a list group's subtree. The section-root case above shows the other half: there the position is SectionChild, so the same marker pair promotes to a SectionConstructGroupNode whose interior does group headings.
    const item = paragraph("A", { listLevel: 0 });
    const headingInside = paragraph(
      "a heading-styled paragraph is an ordinary leaf here",
      { headingLevel: 2 },
    );
    const doc = wordprocessingDoc([
      [
        item,
        constructStart({ kind: "contentControl", controlType: "richText" }),
        headingInside,
        CONSTRUCT_END,
      ],
    ]);
    expect(decompose(doc)).toEqual([
      {
        node: {
          kind: "section",
          pageSize: SECTION_GEOMETRY.pageSize,
          margins: SECTION_GEOMETRY.margins,
        },
        children: [
          {
            node: item,
            children: [
              {
                node: { kind: "contentControl", controlType: "richText" },
                children: [headingInside],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("nests constructs of different kinds to arbitrary depth, and admits an empty region", () => {
    const doc = wordprocessingDoc([
      [
        constructStart({
          kind: "provenance",
          change: "insertion",
          author: "A",
        }),
        constructStart({
          kind: "link",
          target: { kind: "external", uri: "https://example.invalid/" },
        }),
        paragraph("deep"),
        CONSTRUCT_END,
        constructStart({ kind: "division", name: "empty" }),
        CONSTRUCT_END,
        CONSTRUCT_END,
      ],
    ]);
    expect(decompose(doc)).toEqual([
      {
        node: {
          kind: "section",
          pageSize: SECTION_GEOMETRY.pageSize,
          margins: SECTION_GEOMETRY.margins,
        },
        children: [
          {
            node: { kind: "provenance", change: "insertion", author: "A" },
            children: [
              {
                node: {
                  kind: "link",
                  target: { kind: "external", uri: "https://example.invalid/" },
                },
                children: [paragraph("deep")],
              },
              // An open marker immediately followed by its close is a real, schema-legal region with no content: it promotes to a group with no children rather than collapsing to nothing, so flatten reproduces the pair.
              { node: { kind: "division", name: "empty" }, children: [] },
            ],
          },
        ],
      },
    ]);
  });

  it("promotes a construct in a shape flow the same way, on the shape vocabulary", () => {
    const inner = shape([
      constructStart({ kind: "field", instruction: "PAGE" }),
      paragraph("in a shape"),
      CONSTRUCT_END,
    ]);
    const doc: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [
        { size: { widthPt: 960, heightPt: 540 }, shapes: [inner], notes: "" },
      ],
    };
    expect(decompose(doc)).toEqual([
      {
        node: {
          kind: "slide",
          size: { widthPt: 960, heightPt: 540 },
          notes: "",
        },
        children: [
          {
            node: {
              frame: inner.frame,
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
            },
            children: [
              {
                node: { kind: "field", instruction: "PAGE" },
                children: [paragraph("in a shape")],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("embeds the source descriptor object itself, and rebuilds the marker pair around it on the way back", () => {
    // The ownership discipline, at the one node it cannot hold verbatim: TreeBlockLeaf excludes both marker kinds, so the tree keeps the descriptor (the same object, by identity) while the marker wrapper is reconstructed by flatten. A consumer holding both views still sees one descriptor.
    const descriptor: ConstructDescriptor = {
      kind: "field",
      instruction: "PAGE",
    };
    const start: ContentBlock = { kind: "constructStart", descriptor };
    const source: ContentSection = {
      ...SECTION_GEOMETRY,
      blocks: [start, paragraph("inside"), CONSTRUCT_END],
    };
    const group = decomposeSection(source);
    const [constructGroup] = group.children;
    if (
      constructGroup === undefined ||
      !isSectionConstructGroupNode(constructGroup)
    ) {
      throw new Error(
        "expected the marker pair to promote to a construct group",
      );
    }
    expect(constructGroup.node).toBe(descriptor);
    const flat = flattenTree({
      kind: "wordprocessing",
      metadata: {},
      children: [group],
    });
    if (flat.kind !== "wordprocessing")
      throw new Error("expected a wordprocessing document back");
    const section = flat.sections[0];
    if (section === undefined) throw new Error("expected one section back");
    expect(section.blocks).toEqual([start, paragraph("inside"), CONSTRUCT_END]);
    const [rebuiltStart] = section.blocks;
    if (rebuiltStart?.kind !== "constructStart")
      throw new Error("expected the open marker back first");
    expect(rebuiltStart.descriptor).toBe(descriptor);
    expect(rebuiltStart).not.toBe(start);
  });
});

// Promotion is defined only over a balanced marker stream, so an unbalanced one is refused outright rather than repaired into a plausible tree -- the same "fail loudly, never silently skip" rule the sheet-group style-ref guard above follows. The thrown error carries document-schema.js's own ConstructMarkerImbalance payload, so a caller gets the offending block index without parsing a message.
describe("construct marker imbalance", () => {
  it("refuses a close marker that closes no open construct", () => {
    const doc = wordprocessingDoc([[paragraph("before"), CONSTRUCT_END]]);
    expect(() => decompose(doc)).toThrow(ConstructMarkerImbalanceError);
    try {
      decompose(doc);
    } catch (error) {
      if (!(error instanceof ConstructMarkerImbalanceError)) throw error;
      expect(error.imbalance).toEqual({ kind: "unmatchedEnd", index: 1 });
    }
  });

  it("refuses a block stream that ends with a construct still open", () => {
    const doc = wordprocessingDoc([
      [
        constructStart({ kind: "field", instruction: "PAGE" }),
        paragraph("inside"),
      ],
    ]);
    expect(() => decompose(doc)).toThrow(ConstructMarkerImbalanceError);
    try {
      decompose(doc);
    } catch (error) {
      if (!(error instanceof ConstructMarkerImbalanceError)) throw error;
      expect(error.imbalance).toEqual({ kind: "unclosedStart", index: 0 });
    }
  });

  it("refuses an unbalanced shape flow too -- the check runs per container block stream, not per document", () => {
    const doc: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [
        {
          size: { widthPt: 960, heightPt: 540 },
          shapes: [shape([CONSTRUCT_END])],
          notes: "",
        },
      ],
    };
    expect(() => decompose(doc)).toThrow(ConstructMarkerImbalanceError);
  });
});

describe("drawing and formula decomposition", () => {
  it("orders a draw page's children shapes-then-vectors and nests each shape's flow inside it", () => {
    const vector: ContentVector = {
      kind: "rect",
      frame: { xPt: 1, yPt: 2, widthPt: 3, heightPt: 4 },
    };
    const labelled = shape([paragraph("label")]);
    const doc: ContentDocument = {
      kind: "drawing",
      metadata: {},
      pages: [
        {
          size: { widthPt: 300, heightPt: 300 },
          shapes: [labelled],
          vectors: [vector],
        },
      ],
    };
    expect(decompose(doc)).toEqual([
      {
        node: { kind: "drawPage", size: { widthPt: 300, heightPt: 300 } },
        children: [
          {
            node: {
              frame: labelled.frame,
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
            },
            children: [paragraph("label")],
          },
          vector,
        ],
      },
    ]);
  });

  it("decomposes a formula document to its single ContentFormula leaf", () => {
    const formula: ContentFormula = {
      mathml: [{ type: "text", value: "x" }],
      starMath: "x",
    };
    const doc: ContentDocument = { kind: "formula", metadata: {}, formula };
    expect(decompose(doc)).toEqual([formula]);
  });
});

// The ownership rule as a positive identity check: decompose embeds the document's own objects (leaves are the same references, never copies), and flatten emits those same objects back into block flow. The bijection laws deliberately never use toBe; this one deliberately does, because sharing IS the contract being pinned -- a consumer holding both views sees an edit through either.
describe("ownership", () => {
  it("embeds the source nodes themselves, not copies", () => {
    const heading = paragraph("Chapter", { headingLevel: 1 });
    const body = paragraph("body");
    const source: ContentSection = {
      ...SECTION_GEOMETRY,
      blocks: [heading, body],
    };
    const sectionGroup = decomposeSection(source);
    const [headingGroup] = sectionGroup.children;
    // A plain 'node'/'children' presence check no longer narrows out every non-anchor shape: since document-schema.js 4.1.0, a SectionConstructGroupNode carries both too. isHeadingGroupNode/isListGroupNode are the real schema guards, so reaching for them here (rather than reinventing the anchor-vs-construct narrow this test doesn't need to know about) both fixes the narrowing and states the assertion's actual intent.
    if (
      headingGroup === undefined ||
      !(isHeadingGroupNode(headingGroup) || isListGroupNode(headingGroup))
    ) {
      throw new Error(
        "expected the heading paragraph to open the section flow",
      );
    }
    expect(headingGroup.node).toBe(heading);
    expect(isHeadingParagraph(headingGroup.node)).toBe(true);
    const pkg: DocumentTree = {
      kind: "wordprocessing",
      metadata: {},
      children: [sectionGroup],
    };
    const flat = flattenTree(pkg);
    if (flat.kind !== "wordprocessing")
      throw new Error("expected a wordprocessing document back");
    const [section] = flat.sections;
    if (section === undefined) throw new Error("expected one section back");
    const [firstBlock, secondBlock] = section.blocks;
    expect(firstBlock).toBe(heading);
    expect(secondBlock).toBe(body);
  });
});
