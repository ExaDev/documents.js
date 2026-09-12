import { describe, expect, it } from "vitest";
import { canonicalise } from "./canonicalise";
import {
  ContentParagraphSchema,
  type ContentBlock,
  type ContentDocument,
  type ContentParagraph,
  type ContentRun,
  type ContentVector,
} from "./content";
import { assembleTree, factorStyles, mint } from "./factor-styles";
import { flattenTree } from "./flatten";
import { DocumentTreeSchema, type DocumentTree } from "./package";
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

// A heading anchor with headingLevel narrowed to its required (non-optional) spelling on HeadingParagraph/HeadingGroupNode -- ContentParagraph's own headingLevel is optional, so a plain `paragraph(...)` call cannot itself satisfy a HeadingGroupNode's `node` field. `headingLevel` is a real parameter, not folded into `properties`, so this stays statically typed rather than widened by the properties bag's own Record<string, unknown> spread.
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

function wordprocessingDoc(
  blocks: ContentBlock[],
  metadata: Record<string, unknown> = {},
): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata,
    sections: [{ ...SECTION, blocks }],
  };
}

function canon(value: unknown): unknown {
  return JSON.parse(JSON.stringify(canonicalise(value)));
}

// Recovers every group wrapper carrying a style ref, in tree order, as [ref, node-kind] pairs -- the shape assertions below read the minted tree through it rather than by index-walking.
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

function containsKeyAnywhere(value: unknown, key: string): boolean {
  if (Array.isArray(value))
    return value.some((child) => containsKeyAnywhere(child, key));
  if (typeof value !== "object" || value === null) return false;
  for (const [k, child] of Object.entries(value)) {
    if (k === key) return true;
    if (containsKeyAnywhere(child, key)) return true;
  }
  return false;
}

describe("factorStyles minting", () => {
  it("factors a paragraph tuple occurring twice onto a wrapper ref and strips it from both positions", () => {
    const doc = wordprocessingDoc([
      paragraph([run("one")], { indentLeftPt: 20, alignment: "left" }),
      paragraph([run("two")], { indentLeftPt: 20, alignment: "left" }),
      paragraph([run("three")], { indentLeftPt: 20, alignment: "right" }),
    ]);
    const minted = assembleTree(doc);
    // The section wrapper is the one scope whose extent holds both indentLeftPt-20-left positions (bare leaves at section root), and alignment+indent are carried by every extent paragraph, so one entry covers both keys for the two matching positions. The third paragraph keeps its differing alignment inline (present-wins), and shares the indent through the same entry only if its tuple matched -- it does not (alignment differs), so it stays fully inline.
    expect(refsOf(minted)).toEqual([{ ref: "s1", nodeKind: "section" }]);
    const styles = minted.styles ?? {};
    expect(Object.keys(styles)).toEqual(["s1"]);
    expect(styles.s1).toEqual({
      paragraph: { alignment: "left", indentLeftPt: 20 },
    });
    expect(minted.kind).toBe("wordprocessing");
    if (minted.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const strip1 = minted.children[0]?.children[0];
    const strip2 = minted.children[0]?.children[1];
    const keep3 = minted.children[0]?.children[2];
    expect(strip1).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "one" }],
    });
    expect(strip1).not.toHaveProperty("indentLeftPt");
    expect(strip1).not.toHaveProperty("alignment");
    expect(strip2).not.toHaveProperty("indentLeftPt");
    expect(keep3).toMatchObject({ alignment: "right", indentLeftPt: 20 });
    expect(DocumentTreeSchema.safeParse(minted).success).toBe(true);
  });

  it("mints nothing for singletons -- a ref plus its entry is larger than the inline tuple", () => {
    const doc = wordprocessingDoc([
      paragraph([run("only")], { indentLeftPt: 20 }),
      paragraph([run("other")], { indentLeftPt: 40 }),
    ]);
    const minted = assembleTree(doc);
    expect(minted.styles).toBeUndefined();
    expect(refsOf(minted)).toEqual([]);
  });

  it("never factors the ban list: frames, sourcePath, and styleId stay per-node", () => {
    const frames = [
      { pageIndex: 0, xPt: 10, yPt: 20, widthPt: 30, heightPt: 5 },
    ];
    const doc = wordprocessingDoc([
      paragraph([run("one", { bold: true })], {
        styleId: "Heading1",
        sourcePath: "word/document.xml#one",
        frames,
      }),
      paragraph([run("two", { bold: true })], {
        styleId: "Heading1",
        sourcePath: "word/document.xml#one",
        frames,
      }),
    ]);
    const minted = assembleTree(doc);
    expect(refsOf(minted)).toEqual([{ ref: "s1", nodeKind: "section" }]);
    // All three ban-list keys are identical on both paragraphs and so occur twice, but each is a per-node fact: no entry carries any of them and no paragraph loses any of them. bold occurs twice AND is carried by both extent runs, so the run half legitimately mints.
    expect(minted.styles?.s1).toEqual({ run: { bold: true } });
    expect(containsKeyAnywhere(minted.children, "styleId")).toBe(true);
    expect(containsKeyAnywhere(minted.styles, "styleId")).toBe(false);
    expect(containsKeyAnywhere(minted.children, "sourcePath")).toBe(true);
    expect(containsKeyAnywhere(minted.styles, "sourcePath")).toBe(false);
    expect(containsKeyAnywhere(minted.children, "frames")).toBe(true);
    expect(containsKeyAnywhere(minted.styles, "frames")).toBe(false);
  });

  it("factors the page-break properties into a styles-table entry when they repeat, the landing the paragraph-half field set gives them", () => {
    const doc = wordprocessingDoc([
      paragraph([run("one")], { pageBreakBefore: true }),
      paragraph([run("two")], { pageBreakBefore: true }),
    ]);
    const minted = assembleTree(doc);
    expect(refsOf(minted)).toEqual([{ ref: "s1", nodeKind: "section" }]);
    expect(minted.styles?.s1).toEqual({ paragraph: { pageBreakBefore: true } });
    const flat = flattenTree(minted);
    if (flat.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    expect(
      flat.sections[0]?.blocks.every(
        (block) => block.kind === "paragraph" && block.pageBreakBefore === true,
      ),
    ).toBe(true);
  });

  it("mints run tuples on the wrapper whose extent covers the runs, stripping them from the runs", () => {
    const body = shapeBlocks(
      paragraph([run("a", { bold: true, sizePt: 12 })]),
      paragraph([run("b", { bold: true, sizePt: 12 })]),
    );
    const doc: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [
        { size: { widthPt: 960, heightPt: 540 }, shapes: [body], notes: "" },
      ],
    };
    const minted = assembleTree(doc);
    // Outermost-first: the slide wrapper's extent already covers both shape flows, so it (not the deeper shape group) carries the ref -- one entry styles every run in the slide, which is exactly the "slide body text" case the rule exists for.
    expect(refsOf(minted)).toEqual([{ ref: "s1", nodeKind: "slide" }]);
    expect(minted.styles?.s1).toEqual({ run: { bold: true, sizePt: 12 } });
    const flat = flattenTree(minted);
    if (flat.kind !== "presentation") throw new Error("expected presentation");
    const runs = flat.slides[0]!.shapes[0]!.blocks.flatMap((block) =>
      block.kind === "paragraph" ? block.runs : [],
    );
    expect(runs).toEqual([
      run("a", { bold: true, sizePt: 12 }),
      run("b", { bold: true, sizePt: 12 }),
    ]);
  });

  it("freezes an ancestor's minted key for nested wrappers -- a deeper different value never shadows the ref that restores it", () => {
    const h1 = paragraph([run("Chapter")], {
      headingLevel: 1,
      indentLeftPt: 20,
    });
    const body1 = paragraph([run("one")], { indentLeftPt: 20 });
    const body2 = paragraph([run("two")], { indentLeftPt: 20 });
    const h2 = paragraph([run("Part")], { headingLevel: 2, indentLeftPt: 40 });
    const body3 = paragraph([run("three")], { indentLeftPt: 40 });
    const body4 = paragraph([run("four")], { indentLeftPt: 40 });
    const doc = wordprocessingDoc([h1, body1, body2, h2, body3, body4]);
    const minted = assembleTree(doc);
    // The section mints {indentLeftPt: 20} (three positions: the H1 anchor and its two body leaves -- the H2 branch carries a different value and stays inline). indentLeftPt is then frozen for every wrapper below, so the H2 group -- whose extent shares {indentLeftPt: 40} three times -- mints nothing: re-minting the key with 40 would silently rewrite the value the section's ref restores for the stripped 20-positions in nothing, but would shadow it for any nested stripped position, and freezing is the rule that keeps the two namespaces apart.
    expect(refsOf(minted)).toEqual([{ ref: "s1", nodeKind: "section" }]);
    expect(minted.styles?.s1).toEqual({ paragraph: { indentLeftPt: 20 } });
    if (minted.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    // The H2 nests INSIDE the still-open H1 group (decompose's stack), so find it by text anywhere in the tree.
    const h2Group = findGroupByText(minted, "Part");
    expect(h2Group).toMatchObject({
      node: { kind: "paragraph", headingLevel: 2, indentLeftPt: 40 },
    });
    expect(h2Group).not.toHaveProperty("style");
    // Resolution restores the stripped positions exactly and leaves the H2 branch alone: gap-fill on the section's chain returns indentLeftPt 20 to the stripped three, and the inline 40s win where they sit.
    const flat = flattenTree(minted);
    if (flat.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const indents = flat.sections[0]!.blocks.map((block) =>
      block.kind === "paragraph" ? block.indentLeftPt : undefined,
    );
    expect(indents).toEqual([20, 20, 20, 40, 40, 40]);
  });

  it("orders entries by descending frequency and mints deterministically", () => {
    const doc: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          ...SECTION,
          blocks: [
            paragraph([run("a")], { alignment: "center" }),
            paragraph([run("b")], { alignment: "center" }),
          ],
        },
        {
          ...SECTION,
          blocks: [
            paragraph([run("c")], { lineSpacing: 1.5 }),
            paragraph([run("d")], { lineSpacing: 1.5 }),
            paragraph([run("e")], { lineSpacing: 1.5 }),
          ],
        },
      ],
    };
    const minted = assembleTree(doc);
    // lineSpacing occurs on three positions (section two), alignment on two (section one): the more frequent entry takes s1 regardless of document order, and the same input mints the identical tree twice.
    expect(minted.styles && Object.keys(minted.styles)).toEqual(["s1", "s2"]);
    expect(minted.styles?.s1).toEqual({ paragraph: { lineSpacing: 1.5 } });
    expect(minted.styles?.s2).toEqual({ paragraph: { alignment: "center" } });
    expect(canon(assembleTree(doc))).toEqual(canon(minted));
  });

  it("is idempotent: factoring a second time mints the identical table and tree", () => {
    const doc = wordprocessingDoc([
      paragraph([run("one", { bold: true })], {
        indentLeftPt: 20,
        alignment: "left",
      }),
      paragraph([run("two", { bold: true })], {
        indentLeftPt: 20,
        alignment: "left",
      }),
    ]);
    const once = assembleTree(doc);
    const twice = factorStyles(once);
    expect(canon(twice)).toEqual(canon(once));
    expect(twice.styles).toEqual(once.styles);
  });

  it("carries a package's definitions table through re-factoring untouched", () => {
    const doc = wordprocessingDoc([
      paragraph([run("one")], { indentLeftPt: 20 }),
      paragraph([run("two")], { indentLeftPt: 20 }),
    ]);
    const minted = assembleTree(doc);
    // definitions is package-root caller data the flat ContentDocument cannot spell, so re-factoring must hand it back verbatim -- dropping it would silently lose the table on every factorStyles round trip. Minting still runs: the indent tuple mints s1 alongside the carried definitions.
    const withDefinitions: DocumentTree = {
      ...minted,
      definitions: { tenantNote: { kind: "tenant-note" } },
    };
    const refactored = factorStyles(withDefinitions);
    expect(refactored.definitions).toEqual({
      tenantNote: { kind: "tenant-note" },
    });
    expect(refactored.styles?.s1).toEqual({ paragraph: { indentLeftPt: 20 } });
    expect(DocumentTreeSchema.safeParse(refactored).success).toBe(true);
  });

  it("carries a package's embedded font faces through re-factoring untouched", () => {
    const doc = wordprocessingDoc([
      paragraph([run("one")], { indentLeftPt: 20 }),
      paragraph([run("two")], { indentLeftPt: 20 }),
    ]);
    const minted = assembleTree(doc);
    // fonts is package-root caller data the flat ContentDocument cannot spell (bytes are a package fact no content node owns), so re-factoring must hand it back verbatim -- dropping it would silently lose the source's own faces on every factorStyles round trip and a later rebuild would regress to vendored substitutes without anything failing.
    const withFonts: DocumentTree = {
      ...minted,
      fonts: [
        { family: "Body Face", bold: false, italic: false, base64: "AAECAw==" },
        { family: "Body Face", bold: true, italic: false, base64: "AAECBA==" },
      ],
    };
    const refactored = factorStyles(withFonts);
    expect(refactored.fonts).toEqual([
      { family: "Body Face", bold: false, italic: false, base64: "AAECAw==" },
      { family: "Body Face", bold: true, italic: false, base64: "AAECBA==" },
    ]);
    expect(refactored.styles?.s1).toEqual({ paragraph: { indentLeftPt: 20 } });
    expect(DocumentTreeSchema.safeParse(refactored).success).toBe(true);
  });

  it("carries a package's source residue table through re-factoring untouched, and never factors residue into a styles entry", () => {
    const doc = wordprocessingDoc([
      paragraph([run("one")], {
        indentLeftPt: 20,
        source: { format: "docx", xml: "<w:proofErr/>" },
      }),
      paragraph([run("two")], {
        indentLeftPt: 20,
        source: { format: "docx", xml: "<w:proofErr/>" },
      }),
    ]);
    const minted = assembleTree(doc);
    // The per-node residue must ride the round trip on the paragraphs themselves (minting strips only mintable style keys -- residue is not one and never becomes one), and the package-level table must come back verbatim for the same reason definitions does.
    const withResidue: DocumentTree = {
      ...minted,
      source: { "word/settings.xml": { format: "docx", xml: "<w:settings/>" } },
    };
    const refactored = factorStyles(withResidue);
    expect(refactored.source).toEqual({
      "word/settings.xml": { format: "docx", xml: "<w:settings/>" },
    });
    expect(refactored.styles?.s1).toEqual({ paragraph: { indentLeftPt: 20 } });
    const flat = flattenTree(refactored);
    if (flat.kind !== "wordprocessing")
      throw new Error("flatten must return the wordprocessing arm");
    expect(flat.sections[0]?.blocks[0]).toMatchObject({
      source: { format: "docx", xml: "<w:proofErr/>" },
    });
    expect(JSON.stringify(refactored.styles)).not.toContain("proofErr");
  });

  it("keeps flat output free of refs and effective-equal to the unfactored form, combining halves on one wrapper", () => {
    const doc = wordprocessingDoc([
      paragraph([run("one", { bold: true, sizePt: 14 })], {
        indentLeftPt: 20,
        alignment: "left",
      }),
      paragraph([run("two", { bold: true, sizePt: 14 })], {
        indentLeftPt: 20,
        alignment: "left",
      }),
      paragraph([run("three", { sizePt: 14 })], {
        indentLeftPt: 20,
        alignment: "left",
      }),
    ]);
    const minted = assembleTree(doc);
    // Every extent paragraph carries alignment+indentLeftPt and every run carries sizePt, so the section's one entry combines the paragraph half (three stripped positions) with the run half (three stripped runs); bold occurs on only two of the three runs, so it is not common and stays inline everywhere.
    expect(minted.styles?.s1).toEqual({
      paragraph: { alignment: "left", indentLeftPt: 20 },
      run: { sizePt: 14 },
    });
    expect(refsOf(minted)).toEqual([{ ref: "s1", nodeKind: "section" }]);
    const flat = flattenTree(minted);
    expect(containsKeyAnywhere(flat, "style")).toBe(false);
    expect(canon(flat)).toEqual(canon(doc));
    // Law (ii) in its direct form: the factored tree's materialised flat form IS the unfactored content, key for key (a wrapper carrying a ref the styles table does not back is malformed, so the comparison runs against the original document rather than a ref-stripped tree).
  });

  it("strips by copying, never mutating the input content", () => {
    const p1 = paragraph([run("one")], { indentLeftPt: 20 });
    const p2 = paragraph([run("two")], { indentLeftPt: 20 });
    const doc = wordprocessingDoc([p1, p2]);
    const snapshot = structuredClone(doc);
    assembleTree(doc);
    expect(doc).toEqual(snapshot);
    expect(p1.indentLeftPt).toBe(20);
    expect(p2.indentLeftPt).toBe(20);
  });

  it("strips an aliased node at every position whose own chain minted -- identical tuple, both sibling wrappers mint", () => {
    const shared = paragraph([run("a")], {
      alignment: "center",
      indentLeftPt: 20,
    });
    const doc: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          ...SECTION,
          blocks: [
            shared,
            paragraph([run("b")], { alignment: "center", indentLeftPt: 20 }),
          ],
        },
        {
          ...SECTION,
          blocks: [
            shared,
            paragraph([run("c")], { alignment: "center", indentLeftPt: 20 }),
          ],
        },
      ],
    };
    const minted = assembleTree(doc);
    // Both sections' extents hold two matching positions (the shared node plus a sibling leaf), so each mints the identical entry content and shares ONE table entry through the canonical key -- two refs, one row. Global factored bookkeeping would mark the shared node done at the first section, leaving the second position's chain ref-less while a node-keyed strip still took its properties; branch-scoped, both positions resolve their own ref back.
    expect(refsOf(minted)).toEqual([
      { ref: "s1", nodeKind: "section" },
      { ref: "s1", nodeKind: "section" },
    ]);
    expect(minted.styles?.s1).toEqual({
      paragraph: { alignment: "center", indentLeftPt: 20 },
    });
    const flat = flattenTree(minted);
    expect(canon(flat)).toEqual(canon(doc));
  });

  it("strips an aliased node by its own branch's key set when sibling wrappers mint divergent entries", () => {
    const shared = paragraph([run("a")], {
      alignment: "center",
      indentLeftPt: 20,
    });
    const doc: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          ...SECTION,
          blocks: [shared, paragraph([run("b")], { alignment: "center" })],
        },
        {
          ...SECTION,
          blocks: [
            shared,
            paragraph([run("c")], { alignment: "center", indentLeftPt: 20 }),
          ],
        },
      ],
    };
    const minted = assembleTree(doc);
    // Section one's extent shares only alignment (its second paragraph carries no indent), so it mints the alignment-only entry and strips just that key off the shared node's first position; section two's extent shares both keys and mints the wider entry. Whichever section plans second would overwrite a node-keyed global strip's key set, leaving the first position stripped of indentLeftPt with a ref that restores only alignment; per-wrapper strips keep each position's strip the set its own ref restores.
    expect(minted.styles?.s1).toEqual({ paragraph: { alignment: "center" } });
    expect(minted.styles?.s2).toEqual({
      paragraph: { alignment: "center", indentLeftPt: 20 },
    });
    if (minted.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const flat = flattenTree(minted);
    if (flat.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    expect(flat.sections[0]!.blocks[0]).toMatchObject({
      alignment: "center",
      indentLeftPt: 20,
    });
    expect(flat.sections[1]!.blocks[0]).toMatchObject({
      alignment: "center",
      indentLeftPt: 20,
    });
    expect(canon(flat)).toEqual(canon(doc));
  });

  it("leaves an aliased node fully inline at a position whose own chain minted nothing", () => {
    const shared = paragraph([run("a")], { indentLeftPt: 20 });
    const doc: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          ...SECTION,
          blocks: [shared, paragraph([run("b")], { indentLeftPt: 20 })],
        },
        { ...SECTION, blocks: [shared] },
      ],
    };
    const minted = assembleTree(doc);
    // Section one mints (two matching positions); section two's extent is the aliased node alone -- a singleton, below the threshold -- so its chain carries no ref and the node must keep every property inline there: a node-keyed global strip would strip it at BOTH positions with no ref to restore the second.
    expect(refsOf(minted)).toEqual([{ ref: "s1", nodeKind: "section" }]);
    expect(minted.styles?.s1).toEqual({ paragraph: { indentLeftPt: 20 } });
    if (minted.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    expect(minted.children[1]?.children[0]).toMatchObject({
      kind: "paragraph",
      indentLeftPt: 20,
    });
    const flat = flattenTree(minted);
    expect(canon(flat)).toEqual(canon(doc));
  });

  it("mints nothing for a formula package (one leaf, no wrappers)", () => {
    const doc: ContentDocument = {
      kind: "formula",
      metadata: {},
      formula: { mathml: [] },
    };
    const minted = assembleTree(doc);
    expect(minted.styles).toBeUndefined();
    expect(DocumentTreeSchema.safeParse(minted).success).toBe(true);
  });

  it("factors a paragraph tuple nested inside a construct group's children onto the construct group's own ref (document-schema.js 4.1.0)", () => {
    // mint() run directly on a hand-built tree, rather than through assembleTree, so extentOf/flowExtent's construct-group recognition is asserted on exactly the tree shape stated here -- independent of which flat marker placement decompose would have promoted to it.
    const outside = paragraph([run("outside")], { alignment: "right" });
    const insideA = paragraph([run("a")], { indentLeftPt: 20 });
    const insideB = paragraph([run("b")], { indentLeftPt: 20 });
    const constructGroup: SectionConstructGroupNode = {
      node: { kind: "contentControl", controlType: "richText" },
      children: [insideA, insideB],
    };
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
    // Rule 1 (every extent paragraph must carry a minted key) means the section's own three-paragraph extent shares no key across all three -- outside lacks indentLeftPt, insideA/insideB lack alignment -- so the section wrapper itself mints nothing. Only once the walk descends INTO the construct group's own two-paragraph extent (proof extentOf/flowExtent recurse into a construct group's children rather than stopping at or skipping it) does indentLeftPt become common there and mint.
    expect(refsOf(minted)).toEqual([{ ref: "s1", nodeKind: "contentControl" }]);
    expect(minted.styles?.s1).toEqual({ paragraph: { indentLeftPt: 20 } });
    if (minted.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const mintedSection = minted.children[0];
    if (mintedSection === undefined)
      throw new Error("expected the section group");
    const mintedConstruct = mintedSection.children[1];
    if (
      mintedConstruct === undefined ||
      !("node" in mintedConstruct) ||
      !("children" in mintedConstruct)
    ) {
      throw new Error("expected the construct group to survive minting");
    }
    expect(mintedConstruct.style).toBe("s1");
    expect(mintedConstruct.children[0]).not.toHaveProperty("indentLeftPt");
    expect(mintedConstruct.children[1]).not.toHaveProperty("indentLeftPt");
  });

  it("factors a paragraph tuple nested inside a shape-flow construct group onto the construct group's own ref (document-schema.js 4.1.0)", () => {
    // The section-flow test above exercises rebuildSectionConstructGroup and the isConstructGroup arm in rebuildSectionChild; this mirrors it through the shape/list-flow vocabulary instead -- a ShapeConstructGroupNode sat inside a ShapeGroupNode's own children, nested under a SlideGroupNode -- so rebuildShapeConstructGroup and the isConstructGroup dispatch arm in rebuildListChild get their own coverage rather than riding untested on the section-flow rebuilder's coattails.
    const outside = paragraph([run("outside")], { alignment: "right" });
    const insideA = paragraph([run("a")], { indentLeftPt: 20 });
    const insideB = paragraph([run("b")], { indentLeftPt: 20 });
    const constructGroup: ShapeConstructGroupNode = {
      node: { kind: "contentControl", controlType: "richText" },
      children: [insideA, insideB],
    };
    const shapeGroup: ShapeGroupNode = {
      node: {
        frame: { xPt: 0, yPt: 0, widthPt: 400, heightPt: 300 },
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
    // Neither the slide's nor the shape's own extent shares a key across all three paragraphs (outside lacks indentLeftPt, insideA/insideB lack alignment), so both mint nothing; only descending into the construct group's own two-paragraph extent makes indentLeftPt common there and mints.
    expect(refsOf(minted)).toEqual([{ ref: "s1", nodeKind: "contentControl" }]);
    expect(minted.styles?.s1).toEqual({ paragraph: { indentLeftPt: 20 } });
    if (minted.kind !== "presentation")
      throw new Error("expected presentation");
    const mintedSlide = minted.children[0];
    if (mintedSlide === undefined) throw new Error("expected the slide group");
    const mintedShape = mintedSlide.children[0];
    if (mintedShape === undefined) throw new Error("expected the shape group");
    const mintedConstruct = mintedShape.children[1];
    if (
      mintedConstruct === undefined ||
      !("node" in mintedConstruct) ||
      !("children" in mintedConstruct)
    ) {
      throw new Error("expected the construct group to survive minting");
    }
    expect(mintedConstruct.style).toBe("s1");
    expect(mintedConstruct.children[0]).not.toHaveProperty("indentLeftPt");
    expect(mintedConstruct.children[1]).not.toHaveProperty("indentLeftPt");
  });

  it("aggregates paragraphs across a draw page's own separate shapes into one draw-page-level extent, minting on the draw page itself when neither shape alone reaches the threshold", () => {
    // Each shape carries exactly one matching paragraph -- a singleton, below the mint threshold, at that shape's own level -- so only the draw page's own extentOf, walking across BOTH shapes (and skipping the sibling vector, which carries no paragraphs), can find the frequency-2 match and mint on itself.
    const p1 = paragraph([run("a")], { alignment: "center" });
    const p2 = paragraph([run("b")], { alignment: "center" });
    const shape1: ShapeGroupNode = {
      node: {
        frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
        insetLeftPt: 0,
        insetTopPt: 0,
        insetRightPt: 0,
        insetBottomPt: 0,
      },
      children: [p1],
    };
    const shape2: ShapeGroupNode = {
      node: {
        frame: { xPt: 100, yPt: 0, widthPt: 100, heightPt: 100 },
        insetLeftPt: 0,
        insetTopPt: 0,
        insetRightPt: 0,
        insetBottomPt: 0,
      },
      children: [p2],
    };
    const vector: ContentVector = {
      kind: "rect",
      frame: { xPt: 0, yPt: 100, widthPt: 50, heightPt: 50 },
    };
    const drawPageGroup: DrawPageGroupNode = {
      node: { kind: "drawPage", size: { widthPt: 300, heightPt: 300 } },
      children: [shape1, shape2, vector],
    };
    const pkg: DocumentTree = {
      kind: "drawing",
      metadata: {},
      children: [drawPageGroup],
    };
    const minted = mint(pkg);
    expect(refsOf(minted)).toEqual([{ ref: "s1", nodeKind: "drawPage" }]);
    expect(minted.styles?.s1).toEqual({ paragraph: { alignment: "center" } });
    if (minted.kind !== "drawing") throw new Error("expected drawing");
    const mintedPage = minted.children[0];
    if (mintedPage === undefined) throw new Error("expected the draw page");
    expect(mintedPage.style).toBe("s1");
    const mintedShape1 = mintedPage.children[0];
    const mintedShape2 = mintedPage.children[1];
    if (
      mintedShape1 === undefined ||
      !("node" in mintedShape1) ||
      mintedShape2 === undefined ||
      !("node" in mintedShape2)
    )
      throw new Error("expected both shapes to survive minting");
    expect(mintedShape1.children[0]).not.toHaveProperty("alignment");
    expect(mintedShape2.children[0]).not.toHaveProperty("alignment");
    // The vector rides through untouched, proving the draw-page walk skips it rather than choking on its lack of a `node`/`children` shape.
    expect(mintedPage.children[2]).toEqual(vector);
  });

  it("mints through a construct promoted from flat marker blocks, and the tree it produces flattens back", () => {
    // The two tests above hand mint() a tree directly; this one comes the whole way round -- flat content carrying a constructStart/constructEnd pair, through assembleTree (decompose then mint), and back through flattenTree. It is the end-to-end proof that minting and the promotion compose: a construct group manufactured by decompose is an ordinary mint wrapper, and a minted tree containing one is still flattenable.
    const doc = wordprocessingDoc([
      paragraph([run("outside")], { alignment: "right" }),
      {
        kind: "constructStart",
        descriptor: { kind: "contentControl", controlType: "richText" },
      },
      paragraph([run("a")], { indentLeftPt: 20 }),
      paragraph([run("b")], { indentLeftPt: 20 }),
      { kind: "constructEnd" },
    ]);
    const minted = assembleTree(doc);
    expect(DocumentTreeSchema.safeParse(minted).success).toBe(true);
    expect(refsOf(minted)).toEqual([{ ref: "s1", nodeKind: "contentControl" }]);
    expect(minted.styles?.s1).toEqual({ paragraph: { indentLeftPt: 20 } });
    expect(canon(flattenTree(minted))).toEqual(canon(doc));
  });

  it("resolves an ancestor heading's ref onto a paragraph nested inside a construct -- a construct extends the style chain, never resets it", () => {
    // The chain axis, stated on its own because it is the one place a construct differs from the section/slide/sheet/draw-page roots: those start a brand new empty chain, a construct extends the incoming one. A construct is a semantic wrapper sitting inside ambient content, so `inside` must come back carrying the heading group's factored alignment exactly as `a` (its sibling outside the construct) does -- if flatten reset the chain at the construct boundary, `inside` would flatten back stripped and law (i) would fail on it.
    const doc = wordprocessingDoc([
      // `intro` carries no alignment, so the SECTION wrapper's own four-paragraph extent shares no mintable key and mints nothing -- which is what puts the ref on the heading group specifically rather than on an ancestor that happens to cover everything.
      paragraph([run("intro")]),
      paragraph([run("Chapter")], { headingLevel: 1, alignment: "center" }),
      paragraph([run("a")], { alignment: "center" }),
      {
        kind: "constructStart",
        descriptor: { kind: "field", instruction: "PAGE" },
      },
      paragraph([run("inside")], { alignment: "center" }),
      { kind: "constructEnd" },
    ]);
    const minted = assembleTree(doc);
    expect(refsOf(minted)).toEqual([{ ref: "s1", nodeKind: "paragraph" }]);
    expect(minted.styles?.s1).toEqual({ paragraph: { alignment: "center" } });
    const heading = findGroupByText(minted, "Chapter");
    if (heading === undefined) throw new Error("expected the heading group");
    expect(heading.style).toBe("s1");
    // The nested paragraph was stripped by the heading's entry (no ref of its own on the construct group), and flatten restores it from that ancestor entry.
    expect(containsKeyAnywhere(minted.children, "alignment")).toBe(false);
    expect(canon(flattenTree(minted))).toEqual(canon(doc));
  });

  it("omits symbolTable from the envelope when the content carries none, and carries it through by value when present", () => {
    const withoutTable = assembleTree(wordprocessingDoc([]));
    expect("symbolTable" in withoutTable).toBe(false);
    const withTable = assembleTree({
      ...wordprocessingDoc([]),
      symbolTable: { symbols: [], units: [] },
    });
    expect(withTable.symbolTable).toEqual({ symbols: [], units: [] });
  });

  it("omits pages from the envelope when none is passed, and carries the exact array through by value when one is", () => {
    const withoutPages = assembleTree(wordprocessingDoc([]));
    expect("pages" in withoutPages).toBe(false);
    const pages = [{ widthPt: 600, heightPt: 800 }];
    const withPages = assembleTree(wordprocessingDoc([]), pages);
    expect(withPages.pages).toEqual([{ widthPt: 600, heightPt: 800 }]);
  });

  it("omits names from a spreadsheet's envelope when absent, and carries them through when present", () => {
    const doc: ContentDocument = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [],
    };
    const withoutNames = assembleTree(doc);
    if (withoutNames.kind !== "spreadsheet")
      throw new Error("expected spreadsheet");
    expect("names" in withoutNames).toBe(false);
    const withNames = assembleTree({
      ...doc,
      names: [{ name: "Total", refersTo: "Sheet1!$A$1:$A$10" }],
    });
    if (withNames.kind !== "spreadsheet")
      throw new Error("expected spreadsheet");
    expect(withNames.names).toEqual([
      { name: "Total", refersTo: "Sheet1!$A$1:$A$10" },
    ]);
  });

  it("omits each of definitions/fonts/source individually when that one field is absent, even though the other two are present", () => {
    const minted = assembleTree(wordprocessingDoc([]));
    const noFonts = factorStyles({
      ...minted,
      definitions: { tenantNote: { kind: "tenant-note" } },
      source: { "word/settings.xml": { format: "docx", xml: "<x/>" } },
    });
    expect("fonts" in noFonts).toBe(false);
    const noDefinitions = factorStyles({
      ...minted,
      fonts: [{ family: "Body", bold: false, italic: false, base64: "AA==" }],
      source: { "word/settings.xml": { format: "docx", xml: "<x/>" } },
    });
    expect("definitions" in noDefinitions).toBe(false);
    const noSource = factorStyles({
      ...minted,
      definitions: { tenantNote: { kind: "tenant-note" } },
      fonts: [{ family: "Body", bold: false, italic: false, base64: "AA==" }],
    });
    expect("source" in noSource).toBe(false);
    // And when none of the three is present at all, none of the three keys is spread onto the result.
    const bare = factorStyles(minted);
    expect("definitions" in bare).toBe(false);
    expect("fonts" in bare).toBe(false);
    expect("source" in bare).toBe(false);
  });

  it("orders styles-table entries by descending frequency, not by which tuple's frequency-2 group happens to be found first", () => {
    // Five paragraphs sharing one common key (alignment) so commonParagraphKeys admits it across the whole extent; the first two occurrences form a frequency-2 group encountered first, the next three form a frequency-3 group encountered second. A tie-break-only comparator (dropping the `>` frequency check) would keep the first-found group as best regardless of the second group's larger size.
    const doc = wordprocessingDoc([
      paragraph([run("a")], { alignment: "left" }),
      paragraph([run("b")], { alignment: "left" }),
      paragraph([run("c")], { alignment: "right" }),
      paragraph([run("d")], { alignment: "right" }),
      paragraph([run("e")], { alignment: "right" }),
    ]);
    const minted = assembleTree(doc);
    expect(minted.styles?.s1).toEqual({ paragraph: { alignment: "right" } });
  });

  it("orders three same-frequency entries by ascending first-visit index, not by an order the tie-break arithmetic happens to produce", () => {
    const doc: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          ...SECTION,
          blocks: [
            paragraph([run("a")], { alignment: "left" }),
            paragraph([run("b")], { alignment: "left" }),
          ],
        },
        {
          ...SECTION,
          blocks: [
            paragraph([run("c")], { lineSpacing: 1.5 }),
            paragraph([run("d")], { lineSpacing: 1.5 }),
          ],
        },
        {
          ...SECTION,
          blocks: [
            paragraph([run("e")], { spacingBeforePt: 6 }),
            paragraph([run("f")], { spacingBeforePt: 6 }),
          ],
        },
      ],
    };
    const minted = assembleTree(doc);
    expect(minted.styles?.s1).toEqual({ paragraph: { alignment: "left" } });
    expect(minted.styles?.s2).toEqual({ paragraph: { lineSpacing: 1.5 } });
    expect(minted.styles?.s3).toEqual({
      paragraph: { spacingBeforePt: 6 },
    });
  });

  it("never re-selects a paragraph an ancestor already factored, even for an unrelated, unfrozen key shared only by that already-factored position and its sibling", () => {
    // body2 sits before the heading (section-root sibling); h1 and body1 nest inside the heading's own flow. All three share indentLeftPt, so the section mints it, freezing indentLeftPt and factoring [body2, h1, body1]. h1 and body1 ALSO share alignment (an unfrozen key) -- if the heading group's own candidate search failed to skip already-factored positions, it would mint a second, spurious entry for [h1, body1] on alignment.
    const body2 = paragraph([run("two")], { indentLeftPt: 20 });
    const h1 = paragraph([run("Chapter")], {
      headingLevel: 1,
      indentLeftPt: 20,
      alignment: "center",
    });
    const body1 = paragraph([run("one")], {
      indentLeftPt: 20,
      alignment: "center",
    });
    const doc = wordprocessingDoc([body2, h1, body1]);
    const minted = assembleTree(doc);
    expect(Object.keys(minted.styles ?? {})).toEqual(["s1"]);
    expect(minted.styles?.s1).toEqual({ paragraph: { indentLeftPt: 20 } });
  });

  it("never re-selects a run an ancestor already factored, even for an unrelated, unfrozen run key shared only by that already-factored run and a sibling run", () => {
    const body2 = paragraph([run("two", { bold: true })]);
    const h1 = paragraph([run("Chapter", { bold: true, italic: true })], {
      headingLevel: 1,
    });
    const body1 = paragraph([run("one", { bold: true, italic: true })]);
    const doc = wordprocessingDoc([body2, h1, body1]);
    const minted = assembleTree(doc);
    // The section mints run:{bold:true} across all three runs, factoring them. h1's and body1's runs also share italic:true, but both are already factored -- the heading group must find nothing rather than double-mint.
    expect(Object.keys(minted.styles ?? {})).toEqual(["s1"]);
    expect(minted.styles?.s1).toEqual({ run: { bold: true } });
  });

  it("restores an ancestor's strip for a paragraph even though a NESTED wrapper's own chain link (recorded for OTHER positions) has nothing for that same paragraph", () => {
    // Q and P (the heading anchor) share indentLeftPt:20 -- R and S (nested inside P's own flow) share a DIFFERENT indentLeftPt value purely so indentLeftPt is common across the section's whole extent (required for the section to consider it at all); the tie between the two same-size value-groups resolves to document order, so the section mints indentLeftPt:20 over [Q, P] specifically. R and S ALSO share alignment with P, but P is already factored by the section's own mint, so the heading group's own candidate search skips P and mints alignment over [R, S] alone -- giving the heading its OWN chain link, one that says nothing about P. P's own strip must still come from the SECTION's link, not be wiped out because the heading's (more nested) link has no entry for it.
    const q = paragraph([run("q")], { indentLeftPt: 20 });
    const p = headingParagraph([run("Chapter")], 1, {
      indentLeftPt: 20,
      alignment: "center",
    });
    const r = paragraph([run("r")], { indentLeftPt: 99, alignment: "center" });
    const s = paragraph([run("s")], { indentLeftPt: 99, alignment: "center" });
    const headingGroup: HeadingGroupNode = { node: p, children: [r, s] };
    const sectionGroup: SectionGroupNode = {
      node: { kind: "section", ...SECTION },
      children: [q, headingGroup],
    };
    const pkg: DocumentTree = {
      kind: "wordprocessing",
      metadata: {},
      children: [sectionGroup],
    };
    const minted = mint(pkg);
    expect(minted.styles?.s1).toEqual({ paragraph: { indentLeftPt: 20 } });
    expect(minted.styles?.s2).toEqual({ paragraph: { alignment: "center" } });
    if (minted.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const mintedHeading = minted.children[0]?.children[1];
    if (
      mintedHeading === undefined ||
      !("node" in mintedHeading) ||
      !("children" in mintedHeading)
    )
      throw new Error("expected the heading group to survive minting");
    // The heading minted its OWN entry (s2, over r/s), so it carries its own ref -- but its anchor must still reflect the SECTION's strip, not just its own.
    expect(mintedHeading.style).toBe("s2");
    const mintedAnchor = ContentParagraphSchema.parse(mintedHeading.node);
    expect(mintedAnchor).not.toHaveProperty("indentLeftPt");
    expect(mintedAnchor.alignment).toBe("center");
  });

  it("sums a wrapper's own combined paragraph-half and run-half positions into one frequency, rather than letting one half's count cancel the other's", () => {
    // Section X mints BOTH halves on one wrapper: 2 paragraphs (alignment) and 3 runs (bold, since p1 carries two bold runs and p2 one) -- a correctly-summed frequency of 5. Section Y mints only a paragraph half with frequency 2. 5 > 2, so X must rank first; a frequency computed by subtracting the run count from the paragraph count would give X a frequency of -1, putting Y first instead.
    const doc: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          ...SECTION,
          blocks: [
            paragraph([run("a", { bold: true }), run("b", { bold: true })], {
              alignment: "left",
            }),
            paragraph([run("c", { bold: true })], { alignment: "left" }),
          ],
        },
        {
          ...SECTION,
          blocks: [
            paragraph([run("d")], { lineSpacing: 1.5 }),
            paragraph([run("e")], { lineSpacing: 1.5 }),
          ],
        },
      ],
    };
    const minted = assembleTree(doc);
    expect(minted.styles?.s1).toEqual({
      paragraph: { alignment: "left" },
      run: { bold: true },
    });
    expect(minted.styles?.s2).toEqual({ paragraph: { lineSpacing: 1.5 } });
  });

  it("adds a second wrapper's contribution onto an already-registered identical entry's frequency, rather than subtracting it or dropping the run half of the addend", () => {
    // Sections A and B each independently mint the IDENTICAL combined entry (paragraph:{alignment:left}, run:{bold:true}), each contributing frequency 2+2=4 from its own two paragraphs/two runs -- correctly merging to 8. Section C mints a different, single entry with frequency 6, strictly between 4 and 8: a merge that subtracts instead of adds would leave the shared entry at 0, and a merge that adds only the paragraph half of the second contribution (dropping its run half) would leave it at 4 -- both wrongly below 6, flipping the order.
    const matching = (label: string) => [
      paragraph([run(`${label}1`, { bold: true })], { alignment: "left" }),
      paragraph([run(`${label}2`, { bold: true })], { alignment: "left" }),
    ];
    const doc: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        { ...SECTION, blocks: matching("a") },
        { ...SECTION, blocks: matching("b") },
        {
          ...SECTION,
          blocks: Array.from({ length: 6 }, (_, i) =>
            paragraph([run(`c${i}`)], { spacingBeforePt: 6 }),
          ),
        },
      ],
    };
    const minted = assembleTree(doc);
    expect(minted.styles?.s1).toEqual({
      paragraph: { alignment: "left" },
      run: { bold: true },
    });
    expect(minted.styles?.s2).toEqual({
      paragraph: { spacingBeforePt: 6 },
    });
  });

  it("strips a heading anchor via an ancestor's ref even when the heading itself mints nothing (its own ref stays undefined, so the anchor-changed check alone must catch it)", () => {
    // The heading's body is empty, so the ONLY candidate for a mint anywhere is the section's own [q, heading-anchor] pair -- the heading's own plan() call finds nothing (its own extent is just its anchor alone, and indentLeftPt is already frozen), so its ref stays undefined. `unchanged`'s first clause (`ref===undefined`) is therefore true for the heading, and it is the SECOND clause (`anchor===group.node`) that must correctly detect the anchor was rewritten by the section's own strip -- the children clause is vacuously true (empty array) and can't do this alone.
    const q = paragraph([run("q")], { indentLeftPt: 20 });
    const p = headingParagraph([run("Chapter")], 1, { indentLeftPt: 20 });
    const headingGroup: HeadingGroupNode = { node: p, children: [] };
    const sectionGroup: SectionGroupNode = {
      node: { kind: "section", ...SECTION },
      children: [q, headingGroup],
    };
    const pkg: DocumentTree = {
      kind: "wordprocessing",
      metadata: {},
      children: [sectionGroup],
    };
    const minted = mint(pkg);
    expect(refsOf(minted)).toEqual([{ ref: "s1", nodeKind: "section" }]);
    if (minted.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const mintedHeading = minted.children[0]?.children[1];
    if (
      mintedHeading === undefined ||
      !("node" in mintedHeading) ||
      !("children" in mintedHeading)
    )
      throw new Error("expected the heading group");
    expect(mintedHeading).not.toBe(headingGroup);
    expect(mintedHeading).not.toHaveProperty("style");
    expect(mintedHeading.node).not.toHaveProperty("indentLeftPt");
  });

  it("strips a list anchor via an ancestor's ref even when the list group itself mints nothing (its own ref stays undefined, so the anchor-changed check alone must catch it)", () => {
    const q = paragraph([run("q")], { indentLeftPt: 20 });
    const p = listParagraph(
      [run("Item")],
      { numId: "l1", level: 0, format: "bullet" },
      {
        indentLeftPt: 20,
      },
    );
    const listGroup: ListGroupNode = { node: p, children: [] };
    const sectionGroup: SectionGroupNode = {
      node: { kind: "section", ...SECTION },
      children: [q, listGroup],
    };
    const pkg: DocumentTree = {
      kind: "wordprocessing",
      metadata: {},
      children: [sectionGroup],
    };
    const minted = mint(pkg);
    expect(refsOf(minted)).toEqual([{ ref: "s1", nodeKind: "section" }]);
    if (minted.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const mintedList = minted.children[0]?.children[1];
    if (
      mintedList === undefined ||
      !("node" in mintedList) ||
      !("children" in mintedList)
    )
      throw new Error("expected the list group");
    expect(mintedList).not.toBe(listGroup);
    expect(mintedList).not.toHaveProperty("style");
    expect(mintedList.node).not.toHaveProperty("indentLeftPt");
  });

  it("rebuilds a list group as a new object via an ancestor's strip to ONE of its own body children alone -- ref undefined AND anchor untouched, so the children-changed check alone must catch it", () => {
    // outside1 and bodyA share alignment:"left"; the list anchor P and bodyB each carry alignment too (their OWN distinct values, purely for universality across the section's whole extent), so their own singleton value-groups never reach the mint threshold and neither is touched. The section mints alignment:"left" over [outside1, bodyA] specifically -- the list's own anchor is untouched (anchor === group.node stays true) and its own candidate search finds nothing (ref stays undefined), so this isolates the children clause: bodyA changed, bodyB didn't, and `.every(...)` must still say "not all match".
    const outside1 = paragraph([run("outside1")], { alignment: "left" });
    const p = listParagraph(
      [run("Item")],
      { numId: "l1", level: 0, format: "bullet" },
      {
        alignment: "center",
      },
    );
    const bodyA = paragraph([run("a")], { alignment: "left" });
    const bodyB = paragraph([run("b")], { alignment: "justify" });
    const listGroup: ListGroupNode = { node: p, children: [bodyA, bodyB] };
    const sectionGroup: SectionGroupNode = {
      node: { kind: "section", ...SECTION },
      children: [outside1, listGroup],
    };
    const pkg: DocumentTree = {
      kind: "wordprocessing",
      metadata: {},
      children: [sectionGroup],
    };
    const minted = mint(pkg);
    expect(refsOf(minted)).toEqual([{ ref: "s1", nodeKind: "section" }]);
    expect(minted.styles?.s1).toEqual({ paragraph: { alignment: "left" } });
    if (minted.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const mintedList = minted.children[0]?.children[1];
    if (
      mintedList === undefined ||
      !("node" in mintedList) ||
      !("children" in mintedList)
    )
      throw new Error("expected the list group");
    expect(mintedList).not.toBe(listGroup);
    expect(mintedList).not.toHaveProperty("style");
    // The anchor itself was never touched -- it keeps its own distinct alignment value inline.
    const mintedAnchor = ContentParagraphSchema.parse(mintedList.node);
    expect(mintedAnchor.alignment).toBe("center");
    expect(mintedList.children[0]).not.toHaveProperty("alignment");
    expect(mintedList.children[1]).toBe(bodyB);
  });

  it("restores an ancestor's strip for a run even though a NESTED wrapper's own chain link (recorded for OTHER runs) has nothing for that same run", () => {
    const q = paragraph([run("q", { bold: true })]);
    const p = headingParagraph(
      [run("Chapter", { bold: true, italic: true })],
      1,
    );
    // r/s carry bold:false (not merely omit it) so bold is common across the WHOLE section extent (required for the section to consider it at all) -- the true/false split then groups [q,p] apart from [r,s], and the tie between the two same-size groups resolves to document order.
    const r = paragraph([run("r", { bold: false, italic: true })]);
    const s = paragraph([run("s", { bold: false, italic: true })]);
    const headingGroup: HeadingGroupNode = { node: p, children: [r, s] };
    const sectionGroup: SectionGroupNode = {
      node: { kind: "section", ...SECTION },
      children: [q, headingGroup],
    };
    const pkg: DocumentTree = {
      kind: "wordprocessing",
      metadata: {},
      children: [sectionGroup],
    };
    const minted = mint(pkg);
    expect(minted.styles?.s1).toEqual({ run: { bold: true } });
    expect(minted.styles?.s2).toEqual({ run: { italic: true } });
    if (minted.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const mintedHeading = minted.children[0]?.children[1];
    if (
      mintedHeading === undefined ||
      !("node" in mintedHeading) ||
      !("children" in mintedHeading)
    )
      throw new Error("expected the heading group to survive minting");
    expect(mintedHeading.style).toBe("s2");
    const mintedAnchor = ContentParagraphSchema.parse(mintedHeading.node);
    expect(mintedAnchor.runs[0]).not.toHaveProperty("bold");
    expect(mintedAnchor.runs[0]?.italic).toBe(true);
  });

  it("returns a genuinely untouched section, heading group, list group, and construct group by the SAME object reference, even while a sibling section mints something", () => {
    // A sibling section (mintingSection) mints something, so entries.size > 0 and mint() runs the real per-wrapper rebuild walk rather than short-circuiting at the top with `return pkg` -- which would trivially (and uselessly) preserve every reference without ever calling rebuildSectionGroup/rebuildHeadingGroup/rebuildListGroup/rebuildSectionConstructGroup at all. Every paragraph inside untouchedSection is a bare leaf with no mintable property at all, so nothing anywhere inside it ever mints, and every one of those four rebuild functions must return its own input object unchanged.
    const mintingSection: SectionGroupNode = {
      node: { kind: "section", ...SECTION },
      children: [
        paragraph([run("x")], { alignment: "justify" }),
        paragraph([run("y")], { alignment: "justify" }),
      ],
    };
    const headingGroup: HeadingGroupNode = {
      node: headingParagraph([run("Heading")], 1),
      children: [paragraph([run("body")])],
    };
    const listGroup: ListGroupNode = {
      node: listParagraph([run("Item")], {
        numId: "l1",
        level: 0,
        format: "bullet",
      }),
      children: [paragraph([run("item body")])],
    };
    const constructGroup: SectionConstructGroupNode = {
      node: { kind: "contentControl", controlType: "richText" },
      children: [paragraph([run("inside a")]), paragraph([run("inside b")])],
    };
    const untouchedSection: SectionGroupNode = {
      node: { kind: "section", ...SECTION },
      children: [
        headingGroup,
        listGroup,
        constructGroup,
        paragraph([run("trailing")]),
      ],
    };
    const pkg: DocumentTree = {
      kind: "wordprocessing",
      metadata: {},
      children: [mintingSection, untouchedSection],
    };
    const minted = mint(pkg);
    expect(minted.styles?.s1).toEqual({ paragraph: { alignment: "justify" } });
    if (minted.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    expect(minted.children[1]).toBe(untouchedSection);
  });

  it("returns a genuinely untouched slide, shape group, and shape-flow construct group by the same object reference, even while a sibling slide mints something", () => {
    const mintingSlide: SlideGroupNode = {
      node: { kind: "slide", size: { widthPt: 960, heightPt: 540 }, notes: "" },
      children: [
        {
          node: {
            frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
            insetLeftPt: 0,
            insetTopPt: 0,
            insetRightPt: 0,
            insetBottomPt: 0,
          },
          children: [
            paragraph([run("x")], { alignment: "justify" }),
            paragraph([run("y")], { alignment: "justify" }),
          ],
        },
      ],
    };
    const constructGroup: ShapeConstructGroupNode = {
      node: { kind: "contentControl", controlType: "richText" },
      children: [paragraph([run("inside a")]), paragraph([run("inside b")])],
    };
    const untouchedShape: ShapeGroupNode = {
      node: {
        frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
        insetLeftPt: 0,
        insetTopPt: 0,
        insetRightPt: 0,
        insetBottomPt: 0,
      },
      children: [constructGroup, paragraph([run("trailing")])],
    };
    const untouchedSlide: SlideGroupNode = {
      node: { kind: "slide", size: { widthPt: 960, heightPt: 540 }, notes: "" },
      children: [untouchedShape],
    };
    const pkg: DocumentTree = {
      kind: "presentation",
      metadata: {},
      children: [mintingSlide, untouchedSlide],
    };
    const minted = mint(pkg);
    expect(minted.styles?.s1).toEqual({ paragraph: { alignment: "justify" } });
    if (minted.kind !== "presentation")
      throw new Error("expected presentation");
    expect(minted.children[1]).toBe(untouchedSlide);
  });

  it("returns a genuinely untouched draw page by the same object reference, even while a sibling draw page mints something", () => {
    const shapeOf = (blocks: ContentParagraph[]): ShapeGroupNode => ({
      node: {
        frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
        insetLeftPt: 0,
        insetTopPt: 0,
        insetRightPt: 0,
        insetBottomPt: 0,
      },
      children: blocks,
    });
    const mintingPage: DrawPageGroupNode = {
      node: { kind: "drawPage", size: { widthPt: 300, heightPt: 300 } },
      children: [
        shapeOf([paragraph([run("x")], { alignment: "justify" })]),
        shapeOf([paragraph([run("y")], { alignment: "justify" })]),
      ],
    };
    const untouchedPage: DrawPageGroupNode = {
      node: { kind: "drawPage", size: { widthPt: 300, heightPt: 300 } },
      children: [
        shapeOf([paragraph([run("trailing")])]),
        { kind: "rect", frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 } },
      ],
    };
    const pkg: DocumentTree = {
      kind: "drawing",
      metadata: {},
      children: [mintingPage, untouchedPage],
    };
    const minted = mint(pkg);
    expect(minted.styles?.s1).toEqual({ paragraph: { alignment: "justify" } });
    if (minted.kind !== "drawing") throw new Error("expected drawing");
    expect(minted.children[1]).toBe(untouchedPage);
  });

  it("rebuilds a section's children as a new array preserving an untouched sibling's own reference, when exactly one child actually changed -- not a wholesale copy, and not a false 'nothing changed' short-circuit", () => {
    // The heading anchor carries two of its OWN runs sharing bold:true, reaching the mint threshold entirely from its own text -- independent of the section's own candidate search (which shares nothing across [heading anchor, pristine] and so mints nothing itself). This isolates the "one child changed, one didn't" case: `.some()` in place of `.every()` would find the untouched sibling's own match and wrongly call the whole section unchanged, discarding the heading's own rebuild.
    const heading: HeadingGroupNode = {
      node: headingParagraph(
        [run("a", { bold: true }), run("b", { bold: true })],
        1,
      ),
      children: [],
    };
    const pristine = paragraph([run("untouched")]);
    const sectionGroup: SectionGroupNode = {
      node: { kind: "section", ...SECTION },
      children: [heading, pristine],
    };
    const pkg: DocumentTree = {
      kind: "wordprocessing",
      metadata: {},
      children: [sectionGroup],
    };
    const minted = mint(pkg);
    expect(minted.styles?.s1).toEqual({ run: { bold: true } });
    if (minted.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const mintedSection = minted.children[0];
    if (mintedSection === undefined)
      throw new Error("expected the section group");
    expect(mintedSection).not.toBe(sectionGroup);
    expect(mintedSection).not.toHaveProperty("style");
    expect(mintedSection.children[1]).toBe(pristine);
    const mintedHeading = mintedSection.children[0];
    if (
      mintedHeading === undefined ||
      !("node" in mintedHeading) ||
      !("children" in mintedHeading)
    )
      throw new Error("expected the heading group");
    expect(mintedHeading.style).toBe("s1");
    const mintedAnchor = ContentParagraphSchema.parse(mintedHeading.node);
    expect(mintedAnchor.runs[0]).not.toHaveProperty("bold");
    expect(mintedAnchor.runs[1]).not.toHaveProperty("bold");
  });

  it("rebuilds a list group's children the same way -- new array, untouched sibling's own reference preserved, when exactly one child changed", () => {
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
    // outside and insideA share alignment:"left"; insideB carries alignment too (a DIFFERENT value, purely for universality across the shape's own extent), so the SHAPE mints alignment over [outside, insideA] specifically -- freezing alignment before the construct group's own candidate search ever runs. The construct group's own extent ([insideA, insideB]) then shares nothing (alignment is frozen, nothing else matches), so its own ref stays undefined -- but insideA was still stripped via the shape's ref, so the construct's `children.every(...)` check must still detect that change and return a new object, not just short-circuit on its own (never-set) ref.
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
    // Shape1's own extent (its two paragraphs alone) shares alignment, reaching the threshold there; shape2's one paragraph carries no alignment at all, so the SLIDE's own (wider) extent fails commonality and mints nothing itself -- the ref must land on shape1 directly, and its own spread of `style` must actually appear.
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
    // The slide itself carries no ref -- only shape1 does.
    expect(mintedSlide).not.toHaveProperty("style");
    const mintedShape1 = mintedSlide.children[0];
    if (mintedShape1 === undefined) throw new Error("expected shape1");
    expect(mintedShape1.style).toBe("s1");
    expect(mintedShape1.children[0]).not.toHaveProperty("alignment");
  });

  it("rebuilds a shape group's children the same way -- new array, untouched sibling's own reference preserved, when exactly one child changed", () => {
    const changing = paragraph([run("a")], { alignment: "left" });
    const other = paragraph([run("b")], { alignment: "left" });
    // pristine carries alignment too (a DIFFERENT value), purely so alignment is common across the whole extent (required for it to be considered at all) -- its own singleton value-group never reaches the mint threshold, so it stays untouched.
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

  it("rebuilds a draw page's children the same way -- new array, untouched sibling shape's own reference preserved, when exactly one shape changed", () => {
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
    expect(mintedPage.children[1]).toBe(pristineShape);
  });

  it("rebuilds a section-flow construct group's children the same way -- new array, untouched sibling's own reference preserved, when exactly one child changed", () => {
    const changing = paragraph([run("a")], { indentLeftPt: 30 });
    const other = paragraph([run("b")], { indentLeftPt: 30 });
    // pristine carries indentLeftPt too (a DIFFERENT value), purely so the key is common across the whole extent -- its own singleton value-group never reaches the mint threshold.
    const pristine = paragraph([run("untouched")], { indentLeftPt: 99 });
    const constructGroup: SectionConstructGroupNode = {
      node: { kind: "contentControl", controlType: "richText" },
      children: [changing, other, pristine],
    };
    // outside carries no indentLeftPt at all, so the SECTION's own (wider) extent fails commonality and mints nothing itself -- the match is only found once the walk descends into the construct group's own (narrower) extent.
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

  it("rebuilds a shape-flow construct group's children the same way -- new array, untouched sibling's own reference preserved, when exactly one child changed", () => {
    const changing = paragraph([run("a")], { indentLeftPt: 30 });
    const other = paragraph([run("b")], { indentLeftPt: 30 });
    // pristine carries indentLeftPt too (a DIFFERENT value), purely so the key is common across the whole extent -- its own singleton value-group never reaches the mint threshold.
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

// Finds the first group wrapper anywhere in the tree whose anchor paragraph's first run text matches -- the frozen-key test's H2 group sits nested inside the H1 group, not at any fixed depth.
function findGroupByText(
  pkg: DocumentTree,
  text: string,
): { node: unknown; style?: string } | undefined {
  let found: { node: unknown; style?: string } | undefined;
  function walk(value: unknown): void {
    if (found !== undefined) return;
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    if ("node" in value && "children" in value) {
      // Parsed rather than asserted: a group's node is genuinely any of the descriptor/anchor shapes, so the paragraph check has to be a real runtime narrowing.
      const node = ContentParagraphSchema.safeParse(value.node);
      if (node.success && node.data.runs[0]?.text === text) {
        found = value;
        return;
      }
    }
    for (const child of Object.values(value)) walk(child);
  }
  walk(pkg.children);
  return found;
}

function shapeBlocks(...blocks: ContentBlock[]): {
  frame: { xPt: number; yPt: number; widthPt: number; heightPt: number };
  insetLeftPt: number;
  insetTopPt: number;
  insetRightPt: number;
  insetBottomPt: number;
  blocks: ContentBlock[];
} {
  return {
    frame: { xPt: 0, yPt: 0, widthPt: 400, heightPt: 300 },
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks: [...blocks],
  };
}
