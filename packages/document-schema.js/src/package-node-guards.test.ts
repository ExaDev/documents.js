import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentEmbeddedObject,
  ContentFormula,
} from "./content";
import type { ContentRun } from "./content-vocabulary";

import {
  DrawPageGroupSchema,
  HeadingGroupSchema,
  isTreeBlockLeaf,
  isTreeGroup,
  isTreeLeaf,
  isTreeNode,
  ListGroupSchema,
  TreeBlockLeafSchema,
  SectionConstructGroupSchema,
  SectionGroupSchema,
  ShapeGroupSchema,
  SheetGroupSchema,
  SlideGroupSchema,
  type DrawPageGroupNode,
  type HeadingGroupNode,
  type ListGroupNode,
  type TreeNode,
  type SectionGroupNode,
  type ShapeGroupNode,
  type SheetGroupNode,
  type SlideGroupNode,
} from "./package-node";

const PAGE = { widthPt: 612, heightPt: 792 };
const MARGINS = { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 };

function run(text: string, extra: Partial<ContentRun> = {}): ContentRun {
  return { text, ...extra };
}

function formula(): ContentFormula {
  return {
    mathml: [{ type: "element", tag: "math", attributes: [], children: [] }],
  };
}

function embeddedFormulaDocument(): ContentDocument {
  return { kind: "formula", metadata: {}, formula: formula() };
}

function embeddedObject(): ContentEmbeddedObject {
  return {
    objectKind: "formula",
    document: embeddedFormulaDocument(),
    frame: { xPt: 100, yPt: 100, widthPt: 60, heightPt: 20 },
    anchorRow: 1,
    anchorColumn: 2,
    offsetXPt: 4,
    offsetYPt: 5,
  };
}

// A wordprocessing section group exercising every section-child position at once: a heading group with a nested deeper heading, a list group two levels deep, and bare block leaves (a paragraph, a table, an image, a page break) — plus a style ref on the outer heading, the one place a ref may legally sit.
function sectionGroup(): SectionGroupNode {
  const heading: HeadingGroupNode = {
    node: { kind: "paragraph", headingLevel: 1, runs: [run("Heading")] },
    children: [
      { kind: "paragraph", runs: [run("Plain leaf")] },
      {
        kind: "table",
        rows: [
          { cells: [{ blocks: [{ kind: "paragraph", runs: [run("Cell")] }] }] },
        ],
        columns: [{ widthPt: 100 }],
      },
      {
        kind: "image",
        format: "png",
        base64: "aGk=",
        widthPt: 50,
        heightPt: 50,
      },
      { kind: "pageBreak" },
      {
        node: {
          kind: "paragraph",
          headingLevel: 2,
          runs: [run("Nested heading")],
        },
        children: [],
      },
    ],
  };
  const list: ListGroupNode = {
    node: { kind: "paragraph", list: { level: 0 }, runs: [run("Item")] },
    children: [
      {
        node: {
          kind: "paragraph",
          list: { level: 1 },
          runs: [run("Nested item")],
        },
        children: [],
      },
    ],
  };
  return {
    node: { kind: "section", pageSize: PAGE, margins: MARGINS },
    children: [
      heading,
      list,
      { kind: "paragraph", runs: [run("After the lists")] },
    ],
  };
}

function slideGroup(): SlideGroupNode {
  const shape: ShapeGroupNode = {
    node: {
      frame: { xPt: 10, yPt: 10, widthPt: 200, heightPt: 100 },
      insetLeftPt: 0,
      insetTopPt: 0,
      insetRightPt: 0,
      insetBottomPt: 0,
    },
    children: [
      {
        node: { kind: "paragraph", list: { level: 0 }, runs: [run("Bullet")] },
        children: [],
      },
      { kind: "paragraph", runs: [run("Shape body")] },
    ],
  };
  return {
    node: { kind: "slide", size: { widthPt: 960, heightPt: 540 }, notes: "" },
    children: [shape],
  };
}

function sheetGroup(): SheetGroupNode {
  return {
    node: {
      kind: "sheet",
      name: "Sheet1",
      cells: [
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "A1" },
          displayText: "A1",
        },
      ],
      columns: [{ index: 0, widthPt: 64 }],
      rows: [],
      printSettings: {
        pageSize: PAGE,
        margins: MARGINS,
        gridlines: false,
        headers: false,
        pageOrder: "downThenOver",
      },
    },
    children: [
      {
        kind: "image",
        format: "png",
        base64: "aGk=",
        widthPt: 50,
        heightPt: 50,
        anchorRow: 0,
        anchorColumn: 0,
        offsetXPt: 0,
        offsetYPt: 0,
      },
      embeddedObject(),
    ],
  };
}

function drawPageGroup(): DrawPageGroupNode {
  const shape: ShapeGroupNode = {
    node: {
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      insetLeftPt: 0,
      insetTopPt: 0,
      insetRightPt: 0,
      insetBottomPt: 0,
    },
    children: [],
  };
  return {
    node: { kind: "drawPage", size: PAGE },
    children: [
      shape,
      {
        kind: "line",
        from: { xPt: 0, yPt: 0 },
        to: { xPt: 10, yPt: 10 },
        stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
      },
    ],
  };
}

describe("construct boundary markers are not tree leaves", () => {
  const openMarker = {
    kind: "constructStart",
    descriptor: { kind: "anchor", anchorType: "bookmark", name: "b1" },
  };
  const closeMarker = { kind: "constructEnd" };

  it("rejects either marker at a block-leaf position, whichever flow it sits in", () => {
    for (const marker of [openMarker, closeMarker]) {
      expect(isTreeBlockLeaf(marker)).toBe(false);
      expect(TreeBlockLeafSchema.safeParse(marker).success).toBe(false);
      expect(isTreeLeaf(marker)).toBe(false);
      expect(isTreeNode(marker)).toBe(false);
      expect(
        SectionGroupSchema.safeParse({
          node: { kind: "section", pageSize: PAGE, margins: MARGINS },
          children: [marker],
        }).success,
      ).toBe(false);
      expect(
        HeadingGroupSchema.safeParse({
          node: { kind: "paragraph", headingLevel: 1, runs: [run("H")] },
          children: [marker],
        }).success,
      ).toBe(false);
      expect(
        ListGroupSchema.safeParse({
          node: { kind: "paragraph", list: { level: 0 }, runs: [run("Item")] },
          children: [marker],
        }).success,
      ).toBe(false);
      expect(
        ShapeGroupSchema.safeParse({
          node: {
            frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
            insetLeftPt: 0,
            insetTopPt: 0,
            insetRightPt: 0,
            insetBottomPt: 0,
          },
          children: [marker],
        }).success,
      ).toBe(false);
    }
  });

  it("rejects a marker inside a construct extent too — a construct group is where the pair would have been promoted to", () => {
    expect(
      SectionConstructGroupSchema.safeParse({
        node: { kind: "division", name: "Chapter1" },
        children: [
          openMarker,
          { kind: "paragraph", runs: [run("Body")] },
          closeMarker,
        ],
      }).success,
    ).toBe(false);
  });

  it("still accepts every other block kind as a leaf, so the exclusion is the two markers and nothing else", () => {
    for (const leaf of [
      { kind: "paragraph", runs: [run("Body")] },
      { kind: "pageBreak" },
      {
        kind: "image",
        format: "png",
        base64: "aGk=",
        widthPt: 50,
        heightPt: 50,
      },
    ]) {
      expect(isTreeBlockLeaf(leaf)).toBe(true);
      expect(isTreeLeaf(leaf)).toBe(true);
    }
  });

  it("accepts a marker pair inside a table cell, the one place the flat encoding survives inside a tree", () => {
    const tableLeaf = {
      kind: "table",
      rows: [
        {
          cells: [
            {
              blocks: [
                openMarker,
                { kind: "paragraph", runs: [run("Bookmarked cell")] },
                closeMarker,
              ],
            },
          ],
        },
      ],
      columns: [{ widthPt: 200 }],
    };
    expect(isTreeBlockLeaf(tableLeaf)).toBe(true);
    expect(
      SectionGroupSchema.safeParse({
        node: { kind: "section", pageSize: PAGE, margins: MARGINS },
        children: [tableLeaf],
      }).success,
    ).toBe(true);
  });
});

describe("the package tree rejects near-misses", () => {
  it("rejects a group wrapper with no children array", () => {
    const broken = {
      node: { kind: "section", pageSize: PAGE, margins: MARGINS },
    };
    expect(SectionGroupSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a raw flat container posed as a descriptor — a section node missing its kind tag", () => {
    const broken = { node: { pageSize: PAGE, margins: MARGINS }, children: [] };
    expect(SectionGroupSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a shape descriptor still carrying its blocks — the omitted array is banned, not merely absent", () => {
    const broken = {
      node: {
        frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
        insetLeftPt: 0,
        insetTopPt: 0,
        insetRightPt: 0,
        insetBottomPt: 0,
        blocks: [],
      },
      children: [],
    };
    expect(ShapeGroupSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a slide group with a paragraph leaf child — a slide holds shape groups only", () => {
    const slide = slideGroup();
    const broken = {
      ...slide,
      children: [
        ...slide.children,
        { kind: "paragraph", runs: [run("stray")] },
      ],
    };
    expect(SlideGroupSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a sheet group with a block-flow child — a sheet holds images and embedded documents only", () => {
    const sheet = sheetGroup();
    const broken = {
      ...sheet,
      children: [
        ...sheet.children,
        { kind: "paragraph", runs: [run("stray")] },
      ],
    };
    expect(SheetGroupSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a heading group under a list group — heading never appears below a list", () => {
    const broken = {
      node: { kind: "paragraph", list: { level: 0 }, runs: [run("Item")] },
      children: [
        {
          node: { kind: "paragraph", headingLevel: 1, runs: [run("H")] },
          children: [],
        },
      ],
    };
    expect(ListGroupSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a heading group whose anchor carries no headingLevel, and a list group whose anchor carries no list", () => {
    const notHeading = {
      node: { kind: "paragraph", runs: [run("plain")] },
      children: [],
    };
    expect(HeadingGroupSchema.safeParse(notHeading).success).toBe(false);
    const notList = {
      node: { kind: "paragraph", runs: [run("plain")] },
      children: [],
    };
    expect(ListGroupSchema.safeParse(notList).success).toBe(false);
  });

  it("rejects a non-string style ref", () => {
    const broken = {
      node: { kind: "section", pageSize: PAGE, margins: MARGINS },
      style: 7,
      children: [],
    };
    expect(SectionGroupSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a group wrapper carrying a key outside { node, style, children }, exactly as the published fragments' additionalProperties: false does", () => {
    const broken = {
      node: { kind: "section", pageSize: PAGE, margins: MARGINS },
      junkKey: "x",
      children: [],
    };
    expect(SectionGroupSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a style ref on a bare leaf at a child position, in every leaf family — refs sit on group wrappers only, so a leaf-position ref fails loudly instead of parsing inert", () => {
    const section = sectionGroup();
    const withLeafRef = {
      ...section,
      children: [
        ...section.children,
        { kind: "paragraph", runs: [run("leaf")], style: "s1" },
      ],
    };
    expect(SectionGroupSchema.safeParse(withLeafRef).success).toBe(false);

    const sheet = sheetGroup();
    const sheetImage = sheet.children[0];
    if (sheetImage === undefined || !("format" in sheetImage))
      throw new Error("fixture shape");
    const sheetWithLeafRef = {
      ...sheet,
      children: [{ ...sheetImage, style: "s1" }],
    };
    expect(SheetGroupSchema.safeParse(sheetWithLeafRef).success).toBe(false);

    const drawPage = drawPageGroup();
    const vectorWithRef = {
      kind: "line",
      from: { xPt: 0, yPt: 0 },
      to: { xPt: 10, yPt: 10 },
      stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
      style: "s1",
    };
    expect(
      DrawPageGroupSchema.safeParse({
        ...drawPage,
        children: [...drawPage.children, vectorWithRef],
      }).success,
    ).toBe(false);
  });

  it("rejects a malformed leaf payload at a child position (an image whose width is not a number)", () => {
    const broken = {
      node: { kind: "section", pageSize: PAGE, margins: MARGINS },
      children: [
        {
          kind: "image",
          format: "png",
          base64: "aGk=",
          widthPt: "wide",
          heightPt: 50,
        },
      ],
    };
    expect(SectionGroupSchema.safeParse(broken).success).toBe(false);
  });

  it("never confuses the two classes: a group does not validate as a leaf, a leaf does not validate as a group", () => {
    const section = sectionGroup();
    expect(isTreeLeaf(section)).toBe(false);
    const paragraph = { kind: "paragraph", runs: [run("leaf")] } as const;
    expect(isTreeGroup(paragraph)).toBe(false);
    expect(isTreeLeaf(paragraph)).toBe(true);
  });

  it("a heading paragraph is also a legal bare leaf (a valid ContentBlock), while its group wrapper is not a leaf", () => {
    const headingParagraph = {
      kind: "paragraph",
      headingLevel: 1,
      runs: [run("H")],
    } as const;
    expect(isTreeLeaf(headingParagraph)).toBe(true);
    const wrapper: TreeNode = {
      node: { kind: "paragraph", headingLevel: 1, runs: [run("H")] },
      children: [],
    };
    expect(isTreeGroup(wrapper)).toBe(true);
    expect(isTreeLeaf(wrapper)).toBe(false);
  });
});

describe("a group wrapper's own `node` must be a plain, non-null, non-array record", () => {
  it("rejects a wrapper whose node is null", () => {
    expect(
      SectionGroupSchema.safeParse({ node: null, children: [] }).success,
    ).toBe(false);
  });

  it("rejects a wrapper whose node is an array, even though typeof an array is 'object'", () => {
    expect(
      SectionGroupSchema.safeParse({ node: [], children: [] }).success,
    ).toBe(false);
  });

  it("rejects a wrapper whose node is a primitive", () => {
    expect(
      SectionGroupSchema.safeParse({ node: "not-a-record", children: [] })
        .success,
    ).toBe(false);
    expect(
      SectionGroupSchema.safeParse({ node: 42, children: [] }).success,
    ).toBe(false);
  });

  it("rejects a wrapper with no node field at all", () => {
    expect(SectionGroupSchema.safeParse({ children: [] }).success).toBe(false);
  });
});

describe("every group guard rejects a wrapper VALUE that isn't itself a plain record, before ever reading its own .node", () => {
  // Each guard's own top-level isRecord(value) check runs before value.node is ever read — for null/undefined specifically, skipping straight to `value.node` would throw a TypeError rather than return false, so this is the one guard clause a malformed non-object input actually depends on for a clean `false` rather than a crash. A node-only test (the describe block above) can never reach this: SectionDescriptorSchema.safeParse(value.node) already requires value.node to be a real object to succeed at all, so by the time isGroupWrapper's own isRecord(value.node) check would run, value.node is already guaranteed to satisfy it.
  it("rejects null and undefined without throwing", () => {
    expect(() => SectionGroupSchema.safeParse(null)).not.toThrow();
    expect(SectionGroupSchema.safeParse(null).success).toBe(false);
    expect(SectionGroupSchema.safeParse(undefined).success).toBe(false);
    expect(isTreeNode(null)).toBe(false);
    expect(isTreeGroup(null)).toBe(false);
  });

  it("rejects an array, even though typeof an array is 'object'", () => {
    expect(SectionGroupSchema.safeParse([]).success).toBe(false);
    expect(isTreeGroup([])).toBe(false);
  });

  it("rejects a primitive", () => {
    const arbitraryNumber = 42;
    expect(SectionGroupSchema.safeParse("a string").success).toBe(false);
    expect(SectionGroupSchema.safeParse(arbitraryNumber).success).toBe(false);
    expect(isTreeGroup("a string")).toBe(false);
  });
});
