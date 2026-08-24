import type {
  ContentEmbeddedObject,
  ContentSheetImage,
  MathMlElement,
  MathMlNode,
} from "document-schema.js";
import type { Package, XmlElement } from "odf.js";
import {
  attrValue,
  bytesToBase64,
  childrenWithTag,
  decodePackage,
  elementsWithTag,
  encodePackage,
  readManifest,
  readOdfFormulaMathMl,
  rootElement,
} from "odf.js";
import { describe, expect, it } from "vitest";
import { formulaDocument } from "../../model/formula";
import { createOds } from "./editor";

// insertSheetImage/insertSheetEmbeddedObject (floating.ts) write real ODF spreadsheet floating shapes -- a table:shapes wrapper directly inside table:table, holding draw:frame elements with absolute svg:x/svg:y/svg:width/svg:height. Every assertion here inspects the real written package/XML structure directly (via odf.js's own query/manifest/formula-reading primitives, and a genuine zip encode/decode round trip) rather than through a readOdsContent re-read: odf.js's spreadsheet reader does read cell- and table:shapes-anchored images/embedded objects back (src/layout/sheets.ts's renderAnchoredImages/renderAnchoredFormulas consume them), but the ContentDocument it returns is a semantic projection with no trace of the exact structural facts under test here -- the table:shapes wrapper's own position directly inside table:table, the literal svg:x/svg:y/svg:width/svg:height values, and the manifest entries.

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

function contentRoot(pkg: Package): XmlElement {
  const part = pkg.parts["content.xml"];
  const root = part?.kind === "xml" ? rootElement(part.nodes) : undefined;
  if (root === undefined) {
    throw new Error("expected a content.xml root element");
  }
  return root;
}

function findTableShapes(pkg: Package): XmlElement | undefined {
  return elementsWithTag([contentRoot(pkg)], "table:shapes")[0];
}

function mel(tag: string, children: MathMlNode[] = []): MathMlElement {
  return { type: "element", tag, attributes: [], children };
}

function mtoken(tag: string, text: string): MathMlElement {
  return {
    type: "element",
    tag,
    attributes: [],
    children: [{ type: "text", value: text }],
  };
}

function signature(nodes: readonly MathMlNode[]): string {
  return nodes
    .flatMap((node) => {
      if (node.type !== "element") {
        return [];
      }
      const inner = node.children.some((child) => child.type === "element")
        ? signature(node.children)
        : node.children
            .map((child) => (child.type === "text" ? child.value : ""))
            .join("");
      return [`${node.tag.slice(node.tag.indexOf(":") + 1)}(${inner})`];
    })
    .join(",");
}

describe("OdsSheet.addImage", () => {
  function baseImage(
    overrides: Partial<ContentSheetImage> = {},
  ): ContentSheetImage {
    return {
      kind: "image",
      format: "png",
      base64: bytesToBase64(PNG_BYTES),
      widthPt: 40,
      heightPt: 30,
      anchorRow: 0,
      anchorColumn: 0,
      offsetXPt: 0,
      offsetYPt: 0,
      ...overrides,
    };
  }

  it("writes a table:shapes wrapper as table:table's own first child, holding a draw:frame/draw:image at the anchor's resolved position", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.addImage(baseImage());

    const pkg = editor.toPackage();
    const table = elementsWithTag([contentRoot(pkg)], "table:table")[0]!;
    expect(
      table.children[0]?.type === "element" ? table.children[0].tag : undefined,
    ).toBe("table:shapes");

    const frame = elementsWithTag([contentRoot(pkg)], "draw:frame")[0];
    expect(frame).toBeDefined();
    expect(attrValue(frame!, "svg:x")).toBe("0pt");
    expect(attrValue(frame!, "svg:y")).toBe("0pt");
    expect(attrValue(frame!, "svg:width")).toBe("40pt");
    expect(attrValue(frame!, "svg:height")).toBe("30pt");
    const image = childrenWithTag(frame!, "draw:image")[0];
    expect(image).toBeDefined();
    expect(attrValue(image!, "xlink:href")).toMatch(/^Pictures\/image1\.png$/);
  });

  it("anchors past a real, explicitly-sized column/row at the correct cumulative offset", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.setColumnWidth(0, 100);
    sheet.setRowHeight(0, 20);
    sheet.addImage(
      baseImage({ anchorRow: 1, anchorColumn: 1, offsetXPt: 5, offsetYPt: 3 }),
    );

    const pkg = editor.toPackage();
    const frame = elementsWithTag([contentRoot(pkg)], "draw:frame")[0]!;
    expect(attrValue(frame, "svg:x")).toBe("105pt"); // column 0's real width (100) + offsetXPt (5)
    expect(attrValue(frame, "svg:y")).toBe("23pt"); // row 0's real height (20) + offsetYPt (3)
  });

  it("anchors past a hidden column/row at offset 0 for that position, matching how a real spreadsheet application visually collapses it", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.setColumnWidth(0, 100);
    sheet.setColumnHidden(0, true);
    sheet.addImage(baseImage({ anchorRow: 0, anchorColumn: 1 }));

    const pkg = editor.toPackage();
    const frame = elementsWithTag([contentRoot(pkg)], "draw:frame")[0]!;
    expect(attrValue(frame, "svg:x")).toBe("0pt");
  });

  it("anchors past every declared column/row using the same DEFAULT_COLUMN_WIDTH_PT/DEFAULT_ROW_HEIGHT_PT this package's own layout engine assumes for an undeclared position", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.addImage(baseImage({ anchorRow: 2, anchorColumn: 3 })); // no columns/rows declared at all yet

    const pkg = editor.toPackage();
    const frame = elementsWithTag([contentRoot(pkg)], "draw:frame")[0]!;
    expect(attrValue(frame, "svg:x")).toBe("192pt"); // 3 columns * 64pt default
    expect(attrValue(frame, "svg:y")).toBe("30pt"); // 2 rows * 15pt default
  });

  it("adds the binary image part under Pictures/ with the exact source bytes, and lists it in the manifest", () => {
    const editor = createOds();
    editor.sheets()[0]!.addImage(baseImage());
    const pkg = editor.toPackage();
    const part = pkg.parts["Pictures/image1.png"];
    expect(part?.kind).toBe("binary");
    expect(part?.kind === "binary" ? part.base64 : undefined).toBe(
      bytesToBase64(PNG_BYTES),
    );
    expect(
      readManifest(pkg).entries.some(
        (entry) => entry.fullPath === "Pictures/image1.png",
      ),
    ).toBe(true);
  });

  it("a second image gets its own picture index rather than colliding with the first", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.addImage(baseImage());
    sheet.addImage(baseImage({ anchorColumn: 2 }));
    const pkg = editor.toPackage();
    expect(Object.keys(pkg.parts)).toEqual(
      expect.arrayContaining(["Pictures/image1.png", "Pictures/image2.png"]),
    );
    const shapes = findTableShapes(pkg)!;
    expect(childrenWithTag(shapes, "draw:frame")).toHaveLength(2);
  });

  it("survives a real zip encode/decode round trip, not just the in-memory package", () => {
    const editor = createOds();
    editor.sheets()[0]!.addImage(baseImage());
    const reopened = decodePackage(encodePackage(editor.toPackage()));
    const part = reopened.parts["Pictures/image1.png"];
    expect(part?.kind === "binary" ? part.base64 : undefined).toBe(
      bytesToBase64(PNG_BYTES),
    );
    expect(findTableShapes(reopened)).toBeDefined();
  });
});

describe("OdsSheet.addEmbeddedObject", () => {
  const FRACTION = formulaDocument({
    mathml: [mel("mfrac", [mtoken("mi", "a"), mtoken("mi", "b")])],
  });

  function formulaObject(
    overrides: Partial<ContentEmbeddedObject> = {},
  ): ContentEmbeddedObject {
    return {
      objectKind: "formula",
      document: FRACTION,
      frame: { xPt: 10, yPt: 20, widthPt: 30, heightPt: 15 },
      ...overrides,
    };
  }

  it("writes a real formula sub-document odf.js's own readOdfFormulaMathMl reads straight back, referenced from a draw:object at the object's own already-absolute frame", () => {
    const editor = createOds();
    editor.sheets()[0]!.addEmbeddedObject(formulaObject());
    const pkg = editor.toPackage();

    const subPart = pkg.parts["Object 1/content.xml"];
    expect(subPart?.kind).toBe("xml");
    const recovered = readOdfFormulaMathMl({
      parts: { "content.xml": subPart! },
    });
    expect(signature(recovered.mathml)).toBe("mfrac(mi(a),mi(b))");

    const frame = elementsWithTag([contentRoot(pkg)], "draw:frame")[0]!;
    expect(attrValue(frame, "svg:x")).toBe("10pt");
    expect(attrValue(frame, "svg:y")).toBe("20pt");
    expect(attrValue(frame, "svg:width")).toBe("30pt");
    expect(attrValue(frame, "svg:height")).toBe("15pt");
    expect(
      attrValue(childrenWithTag(frame, "draw:object")[0]!, "xlink:href"),
    ).toBe("./Object 1");
  });

  it("lists the sub-document in the manifest with the genuine ODF formula media type", () => {
    const editor = createOds();
    editor.sheets()[0]!.addEmbeddedObject(formulaObject());
    const entries = readManifest(editor.toPackage()).entries;
    expect(
      entries.find((entry) => entry.fullPath === "Object 1/")?.mediaType,
    ).toBe("application/vnd.oasis.opendocument.formula");
  });

  it("writes nothing at all for every other objectKind -- a documented, bounded gap mirroring buildOdtPackage's identical narrowing for a drawing embeddedObject block", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    const partCountBefore = Object.keys(editor.toPackage().parts).length;
    sheet.addEmbeddedObject({
      objectKind: "drawing",
      document: { kind: "drawing", metadata: {}, pages: [] },
      frame: { xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 },
    });
    expect(findTableShapes(editor.toPackage())).toBeUndefined();
    expect(Object.keys(editor.toPackage().parts)).toHaveLength(partCountBefore);
  });
});
