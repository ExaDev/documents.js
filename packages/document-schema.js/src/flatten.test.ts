import { describe, expect, it } from "vitest";
import type { ContentParagraph, ContentSection } from "./content";
import { decomposeSection } from "./decompose";
import { flattenTree } from "./flatten";
import type { StylesTable } from "./definitions";
import type { DocumentTree } from "./package";
import type {
  HeadingGroupNode,
  SectionGroupNode,
  ShapeGroupNode,
  SlideGroupNode,
} from "./package-node";

// flattenTree entered directly, on trees a caller hands in rather than ones assembleTree just built. The bijection suite already pins the round trip over a styles-free-or-freshly-minted tree; what only a direct entry can reach is the resolver's own semantics (which chain a position resolves against, and that gap-fill never overwrites) and the two refusals a hand-built tree can trigger. decompose.test.ts covers the third refusal, a style ref on a sheet group.

const SECTION = {
  pageSize: { widthPt: 595, heightPt: 842 },
  margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
};

function paragraph(
  text: string,
  properties: Partial<ContentParagraph> = {},
): ContentParagraph {
  return { kind: "paragraph", runs: [{ text }], ...properties };
}

function wordprocessingPackage(
  children: SectionGroupNode[],
  styles?: StylesTable,
): DocumentTree {
  return {
    kind: "wordprocessing",
    metadata: {},
    ...(styles !== undefined ? { styles } : {}),
    children,
  };
}

function sectionBlocks(pkg: DocumentTree): ContentSection["blocks"] {
  const flat = flattenTree(pkg);
  if (flat.kind !== "wordprocessing")
    throw new Error("expected a wordprocessing document back");
  const section = flat.sections[0];
  if (section === undefined) throw new Error("expected one section back");
  return section.blocks;
}

describe("flattenTree style resolution", () => {
  it("overlays the chain outermost-first, so the nearest group wins over a further-out one", () => {
    const body = paragraph("body");
    const headingGroup: HeadingGroupNode = {
      node: { kind: "paragraph", headingLevel: 1, runs: [{ text: "Chapter" }] },
      style: "inner",
      children: [body],
    };
    const pkg = wordprocessingPackage(
      [
        {
          node: { kind: "section", ...SECTION },
          style: "outer",
          children: [headingGroup],
        },
      ],
      {
        outer: { paragraph: { indentLeftPt: 10, alignment: "left" } },
        inner: { paragraph: { indentLeftPt: 40 } },
      },
    );
    // Both positions sit under outer+inner: alignment comes from the only entry that carries it, indentLeftPt from the nearer one.
    expect(sectionBlocks(pkg)).toEqual([
      {
        kind: "paragraph",
        headingLevel: 1,
        runs: [{ text: "Chapter" }],
        indentLeftPt: 40,
        alignment: "left",
      },
      {
        kind: "paragraph",
        runs: [{ text: "body" }],
        indentLeftPt: 40,
        alignment: "left",
      },
    ]);
  });

  it("fills gaps only -- a property the node already carries survives whatever the entry says", () => {
    const pkg = wordprocessingPackage(
      [
        {
          node: { kind: "section", ...SECTION },
          style: "s1",
          children: [
            paragraph("keeps its own", { indentLeftPt: 99 }),
            paragraph("takes the entry's"),
          ],
        },
      ],
      { s1: { paragraph: { indentLeftPt: 20 } } },
    );
    expect(
      sectionBlocks(pkg).map((block) =>
        block.kind === "paragraph" ? block.indentLeftPt : undefined,
      ),
    ).toEqual([99, 20]);
  });

  it("applies a resolved entry's run half to every run of every paragraph it resolved for", () => {
    const pkg = wordprocessingPackage(
      [
        {
          node: { kind: "section", ...SECTION },
          style: "s1",
          children: [
            {
              kind: "paragraph",
              runs: [{ text: "a" }, { text: "b", bold: false }],
            },
          ],
        },
      ],
      { s1: { run: { bold: true, sizePt: 11 } } },
    );
    const [block] = sectionBlocks(pkg);
    if (block?.kind !== "paragraph")
      throw new Error("expected a paragraph back");
    // The second run's own `bold: false` is a carried value, not a gap, so the entry does not overwrite it.
    expect(block.runs).toEqual([
      { text: "a", bold: true, sizePt: 11 },
      { text: "b", bold: false, sizePt: 11 },
    ]);
  });

  it("leaves an unreferenced subtree's own objects untouched -- no chain, no copy", () => {
    const untouched = paragraph("no ref anywhere above me");
    const pkg = wordprocessingPackage([
      { node: { kind: "section", ...SECTION }, children: [untouched] },
    ]);
    expect(sectionBlocks(pkg)[0]).toBe(untouched);
  });

  it("resolves a shape group's ref through the slide group above it", () => {
    const shape: ShapeGroupNode = {
      node: {
        frame: { xPt: 0, yPt: 0, widthPt: 400, heightPt: 300 },
        insetLeftPt: 0,
        insetTopPt: 0,
        insetRightPt: 0,
        insetBottomPt: 0,
      },
      style: "shape",
      children: [paragraph("in the shape")],
    };
    const slide: SlideGroupNode = {
      node: { kind: "slide", size: { widthPt: 960, heightPt: 540 }, notes: "" },
      style: "slide",
      children: [shape],
    };
    const flat = flattenTree({
      kind: "presentation",
      metadata: {},
      styles: {
        slide: { run: { fontFamily: "Inter" } },
        shape: { paragraph: { alignment: "center" } },
      },
      children: [slide],
    });
    if (flat.kind !== "presentation")
      throw new Error("expected a presentation back");
    expect(flat.slides[0]?.shapes[0]?.blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "in the shape", fontFamily: "Inter" }],
        alignment: "center",
      },
    ]);
  });

  it("refuses a ref it cannot resolve loudly, rather than skipping that level of the chain", () => {
    const pkg = wordprocessingPackage(
      [
        {
          node: { kind: "section", ...SECTION },
          style: "missing",
          children: [paragraph("x")],
        },
      ],
      { s1: { paragraph: { alignment: "left" } } },
    );
    expect(() => flattenTree(pkg)).toThrow(
      /names no entry in the styles table/,
    );
  });

  it("refuses a ref on a package that carries no styles table at all", () => {
    // Resolution runs completely or not at all: a tree stating a ref against no table is malformed, and passing the ref by silently would drop the styling it names with no signal.
    const pkg = wordprocessingPackage([
      {
        node: { kind: "section", ...SECTION },
        style: "s1",
        children: [paragraph("x")],
      },
    ]);
    expect(() => flattenTree(pkg)).toThrow(/no styles table/);
  });
});

describe("flattenTree cardinality guards", () => {
  it("refuses a formula package holding anything other than exactly one ContentFormula", () => {
    const formula = { mathml: [] };
    expect(() =>
      flattenTree({ kind: "formula", metadata: {}, children: [] }),
    ).toThrow(/exactly one ContentFormula/);
    expect(() =>
      flattenTree({
        kind: "formula",
        metadata: {},
        children: [formula, formula],
      }),
    ).toThrow(/exactly one ContentFormula/);
    expect(
      flattenTree({ kind: "formula", metadata: {}, children: [formula] }),
    ).toEqual({ kind: "formula", metadata: {}, formula });
  });
});

describe("flattenTree envelope handling", () => {
  it("carries metadata and symbolTable back onto the flat document, and drops the tree-only pages array", () => {
    // `pages` and the package tables have no spelling on a flat ContentDocument, so flatten states the envelope it can carry and nothing else -- factorStyles is what rides pages and definitions across a re-factoring.
    const flat = flattenTree({
      kind: "wordprocessing",
      metadata: { title: "Envelope" },
      symbolTable: { symbols: [], units: [] },
      pages: [{ widthPt: 595, heightPt: 842 }],
      definitions: { n1: { kind: "footnote" } },
      children: [{ node: { kind: "section", ...SECTION }, children: [] }],
    });
    expect(flat).toEqual({
      kind: "wordprocessing",
      metadata: { title: "Envelope" },
      symbolTable: { symbols: [], units: [] },
      sections: [{ ...SECTION, blocks: [] }],
    });
  });

  it("omits symbolTable entirely when the tree carries none, rather than an explicit undefined key", () => {
    const flat = flattenTree({
      kind: "wordprocessing",
      metadata: { title: "No symbol table" },
      children: [{ node: { kind: "section", ...SECTION }, children: [] }],
    });
    expect("symbolTable" in flat).toBe(false);
  });

  it("omits a spreadsheet's names entirely when the tree carries none, rather than an explicit undefined key", () => {
    const flat = flattenTree({
      kind: "spreadsheet",
      metadata: {},
      children: [],
    });
    expect("names" in flat).toBe(false);
  });

  it("carries a spreadsheet's names when present", () => {
    const flat = flattenTree({
      kind: "spreadsheet",
      metadata: {},
      names: [{ name: "Total", refersTo: "Sheet1!A1" }],
      children: [],
    });
    if (flat.kind !== "spreadsheet")
      throw new Error("expected a spreadsheet back");
    expect(flat.names).toEqual([{ name: "Total", refersTo: "Sheet1!A1" }]);
  });

  it("rebuilds a draw page's shapes-then-vectors partition and a sheet's images-then-embedded-objects one", () => {
    const vector = {
      kind: "rect",
      frame: { xPt: 1, yPt: 2, widthPt: 3, heightPt: 4 },
    } as const;
    const drawing = flattenTree({
      kind: "drawing",
      metadata: {},
      children: [
        {
          node: { kind: "drawPage", size: { widthPt: 300, heightPt: 300 } },
          children: [
            {
              node: {
                frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
                insetLeftPt: 0,
                insetTopPt: 0,
                insetRightPt: 0,
                insetBottomPt: 0,
              },
              children: [],
            },
            vector,
          ],
        },
      ],
    });
    if (drawing.kind !== "drawing") throw new Error("expected a drawing back");
    expect(drawing.pages[0]?.shapes).toHaveLength(1);
    expect(drawing.pages[0]?.vectors).toEqual([vector]);
  });

  it("is the exact inverse of decomposeSection for a section whose flow uses every grouping signal", () => {
    const source: ContentSection = {
      ...SECTION,
      blocks: [
        paragraph("Chapter", { headingLevel: 1 }),
        paragraph("item", { list: { level: 0 } }),
        paragraph("nested item", { list: { level: 1 } }),
        {
          kind: "constructStart",
          descriptor: { kind: "field", instruction: "PAGE" },
        },
        paragraph("inside the field"),
        { kind: "constructEnd" },
        paragraph("plain"),
      ],
    };
    expect(
      sectionBlocks(wordprocessingPackage([decomposeSection(source)])),
    ).toEqual(source.blocks);
  });

  it("returns the paragraph unchanged (same runs array reference) when the resolved entry has no run half", () => {
    // applyEntry short-circuits on an undefined run half rather than re-mapping the runs array through a no-op transform -- the identity, not just the values, must survive.
    const original = paragraph("keeps its runs array");
    const pkg = wordprocessingPackage(
      [
        {
          node: { kind: "section", ...SECTION },
          style: "s1",
          children: [original],
        },
      ],
      { s1: { paragraph: { indentLeftPt: 20 } } },
    );
    const [block] = sectionBlocks(pkg);
    if (block?.kind !== "paragraph")
      throw new Error("expected a paragraph back");
    expect(block.runs).toBe(original.runs);
  });

  it("passes a non-paragraph, non-group leaf inside a list item's flow through unchanged", () => {
    const image = {
      kind: "image",
      format: "png",
      base64: "",
      widthPt: 10,
      heightPt: 10,
    } as const;
    const pkg = wordprocessingPackage([
      {
        node: { kind: "section", ...SECTION },
        children: [
          {
            node: {
              kind: "paragraph",
              list: { level: 0 },
              runs: [{ text: "item" }],
            },
            children: [image],
          },
        ],
      },
    ]);
    expect(sectionBlocks(pkg)).toEqual([
      { kind: "paragraph", list: { level: 0 }, runs: [{ text: "item" }] },
      image,
    ]);
  });
});

describe("flattenTree's narrow group-kind guards only ever matter for a tree that violates its own type", () => {
  // isHeadingGroup/isListGroup/isConstructGroup (unexported helpers) each narrow on their group's OWN node shape (headingLevel present, list present, or node.kind !== 'paragraph'). For any value that is genuinely SectionChild/ListChild-typed, TypeScript already guarantees these three conditions are mutually exclusive -- a HeadingGroupNode's anchor always carries headingLevel, a ListGroupNode's anchor always carries list, and a construct descriptor's kind is never 'paragraph'. The three tests below can only observe a wrong guard by handing flattenTree a tree that is NOT genuinely well-typed (a paragraph-anchored group carrying neither signal) -- exactly the "no re-validation, the parameter type already guarantees a real DocumentTree" contract this module's own top comment states flattenTree relies on, deliberately bypassed here with an explicit cast to prove the guard itself is still correct if that contract is ever violated.
  it("a construct group is never misread as a heading or list anchor", () => {
    const pkg: DocumentTree = {
      kind: "wordprocessing",
      metadata: {},
      children: [
        {
          node: { kind: "section", ...SECTION },
          children: [
            {
              node: { kind: "anchor", anchorType: "bookmark", name: "b1" },
              children: [paragraph("inside the bookmark construct")],
            },
          ],
        },
      ],
    };
    expect(sectionBlocks(pkg)).toEqual([
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "b1" },
      },
      paragraph("inside the bookmark construct"),
      { kind: "constructEnd" },
    ]);
  });

  it("a paragraph-anchored group with neither a heading nor a list signal is never silently treated as a construct group", () => {
    const illegalGroup = {
      node: { kind: "paragraph", runs: [{ text: "anchor with no signal" }] },
      children: [],
    } as unknown as HeadingGroupNode;
    const pkg = wordprocessingPackage([
      { node: { kind: "section", ...SECTION }, children: [illegalGroup] },
    ]);
    // Real code: isHeadingGroup/isListGroup both false, isConstructGroup's own node.kind !== 'paragraph' check is also false (this node's kind IS 'paragraph'), so this group falls through every named branch and is pushed as the group object itself -- not wrapped as a construct, which is what a mutated isConstructGroup (unconditionally true past its node/children guard) would do instead.
    expect(sectionBlocks(pkg)).toEqual([illegalGroup]);
  });
});
