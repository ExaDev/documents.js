import { lowerMarkdownMath } from "documents.js";
import { readMarkdownContent } from "markdown-codec";
import { describe, expect, it } from "vitest";
import { collectFormulas, formatCorpusReport, runCorpus } from "./corpus";

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
