import type { XmlElement, XmlNode } from "ooxml.js";
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

describe("buildTextBoxShape / PptxShape frame and text", () => {
  it("round-trips frame in points, converting through EMU", () => {
    const frame = { xPt: 72, yPt: 36, widthPt: 200, heightPt: 100 };
    const shapeElement = buildTextBoxShape(frame, "Hello", 2);
    const shape = new PptxShape([shapeElement], shapeElement);
    expect(shape.frame).toEqual(frame);
  });

  it("round-trips text", () => {
    const shapeElement = buildTextBoxShape(
      { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      "Hello world",
      2,
    );
    const shape = new PptxShape([shapeElement], shapeElement);
    expect(shape.text).toBe("Hello world");
  });

  it("setting text replaces the previous paragraph rather than appending another", () => {
    const shapeElement = buildTextBoxShape(
      { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      "First",
      2,
    );
    const shape = new PptxShape([shapeElement], shapeElement);
    shape.text = "Second";
    expect(shape.text).toBe("Second");
  });

  it("setting frame updates the underlying a:off/a:ext in place", () => {
    const shapeElement = buildTextBoxShape(
      { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      "Hi",
      2,
    );
    const shape = new PptxShape([shapeElement], shapeElement);
    const newFrame = { xPt: 50, yPt: 60, widthPt: 300, heightPt: 150 };
    shape.frame = newFrame;
    expect(shape.frame).toEqual(newFrame);
  });

  it("rotationDeg is undefined with no a:xfrm/@rot attribute", () => {
    const shapeElement = buildTextBoxShape(
      { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      "Hi",
      2,
    );
    const shape = new PptxShape([shapeElement], shapeElement);
    expect(shape.rotationDeg).toBeUndefined();
  });

  it("setting rotationDeg writes a:xfrm/@rot in 60,000ths of a degree, and reads it back exactly", () => {
    const shapeElement = buildTextBoxShape(
      { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      "Hi",
      2,
    );
    const shape = new PptxShape([shapeElement], shapeElement);
    shape.rotationDeg = 45;
    expect(shape.rotationDeg).toBe(45);
    const spPr = shapeElement.children.find(
      (c) => c.type === "element" && c.tag === "p:spPr",
    );
    const xfrm =
      spPr?.type === "element"
        ? spPr.children.find((c) => c.type === "element" && c.tag === "a:xfrm")
        : undefined;
    expect(
      xfrm?.type === "element" ? xfrm.attributes : undefined,
    ).toContainEqual({ name: "rot", value: "2700000" });
  });

  it("setting rotationDeg to undefined removes a:xfrm/@rot without disturbing frame", () => {
    const shapeElement = buildTextBoxShape(
      { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      "Hi",
      2,
    );
    const shape = new PptxShape([shapeElement], shapeElement);
    const frame = { xPt: 50, yPt: 60, widthPt: 300, heightPt: 150 };
    shape.frame = frame;
    shape.rotationDeg = 90;
    shape.rotationDeg = undefined;
    expect(shape.rotationDeg).toBeUndefined();
    expect(shape.frame).toEqual(frame);
  });

  it("remove() removes the shape and throws on further use", () => {
    const shapeElement = buildTextBoxShape(
      { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      "Hi",
      2,
    );
    const container: XmlNode[] = [shapeElement];
    const shape = new PptxShape(container, shapeElement);
    shape.remove();
    expect(container).toHaveLength(0);
    expect(() => shape.text).toThrow(/removed/);
  });
});

function txBodyOf(shapeElement: ReturnType<typeof buildTextBoxShape>): {
  paragraphs: XmlNode[];
} {
  const txBody = shapeElement.children.find(
    (c) => c.type === "element" && c.tag === "p:txBody",
  );
  if (txBody?.type !== "element") {
    throw new Error("expected a p:txBody child");
  }
  return {
    paragraphs: txBody.children.filter(
      (c) => c.type === "element" && c.tag === "a:p",
    ),
  };
}

function elementChild(
  node: XmlNode,
  tag: string,
): Extract<XmlNode, { type: "element" }> | undefined {
  if (node.type !== "element") {
    return undefined;
  }
  const found = node.children.find(
    (c) => c.type === "element" && c.tag === tag,
  );
  return found?.type === "element" ? found : undefined;
}

describe("PptxShape.setParagraphs", () => {
  it("replaces the previous single-run text with multiple styled paragraphs", () => {
    const shapeElement = buildTextBoxShape(
      { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      "Old",
      2,
    );
    const shape = new PptxShape([shapeElement], shapeElement);
    shape.setParagraphs([
      { runs: [{ text: "First" }] },
      { runs: [{ text: "Second" }] },
    ]);
    const { paragraphs } = txBodyOf(shapeElement);
    expect(paragraphs).toHaveLength(2);
  });

  it("sets bold/italic/size/colour/font as a:rPr attributes and children", () => {
    const shapeElement = buildTextBoxShape(
      { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      "Old",
      2,
    );
    const shape = new PptxShape([shapeElement], shapeElement);
    shape.setParagraphs([
      {
        runs: [
          {
            text: "Styled",
            bold: true,
            italic: true,
            sizePt: 18,
            fontFamily: "Georgia",
            color: { r: 1, g: 0, b: 0 },
          },
        ],
      },
    ]);
    const { paragraphs } = txBodyOf(shapeElement);
    const run = elementChild(paragraphs[0]!, "a:r");
    const rPr = run !== undefined ? elementChild(run, "a:rPr") : undefined;
    if (rPr === undefined) {
      throw new Error("expected a:rPr");
    }
    expect(rPr.attributes).toContainEqual({ name: "b", value: "1" });
    expect(rPr.attributes).toContainEqual({ name: "i", value: "1" });
    expect(rPr.attributes).toContainEqual({ name: "sz", value: "1800" });
    const solidFill = elementChild(rPr, "a:solidFill");
    const srgbClr =
      solidFill !== undefined
        ? elementChild(solidFill, "a:srgbClr")
        : undefined;
    expect(srgbClr?.attributes).toContainEqual({
      name: "val",
      value: "FF0000",
    });
    const latin = elementChild(rPr, "a:latin");
    expect(latin?.attributes).toContainEqual({
      name: "typeface",
      value: "Georgia",
    });
  });

  it("sets paragraph alignment as a:pPr/@algn", () => {
    const shapeElement = buildTextBoxShape(
      { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      "Old",
      2,
    );
    const shape = new PptxShape([shapeElement], shapeElement);
    shape.setParagraphs([
      { runs: [{ text: "Centered" }], alignment: "center" },
    ]);
    const { paragraphs } = txBodyOf(shapeElement);
    const pPr = elementChild(paragraphs[0]!, "a:pPr");
    expect(pPr?.attributes).toContainEqual({ name: "algn", value: "ctr" });
  });

  it("emits a:endParaRPr for an empty paragraph rather than omitting it", () => {
    const shapeElement = buildTextBoxShape(
      { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      "Old",
      2,
    );
    const shape = new PptxShape([shapeElement], shapeElement);
    shape.setParagraphs([{ runs: [] }]);
    const { paragraphs } = txBodyOf(shapeElement);
    expect(paragraphs).toHaveLength(1);
    expect(elementChild(paragraphs[0]!, "a:endParaRPr")).toBeDefined();
  });

  it("omits a:rPr entirely for a plain, unstyled run", () => {
    const shapeElement = buildTextBoxShape(
      { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      "Old",
      2,
    );
    const shape = new PptxShape([shapeElement], shapeElement);
    shape.setParagraphs([{ runs: [{ text: "Plain" }] }]);
    const { paragraphs } = txBodyOf(shapeElement);
    const run = elementChild(paragraphs[0]!, "a:r");
    expect(
      run !== undefined ? elementChild(run, "a:rPr") : undefined,
    ).toBeUndefined();
  });
});

describe("buildPictureShape", () => {
  it("embeds the relationship id and frame", () => {
    const frame = { xPt: 10, yPt: 20, widthPt: 30, heightPt: 40 };
    const shapeElement = buildPictureShape(frame, "rId5", 3);
    const shape = new PptxShape([shapeElement], shapeElement);
    expect(shape.frame).toEqual(frame);
    const blipFill = shapeElement.children.find(
      (c) => c.type === "element" && c.tag === "p:blipFill",
    );
    if (blipFill?.type !== "element") {
      throw new Error("expected p:blipFill");
    }
    const blip = blipFill.children.find(
      (c) => c.type === "element" && c.tag === "a:blip",
    );
    expect(
      blip?.type === "element" ? blip.attributes : undefined,
    ).toContainEqual({ name: "r:embed", value: "rId5" });
  });

  it("writes altText as p:cNvPr/@descr", () => {
    const frame = { xPt: 10, yPt: 20, widthPt: 30, heightPt: 40 };
    const shapeElement = buildPictureShape(frame, "rId5", 3, "A description");
    const nvPicPr = shapeElement.children.find(
      (c) => c.type === "element" && c.tag === "p:nvPicPr",
    );
    const cNvPr =
      nvPicPr?.type === "element"
        ? nvPicPr.children.find(
            (c) => c.type === "element" && c.tag === "p:cNvPr",
          )
        : undefined;
    expect(
      cNvPr?.type === "element" ? cNvPr.attributes : undefined,
    ).toContainEqual({
      name: "descr",
      value: "A description",
    });
  });

  it("omits p:cNvPr/@descr when altText is undefined", () => {
    const frame = { xPt: 10, yPt: 20, widthPt: 30, heightPt: 40 };
    const shapeElement = buildPictureShape(frame, "rId5", 3);
    const nvPicPr = shapeElement.children.find(
      (c) => c.type === "element" && c.tag === "p:nvPicPr",
    );
    const cNvPr =
      nvPicPr?.type === "element"
        ? nvPicPr.children.find(
            (c) => c.type === "element" && c.tag === "p:cNvPr",
          )
        : undefined;
    expect(
      cNvPr?.type === "element"
        ? cNvPr.attributes.some((a) => a.name === "descr")
        : undefined,
    ).toBe(false);
  });
});

describe("PptxShape.name", () => {
  it("reads and writes p:cNvPr/@name, clearing by attribute removal", () => {
    const { shape, shapeElement } = textBoxShape();
    expect(shape.name).toBe("TextBox 5");
    shape.name = "Renamed";
    const cNvPr = childOf(childOf(shapeElement, "p:nvSpPr"), "p:cNvPr");
    expect(attrOf(cNvPr, "name")).toBe("Renamed");
    shape.name = undefined;
    expect(attrOf(cNvPr, "name")).toBeUndefined();
    expect(shape.name).toBeUndefined();
  });

  it("reads the name of a p:pic through p:nvPicPr, and writes it there", () => {
    const shapeElement = buildPictureShape(
      { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      "rId9",
      4,
    );
    const shape = new PptxShape([shapeElement], shapeElement);
    expect(shape.name).toBe("Picture 4");
    shape.name = "Logo";
    const cNvPr = childOf(childOf(shapeElement, "p:nvPicPr"), "p:cNvPr");
    expect(attrOf(cNvPr, "name")).toBe("Logo");
  });

  it("a shape with no non-visual properties reports no name and mints nothing on read", () => {
    const { shape, shapeElement } = bareShape();
    expect(shape.name).toBeUndefined();
    expect(shapeElement.children).toHaveLength(0);
    shape.name = "Minted";
    expect(
      shapeElement.children.map((c) =>
        c.type === "element" ? c.tag : undefined,
      ),
    ).toEqual(["p:nvSpPr"]);
    const nvSpPr = childOf(shapeElement, "p:nvSpPr");
    expect(tagsOf(nvSpPr ?? el("x"))).toEqual(["p:cNvPr"]);
    expect(attrOf(childOf(nvSpPr, "p:cNvPr"), "name")).toBe("Minted");
    expect(attrOf(childOf(nvSpPr, "p:cNvPr"), "id")).toBe("0");
  });
});

describe("PptxShape text-body insets", () => {
  it("all four insets read undefined on a bodyPr that carries none, without minting", () => {
    const { shape, shapeElement } = textBoxShape();
    expect(shape.insetLeftPt).toBeUndefined();
    expect(shape.insetTopPt).toBeUndefined();
    expect(shape.insetRightPt).toBeUndefined();
    expect(shape.insetBottomPt).toBeUndefined();
    const bodyPr = childOf(childOf(shapeElement, "p:txBody"), "a:bodyPr");
    expect(attrOf(bodyPr, "lIns")).toBeUndefined();
  });

  it("writes each inset in EMU and reads it back in points", () => {
    const { shape, shapeElement } = textBoxShape();
    shape.insetLeftPt = 7.2; // 7.2pt is PowerPoint's own default, 91440 EMU
    shape.insetTopPt = 3.6; // 45720 EMU
    shape.insetRightPt = 1;
    shape.insetBottomPt = 0.5;
    const bodyPr = childOf(childOf(shapeElement, "p:txBody"), "a:bodyPr");
    expect(attrOf(bodyPr, "lIns")).toBe("91440");
    expect(attrOf(bodyPr, "tIns")).toBe("45720");
    expect(attrOf(bodyPr, "rIns")).toBe("12700");
    expect(attrOf(bodyPr, "bIns")).toBe("6350");
    expect(shape.insetLeftPt).toBe(7.2);
    expect(shape.insetBottomPt).toBe(0.5);
  });

  it("clearing an inset removes the attribute rather than writing zero", () => {
    const { shape, shapeElement } = textBoxShape();
    shape.insetLeftPt = 7.2;
    shape.insetLeftPt = undefined;
    const bodyPr = childOf(childOf(shapeElement, "p:txBody"), "a:bodyPr");
    expect(attrOf(bodyPr, "lIns")).toBeUndefined();
    expect(shape.insetLeftPt).toBeUndefined();
  });

  it("a shape with no text body reports no insets; setting one mints p:txBody with bodyPr and lstStyle", () => {
    const { shape, shapeElement } = bareShape();
    expect(shape.insetTopPt).toBeUndefined();
    expect(shapeElement.children).toHaveLength(0);
    shape.insetTopPt = 2;
    expect(
      shapeElement.children.map((c) =>
        c.type === "element" ? c.tag : undefined,
      ),
    ).toEqual(["p:txBody"]);
    const txBody = childOf(shapeElement, "p:txBody");
    expect(tagsOf(txBody ?? el("x"))).toEqual(["a:bodyPr", "a:lstStyle"]);
    expect(attrOf(childOf(txBody, "a:bodyPr"), "tIns")).toBe("25400");
  });
});

describe("PptxShape.frame edges", () => {
  it("reports undefined without spPr, without xfrm, without off/ext, or without the attributes", () => {
    const bare = el("p:sp");
    expect(new PptxShape([bare], bare).frame).toBeUndefined();
    const withSpPr = el("p:sp", {}, [el("p:spPr")]);
    expect(new PptxShape([withSpPr], withSpPr).frame).toBeUndefined();
    const noOff = el("p:sp", {}, [
      el("p:spPr", {}, [el("a:xfrm", {}, [el("a:ext", { cx: "1", cy: "1" })])]),
    ]);
    expect(new PptxShape([noOff], noOff).frame).toBeUndefined();
    const noExt = el("p:sp", {}, [
      el("p:spPr", {}, [el("a:xfrm", {}, [el("a:off", { x: "1", y: "1" })])]),
    ]);
    expect(new PptxShape([noExt], noExt).frame).toBeUndefined();
    const noX = el("p:sp", {}, [
      el("p:spPr", {}, [
        el("a:xfrm", {}, [
          el("a:off", { y: "1" }),
          el("a:ext", { cx: "1", cy: "1" }),
        ]),
      ]),
    ]);
    expect(new PptxShape([noX], noX).frame).toBeUndefined();
    // Reading never mints: the no-off shape still has exactly one xfrm child.
    const xfrm = childOf(childOf(noOff, "p:spPr"), "a:xfrm");
    expect(tagsOf(xfrm ?? el("x"))).toEqual(["a:ext"]);
  });

  it("setting frame on a shape with spPr but no xfrm mints the xfrm ahead of the geometry", () => {
    const shapeElement = el("p:sp", {}, [el("p:spPr")]);
    const shape = new PptxShape([shapeElement], shapeElement);
    shape.frame = { xPt: 1, yPt: 2, widthPt: 3, heightPt: 4 };
    const spPr = childOf(shapeElement, "p:spPr");
    const xfrm = childOf(spPr, "a:xfrm");
    expect(tagsOf(xfrm ?? el("x"))).toEqual(["a:off", "a:ext"]);
    expect(attrOf(childOf(xfrm, "a:off"), "x")).toBe(String(1 * 12700));
    expect(attrOf(childOf(xfrm, "a:ext"), "cy")).toBe(String(4 * 12700));
    expect(shape.frame).toEqual({ xPt: 1, yPt: 2, widthPt: 3, heightPt: 4 });
  });

  it("setting frame twice replaces off and ext rather than accumulating", () => {
    const { shape, shapeElement } = textBoxShape();
    shape.frame = { xPt: 10, yPt: 10, widthPt: 10, heightPt: 10 };
    shape.frame = { xPt: 20, yPt: 20, widthPt: 20, heightPt: 20 };
    const xfrm = childOf(childOf(shapeElement, "p:spPr"), "a:xfrm");
    expect(tagsOf(xfrm ?? el("x"))).toEqual(["a:off", "a:ext"]);
    expect(attrOf(childOf(xfrm, "a:off"), "x")).toBe(String(20 * 12700));
  });
});

describe("PptxShape.rotationDeg edges", () => {
  it("setting rotation on a bare shape mints spPr and xfrm", () => {
    const { shape, shapeElement } = bareShape();
    shape.rotationDeg = 12.5;
    expect(
      shapeElement.children.map((c) =>
        c.type === "element" ? c.tag : undefined,
      ),
    ).toEqual(["p:spPr"]);
    const xfrm = childOf(childOf(shapeElement, "p:spPr"), "a:xfrm");
    expect(attrOf(xfrm, "rot")).toBe("750000");
    expect(shape.rotationDeg).toBe(12.5);
  });

  it("setting rotation to zero removes the attribute; negative degrees are preserved", () => {
    const { shape, shapeElement } = textBoxShape();
    shape.rotationDeg = 45;
    shape.rotationDeg = 0;
    expect(
      attrOf(childOf(childOf(shapeElement, "p:spPr"), "a:xfrm"), "rot"),
    ).toBeUndefined();
    expect(shape.rotationDeg).toBeUndefined();
    shape.rotationDeg = -3;
    expect(
      attrOf(childOf(childOf(shapeElement, "p:spPr"), "a:xfrm"), "rot"),
    ).toBe("-180000");
    expect(shape.rotationDeg).toBe(-3);
  });

  it("clearing rotation when none is set mints spPr and xfrm, pinned as current behaviour", () => {
    // The setter resolves spPr(true) and the xfrm unconditionally before
    // deciding there is no rot to remove, so a clear on a bare shape leaves
    // an empty p:spPr > a:xfrm behind. Pinned as-is.
    const { shape, shapeElement } = bareShape();
    shape.rotationDeg = undefined;
    expect(
      shapeElement.children.map((c) =>
        c.type === "element" ? c.tag : undefined,
      ),
    ).toEqual(["p:spPr"]);
    const spPr = childOf(shapeElement, "p:spPr");
    expect(tagsOf(spPr ?? el("x"))).toEqual(["a:xfrm"]);
    expect(shape.rotationDeg).toBeUndefined();
  });

  it("reading rotation never mints the spPr", () => {
    const { shape, shapeElement } = bareShape();
    expect(shape.rotationDeg).toBeUndefined();
    expect(shapeElement.children).toHaveLength(0);
  });
});

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
