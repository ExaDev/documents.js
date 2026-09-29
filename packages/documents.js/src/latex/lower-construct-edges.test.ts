import type { MathExpression, MathSymbolEntry } from "document-schema.js";
import type { LatexDiagnostic } from "./diagnostics";
import { describe, expect, it } from "vitest";
import { lowerLatex } from "./lower";

// The edge spellings the mechanical suites do not reach: the genfrac bar and delimiter guards, the indexed radical's lowered index, the matrix guards, the script forms beyond a plain digit, the binder spellings that do not bind, and the diagnostic objects' exact key shape (a diagnostic with no detail carries no detail key at all, which toStrictEqual holds it to).

function lowered(latex: string): MathExpression {
  return lowerLatex(latex).expression;
}

function diagnosticsOf(latex: string): readonly LatexDiagnostic[] {
  return lowerLatex(latex).diagnostics;
}

describe("lowerLatex genfrac guards", () => {
  it("a bar-less genfrac degrades rather than assert a division it does not draw", () => {
    const latex = "\\genfrac{}{}{0pt}{}{a}{b}";
    expect(lowered(latex)).toEqual({ kind: "unparsed", latex: "{a}{b}" });
    expect(diagnosticsOf(latex)).toStrictEqual([
      { code: "latex/genfrac-unparsed", detail: "{a}{b}" },
    ]);
  });

  it("a delimited genfrac degrades with a bar present, the delimiters alone are enough", () => {
    const latex = "\\genfrac({)}{}{}{a}{b}";
    expect(lowered(latex)).toEqual({ kind: "unparsed", latex: "{a}{b}" });
    expect(diagnosticsOf(latex)).toStrictEqual([
      { code: "latex/genfrac-unparsed", detail: "{a}{b}" },
    ]);
  });

  it("an unbarred, undelimited genfrac with the default rule is division", () => {
    expect(lowered("\\genfrac{}{}{}{}{a}{b}")).toEqual({
      kind: "app",
      operator: "math:divide",
      args: [
        { kind: "sym", id: "symbols:a" },
        { kind: "sym", id: "symbols:b" },
      ],
    });
  });
});

describe("lowerLatex radicals", () => {
  it("a non-numeric radical index still lowers, as the divisor under 1", () => {
    expect(lowered("\\sqrt[\\alpha]{x}")).toEqual({
      kind: "app",
      operator: "math:pow",
      args: [
        { kind: "sym", id: "symbols:x" },
        {
          kind: "app",
          operator: "math:divide",
          args: [
            { kind: "num", numerator: "1", denominator: "1" },
            { kind: "sym", id: "symbols:α" },
          ],
        },
      ],
    });
  });
});

describe("lowerLatex matrices", () => {
  it("a ragged matrix degrades with an empty span, after every cell was lowered", () => {
    const result = lowerLatex("\\begin{matrix} a & b \\\\ c \\end{matrix}");
    expect(result.expression).toEqual({ kind: "unparsed", latex: "" });
    expect(result.diagnostics).toStrictEqual([
      { code: "latex/construct-unparsed", detail: "" },
    ]);
    expect(result.mintedSymbols.map((entry) => entry.glyph)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("a column-spec array with separators is an environment degradation", () => {
    const result = lowerLatex("\\begin{array}{c|c} a & b \\end{array}");
    expect(result.expression).toEqual({ kind: "unparsed", latex: "" });
    expect(result.diagnostics).toStrictEqual([
      { code: "latex/array-environment-unparsed", detail: "" },
    ]);
    expect(result.mintedSymbols).toEqual([]);
  });

  it("a parenthesised bare matrix unwraps to the matrix itself", () => {
    expect(lowered("(\\begin{matrix} a \\end{matrix})")).toEqual({
      kind: "matrix",
      rows: [[{ kind: "sym", id: "symbols:a" }]],
    });
  });
});

describe("lowerLatex script forms", () => {
  it("a command glyph in the subscript joins the base into one minted identity", () => {
    const result = lowerLatex("x_{\\alpha}");
    expect(result.expression).toEqual({ kind: "sym", id: "symbols:x_α" });
    expect(result.mintedSymbols).toEqual([
      { glyph: "x_α", scope: "document", id: "symbols:x_α" },
    ]);
  });

  it("a subscript onto a grouped base does not become a mangled identity", () => {
    const latex = "(\\alpha)_1";
    expect(lowered(latex)).toEqual({ kind: "unparsed", latex: "\\alpha)_1" });
    expect(diagnosticsOf(latex)).toStrictEqual([
      { code: "latex/subscript-unparsed", detail: "\\alpha)_1" },
    ]);
  });

  it.each([
    ["x_+", "x_+"],
    ["x_{}", "x_{}"],
    ["x_{,}", "x_{,}"],
  ])("a non-glyph subscript run degrades whole: %s", (latex, span) => {
    expect(lowered(latex)).toEqual({ kind: "unparsed", latex: span });
    expect(diagnosticsOf(latex)).toStrictEqual([
      { code: "latex/subscript-unparsed", detail: span },
    ]);
  });

  it("an uncurated command superscript is exponentiation over the lowered run", () => {
    const result = lowerLatex("x^{\\alpha}");
    expect(result.expression).toEqual({
      kind: "app",
      operator: "math:pow",
      args: [
        { kind: "sym", id: "symbols:x" },
        { kind: "sym", id: "symbols:α" },
      ],
    });
    expect(result.mintedSymbols.map((entry) => entry.glyph)).toEqual([
      "α",
      "x",
    ]);
  });

  it("a curated scripted form is looked up by its verbatim span, not its glyphs", () => {
    const entries: readonly MathSymbolEntry[] = [
      { glyph: "x^\\alpha", scope: "document", id: "curated:span-form" },
    ];
    const result = lowerLatex("x^{\\alpha}", { symbolEntries: entries });
    expect(result.expression).toEqual({ kind: "sym", id: "curated:span-form" });
    expect(result.mintedSymbols.map((entry) => entry.glyph)).toEqual(["α"]);
  });

  it("a curated sub-and-superscript triple is one symbol", () => {
    const entries: readonly MathSymbolEntry[] = [
      { glyph: "x_1^2", scope: "document", id: "curated:triple" },
    ];
    const result = lowerLatex("x_1^2", { symbolEntries: entries });
    expect(result.expression).toEqual({ kind: "sym", id: "curated:triple" });
    expect(result.mintedSymbols).toEqual([]);
  });
});

describe("lowerLatex binder spellings that do not bind", () => {
  it("an integral's supsub is not a binder: it degrades as a script on an op", () => {
    const result = lowerLatex("\\int_0^1 x");
    expect(result.expression).toEqual({ kind: "unparsed", latex: "0^1 x" });
    expect(result.diagnostics).toStrictEqual([
      { code: "latex/subscript-unparsed", detail: "0^1" },
      { code: "latex/juxtaposition-unparsed", detail: "0^1 x" },
    ]);
  });

  it("a named function cannot take a superscript: the op base degrades first", () => {
    const result = lowerLatex("\\sin^2 x");
    expect(result.expression).toEqual({ kind: "unparsed", latex: "2 x" });
    expect(result.diagnostics).toStrictEqual([
      { code: "latex/construct-unparsed", detail: "op" },
      { code: "latex/script-base-unparsed", detail: "2" },
      { code: "latex/juxtaposition-unparsed", detail: "2 x" },
    ]);
  });

  it("a subscript that is not name = range is unreadable and degrades the term", () => {
    const result = lowerLatex("\\sum_{i+1}^{n} x");
    expect(result.expression).toEqual({
      kind: "unparsed",
      latex: "{i+1}^{n}",
    });
    expect(result.diagnostics).toStrictEqual([
      { code: "latex/binder-bound-unreadable", detail: "{i+1}^{n}" },
    ]);
    expect(result.mintedSymbols.map((entry) => entry.glyph)).toEqual(["n"]);
  });

  it("a relation with no bound name before it is just as unreadable", () => {
    const result = lowerLatex("\\sum_{=1}^{n} x");
    expect(result.expression).toEqual({ kind: "unparsed", latex: "{=1}^{n}" });
    expect(result.diagnostics).toStrictEqual([
      { code: "latex/binder-bound-unreadable", detail: "{=1}^{n}" },
    ]);
  });
});

describe("lowerLatex binders with absent pieces", () => {
  it("a binder with no summand owns an unparsed body, carried as a keyless diagnostic", () => {
    const result = lowerLatex("\\sum_{i=1}^{n}");
    expect(result.expression).toEqual({
      kind: "sum",
      binder: "i",
      lower: { kind: "num", numerator: "1", denominator: "1" },
      upper: { kind: "sym", id: "symbols:n" },
      body: { kind: "unparsed", latex: "" },
    });
    expect(result.diagnostics).toStrictEqual([
      { code: "latex/construct-unparsed" },
    ]);
  });

  it("a bare command-glyph bound keeps both implicit bounds visible as data", () => {
    const result = lowerLatex("\\sum_{\\alpha} x");
    expect(result.expression).toEqual({
      kind: "sum",
      binder: "α",
      lower: { kind: "unparsed", latex: "" },
      upper: { kind: "unparsed", latex: "" },
      body: { kind: "sym", id: "symbols:x" },
    });
    expect(result.diagnostics).toStrictEqual([
      { code: "latex/binder-bound-implicit" },
      { code: "latex/binder-bound-implicit", detail: "{\\alpha}" },
    ]);
  });

  it("a named function with no argument applies over an unparsed argument", () => {
    const result = lowerLatex("\\sin");
    expect(result.expression).toEqual({
      kind: "app",
      operator: "math:sin",
      args: [{ kind: "unparsed", latex: "" }],
    });
    expect(result.diagnostics).toStrictEqual([
      { code: "latex/construct-unparsed" },
    ]);
  });

  it("a command-glyph binder name binds lexically: the body's own glyph shadows the table", () => {
    const result = lowerLatex("\\sum_{\\alpha=1}^{n} \\alpha");
    expect(result.expression).toEqual({
      kind: "sum",
      binder: "α",
      lower: { kind: "num", numerator: "1", denominator: "1" },
      upper: { kind: "sym", id: "symbols:n" },
      body: { kind: "sym", id: "α" },
    });
    expect(result.mintedSymbols.map((entry) => entry.glyph)).toEqual(["n"]);
  });
});

describe("lowerLatex digit-fold edges", () => {
  it("a multi-character textord never folds into a literal", () => {
    const result = lowerLatex("\\mathrm{42}");
    expect(result.expression).toEqual({ kind: "unparsed", latex: "{42}" });
    expect(result.diagnostics).toStrictEqual([
      { code: "latex/construct-unparsed", detail: "{42}" },
    ]);
  });

  it("a digit run flushed against a non-digit stays a juxtaposition", () => {
    const result = lowerLatex("4x");
    expect(result.expression).toEqual({ kind: "unparsed", latex: "4x" });
    expect(result.diagnostics).toStrictEqual([
      { code: "latex/juxtaposition-unparsed", detail: "4x" },
    ]);
  });
});

describe("lowerLatex streams every diagnostic through the sink with its exact key shape", () => {
  it("sink objects equal the accumulated diagnostics object for object", () => {
    const seen: LatexDiagnostic[] = [];
    lowerLatex("\\sum_{\\alpha} x", {
      sink: (diagnostic) => {
        seen.push(diagnostic);
      },
    });
    expect(seen).toStrictEqual([
      { code: "latex/binder-bound-implicit" },
      { code: "latex/binder-bound-implicit", detail: "{\\alpha}" },
    ]);
  });

  it("a diagnostic with a detail reaches the sink carrying it", () => {
    const seen: LatexDiagnostic[] = [];
    lowerLatex("2x", {
      sink: (diagnostic) => {
        seen.push(diagnostic);
      },
    });
    expect(seen).toStrictEqual([
      { code: "latex/juxtaposition-unparsed", detail: "2x" },
    ]);
  });
});
