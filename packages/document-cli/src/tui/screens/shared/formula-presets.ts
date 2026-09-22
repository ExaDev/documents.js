import type { MathMlNode } from "documents.js";

// Hand-authored MathML trees for the formula-insertion pickers (paragraph-detail.tsx's docx path, paragraph-family.tsx's odt path), the fast default alongside the raw-MathML advanced entry mode both offer (see formula-picker.tsx). Each preset's `mathml` is exactly the shape `ContentFormula.mathml` and `DocxParagraph.appendOfficeMath`/`OdtBody.appendFormula` all expect: the children of a `<math>` root, never the root element itself.

export interface FormulaPreset {
  readonly label: string;
  readonly mathml: readonly MathMlNode[];
}

function element(
  tag: string,
  children: readonly MathMlNode[] = [],
): MathMlNode {
  return { type: "element", tag, attributes: [], children };
}

function text(value: string): MathMlNode {
  return { type: "text", value };
}

function mi(name: string): MathMlNode {
  return element("mi", [text(name)]);
}

function mn(value: string): MathMlNode {
  return element("mn", [text(value)]);
}

function mo(operator: string): MathMlNode {
  return element("mo", [text(operator)]);
}

// A function rather than a module-scope constant, deliberately: Stryker's per-test coverage instrumentation attributes a top-level constant's own one-time initialisation to whichever test happens to trigger the very first import of this module in the whole suite (module caching means every later importer just reads the already-built array) — so mutating a literal here would only ever be re-verified against that one unrelated test, never against this file's own exhaustive assertions below. Rebuilding the array fresh on every call makes each call site's own execution the thing coverage attributes, so formula-presets.test.ts's own calls are what get re-run against a mutant, not whichever screen's test happened to import the module first.
export function getFormulaPresets(): readonly FormulaPreset[] {
  return [
    {
      label: "Fraction: x / 2",
      mathml: [element("mfrac", [mi("x"), mn("2")])],
    },
    { label: "Power: x^2", mathml: [element("msup", [mi("x"), mn("2")])] },
    { label: "Subscript: x_i", mathml: [element("msub", [mi("x"), mi("i")])] },
    { label: "Square root: sqrt(x)", mathml: [element("msqrt", [mi("x")])] },
    {
      label: "Summation: sum(i=1..n) i",
      mathml: [
        element("munderover", [
          mo("∑"),
          element("mrow", [mi("i"), mo("="), mn("1")]),
          mi("n"),
        ]),
      ],
    },
    {
      label: "Quadratic formula",
      mathml: [
        element("mrow", [
          mi("x"),
          mo("="),
          element("mfrac", [
            element("mrow", [
              mo("-"),
              mi("b"),
              mo("±"),
              element("msqrt", [
                element("mrow", [
                  element("msup", [mi("b"), mn("2")]),
                  mo("-"),
                  mn("4"),
                  mi("a"),
                  mi("c"),
                ]),
              ]),
            ]),
            element("mrow", [mn("2"), mi("a")]),
          ]),
        ]),
      ],
    },
  ];
}
