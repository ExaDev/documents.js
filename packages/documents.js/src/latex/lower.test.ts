import type { MathExpression, MathSymbolEntry } from "document-schema.js";
import { describe, expect, it, vi } from "vitest";
import { lowerLatex } from "./lower";

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

describe("lowerLatex operator registries, entry for entry", () => {
  // The registry tables execute at module load, so under per-test coverage a top-level import attributes their execution to whichever worker loads the module first (a markdown test, empirically), leaving the lowering suite itself never selected against a table mutant. The module is loaded by dynamic import inside each test so the table construction lands on THIS test's own coverage record; the assertions then run against a freshly built table, and the alias rows (\ne and \neq, \le and \leq, \ge and \geq, \cdot and \times) are pinned as firmly as the canonical spellings.
  async function operatorOf(latex: string): Promise<string | undefined> {
    vi.resetModules();
    const { lowerLatex: lower } = await import("./lower");
    const { expression } = lower(latex);
    return expression.kind === "app" ? expression.operator : undefined;
  }

  it("maps every binary arithmetic spelling", async () => {
    expect(await operatorOf("a + b")).toBe("math:add");
    expect(await operatorOf("a - b")).toBe("math:subtract");
    expect(await operatorOf("a \\cdot b")).toBe("math:multiply");
    expect(await operatorOf("a \\times b")).toBe("math:multiply");
    expect(await operatorOf("a \\div b")).toBe("math:divide");
  });

  it("maps every relation spelling, including both aliases of the three that have them", async () => {
    expect(await operatorOf("a = b")).toBe("math:eq");
    expect(await operatorOf("a \\neq b")).toBe("math:neq");
    expect(await operatorOf("a \\ne b")).toBe("math:neq");
    expect(await operatorOf("a < b")).toBe("math:lt");
    expect(await operatorOf("a \\leq b")).toBe("math:leq");
    expect(await operatorOf("a \\le b")).toBe("math:leq");
    expect(await operatorOf("a > b")).toBe("math:gt");
    expect(await operatorOf("a \\geq b")).toBe("math:geq");
    expect(await operatorOf("a \\ge b")).toBe("math:geq");
  });

  it("maps every named single-argument function", async () => {
    const named = [
      ["\\sin", "math:sin"],
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
    ] as const;
    for (const [latex, operator] of named) {
      expect(await operatorOf(`${latex}(x)`)).toBe(operator);
    }
  });

  it("folds a leading minus into the negate operator, not subtract", async () => {
    vi.resetModules();
    const { lowerLatex: lower } = await import("./lower");
    const { expression } = lower("-x");
    expect(expression).toEqual({
      kind: "app",
      operator: "math:negate",
      args: [{ kind: "sym", id: "symbols:x" }],
    });
  });
});
