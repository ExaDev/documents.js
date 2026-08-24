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

export const FORMULA_PRESETS: readonly FormulaPreset[] = [
  { label: "Fraction: x / 2", mathml: [element("mfrac", [mi("x"), mn("2")])] },
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
