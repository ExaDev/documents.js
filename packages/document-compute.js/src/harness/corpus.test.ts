import { lowerMarkdownMath } from "documents.js";
import { readMarkdownContent } from "markdown-codec";
import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentDocument,
  MathExpression,
} from "document-schema.js";
import type { WorkedExampleReport } from "./worked-example";
import {
  collectFormulas,
  formatCorpusReport,
  runCorpus,
  type CorpusReport,
} from "./corpus";

const PAGE = {
  pageSize: { widthPt: 612, heightPt: 792 },
  margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
};

// A minimal wordprocessing ContentDocument wrapping one section holding the given blocks -- for exercising collectFormulas's table/embeddedObject traversal directly, without going through markdown lowering.
function wordDoc(blocks: ContentBlock[]): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: [{ ...PAGE, blocks }],
  };
}

// An embeddedObject block whose nested document is itself a "formula" document wrapping the given MathExpression as its content.
function formulaEmbed(content: MathExpression): ContentBlock {
  return {
    kind: "embeddedObject",
    objectKind: "formula",
    frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
    document: {
      kind: "formula",
      metadata: {},
      formula: { mathml: [], content },
    },
  };
}

// The end-to-end integration test #794 asks for: markdown -> markdown-codec's own $$ recognition (a fenced-style block, the opening/closing "$$" each on their own line -- see that package's MATH_BLOCK_MARKER_PATTERN) -> documents.js's lowerMarkdownMath (the "LaTeX lowering" the issue names as the natural source of worked examples) -> this harness. A devDependency-only pairing (markdown-codec, documents.js): both sit above document-compute.js in the family's own dependency order, so neither can be a runtime dependency of this package without a cycle -- exactly why this package's own README describes itself as "not wired into the conversion pipeline". A small, hand-authored starter corpus lives here rather than a large real-world one: see this package's README on extending it locally via a gitignored test/corpus/, matching the family's own pdf-codec convention.

function lowerDocument(markdown: string) {
  const { document } = readMarkdownContent(markdown);
  return lowerMarkdownMath(document);
}

// One $$ ... $$ fenced display-math block per formula, matching markdown-codec's own block grammar (the delimiter must be alone on its own line).
function mathBlock(latex: string): string {
  return `$$\n${latex}\n$$`;
}

describe("collectFormulas + runWorkedExampleSequence, over real markdown text", () => {
  it("reproduces a dimensionless worked example authored as plain markdown math blocks", () => {
    const markdown = [
      mathBlock("F = {m \\times a}"),
      mathBlock("m = 2"),
      mathBlock("a = 3"),
      mathBlock("F = 6"),
    ].join("\n\n");
    const formulas = collectFormulas(lowerDocument(markdown));
    expect(formulas.length).toBe(4);
    const report = runCorpus([
      { label: "inline.md", document: lowerDocument(markdown) },
    ]);
    expect(report.matched).toBe(1);
    expect(report.coverage).toBe(1);
  });

  it("reports a mismatch for a worked example whose stated answer is wrong, with a formatted report naming it", () => {
    const markdown = [
      mathBlock("F = {m \\times a}"),
      mathBlock("m = 2"),
      mathBlock("a = 3"),
      mathBlock("F = 7"),
    ].join("\n\n");
    const report = runCorpus([
      { label: "wrong-answer.md", document: lowerDocument(markdown) },
    ]);
    expect(report.mismatched).toBe(1);
    const text = formatCorpusReport(report);
    expect(text).toContain("wrong-answer.md");
    expect(text).toContain("MISMATCH");
  });

  it("aggregates coverage across a corpus of several documents", () => {
    const good = [
      mathBlock("F = {m \\times a}"),
      mathBlock("m = 2"),
      mathBlock("a = 3"),
      mathBlock("F = 6"),
    ].join("\n\n");
    const bad = [
      mathBlock("F = {m \\times a}"),
      mathBlock("m = 2"),
      mathBlock("a = 3"),
      mathBlock("F = 7"),
    ].join("\n\n");
    const report = runCorpus([
      { label: "good.md", document: lowerDocument(good) },
      { label: "bad.md", document: lowerDocument(bad) },
    ]);
    expect(report.matched).toBe(1);
    expect(report.mismatched).toBe(1);
    expect(report.coverage).toBe(0.5);
    expect(report.documents.map((d) => d.label)).toEqual(["good.md", "bad.md"]);
  });

  it("collects no formulae from a document with no math in it at all", () => {
    const formulas = collectFormulas(
      lowerDocument("# Heading\n\nJust prose, no formulae."),
    );
    expect(formulas).toEqual([]);
  });
});

describe("collectFormulas: table and embedded-object traversal", () => {
  const num1: MathExpression = {
    kind: "num",
    numerator: "1",
    denominator: "1",
  };

  it("collects a formula embedded inside a table cell, recursing through the row/cell structure", () => {
    const document = wordDoc([
      {
        kind: "table",
        columnWidthsPt: [100],
        rows: [{ cells: [{ blocks: [formulaEmbed(num1)] }] }],
      },
    ]);
    const formulas = collectFormulas(document);
    expect(formulas.length).toBe(1);
    expect(formulas[0]?.content).toEqual(num1);
  });

  it("recurses through a table cell containing a nested table, not just one level deep", () => {
    const document = wordDoc([
      {
        kind: "table",
        columnWidthsPt: [100],
        rows: [
          {
            cells: [
              {
                blocks: [
                  {
                    kind: "table",
                    columnWidthsPt: [50],
                    rows: [{ cells: [{ blocks: [formulaEmbed(num1)] }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    expect(collectFormulas(document).length).toBe(1);
  });

  it("skips an embeddedObject block whose objectKind is not 'formula', even when its nested document happens to be one", () => {
    // A deliberately mismatched pair, isolating the objectKind check itself from the nested embedded.kind check below it: if the objectKind check were bypassed, this formula would be wrongly collected.
    const document = wordDoc([
      {
        kind: "embeddedObject",
        objectKind: "wordprocessing",
        frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
        document: {
          kind: "formula",
          metadata: {},
          formula: { mathml: [], content: num1 },
        },
      },
    ]);
    expect(collectFormulas(document)).toEqual([]);
  });

  it("collects a formula embeddedObject block directly, alongside a skipped one, in document order", () => {
    const document = wordDoc([
      {
        kind: "embeddedObject",
        objectKind: "wordprocessing",
        frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
        document: { kind: "wordprocessing", metadata: {}, sections: [] },
      },
      formulaEmbed(num1),
    ]);
    expect(collectFormulas(document).length).toBe(1);
  });
});

describe("formatCorpusReport: exact text formatting", () => {
  function report(
    documents: CorpusReport["documents"],
    totals: Pick<
      CorpusReport,
      "total" | "matched" | "mismatched" | "gaps" | "unresolved" | "coverage"
    >,
  ): CorpusReport {
    return { documents, ...totals };
  }

  it("prints MISMATCH, GAP, and unresolved lines with their exact format, never a 'match:' line for a matching outcome", () => {
    const documentReport: WorkedExampleReport = {
      outcomes: [
        {
          outcome: "match",
          targetSymbol: "F",
          expected: { kind: "quantity", magnitude: 6, dimension: {} },
          actual: { kind: "quantity", magnitude: 6, dimension: {} },
        },
        {
          outcome: "mismatch",
          targetSymbol: "G",
          expected: { kind: "quantity", magnitude: 6, dimension: {} },
          actual: { kind: "quantity", magnitude: 7, dimension: {} },
        },
        {
          outcome: "gap",
          gap: "unbound-symbol",
          targetSymbol: "x",
          message: "symbol 'x' has no entry in the supplied bindings.",
        },
        {
          outcome: "unresolved",
          targetSymbol: "y",
          message: "y was never restated.",
        },
      ],
      total: 4,
      matched: 1,
      mismatched: 1,
      gaps: 1,
      unresolved: 1,
      coverage: 0.5,
    };
    const text = formatCorpusReport(
      report([{ label: "doc.md", report: documentReport }], {
        total: 4,
        matched: 1,
        mismatched: 1,
        gaps: 1,
        unresolved: 1,
        coverage: 0.5,
      }),
    );
    const lines = text.split("\n");
    expect(lines).toContain("  MISMATCH: G -- expected 6, got 7");
    expect(lines).toContain(
      "  GAP (unbound-symbol): x -- symbol 'x' has no entry in the supplied bindings.",
    );
    expect(lines).toContain("  unresolved: y -- y was never restated.");
    expect(text).not.toContain("match: F");
    expect(text).not.toMatch(/^match:/m);
  });

  it("renders per-document and combined percentages to one decimal place with matched/total counts", () => {
    const documentReport: WorkedExampleReport = {
      outcomes: [],
      total: 4,
      matched: 1,
      mismatched: 3,
      gaps: 0,
      unresolved: 0,
      coverage: 0.25,
    };
    const text = formatCorpusReport(
      report([{ label: "doc.md", report: documentReport }], {
        total: 4,
        matched: 1,
        mismatched: 3,
        gaps: 0,
        unresolved: 0,
        coverage: 0.25,
      }),
    );
    const lines = text.split("\n");
    expect(lines[0]).toBe("doc.md: 25.0% (1/4)");
    expect(lines[lines.length - 1]).toBe(
      "TOTAL: 25.0% (1/4), 0 gap(s), 0 unresolved",
    );
  });

  it("renders 'no stated answers' for a document, and 'no stated answers in corpus' for the combined total, when coverage is undefined", () => {
    const documentReport: WorkedExampleReport = {
      outcomes: [],
      total: 0,
      matched: 0,
      mismatched: 0,
      gaps: 0,
      unresolved: 0,
      coverage: undefined,
    };
    const text = formatCorpusReport(
      report([{ label: "empty.md", report: documentReport }], {
        total: 0,
        matched: 0,
        mismatched: 0,
        gaps: 0,
        unresolved: 0,
        coverage: undefined,
      }),
    );
    expect(text.split("\n")).toEqual([
      "empty.md: no stated answers",
      "TOTAL: no stated answers in corpus",
    ]);
  });

  it("joins lines with a real newline, not merged into one run-on line", () => {
    const documentReport: WorkedExampleReport = {
      outcomes: [
        { outcome: "unresolved", targetSymbol: "a", message: "a." },
        { outcome: "unresolved", targetSymbol: "b", message: "b." },
      ],
      total: 2,
      matched: 0,
      mismatched: 0,
      gaps: 0,
      unresolved: 2,
      coverage: undefined,
    };
    const text = formatCorpusReport(
      report([{ label: "doc.md", report: documentReport }], {
        total: 2,
        matched: 0,
        mismatched: 0,
        gaps: 0,
        unresolved: 2,
        coverage: undefined,
      }),
    );
    // 1 document-coverage line + 2 outcome lines + 1 TOTAL line, each on its own line.
    expect(text.split("\n").length).toBe(4);
  });
});

describe("runCorpus: coverage aggregation", () => {
  it("reports coverage as undefined for the whole corpus when no document has a resolvable stated answer", () => {
    const report = runCorpus([
      {
        label: "no-math.md",
        document: lowerDocument("# Heading\n\nJust prose, no formulae."),
      },
    ]);
    expect(report.coverage).toBeUndefined();
    expect(report.matched).toBe(0);
    expect(report.mismatched).toBe(0);
  });
});
