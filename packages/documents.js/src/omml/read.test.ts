import type { MathMlElement, MathMlNode } from "document-schema.js";
import type { Attribute, XmlElement, XmlNode } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { collectOfficeMathElements, readOfficeMath } from "./read";
import { buildOfficeMath } from "./write";

// OMML -> MathML structural translation, plus the genuine write-then-read round trip that closes the odt -> docx -> odt formula regression: every assertion below is about the recovered MathML TREE (mfrac/msqrt/msubsup/mtable/...), not about a rendered result, exactly mirroring write.test.ts's own "the markup itself is the thing under test" stance.

// Hand-built OMML nodes, in ooxml.js's own XmlElement shape -- the same construction style write.test.ts uses for its MathML inputs, so no XML parsing is needed to build an input tree.
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

// --- Assertions over the recovered MathML tree ---

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

// A compact structural signature: every element's tag, nested, with a token element's own text inlined. Two formulas with the same signature carry the same construct types in the same arrangement with the same content -- exactly what "structurally equivalent" means for a formula, and stricter than comparing tags alone.
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

function localTag(tag: string): string {
  const colon = tag.indexOf(":");
  return colon === -1 ? tag : tag.slice(colon + 1);
}

describe("readOfficeMath: token runs", () => {
  it("recovers an unadorned math run as an italic-by-default mi, writing no redundant mathvariant", () => {
    const element = onlyElement(readOfficeMath(oMath([run("x")])).mathml);
    expect(element.tag).toBe("mi");
    expect(textOf(element)).toBe("x");
    expect(mathAttr(element, "mathvariant")).toBeUndefined();
  });

  it("recovers a run of digits as mn and a run of symbols as mo, the distinction OMML itself does not record", () => {
    expect(
      onlyElement(
        readOfficeMath(
          oMath([
            run("42", oel("m:rPr", {}, [oel("m:sty", { "m:val": "p" })])),
          ]),
        ).mathml,
      ).tag,
    ).toBe("mn");
    expect(
      onlyElement(
        readOfficeMath(
          oMath([run("+", oel("m:rPr", {}, [oel("m:sty", { "m:val": "p" })]))]),
        ).mathml,
      ).tag,
    ).toBe("mo");
  });

  it("recovers a multi-character upright run as an mi, which is already that mi's own intrinsic default", () => {
    const element = onlyElement(
      readOfficeMath(
        oMath([run("sin", oel("m:rPr", {}, [oel("m:sty", { "m:val": "p" })]))]),
      ).mathml,
    );
    expect(element.tag).toBe("mi");
    expect(mathAttr(element, "mathvariant")).toBeUndefined();
  });

  it('recovers m:nor as mtext, OMML\'s own "renders in the paragraph font" run kind', () => {
    const element = onlyElement(
      readOfficeMath(oMath([run("where", oel("m:rPr", {}, [oel("m:nor")]))]))
        .mathml,
    );
    expect(element.tag).toBe("mtext");
    expect(textOf(element)).toBe("where");
  });

  it("maps m:scr/m:sty back onto a real mathvariant whenever it differs from the token's own default", () => {
    const element = onlyElement(
      readOfficeMath(
        oMath([
          run(
            "R",
            oel("m:rPr", {}, [
              oel("m:scr", { "m:val": "double-struck" }),
              oel("m:sty", { "m:val": "p" }),
            ]),
          ),
        ]),
      ).mathml,
    );
    expect(mathAttr(element, "mathvariant")).toBe("double-struck");
  });

  it("reports an approximation for a script/style combination MathML's own enumeration cannot name", () => {
    const { mathml, diagnostics } = readOfficeMath(
      oMath([
        run(
          "R",
          oel("m:rPr", {}, [
            oel("m:scr", { "m:val": "double-struck" }),
            oel("m:sty", { "m:val": "i" }),
          ]),
        ),
      ]),
    );
    expect(diagnostics).toEqual([
      { kind: "approximated-element", detail: "r" },
    ]);
    // The content still arrives -- only the un-nameable styling is dropped.
    expect(textOf(onlyElement(mathml))).toBe("R");
  });

  it("decodes XML entities in a run's own text, the exact inverse of what write.ts encodes", () => {
    expect(
      textOf(onlyElement(readOfficeMath(oMath([run("a &lt; b")])).mathml)),
    ).toBe("a < b");
  });
});

describe("readOfficeMath: fractions and radicals", () => {
  it("recovers m:f as mfrac, with num and den in MathML's own order", () => {
    const element = onlyElement(
      readOfficeMath(
        oMath([
          oel("m:f", {}, [
            slot("m:num", [run("a")]),
            slot("m:den", [run("b")]),
          ]),
        ]),
      ).mathml,
    );
    expect(element.tag).toBe("mfrac");
    expect(signature([element])).toBe("mfrac(mi(a),mi(b))");
  });

  it('recovers a noBar fraction as MathML\'s own linethickness="0"', () => {
    const element = onlyElement(
      readOfficeMath(
        oMath([
          oel("m:f", {}, [
            oel("m:fPr", {}, [oel("m:type", { "m:val": "noBar" })]),
            slot("m:num", [run("n")]),
            slot("m:den", [run("k")]),
          ]),
        ]),
      ).mathml,
    );
    expect(mathAttr(element, "linethickness")).toBe("0");
  });

  it("recovers a degree-hidden m:rad as msqrt, taking the whole m:e slot as its implicit mrow", () => {
    const element = onlyElement(
      readOfficeMath(
        oMath([
          oel("m:rad", {}, [
            oel("m:radPr", {}, [oel("m:degHide", { "m:val": "1" })]),
            oel("m:deg"),
            slot("m:e", [run("x"), run("+"), run("1")]),
          ]),
        ]),
      ).mathml,
    );
    expect(element.tag).toBe("msqrt");
    expect(childTags(element)).toEqual(["mi", "mo", "mn"]);
  });

  it("recovers a real degree as mroot, swapping OMML's (degree, base) order back to MathML's (radicand, index)", () => {
    const element = onlyElement(
      readOfficeMath(
        oMath([
          oel("m:rad", {}, [
            slot("m:deg", [run("3")]),
            slot("m:e", [run("x")]),
          ]),
        ]),
      ).mathml,
    );
    expect(signature([element])).toBe("mroot(mi(x),mn(3))");
  });
});

describe("readOfficeMath: scripts, limits, and matrices", () => {
  it("recovers m:sSub/m:sSup/m:sSubSup as msub/msup/msubsup", () => {
    expect(
      onlyElement(
        readOfficeMath(
          oMath([
            oel("m:sSub", {}, [
              slot("m:e", [run("x")]),
              slot("m:sub", [run("1")]),
            ]),
          ]),
        ).mathml,
      ).tag,
    ).toBe("msub");
    expect(
      onlyElement(
        readOfficeMath(
          oMath([
            oel("m:sSup", {}, [
              slot("m:e", [run("x")]),
              slot("m:sup", [run("2")]),
            ]),
          ]),
        ).mathml,
      ).tag,
    ).toBe("msup");
    const both = onlyElement(
      readOfficeMath(
        oMath([
          oel("m:sSubSup", {}, [
            slot("m:e", [run("y")]),
            slot("m:sub", [run("1")]),
            slot("m:sup", [run("2")]),
          ]),
        ]),
      ).mathml,
    );
    expect(signature([both])).toBe("msubsup(mi(y),mn(1),mn(2))");
  });

  it("recovers m:limLow/m:limUpp as munder/mover", () => {
    expect(
      onlyElement(
        readOfficeMath(
          oMath([
            oel("m:limLow", {}, [
              slot("m:e", [run("x")]),
              slot("m:lim", [run("0")]),
            ]),
          ]),
        ).mathml,
      ).tag,
    ).toBe("munder");
    expect(
      onlyElement(
        readOfficeMath(
          oMath([
            oel("m:limUpp", {}, [
              slot("m:e", [run("x")]),
              slot("m:lim", [run("0")]),
            ]),
          ]),
        ).mathml,
      ).tag,
    ).toBe("mover");
  });

  it("recognises the nested m:limUpp-over-m:limLow composition write.ts emits for munderover, rather than reading it back as an mover wrapping a munder", () => {
    const nested = oel("m:limUpp", {}, [
      slot("m:e", [
        oel("m:limLow", {}, [
          slot("m:e", [run("S")]),
          slot("m:lim", [run("0")]),
        ]),
      ]),
      slot("m:lim", [run("n")]),
    ]);
    expect(
      signature([onlyElement(readOfficeMath(oMath([nested])).mathml)]),
    ).toBe("munderover(mi(S),mn(0),mi(n))");
  });

  it("recovers m:m as mtable/mtr/mtd, expanding m:mc column runs back into per-column columnalign only when it is not all-centre", () => {
    const cell = (text: string): XmlElement => slot("m:e", [run(text)]);
    const matrix = oel("m:m", {}, [
      oel("m:mPr", {}, [
        oel("m:mcs", {}, [
          oel("m:mc", {}, [
            oel("m:mcPr", {}, [
              oel("m:count", { "m:val": "1" }),
              oel("m:mcJc", { "m:val": "left" }),
            ]),
          ]),
          oel("m:mc", {}, [
            oel("m:mcPr", {}, [
              oel("m:count", { "m:val": "1" }),
              oel("m:mcJc", { "m:val": "right" }),
            ]),
          ]),
        ]),
      ]),
      oel("m:mr", {}, [cell("1"), cell("2")]),
      oel("m:mr", {}, [cell("3"), cell("4")]),
    ]);
    const element = onlyElement(readOfficeMath(oMath([matrix])).mathml);
    expect(mathAttr(element, "columnalign")).toBe("left right");
    expect(signature([element])).toBe(
      "mtable(mtr(mtd(mn(1)),mtd(mn(2))),mtr(mtd(mn(3)),mtd(mn(4))))",
    );
  });
});

describe("readOfficeMath: constructs Word authors that this package never writes", () => {
  it("recovers m:d as a real fenced mrow, minting the delimiter characters OMML records as properties", () => {
    const delimiter = oel("m:d", {}, [
      slot("m:e", [run("a"), run("+"), run("b")]),
    ]);
    expect(
      signature([onlyElement(readOfficeMath(oMath([delimiter])).mathml)]),
    ).toBe("mrow(mo((),mi(a),mo(+),mi(b),mo()))");
  });

  it("honours an explicitly empty m:begChr, Word's own way of writing an unpaired delimiter", () => {
    const delimiter = oel("m:d", {}, [
      oel("m:dPr", {}, [
        oel("m:begChr", { "m:val": "" }),
        oel("m:endChr", { "m:val": "}" }),
      ]),
      slot("m:e", [run("x")]),
    ]);
    expect(
      signature([onlyElement(readOfficeMath(oMath([delimiter])).mathml)]),
    ).toBe("mrow(mi(x),mo(}))");
  });

  it("separates a multi-argument m:d with its own m:sepChr", () => {
    const delimiter = oel("m:d", {}, [
      oel("m:dPr", {}, [oel("m:sepChr", { "m:val": "," })]),
      slot("m:e", [run("a")]),
      slot("m:e", [run("b")]),
    ]);
    expect(
      signature([onlyElement(readOfficeMath(oMath([delimiter])).mathml)]),
    ).toBe("mrow(mo((),mi(a),mo(,),mi(b),mo()))");
  });

  it("recovers an under/over m:nary as the limit-carrying operator plus its own operand, which is exactly the operand munderover cannot record", () => {
    const nary = oel("m:nary", {}, [
      oel("m:naryPr", {}, [
        oel("m:chr", { "m:val": "∑" }),
        oel("m:limLoc", { "m:val": "undOvr" }),
      ]),
      slot("m:sub", [run("i")]),
      slot("m:sup", [run("n")]),
      slot("m:e", [run("x")]),
    ]);
    expect(signature([onlyElement(readOfficeMath(oMath([nary])).mathml)])).toBe(
      "mrow(munderover(mo(∑),mi(i),mi(n)),mi(x))",
    );
  });

  it("places a subSup-located m:nary's limits as ordinary scripts, and honours m:supHide", () => {
    const nary = oel("m:nary", {}, [
      oel("m:naryPr", {}, [
        oel("m:chr", { "m:val": "∫" }),
        oel("m:supHide", { "m:val": "1" }),
      ]),
      slot("m:sub", [run("0")]),
      slot("m:e", [run("f")]),
    ]);
    expect(signature([onlyElement(readOfficeMath(oMath([nary])).mathml)])).toBe(
      "mrow(msub(mo(∫),mn(0)),mi(f))",
    );
  });

  it("recovers m:acc as an accented mover and m:bar as an over/underbar", () => {
    const accent = oel("m:acc", {}, [
      oel("m:accPr", {}, [oel("m:chr", { "m:val": "⃗" })]),
      slot("m:e", [run("v")]),
    ]);
    const accented = onlyElement(readOfficeMath(oMath([accent])).mathml);
    expect(accented.tag).toBe("mover");
    expect(mathAttr(accented, "accent")).toBe("true");
    expect(signature([accented])).toBe("mover(mi(v),mo(⃗))");

    const topBar = oel("m:bar", {}, [
      oel("m:barPr", {}, [oel("m:pos", { "m:val": "top" })]),
      slot("m:e", [run("z")]),
    ]);
    expect(onlyElement(readOfficeMath(oMath([topBar])).mathml).tag).toBe(
      "mover",
    );
    const bottomBar = oel("m:bar", {}, [slot("m:e", [run("z")])]);
    expect(onlyElement(readOfficeMath(oMath([bottomBar])).mathml).tag).toBe(
      "munder",
    );
  });

  it("recovers m:func as an mrow of the function name and its argument", () => {
    const func = oel("m:func", {}, [
      slot("m:fName", [run("sin")]),
      slot("m:e", [run("x")]),
    ]);
    expect(signature([onlyElement(readOfficeMath(oMath([func])).mathml)])).toBe(
      "mrow(mi(sin),mi(x))",
    );
  });

  it("recovers m:sPre as an mmultiscripts with a real mprescripts marker", () => {
    const pre = oel("m:sPre", {}, [
      slot("m:sub", [run("1")]),
      slot("m:sup", [run("2")]),
      slot("m:e", [run("X")]),
    ]);
    const element = onlyElement(readOfficeMath(oMath([pre])).mathml);
    expect(childTags(element)).toEqual(["mi", "mprescripts", "mn", "mn"]);
  });
});

describe("readOfficeMath: degradation", () => {
  it("flattens an unrecognised container to an mrow of its own argument slots, keeping the mathematics and reporting the loss", () => {
    const boxed = oel("m:borderBox", {}, [
      oel("m:borderBoxPr", {}, [oel("m:hideTop", { "m:val": "1" })]),
      slot("m:e", [run("a"), run("+"), run("b")]),
    ]);
    const { mathml, diagnostics } = readOfficeMath(oMath([boxed]));
    expect(diagnostics).toEqual([
      { kind: "approximated-element", detail: "borderBox" },
    ]);
    expect(signature(mathml)).toBe("mrow(mi(a),mo(+),mi(b))");
  });

  it("degrades an unrecognised element with no argument slots to an mtext of its own text content", () => {
    const { mathml, diagnostics } = readOfficeMath(
      oMath([oel("m:mysteryConstruct", {}, [{ type: "text", value: "zz" }])]),
    );
    expect(diagnostics).toEqual([
      { kind: "unsupported-element", detail: "mysteryConstruct" },
    ]);
    expect(signature(mathml)).toBe("mtext(zz)");
  });

  it("keeps translating the rest of an equation after one construct degrades", () => {
    const { mathml, diagnostics } = readOfficeMath(
      oMath([
        oel("m:f", {}, [slot("m:num", [run("a")]), slot("m:den", [run("b")])]),
        oel("m:mysteryConstruct", {}, [{ type: "text", value: "q" }]),
      ]),
    );
    expect(diagnostics).toHaveLength(1);
    expect(signature(mathml)).toBe("mfrac(mi(a),mi(b)),mtext(q)");
  });

  it("produces an empty argument for a missing slot rather than throwing on a malformed tree", () => {
    expect(
      signature(
        readOfficeMath(oMath([oel("m:f", {}, [slot("m:num", [run("a")])])]))
          .mathml,
      ),
    ).toBe("mfrac(mi(a),mrow())");
  });
});

describe("collectOfficeMathElements", () => {
  it("finds an equation wrapped in a display m:oMathPara, and one sitting directly in the paragraph", () => {
    const paragraph = oel("w:p", {}, [
      oel("m:oMathPara", {}, [oMath([run("a")])]),
      oel("m:oMath", {}, [run("b")]),
    ]);
    expect(collectOfficeMathElements(paragraph.children)).toHaveLength(2);
  });

  it("finds an equation nested inside a run container, and never descends into one it already found", () => {
    const paragraph = oel("w:p", {}, [
      oel("w:hyperlink", {}, [
        oMath([
          oel("m:f", {}, [
            slot("m:num", [run("a")]),
            slot("m:den", [run("b")]),
          ]),
        ]),
      ]),
    ]);
    const found = collectOfficeMathElements(paragraph.children);
    expect(found).toHaveLength(1);
    expect(found[0]?.tag).toBe("m:oMath");
  });

  it("finds nothing in a paragraph carrying only ordinary runs", () => {
    expect(
      collectOfficeMathElements(
        oel("w:p", {}, [
          oel("w:r", {}, [oel("w:t", {}, [{ type: "text", value: "plain" }])]),
        ]).children,
      ),
    ).toEqual([]);
  });
});

// --- The round trip: MathML -> OMML -> MathML, through the two real translators rather than a hand-written expectation ---

function roundTrip(mathml: readonly MathMlNode[]): MathMlNode[] {
  const { element } = buildOfficeMath(mathml);
  if (element === undefined) {
    throw new Error("expected buildOfficeMath to produce an m:oMath element");
  }
  return readOfficeMath(element).mathml;
}

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

function mtoken(
  tag: string,
  text: string,
  attrs: Record<string, string> = {},
): MathMlElement {
  return mel(tag, attrs, [{ type: "text", value: text }]);
}

describe("MathML -> OMML -> MathML round trip", () => {
  // Each case is checked against the SOURCE tree's own signature, not against a hand-written expected string, so the assertion is genuinely "what came back is what went in" rather than "what came back is what I predicted".
  const cases: readonly (readonly [string, MathMlElement])[] = [
    [
      "a simple fraction",
      mel("mfrac", {}, [mtoken("mi", "a"), mtoken("mi", "b")]),
    ],
    ["a square root", mel("msqrt", {}, [mtoken("mi", "x")])],
    ["a cube root", mel("mroot", {}, [mtoken("mi", "x"), mtoken("mn", "3")])],
    ["a subscript", mel("msub", {}, [mtoken("mi", "x"), mtoken("mn", "1")])],
    ["a superscript", mel("msup", {}, [mtoken("mi", "x"), mtoken("mn", "2")])],
    [
      "a sub-and-superscript",
      mel("msubsup", {}, [
        mtoken("mi", "y"),
        mtoken("mn", "1"),
        mtoken("mn", "2"),
      ]),
    ],
    [
      "an under-script",
      mel("munder", {}, [mtoken("mi", "S"), mtoken("mn", "0")]),
    ],
    [
      "an over-script",
      mel("mover", {}, [mtoken("mi", "S"), mtoken("mi", "n")]),
    ],
    [
      "an under-and-over-script",
      mel("munderover", {}, [
        mtoken("mi", "S"),
        mtoken("mn", "0"),
        mtoken("mi", "n"),
      ]),
    ],
    [
      "a barless fraction",
      mel("mfrac", { linethickness: "0" }, [
        mtoken("mn", "5"),
        mtoken("mn", "2"),
      ]),
    ],
    [
      "a matrix",
      mel("mtable", {}, [
        mel("mtr", {}, [
          mel("mtd", {}, [mtoken("mn", "1")]),
          mel("mtd", {}, [mtoken("mn", "2")]),
        ]),
        mel("mtr", {}, [
          mel("mtd", {}, [mtoken("mn", "3")]),
          mel("mtd", {}, [mtoken("mn", "4")]),
        ]),
      ]),
    ],
    [
      "a styled identifier",
      mtoken("mi", "R", { mathvariant: "double-struck" }),
    ],
    ["literal text inside a formula", mtoken("mtext", "where")],
    [
      "a nested fraction over a root",
      mel("mfrac", {}, [
        mel("msqrt", {}, [mtoken("mi", "x")]),
        mel("mrow", {}, [
          mtoken("mi", "a"),
          mtoken("mo", "+"),
          mtoken("mn", "1"),
        ]),
      ]),
    ],
  ];

  for (const [name, source] of cases) {
    it(`recovers ${name} with the same construct types and the same content`, () => {
      expect(signature(roundTrip([source]))).toBe(signature([source]));
    });
  }

  // signature() compares construct types and content, which is what "structurally equivalent" means for a formula -- these two cover the only attributes either translator actually carries, so an attribute silently lost in the middle still fails a test.
  it("preserves a token's own mathvariant, the styling OMML genuinely records", () => {
    expect(
      mathAttr(
        onlyElement(
          roundTrip([mtoken("mi", "R", { mathvariant: "double-struck" })]),
        ),
        "mathvariant",
      ),
    ).toBe("double-struck");
  });

  it("preserves a barless fraction's own linethickness", () => {
    expect(
      mathAttr(
        onlyElement(
          roundTrip([
            mel("mfrac", { linethickness: "0" }, [
              mtoken("mn", "5"),
              mtoken("mn", "2"),
            ]),
          ]),
        ),
        "linethickness",
      ),
    ).toBe("0");
  });

  it("recovers a whole multi-construct expression unchanged, reporting no diagnostics in either direction", () => {
    // x + sqrt(a/b) ^ 2, exercising a row, three token kinds, a fraction, a radical, and a superscript in one tree.
    const source: MathMlNode[] = [
      mtoken("mi", "x"),
      mtoken("mo", "+"),
      mel("msup", {}, [
        mel("msqrt", {}, [
          mel("mfrac", {}, [mtoken("mi", "a"), mtoken("mi", "b")]),
        ]),
        mtoken("mn", "2"),
      ]),
    ];
    const { element, diagnostics: writeDiagnostics } = buildOfficeMath(source);
    if (element === undefined) {
      throw new Error("expected buildOfficeMath to produce an m:oMath element");
    }
    const { mathml, diagnostics: readDiagnostics } = readOfficeMath(element);
    expect(writeDiagnostics).toEqual([]);
    expect(readDiagnostics).toEqual([]);
    expect(signature(mathml)).toBe(signature(source));
  });

  it('recovers a "math:"-prefixed source tree unprefixed, since the prefix is a document binding rather than part of the name', () => {
    const source = mel("math:mfrac", {}, [
      mtoken("math:mi", "a"),
      mtoken("math:mi", "b"),
    ]);
    expect(signature(roundTrip([source]))).toBe("mfrac(mi(a),mi(b))");
  });
});
