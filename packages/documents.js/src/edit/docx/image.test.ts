import { attr, type XmlElement } from "ooxml.js";
import { resolveRelationships, rootElement } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { ptToEmu } from "../../model/units";
import { el } from "../../xml/fragment";
import { findDescendantElement } from "../../xml/query";
import { createDocx } from "./editor";
import {
  assertDocxWritableImageFormat,
  buildInlineDrawing,
  nextDrawingId,
} from "./image";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

describe("assertDocxWritableImageFormat", () => {
  it.each(["png", "jpeg", "gif"] as const)(
    "does not throw for %s",
    (format) => {
      expect(() => {
        assertDocxWritableImageFormat(format);
      }).not.toThrow();
    },
  );

  it("throws naming the a:blip/a:svgBlip reason when format is svg", () => {
    expect(() => {
      assertDocxWritableImageFormat("svg");
    }).toThrow(
      "buildDocxPackage: an image block in svg format has no OOXML blip this writer can produce (WordprocessingML's a:blip only references a raster part Word decodes directly — png/jpeg/gif)",
    );
  });
});

describe("nextDrawingId", () => {
  it("returns 1 for a document with no existing wp:docPr/pic:cNvPr ids", () => {
    const documentRoot = el("w:document", {}, [
      el("w:body", {}, [el("w:p", {}, [])]),
    ]);
    expect(nextDrawingId(documentRoot)).toBe(1);
  });

  it("returns one past the highest wp:docPr id, ignoring other tags and other attribute names, tolerating a non-numeric id, regardless of traversal order", () => {
    const documentRoot = el("w:document", {}, [
      // An unrelated element carrying an attribute literally named "id" with a large value: must never be read as a drawing id.
      el("w:p", { id: "999" }, []),
      el("w:body", {}, [
        // A docPr whose own "id" is non-numeric: must be safely skipped, not crash, not corrupt the running max.
        el("wp:docPr", { id: "abc", name: "Decoy" }, []),
        // A docPr with an attribute that is NOT named "id": its large value must never be read as a drawing id.
        el("wp:docPr", { id: "3", order: "500" }, []),
        el("w:p", {}, [
          // The true maximum, nested deeper and NOT last in traversal order.
          el("wp:docPr", { id: "15", name: "Picture" }, []),
        ]),
        el("wp:docPr", { id: "9" }, []),
      ]),
    ]);
    expect(nextDrawingId(documentRoot)).toBe(16);
  });

  it("returns one past the highest pic:cNvPr id, regardless of traversal order", () => {
    const documentRoot = el("w:document", {}, [
      el("w:body", {}, [
        el("pic:cNvPr", { id: "4" }, []),
        el("w:p", {}, [el("pic:cNvPr", { id: "21", name: "Picture" }, [])]),
        el("pic:cNvPr", { id: "8" }, []),
      ]),
    ]);
    expect(nextDrawingId(documentRoot)).toBe(22);
  });
});

function getAttr(node: XmlElement, name: string): string {
  const value = attr(node, name);
  expect(value).toBeDefined();
  return value!;
}

describe("buildInlineDrawing", () => {
  it("builds a w:drawing whose extent, ids, blip relationship, and geometry match the given arguments exactly", () => {
    const widthPt = 100;
    const heightPt = 50;
    const expectedCx = String(ptToEmu(widthPt));
    const expectedCy = String(ptToEmu(heightPt));
    expect(expectedCx).not.toBe(expectedCy);

    const drawing = buildInlineDrawing("rId7", widthPt, heightPt, 42, "A cat");

    expect(drawing.tag).toBe("w:drawing");
    expect(getAttr(drawing, "xmlns:wp")).toBe(
      "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    );
    expect(getAttr(drawing, "xmlns:a")).toBe(
      "http://schemas.openxmlformats.org/drawingml/2006/main",
    );
    expect(getAttr(drawing, "xmlns:pic")).toBe(
      "http://schemas.openxmlformats.org/drawingml/2006/picture",
    );
    expect(getAttr(drawing, "xmlns:r")).toBe(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    );

    const extent = findDescendantElement(drawing.children, "wp:extent");
    expect(extent).toBeDefined();
    expect(getAttr(extent!.node, "cx")).toBe(expectedCx);
    expect(getAttr(extent!.node, "cy")).toBe(expectedCy);

    const docPr = findDescendantElement(drawing.children, "wp:docPr");
    expect(docPr).toBeDefined();
    expect(getAttr(docPr!.node, "id")).toBe("42");
    expect(getAttr(docPr!.node, "name")).toBe("A cat");

    const cNvPr = findDescendantElement(drawing.children, "pic:cNvPr");
    expect(cNvPr).toBeDefined();
    expect(getAttr(cNvPr!.node, "id")).toBe("42");
    expect(getAttr(cNvPr!.node, "name")).toBe("A cat");

    expect(
      findDescendantElement(drawing.children, "pic:blipFill"),
    ).toBeDefined();
    const blip = findDescendantElement(drawing.children, "a:blip");
    expect(blip).toBeDefined();
    expect(getAttr(blip!.node, "r:embed")).toBe("rId7");

    const stretch = findDescendantElement(drawing.children, "a:stretch");
    expect(stretch).toBeDefined();
    expect(
      findDescendantElement(stretch!.node.children, "a:fillRect"),
    ).toBeDefined();

    expect(findDescendantElement(drawing.children, "pic:spPr")).toBeDefined();
    expect(findDescendantElement(drawing.children, "a:xfrm")).toBeDefined();
    const off = findDescendantElement(drawing.children, "a:off");
    expect(off).toBeDefined();
    expect(getAttr(off!.node, "x")).toBe("0");
    expect(getAttr(off!.node, "y")).toBe("0");

    const ext = findDescendantElement(drawing.children, "a:ext");
    expect(ext).toBeDefined();
    expect(getAttr(ext!.node, "cx")).toBe(expectedCx);
    expect(getAttr(ext!.node, "cy")).toBe(expectedCy);

    const prstGeom = findDescendantElement(drawing.children, "a:prstGeom");
    expect(prstGeom).toBeDefined();
    expect(getAttr(prstGeom!.node, "prst")).toBe("rect");
    expect(
      findDescendantElement(prstGeom!.node.children, "a:avLst"),
    ).toBeDefined();

    const graphicData = findDescendantElement(
      drawing.children,
      "a:graphicData",
    );
    expect(graphicData).toBeDefined();
    expect(getAttr(graphicData!.node, "uri")).toBe(
      "http://schemas.openxmlformats.org/drawingml/2006/picture",
    );

    expect(
      findDescendantElement(drawing.children, "pic:cNvPicPr"),
    ).toBeDefined();
    expect(findDescendantElement(drawing.children, "pic:pic")).toBeDefined();
    expect(
      findDescendantElement(drawing.children, "pic:nvPicPr"),
    ).toBeDefined();
    expect(findDescendantElement(drawing.children, "a:graphic")).toBeDefined();
  });

  it('falls back to the name "Picture" when no altText is given', () => {
    const drawing = buildInlineDrawing("rId1", 10, 10, 1, undefined);
    const docPr = findDescendantElement(drawing.children, "wp:docPr");
    expect(getAttr(docPr!.node, "name")).toBe("Picture");
    const cNvPr = findDescendantElement(drawing.children, "pic:cNvPr");
    expect(getAttr(cNvPr!.node, "name")).toBe("Picture");
  });

  it("uses the given altText as the name when provided", () => {
    const drawing = buildInlineDrawing("rId1", 10, 10, 1, "A specific caption");
    const docPr = findDescendantElement(drawing.children, "wp:docPr");
    expect(getAttr(docPr!.node, "name")).toBe("A specific caption");
  });

  it("converts width/height in points to EMU rather than passing them through unconverted", () => {
    const drawing = buildInlineDrawing("rId1", 1, 1, 1, undefined);
    const extent = findDescendantElement(drawing.children, "wp:extent");
    // 1pt = 914400/72 = 12700 EMU exactly; asserting the real converted value rather than merely "some string" catches an unconverted or miscalculated cx/cy.
    expect(getAttr(extent!.node, "cx")).toBe("12700");
    expect(getAttr(extent!.node, "cy")).toBe("12700");
  });
});

describe("DocxParagraph.insertImageAfter", () => {
  it("adds the media part, content-type entry, relationship, and a w:drawing referencing it", () => {
    const editor = createDocx();
    const paragraph = editor.body.appendParagraph();
    paragraph.insertImageAfter({
      format: "png",
      bytes: PNG_BYTES,
      widthPt: 100,
      heightPt: 50,
    });

    const pkg = editor.toPackage();
    expect(pkg.parts["word/media/image1.png"]).toBeDefined();

    const contentTypesRoot = rootElement(pkg.parts["[Content_Types].xml"]);
    const hasDefault = contentTypesRoot?.children.some(
      (c) =>
        c.type === "element" &&
        c.tag === "Default" &&
        attr(c, "Extension") === "png",
    );
    expect(hasDefault).toBe(true);

    const rels = resolveRelationships(pkg, "word/document.xml");
    const imageRel = [...rels.values()].find(
      (r) => r.target === "word/media/image1.png",
    );
    expect(imageRel).toBeDefined();

    expect(paragraph.runs()).toHaveLength(1);
  });

  it("round-trips through encodePackage/decodePackage after an image is added", () => {
    const editor = createDocx();
    editor.body.appendParagraph().insertImageAfter({
      format: "png",
      bytes: PNG_BYTES,
      widthPt: 10,
      heightPt: 10,
    });
    expect(() => editor.toBytes()).not.toThrow();
  });

  it("throws when called on a paragraph with no image context (e.g. a table-cell paragraph)", () => {
    const editor = createDocx();
    const table = editor.body.appendTable({ rows: 1, columns: 1 });
    const cellParagraph = table.cell(0, 0).appendParagraph();
    expect(() => {
      cellParagraph.insertImageAfter({
        format: "png",
        bytes: PNG_BYTES,
        widthPt: 10,
        heightPt: 10,
      });
    }).toThrow(/DocxEditor/);
  });
});
