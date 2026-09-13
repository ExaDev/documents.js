import { describe, expect, it } from "vitest";
import { FORMULA_PRESETS } from "./formula-presets";

describe("FORMULA_PRESETS", () => {
  it("declares exactly six presets", () => {
    expect(FORMULA_PRESETS).toHaveLength(6);
  });

  it("gives every preset a non-empty label and at least one MathML node", () => {
    for (const preset of FORMULA_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.mathml.length).toBeGreaterThan(0);
    }
  });

  it("declares the exact labels, in order", () => {
    expect(FORMULA_PRESETS.map((preset) => preset.label)).toEqual([
      "Fraction: x / 2",
      "Power: x^2",
      "Subscript: x_i",
      "Square root: sqrt(x)",
      "Summation: sum(i=1..n) i",
      "Quadratic formula",
    ]);
  });

  it("builds the fraction preset as mfrac(mi(x), mn(2))", () => {
    expect(FORMULA_PRESETS[0]?.mathml).toEqual([
      {
        type: "element",
        tag: "mfrac",
        attributes: [],
        children: [
          {
            type: "element",
            tag: "mi",
            attributes: [],
            children: [{ type: "text", value: "x" }],
          },
          {
            type: "element",
            tag: "mn",
            attributes: [],
            children: [{ type: "text", value: "2" }],
          },
        ],
      },
    ]);
  });

  it("builds the power preset as msup(mi(x), mn(2))", () => {
    expect(FORMULA_PRESETS[1]?.mathml).toEqual([
      {
        type: "element",
        tag: "msup",
        attributes: [],
        children: [
          {
            type: "element",
            tag: "mi",
            attributes: [],
            children: [{ type: "text", value: "x" }],
          },
          {
            type: "element",
            tag: "mn",
            attributes: [],
            children: [{ type: "text", value: "2" }],
          },
        ],
      },
    ]);
  });

  it("builds the subscript preset as msub(mi(x), mi(i))", () => {
    expect(FORMULA_PRESETS[2]?.mathml).toEqual([
      {
        type: "element",
        tag: "msub",
        attributes: [],
        children: [
          {
            type: "element",
            tag: "mi",
            attributes: [],
            children: [{ type: "text", value: "x" }],
          },
          {
            type: "element",
            tag: "mi",
            attributes: [],
            children: [{ type: "text", value: "i" }],
          },
        ],
      },
    ]);
  });

  it("builds the square-root preset as msqrt(mi(x))", () => {
    expect(FORMULA_PRESETS[3]?.mathml).toEqual([
      {
        type: "element",
        tag: "msqrt",
        attributes: [],
        children: [
          {
            type: "element",
            tag: "mi",
            attributes: [],
            children: [{ type: "text", value: "x" }],
          },
        ],
      },
    ]);
  });

  it("builds the exact summation preset tree", () => {
    expect(FORMULA_PRESETS[4]?.mathml).toEqual([
      {
        type: "element",
        tag: "munderover",
        attributes: [],
        children: [
          {
            type: "element",
            tag: "mo",
            attributes: [],
            children: [{ type: "text", value: "∑" }],
          },
          {
            type: "element",
            tag: "mrow",
            attributes: [],
            children: [
              {
                type: "element",
                tag: "mi",
                attributes: [],
                children: [{ type: "text", value: "i" }],
              },
              {
                type: "element",
                tag: "mo",
                attributes: [],
                children: [{ type: "text", value: "=" }],
              },
              {
                type: "element",
                tag: "mn",
                attributes: [],
                children: [{ type: "text", value: "1" }],
              },
            ],
          },
          {
            type: "element",
            tag: "mi",
            attributes: [],
            children: [{ type: "text", value: "n" }],
          },
        ],
      },
    ]);
  });

  it("builds the exact quadratic-formula preset tree", () => {
    const element = (
      tag: string,
      children: readonly unknown[] = [],
    ): unknown => ({ type: "element", tag, attributes: [], children });
    const text = (value: string): unknown => ({ type: "text", value });
    const mi = (name: string): unknown => element("mi", [text(name)]);
    const mn = (value: string): unknown => element("mn", [text(value)]);
    const mo = (operator: string): unknown => element("mo", [text(operator)]);

    expect(FORMULA_PRESETS[5]?.mathml).toEqual([
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
    ]);
  });
});
