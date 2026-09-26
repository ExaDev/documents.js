import { describe, expect, it } from "vitest";
import { latexToFormula, lowerLatex } from "./lower";

describe("lowerLatex degradations", () => {
  interface Case {
    readonly latex: string;
    readonly code: string;
    readonly unparsedLatex?: string;
  }
  const cases: readonly Case[] = [
    // Juxtaposition: two defensible readings (multiplication, function application), no mechanical one.
    { latex: "2x", code: "latex/juxtaposition-unparsed", unparsedLatex: "2x" },
    {
      latex: "f(x)",
      code: "latex/juxtaposition-unparsed",
      unparsedLatex: "f(x",
    },
    // Text prose inside math.
    { latex: "\\text{where } R", code: "latex/text-unparsed" },
    // A compound subscript has no indexed-access reading in the grammar.
    {
      latex: "x_{i+1}",
      code: "latex/subscript-unparsed",
      unparsedLatex: "x_{i+1}",
    },
    // Integrals: the grammar's binders are exactly sum and prod.
    { latex: "\\int_0^1 f(x) \\, dx", code: "latex/subscript-unparsed" },
    // An operator with no mapping in the core registry.
    {
      latex: "a \\pm b",
      code: "latex/operator-unmapped",
      unparsedLatex: "a \\pm b",
    },
    // A binomial is a generalised fraction with delimiters, not a division.
    { latex: "\\binom{n}{k}", code: "latex/genfrac-unparsed" },
    // Layout-semantic array environments.
    {
      latex: "\\begin{cases} a & b \\end{cases}",
      code: "latex/array-environment-unparsed",
    },
    // A string the pinned parser cannot read at all: the whole expression is one unparsed node.
    {
      latex: "\\notacommand",
      code: "latex/parse-error",
      unparsedLatex: "\\notacommand",
    },
    // An empty middle segment between two relations: no mechanical reading.
    {
      latex: "a = = b",
      code: "latex/operator-placement-unparsed",
      unparsedLatex: "a = = b",
    },
    // A trailing operator leaves an empty final segment.
    {
      latex: "a +",
      code: "latex/operator-placement-unparsed",
      unparsedLatex: "a +",
    },
    // No operand at all: normalisation consumed every segment as a minus carrier.
    {
      latex: "+",
      code: "latex/operator-placement-unparsed",
      unparsedLatex: "+",
    },
    // Two dots in one digit run is not a decimal the rational parser will reduce.
    {
      latex: "1.2.3",
      code: "latex/construct-unparsed",
      unparsedLatex: "1.2.3",
    },
    // A subscript on a grouping base: the base is not a single glyph, so there is no identity to subscript.
    { latex: "(a)_i", code: "latex/subscript-unparsed" },
    // A superscript on a base whose own lowering degraded: the gap is data, not a guess.
    { latex: "(2x)^2", code: "latex/script-base-unparsed" },
    // A ragged matrix: the schema demands equal row widths, and padding would be a silent guess.
    {
      latex: "\\begin{pmatrix} a & b \\\\ c \\end{pmatrix}",
      code: "latex/construct-unparsed",
    },
    // A binder with no subscript at all.
    { latex: "\\sum^{n} i", code: "latex/binder-bound-unreadable" },
    // The subscript's first node is not a mathord glyph.
    {
      latex: "\\sum_{42=1}^{n} i",
      code: "latex/binder-bound-unreadable",
    },
    // The subscript's relation glyph is not "=".
    {
      latex: "\\sum_{i<1}^{n} i",
      code: "latex/binder-bound-unreadable",
    },
    // An empty index bracket: the index lowers to unparsed and the radical degrades around it.
    { latex: "\\sqrt[]{x}", code: "latex/construct-unparsed" },
    // A lone punct atom: interval-and-list notation the grammar has no reading for.
    {
      latex: ",",
      code: "latex/construct-unparsed",
      unparsedLatex: ",",
    },
    // A bare underscore with no base.
    { latex: "_1", code: "latex/subscript-unparsed" },
  ];
  for (const { latex, code, unparsedLatex } of cases) {
    it(`degrades ${latex} to unparsed with ${code}`, () => {
      const result = lowerLatex(latex);
      expect(
        result.diagnostics.some((diagnostic) => diagnostic.code === code),
      ).toBe(true);
      if (unparsedLatex !== undefined) {
        expect(result.expression).toEqual({
          kind: "unparsed",
          latex: unparsedLatex,
        });
      }
    });
  }

  it("the unparsed node carries the verbatim source, not a re-serialisation", () => {
    const result = lowerLatex("a \\pm b");
    expect(result.expression).toEqual({ kind: "unparsed", latex: "a \\pm b" });
  });

  it("a juxtaposition inside a larger relation degrades only the juxtaposed run — the relation itself still lowers around it", () => {
    const result = lowerLatex("E = mc^2");
    expect(result.expression).toEqual({
      kind: "app",
      operator: "math:eq",
      args: [
        { kind: "sym", id: "symbols:E" },
        { kind: "unparsed", latex: "mc^2" },
      ],
    });
  });

  it("an empty string lowers to an empty unparsed node with no diagnostics", () => {
    const result = lowerLatex("");
    expect(result.expression).toEqual({ kind: "unparsed", latex: "" });
    expect(result.diagnostics).toEqual([]);
  });

  it("streams diagnostics through the sink as they are emitted", () => {
    const seen: string[] = [];
    lowerLatex("2x", {
      sink: (diagnostic) => {
        seen.push(diagnostic.code);
      },
    });
    expect(seen).toEqual(["latex/juxtaposition-unparsed"]);
  });

  it("a bare op degrades with the node's own type as its detail when no text or span exists", () => {
    const result = lowerLatex("\\sum");
    expect(result.expression).toEqual({ kind: "unparsed", latex: "op" });
    expect(result.diagnostics).toEqual([
      { code: "latex/construct-unparsed", detail: "op" },
    ]);
  });

  it("a named function with nothing after it still applies, over an unparsed argument carrying no detail field", () => {
    const result = lowerLatex("\\sin");
    expect(result.expression).toEqual({
      kind: "app",
      operator: "math:sin",
      args: [{ kind: "unparsed", latex: "" }],
    });
    expect(result.diagnostics).toHaveLength(1);
    // A detail-less diagnostic carries exactly one key: the missing operand has no source to name.
    expect(Object.keys(result.diagnostics[0]!)).toEqual(["code"]);
  });

  it("a binder with nothing after it owns an unparsed body rather than vanishing", () => {
    const result = lowerLatex("\\sum_{i=1}^{n}");
    expect(result.expression).toEqual({
      kind: "sum",
      binder: "i",
      lower: { kind: "num", numerator: "1", denominator: "1" },
      upper: { kind: "sym", id: "symbols:n" },
      body: { kind: "unparsed", latex: "" },
    });
  });

  it("an empty matrix environment lowers to a matrix with no rows, not a degradation", () => {
    const result = lowerLatex("\\begin{matrix}\\end{matrix}");
    expect(result.diagnostics).toEqual([]);
    expect(result.expression).toEqual({ kind: "matrix", rows: [] });
  });

  it("mints one entry per distinct glyph however often it appears", () => {
    const result = lowerLatex("a + a");
    expect(result.mintedSymbols).toEqual([
      { glyph: "a", scope: "document", id: "symbols:a" },
    ]);
  });

  it("a whitespace-only string lowers to an empty unparsed node with no diagnostics and no minted entries", () => {
    const result = lowerLatex("   ");
    expect(result.expression).toEqual({ kind: "unparsed", latex: "" });
    expect(result.diagnostics).toEqual([]);
    expect(result.mintedSymbols).toEqual([]);
  });

  it("a colour wrapper around a whole sequence is presentation: the sequence lowers in place", () => {
    expect(lowerLatex("\\color{red}{a + b}").expression).toEqual({
      kind: "app",
      operator: "math:add",
      args: [
        { kind: "sym", id: "symbols:a" },
        { kind: "sym", id: "symbols:b" },
      ],
    });
    expect(lowerLatex("{\\color{red} a} + b").expression).toEqual({
      kind: "app",
      operator: "math:add",
      args: [
        { kind: "sym", id: "symbols:a" },
        { kind: "sym", id: "symbols:b" },
      ],
    });
  });

  it("a binom's genfrac diagnostic carries the construct's own verbatim span", () => {
    const result = lowerLatex("\\binom{n}{k}");
    expect(result.diagnostics).toEqual([
      { code: "latex/genfrac-unparsed", detail: "{n}{k}" },
    ]);
  });
});

describe("latexToFormula", () => {
  it("builds the two-layer ContentFormula: verbatim presentation, presentation-MathML, lowered content, provenance", () => {
    const result = latexToFormula("\\frac{1}{2}", { source: "test:probe" });
    expect(result.formula.presentation).toEqual({ latex: "\\frac{1}{2}" });
    expect(result.formula.content).toEqual({
      kind: "app",
      operator: "math:divide",
      args: [
        { kind: "num", numerator: "1", denominator: "1" },
        { kind: "num", numerator: "2", denominator: "1" },
      ],
    });
    expect(result.formula.provenance).toEqual({
      source: "test:probe",
      editTrail: [],
    });
    const root = result.formula.mathml[0];
    expect(root?.type).toBe("element");
    expect(root?.type === "element" ? root.tag : undefined).toBe("math");
  });

  it("defaults the provenance source to lowered:latex when no source is given", () => {
    const result = latexToFormula("\\frac{1}{2}");
    expect(result.formula.provenance).toEqual({
      source: "lowered:latex",
      editTrail: [],
    });
  });

  it("a parse failure still carries the presentation verbatim with an empty MathML array — the schema-anticipated state, never a throw", () => {
    const result = latexToFormula("\\notacommand");
    expect(result.formula.presentation).toEqual({ latex: "\\notacommand" });
    expect(result.formula.mathml).toEqual([]);
    expect(result.formula.content).toEqual({
      kind: "unparsed",
      latex: "\\notacommand",
    });
  });
});
