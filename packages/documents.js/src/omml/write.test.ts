import type { XmlElement, XmlNode } from "ooxml.js";
import { attr, buildXml, childrenWithTag, elementsWithTag } from "ooxml.js";
import { describe, expect, it } from "vitest";
import type { MathMlElement, MathMlNode } from "../mathml/nodes";
import { buildOfficeMath, buildOfficeMathParagraph } from "./write";

// MathML -> OMML structural translation. Every assertion below is about the ACTUAL OMML element tree written (m:f/m:rad/m:sSub/m:m/...), not about a rendered result — this module produces markup a real docx-math-aware consumer renders, so the markup itself is the thing under test.

// Hand-built MathML nodes, the same "structurally compatible mirror" shape odf.js's own readOdfFormulaMathMl produces (see src/mathml/nodes.ts's own module comment) — no XML parsing needed to construct an input tree.
function mel(
  tag: string,
  attrs: Record<string, string> = {},
  children: MathMlNode[] = [],
): MathMlElement {
  return {
    type: "element",
    tag,
    attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    children,
  };
}

function mtxt(value: string): MathMlNode {
  return { type: "text", value };
}

function token(
  tag: string,
  text: string,
  attrs: Record<string, string> = {},
): MathMlElement {
  return mel(tag, attrs, [mtxt(text)]);
}

// The m:oMath element a formula translates to, failing loudly rather than returning undefined — every fixture in this file is expected to produce real content.
function oMath(mathml: readonly MathMlNode[]): XmlElement {
  const { element } = buildOfficeMath(mathml);
  if (element === undefined) {
    throw new Error("expected buildOfficeMath to produce an m:oMath element");
  }
  return element;
}

function firstByTag(root: XmlElement, tag: string): XmlElement {
  const found = elementsWithTag([root], tag)[0];
  if (found === undefined) {
    throw new Error(
      `expected the OMML tree to contain a ${tag} element, got: ${buildXml([root])}`,
    );
  }
  return found;
}

// Every direct child element tag of `element`, in document order — OMML's content models are ordered sequences (CT_F is num then den, CT_Rad is radPr/deg/e, CT_SSubSup is e/sub/sup), so the ORDER is part of what makes the output valid, not just the membership.
function childTags(element: XmlElement): string[] {
  return element.children.flatMap((child) =>
    child.type === "element" ? [child.tag] : [],
  );
}

function mathText(element: XmlElement): string[] {
  return elementsWithTag([element], "m:t").map((t) =>
    t.children
      .map((child) => (child.type === "text" ? child.value : ""))
      .join(""),
  );
}

describe("buildOfficeMath: token elements", () => {
  it("writes an mi as a math run, italic by MathML's own single-character intrinsic default", () => {
    const root = oMath([token("mi", "x")]);
    const run = firstByTag(root, "m:r");
    expect(mathText(run)).toEqual(["x"]);
    expect(attr(firstByTag(run, "m:sty"), "m:val")).toBe("i");
  });

  it("writes a multi-character mi upright, matching MathML3 3.2.3's own function-name convention", () => {
    expect(
      attr(firstByTag(oMath([token("mi", "sin")]), "m:sty"), "m:val"),
    ).toBe("p");
  });

  it("writes mn and mo upright", () => {
    expect(attr(firstByTag(oMath([token("mn", "42")]), "m:sty"), "m:val")).toBe(
      "p",
    );
    expect(attr(firstByTag(oMath([token("mo", "+")]), "m:sty"), "m:val")).toBe(
      "p",
    );
  });

  it("trims an mo's own surrounding whitespace, exactly as the layout engine does", () => {
    expect(mathText(oMath([token("mo", " + ")]))).toEqual(["+"]);
  });

  it("does NOT trim an mn's own surrounding whitespace, unlike mo", () => {
    expect(mathText(oMath([token("mn", " 42 ")]))).toEqual([" 42 "]);
  });

  it("writes mtext as OMML normal text (m:nor), the run kind that renders in the paragraph font rather than the math font, and reports no diagnostic for it", () => {
    const { element, diagnostics } = buildOfficeMath([token("mtext", "where")]);
    if (element === undefined) {
      throw new Error("expected OMML content");
    }
    expect(elementsWithTag([element], "m:nor")).toHaveLength(1);
    expect(elementsWithTag([element], "m:sty")).toHaveLength(0);
    expect(diagnostics).toEqual([]);
  });

  it("an mtext carrying an explicit mathvariant is styled like any other token, not written as m:nor", () => {
    const root = oMath([token("mtext", "x", { mathvariant: "bold" })]);
    expect(elementsWithTag([root], "m:nor")).toHaveLength(0);
    expect(attr(firstByTag(root, "m:sty"), "m:val")).toBe("b");
  });

  it("writes no run at all for a token with empty text content", () => {
    expect(buildOfficeMath([token("mi", "")]).element).toBeUndefined();
    // Alongside real content, the empty token contributes nothing: exactly one run, not two.
    const root = oMath([token("mi", ""), token("mi", "x")]);
    expect(elementsWithTag([root], "m:r")).toHaveLength(1);
  });

  it("marks a run's own m:t with xml:space=preserve exactly when the text has leading/trailing whitespace, never otherwise", () => {
    const padded = firstByTag(oMath([token("mtext", " x ")]), "m:t");
    expect(attr(padded, "xml:space")).toBe("preserve");
    const bare = firstByTag(oMath([token("mtext", "x")]), "m:t");
    expect(attr(bare, "xml:space")).toBeUndefined();
  });

  it("maps every mathvariant onto OMML's own m:scr script and m:sty style axes", () => {
    const cases: readonly (readonly [string, string | undefined, string])[] = [
      ["bold", undefined, "b"],
      ["italic", undefined, "i"],
      ["bold-italic", undefined, "bi"],
      ["double-struck", "double-struck", "p"],
      ["script", "script", "p"],
      ["bold-script", "script", "b"],
      ["fraktur", "fraktur", "p"],
      ["bold-fraktur", "fraktur", "b"],
      ["sans-serif", "sans-serif", "p"],
      ["bold-sans-serif", "sans-serif", "b"],
      ["sans-serif-italic", "sans-serif", "i"],
      ["sans-serif-bold-italic", "sans-serif", "bi"],
      ["monospace", "monospace", "p"],
      ["normal", undefined, "p"],
    ];
    for (const [variant, scr, sty] of cases) {
      const root = oMath([token("mi", "R", { mathvariant: variant })]);
      const rPr = firstByTag(root, "m:rPr");
      expect(
        childrenWithTag(rPr, "m:scr").map((element) => attr(element, "m:val")),
      ).toEqual(scr === undefined ? [] : [scr]);
      expect(attr(firstByTag(rPr, "m:sty"), "m:val")).toBe(sty);
      // The characters themselves stay in their base form: OMML carries the style as markup, so also rewriting them into the Mathematical Alphanumeric Symbols block would double-apply it.
      expect(mathText(root)).toEqual(["R"]);
    }
  });

  it("inherits an mstyle's own mathvariant into descendant tokens", () => {
    const root = oMath([
      mel("mstyle", { mathvariant: "double-struck" }, [token("mi", "N")]),
    ]);
    expect(attr(firstByTag(root, "m:scr"), "m:val")).toBe("double-struck");
  });
});

describe("buildOfficeMath: mfrac -> m:f", () => {
  it("writes num and den in OMML's own order", () => {
    const root = oMath([
      mel("mfrac", {}, [token("mi", "a"), token("mi", "b")]),
    ]);
    const fraction = firstByTag(root, "m:f");
    expect(childTags(fraction)).toEqual(["m:num", "m:den"]);
    expect(mathText(fraction)).toEqual(["a", "b"]);
  });

  it('writes a zero linethickness as m:fPr/m:type="noBar", OMML\'s own barless fraction shape', () => {
    const fraction = firstByTag(
      oMath([
        mel("mfrac", { linethickness: "0" }, [
          token("mn", "1"),
          token("mn", "2"),
        ]),
      ]),
      "m:f",
    );
    expect(childTags(fraction)).toEqual(["m:fPr", "m:num", "m:den"]);
    expect(attr(firstByTag(fraction, "m:type"), "m:val")).toBe("noBar");
  });

  it("leaves an ordinary fraction with no m:fPr at all", () => {
    expect(
      childTags(
        firstByTag(
          oMath([
            mel("mfrac", { linethickness: "1pt" }, [
              token("mn", "1"),
              token("mn", "2"),
            ]),
          ]),
          "m:f",
        ),
      ),
    ).toEqual(["m:num", "m:den"]);
  });
});

describe("buildOfficeMath: msqrt/mroot -> m:rad", () => {
  it("writes a square root with a hidden, present-but-empty degree", () => {
    const radical = firstByTag(
      oMath([mel("msqrt", {}, [token("mi", "x")])]),
      "m:rad",
    );
    expect(childTags(radical)).toEqual(["m:radPr", "m:deg", "m:e"]);
    expect(attr(firstByTag(radical, "m:degHide"), "m:val")).toBe("1");
    expect(firstByTag(radical, "m:deg").children).toHaveLength(0);
    expect(mathText(firstByTag(radical, "m:e"))).toEqual(["x"]);
  });

  it("treats msqrt's own children as an implicit row rather than a single radicand", () => {
    const radical = firstByTag(
      oMath([
        mel("msqrt", {}, [
          token("mi", "a"),
          token("mo", "+"),
          token("mi", "b"),
        ]),
      ]),
      "m:rad",
    );
    expect(mathText(firstByTag(radical, "m:e"))).toEqual(["a", "+", "b"]);
  });

  it("swaps mroot's own (radicand, index) order into OMML's own (degree, base) order, with no degHide", () => {
    const radical = firstByTag(
      oMath([mel("mroot", {}, [token("mi", "x"), token("mn", "3")])]),
      "m:rad",
    );
    expect(childTags(radical)).toEqual(["m:deg", "m:e"]);
    expect(mathText(firstByTag(radical, "m:deg"))).toEqual(["3"]);
    expect(mathText(firstByTag(radical, "m:e"))).toEqual(["x"]);
  });
});

describe("buildOfficeMath: scripts", () => {
  it("writes msub as m:sSub, msup as m:sSup, and msubsup as m:sSubSup in OMML's own child order", () => {
    expect(
      childTags(
        firstByTag(
          oMath([mel("msub", {}, [token("mi", "x"), token("mn", "1")])]),
          "m:sSub",
        ),
      ),
    ).toEqual(["m:e", "m:sub"]);
    expect(
      childTags(
        firstByTag(
          oMath([mel("msup", {}, [token("mi", "x"), token("mn", "2")])]),
          "m:sSup",
        ),
      ),
    ).toEqual(["m:e", "m:sup"]);

    const subSup = firstByTag(
      oMath([
        mel("msubsup", {}, [
          token("mi", "y"),
          token("mn", "1"),
          token("mn", "2"),
        ]),
      ]),
      "m:sSubSup",
    );
    expect(childTags(subSup)).toEqual(["m:e", "m:sub", "m:sup"]);
    expect(mathText(subSup)).toEqual(["y", "1", "2"]);
  });
});

describe("buildOfficeMath: limits", () => {
  it("writes munder as m:limLow and mover as m:limUpp", () => {
    expect(
      childTags(
        firstByTag(
          oMath([mel("munder", {}, [token("mo", "∑"), token("mi", "i")])]),
          "m:limLow",
        ),
      ),
    ).toEqual(["m:e", "m:lim"]);
    expect(
      childTags(
        firstByTag(
          oMath([mel("mover", {}, [token("mo", "∑"), token("mi", "n")])]),
          "m:limUpp",
        ),
      ),
    ).toEqual(["m:e", "m:lim"]);
  });

  it("nests munderover as an m:limUpp over an m:limLow, OMML having no single both-limits element", () => {
    const root = oMath([
      mel("munderover", {}, [
        token("mo", "∑"),
        token("mi", "i"),
        token("mi", "n"),
      ]),
    ]);
    const upper = firstByTag(root, "m:limUpp");
    const lower = firstByTag(upper, "m:limLow");
    expect(mathText(firstByTag(lower, "m:e"))).toEqual(["∑"]);
    expect(mathText(firstByTag(lower, "m:lim"))).toEqual(["i"]);
    // The outer limit is the over-script, and it is NOT the one nested inside m:limLow.
    expect(childrenWithTag(upper, "m:lim").flatMap(mathText)).toEqual(["n"]);
  });

  it("takes a movablelimits operator's own limits as ordinary scripts outside display style, matching the layout engine's own \\nolimits behaviour", () => {
    const root = oMath([
      mel("mstyle", { displaystyle: "false" }, [
        mel("munderover", {}, [
          token("mo", "∑"),
          token("mi", "i"),
          token("mi", "n"),
        ]),
      ]),
    ]);
    expect(elementsWithTag([root], "m:limLow")).toHaveLength(0);
    expect(childTags(firstByTag(root, "m:sSubSup"))).toEqual([
      "m:e",
      "m:sub",
      "m:sup",
    ]);
  });

  it("still stacks a NON-movablelimits base outside display style", () => {
    const root = oMath([
      mel("mstyle", { displaystyle: "false" }, [
        mel("mover", {}, [token("mi", "x"), token("mo", "¯")]),
      ]),
    ]);
    expect(elementsWithTag([root], "m:limUpp")).toHaveLength(1);
  });

  it("the same movablelimits-outside-display-style rule applies to munder (-> m:sSub) and mover (-> m:sSup), not only munderover", () => {
    const under = oMath([
      mel("mstyle", { displaystyle: "false" }, [
        mel("munder", {}, [token("mo", "∑"), token("mi", "i")]),
      ]),
    ]);
    expect(elementsWithTag([under], "m:limLow")).toHaveLength(0);
    expect(childTags(firstByTag(under, "m:sSub"))).toEqual(["m:e", "m:sub"]);

    const over = oMath([
      mel("mstyle", { displaystyle: "false" }, [
        mel("mover", {}, [token("mo", "∑"), token("mi", "n")]),
      ]),
    ]);
    expect(elementsWithTag([over], "m:limUpp")).toHaveLength(0);
    expect(childTags(firstByTag(over, "m:sSup"))).toEqual(["m:e", "m:sup"]);
  });

  it("an explicit displaystyle=true behaves exactly like the default (root) display style", () => {
    const root = oMath([
      mel("mstyle", { displaystyle: "true" }, [
        mel("munderover", {}, [
          token("mo", "∑"),
          token("mi", "i"),
          token("mi", "n"),
        ]),
      ]),
    ]);
    expect(elementsWithTag([root], "m:limUpp")).toHaveLength(1);
    expect(elementsWithTag([root], "m:sSubSup")).toHaveLength(0);
  });

  it("an mstyle with neither displaystyle nor mathvariant set leaves the inherited display style untouched (still the root's own true)", () => {
    const root = oMath([
      mel("mstyle", { id: "irrelevant" }, [
        mel("munderover", {}, [
          token("mo", "∑"),
          token("mi", "i"),
          token("mi", "n"),
        ]),
      ]),
    ]);
    expect(elementsWithTag([root], "m:limUpp")).toHaveLength(1);
    expect(elementsWithTag([root], "m:sSubSup")).toHaveLength(0);
  });

  it("trims a movable-limits operator's own surrounding whitespace before matching it against the operator dictionary, same as an ordinary mo", () => {
    const root = oMath([
      mel("mstyle", { displaystyle: "false" }, [
        mel("munderover", {}, [
          mel("mo", {}, [mtxt(" ∑ ")]),
          token("mi", "i"),
          token("mi", "n"),
        ]),
      ]),
    ]);
    expect(childTags(firstByTag(root, "m:sSubSup"))).toEqual([
      "m:e",
      "m:sub",
      "m:sup",
    ]);
  });

  it("a munder/mover with no base at all is not mistaken for a movable-limits operator, and does not throw", () => {
    expect(() => oMath([mel("munder", {}, [])])).not.toThrow();
    const root = oMath([
      mel("mstyle", { displaystyle: "false" }, [mel("munder", {}, [])]),
    ]);
    // With no base element, isMovableLimitsOperator is false regardless of display style, so this still takes the ordinary m:limLow path.
    expect(elementsWithTag([root], "m:limLow")).toHaveLength(1);
  });

  it("only treats an actual mo element as a movable-limits operator, not any element whose text happens to match one", () => {
    const root = oMath([
      mel("mstyle", { displaystyle: "false" }, [
        mel("munder", {}, [mel("mi", {}, [mtxt("∑")]), token("mi", "i")]),
      ]),
    ]);
    // The base is an mi, not an mo, so isMovableLimitsOperator must be false here even though its text is a real movable-limits operator: this still takes the ordinary m:limLow path, not m:sSub.
    expect(elementsWithTag([root], "m:sSub")).toHaveLength(0);
    expect(elementsWithTag([root], "m:limLow")).toHaveLength(1);
  });
});

describe("buildOfficeMath: mtable -> m:m", () => {
  const matrix = mel("mtable", { columnalign: "left right" }, [
    mel("mtr", {}, [
      mel("mtd", {}, [token("mn", "1")]),
      mel("mtd", {}, [token("mn", "2")]),
    ]),
    mel("mtr", {}, [
      mel("mtd", {}, [token("mn", "3")]),
      mel("mtd", {}, [token("mn", "4")]),
    ]),
  ]);

  it("writes one m:mr per row and one m:e per cell", () => {
    const table = firstByTag(oMath([matrix]), "m:m");
    expect(childTags(table)).toEqual(["m:mPr", "m:mr", "m:mr"]);
    const rows = childrenWithTag(table, "m:mr");
    expect(rows.map(childTags)).toEqual([
      ["m:e", "m:e"],
      ["m:e", "m:e"],
    ]);
    expect(rows.flatMap(mathText)).toEqual(["1", "2", "3", "4"]);
  });

  it("carries columnalign through as one m:mc per column, each with its own count and justification", () => {
    const table = firstByTag(oMath([matrix]), "m:m");
    const columns = childrenWithTag(firstByTag(table, "m:mcs"), "m:mc");
    expect(columns).toHaveLength(2);
    expect(
      columns.map((column) => attr(firstByTag(column, "m:count"), "m:val")),
    ).toEqual(["1", "1"]);
    expect(
      columns.map((column) => attr(firstByTag(column, "m:mcJc"), "m:val")),
    ).toEqual(["left", "right"]);
  });

  it("repeats columnalign's own last entry across the remaining columns, per MathML's own rule, and defaults to centre", () => {
    const wide = mel("mtable", { columnalign: "left" }, [
      mel("mtr", {}, [
        mel("mtd", {}, [token("mn", "1")]),
        mel("mtd", {}, [token("mn", "2")]),
      ]),
    ]);
    const aligns = childrenWithTag(
      firstByTag(oMath([wide]), "m:mcs"),
      "m:mc",
    ).map((column) => attr(firstByTag(column, "m:mcJc"), "m:val"));
    expect(aligns).toEqual(["left", "left"]);

    const plain = mel("mtable", {}, [
      mel("mtr", {}, [mel("mtd", {}, [token("mn", "1")])]),
    ]);
    expect(attr(firstByTag(oMath([plain]), "m:mcJc"), "m:val")).toBe("center");
  });

  it("resolves an explicit columnalign of center the same as the unrecognised-value fallback, and rejects anything else it does not know", () => {
    const explicit = mel("mtable", { columnalign: "center" }, [
      mel("mtr", {}, [mel("mtd", {}, [token("mn", "1")])]),
    ]);
    expect(attr(firstByTag(oMath([explicit]), "m:mcJc"), "m:val")).toBe(
      "center",
    );
    const unrecognised = mel("mtable", { columnalign: "justify" }, [
      mel("mtr", {}, [mel("mtd", {}, [token("mn", "1")])]),
    ]);
    expect(attr(firstByTag(oMath([unrecognised]), "m:mcJc"), "m:val")).toBe(
      "center",
    );
  });

  it("counts only mtr children as rows and only mtd children within a row as cells, ignoring anything else present", () => {
    const withNoise = mel("mtable", {}, [
      mel("mtr", {}, [
        mel("mtd", {}, [token("mn", "1")]),
        mel("mstyle", {}, [token("mn", "99")]), // not an mtd: must not become a second cell
      ]),
      mel("mstyle", {}, [token("mn", "0")]), // not an mtr: must not become a second row
    ]);
    const table = firstByTag(oMath([withNoise]), "m:m");
    const rows = childrenWithTag(table, "m:mr");
    expect(rows).toHaveLength(1);
    expect(childrenWithTag(rows[0]!, "m:e")).toHaveLength(1);
    expect(rows.flatMap(mathText)).toEqual(["1"]);
  });

  it("collapses runs of whitespace and trims the columnalign attribute itself before splitting it into column tokens", () => {
    const spaced = mel("mtable", { columnalign: "  left    right  " }, [
      mel("mtr", {}, [
        mel("mtd", {}, [token("mn", "1")]),
        mel("mtd", {}, [token("mn", "2")]),
      ]),
    ]);
    const aligns = childrenWithTag(
      firstByTag(oMath([spaced]), "m:mcs"),
      "m:mc",
    ).map((column) => attr(firstByTag(column, "m:mcJc"), "m:val"));
    expect(aligns).toEqual(["left", "right"]);
  });

  it("wraps each column's own count/justification in its own m:mcPr, not floating loose in the m:mc", () => {
    const table = firstByTag(oMath([matrix]), "m:m");
    const columns = childrenWithTag(firstByTag(table, "m:mcs"), "m:mc");
    for (const column of columns) {
      expect(childTags(column)).toEqual(["m:mcPr"]);
      expect(childTags(firstByTag(column, "m:mcPr"))).toEqual([
        "m:count",
        "m:mcJc",
      ]);
    }
  });

  it("emits no m:mPr/m:mcs at all when no row has any cells", () => {
    const empty = mel("mtable", { columnalign: "left" }, [
      mel("mtr", {}, []),
      mel("mtr", {}, []),
    ]);
    const table = firstByTag(oMath([empty]), "m:m");
    expect(elementsWithTag([table], "m:mPr")).toHaveLength(0);
    expect(elementsWithTag([table], "m:mcs")).toHaveLength(0);
  });

  it("pads a row with no mtd cells at all with a single empty m:e, per CT_MR's own requirement for at least one", () => {
    const withEmptyRow = mel("mtable", {}, [
      mel("mtr", {}, [mel("mtd", {}, [token("mn", "1")])]),
      mel("mtr", {}, []),
    ]);
    const table = firstByTag(oMath([withEmptyRow]), "m:m");
    const rows = childrenWithTag(table, "m:mr");
    expect(rows).toHaveLength(2);
    expect(childTags(rows[1]!)).toEqual(["m:e"]);
    expect(mathText(rows[1]!)).toEqual([]);
  });
});

describe("buildOfficeMath: rows, mstyle, and semantics flatten", () => {
  it("flattens an mrow straight into the containing slot, OMML having no row element of its own", () => {
    const numerator = firstByTag(
      oMath([
        mel("mfrac", {}, [
          mel("mrow", {}, [
            token("mi", "a"),
            token("mo", "+"),
            token("mi", "b"),
          ]),
          token("mi", "c"),
        ]),
      ]),
      "m:num",
    );
    expect(childTags(numerator)).toEqual(["m:r", "m:r", "m:r"]);
    expect(mathText(numerator)).toEqual(["a", "+", "b"]);
  });

  it("never applies its own displaystyle/mathvariant attributes (nonstandard on mrow), unlike mstyle", () => {
    const root = oMath([
      mel("mrow", { mathvariant: "bold" }, [token("mi", "x")]),
    ]);
    // A real mrow ignores its own mathvariant entirely: no m:scr at all, and the default italic single-letter styling still applies.
    expect(elementsWithTag([root], "m:scr")).toHaveLength(0);
    expect(attr(firstByTag(root, "m:sty"), "m:val")).toBe("i");
  });

  it("renders semantics' own first non-annotation child and skips every annotation, even when the annotation comes FIRST", () => {
    const root = oMath([
      mel("semantics", {}, [
        mel("annotation", { encoding: "StarMath 5.0" }, [mtxt("{a} over {b}")]),
        mel("mfrac", {}, [token("mi", "a"), token("mi", "b")]),
      ]),
    ]);
    expect(elementsWithTag([root], "m:f")).toHaveLength(1);
    expect(mathText(root)).toEqual(["a", "b"]);
  });

  it("skips an annotation-xml exactly the same way it skips annotation, even when it comes FIRST", () => {
    const root = oMath([
      mel("semantics", {}, [
        mel("annotation-xml", { encoding: "MathML-Presentation" }, [
          token("mi", "should-not-appear"),
        ]),
        mel("mfrac", {}, [token("mi", "a"), token("mi", "b")]),
      ]),
    ]);
    expect(elementsWithTag([root], "m:f")).toHaveLength(1);
    expect(mathText(root)).toEqual(["a", "b"]);
  });

  it("ignores whitespace text nodes between element siblings", () => {
    expect(
      mathText(oMath([mtxt("\n  "), token("mi", "x"), mtxt("\n")])),
    ).toEqual(["x"]);
  });
});

describe("buildOfficeMath: degradation", () => {
  it("degrades a construct with no OMML equivalent to a literal-text run carrying its own content, and reports it", () => {
    const { element, diagnostics } = buildOfficeMath([
      mel("mmultiscripts", {}, [
        token("mi", "F"),
        token("mn", "1"),
        token("mn", "2"),
      ]),
    ]);
    if (element === undefined) {
      throw new Error(
        "expected the degraded construct to still produce OMML content",
      );
    }
    expect(mathText(element)).toEqual(["F12"]);
    expect(diagnostics).toEqual([
      { kind: "unsupported-element", detail: "mmultiscripts" },
    ]);
  });

  it("degrades a construct to a normal-text run (m:nor), the same run kind mtext uses, not a math-styled one", () => {
    const { element } = buildOfficeMath([
      mel("mmultiscripts", {}, [token("mi", "F")]),
    ]);
    if (element === undefined) {
      throw new Error("expected OMML content");
    }
    expect(elementsWithTag([element], "m:nor")).toHaveLength(1);
    expect(elementsWithTag([element], "m:sty")).toHaveLength(0);
  });

  it("reached directly, with no enclosing mtable, mtr/mtd flatten into an implicit row of their own children rather than being unsupported", () => {
    const { element: fromRow, diagnostics: rowDiagnostics } = buildOfficeMath([
      mel("mtr", {}, [token("mi", "a"), token("mi", "b")]),
    ]);
    if (fromRow === undefined) {
      throw new Error("expected OMML content");
    }
    expect(mathText(fromRow)).toEqual(["a", "b"]);
    expect(rowDiagnostics).toEqual([]);

    const { element: fromCell, diagnostics: cellDiagnostics } = buildOfficeMath(
      [mel("mtd", {}, [token("mi", "c")])],
    );
    if (fromCell === undefined) {
      throw new Error("expected OMML content");
    }
    expect(mathText(fromCell)).toEqual(["c"]);
    expect(cellDiagnostics).toEqual([]);
    // Genuinely dispatched through mi's own conversion (single-letter italic), not degraded to a flat unsupported-element run: proves this reaches convertElement per child rather than tokenRun-ing the cell's own concatenated text.
    expect(attr(firstByTag(fromCell, "m:sty"), "m:val")).toBe("i");
    expect(elementsWithTag([fromCell], "m:nor")).toHaveLength(0);
  });

  it("degrades only the unsupported construct, leaving the rest of the formula real OMML", () => {
    const { element, diagnostics } = buildOfficeMath([
      mel("mrow", {}, [
        mel("mfrac", {}, [token("mi", "a"), token("mi", "b")]),
        mel("maction", { actiontype: "toggle" }, [token("mi", "z")]),
      ]),
    ]);
    if (element === undefined) {
      throw new Error("expected OMML content");
    }
    expect(elementsWithTag([element], "m:f")).toHaveLength(1);
    expect(diagnostics.map((diagnostic) => diagnostic.detail)).toEqual([
      "maction",
    ]);
  });

  it("approximates mspace as a single literal space, since OMML has no width-parameterised spacer at all", () => {
    const { element, diagnostics } = buildOfficeMath([
      token("mi", "a"),
      mel("mspace", { width: "1em" }),
      token("mi", "b"),
    ]);
    if (element === undefined) {
      throw new Error("expected OMML content");
    }
    expect(mathText(element)).toEqual(["a", " ", "b"]);
    expect(diagnostics).toEqual([
      { kind: "approximated-element", detail: "mspace" },
    ]);
  });

  it("wraps the approximating space in the same m:rPr/m:nor 'normal text' run properties mtext uses, not left unstyled or styled as math", () => {
    const root = oMath([mel("mspace", { width: "1em" })]);
    expect(elementsWithTag([root], "m:rPr")).toHaveLength(1);
    expect(elementsWithTag([root], "m:nor")).toHaveLength(1);
  });

  it("writes nothing at all, and reports nothing, for a zero-width mspace", () => {
    const { element, diagnostics } = buildOfficeMath([
      mel("mspace", { width: "0em" }),
    ]);
    expect(element).toBeUndefined();
    expect(diagnostics).toEqual([]);
  });

  it("reports no element at all for an empty formula, so a caller can fall back to its own stand-in", () => {
    expect(buildOfficeMath([]).element).toBeUndefined();
    expect(buildOfficeMathParagraph([]).element).toBeUndefined();
  });
});

describe("buildOfficeMath: root element", () => {
  it("declares the OMML namespace on its own m:oMath root, not only on buildOfficeMathParagraph's wrapper", () => {
    const { element } = buildOfficeMath([token("mi", "x")]);
    if (element === undefined) {
      throw new Error("expected an m:oMath element");
    }
    expect(element.tag).toBe("m:oMath");
    expect(attr(element, "xmlns:m")).toBe(
      "http://schemas.openxmlformats.org/officeDocument/2006/math",
    );
  });
});

describe("buildOfficeMathParagraph", () => {
  it("wraps the equation in m:oMathPara, OMML's own display-equation container", () => {
    const { element } = buildOfficeMathParagraph([
      mel("mfrac", {}, [token("mi", "a"), token("mi", "b")]),
    ]);
    if (element === undefined) {
      throw new Error("expected an m:oMathPara element");
    }
    expect(element.tag).toBe("m:oMathPara");
    expect(childTags(element)).toEqual(["m:oMath"]);
    expect(elementsWithTag([element], "m:f")).toHaveLength(1);
  });

  it("declares the OMML namespace exactly once, on the fragment's own root, so it stays valid inside any host docx", () => {
    const { element } = buildOfficeMathParagraph([token("mi", "x")]);
    if (element === undefined) {
      throw new Error("expected an m:oMathPara element");
    }
    expect(attr(element, "xmlns:m")).toBe(
      "http://schemas.openxmlformats.org/officeDocument/2006/math",
    );
    const nested: XmlNode[] = element.children;
    expect(
      elementsWithTag(nested, "m:oMath").map((child) => attr(child, "xmlns:m")),
    ).toEqual([undefined]);
  });

  it("XML-encodes a construct's own literal text rather than corrupting the serialized part", () => {
    const { element } = buildOfficeMathParagraph([
      token("mo", "<"),
      token("mo", "&"),
    ]);
    if (element === undefined) {
      throw new Error("expected an m:oMathPara element");
    }
    expect(buildXml([element])).toContain("<m:t>&lt;</m:t>");
    expect(buildXml([element])).toContain("<m:t>&amp;</m:t>");
  });
});
