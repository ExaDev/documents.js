import {
  assembleTree,
  type ContentBlock,
  type DocumentTree,
  type SymbolTable,
} from "document-schema.js";

import { describe, expect, it } from "vitest";
import { latexToFormula } from "./lower";
import { lintMathCoherence } from "./lint";
import { buildFormulaBlock } from "../model/formula";

// The coherence lint's contract: re-parse, re-lower, compare -- and report divergence as a warning carrying the stored provenance, never as an automatic re-derivation (the schema's atomic pair-edit rule: the layers stay exactly as stored). These tests also pin that the lint WRITES nothing: every assertion re-reads the same package object after linting.

function packageOf(blocks: readonly ContentBlock[]): DocumentTree {
  return assembleTree({
    kind: "wordprocessing",
    metadata: {},
    sections: [
      {
        pageSize: { widthPt: 595, heightPt: 842 },
        margins: { topPt: 20, rightPt: 20, bottomPt: 20, leftPt: 20 },
        blocks: [...blocks],
      },
    ],
  });
}

function mathBlockOf(latex: string): ContentBlock {
  return buildFormulaBlock(
    latexToFormula(latex, { source: "test:lint" }).formula,
    { xPt: 0, yPt: 0, widthPt: 0, heightPt: 22 },
    "test:lint",
  );
}

// packageOf's own sibling for the tests below that need a symbolTable declared on the OUTER document itself -- packageOf never sets one, which is fine for every existing case above (none of them needs the outer table to be present AND different from an inner one) but wrong for these.
function packageWithSymbolTableOf(
  symbolTable: SymbolTable,
  blocks: readonly ContentBlock[],
): DocumentTree {
  return assembleTree({
    kind: "wordprocessing",
    metadata: {},
    symbolTable,
    sections: [
      {
        pageSize: { widthPt: 595, heightPt: 842 },
        margins: { topPt: 20, rightPt: 20, bottomPt: 20, leftPt: 20 },
        blocks: [...blocks],
      },
    ],
  });
}

describe("lintMathCoherence", () => {
  it("a package whose stored content is exactly the mechanical re-lowering of its presentation stays silent", () => {
    const pkg = packageOf([mathBlockOf("\\sum_{i=1}^{n} \\frac{1}{i^2}")]);
    expect(lintMathCoherence(pkg)).toEqual([]);
  });

  it("a deliberately edited content layer diverges: a warning carrying provenance, and the stored layers are untouched", () => {
    const block = mathBlockOf("E = mc^2");
    const pkg = packageOf([block]);
    // Someone resolved the mc^2 juxtaposition by hand into an explicit multiplication -- a better reading, stored deliberately next to the unchanged presentation.
    if (block.kind !== "embeddedObject" || block.document.kind !== "formula") {
      throw new Error("expected a formula block");
    }
    block.document.formula.content = {
      kind: "app",
      operator: "math:eq",
      args: [
        { kind: "sym", id: "symbols:E" },
        {
          kind: "app",
          operator: "math:multiply",
          args: [
            { kind: "sym", id: "symbols:m" },
            {
              kind: "app",
              operator: "math:pow",
              args: [
                { kind: "sym", id: "symbols:c" },
                { kind: "num", numerator: "2", denominator: "1" },
              ],
            },
          ],
        },
      ],
    };
    block.document.formula.provenance = {
      source: "test:lint",
      editTrail: [
        "human edit: resolved the mc^2 juxtaposition into an explicit multiply",
      ],
    };
    const warnings = lintMathCoherence(pkg);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("math/coherence-divergence");
    expect(warnings[0]?.severity).toBe("warning");
    expect(warnings[0]?.provenance).toBe(
      "test:lint -> human edit: resolved the mc^2 juxtaposition into an explicit multiply",
    );
    expect(warnings[0]?.detail).toContain("E = mc^2");
    // The lint re-derived nothing: the stored content is still the hand-edited tree, byte for byte.
    expect(block.document.formula.content).toEqual({
      kind: "app",
      operator: "math:eq",
      args: [
        { kind: "sym", id: "symbols:E" },
        {
          kind: "app",
          operator: "math:multiply",
          args: [
            { kind: "sym", id: "symbols:m" },
            {
              kind: "app",
              operator: "math:pow",
              args: [
                { kind: "sym", id: "symbols:c" },
                { kind: "num", numerator: "2", denominator: "1" },
              ],
            },
          ],
        },
      ],
    });
  });

  it("a stored non-reduced rational still agrees with the reduced re-lowering -- value canonicalisation, not string equality", () => {
    // '\frac{0.5}{2}' re-lowers the decimal to the reduced 1/2; the stored content spells the same value as an unreduced 2/4. Same expression, different spelling -- the lint compares cross-reduced values and stays silent.
    const block = mathBlockOf("\\frac{0.5}{2}");
    if (block.kind !== "embeddedObject" || block.document.kind !== "formula") {
      throw new Error("expected a formula block");
    }
    block.document.formula.content = {
      kind: "app",
      operator: "math:divide",
      args: [
        { kind: "num", numerator: "2", denominator: "4" },
        { kind: "num", numerator: "2", denominator: "1" },
      ],
    };
    expect(lintMathCoherence(packageOf([block]))).toEqual([]);
  });

  it("an unparseable stored presentation warns only when the stored content is a real lowering", () => {
    const degraded = mathBlockOf("\\notacommand");
    const pkgDegraded = packageOf([degraded]);
    // Stored content is itself an unparsed root (the lowering degraded too), so this stays silent.
    expect(lintMathCoherence(pkgDegraded)).toEqual([]);
    const edited = mathBlockOf("\\notacommand");
    if (
      edited.kind !== "embeddedObject" ||
      edited.document.kind !== "formula"
    ) {
      throw new Error("expected a formula block");
    }
    edited.document.formula.content = { kind: "sym", id: "symbols:x" };
    const warnings = lintMathCoherence(packageOf([edited]));
    expect(warnings.map((warning) => warning.code)).toEqual([
      "math/coherence-unparseable-presentation",
    ]);
  });

  it("two divergent formulas in one document produce distinct detail strings, even though mathBlockOf stamps the identical sourcePath on both (ExaDev/documents.js#928 round-3/4 regression)", () => {
    // Both formulas below are built through the same mathBlockOf helper, which hardcodes "test:lint" as every formula's sourcePath -- exactly the shape a real document can have too: this package's own src/markdown/math.ts stamps every display formula it lowers from a markdown source with the identical literal sourcePath "markdown:math-block" (and every inline formula with "markdown:math-inline"), so two sibling formulas in the one real-world format that populates sourcePath at all routinely share the exact value mathBlockOf hardcodes here. If the lint keyed its diagnostic locate string on sourcePath (or on the document's own kind as a shared fallback), these two formulas' diagnostics would be byte-identical except for the latex suffix's own natural difference -- the actual round-3 regression. Keying on the walk's own structural `locate` instead keeps them apart regardless of what sourcePath the source format did or didn't stamp.
    const nested = mathBlockOf("c + d");
    const topLevel = mathBlockOf("a + b");
    const pkg = packageOf([
      {
        kind: "table",
        columnWidthsPt: [100],
        rows: [{ cells: [{ blocks: [nested] }] }],
      },
      topLevel,
    ]);
    for (const block of [nested, topLevel]) {
      if (
        block.kind !== "embeddedObject" ||
        block.document.kind !== "formula"
      ) {
        throw new Error("expected a formula block");
      }
      // Force a divergence: neither "c + d" nor "a + b" mechanically re-lowers to a bare symbol reference.
      block.document.formula.content = { kind: "sym", id: "symbols:x" };
    }
    const warnings = lintMathCoherence(pkg);
    expect(warnings).toHaveLength(2);
    expect(
      warnings.every((warning) => warning.code === "math/coherence-divergence"),
    ).toBe(true);
    expect(warnings[0]?.detail).toBe(
      "sections[0]/blocks[0].rows[0].cells[0]/blocks[0]: c + d",
    );
    expect(warnings[1]?.detail).toBe("sections[0]/blocks[1]: a + b");
    expect(warnings[0]?.detail).not.toBe(warnings[1]?.detail);
  });

  it("resolves a nested formula's symbols against its OWN embedding document's symbolTable, not the outer package's (ExaDev/documents.js#928 round-7 regression)", () => {
    // The outer package declares no symbolTable at all; only the nested document curates glyph "U" -- as "symbols:voltage", an id that does NOT match the auto-mint scheme ("symbols:U") a table-less re-lowering would produce for an uncurated glyph. Re-lowering the nested formula against the wrong (outer) table would therefore mint a different symbol id for the same glyph and falsely report a coherence divergence for a formula that is actually perfectly coherent against its own document's table.
    const curatedEntries = [
      { glyph: "U", scope: "document", id: "symbols:voltage" },
    ];
    const nestedFormula = latexToFormula("U", {
      symbolEntries: curatedEntries,
      source: "test:lint",
    }).formula;
    const nestedBlock = buildFormulaBlock(
      nestedFormula,
      { xPt: 0, yPt: 0, widthPt: 0, heightPt: 22 },
      "test:lint",
    );
    const embeddingBlock: ContentBlock = {
      kind: "embeddedObject",
      objectKind: "wordprocessing",
      document: {
        kind: "wordprocessing",
        metadata: {},
        symbolTable: { symbols: curatedEntries, units: [] },
        sections: [
          {
            pageSize: { widthPt: 595, heightPt: 842 },
            margins: { topPt: 20, rightPt: 20, bottomPt: 20, leftPt: 20 },
            blocks: [nestedBlock],
          },
        ],
      },
      frame: { xPt: 0, yPt: 0, widthPt: 0, heightPt: 0 },
    };
    const pkg = packageOf([embeddingBlock]);
    expect(lintMathCoherence(pkg)).toEqual([]);
  });

  it("resolves a DIRECTLY embedded formula object's own symbolTable, not the enclosing document's (ExaDev/documents.js#928 round-8 regression)", () => {
    // Round-7's regression required an intermediate non-formula document wrapping the formula; this is the plainer and more common real-world shape: a formula-kind embedded object sitting straight in the document's own block flow (exactly what buildFormulaBlock produces on every odt/odp/docx/markdown read), carrying its own symbolTable directly rather than nested one level deeper. Both tables curate the identical glyph "U" under different ids -- resolving against the wrong (enclosing) table mints the wrong symbol id and falsely reports a coherence divergence for a formula that is actually coherent against its own document.
    const outerEntries = [
      { glyph: "U", scope: "document", id: "symbols:outer-voltage" },
    ];
    const ownEntries = [
      { glyph: "U", scope: "document", id: "symbols:inner-voltage" },
    ];
    const { formula } = latexToFormula("U", {
      symbolEntries: ownEntries,
      source: "test:lint",
    });
    const block = buildFormulaBlock(
      formula,
      { xPt: 0, yPt: 0, widthPt: 0, heightPt: 22 },
      "test:lint",
    );
    // block.document is statically known to be the 'formula'-kind ContentDocument buildFormulaBlock built -- no narrowing needed, unlike mathBlockOf's own callers elsewhere in this file, which declare a widened ContentBlock return type.
    block.document.symbolTable = { symbols: ownEntries, units: [] };
    const pkg = packageWithSymbolTableOf({ symbols: outerEntries, units: [] }, [
      block,
    ]);
    expect(lintMathCoherence(pkg)).toEqual([]);
  });

  it("falls back to the outer document's symbolTable when a NESTED non-formula document declares none of its own (ExaDev/documents.js#928 round-8, fallback direction 1 of 2)", () => {
    // The nested wordprocessing document declares no symbolTable field at all -- collectDocumentFormulas' own outward-fallback design choice means the formula inside it should still resolve "U" against the OUTER document's curation, matching this formula's own stored content (built against that same outer table). Getting the fallback wrong (leaving the nested entry's table undefined instead of inheriting outward) would make the re-lowering mint an uncurated auto-symbol id instead, diverging from the stored content and producing a false warning.
    const outerEntries = [
      { glyph: "U", scope: "document", id: "symbols:voltage" },
    ];
    const nestedFormula = latexToFormula("U", {
      symbolEntries: outerEntries,
      source: "test:lint",
    }).formula;
    const nestedBlock = buildFormulaBlock(
      nestedFormula,
      { xPt: 0, yPt: 0, widthPt: 0, heightPt: 22 },
      "test:lint",
    );
    const embeddingBlock: ContentBlock = {
      kind: "embeddedObject",
      objectKind: "wordprocessing",
      document: {
        kind: "wordprocessing",
        metadata: {},
        // Deliberately no symbolTable field here -- the fallback under test.
        sections: [
          {
            pageSize: { widthPt: 595, heightPt: 842 },
            margins: { topPt: 20, rightPt: 20, bottomPt: 20, leftPt: 20 },
            blocks: [nestedBlock],
          },
        ],
      },
      frame: { xPt: 0, yPt: 0, widthPt: 0, heightPt: 0 },
    };
    const pkg = packageWithSymbolTableOf({ symbols: outerEntries, units: [] }, [
      embeddingBlock,
    ]);
    expect(lintMathCoherence(pkg)).toEqual([]);
  });

  it("falls back to the outer document's symbolTable when a DIRECTLY embedded formula object declares none of its own (ExaDev/documents.js#928 round-8, fallback direction 2 of 2)", () => {
    // The ordinary case buildFormulaBlock produces on every real read: the formula-kind document carries no symbolTable of its own at all. The fix must not make this regress into an unconditionally-undefined table -- it should still fall back to the enclosing document's own curation, exactly as before the fix.
    const outerEntries = [
      { glyph: "U", scope: "document", id: "symbols:voltage" },
    ];
    const { formula } = latexToFormula("U", {
      symbolEntries: outerEntries,
      source: "test:lint",
    });
    const block = buildFormulaBlock(
      formula,
      { xPt: 0, yPt: 0, widthPt: 0, heightPt: 22 },
      "test:lint",
    );
    const pkg = packageWithSymbolTableOf({ symbols: outerEntries, units: [] }, [
      block,
    ]);
    expect(lintMathCoherence(pkg)).toEqual([]);
  });

  it("walks formula blocks inside table cells and skips formulas carrying only one layer", () => {
    const presentationOnly = buildFormulaBlock(
      { mathml: [], presentation: { latex: "x^2" } },
      { xPt: 0, yPt: 0, widthPt: 0, heightPt: 22 },
      "test",
    );
    const pkg = packageOf([
      {
        kind: "table",
        columnWidthsPt: [100],
        rows: [{ cells: [{ blocks: [mathBlockOf("a + b")] }] }],
      },
      presentationOnly,
    ]);
    expect(lintMathCoherence(pkg)).toEqual([]);
  });
});
