import type { XmlElement } from "ooxml.js";
import { attr, textContent } from "ooxml.js";
import type { MathMlNode } from "../../mathml/nodes";
import { describe, expect, it } from "vitest";
import { el } from "../../xml/fragment";
import {
  buildDrawingParagraph,
  buildPictureShape,
  buildTextBoxShape,
  PptxShape,
} from "./shape";
function tagsOf(node: XmlElement): (string | undefined)[] {
  return node.children.map((c) => (c.type === "element" ? c.tag : undefined));
}

function childOf(
  node: XmlElement | undefined,
  tag: string,
): XmlElement | undefined {
  return node?.children.find(
    (c): c is XmlElement => c.type === "element" && c.tag === tag,
  );
}

function attrOf(
  element: XmlElement | undefined,
  name: string,
): string | undefined {
  return element === undefined ? undefined : attr(element, name);
}

function bareShape(): { shape: PptxShape; shapeElement: XmlElement } {
  const shapeElement = el("p:sp");
  return { shape: new PptxShape([shapeElement], shapeElement), shapeElement };
}

function textBoxShape(): { shape: PptxShape; shapeElement: XmlElement } {
  const shapeElement = buildTextBoxShape(
    { xPt: 1, yPt: 2, widthPt: 30, heightPt: 40 },
    "Hi",
    5,
  );
  return { shape: new PptxShape([shapeElement], shapeElement), shapeElement };
}

function mathmlOf(...tokens: string[]): MathMlNode[] {
  return tokens.map((token) => ({
    type: "element" as const,
    tag: token === "+" ? "mo" : "mi",
    attributes: [],
    children: [{ type: "text" as const, value: token }],
  }));
}

describe("PptxShape text-body minting", () => {
  it("an inset set on a txBody with no a:bodyPr unshifts it ahead of the paragraph", () => {
    const shapeElement = el("p:sp", {}, [
      el("p:txBody", {}, [el("a:p", {}, [el("a:r")])]),
    ]);
    const shape = new PptxShape([shapeElement], shapeElement);
    shape.insetLeftPt = 1;
    const txBody = childOf(shapeElement, "p:txBody");
    expect(tagsOf(txBody ?? el("x"))).toEqual(["a:bodyPr", "a:p"]);
    expect(attrOf(childOf(txBody, "a:bodyPr"), "lIns")).toBe("12700");
  });

  it("setParagraphs on a bare shape mints the full text body around the paragraphs", () => {
    const { shape, shapeElement } = bareShape();
    shape.setParagraphs([{ runs: [{ text: "a" }, { text: "b" }] }]);
    expect(
      shapeElement.children.map((c) =>
        c.type === "element" ? c.tag : undefined,
      ),
    ).toEqual(["p:txBody"]);
    const txBody = childOf(shapeElement, "p:txBody");
    expect(tagsOf(txBody ?? el("x"))).toEqual([
      "a:bodyPr",
      "a:lstStyle",
      "a:p",
    ]);
    const paragraph = childOf(txBody, "a:p");
    expect(tagsOf(paragraph ?? el("x"))).toEqual(["a:r", "a:r"]);
    expect(shape.text).toBe("ab");
  });

  it("appendOfficeMath on a bare shape mints the full text body around the equation", () => {
    const { shape, shapeElement } = bareShape();
    const result = shape.appendOfficeMath(mathmlOf("x"));
    expect(result.written).toBe(true);
    expect(
      shapeElement.children.map((c) =>
        c.type === "element" ? c.tag : undefined,
      ),
    ).toEqual(["p:txBody"]);
    const txBody = childOf(shapeElement, "p:txBody");
    expect(tagsOf(txBody ?? el("x"))).toEqual([
      "a:bodyPr",
      "a:lstStyle",
      "a:p",
    ]);
    expect(tagsOf(childOf(txBody, "a:p") ?? el("x"))).toEqual(["m:oMathPara"]);
  });
});

describe("PptxShape.text structure", () => {
  it("writes one a:p holding one a:r whose single child is the a:t", () => {
    const { shape, shapeElement } = textBoxShape();
    shape.text = "Inner";
    const paragraph = childOf(childOf(shapeElement, "p:txBody"), "a:p");
    expect(tagsOf(paragraph ?? el("x"))).toEqual(["a:r"]);
    const run = childOf(paragraph, "a:r");
    expect(tagsOf(run ?? el("x"))).toEqual(["a:t"]);
    expect(
      run?.children[0]?.type === "element" &&
        run.children[0].children[0]?.type === "text"
        ? run.children[0].children[0].value
        : undefined,
    ).toBe("Inner");
  });
});

describe("PptxShape minting purity and reuse", () => {
  it("reading frame on a bare shape mints nothing", () => {
    const { shape, shapeElement } = bareShape();
    expect(shape.frame).toBeUndefined();
    expect(shapeElement.children).toHaveLength(0);
  });

  it("setting frame twice leaves exactly one a:xfrm under the spPr", () => {
    const { shape, shapeElement } = textBoxShape();
    shape.frame = { xPt: 10, yPt: 10, widthPt: 10, heightPt: 10 };
    shape.frame = { xPt: 20, yPt: 20, widthPt: 20, heightPt: 20 };
    const spPr = childOf(shapeElement, "p:spPr");
    const xfrms =
      spPr?.children.filter(
        (c): c is XmlElement => c.type === "element" && c.tag === "a:xfrm",
      ) ?? [];
    expect(xfrms).toHaveLength(1);
  });

  it("setting rotation twice on a bare shape leaves exactly one a:xfrm", () => {
    const { shape, shapeElement } = bareShape();
    shape.rotationDeg = 12.5;
    shape.rotationDeg = 25;
    const spPr = childOf(shapeElement, "p:spPr");
    const xfrms =
      spPr?.children.filter(
        (c): c is XmlElement => c.type === "element" && c.tag === "a:xfrm",
      ) ?? [];
    expect(xfrms).toHaveLength(1);
    expect(attrOf(xfrms[0], "rot")).toBe("1500000");
  });
});

describe("buildPictureShape geometry detail", () => {
  it("carries an empty a:avLst under the rect preset geometry", () => {
    const shapeElement = buildPictureShape(
      { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      "rId1",
      1,
    );
    const prstGeom = childOf(childOf(shapeElement, "p:spPr"), "a:prstGeom");
    expect(tagsOf(prstGeom ?? el("x"))).toEqual(["a:avLst"]);
  });
});

describe("PptxShape.text structure", () => {
  it("setting text preserves the bodyPr and lstStyle, replacing only the a:p children", () => {
    const { shape, shapeElement } = textBoxShape();
    shape.text = "Second";
    const txBody = childOf(shapeElement, "p:txBody");
    expect(tagsOf(txBody ?? el("x"))).toEqual([
      "a:bodyPr",
      "a:lstStyle",
      "a:p",
    ]);
    expect(attrOf(childOf(txBody, "a:bodyPr"), "wrap")).toBe("square");
  });

  it("setting text on a bare shape mints the full text body", () => {
    const { shape, shapeElement } = bareShape();
    shape.text = "Fresh";
    expect(
      shapeElement.children.map((c) =>
        c.type === "element" ? c.tag : undefined,
      ),
    ).toEqual(["p:txBody"]);
    const txBody = childOf(shapeElement, "p:txBody");
    expect(tagsOf(txBody ?? el("x"))).toEqual([
      "a:bodyPr",
      "a:lstStyle",
      "a:p",
    ]);
    expect(shape.text).toBe("Fresh");
  });

  it("a shape with no text body reads as the empty string", () => {
    const { shape } = bareShape();
    expect(shape.text).toBe("");
  });

  it("round-trips XML-special text", () => {
    const { shape } = textBoxShape();
    shape.text = 'a & <b> "q"';
    expect(shape.text).toBe('a & <b> "q"');
  });
});

describe("PptxShape.setParagraphs geometry properties", () => {
  it("writes marL and indent in EMU", () => {
    const { shape, shapeElement } = textBoxShape();
    shape.setParagraphs([
      { runs: [{ text: "x" }], indentLeftPt: 12, indentFirstLinePt: -6 },
    ]);
    const pPr = childOf(
      childOf(childOf(shapeElement, "p:txBody"), "a:p"),
      "a:pPr",
    );
    expect(attrOf(pPr, "marL")).toBe(String(12 * 12700));
    expect(attrOf(pPr, "indent")).toBe(String(-6 * 12700));
  });

  it("emits lnSpc, spcBef and spcAft in CT sequence with their exact units", () => {
    const { shape, shapeElement } = textBoxShape();
    shape.setParagraphs([
      {
        runs: [{ text: "x" }],
        lineSpacing: 1.5,
        spacingBeforePt: 6,
        spacingAfterPt: 12.25,
      },
    ]);
    const pPr = childOf(
      childOf(childOf(shapeElement, "p:txBody"), "a:p"),
      "a:pPr",
    );
    expect(tagsOf(pPr ?? el("x"))).toEqual(["a:lnSpc", "a:spcBef", "a:spcAft"]);
    expect(attrOf(childOf(childOf(pPr, "a:lnSpc"), "a:spcPct"), "val")).toBe(
      "150000",
    );
    expect(attrOf(childOf(childOf(pPr, "a:spcBef"), "a:spcPts"), "val")).toBe(
      "600",
    );
    expect(attrOf(childOf(childOf(pPr, "a:spcAft"), "a:spcPts"), "val")).toBe(
      "1225",
    );
  });

  it("writes the single underline and single strike spellings", () => {
    const paragraph = buildDrawingParagraph({
      runs: [{ text: "u", underline: true, strike: true }],
    });
    const rPr = childOf(childOf(paragraph, "a:r"), "a:rPr");
    expect(attrOf(rPr, "u")).toBe("sng");
    expect(attrOf(rPr, "strike")).toBe("sngStrike");
  });

  it("writes a hyperlink click with its relationship id, a latin typeface, and a solid fill in hex", () => {
    const paragraph = buildDrawingParagraph({
      runs: [
        {
          text: "link",
          hyperlinkRId: "rId4",
          fontFamily: "Calibri",
          color: { r: 0.5, g: 0.25, b: 0 },
        },
      ],
    });
    const rPr = childOf(childOf(paragraph, "a:r"), "a:rPr");
    expect(tagsOf(rPr ?? el("x"))).toEqual([
      "a:solidFill",
      "a:latin",
      "a:hlinkClick",
    ]);
    expect(
      attrOf(childOf(childOf(rPr, "a:solidFill"), "a:srgbClr"), "val"),
    ).toBe("804000");
    expect(attrOf(childOf(rPr, "a:latin"), "typeface")).toBe("Calibri");
    expect(attrOf(childOf(rPr, "a:hlinkClick"), "r:id")).toBe("rId4");
  });

  it("preserves leading and trailing spaces through xml:space, and omits it otherwise", () => {
    const spaced = buildDrawingParagraph({ runs: [{ text: " padded " }] });
    const plain = buildDrawingParagraph({ runs: [{ text: "plain" }] });
    expect(attrOf(childOf(childOf(spaced, "a:r"), "a:t"), "xml:space")).toBe(
      "preserve",
    );
    expect(
      attrOf(childOf(childOf(plain, "a:r"), "a:t"), "xml:space"),
    ).toBeUndefined();
  });

  it("round-trips XML-special run text", () => {
    const paragraph = buildDrawingParagraph({ runs: [{ text: "a & <b>" }] });
    const run = childOf(paragraph, "a:r");
    if (run === undefined) {
      throw new Error("expected an a:r child");
    }
    expect(textContent(run)).toBe("a & <b>");
  });
});

describe("PptxShape.appendOfficeMath", () => {
  it("replaces the text body's paragraphs with one carrying the equation", () => {
    const { shape, shapeElement } = textBoxShape();
    const result = shape.appendOfficeMath(mathmlOf("x", "+", "1"));
    expect(result.written).toBe(true);
    const txBody = childOf(shapeElement, "p:txBody");
    expect(tagsOf(txBody ?? el("x"))).toEqual([
      "a:bodyPr",
      "a:lstStyle",
      "a:p",
    ]);
    const paragraph = childOf(txBody, "a:p");
    expect(tagsOf(paragraph ?? el("x"))).toEqual(["m:oMathPara"]);
  });

  it("an empty formula writes nothing and reports written false, minting no text body", () => {
    const { shape, shapeElement } = bareShape();
    const result = shape.appendOfficeMath([]);
    expect(result.written).toBe(false);
    expect(result.element).toBeUndefined();
    expect(shapeElement.children).toHaveLength(0);
  });
});

describe("buildTextBoxShape structure", () => {
  it("emits the full p:sp skeleton with the shape id and name", () => {
    const shapeElement = buildTextBoxShape(
      { xPt: 10, yPt: 20, widthPt: 100, heightPt: 50 },
      "Body",
      7,
    );
    expect(shapeElement.tag).toBe("p:sp");
    expect(tagsOf(shapeElement)).toEqual(["p:nvSpPr", "p:spPr", "p:txBody"]);
    const nvSpPr = childOf(shapeElement, "p:nvSpPr");
    expect(tagsOf(nvSpPr ?? el("x"))).toEqual([
      "p:cNvPr",
      "p:cNvSpPr",
      "p:nvPr",
    ]);
    expect(attrOf(childOf(nvSpPr, "p:cNvPr"), "id")).toBe("7");
    expect(attrOf(childOf(nvSpPr, "p:cNvPr"), "name")).toBe("TextBox 7");
    expect(attrOf(childOf(nvSpPr, "p:cNvSpPr"), "txBox")).toBe("1");
    const spPr = childOf(shapeElement, "p:spPr");
    expect(tagsOf(spPr ?? el("x"))).toEqual(["a:xfrm", "a:prstGeom"]);
    expect(attrOf(childOf(spPr, "a:prstGeom"), "prst")).toBe("rect");
    expect(tagsOf(childOf(spPr, "a:prstGeom") ?? el("x"))).toEqual(["a:avLst"]);
    expect(tagsOf(childOf(spPr, "a:xfrm") ?? el("x"))).toEqual([
      "a:off",
      "a:ext",
    ]);
    const txBody = childOf(shapeElement, "p:txBody");
    expect(tagsOf(txBody ?? el("x"))).toEqual([
      "a:bodyPr",
      "a:lstStyle",
      "a:p",
    ]);
    expect(attrOf(childOf(txBody, "a:bodyPr"), "wrap")).toBe("square");
  });
});

describe("buildPictureShape structure", () => {
  it("emits the full p:pic skeleton with the relationship and picture name", () => {
    const shapeElement = buildPictureShape(
      { xPt: 5, yPt: 6, widthPt: 70, heightPt: 80 },
      "rId5",
      3,
    );
    expect(shapeElement.tag).toBe("p:pic");
    expect(tagsOf(shapeElement)).toEqual(["p:nvPicPr", "p:blipFill", "p:spPr"]);
    const nvPicPr = childOf(shapeElement, "p:nvPicPr");
    expect(tagsOf(nvPicPr ?? el("x"))).toEqual([
      "p:cNvPr",
      "p:cNvPicPr",
      "p:nvPr",
    ]);
    expect(attrOf(childOf(nvPicPr, "p:cNvPr"), "id")).toBe("3");
    expect(attrOf(childOf(nvPicPr, "p:cNvPr"), "name")).toBe("Picture 3");
    const blipFill = childOf(shapeElement, "p:blipFill");
    expect(tagsOf(blipFill ?? el("x"))).toEqual(["a:blip", "a:stretch"]);
    expect(attrOf(childOf(blipFill, "a:blip"), "r:embed")).toBe("rId5");
    expect(tagsOf(childOf(blipFill, "a:stretch") ?? el("x"))).toEqual([
      "a:fillRect",
    ]);
    const spPr = childOf(shapeElement, "p:spPr");
    expect(tagsOf(spPr ?? el("x"))).toEqual(["a:xfrm", "a:prstGeom"]);
    expect(attrOf(childOf(spPr, "a:prstGeom"), "prst")).toBe("rect");
  });
});
