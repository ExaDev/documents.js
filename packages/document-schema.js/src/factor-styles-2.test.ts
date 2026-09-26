import { describe, expect, it } from "vitest";
import { canonicalise } from "./canonicalise";
import {
  ContentParagraphSchema,
  type ContentBlock,
  type ContentDocument,
  type ContentParagraph,
} from "./content";
import { type ContentRun } from "./content-vocabulary";

import { assembleTree, factorStyles, mint } from "./factor-styles";
import { flattenTree } from "./flatten";
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

function wordprocessingDoc(
  blocks: readonly ContentBlock[],
  metadata: Record<string, unknown> = {},
): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata,
    sections: [{ ...SECTION, blocks: [...blocks] }],
  };
}

function canon(value: unknown): unknown {
  return JSON.parse(JSON.stringify(canonicalise(value)));
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

describe("factorStyles minting (continued)", () => {
  it("never re-selects a paragraph an ancestor already factored, even for an unrelated, unfrozen key shared only by that already-factored position and its sibling", () => {
    // body2 sits before the heading (section-root sibling); h1 and body1 nest inside the heading's own flow. All three share indentLeftPt, so the section mints it, freezing indentLeftPt and factoring [body2, h1, body1]. h1 and body1 ALSO share alignment (an unfrozen key) — if the heading group's own candidate search failed to skip already-factored positions, it would mint a second, spurious entry for [h1, body1] on alignment.
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
    // The section mints run:{bold:true} across all three runs, factoring them. h1's and body1's runs also share italic:true, but both are already factored — the heading group must find nothing rather than double-mint.
    expect(Object.keys(minted.styles ?? {})).toEqual(["s1"]);
    expect(minted.styles?.s1).toEqual({ run: { bold: true } });
  });

  it("restores an ancestor's strip for a paragraph even though a NESTED wrapper's own chain link (recorded for OTHER positions) has nothing for that same paragraph", () => {
    // Q and P (the heading anchor) share indentLeftPt:20 — R and S (nested inside P's own flow) share a DIFFERENT indentLeftPt value purely so indentLeftPt is common across the section's whole extent (required for the section to consider it at all); the tie between the two same-size value-groups resolves to document order, so the section mints indentLeftPt:20 over [Q, P] specifically. R and S ALSO share alignment with P, but P is already factored by the section's own mint, so the heading group's own candidate search skips P and mints alignment over [R, S] alone — giving the heading its OWN chain link, one that says nothing about P. P's own strip must still come from the SECTION's link, not be wiped out because the heading's (more nested) link has no entry for it.
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
    // The heading minted its OWN entry (s2, over r/s), so it carries its own ref — but its anchor must still reflect the SECTION's strip, not just its own.
    expect(mintedHeading.style).toBe("s2");
    const mintedAnchor = ContentParagraphSchema.parse(mintedHeading.node);
    expect(mintedAnchor).not.toHaveProperty("indentLeftPt");
    expect(mintedAnchor.alignment).toBe("center");
  });

  it("sums a wrapper's own combined paragraph-half and run-half positions into one frequency, rather than letting one half's count cancel the other's", () => {
    // Section X mints BOTH halves on one wrapper: 2 paragraphs (alignment) and 3 runs (bold, since p1 carries two bold runs and p2 one) — a correctly-summed frequency of 5. Section Y mints only a paragraph half with frequency 2. 5 > 2, so X must rank first; a frequency computed by subtracting the run count from the paragraph count would give X a frequency of -1, putting Y first instead.
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
    // Sections A and B each independently mint the IDENTICAL combined entry (paragraph:{alignment:left}, run:{bold:true}), each contributing frequency 2+2=4 from its own two paragraphs/two runs — correctly merging to 8. Section C mints a different, single entry with frequency 6, strictly between 4 and 8: a merge that subtracts instead of adds would leave the shared entry at 0, and a merge that adds only the paragraph half of the second contribution (dropping its run half) would leave it at 4 — both wrongly below 6, flipping the order.
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
    // The heading's body is empty, so the ONLY candidate for a mint anywhere is the section's own [q, heading-anchor] pair — the heading's own plan() call finds nothing (its own extent is just its anchor alone, and indentLeftPt is already frozen), so its ref stays undefined. `unchanged`'s first clause (`ref===undefined`) is therefore true for the heading, and it is the SECOND clause (`anchor===group.node`) that must correctly detect the anchor was rewritten by the section's own strip — the children clause is vacuously true (empty array) and can't do this alone.
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

  it("rebuilds a list group as a new object via an ancestor's strip to ONE of its own body children alone — ref undefined AND anchor untouched, so the children-changed check alone must catch it", () => {
    // outside1 and bodyA share alignment:"left"; the list anchor P and bodyB each carry alignment too (their OWN distinct values, purely for universality across the section's whole extent), so their own singleton value-groups never reach the mint threshold and neither is touched. The section mints alignment:"left" over [outside1, bodyA] specifically — the list's own anchor is untouched (anchor === group.node stays true) and its own candidate search finds nothing (ref stays undefined), so this isolates the children clause: bodyA changed, bodyB didn't, and `.every(...)` must still say "not all match".
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
    // The anchor itself was never touched — it keeps its own distinct alignment value inline.
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
    // r/s carry bold:false (not merely omit it) so bold is common across the WHOLE section extent (required for the section to consider it at all) — the true/false split then groups [q,p] apart from [r,s], and the tie between the two same-size groups resolves to document order.
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
    // A sibling section (mintingSection) mints something, so entries.size > 0 and mint() runs the real per-wrapper rebuild walk rather than short-circuiting at the top with `return pkg` — which would trivially (and uselessly) preserve every reference without ever calling rebuildSectionGroup/rebuildHeadingGroup/rebuildListGroup/rebuildSectionConstructGroup at all. Every paragraph inside untouchedSection is a bare leaf with no mintable property at all, so nothing anywhere inside it ever mints, and every one of those four rebuild functions must return its own input object unchanged.
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
    const shapeOf = (blocks: readonly ContentParagraph[]): ShapeGroupNode => ({
      node: {
        frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
        insetLeftPt: 0,
        insetTopPt: 0,
        insetRightPt: 0,
        insetBottomPt: 0,
      },
      children: [...blocks],
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

  it("rebuilds a section's children as a new array preserving an untouched sibling's own reference, when exactly one child actually changed — not a wholesale copy, and not a false 'nothing changed' short-circuit", () => {
    // The heading anchor carries two of its OWN runs sharing bold:true, reaching the mint threshold entirely from its own text — independent of the section's own candidate search (which shares nothing across [heading anchor, pristine] and so mints nothing itself). This isolates the "one child changed, one didn't" case: `.some()` in place of `.every()` would find the untouched sibling's own match and wrongly call the whole section unchanged, discarding the heading's own rebuild.
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

  it("resolves an ancestor heading's ref onto a paragraph nested inside a construct — a construct extends the style chain, never resets it", () => {
    // The chain axis, stated on its own because it is the one place a construct differs from the section/slide/sheet/draw-page roots: those start a brand new empty chain, a construct extends the incoming one. A construct is a semantic wrapper sitting inside ambient content, so `inside` must come back carrying the heading group's factored alignment exactly as `a` (its sibling outside the construct) does — if flatten reset the chain at the construct boundary, `inside` would flatten back stripped and law (i) would fail on it.
    const doc = wordprocessingDoc([
      // `intro` carries no alignment, so the SECTION wrapper's own four-paragraph extent shares no mintable key and mints nothing — which is what puts the ref on the heading group specifically rather than on an ancestor that happens to cover everything.
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
});

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
