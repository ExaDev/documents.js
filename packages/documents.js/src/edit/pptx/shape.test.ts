import type { XmlNode } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { buildPictureShape, buildTextBoxShape, PptxShape } from "./shape";

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
