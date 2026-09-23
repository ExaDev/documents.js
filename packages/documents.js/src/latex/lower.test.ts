import type { MathExpression, MathSymbolEntry } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { latexToFormula, lowerLatex } from "./lower";

// The lowering table: every construct whose reading is mechanical, pinned as an expected MathExpression tree. These cases double as the parse-node-shape pin for the temml version recorded in package.json — a temml bump that reshapes a node the lowering consumes shows up here first, which is exactly when the bump's re-verification is meant to happen (see src/latex/temml.ts's own top-of-file comment).
describe("lowerLatex mechanical rules", () => {
  interface Case {
    readonly latex: string;
    readonly expected: MathExpression;
  }
  // The shared shape of every two-operand relation/arithmetic case below.
  function relation(operator: string): MathExpression {
    return {
      kind: "app",
      operator,
      args: [
        { kind: "sym", id: "symbols:a" },
        { kind: "sym", id: "symbols:b" },
      ],
    };
  }
  const cases: readonly Case[] = [
    { latex: "x", expected: { kind: "sym", id: "symbols:x" } },
    { latex: "\\alpha", expected: { kind: "sym", id: "symbols:α" } },
    { latex: "\\infty", expected: { kind: "sym", id: "symbols:∞" } },
    {
      latex: "42",
      expected: { kind: "num", numerator: "42", denominator: "1" },
    },
    {
      latex: "3.14",
      expected: { kind: "num", numerator: "157", denominator: "50" },
    },
    {
      latex: ".5",
      expected: { kind: "num", numerator: "1", denominator: "2" },
    },
    {
      latex: "\\frac{a}{b}",
      expected: {
        kind: "app",
        operator: "math:divide",
        args: [
          { kind: "sym", id: "symbols:a" },
          { kind: "sym", id: "symbols:b" },
        ],
      },
    },
    {
      latex: "a/b",
      expected: {
        kind: "app",
        operator: "math:divide",
        args: [
          { kind: "sym", id: "symbols:a" },
          { kind: "sym", id: "symbols:b" },
        ],
      },
    },
    {
      latex: "\\sqrt{x}",
      expected: {
        kind: "app",
        operator: "math:sqrt",
        args: [{ kind: "sym", id: "symbols:x" }],
      },
    },
    {
      latex: "\\sqrt[3]{x}",
      expected: {
        kind: "app",
        operator: "math:pow",
        args: [
          { kind: "sym", id: "symbols:x" },
          {
            kind: "app",
            operator: "math:divide",
            args: [
              { kind: "num", numerator: "1", denominator: "1" },
              { kind: "num", numerator: "3", denominator: "1" },
            ],
          },
        ],
      },
    },
    {
      latex: "x^2",
      expected: {
        kind: "app",
        operator: "math:pow",
        args: [
          { kind: "sym", id: "symbols:x" },
          { kind: "num", numerator: "2", denominator: "1" },
        ],
      },
    },
    { latex: "x_1", expected: { kind: "sym", id: "symbols:x_1" } },
    {
      latex: "x_i^2",
      expected: {
        kind: "app",
        operator: "math:pow",
        args: [
          { kind: "sym", id: "symbols:x_i" },
          { kind: "num", numerator: "2", denominator: "1" },
        ],
      },
    },
    {
      latex: "a + b = c",
      expected: {
        kind: "app",
        operator: "math:eq",
        args: [
          {
            kind: "app",
            operator: "math:add",
            args: [
              { kind: "sym", id: "symbols:a" },
              { kind: "sym", id: "symbols:b" },
            ],
          },
          { kind: "sym", id: "symbols:c" },
        ],
      },
    },
    {
      // ExaDev/documents.js#812: the worked-example-standard shape (a relation followed by an ungrouped arithmetic right-hand side) used to fold left-to-right in source order, treating "=" and "\times" as the same tier and producing multiply(eq(c,a), b) — a tree with no sound mathematical reading, since multiplying an equation by a value is meaningless. Relations bind looser than arithmetic regardless of which side the arithmetic falls on.
      latex: "c = a \\times b",
      expected: {
        kind: "app",
        operator: "math:eq",
        args: [
          { kind: "sym", id: "symbols:c" },
          {
            kind: "app",
            operator: "math:multiply",
            args: [
              { kind: "sym", id: "symbols:a" },
              { kind: "sym", id: "symbols:b" },
            ],
          },
        ],
      },
    },
    {
      // Chained equality (ExaDev/documents.js#812): each relation's own operands still fold their arithmetic first (b \times c, not eq(a,b) reused as an operand to multiply), then the relations themselves fold left-to-right — eq(eq(a, multiply(b,c)), d), not the multiply(eq(a,b),c) shape the single-tier fold used to produce.
      latex: "a = b \\times c = d",
      expected: {
        kind: "app",
        operator: "math:eq",
        args: [
          {
            kind: "app",
            operator: "math:eq",
            args: [
              { kind: "sym", id: "symbols:a" },
              {
                kind: "app",
                operator: "math:multiply",
                args: [
                  { kind: "sym", id: "symbols:b" },
                  { kind: "sym", id: "symbols:c" },
                ],
              },
            ],
          },
          { kind: "sym", id: "symbols:d" },
        ],
      },
    },
    {
      latex: "a - b - c",
      expected: {
        kind: "app",
        operator: "math:subtract",
        args: [
          {
            kind: "app",
            operator: "math:subtract",
            args: [
              { kind: "sym", id: "symbols:a" },
              { kind: "sym", id: "symbols:b" },
            ],
          },
          { kind: "sym", id: "symbols:c" },
        ],
      },
    },
    {
      // A minus after a relation signs the FOLLOWING operand, the same unary reading as a leading minus — found by the generated worked-example corpus, where every negative stated answer degraded its whole equality under the leading-only spelling.
      latex: "T = -0.36",
      expected: {
        kind: "app",
        operator: "math:eq",
        args: [
          { kind: "sym", id: "symbols:T" },
          {
            kind: "app",
            operator: "math:negate",
            args: [{ kind: "num", numerator: "9", denominator: "25" }],
          },
        ],
      },
    },
    {
      latex: "a + -b",
      expected: {
        kind: "app",
        operator: "math:add",
        args: [
          { kind: "sym", id: "symbols:a" },
          {
            kind: "app",
            operator: "math:negate",
            args: [{ kind: "sym", id: "symbols:b" }],
          },
        ],
      },
    },
    {
      latex: "-x + y",
      expected: {
        kind: "app",
        operator: "math:add",
        args: [
          {
            kind: "app",
            operator: "math:negate",
            args: [{ kind: "sym", id: "symbols:x" }],
          },
          { kind: "sym", id: "symbols:y" },
        ],
      },
    },
    {
      latex: "a \\leq b",
      expected: {
        kind: "app",
        operator: "math:leq",
        args: [
          { kind: "sym", id: "symbols:a" },
          { kind: "sym", id: "symbols:b" },
        ],
      },
    },
    {
      latex: "\\sin(x)",
      expected: {
        kind: "app",
        operator: "math:sin",
        args: [{ kind: "sym", id: "symbols:x" }],
      },
    },
    {
      latex: "\\sin x + 1",
      expected: {
        kind: "app",
        operator: "math:add",
        args: [
          {
            kind: "app",
            operator: "math:sin",
            args: [{ kind: "sym", id: "symbols:x" }],
          },
          { kind: "num", numerator: "1", denominator: "1" },
        ],
      },
    },
    {
      latex: "\\left( a + b \\right)^2",
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
      latex: "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}",
      expected: {
        kind: "matrix",
        rows: [
          [
            { kind: "sym", id: "symbols:a" },
            { kind: "sym", id: "symbols:b" },
          ],
          [
            { kind: "sym", id: "symbols:c" },
            { kind: "sym", id: "symbols:d" },
          ],
        ],
      },
    },
    {
      latex: "\\sum_{i=1}^{n} i^2",
      expected: {
        kind: "sum",
        binder: "i",
        lower: { kind: "num", numerator: "1", denominator: "1" },
        upper: { kind: "sym", id: "symbols:n" },
        body: {
          kind: "app",
          operator: "math:pow",
          args: [
            { kind: "sym", id: "i" },
            { kind: "num", numerator: "2", denominator: "1" },
          ],
        },
      },
    },
    {
      latex: "\\sum_{i=1}^{\\infty} \\frac{1}{i^2}",
      expected: {
        kind: "sum",
        binder: "i",
        lower: { kind: "num", numerator: "1", denominator: "1" },
        upper: { kind: "sym", id: "symbols:∞" },
        body: {
          kind: "app",
          operator: "math:divide",
          args: [
            { kind: "num", numerator: "1", denominator: "1" },
            {
              kind: "app",
              operator: "math:pow",
              args: [
                { kind: "sym", id: "i" },
                { kind: "num", numerator: "2", denominator: "1" },
              ],
            },
          ],
        },
      },
    },
    {
      latex: "\\prod_{k=0}^{n} k",
      expected: {
        kind: "prod",
        binder: "k",
        lower: { kind: "num", numerator: "0", denominator: "1" },
        upper: { kind: "sym", id: "symbols:n" },
        body: { kind: "sym", id: "k" },
      },
    },
    {
      latex: "\\sum_i x_i",
      expected: {
        kind: "sum",
        binder: "i",
        lower: { kind: "unparsed", latex: "" },
        upper: { kind: "unparsed", latex: "" },
        body: { kind: "sym", id: "symbols:x_i" },
      },
    },
    { latex: "a < b", expected: relation("math:lt") },
    { latex: "a > b", expected: relation("math:gt") },
    { latex: "a \\le b", expected: relation("math:leq") },
    { latex: "a \\leq b", expected: relation("math:leq") },
    { latex: "a \\ge b", expected: relation("math:geq") },
    { latex: "a \\geq b", expected: relation("math:geq") },
    { latex: "a \\ne b", expected: relation("math:neq") },
    { latex: "a \\neq b", expected: relation("math:neq") },
    { latex: "a \\cdot b", expected: relation("math:multiply") },
    { latex: "a \\div b", expected: relation("math:divide") },
    { latex: "\\dfrac{a}{b}", expected: relation("math:divide") },
    { latex: "\\tfrac{a}{b}", expected: relation("math:divide") },
    {
      latex: "-a = b",
      expected: {
        kind: "app",
        operator: "math:eq",
        args: [
          {
            kind: "app",
            operator: "math:negate",
            args: [{ kind: "sym", id: "symbols:a" }],
          },
          { kind: "sym", id: "symbols:b" },
        ],
      },
    },
    {
      // Parity-counted unary minus: two minus signs negate twice, which cancels.
      latex: "a = --b",
      expected: relation("math:eq"),
    },
    { latex: "x_{ij}", expected: { kind: "sym", id: "symbols:x_ij" } },
    { latex: "x_{max}", expected: { kind: "sym", id: "symbols:x_max" } },
    {
      // The color wrapper is presentation: its body lowers in place, in a script as at the top level.
      latex: "x^{\\color{red}2}",
      expected: {
        kind: "app",
        operator: "math:pow",
        args: [
          { kind: "sym", id: "symbols:x" },
          { kind: "num", numerator: "2", denominator: "1" },
        ],
      },
    },
    {
      latex: "x_i^j",
      expected: {
        kind: "app",
        operator: "math:pow",
        args: [
          { kind: "sym", id: "symbols:x_i" },
          { kind: "sym", id: "symbols:j" },
        ],
      },
    },
    {
      latex: "\\sqrt[3]{x}^2",
      expected: {
        kind: "app",
        operator: "math:pow",
        args: [
          {
            kind: "app",
            operator: "math:pow",
            args: [
              { kind: "sym", id: "symbols:x" },
              {
                kind: "app",
                operator: "math:divide",
                args: [
                  { kind: "num", numerator: "1", denominator: "1" },
                  { kind: "num", numerator: "3", denominator: "1" },
                ],
              },
            ],
          },
          { kind: "num", numerator: "2", denominator: "1" },
        ],
      },
    },
    {
      // The inner radical's hand-drawn vinculum arrives as a presentation-only rule node inside the radicand; skipped, the nested radicals lower cleanly.
      latex: "\\sqrt{\\sqrt{x}}",
      expected: {
        kind: "app",
        operator: "math:sqrt",
        args: [
          {
            kind: "app",
            operator: "math:sqrt",
            args: [{ kind: "sym", id: "symbols:x" }],
          },
        ],
      },
    },
    {
      latex: "\\frac{\\frac{a}{b}}{c}",
      expected: {
        kind: "app",
        operator: "math:divide",
        args: [
          {
            kind: "app",
            operator: "math:divide",
            args: [
              { kind: "sym", id: "symbols:a" },
              { kind: "sym", id: "symbols:b" },
            ],
          },
          { kind: "sym", id: "symbols:c" },
        ],
      },
    },
    {
      // A "0" that is not the run's first digit: a boundary mutant that rejects "0" alone still folds the leading "9", and only the two-digit literal distinguishes the fold from a juxtaposition of the digits.
      latex: "90",
      expected: { kind: "num", numerator: "90", denominator: "1" },
    },
    {
      // A bare kern between two digits is presentation-only and skipped, so the digits still fold into one literal across it.
      latex: "4 \\quad 2",
      expected: { kind: "num", numerator: "42", denominator: "1" },
    },
  ];
  for (const { latex, expected } of cases) {
    it(`lowers ${latex} mechanically`, () => {
      const result = lowerLatex(latex);
      expect(
        result.diagnostics.filter(
          (diagnostic) => diagnostic.code !== "latex/binder-bound-implicit",
        ),
      ).toEqual([]);
      expect(result.expression).toEqual(expected);
    });
  }

  it("sums nested in one term: the outer binder owns the inner binder and its summand", () => {
    const result = lowerLatex("\\sum_{i=1}^{n} \\sum_{j=1}^{m} i j + 1");
    // The `i j` summand is juxtaposition and degrades inside the body — the +1 still folds outside the binder, exactly the conventional precedence.
    expect(result.expression).toEqual({
      kind: "app",
      operator: "math:add",
      args: [
        {
          kind: "sum",
          binder: "i",
          lower: { kind: "num", numerator: "1", denominator: "1" },
          upper: { kind: "sym", id: "symbols:n" },
          body: {
            kind: "sum",
            binder: "j",
            lower: { kind: "num", numerator: "1", denominator: "1" },
            upper: { kind: "sym", id: "symbols:m" },
            body: { kind: "unparsed", latex: "i j" },
          },
        },
        { kind: "num", numerator: "1", denominator: "1" },
      ],
    });
  });

  it("binds the binder name lexically: the bound variable shadows the table inside the body only", () => {
    const entries: readonly MathSymbolEntry[] = [
      { glyph: "i", scope: "document", id: "curated:imaginary-unit" },
    ];
    const inside = lowerLatex("\\sum_{i=1}^{n} i", { symbolEntries: entries });
    expect(inside.expression).toEqual({
      kind: "sum",
      binder: "i",
      lower: { kind: "num", numerator: "1", denominator: "1" },
      upper: { kind: "sym", id: "symbols:n" },
      body: { kind: "sym", id: "i" },
    });
    const outside = lowerLatex("i", { symbolEntries: entries });
    expect(outside.expression).toEqual({
      kind: "sym",
      id: "curated:imaginary-unit",
    });
  });

  it("resolves a curated table entry by glyph instead of minting a duplicate", () => {
    const entries: readonly MathSymbolEntry[] = [
      {
        glyph: "R",
        scope: "document",
        id: "curated:resistance",
        quantityKind: "si:resistance",
      },
    ];
    const result = lowerLatex("R^2", { symbolEntries: entries });
    expect(result.expression).toEqual({
      kind: "app",
      operator: "math:pow",
      args: [
        { kind: "sym", id: "curated:resistance" },
        { kind: "num", numerator: "2", denominator: "1" },
      ],
    });
    expect(result.mintedSymbols).toEqual([]);
  });

  it("a curated scripted glyph is one symbol — exponentiation stands down for the table's judgement", () => {
    const entries: readonly MathSymbolEntry[] = [
      { glyph: "x^2", scope: "document", id: "curated:square-symbol" },
    ];
    const result = lowerLatex("x^2", { symbolEntries: entries });
    expect(result.expression).toEqual({
      kind: "sym",
      id: "curated:square-symbol",
    });
  });

  it("lowers every named function in the registry to its own operator over the following run", () => {
    const named: readonly (readonly [string, string])[] = [
      ["\\cos", "math:cos"],
      ["\\tan", "math:tan"],
      ["\\cot", "math:cot"],
      ["\\sec", "math:sec"],
      ["\\csc", "math:csc"],
      ["\\arcsin", "math:arcsin"],
      ["\\arccos", "math:arccos"],
      ["\\arctan", "math:arctan"],
      ["\\sinh", "math:sinh"],
      ["\\cosh", "math:cosh"],
      ["\\tanh", "math:tanh"],
      ["\\exp", "math:exp"],
      ["\\log", "math:log"],
      ["\\ln", "math:ln"],
    ];
    for (const [latex, operator] of named) {
      const result = lowerLatex(`${latex} x`);
      expect(
        result.diagnostics.filter(
          (diagnostic) => diagnostic.code !== "latex/binder-bound-implicit",
        ),
      ).toEqual([]);
      expect(result.expression).toEqual({
        kind: "app",
        operator,
        args: [{ kind: "sym", id: "symbols:x" }],
      });
    }
  });

  it("mints table entries for every unresolved glyph so every emitted sym reference resolves", () => {
    const result = lowerLatex("a + b");
    expect(result.mintedSymbols).toEqual([
      { glyph: "a", scope: "document", id: "symbols:a" },
      { glyph: "b", scope: "document", id: "symbols:b" },
    ]);
  });
});

// The degradation table: context-starved and out-of-scope constructs stay visible data — an `unparsed` node carrying the verbatim source plus a named diagnostic — never a throw, never a silent guess.
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
    lowerLatex("2x", { sink: (diagnostic) => seen.push(diagnostic.code) });
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
