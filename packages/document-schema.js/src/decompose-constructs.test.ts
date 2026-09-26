import { describe, expect, it } from "vitest";
import type { ConstructDescriptor } from "./construct";
import type {
  ContentBlock,
  ContentDocument,
  ContentFormula,
  ContentSection,
} from "./content";
import type {} from "./content-sheet";
import type { ContentShape, ContentVector } from "./content-drawing";

import {
  ConstructMarkerImbalanceError,
  assertNeverContentDocumentKind,
  decompose,
  decomposeSection,
  isHeadingParagraph,
} from "./decompose";
import { flattenTree } from "./flatten";
import type { DocumentTree } from "./package";
import {
  isHeadingGroupNode,
  isListGroupNode,
  isSectionConstructGroupNode,
} from "./package-node";

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

function constructStart(descriptor: ConstructDescriptor): ContentBlock {
  return { kind: "constructStart", descriptor };
}

const CONSTRUCT_END: ContentBlock = { kind: "constructEnd" };

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

  it("leaves the enclosing heading stack where it was, but closes the list stack the same way a plain paragraph would (ExaDev/document-schema.js#1022)", () => {
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
            // A no longer holds the construct, and B no longer nests under A: constructStart closed the list stack before the bookmark group attached, so the bookmark group and B both land as H1's own direct children — B reopens its own list nesting from scratch, which is exactly why its own listLevel of 1 does not nest it under anything here (there is nothing shallower still open to nest under). Document order survives regardless, which is what flatten actually depends on.
            children: [
              { node: first, children: [] },
              {
                node: { kind: "anchor", anchorType: "bookmark", name: "b1" },
                children: [paragraph("inside")],
              },
              { node: second, children: [] },
            ],
          },
        ],
      },
    ]);
  });

  it("attaches a construct at the tail of a list beside the item it follows, not nested inside it (ExaDev/document-schema.js#1022)", () => {
    // Nothing follows the construct's own close marker to signal the list continues — the same shape epub-codec's own footnote-after-list reproduction in #1022 hit — so constructStart closes the list scope first, exactly like a plain paragraph would, and the group promotes as a SectionConstructGroupNode (headings admitted in its own interior) rather than the list-flow ShapeConstructGroupNode a genuinely-nested construct gets. headingInside's own headingLevel is therefore a real heading group here, not ordinary content the way it would be inside a list item's own subtree.
    const item = paragraph("A", { listLevel: 0 });
    const headingInside = paragraph(
      "a heading-styled paragraph groups here, since this construct's interior is section flow, not list flow",
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
          { node: item, children: [] },
          {
            node: { kind: "contentControl", controlType: "richText" },
            children: [{ node: headingInside, children: [] }],
          },
        ],
      },
    ]);
  });

  it("attaches a footnote's own out-of-flow body at the section root rather than inside the list item its reference sat in (ExaDev/document-schema.js#1022's own repro)", () => {
    // epub-codec's writeList/writeSectionChildren hit exactly this shape: a footnote reference rides the list item's own paragraph as a run-level construct extent (ContentParagraph.constructs, unrelated to the block-level marker pair below and never touched by list-stack handling), while the footnote's own body is a SEPARATE, later, block-level constructStart/constructEnd region — a ranged anchor, not the point anchor a bare reference would be. Before the fix, that body promoted as a child of the list item purely because nothing between the item and the constructStart had popped the list stack; the item's own paragraph carrying a run-level extent already proves the two mechanisms are independent; the item never carried a block-level marker of its own.
    const item = paragraph("before", { listLevel: 0 });
    const itemWithReference: ContentBlock = {
      kind: "paragraph",
      runs: [],
      constructs: [
        {
          descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
          startRun: 0,
          endRun: 0,
        },
      ],
      list: { level: 0 },
    };
    const noteBody = paragraph("Note body.");
    const doc = wordprocessingDoc([
      [
        item,
        itemWithReference,
        constructStart({ kind: "anchor", anchorType: "footnote", name: "fn1" }),
        noteBody,
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
          { node: item, children: [] },
          { node: itemWithReference, children: [] },
          {
            node: { kind: "anchor", anchorType: "footnote", name: "fn1" },
            children: [noteBody],
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

  it("groups a heading shallower than the outer scope, opened inside the extent and never closed inside it, against nothing but the extent's own interior (ExaDev/documents.js#1122)", () => {
    // The crossing case content.ts's own BALANCE comment names directly: an H2 is open outside when the pair starts, an H1 — shallower than the H2 — opens inside the extent and is still the innermost open heading when constructEnd is reached. Under a hoisting reading, that H1 would pop the H2 scope and "content after" would nest under the H1 instead; decompose's actual, deliberate resolution leaves the outer H2 stack undisturbed by anything inside the extent, in both directions, so "content after" lands back under H2 exactly where a plain paragraph following the construct would.
    const h2 = paragraph("Section A", { headingLevel: 2 });
    const h1 = paragraph("New top", { headingLevel: 1 });
    const source: ContentSection = {
      ...SECTION_GEOMETRY,
      blocks: [
        h2,
        paragraph("content A"),
        constructStart({ kind: "division" }),
        h1,
        paragraph("content in H1"),
        CONSTRUCT_END,
        paragraph("content after"),
      ],
    };
    const group = decomposeSection(source);
    expect(group).toEqual({
      node: {
        kind: "section",
        pageSize: SECTION_GEOMETRY.pageSize,
        margins: SECTION_GEOMETRY.margins,
      },
      children: [
        {
          node: h2,
          children: [
            paragraph("content A"),
            {
              node: { kind: "division" },
              children: [{ node: h1, children: [paragraph("content in H1")] }],
            },
            paragraph("content after"),
          ],
        },
      ],
    });
    // The tree shape above is only half the claim — flatten's own reconstruction is the other half, since headingLevel rides each anchor paragraph directly rather than being inferred from tree depth, so this crossing shape round-trips exactly like every other.
    const flat = flattenTree({
      kind: "wordprocessing",
      metadata: {},
      children: [group],
    });
    expect(flat).toEqual({
      kind: "wordprocessing",
      metadata: {},
      sections: [source],
    });
  });
});

// Promotion is defined only over a balanced marker stream, so an unbalanced one is refused outright rather than repaired into a plausible tree — the same "fail loudly, never silently skip" rule the sheet-group style-ref guard above follows. The thrown error carries document-schema.js's own ConstructMarkerImbalance payload, so a caller gets the offending block index without parsing a message.
describe("construct marker imbalance", () => {
  it("refuses a close marker that closes no open construct", () => {
    const doc = wordprocessingDoc([[paragraph("before"), CONSTRUCT_END]]);
    expect(() => decompose(doc)).toThrow(ConstructMarkerImbalanceError);
    try {
      decompose(doc);
    } catch (error) {
      if (!(error instanceof ConstructMarkerImbalanceError)) throw error;
      expect(error.imbalance).toEqual({ kind: "unmatchedEnd", index: 1 });
      expect(error.name).toBe("ConstructMarkerImbalanceError");
      expect(error.message).toBe(
        "decompose: the constructEnd marker at index 1 of this container's block flow closes no open construct",
      );
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
      expect(error.message).toBe(
        "decompose: the constructStart marker at index 0 of this container's block flow is never closed",
      );
    }
  });

  it("refuses an unbalanced shape flow too — the check runs per container block stream, not per document", () => {
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

// The ownership rule as a positive identity check: decompose embeds the document's own objects (leaves are the same references, never copies), and flatten emits those same objects back into block flow. The bijection laws deliberately never use toBe; this one deliberately does, because sharing IS the contract being pinned — a consumer holding both views sees an edit through either.
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

describe("assertNeverContentDocumentKind", () => {
  it("throws naming the unhandled kind, proving decompose's and assembleTree's own exhaustiveness guard actually fires at runtime", () => {
    let caught: unknown;
    try {
      assertNeverContentDocumentKind({ kind: "bogus" } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'decompose: unhandled ContentDocument kind {"kind":"bogus"}',
    );
  });
});
