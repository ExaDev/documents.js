import { describe, expect, it } from "vitest";
import { ContentDocumentSchema } from "./content";

import { assembleTree, factorStyles } from "./factor-styles";
import { flattenTree } from "./flatten";
import { DocumentTreeSchema, type DocumentTree } from "./package";

import {
  containsGroupWrapper,
  corpus,
  expectStructurallyEqual,
} from "./bijection-corpus";
import { constructCorpus, runExtentCorpus } from "./bijection-constructs";

describe("decompose/flatten bijection laws over the schema-vocabulary corpus", () => {
  describe.each(corpus())("$name", ({ content, pages }) => {
    it("law (i): flattenTree(assembleTree(c)) reproduces c exactly", () => {
      expect(ContentDocumentSchema.safeParse(content).success).toBe(true);
      const snapshot = structuredClone(content);
      const tree = assembleTree(content, pages);
      expect(DocumentTreeSchema.safeParse(tree).success).toBe(true);
      const flat = flattenTree(tree);
      expect(ContentDocumentSchema.safeParse(flat).success).toBe(true);
      expectStructurallyEqual(flat, snapshot);
      // decompose embeds the source's own nodes, so re-comparing the source against its snapshot also pins that neither direction of the round trip mutated the input in place.
      expectStructurallyEqual(content, snapshot);
    });

    it("law (ii): the flat encoding is fully materialised and effective-equal to the original", () => {
      const snapshot = structuredClone(content);
      const tree = assembleTree(content, pages);
      const flat = flattenTree(tree);
      expect(containsGroupWrapper(flat)).toBe(false);
      // Resolve-then-compare in the flatten-as-resolver form: materialising every ref away and comparing structurally IS the effective-property comparison, because gap-fill restoration is exactly what resolution does.
      expectStructurallyEqual(flat, snapshot);
      expectStructurallyEqual(content, snapshot);
    });

    it("law (iii): assembling the flattened tree again mints the identical table and tree", () => {
      const first = assembleTree(content, pages);
      const second = assembleTree(flattenTree(first), first.pages);
      expectStructurallyEqual(second, first);
      // Factoring an already-factored package is the same law through the public re-mint entry point.
      expectStructurallyEqual(factorStyles(first), first);
    });

    it("mints deterministically", () => {
      expectStructurallyEqual(
        assembleTree(content, pages),
        assembleTree(content, pages),
      );
    });
  });

  // The gate must not pass vacuously: minting has to actually run over corpus documents, so at least one entry's tree carries a non-empty styles table and at least one wrapper ref. If this ever fails because no entry mints, the corpus has stopped exercising laws (ii) and (iii) and needs a real formatting-repetition fixture, not a weakened assertion.
  it("the corpus exercises real minting (at least one entry carries a styles table)", () => {
    const minting = corpus().filter(
      (entry) =>
        Object.keys(assembleTree(entry.content, entry.pages).styles ?? {})
          .length > 0,
    );
    expect(minting.length).toBeGreaterThan(0);
  });

  // The same anti-vacuity guard, narrowed to the construct entries: laws (ii) and (iii) say nothing about construct groups unless a construct group actually carries a ref, and a construct entry that minted nothing would pass all three laws while proving only that its leaves round-trip. Every construct entry except the deliberately empty one is built to mint on its own construct wrapper, so this pins that the promotion and minting really do compose over the corpus rather than only in factor-styles.test.ts's single fixture. The run-level extent entries are excluded: their wrappers are ordinary groups (a run extent has no construct group of its own — that is the point of the mechanism), so their anti-vacuity guard is the one immediately below.
  it("the construct corpus mints refs onto the construct groups themselves", () => {
    const runExtentNames = new Set(
      runExtentCorpus().map((entry) => entry.name),
    );
    const blockConstructEntries = constructCorpus().filter(
      (entry) => !runExtentNames.has(entry.name),
    );
    const withConstructRefs = blockConstructEntries.filter(
      (entry) =>
        constructGroupRefsOf(assembleTree(entry.content, entry.pages)).length >
        0,
    );
    expect(withConstructRefs.map((entry) => entry.name)).toEqual(
      blockConstructEntries
        .filter(
          (entry) =>
            entry.name !==
            "construct with no children (an open marker immediately closed)",
        )
        .map((entry) => entry.name),
    );
  });

  // The run-level extent corpus's own anti-vacuity guard: laws say nothing about minting unless it actually runs over a paragraph carrying constructs, and an entry where every extent paragraph was left unstripped would pass all three laws while proving only that untouched objects survive an embed. At least one entry must mint a styles table, which is what makes rebuildParagraph's strip-copy the path the constructs field rides through.
  it("the run-level extent corpus exercises real minting over paragraphs carrying constructs", () => {
    const minting = runExtentCorpus().filter(
      (entry) =>
        Object.keys(assembleTree(entry.content, entry.pages).styles ?? {})
          .length > 0,
    );
    expect(minting.length).toBeGreaterThan(0);
  });

  // Every ContentDocument kind must be represented, or a kind could quietly stop being exercised while the suite still passed on the other four.
  it("the corpus covers every document kind", () => {
    expect(
      [...new Set(corpus().map((entry) => entry.content.kind))].sort(),
    ).toEqual([
      "drawing",
      "formula",
      "presentation",
      "spreadsheet",
      "wordprocessing",
    ]);
  });
});

// Every style ref sitting on a construct-descriptor wrapper anywhere in a minted tree: a group node carrying a `kind` that is neither 'paragraph' nor a container discriminant is a ConstructDescriptor, which is exactly what construct groups (and nothing else) hold.
function constructGroupRefsOf(pkg: DocumentTree): string[] {
  const refs: string[] = [];
  function walk(value: unknown): void {
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    if (
      "node" in value &&
      "children" in value &&
      "style" in value &&
      typeof value.style === "string"
    ) {
      const node: unknown = value.node;
      if (
        typeof node === "object" &&
        node !== null &&
        "kind" in node &&
        typeof node.kind === "string" &&
        !["paragraph", "section", "slide", "sheet", "drawPage"].includes(
          node.kind,
        )
      ) {
        refs.push(value.style);
      }
    }
    for (const child of Object.values(value)) walk(child);
  }
  walk(pkg.children);
  return refs;
}
