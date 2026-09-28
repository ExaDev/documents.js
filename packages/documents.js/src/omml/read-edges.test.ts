import type { MathMlElement, MathMlNode } from "document-schema.js";
import type { Attribute, XmlElement, XmlNode } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { readOfficeMath } from "./read";

// The companion suite to read.test.ts's construct coverage: the property-value truth table, the defaults each construct mints when its properties element is absent, and the malformed-tree and degradation edges (read.test.ts sits near the max-lines ceiling). Hand-built OMML nodes in ooxml.js's own XmlElement shape, the same construction style read.test.ts uses.

function oel(
  tag: string,
  attrs: Record<string, string> = {},
  children: XmlNode[] = [],
): XmlElement {
  const attributes: Attribute[] = Object.entries(attrs).map(
    ([name, value]) => ({ name, value }),
  );
  return { type: "element", tag, attributes, children };
}

function run(text: string, properties?: XmlElement): XmlElement {
  const children: XmlNode[] = properties === undefined ? [] : [properties];
  children.push(oel("m:t", {}, [{ type: "text", value: text }]));
  return oel("m:r", {}, children);
}

function slot(tag: string, children: XmlNode[]): XmlElement {
  return oel(tag, {}, children);
}

function oMath(children: XmlNode[]): XmlElement {
  return oel("m:oMath", {}, children);
}

function isElement(node: MathMlNode | undefined): node is MathMlElement {
  return node?.type === "element";
}

function onlyElement(nodes: readonly MathMlNode[]): MathMlElement {
  const [first] = nodes;
  if (nodes.length !== 1 || !isElement(first)) {
    throw new Error(
      `expected exactly one recovered MathML element, got ${JSON.stringify(nodes)}`,
    );
  }
  return first;
}

function childTags(element: MathMlElement): string[] {
  return element.children.flatMap((child) =>
    child.type === "element" ? [child.tag] : [],
  );
}

function mathAttr(element: MathMlElement, name: string): string | undefined {
  return element.attributes.find((attribute) => attribute.name === name)?.value;
}

function textOf(node: MathMlNode): string {
  if (node.type === "text") {
    return node.value;
  }
  if (node.type !== "element") {
    return "";
  }
  return node.children.map(textOf).join("");
}

function localTag(tag: string): string {
  const colon = tag.indexOf(":");
  return colon === -1 ? tag : tag.slice(colon + 1);
}

function signature(nodes: readonly MathMlNode[]): string {
  return nodes
    .flatMap((node) => {
      if (node.type !== "element") {
        return [];
      }
      const inner = node.children.some((child) => child.type === "element")
        ? signature(node.children)
        : textOf(node);
      return [`${localTag(node.tag)}(${inner})`];
    })
    .join(",");
}

describe("readOfficeMath: the on/off property truth table, through m:nor", () => {
  const norWith = (val: string | undefined): XmlElement =>
    run(
      "x",
      oel("m:rPr", {}, [
        val === undefined ? oel("m:nor") : oel("m:nor", { "m:val": val }),
      ]),
    );

  it("treats an absent m:val, and the on spellings 1, true and on, as on: the run is normal text", () => {
    for (const val of [undefined, "1", "true", "on"]) {
      const { mathml, diagnostics } = readOfficeMath(oMath([norWith(val)]));
      expect(diagnostics).toEqual([]);
      expect(signature(mathml)).toBe("mtext(x)");
    }
  });

  it("treats an explicit off value as off: the run is mathematics again, not normal text", () => {
    const { mathml, diagnostics } = readOfficeMath(oMath([norWith("0")]));
    expect(diagnostics).toEqual([]);
    expect(signature(mathml)).toBe("mi(x)");
  });
});

describe("readOfficeMath: run assembly edges", () => {
  it("joins a run's multiple m:t elements with nothing between them", () => {
    const twoParts = oel("m:r", {}, [
      oel("m:t", {}, [{ type: "text", value: "ab" }]),
      oel("m:t", {}, [{ type: "text", value: "c" }]),
    ]);
    const { mathml } = readOfficeMath(oMath([twoParts]));
    expect(signature(mathml)).toBe("mi(abc)");
  });

  it("contributes nothing at all for a run whose text is empty", () => {
    const { mathml, diagnostics } = readOfficeMath(
      oMath([oel("m:r", {}, [oel("m:t", {}, [{ type: "text", value: "" }])])]),
    );
    expect(diagnostics).toEqual([]);
    expect(mathml).toEqual([]);
  });

  it("contributes nothing for a comment node inside a run's text", () => {
    const withComment = oel("m:r", {}, [
      oel("m:t", {}, [
        { type: "text", value: "a" },
        { type: "comment", value: " note " },
        { type: "text", value: "b" },
      ]),
    ]);
    const { mathml } = readOfficeMath(oMath([withComment]));
    expect(signature(mathml)).toBe("mi(ab)");
  });

  it("omits mathvariant when the recovered variant is the token's own intrinsic default", () => {
    // A single-letter italic-styled run: 'italic' is a single-char mi's intrinsic default, so restating it would be markup that changes nothing.
    const styled = run("x", oel("m:rPr", {}, [oel("m:sty", { "m:val": "i" })]));
    const { mathml, diagnostics } = readOfficeMath(oMath([styled]));
    expect(diagnostics).toEqual([]);
    const token = onlyElement(mathml);
    expect(token.tag).toBe("mi");
    expect(mathAttr(token, "mathvariant")).toBeUndefined();
  });

  it("writes mathvariant when the recovered variant differs from a multi-character run's plain default", () => {
    // A multi-letter run is upright by default, so an italic style is a real statement.
    const styled = run(
      "sin",
      oel("m:rPr", {}, [oel("m:sty", { "m:val": "i" })]),
    );
    const { mathml } = readOfficeMath(oMath([styled]));
    const token = onlyElement(mathml);
    expect(token.tag).toBe("mi");
    expect(mathAttr(token, "mathvariant")).toBe("italic");
  });

  it("omits mathvariant for a plain-styled digit run, whose variant is mn's own default", () => {
    const styled = run("3", oel("m:rPr", {}, [oel("m:sty", { "m:val": "p" })]));
    const { mathml, diagnostics } = readOfficeMath(oMath([styled]));
    expect(diagnostics).toEqual([]);
    const token = onlyElement(mathml);
    expect(token.tag).toBe("mn");
    expect(mathAttr(token, "mathvariant")).toBeUndefined();
  });

  it("skips a run's properties element itself: no token, no diagnostic", () => {
    const styled = run("x", oel("m:rPr", {}, [oel("m:sty", { "m:val": "b" })]));
    const { mathml, diagnostics } = readOfficeMath(oMath([styled]));
    expect(diagnostics).toEqual([]);
    expect(signature(mathml)).toBe("mi(x)");
  });
});

describe("readOfficeMath: fraction and radical edges", () => {
  it("reads a fraction with no properties element as an ordinary mfrac with no attributes", () => {
    const { mathml, diagnostics } = readOfficeMath(
      oMath([
        oel("m:f", {}, [slot("m:num", [run("a")]), slot("m:den", [run("b")])]),
      ]),
    );
    expect(diagnostics).toEqual([]);
    const frac = onlyElement(mathml);
    expect(frac.tag).toBe("mfrac");
    expect(frac.attributes).toEqual([]);
  });

  it("hides the degree when m:degHide says so, even though the degree slot carries real content", () => {
    const rad = oel("m:rad", {}, [
      oel("m:radPr", {}, [oel("m:degHide")]),
      slot("m:deg", [run("3")]),
      slot("m:e", [run("x")]),
    ]);
    const { mathml, diagnostics } = readOfficeMath(oMath([rad]));
    expect(diagnostics).toEqual([]);
    expect(signature(mathml)).toBe("msqrt(mi(x))");
  });

  it("hides the degree when the degree slot is present but empty", () => {
    const rad = oel("m:rad", {}, [slot("m:deg", []), slot("m:e", [run("x")])]);
    const { mathml } = readOfficeMath(oMath([rad]));
    expect(signature(mathml)).toBe("msqrt(mi(x))");
  });

  it("keeps a real degree as mroot, in MathML's own radicand-then-index order", () => {
    const rad = oel("m:rad", {}, [
      slot("m:deg", [run("3")]),
      slot("m:e", [run("x")]),
    ]);
    const { mathml } = readOfficeMath(oMath([rad]));
    expect(signature(mathml)).toBe("mroot(mi(x),mn(3))");
  });
});

describe("readOfficeMath: the limUpp-over-limLow composition needs a lone base", () => {
  it("reads a limUpp whose base holds more than the limLow as mover over munder, not as one munderover", () => {
    const limLow = oel("m:limLow", {}, [
      slot("m:e", [run("x")]),
      slot("m:lim", [run("i")]),
    ]);
    const limUpp = oel("m:limUpp", {}, [
      slot("m:e", [limLow, run("y")]),
      slot("m:lim", [run("n")]),
    ]);
    const { mathml } = readOfficeMath(oMath([limUpp]));
    expect(signature(mathml)).toBe(
      "mover(mrow(munder(mi(x),mi(i)),mi(y)),mi(n))",
    );
  });
});

describe("readOfficeMath: delimiter defaults and explicit empties", () => {
  const delim = (properties: XmlElement | undefined, slots: XmlElement[]) =>
    oel("m:d", {}, properties === undefined ? slots : [properties, ...slots]);

  it("mints the documented parentheses when the properties element is absent", () => {
    const { mathml, diagnostics } = readOfficeMath(
      oMath([delim(undefined, [slot("m:e", [run("a")])])]),
    );
    expect(diagnostics).toEqual([]);
    expect(signature(mathml)).toBe("mrow(mo((),mi(a),mo()))");
  });

  it("separates a multi-argument delimiter with the documented pipe when m:sepChr is absent", () => {
    const { mathml } = readOfficeMath(
      oMath([
        delim(undefined, [slot("m:e", [run("a")]), slot("m:e", [run("b")])]),
      ]),
    );
    expect(signature(mathml)).toBe("mrow(mo((),mi(a),mo(|),mi(b),mo()))");
  });

  it("emits no closing fence for an explicitly empty m:endChr", () => {
    const properties = oel("m:dPr", {}, [oel("m:endChr", { "m:val": "" })]);
    const { mathml } = readOfficeMath(
      oMath([delim(properties, [slot("m:e", [run("a")])])]),
    );
    expect(signature(mathml)).toBe("mrow(mo((),mi(a))");
  });

  it("emits no separator token at all for an explicitly empty m:sepChr", () => {
    const properties = oel("m:dPr", {}, [oel("m:sepChr", { "m:val": "" })]);
    const { mathml } = readOfficeMath(
      oMath([
        delim(properties, [slot("m:e", [run("a")]), slot("m:e", [run("b")])]),
      ]),
    );
    expect(signature(mathml)).toBe("mrow(mo((),mi(a),mi(b),mo()))");
  });
});

describe("readOfficeMath: n-ary shapes", () => {
  const nary = (
    properties: XmlElement | undefined,
    slots: XmlElement[],
  ): XmlElement =>
    oel(
      "m:nary",
      {},
      properties === undefined ? slots : [properties, ...slots],
    );
  const sub = (text: string) => slot("m:sub", [run(text)]);
  const sup = (text: string) => slot("m:sup", [run(text)]);
  const operand = (text: string) => slot("m:e", [run(text)]);

  it("mints the integral character and script placement by default", () => {
    const { mathml, diagnostics } = readOfficeMath(
      oMath([nary(undefined, [sub("i"), sup("n"), operand("x")])]),
    );
    expect(diagnostics).toEqual([]);
    expect(signature(mathml)).toBe("mrow(msubsup(mo(∫),mi(i),mi(n)),mi(x))");
  });

  it("places a subHide operator's remaining upper limit as an ordinary script", () => {
    const properties = oel("m:naryPr", {}, [oel("m:subHide")]);
    const { mathml } = readOfficeMath(
      oMath([nary(properties, [sup("n"), operand("x")])]),
    );
    expect(signature(mathml)).toBe("mrow(msup(mo(∫),mi(n)),mi(x))");
  });

  it("places a subHide operator's remaining upper limit over the operator when limLoc is undOvr", () => {
    const properties = oel("m:naryPr", {}, [
      oel("m:subHide"),
      oel("m:limLoc", { "m:val": "undOvr" }),
    ]);
    const { mathml } = readOfficeMath(
      oMath([nary(properties, [sup("n"), operand("x")])]),
    );
    expect(signature(mathml)).toBe("mrow(mover(mo(∫),mi(n)),mi(x))");
  });

  it("places a supHide operator's remaining lower limit under the operator when limLoc is undOvr", () => {
    const properties = oel("m:naryPr", {}, [
      oel("m:supHide"),
      oel("m:limLoc", { "m:val": "undOvr" }),
    ]);
    const { mathml } = readOfficeMath(
      oMath([nary(properties, [sub("i"), operand("x")])]),
    );
    expect(signature(mathml)).toBe("mrow(munder(mo(∫),mi(i)),mi(x))");
  });

  it("reduces an operator with both limits hidden to the bare character and its operand", () => {
    const properties = oel("m:naryPr", {}, [
      oel("m:subHide"),
      oel("m:supHide"),
    ]);
    const { mathml } = readOfficeMath(
      oMath([nary(properties, [operand("x")])]),
    );
    expect(signature(mathml)).toBe("mrow(mo(∫),mi(x))");
  });

  it("honours an explicit m:chr", () => {
    const properties = oel("m:naryPr", {}, [oel("m:chr", { "m:val": "∑" })]);
    const { mathml } = readOfficeMath(
      oMath([nary(properties, [operand("x")])]),
    );
    expect(signature(mathml)).toBe("mrow(msubsup(mo(∑),mrow(),mrow()),mi(x))");
  });
});

describe("readOfficeMath: accent and bar defaults", () => {
  it("mints the combining circumflex for an accent with no properties element", () => {
    const { mathml, diagnostics } = readOfficeMath(
      oMath([oel("m:acc", {}, [slot("m:e", [run("x")])])]),
    );
    expect(diagnostics).toEqual([]);
    expect(signature(mathml)).toBe("mover(mi(x),mo(̂))");
  });

  it("unders for a bar with no position property, and overs for pos=top", () => {
    const bottom = readOfficeMath(
      oMath([oel("m:bar", {}, [slot("m:e", [run("x")])])]),
    );
    expect(signature(bottom.mathml)).toBe("munder(mi(x),mo(_))");
    expect(mathAttr(onlyElement(bottom.mathml), "accent")).toBe("true");
    const top = readOfficeMath(
      oMath([
        oel("m:bar", {}, [
          oel("m:barPr", {}, [oel("m:pos", { "m:val": "top" })]),
          slot("m:e", [run("x")]),
        ]),
      ]),
    );
    expect(signature(top.mathml)).toBe("mover(mi(x),mo(‾))");
    expect(mathAttr(onlyElement(top.mathml), "accent")).toBe("true");
  });
});

describe("readOfficeMath: matrix column groups", () => {
  const matrix = (...columnGroups: XmlElement[]): XmlElement =>
    oel("m:m", {}, [
      oel("m:mPr", {}, [oel("m:mcs", {}, columnGroups)]),
      oel("m:mr", {}, [slot("m:e", [run("a")]), slot("m:e", [run("b")])]),
    ]);
  const group = (
    count: string | undefined,
    justification: string,
  ): XmlElement =>
    oel("m:mc", {}, [
      oel("m:mcPr", {}, [
        ...(count === undefined ? [] : [oel("m:count", { "m:val": count })]),
        oel("m:mcJc", { "m:val": justification }),
      ]),
    ]);

  it("expands a column group's own count into that many alignments", () => {
    const { mathml } = readOfficeMath(oMath([matrix(group("2", "left"))]));
    const table = onlyElement(mathml);
    expect(mathAttr(table, "columnalign")).toBe("left left");
  });

  it("writes no columnalign at all when every group is centre", () => {
    const { mathml } = readOfficeMath(oMath([matrix(group("2", "center"))]));
    const table = onlyElement(mathml);
    expect(mathAttr(table, "columnalign")).toBeUndefined();
  });

  it("writes the attribute for a mixed list even though some columns are centre", () => {
    const { mathml } = readOfficeMath(
      oMath([matrix(group("1", "left"), group("1", "center"))]),
    );
    const table = onlyElement(mathml);
    expect(mathAttr(table, "columnalign")).toBe("left center");
  });

  it("falls back to one column for a count that is zero or not a number", () => {
    const zero = readOfficeMath(oMath([matrix(group("0", "left"))]));
    expect(mathAttr(onlyElement(zero.mathml), "columnalign")).toBe("left");
    const notANumber = readOfficeMath(oMath([matrix(group("x", "left"))]));
    expect(mathAttr(onlyElement(notANumber.mathml), "columnalign")).toBe(
      "left",
    );
  });

  it("takes an absent justification as centre, writing no columnalign", () => {
    const plainGroup = oel("m:mc", {}, [oel("m:mcPr", {}, [])]);
    const { mathml, diagnostics } = readOfficeMath(oMath([matrix(plainGroup)]));
    expect(diagnostics).toEqual([]);
    expect(mathAttr(onlyElement(mathml), "columnalign")).toBeUndefined();
  });

  it("takes an absent count as one column", () => {
    const { mathml } = readOfficeMath(
      oMath([matrix(group(undefined, "left"))]),
    );
    expect(mathAttr(onlyElement(mathml), "columnalign")).toBe("left");
  });

  it("recovers each row's cells in order", () => {
    const { mathml } = readOfficeMath(oMath([matrix(group("2", "center"))]));
    const table = onlyElement(mathml);
    const row = table.children.find(isElement);
    expect(row && childTags(row)).toEqual(["mtd", "mtd"]);
  });
});

describe("readOfficeMath: slot-passing and malformed trees", () => {
  it("flattens a bare matrix row handed to the equation directly, as an implicit row", () => {
    const { mathml, diagnostics } = readOfficeMath(
      oMath([
        oel("m:mr", {}, [slot("m:e", [run("a")]), slot("m:e", [run("b")])]),
      ]),
    );
    expect(diagnostics).toEqual([]);
    expect(signature(mathml)).toBe("mi(a),mi(b)");
  });

  it("flattens every argument slot kind handed to the equation directly, each by its own name", () => {
    for (const name of [
      "e",
      "num",
      "den",
      "sub",
      "sup",
      "lim",
      "deg",
      "fName",
    ]) {
      const { mathml, diagnostics } = readOfficeMath(
        oMath([slot(`m:${name}`, [run("a")])]),
      );
      expect(diagnostics, name).toEqual([]);
      expect(signature(mathml), name).toBe("mi(a)");
    }
  });

  it("skips a properties element sitting directly in the equation: no node, no diagnostic", () => {
    const { mathml, diagnostics } = readOfficeMath(
      oMath([oel("m:ctrlPr", {}, [run("x")])]),
    );
    expect(diagnostics).toEqual([]);
    expect(mathml).toEqual([]);
  });

  it("keeps a named function's own name and argument in order", () => {
    const { mathml, diagnostics } = readOfficeMath(
      oMath([
        oel("m:func", {}, [
          slot("m:fName", [run("sin")]),
          slot("m:e", [run("x")]),
        ]),
      ]),
    );
    expect(diagnostics).toEqual([]);
    expect(signature(mathml)).toBe("mrow(mi(sin),mi(x))");
  });

  it("recovers prescripts with the base, marker, and script pair in MathML's own order", () => {
    const { mathml } = readOfficeMath(
      oMath([
        oel("m:sPre", {}, [
          slot("m:sub", [run("i")]),
          slot("m:sup", [run("n")]),
          slot("m:e", [run("x")]),
        ]),
      ]),
    );
    expect(signature(mathml)).toBe(
      "mmultiscripts(mi(x),mprescripts(),mi(i),mi(n))",
    );
  });

  it("recovers a lower limit's base and limit in order", () => {
    const { mathml } = readOfficeMath(
      oMath([
        oel("m:limLow", {}, [
          slot("m:e", [run("x")]),
          slot("m:lim", [run("i")]),
        ]),
      ]),
    );
    expect(signature(mathml)).toBe("munder(mi(x),mi(i))");
  });
});
