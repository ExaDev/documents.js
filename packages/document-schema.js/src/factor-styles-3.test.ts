import { describe, expect, it } from "vitest";
import { type ContentParagraph } from "./content";
import { type ContentRun } from "./content-vocabulary";

import { mint } from "./factor-styles";
import { type DocumentTree } from "./package";
import type {
  DrawPageGroupNode,
  HeadingGroupNode,
  HeadingParagraph,
  ListGroupNode,
  ListParagraph,
  SectionConstructGroupNode,
  SectionGroupNode,
  ShapeConstructGroupNode,
  ShapeGroupNode,
  SlideGroupNode,
} from "./package-node";

// The minting rules as focused fixtures: the >=2 frequency threshold, the paragraph/run namespaces, the ban list (frames/sourcePath/styleId never enter a tuple), refs on wrappers only, the frozen-key rule for nested wrappers, chain-scoped stripping for nodes aliased under sibling wrappers, entry ordering and determinism, and idempotence. The bijection corpus (bijection.test.ts) re-runs the effective-equality and idempotence laws over real reader/conversion output; these tests pin the mechanism itself on minimal hand-built documents.

const SECTION = {
  pageSize: { widthPt: 595, heightPt: 842 },
  margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
};

function run(
  text: string,
  properties: Record<string, unknown> = {},
): ContentRun {
  return { text, ...properties };
}

function paragraph(
  runs: readonly ContentRun[],
  properties: Record<string, unknown> = {},
): ContentParagraph {
  return { kind: "paragraph", runs: [...runs], ...properties };
}

// A heading anchor with headingLevel narrowed to its required (non-optional) spelling on HeadingParagraph/HeadingGroupNode — ContentParagraph's own headingLevel is optional, so a plain `paragraph(...)` call cannot itself satisfy a HeadingGroupNode's `node` field. `headingLevel` is a real parameter, not folded into `properties`, so this stays statically typed rather than widened by the properties bag's own Record<string, unknown> spread.
function headingParagraph(
  runs: readonly ContentRun[],
  headingLevel: number,
  properties: Record<string, unknown> = {},
): HeadingParagraph {
  return { kind: "paragraph", runs: [...runs], headingLevel, ...properties };
}

// The list-anchor mirror of headingParagraph above: `list` narrowed to its required spelling on ListParagraph/ListGroupNode.
function listParagraph(
  runs: readonly ContentRun[],
  list: ListParagraph["list"],
  properties: Record<string, unknown> = {},
): ListParagraph {
  return { kind: "paragraph", runs: [...runs], list, ...properties };
}

// Recovers every group wrapper carrying a style ref, in tree order, as [ref, node-kind] pairs — the shape assertions below read the minted tree through it rather than by index-walking.
function refsOf(
  pkg: DocumentTree,
): { readonly ref: string; readonly nodeKind: string }[] {
  const found: { readonly ref: string; readonly nodeKind: string }[] = [];
  function walk(value: unknown): void {
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    if (
      "node" in record &&
      "children" in record &&
      typeof record.style === "string"
    ) {
      const node = record.node;
      const kind =
        typeof node === "object" &&
        node !== null &&
        "kind" in node &&
        typeof node.kind === "string"
          ? node.kind
          : "shape/anchor";
      found.push({ ref: record.style, nodeKind: kind });
    }
    for (const child of Object.values(record)) walk(child);
  }
  walk(pkg.children);
  return found;
}

describe("factorStyles minting (continued)", () => {
  it("rebuilds a list group's children the same way — new array, untouched sibling's own reference preserved, when exactly one child changed", () => {
    const list: ListGroupNode = {
      node: listParagraph(
        [run("a", { italic: true }), run("b", { italic: true })],
        { numId: "l1", level: 0, format: "bullet" },
      ),
      children: [],
    };
    const pristine = paragraph([run("untouched")]);
    const sectionGroup: SectionGroupNode = {
      node: { kind: "section", ...SECTION },
      children: [list, pristine],
    };
    const pkg: DocumentTree = {
      kind: "wordprocessing",
      metadata: {},
      children: [sectionGroup],
    };
    const minted = mint(pkg);
    expect(minted.styles?.s1).toEqual({ run: { italic: true } });
    if (minted.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const mintedSection = minted.children[0];
    if (mintedSection === undefined)
      throw new Error("expected the section group");
    expect(mintedSection.children[1]).toBe(pristine);
    const mintedList = mintedSection.children[0];
    if (
      mintedList === undefined ||
      !("node" in mintedList) ||
      !("children" in mintedList)
    )
      throw new Error("expected the list group");
    expect(mintedList.style).toBe("s1");
  });

  it("rebuilds a shape-flow construct group as a new object via an ancestor's strip alone, even when the construct group itself mints nothing (its own ref stays undefined)", () => {
    // outside and insideA share alignment:"left"; insideB carries alignment too (a DIFFERENT value, purely for universality across the shape's own extent), so the SHAPE mints alignment over [outside, insideA] specifically — freezing alignment before the construct group's own candidate search ever runs. The construct group's own extent ([insideA, insideB]) then shares nothing (alignment is frozen, nothing else matches), so its own ref stays undefined — but insideA was still stripped via the shape's ref, so the construct's `children.every(...)` check must still detect that change and return a new object, not just short-circuit on its own (never-set) ref.
    const outside = paragraph([run("outside")], { alignment: "left" });
    const insideA = paragraph([run("a")], { alignment: "left" });
    const insideB = paragraph([run("b")], { alignment: "right" });
    const constructGroup: ShapeConstructGroupNode = {
      node: { kind: "contentControl", controlType: "richText" },
      children: [insideA, insideB],
    };
    const shapeGroup: ShapeGroupNode = {
      node: {
        frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
        insetLeftPt: 0,
        insetTopPt: 0,
        insetRightPt: 0,
        insetBottomPt: 0,
      },
      children: [outside, constructGroup],
    };
    // A second, unrelated shape breaks the SLIDE's own commonality (it carries no alignment at all), so the slide itself mints nothing and the match is only found once the walk descends into shapeGroup's own (narrower) extent.
    const otherShape: ShapeGroupNode = {
      node: {
        frame: { xPt: 100, yPt: 0, widthPt: 100, heightPt: 100 },
        insetLeftPt: 0,
        insetTopPt: 0,
        insetRightPt: 0,
        insetBottomPt: 0,
      },
      children: [paragraph([run("elsewhere")])],
    };
    const slideGroup: SlideGroupNode = {
      node: { kind: "slide", size: { widthPt: 960, heightPt: 540 }, notes: "" },
      children: [shapeGroup, otherShape],
    };
    const pkg: DocumentTree = {
      kind: "presentation",
      metadata: {},
      children: [slideGroup],
    };
    const minted = mint(pkg);
    expect(refsOf(minted)).toEqual([{ ref: "s1", nodeKind: "shape/anchor" }]);
    if (minted.kind !== "presentation")
      throw new Error("expected presentation");
    const mintedConstruct = minted.children[0]?.children[0]?.children[1];
    if (
      mintedConstruct === undefined ||
      !("node" in mintedConstruct) ||
      !("children" in mintedConstruct)
    )
      throw new Error("expected the construct group");
    expect(mintedConstruct).not.toBe(constructGroup);
    expect(mintedConstruct).not.toHaveProperty("style");
    expect(mintedConstruct.children[0]).not.toHaveProperty("alignment");
    expect(mintedConstruct.children[1]).toEqual(insideB);
  });

  it("mints a ref on a shape group itself when its own two paragraphs match but nothing shares across the slide's other shape", () => {
    // Shape1's own extent (its two paragraphs alone) shares alignment, reaching the threshold there; shape2's one paragraph carries no alignment at all, so the SLIDE's own (wider) extent fails commonality and mints nothing itself — the ref must land on shape1 directly, and its own spread of `style` must actually appear.
    const shape1: ShapeGroupNode = {
      node: {
        frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
        insetLeftPt: 0,
        insetTopPt: 0,
        insetRightPt: 0,
        insetBottomPt: 0,
      },
      children: [
        paragraph([run("a")], { alignment: "left" }),
        paragraph([run("b")], { alignment: "left" }),
      ],
    };
    const shape2: ShapeGroupNode = {
      node: {
        frame: { xPt: 100, yPt: 0, widthPt: 100, heightPt: 100 },
        insetLeftPt: 0,
        insetTopPt: 0,
        insetRightPt: 0,
        insetBottomPt: 0,
      },
      children: [paragraph([run("c")])],
    };
    const slideGroup: SlideGroupNode = {
      node: { kind: "slide", size: { widthPt: 960, heightPt: 540 }, notes: "" },
      children: [shape1, shape2],
    };
    const pkg: DocumentTree = {
      kind: "presentation",
      metadata: {},
      children: [slideGroup],
    };
    const minted = mint(pkg);
    expect(refsOf(minted)).toEqual([{ ref: "s1", nodeKind: "shape/anchor" }]);
    expect(minted.styles?.s1).toEqual({ paragraph: { alignment: "left" } });
    if (minted.kind !== "presentation")
      throw new Error("expected presentation");
    const mintedSlide = minted.children[0];
    if (mintedSlide === undefined) throw new Error("expected the slide group");
    // The slide itself carries no ref — only shape1 does.
    expect(mintedSlide).not.toHaveProperty("style");
    const mintedShape1 = mintedSlide.children[0];
    if (mintedShape1 === undefined) throw new Error("expected shape1");
    expect(mintedShape1.style).toBe("s1");
    expect(mintedShape1.children[0]).not.toHaveProperty("alignment");
  });

  it("rebuilds a shape group's children the same way — new array, untouched sibling's own reference preserved, when exactly one child changed", () => {
    const changing = paragraph([run("a")], { alignment: "left" });
    const other = paragraph([run("b")], { alignment: "left" });
    // pristine carries alignment too (a DIFFERENT value), purely so alignment is common across the whole extent (required for it to be considered at all) — its own singleton value-group never reaches the mint threshold, so it stays untouched.
    const pristine = paragraph([run("untouched")], { alignment: "right" });
    const shapeGroup: ShapeGroupNode = {
      node: {
        frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
        insetLeftPt: 0,
        insetTopPt: 0,
        insetRightPt: 0,
        insetBottomPt: 0,
      },
      // `changing`/`other` share alignment (mints, so both get rebuilt); `pristine` shares nothing and must survive by reference.
      children: [changing, other, pristine],
    };
    const slideGroup: SlideGroupNode = {
      node: { kind: "slide", size: { widthPt: 960, heightPt: 540 }, notes: "" },
      children: [shapeGroup],
    };
    const pkg: DocumentTree = {
      kind: "presentation",
      metadata: {},
      children: [slideGroup],
    };
    const minted = mint(pkg);
    if (minted.kind !== "presentation")
      throw new Error("expected presentation");
    const mintedShape = minted.children[0]?.children[0];
    if (mintedShape === undefined) throw new Error("expected the shape group");
    expect(mintedShape).not.toBe(shapeGroup);
    expect(mintedShape).not.toHaveProperty("style");
    expect(mintedShape.children[2]).toBe(pristine);
    expect(mintedShape.children[0]).not.toHaveProperty("alignment");
  });

  it("rebuilds a draw page's children the same way — new array, untouched sibling shape's own reference preserved, when exactly one shape changed", () => {
    const changingShape: ShapeGroupNode = {
      node: {
        frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
        insetLeftPt: 0,
        insetTopPt: 0,
        insetRightPt: 0,
        insetBottomPt: 0,
      },
      children: [
        paragraph([run("a", { bold: true }), run("b", { bold: true })]),
      ],
    };
    const pristineShape: ShapeGroupNode = {
      node: {
        frame: { xPt: 100, yPt: 0, widthPt: 100, heightPt: 100 },
        insetLeftPt: 0,
        insetTopPt: 0,
        insetRightPt: 0,
        insetBottomPt: 0,
      },
      children: [paragraph([run("untouched")])],
    };
    const drawPageGroup: DrawPageGroupNode = {
      node: { kind: "drawPage", size: { widthPt: 300, heightPt: 300 } },
      children: [changingShape, pristineShape],
    };
    const pkg: DocumentTree = {
      kind: "drawing",
      metadata: {},
      children: [drawPageGroup],
    };
    const minted = mint(pkg);
    expect(minted.styles?.s1).toEqual({ run: { bold: true } });
    if (minted.kind !== "drawing") throw new Error("expected drawing");
    const mintedPage = minted.children[0];
    if (mintedPage === undefined) throw new Error("expected the draw page");
    expect(mintedPage).not.toBe(drawPageGroup);
    // The draw page's own extent shares no key across both shapes (bold isn't on pristineShape's run at all), so its own candidate search finds nothing and its ref stays undefined — it must not carry a style property just because a NESTED shape changed.
    expect(mintedPage).not.toHaveProperty("style");
    expect(mintedPage.children[1]).toBe(pristineShape);
  });

  it("rebuilds a section-flow construct group's children the same way — new array, untouched sibling's own reference preserved, when exactly one child changed", () => {
    const changing = paragraph([run("a")], { indentLeftPt: 30 });
    const other = paragraph([run("b")], { indentLeftPt: 30 });
    // pristine carries indentLeftPt too (a DIFFERENT value), purely so the key is common across the whole extent — its own singleton value-group never reaches the mint threshold.
    const pristine = paragraph([run("untouched")], { indentLeftPt: 99 });
    const constructGroup: SectionConstructGroupNode = {
      node: { kind: "contentControl", controlType: "richText" },
      children: [changing, other, pristine],
    };
    // outside carries no indentLeftPt at all, so the SECTION's own (wider) extent fails commonality and mints nothing itself — the match is only found once the walk descends into the construct group's own (narrower) extent.
    const outside = paragraph([run("outside")]);
    const sectionGroup: SectionGroupNode = {
      node: { kind: "section", ...SECTION },
      children: [outside, constructGroup],
    };
    const pkg: DocumentTree = {
      kind: "wordprocessing",
      metadata: {},
      children: [sectionGroup],
    };
    const minted = mint(pkg);
    if (minted.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const mintedConstruct = minted.children[0]?.children[1];
    if (
      mintedConstruct === undefined ||
      !("node" in mintedConstruct) ||
      !("children" in mintedConstruct)
    )
      throw new Error("expected the construct group");
    expect(mintedConstruct).not.toBe(constructGroup);
    expect(mintedConstruct.style).toBe("s1");
    expect(mintedConstruct.children[2]).toBe(pristine);
    expect(mintedConstruct.children[0]).not.toHaveProperty("indentLeftPt");
  });

  it("rebuilds a shape-flow construct group's children the same way — new array, untouched sibling's own reference preserved, when exactly one child changed", () => {
    const changing = paragraph([run("a")], { indentLeftPt: 30 });
    const other = paragraph([run("b")], { indentLeftPt: 30 });
    // pristine carries indentLeftPt too (a DIFFERENT value), purely so the key is common across the whole extent — its own singleton value-group never reaches the mint threshold.
    const pristine = paragraph([run("untouched")], { indentLeftPt: 99 });
    const constructGroup: ShapeConstructGroupNode = {
      node: { kind: "contentControl", controlType: "richText" },
      children: [changing, other, pristine],
    };
    // outside carries no indentLeftPt at all, so the SHAPE's own (wider) extent fails commonality and mints nothing itself.
    const outside = paragraph([run("outside")]);
    const shapeGroup: ShapeGroupNode = {
      node: {
        frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
        insetLeftPt: 0,
        insetTopPt: 0,
        insetRightPt: 0,
        insetBottomPt: 0,
      },
      children: [outside, constructGroup],
    };
    const slideGroup: SlideGroupNode = {
      node: { kind: "slide", size: { widthPt: 960, heightPt: 540 }, notes: "" },
      children: [shapeGroup],
    };
    const pkg: DocumentTree = {
      kind: "presentation",
      metadata: {},
      children: [slideGroup],
    };
    const minted = mint(pkg);
    if (minted.kind !== "presentation")
      throw new Error("expected presentation");
    const mintedConstruct = minted.children[0]?.children[0]?.children[1];
    if (
      mintedConstruct === undefined ||
      !("node" in mintedConstruct) ||
      !("children" in mintedConstruct)
    )
      throw new Error("expected the construct group");
    expect(mintedConstruct).not.toBe(constructGroup);
    expect(mintedConstruct.style).toBe("s1");
    expect(mintedConstruct.children[2]).toBe(pristine);
    expect(mintedConstruct.children[0]).not.toHaveProperty("indentLeftPt");
  });

  it("rebuilds a section-flow construct group with no style of its own when only a nested child mints, not the construct group itself", () => {
    // The construct group's own extent has no common key at all (heading/plain), so it never mints a ref of its own; the heading nested inside it mints on its own (narrower) extent.
    const h1 = headingParagraph([run("a")], 1, { indentLeftPt: 30 });
    const h2 = headingParagraph([run("b")], 1, { indentLeftPt: 30 });
    const headingGroup: HeadingGroupNode = { node: h1, children: [] };
    const otherHeadingGroup: HeadingGroupNode = { node: h2, children: [] };
    const constructGroup: SectionConstructGroupNode = {
      node: { kind: "contentControl", controlType: "richText" },
      children: [headingGroup, otherHeadingGroup],
    };
    const sectionGroup: SectionGroupNode = {
      node: { kind: "section", ...SECTION },
      children: [constructGroup],
    };
    const pkg: DocumentTree = {
      kind: "wordprocessing",
      metadata: {},
      children: [sectionGroup],
    };
    const minted = mint(pkg);
    if (minted.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const mintedConstruct = minted.children[0]?.children[0];
    if (
      mintedConstruct === undefined ||
      !("node" in mintedConstruct) ||
      !("children" in mintedConstruct)
    )
      throw new Error("expected the construct group");
    expect(mintedConstruct).not.toBe(constructGroup);
    expect(mintedConstruct).not.toHaveProperty("style");
  });

  it("rebuilds a shape-flow construct group with no style of its own when only a nested child mints, not the construct group itself", () => {
    const a = listParagraph([run("a")], { level: 0 }, { indentLeftPt: 30 });
    const b = listParagraph([run("b")], { level: 0 }, { indentLeftPt: 30 });
    const listGroupA: ListGroupNode = { node: a, children: [] };
    const listGroupB: ListGroupNode = { node: b, children: [] };
    const constructGroup: ShapeConstructGroupNode = {
      node: { kind: "contentControl", controlType: "richText" },
      children: [listGroupA, listGroupB],
    };
    const shapeGroup: ShapeGroupNode = {
      node: {
        frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
        insetLeftPt: 0,
        insetTopPt: 0,
        insetRightPt: 0,
        insetBottomPt: 0,
      },
      children: [constructGroup],
    };
    const slideGroup: SlideGroupNode = {
      node: { kind: "slide", size: { widthPt: 960, heightPt: 540 }, notes: "" },
      children: [shapeGroup],
    };
    const pkg: DocumentTree = {
      kind: "presentation",
      metadata: {},
      children: [slideGroup],
    };
    const minted = mint(pkg);
    if (minted.kind !== "presentation")
      throw new Error("expected presentation");
    const mintedConstruct = minted.children[0]?.children[0]?.children[0];
    if (
      mintedConstruct === undefined ||
      !("node" in mintedConstruct) ||
      !("children" in mintedConstruct)
    )
      throw new Error("expected the construct group");
    expect(mintedConstruct).not.toBe(constructGroup);
    expect(mintedConstruct).not.toHaveProperty("style");
  });
});

// Finds the first group wrapper anywhere in the tree whose anchor paragraph's first run text matches — the frozen-key test's H2 group sits nested inside the H1 group, not at any fixed depth.
