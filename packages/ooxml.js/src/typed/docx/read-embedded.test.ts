import type { Package } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";
import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentEmbeddedObjectBlock,
  ContentImageBlock,
} from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { bytesToBase64 } from "byte-codec";
import {
  minimalDocxBytes,
  minimalPptxBytes,
  minimalXlsxBytes,
} from "../../test-support/embedded";
import { attr, childrenWithTag, elementsWithTag, rootElement } from "../util";
import { readDocxContent } from "./read";
import { buildDocxPackageFromContent } from "./write";
const IMAGE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const OLE_OBJECT_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject";
const PICTURE_GRAPHIC_URI =
  "http://schemas.openxmlformats.org/drawingml/2006/picture";

// A genuine, minimal 1x1 transparent PNG — real magic bytes, so sniffImageFormat actually recognises it, not a placeholder string.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// wp:inline and wp:anchor share the identical wp:extent/wp:docPr/a:graphic/a:graphicData/pic:pic/pic:blipFill/a:blip shape — only the outer container tag differs (and, for wp:anchor, the wp:positionH/wp:positionV elements this fixture doesn't set — see the dedicated "wp:anchor floating image position" describe block below for those).
function drawingElement(
  containerTag: "wp:inline" | "wp:anchor",
  rId: string,
  altText: string,
  extent: Readonly<{ cx: string; cy: string }> = { cx: "914400", cy: "457200" },
): XmlElement {
  return el("w:drawing", {}, [
    el(containerTag, {}, [
      el("wp:extent", extent), // default 1in x 0.5in -> 72pt x 36pt
      el("wp:docPr", { id: "1", name: "Picture 1", descr: altText }),
      el("a:graphic", {}, [
        el("a:graphicData", { uri: PICTURE_GRAPHIC_URI }, [
          el("pic:pic", {}, [
            el("pic:blipFill", {}, [el("a:blip", { "r:embed": rId })]),
          ]),
        ]),
      ]),
    ]),
  ]);
}

function rels(
  entries: readonly {
    id: string;
    type: string;
    target: string;
    external?: boolean;
  }[],
): XmlElement {
  return el(
    "Relationships",
    {},
    entries.map((e) =>
      el(
        "Relationship",
        e.external === true
          ? { Id: e.id, Type: e.type, Target: e.target, TargetMode: "External" }
          : { Id: e.id, Type: e.type, Target: e.target },
      ),
    ),
  );
}

function asImage(block: ContentBlock | undefined): ContentImageBlock {
  if (block?.kind !== "image") {
    throw new Error("expected an image block");
  }
  return block;
}

function asEmbeddedObject(
  block: ContentBlock | undefined,
): ContentEmbeddedObjectBlock {
  if (block?.kind !== "embeddedObject") {
    throw new Error("expected an embeddedObject block");
  }
  return block;
}

function oleObjectFixturePackage(
  oleRel: Readonly<{ target: string; external?: boolean }>,
  extraRuns: readonly XmlElement[] = [],
  dxaOrig = "1920",
): Package {
  const objectRun = el("w:r", {}, [
    el("w:object", { "w:dxaOrig": dxaOrig, "w:dyaOrig": "1200" }, [
      el(
        "v:shape",
        {
          id: "_x0000_i1025",
          type: "#_x0000_t75",
          style: "width:96pt;height:60pt",
        },
        [el("v:imagedata", { "r:id": "rIdPreview", "o:title": "" })],
      ),
      el("o:OLEObject", {
        Type: "Embed",
        ProgID: "Excel.Sheet.12",
        ShapeID: "_x0000_i1025",
        DrawAspect: "Content",
        ObjectID: "_1702998213",
        "r:id": "rIdOle",
      }),
    ]),
  ]);
  const paragraph = el("w:p", {}, [objectRun, ...extraRuns]);
  const body = el("w:body", {}, [
    paragraph,
    el("w:sectPr", {}, [el("w:pgSz", { "w:w": "12240", "w:h": "15840" })]),
  ]);
  const documentRels = rels([
    oleRel.external === true
      ? {
          id: "rIdOle",
          type: OLE_OBJECT_REL,
          target: oleRel.target,
          external: true,
        }
      : { id: "rIdOle", type: OLE_OBJECT_REL, target: oleRel.target },
    { id: "rIdPreview", type: IMAGE_REL, target: "media/olePreview.png" },
  ]);
  return {
    parts: {
      "word/document.xml": {
        kind: "xml",
        nodes: [el("w:document", {}, [body])],
      },
      "word/_rels/document.xml.rels": { kind: "xml", nodes: [documentRels] },
      "word/media/olePreview.png": { kind: "binary", base64: TINY_PNG_BASE64 },
    },
  };
}

interface ElementSink {
  readonly found: XmlElement[];
}

function findAllElements(nodes: readonly XmlNode[], tag: string): XmlElement[] {
  const sink: ElementSink = { found: [] };
  collectElements(nodes, tag, sink);
  return sink.found;
}

function collectElements(
  nodes: readonly XmlNode[],
  tag: string,
  sink: ElementSink,
): void {
  for (const node of nodes) {
    if (node.type !== "element") {
      continue;
    }
    if (node.tag === tag) {
      sink.found.push(node);
    }
    collectElements(node.children, tag, sink);
  }
}

function anchoredImagePackage(
  positionH: XmlElement,
  positionV: XmlElement,
): Package {
  const drawing = el("w:drawing", {}, [
    el("wp:anchor", {}, [
      positionH,
      positionV,
      el("wp:extent", { cx: "914400", cy: "457200" }),
      el("wp:docPr", { id: "1", name: "Picture 1" }),
      el("a:graphic", {}, [
        el("a:graphicData", { uri: PICTURE_GRAPHIC_URI }, [
          el("pic:pic", {}, [
            el("pic:blipFill", {}, [
              el("a:blip", { "r:embed": "rIdAnchoredImage" }),
            ]),
          ]),
        ]),
      ]),
    ]),
  ]);
  const paragraph = el("w:p", {}, [el("w:r", {}, [drawing])]);
  const body = el("w:body", {}, [
    paragraph,
    el("w:sectPr", {}, [el("w:pgSz", { "w:w": "12240", "w:h": "15840" })]),
  ]);
  return {
    parts: {
      "word/document.xml": {
        kind: "xml",
        nodes: [el("w:document", {}, [body])],
      },
      "word/_rels/document.xml.rels": {
        kind: "xml",
        nodes: [
          rels([
            {
              id: "rIdAnchoredImage",
              type: IMAGE_REL,
              target: "media/anchored.png",
            },
          ]),
        ],
      },
      "word/media/anchored.png": { kind: "binary", base64: TINY_PNG_BASE64 },
    },
  };
}

describe("embedded OLE objects: write-side round trip", () => {
  it("round-trips a recovered spreadsheet embed through build -> re-read with the nested document, payload part, relationship, and content-type override all intact", () => {
    const pkg = oleObjectFixturePackage({
      target: "embeddings/oleObject1.xlsx",
    });
    pkg.parts["word/embeddings/oleObject1.xlsx"] = {
      kind: "binary",
      base64: bytesToBase64(minimalXlsxBytes()),
    };
    const before = readDocxContent(pkg);
    const written = buildDocxPackageFromContent(before);
    const after = readDocxContent(written);

    // The paragraph keeps its own (run-text-empty) block and the object's recovered content survives as the sibling embedded block, frame intact.
    expect(after.sections[0]?.blocks).toHaveLength(2);
    const embedded = asEmbeddedObject(after.sections[0]?.blocks[1]);
    expect(embedded.objectKind).toBe("spreadsheet");
    expect(embedded.frame).toEqual({
      xPt: 0,
      yPt: 0,
      widthPt: 96,
      heightPt: 60,
    });
    // The nested document is the genuinely re-serialised workbook, not just an envelope block.
    const sheet =
      embedded.document.kind === "spreadsheet"
        ? embedded.document.sheets[0]
        : undefined;
    expect(sheet?.name).toBe("Embedded");
    expect(sheet?.cells[0]?.value).toEqual({
      kind: "string",
      value: "Recovered cell",
    });

    // The written markup derives w:dxaOrig/w:dyaOrig from the block's frame (pt -> twips) and carries a ProgID Word can activate the payload with.
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const objects = findAllElements(
      documentRoot === undefined ? [] : [documentRoot],
      "w:object",
    );
    expect(objects).toHaveLength(1);
    const objectElement = objects[0];
    if (objectElement === undefined) {
      throw new Error("expected a written w:object element");
    }
    expect(attr(objectElement, "w:dxaOrig")).toBe("1920");
    expect(attr(objectElement, "w:dyaOrig")).toBe("1200");
    const oleObject = childrenWithTag(objectElement, "o:OLEObject")[0];
    expect(attr(oleObject!, "ProgID")).toBe("Excel.Sheet.12");

    // The payload part itself, its relationship, and its content-type override all exist in the written package.
    expect(written.parts["word/embeddings/oleObject1.xlsx"]?.kind).toBe(
      "binary",
    );
    const relsRoot = rootElement(written.parts["word/_rels/document.xml.rels"]);
    const oleRel = elementsWithTag(
      relsRoot === undefined ? [] : [relsRoot],
      "Relationship",
    ).find((relationship) => attr(relationship, "Type") === OLE_OBJECT_REL);
    expect(attr(oleRel!, "Target")).toBe("embeddings/oleObject1.xlsx");
    expect(attr(oleRel!, "TargetMode")).toBeUndefined();
    const typesRoot = rootElement(written.parts["[Content_Types].xml"]);
    const embeddingOverride = elementsWithTag(
      typesRoot === undefined ? [] : [typesRoot],
      "Override",
    ).find(
      (candidate) =>
        attr(candidate, "PartName") === "/word/embeddings/oleObject1.xlsx",
    );
    expect(attr(embeddingOverride!, "ContentType")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("round-trips a recovered wordprocessing embed (a nested docx) with the nested sections intact and the docx content-type override", () => {
    const pkg = oleObjectFixturePackage({
      target: "embeddings/oleObject1.docx",
    });
    pkg.parts["word/embeddings/oleObject1.docx"] = {
      kind: "binary",
      base64: bytesToBase64(minimalDocxBytes()),
    };
    const written = buildDocxPackageFromContent(readDocxContent(pkg));
    const after = readDocxContent(written);
    const embedded = asEmbeddedObject(after.sections[0]?.blocks[1]);
    expect(embedded.objectKind).toBe("wordprocessing");
    const paragraph =
      embedded.document.kind === "wordprocessing"
        ? embedded.document.sections[0]?.blocks[0]
        : undefined;
    expect(
      paragraph?.kind === "paragraph" ? paragraph.runs[0]?.text : undefined,
    ).toBe("Embedded memo");
    expect(written.parts["word/embeddings/oleObject1.docx"]?.kind).toBe(
      "binary",
    );
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const oleObject = findAllElements(
      documentRoot === undefined ? [] : [documentRoot],
      "o:OLEObject",
    )[0];
    expect(attr(oleObject!, "ProgID")).toBe("Word.Document.12");
    const typesRoot = rootElement(written.parts["[Content_Types].xml"]);
    const embeddingOverride = elementsWithTag(
      typesRoot === undefined ? [] : [typesRoot],
      "Override",
    ).find(
      (candidate) =>
        attr(candidate, "PartName") === "/word/embeddings/oleObject1.docx",
    );
    expect(attr(embeddingOverride!, "ContentType")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("writes one embeddings part for two objects sharing a payload, both blocks surviving the re-read", () => {
    // The copy-pasted-object shape: two w:object runs point their r:id at one embeddings part, and the reader hands both blocks the same recovered document. Identical nested documents serialise to identical bytes, so the writer must re-share one part rather than shipping a duplicate.
    const secondObjectRun = el("w:r", {}, [
      el("w:object", { "w:dxaOrig": "1920", "w:dyaOrig": "1200" }, [
        el("o:OLEObject", {
          Type: "Embed",
          ProgID: "Excel.Sheet.12",
          "r:id": "rIdOle",
        }),
      ]),
    ]);
    const pkg = oleObjectFixturePackage(
      { target: "embeddings/oleObject1.xlsx" },
      [secondObjectRun],
    );
    pkg.parts["word/embeddings/oleObject1.xlsx"] = {
      kind: "binary",
      base64: bytesToBase64(minimalXlsxBytes()),
    };
    const written = buildDocxPackageFromContent(readDocxContent(pkg));
    const after = readDocxContent(written);
    // The shared paragraph plus the two w:object runs, both recovered as their own embedded block.
    const EXPECTED_BLOCK_COUNT = 3;
    expect(after.sections[0]?.blocks).toHaveLength(EXPECTED_BLOCK_COUNT);
    expect(asEmbeddedObject(after.sections[0]?.blocks[1]).objectKind).toBe(
      "spreadsheet",
    );
    expect(asEmbeddedObject(after.sections[0]?.blocks[2]).objectKind).toBe(
      "spreadsheet",
    );
    const embeddingPartNames = Object.keys(written.parts).filter((path) =>
      path.startsWith("word/embeddings/"),
    );
    expect(embeddingPartNames).toEqual(["word/embeddings/oleObject1.xlsx"]);
  });

  it("restores an object and a drawing lifted from one paragraph back into that paragraph, preserving their encounter order", () => {
    const pkg = oleObjectFixturePackage(
      { target: "embeddings/oleObject1.xlsx" },
      [
        el("w:r", {}, [
          drawingElement("wp:inline", "rIdPreview", "Drawing after the object"),
        ]),
      ],
    );
    pkg.parts["word/embeddings/oleObject1.xlsx"] = {
      kind: "binary",
      base64: bytesToBase64(minimalXlsxBytes()),
    };
    const after = readDocxContent(
      buildDocxPackageFromContent(readDocxContent(pkg)),
    );
    // The object's own paragraph, the embedded object block, and the lifted drawing image after it.
    const EXPECTED_BLOCK_COUNT = 3;
    expect(after.sections[0]?.blocks).toHaveLength(EXPECTED_BLOCK_COUNT);
    expect(asEmbeddedObject(after.sections[0]?.blocks[1]).objectKind).toBe(
      "spreadsheet",
    );
    expect(asImage(after.sections[0]?.blocks[2]).altText).toBe(
      "Drawing after the object",
    );
  });

  it("round-trips a recovered presentation embed through an injected embedded-presentation serialiser", () => {
    // The port (#742): ooxml.js has no PresentationML writer, but a caller one layer up does — documents.js's buildPptxPackage — and this package cannot depend on its own consumer. options.serialiseEmbeddedPresentation is the seam: the caller injects presentation-document -> pptx-bytes, and the writer serialises the embed exactly like an embedded workbook, into a real word/embeddings/oleObjectN.pptx part.
    const pkg = oleObjectFixturePackage({
      target: "embeddings/oleObject1.pptx",
    });
    pkg.parts["word/embeddings/oleObject1.pptx"] = {
      kind: "binary",
      base64: bytesToBase64(minimalPptxBytes()),
    };
    const before = readDocxContent(pkg);
    let serialised:
      | Extract<
          ContentEmbeddedObjectBlock["document"],
          { kind: "presentation" }
        >
      | undefined;
    const written = buildDocxPackageFromContent(before, {
      serialiseEmbeddedPresentation: (document) => {
        serialised = document;
        return minimalPptxBytes();
      },
    });
    // The serialiser received the genuinely recovered presentation document, not an envelope or a copy of the host.
    expect(serialised?.kind).toBe("presentation");

    const after = readDocxContent(written);
    const embedded = asEmbeddedObject(after.sections[0]?.blocks[1]);
    expect(embedded.objectKind).toBe("presentation");
    expect(embedded.frame).toEqual({
      xPt: 0,
      yPt: 0,
      widthPt: 96,
      heightPt: 60,
    });
    // The nested document is the genuinely decoded payload the serialiser produced — minimalPptxBytes' one slide, its paragraph block intact.
    const slide =
      embedded.document.kind === "presentation"
        ? embedded.document.slides[0]
        : undefined;
    expect(slide?.shapes[0]?.blocks[0]?.kind).toBe("paragraph");

    // The payload part carries the pptx extension, ProgID, relationship, and presentationml content-type override an embedded deck needs.
    expect(written.parts["word/embeddings/oleObject1.pptx"]?.kind).toBe(
      "binary",
    );
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const oleObject = findAllElements(
      documentRoot === undefined ? [] : [documentRoot],
      "o:OLEObject",
    )[0];
    expect(attr(oleObject!, "ProgID")).toBe("PowerPoint.Show.12");
    const relsRoot = rootElement(written.parts["word/_rels/document.xml.rels"]);
    const oleRel = elementsWithTag(
      relsRoot === undefined ? [] : [relsRoot],
      "Relationship",
    ).find((relationship) => attr(relationship, "Type") === OLE_OBJECT_REL);
    expect(attr(oleRel!, "Target")).toBe("embeddings/oleObject1.pptx");
    const typesRoot = rootElement(written.parts["[Content_Types].xml"]);
    const embeddingOverride = elementsWithTag(
      typesRoot === undefined ? [] : [typesRoot],
      "Override",
    ).find(
      (candidate) =>
        attr(candidate, "PartName") === "/word/embeddings/oleObject1.pptx",
    );
    expect(attr(embeddingOverride!, "ContentType")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
  });

  it("refuses an embedded presentation document loudly rather than silently dropping the recovered sub-document", () => {
    // ooxml.js has no pptx writer (PresentationML is read-only in this package), so a presentation embed — which readDocxContent genuinely recovers — has no bytes this writer can produce on its own. The reader's degrade-tier rule inverts at the write boundary: a builder asked for a document it cannot faithfully produce throws instead of writing a file that silently lost the embed. The injected serialiser is the remedy, and the previous test proves it; with none injected this throw is the documented boundary.
    const block: ContentEmbeddedObjectBlock = {
      kind: "embeddedObject",
      objectKind: "presentation",
      document: { kind: "presentation", metadata: {}, slides: [] },
      frame: { xPt: 0, yPt: 0, widthPt: 96, heightPt: 60 },
    };
    expect(() =>
      buildDocxPackageFromContent({
        sections: [
          {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
            blocks: [block],
          },
        ],
      }),
    ).toThrow(/presentation/);
  });
});

describe("readDocxContent: wp:anchor floating image position (ExaDev/documents.js#1087)", () => {
  it("reads an offset-based position on both axes — wp:posOffset, an EMU integer converted to points", () => {
    const pkg = anchoredImagePackage(
      el("wp:positionH", { relativeFrom: "page" }, [
        el("wp:posOffset", {}, [txt("914400")]), // 1in -> 72pt
      ]),
      el("wp:positionV", { relativeFrom: "paragraph" }, [
        el("wp:posOffset", {}, [txt("-457200")]), // -0.5in -> -36pt, a real negative offset docx permits
      ]),
    );
    const image = asImage(readDocxContent(pkg).sections[0]?.blocks[1]);
    expect(image.floatPosition).toEqual({
      horizontal: { relativeTo: "page", offsetPt: 72 },
      vertical: { relativeTo: "paragraph", offsetPt: -36 },
    });
  });

  it("reads an align-based position on both axes — wp:align, a keyword", () => {
    const pkg = anchoredImagePackage(
      el("wp:positionH", { relativeFrom: "margin" }, [
        el("wp:align", {}, [txt("right")]),
      ]),
      el("wp:positionV", { relativeFrom: "margin" }, [
        el("wp:align", {}, [txt("top")]),
      ]),
    );
    const image = asImage(readDocxContent(pkg).sections[0]?.blocks[1]);
    expect(image.floatPosition).toEqual({
      horizontal: { relativeTo: "margin", align: "right" },
      vertical: { relativeTo: "margin", align: "top" },
    });
  });

  it("reads one axis offset-based and the other align-based independently — docx's own wp:positionH/wp:positionV choose per axis", () => {
    const pkg = anchoredImagePackage(
      el("wp:positionH", { relativeFrom: "column" }, [
        el("wp:posOffset", {}, [txt("228600")]), // 0.25in -> 18pt
      ]),
      el("wp:positionV", { relativeFrom: "line" }, [
        el("wp:align", {}, [txt("bottom")]),
      ]),
    );
    const image = asImage(readDocxContent(pkg).sections[0]?.blocks[1]);
    expect(image.floatPosition).toEqual({
      horizontal: { relativeTo: "column", offsetPt: 18 },
      vertical: { relativeTo: "line", align: "bottom" },
    });
  });

  it.each([
    "leftMargin",
    "rightMargin",
    "insideMargin",
    "outsideMargin",
    "character",
  ] as const)(
    "recognises the horizontal-only relativeFrom value %s",
    (relativeFrom) => {
      const pkg = anchoredImagePackage(
        el("wp:positionH", { relativeFrom }, [
          el("wp:posOffset", {}, [txt("0")]),
        ]),
        el("wp:positionV", { relativeFrom: "page" }, [
          el("wp:posOffset", {}, [txt("0")]),
        ]),
      );
      const image = asImage(readDocxContent(pkg).sections[0]?.blocks[1]);
      expect(image.floatPosition?.horizontal.relativeTo).toBe(relativeFrom);
    },
  );

  it.each(["topMargin", "bottomMargin", "line"] as const)(
    "recognises the vertical-only relativeFrom value %s",
    (relativeFrom) => {
      const pkg = anchoredImagePackage(
        el("wp:positionH", { relativeFrom: "page" }, [
          el("wp:posOffset", {}, [txt("0")]),
        ]),
        el("wp:positionV", { relativeFrom }, [
          el("wp:posOffset", {}, [txt("0")]),
        ]),
      );
      const image = asImage(readDocxContent(pkg).sections[0]?.blocks[1]);
      expect(image.floatPosition?.vertical.relativeTo).toBe(relativeFrom);
    },
  );

  it("has no floatPosition when wp:positionH/wp:positionV are absent entirely, even inside a real wp:anchor", () => {
    const drawing = el("w:drawing", {}, [
      el("wp:anchor", {}, [
        el("wp:extent", { cx: "914400", cy: "457200" }),
        el("wp:docPr", { id: "1", name: "Picture 1" }),
        el("a:graphic", {}, [
          el("a:graphicData", { uri: PICTURE_GRAPHIC_URI }, [
            el("pic:pic", {}, [
              el("pic:blipFill", {}, [
                el("a:blip", { "r:embed": "rIdAnchoredImage" }),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]);
    const paragraph = el("w:p", {}, [el("w:r", {}, [drawing])]);
    const body = el("w:body", {}, [
      paragraph,
      el("w:sectPr", {}, [el("w:pgSz", { "w:w": "12240", "w:h": "15840" })]),
    ]);
    const pkg: Package = {
      parts: {
        "word/document.xml": {
          kind: "xml",
          nodes: [el("w:document", {}, [body])],
        },
        "word/_rels/document.xml.rels": {
          kind: "xml",
          nodes: [
            rels([
              {
                id: "rIdAnchoredImage",
                type: IMAGE_REL,
                target: "media/anchored.png",
              },
            ]),
          ],
        },
        "word/media/anchored.png": {
          kind: "binary",
          base64: TINY_PNG_BASE64,
        },
      },
    };
    const image = asImage(readDocxContent(pkg).sections[0]?.blocks[1]);
    expect(image.floatPosition).toBeUndefined();
  });

  it("drops the whole floatPosition, not just the malformed axis, when relativeFrom is missing or unrecognised on one axis", () => {
    const pkg = anchoredImagePackage(
      el("wp:positionH", { relativeFrom: "notARealValue" }, [
        el("wp:posOffset", {}, [txt("0")]),
      ]),
      el("wp:positionV", { relativeFrom: "page" }, [
        el("wp:posOffset", {}, [txt("0")]),
      ]),
    );
    const image = asImage(readDocxContent(pkg).sections[0]?.blocks[1]);
    expect(image.floatPosition).toBeUndefined();
  });

  it("drops the whole floatPosition when an axis carries neither wp:posOffset nor a recognised wp:align", () => {
    const pkg = anchoredImagePackage(
      el("wp:positionH", { relativeFrom: "page" }, [
        el("wp:align", {}, [txt("not-a-real-align-value")]),
      ]),
      el("wp:positionV", { relativeFrom: "page" }, [
        el("wp:posOffset", {}, [txt("0")]),
      ]),
    );
    const image = asImage(readDocxContent(pkg).sections[0]?.blocks[1]);
    expect(image.floatPosition).toBeUndefined();
  });

  it("drops the whole floatPosition when wp:posOffset carries a non-numeric value", () => {
    const pkg = anchoredImagePackage(
      el("wp:positionH", { relativeFrom: "page" }, [
        el("wp:posOffset", {}, [txt("not-a-number")]),
      ]),
      el("wp:positionV", { relativeFrom: "page" }, [
        el("wp:posOffset", {}, [txt("0")]),
      ]),
    );
    const image = asImage(readDocxContent(pkg).sections[0]?.blocks[1]);
    expect(image.floatPosition).toBeUndefined();
  });
});
