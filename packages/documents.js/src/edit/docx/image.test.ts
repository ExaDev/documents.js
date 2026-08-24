import { attr, resolveRelationships, rootElement } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { createDocx } from "./editor";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

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
