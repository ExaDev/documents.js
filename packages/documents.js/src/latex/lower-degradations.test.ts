import type { MathExpression } from "document-schema.js";
import { describe, expect, it, vi } from "vitest";
import { lowerLatex } from "./lower";

// The companion suite to lower.test.ts's mechanical rules: the presentation-only skip sets, and the degradation table where context-starved constructs stay visible data (an `unparsed` node carrying the verbatim source plus a named diagnostic), never a throw, never a silent guess.

describe("lowerLatex skips presentation-only nodes mid-fold, by node kind", () => {
  // The skip sets are module-load literals like the operator registries, so under per-test coverage a top-level import attributes their construction to whichever worker loads the module first, leaving this suite never selected against a set mutant. The module is loaded by dynamic import inside each test so the set construction lands on THIS test's own coverage record. Each pin places the skipped node where its presence would change the FOLD, not merely the span: a kern or spacing command kept in the list would join the neighbouring segment and degrade it as juxtaposition, and the rule artefact kept in a radical's body ordgroup would degrade the radicand.
  async function loweredFresh(latex: string): Promise<MathExpression> {
    vi.resetModules();
    const { lowerLatex: lower } = await import("./lower");
    const { expression } = lower(latex);
    return expression;
  }

  it("skips a bare kern between an operator and its operand", async () => {
    expect(await loweredFresh("a + \\quad b")).toEqual({
      kind: "app",
      operator: "math:add",
      args: [
        { kind: "sym", id: "symbols:a" },
        { kind: "sym", id: "symbols:b" },
      ],
    });
  });

  it("skips a bare spacing command between an operator and its operand", async () => {
    expect(await loweredFresh("a + ~ b")).toEqual({
      kind: "app",
      operator: "math:add",
      args: [
        { kind: "sym", id: "symbols:a" },
        { kind: "sym", id: "symbols:b" },
      ],
    });
  });

  it("skips the radical's rule artefact inside the body ordgroup", async () => {
    expect(await loweredFresh("\\sqrt{x}")).toEqual({
      kind: "app",
      operator: "math:sqrt",
      args: [{ kind: "sym", id: "symbols:x" }],
    });
  });

  it("unwraps a styling node inside a braced superscript", async () => {
    expect(await loweredFresh("x^{\\textstyle 2}")).toEqual({
      kind: "app",
      operator: "math:pow",
      args: [
        { kind: "sym", id: "symbols:x" },
        { kind: "num", numerator: "2", denominator: "1" },
      ],
    });
  });
});

describe("lowerLatex degradations carry their verbatim span and named diagnostic", () => {
  interface DegradationCase {
    readonly latex: string;
    readonly expected: MathExpression;
    readonly diagnostics: readonly unknown[];
  }
  const cases: readonly DegradationCase[] = [
    {
      // A mapped operator with nothing before it: the leading segment is empty, which is placement, not an unmapped glyph.
      latex: "\\times",
      expected: { kind: "unparsed", latex: "\\times" },
      diagnostics: [
        { code: "latex/operator-placement-unparsed", detail: "\\times" },
      ],
    },
    {
      latex: "a \\pm b",
      expected: { kind: "unparsed", latex: "a \\pm b" },
      diagnostics: [{ code: "latex/operator-unmapped", detail: "a \\pm b" }],
    },
    {
      // The rel-family spelling of the unmapped-operator degradation, so the bin/rel disjunction in the operator-atom guard is pinned from both families.
      latex: "a \\approx b",
      expected: { kind: "unparsed", latex: "a \\approx b" },
      diagnostics: [
        { code: "latex/operator-unmapped", detail: "a \\approx b" },
      ],
    },
    {
      // A trailing dot folds into the literal and the rational reader drops it.
      latex: "3.",
      expected: { kind: "num", numerator: "3", denominator: "1" },
      diagnostics: [],
    },
    {
      // A lone dot folds into a literal the rational reader rejects.
      latex: ".",
      expected: { kind: "unparsed", latex: "." },
      diagnostics: [{ code: "latex/construct-unparsed", detail: "." }],
    },
    {
      // A named function with no argument following: the application still lowers, the gap is data with no detail.
      latex: "\\sin",
      expected: {
        kind: "app",
        operator: "math:sin",
        args: [{ kind: "unparsed", latex: "" }],
      },
      diagnostics: [{ code: "latex/construct-unparsed" }],
    },
    {
      // \binom draws delimiters around itself, so it is not the unambiguous bar-fraction \frac is.
      latex: "\\binom{a}{b}",
      expected: { kind: "unparsed", latex: "{a}{b}" },
      diagnostics: [{ code: "latex/genfrac-unparsed", detail: "{a}{b}" }],
    },
    {
      // An empty numerator is a gap inside an otherwise mechanical division.
      latex: "\\frac{}{b}",
      expected: {
        kind: "app",
        operator: "math:divide",
        args: [
          { kind: "unparsed", latex: "" },
          { kind: "sym", id: "symbols:b" },
        ],
      },
      diagnostics: [{ code: "latex/construct-unparsed" }],
    },
    {
      latex: "\\sqrt{}",
      expected: {
        kind: "app",
        operator: "math:sqrt",
        args: [{ kind: "unparsed", latex: "" }],
      },
      diagnostics: [{ code: "latex/construct-unparsed" }],
    },
    {
      // A ragged matrix body has no padding the schema could invent, and the array node carries no position of its own, so the span is empty.
      latex: "\\begin{matrix} a & b \\\\ c \\end{matrix}",
      expected: { kind: "unparsed", latex: "" },
      diagnostics: [{ code: "latex/construct-unparsed", detail: "" }],
    },
    {
      // \int is an op but never a binder: its scripts degrade as a subscripted base, and the result juxtaposes against the summand.
      latex: "\\int_0^1 x",
      expected: { kind: "unparsed", latex: "0^1 x" },
      diagnostics: [
        { code: "latex/subscript-unparsed", detail: "0^1" },
        { code: "latex/juxtaposition-unparsed", detail: "0^1 x" },
      ],
    },
    {
      latex: "\\text{hi}",
      expected: { kind: "unparsed", latex: "hi" },
      diagnostics: [{ code: "latex/text-unparsed", detail: "hi" }],
    },
    {
      // A displaystyle upper bound is not a readable bound on a binder whose subscript is absent.
      latex: "\\sum^{\\displaystyle n} i",
      expected: { kind: "unparsed", latex: "{\\displaystyle n}" },
      diagnostics: [
        {
          code: "latex/binder-bound-unreadable",
          detail: "{\\displaystyle n}",
        },
      ],
    },
    {
      latex: "x_{i+1}",
      expected: { kind: "unparsed", latex: "x_{i+1}" },
      diagnostics: [{ code: "latex/subscript-unparsed", detail: "x_{i+1}" }],
    },
  ];
  for (const { latex, expected, diagnostics } of cases) {
    it(`degrades ${latex} with its span and diagnostic`, () => {
      const result = lowerLatex(latex);
      expect(result.diagnostics).toEqual(diagnostics);
      expect(result.expression).toEqual(expected);
    });
  }

  it("degrades an unparseable string to its verbatim self with a parse-error diagnostic", () => {
    const result = lowerLatex("x^\\textstyle 2");
    expect(result.expression).toEqual({
      kind: "unparsed",
      latex: "x^\\textstyle 2",
    });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("latex/parse-error");
  });

  it("an empty or blank string is not a parse at all: no diagnostics, empty unparsed root", () => {
    for (const latex of ["", "  "]) {
      const result = lowerLatex(latex);
      expect(result.diagnostics).toEqual([]);
      expect(result.expression).toEqual({ kind: "unparsed", latex: "" });
    }
  });
});

describe("lowerLatex mechanical shapes the fold and script paths reach only through specific spellings", () => {
  interface ShapeCase {
    readonly latex: string;
    readonly expected: MathExpression;
  }
  const cases: readonly ShapeCase[] = [
    {
      // \sqrt2 hands the radicand to the node level as a bare digit textord, not through a braced ordgroup.
      latex: "\\sqrt2",
      expected: {
        kind: "app",
        operator: "math:sqrt",
        args: [{ kind: "num", numerator: "2", denominator: "1" }],
      },
    },
    {
      // \frac12 hands each operand as a braced single-digit ordgroup.
      latex: "\\frac12",
      expected: {
        kind: "app",
        operator: "math:divide",
        args: [
          { kind: "num", numerator: "1", denominator: "1" },
          { kind: "num", numerator: "2", denominator: "1" },
        ],
      },
    },
    {
      // A bare parenthesised group is a delimiter node around one item: the wrapper is presentation.
      latex: "(a)",
      expected: { kind: "sym", id: "symbols:a" },
    },
    {
      latex: "(a+b)^2",
      expected: {
        kind: "app",
        operator: "math:pow",
        args: [
          {
            kind: "app",
            operator: "math:add",
            args: [
              { kind: "sym", id: "symbols:a" },
              { kind: "sym", id: "symbols:b" },
            ],
          },
          { kind: "num", numerator: "2", denominator: "1" },
        ],
      },
    },
    {
      // A digit base is a glyph (subscripting spelled "another symbol"), so the base lowers through the symbol table, not the digit fold.
      latex: "2^3",
      expected: {
        kind: "app",
        operator: "math:pow",
        args: [
          { kind: "sym", id: "symbols:2" },
          { kind: "num", numerator: "3", denominator: "1" },
        ],
      },
    },
    {
      latex: "x_\\alpha",
      expected: { kind: "sym", id: "symbols:x_α" },
    },
    {
      latex: "x^{\\alpha}",
      expected: {
        kind: "app",
        operator: "math:pow",
        args: [
          { kind: "sym", id: "symbols:x" },
          { kind: "sym", id: "symbols:α" },
        ],
      },
    },
    {
      // A colour wrapper around the whole input: the body lowers in place.
      latex: "{\\color{red} x}",
      expected: { kind: "sym", id: "symbols:x" },
    },
  ];
  for (const { latex, expected } of cases) {
    it(`lowers ${latex}`, () => {
      const result = lowerLatex(latex);
      expect(
        result.diagnostics.filter(
          (diagnostic) => diagnostic.code !== "latex/binder-bound-implicit",
        ),
      ).toEqual([]);
      expect(result.expression).toEqual(expected);
    });
  }
});
