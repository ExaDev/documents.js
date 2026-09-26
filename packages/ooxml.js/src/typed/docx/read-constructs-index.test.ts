import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentConstructStart,
  ContentImageBlock,
  ContentParagraph,
} from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { bytesToBase64 } from "byte-codec";
import { minimalXlsxBytes } from "../../test-support/embedded";
import { readDocxContent } from "./read";
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

function asParagraph(block: ContentBlock | undefined): ContentParagraph {
  if (block?.kind !== "paragraph") {
    throw new Error("expected a paragraph block");
  }
  return block;
}

// The two construct-boundary markers have no sourcePath field at all (a boundary is not content), so reading one off an unnarrowed ContentBlock no longer type-checks — this narrows past them for the assertions below, which only ever look at real content blocks.
function asConstructStart(
  block: ContentBlock | undefined,
): ContentConstructStart {
  if (block?.kind !== "constructStart") {
    throw new Error("expected a constructStart marker");
  }
  return block;
}

function paragraphPackage(
  paragraph: XmlElement,
  extraParts: Package["parts"] = {},
): Package {
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
      "word/_rels/document.xml.rels": { kind: "xml", nodes: [rels([])] },
      ...extraParts,
    },
  };
}

function textRun(text: string): XmlElement {
  return el("w:r", {}, [el("w:t", { "xml:space": "preserve" }, [txt(text)])]);
}

function firstParagraph(
  doc: ReturnType<typeof readDocxContent>,
): ContentParagraph {
  return asParagraph(doc.sections[0]?.blocks[0]);
}

function asImage(block: ContentBlock | undefined): ContentImageBlock {
  if (block?.kind !== "image") {
    throw new Error("expected an image block");
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

describe("readDocxContent: per-edge margin fallbacks for top and left", () => {
  function sectPrDoc(sectPr: XmlElement): Package {
    const body = el("w:body", {}, [
      el("w:p", {}, [textRun("Margins")]),
      sectPr,
    ]);
    return {
      parts: {
        "word/document.xml": {
          kind: "xml",
          nodes: [el("w:document", {}, [body])],
        },
      },
    };
  }

  it("defaults the top and left margins to one inch when w:pgMar omits them while spelling right and bottom", () => {
    const doc = readDocxContent(
      sectPrDoc(
        el("w:sectPr", {}, [
          el("w:pgSz", { "w:w": "12240", "w:h": "15840" }),
          el("w:pgMar", { "w:right": "720", "w:bottom": "1440" }),
        ]),
      ),
    );
    expect(doc.sections[0]?.margins).toEqual({
      topPt: 72,
      rightPt: 36,
      bottomPt: 72,
      leftPt: 72,
    });
  });
});

describe("readDocxContent: page-break split offset accounting", () => {
  it("does not count a run-properties child toward the split offset of a mid-run page break", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:rPr", {}, [el("w:b", {})]),
        el("w:t", { "xml:space": "preserve" }, [txt("abcd")]),
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("ef")]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(asParagraph(blocks[0]).runs.map((r) => r.text)).toEqual(["abcd"]);
    expect(blocks[1]?.kind).toBe("pageBreak");
    expect(asParagraph(blocks[2]).runs.map((r) => r.text)).toEqual(["ef"]);
  });

  it("splits at the paragraph's first page-type break when a later run carries one too", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("one")]),
        el("w:br", { "w:type": "page" }),
      ]),
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("two")]),
        el("w:br", { "w:type": "page" }),
      ]),
      textRun("three"),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    // Only the FIRST break splits the paragraph; the second stays a literal newline inside the after-half's own run text.
    expect(asParagraph(blocks[0]).runs.map((r) => r.text)).toEqual(["one"]);
    expect(blocks[1]?.kind).toBe("pageBreak");
    expect(asParagraph(blocks[2]).runs.map((r) => r.text)).toEqual([
      "two\n",
      "three",
    ]);
  });

  it("leaves a split paragraph's lifted image unanchored rather than naming a pre-split run index", () => {
    const paragraph = el("w:p", {}, [
      textRun("before"),
      el("w:r", {}, [el("w:br", { "w:type": "page" })]),
      el("w:r", {}, [drawingElement("wp:inline", "rIdImg", "Split alt text")]),
    ]);
    const parts: Package["parts"] = {
      "word/_rels/document.xml.rels": {
        kind: "xml",
        nodes: [
          rels([{ id: "rIdImg", type: IMAGE_REL, target: "media/image1.png" }]),
        ],
      },
      "word/media/image1.png": { kind: "binary", base64: TINY_PNG_BASE64 },
    };
    const doc = readDocxContent(paragraphPackage(paragraph, parts));
    const blocks = doc.sections[0]?.blocks ?? [];
    const image = asImage(blocks[3]);
    expect(image.altText).toBe("Split alt text");
    expect(image.anchorRunIndex).toBeUndefined();
    expect(image.anchorOffset).toBeUndefined();
  });
});

describe("readDocxContent: drawing geometry, alt text, and float-position edges", () => {
  function imageParts(): Package["parts"] {
    return {
      "word/_rels/document.xml.rels": {
        kind: "xml",
        nodes: [
          rels([{ id: "rIdImg", type: IMAGE_REL, target: "media/image1.png" }]),
        ],
      },
      "word/media/image1.png": { kind: "binary", base64: TINY_PNG_BASE64 },
    };
  }

  function positionAxes(): XmlElement[] {
    return [
      el("wp:positionH", { relativeFrom: "column" }, [
        el("wp:posOffset", {}, [txt("914400")]),
      ]),
      el("wp:positionV", { relativeFrom: "paragraph" }, [
        el("wp:posOffset", {}, [txt("457200")]),
      ]),
    ];
  }

  it("degrades a drawing whose wp:extent omits @w:cy to no image block", () => {
    const drawing = el("w:drawing", {}, [
      el("wp:inline", {}, [
        el("wp:extent", { cx: "914400" }),
        el("wp:docPr", { id: "1", name: "Picture 1" }),
        el("a:graphic", {}, [
          el("a:graphicData", { uri: PICTURE_GRAPHIC_URI }, [
            el("pic:pic", {}, [
              el("pic:blipFill", {}, [el("a:blip", { "r:embed": "rIdImg" })]),
            ]),
          ]),
        ]),
      ]),
    ]);
    const doc = readDocxContent(
      paragraphPackage(el("w:p", {}, [el("w:r", {}, [drawing])]), imageParts()),
    );
    expect(doc.sections[0]?.blocks).toHaveLength(1);
  });

  it("falls back to wp:docPr/@w:title for alt text when @w:descr is absent", () => {
    const drawing = el("w:drawing", {}, [
      el("wp:inline", {}, [
        el("wp:extent", { cx: "914400", cy: "457200" }),
        el("wp:docPr", { id: "1", name: "Picture 1", title: "The Title" }),
        el("a:graphic", {}, [
          el("a:graphicData", { uri: PICTURE_GRAPHIC_URI }, [
            el("pic:pic", {}, [
              el("pic:blipFill", {}, [el("a:blip", { "r:embed": "rIdImg" })]),
            ]),
          ]),
        ]),
      ]),
    ]);
    const doc = readDocxContent(
      paragraphPackage(el("w:p", {}, [el("w:r", {}, [drawing])]), imageParts()),
    );
    expect(asImage(doc.sections[0]?.blocks[1]).altText).toBe("The Title");
  });

  it("keeps an inline image unpositioned even when its markup carries wp:positionH/wp:positionV", () => {
    const inline = el("wp:inline", {}, [
      el("wp:extent", { cx: "914400", cy: "457200" }),
      el("wp:docPr", { id: "1", name: "Picture 1", descr: "Inline alt" }),
      ...positionAxes(),
      el("a:graphic", {}, [
        el("a:graphicData", { uri: PICTURE_GRAPHIC_URI }, [
          el("pic:pic", {}, [
            el("pic:blipFill", {}, [el("a:blip", { "r:embed": "rIdImg" })]),
          ]),
        ]),
      ]),
    ]);
    const doc = readDocxContent(
      paragraphPackage(
        el("w:p", {}, [el("w:r", {}, [el("w:drawing", {}, [inline])])]),
        imageParts(),
      ),
    );
    expect(asImage(doc.sections[0]?.blocks[1]).floatPosition).toBeUndefined();
  });

  it("omits the floatPosition field entirely for an anchored image with no position elements", () => {
    const anchor = el("wp:anchor", {}, [
      el("wp:extent", { cx: "914400", cy: "457200" }),
      el("wp:docPr", { id: "1", name: "Picture 1", descr: "Anchored alt" }),
      el("a:graphic", {}, [
        el("a:graphicData", { uri: PICTURE_GRAPHIC_URI }, [
          el("pic:pic", {}, [
            el("pic:blipFill", {}, [el("a:blip", { "r:embed": "rIdImg" })]),
          ]),
        ]),
      ]),
    ]);
    const doc = readDocxContent(
      paragraphPackage(
        el("w:p", {}, [el("w:r", {}, [el("w:drawing", {}, [anchor])])]),
        imageParts(),
      ),
    );
    const image = asImage(doc.sections[0]?.blocks[1]);
    expect("floatPosition" in image).toBe(false);
  });

  it("degrades a w:object missing @w:dxaOrig to no embedded block", () => {
    const pkg = oleObjectFixturePackage(
      { target: "embeddings/oleObject1.xlsx" },
      [],
    );
    const relsPart = pkg.parts["word/_rels/document.xml.rels"];
    if (relsPart?.kind !== "xml") {
      throw new Error("expected document rels");
    }
    const objectRun = el("w:r", {}, [
      el("w:object", { "w:dyaOrig": "1200" }, [
        el("o:OLEObject", { "r:id": "rIdOle" }),
      ]),
    ]);
    pkg.parts["word/embeddings/oleObject1.xlsx"] = {
      kind: "binary",
      base64: bytesToBase64(minimalXlsxBytes()),
    };
    const body = el("w:body", {}, [
      el("w:p", {}, [objectRun, textRun("after")]),
      el("w:sectPr", {}, [el("w:pgSz", { "w:w": "12240", "w:h": "15840" })]),
    ]);
    pkg.parts["word/document.xml"] = {
      kind: "xml",
      nodes: [el("w:document", {}, [body])],
    };
    const doc = readDocxContent(pkg);
    expect(doc.sections[0]?.blocks).toHaveLength(1);
    // The object's own run still emits (empty text — a w:object contributes no run text), but no embedded block follows it.
    expect(
      asParagraph(doc.sections[0]?.blocks[0]).runs.map((r) => r.text),
    ).toEqual(["", "after"]);
  });
});

describe("readDocxContent: lifted-element collection guards", () => {
  function liftingParts(): Package["parts"] {
    return {
      "word/_rels/document.xml.rels": {
        kind: "xml",
        nodes: [
          rels([
            { id: "rIdImg", type: IMAGE_REL, target: "media/image1.png" },
            { id: "rIdImg2", type: IMAGE_REL, target: "media/image2.png" },
          ]),
        ],
      },
      "word/media/image1.png": { kind: "binary", base64: TINY_PNG_BASE64 },
      "word/media/image2.png": { kind: "binary", base64: TINY_PNG_BASE64 },
    };
  }

  function nestedDrawingElement(rId: string, altText: string): XmlElement {
    return el("w:drawing", {}, [
      el("wp:inline", {}, [
        el("wp:extent", { cx: "914400", cy: "457200" }),
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

  it("does not lift a drawing out of a tracked deletion that is not carried", () => {
    const paragraph = el("w:p", {}, [
      el(
        "w:del",
        { "w:id": "1", "w:author": "Ed", "w:date": "2024-01-01T00:00:00Z" },
        [el("w:r", {}, [nestedDrawingElement("rIdImg", "deleted alt")])],
      ),
      textRun("kept"),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph, liftingParts()));
    expect(doc.sections[0]?.blocks).toHaveLength(1);
    expect(
      asParagraph(doc.sections[0]?.blocks[0]).runs.map((r) => r.text),
    ).toEqual(["kept"]);
  });

  it("does not lift a drawing out of a tracked move-from that is not carried", () => {
    const paragraph = el("w:p", {}, [
      el(
        "w:moveFrom",
        { "w:id": "1", "w:author": "Ed", "w:date": "2024-01-01T00:00:00Z" },
        [el("w:r", {}, [nestedDrawingElement("rIdImg", "moved alt")])],
      ),
      textRun("kept"),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph, liftingParts()));
    expect(doc.sections[0]?.blocks).toHaveLength(1);
    expect(
      asParagraph(doc.sections[0]?.blocks[0]).runs.map((r) => r.text),
    ).toEqual(["kept"]);
  });

  it("lifts a drawing once even when its graphic data carries an alternate-content nested drawing", () => {
    const outer = el("w:drawing", {}, [
      el("wp:inline", {}, [
        el("wp:extent", { cx: "914400", cy: "457200" }),
        el("wp:docPr", { id: "1", name: "Picture 1", descr: "outer alt" }),
        el("a:graphic", {}, [
          el("a:graphicData", { uri: PICTURE_GRAPHIC_URI }, [
            el("mc:AlternateContent", {}, [
              el("mc:Choice", {}, [
                nestedDrawingElement("rIdImg2", "nested alt"),
              ]),
            ]),
            el("pic:pic", {}, [
              el("pic:blipFill", {}, [el("a:blip", { "r:embed": "rIdImg" })]),
            ]),
          ]),
        ]),
      ]),
    ]);
    const doc = readDocxContent(
      paragraphPackage(el("w:p", {}, [el("w:r", {}, [outer])]), liftingParts()),
    );
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    expect(asImage(blocks[1]).altText).toBe("outer alt");
  });
});

describe("readDocxContent: run-walk anchor and link guard edges", () => {
  it("ignores a w:id attribute on a run child that is not a reference mark", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("tab run")]),
        el("w:tab", { "w:id": "7" }),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(firstParagraph(doc).constructs).toBeUndefined();
  });

  it("records no link extent for a hyperlink with neither a resolvable target nor an anchor", () => {
    const paragraph = el("w:p", {}, [
      el("w:hyperlink", {}, [textRun("orphan link text")]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(firstParagraph(doc).constructs).toBeUndefined();
  });

  it("records no link extent for an anchored hyperlink that emitted no runs", () => {
    const paragraph = el("w:p", {}, [
      textRun("before"),
      el("w:hyperlink", { "w:anchor": "missing" }, [el("w:ins", {}, [])]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(firstParagraph(doc).constructs).toBeUndefined();
  });

  it("ignores a permission start beside a comment range start rather than pairing it as the range's end half", () => {
    const paragraph = el("w:p", {}, [
      el("w:commentRangeStart", { "w:id": "4" }),
      textRun("annotated"),
      el("w:permStart", { "w:id": "4" }),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(firstParagraph(doc).constructs).toBeUndefined();
    expect(
      doc.sections[0]?.blocks.every((b) => b.kind !== "constructStart"),
    ).toBe(true);
  });

  it("leaves a plain run without its own hyperlink field", () => {
    const doc = readDocxContent(
      paragraphPackage(el("w:p", {}, [textRun("plain")])),
    );
    expect(Object.hasOwn(firstParagraph(doc).runs[0]!, "hyperlink")).toBe(
      false,
    );
  });
});

describe("readDocxContent: block-scoped field qualification against non-content siblings", () => {
  function complexFieldRuns(instruction: string): XmlElement[] {
    return [
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "begin" })]),
      el("w:r", {}, [
        el("w:instrText", { "xml:space": "preserve" }, [txt(instruction)]),
      ]),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "end" })]),
    ];
  }

  it("keeps a whole-paragraph field off the paragraph's constructs when a proofErr precedes it", () => {
    const paragraph = el("w:p", {}, [
      el("w:proofErr", { "w:type": "spellStart" }),
      ...complexFieldRuns(" X "),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    // The begin run is the first CONTENT child (a proofErr is not content), so the field is block-scoped: a construct marker pair, never a second run-level encoding.
    expect(asParagraph(doc.sections[0]?.blocks[1]).constructs).toBeUndefined();
    expect(asConstructStart(doc.sections[0]?.blocks[0]).descriptor).toEqual({
      kind: "field",
      instruction: " X ",
    });
    expect(doc.sections[0]?.blocks[2]?.kind).toBe("constructEnd");
  });

  it("keeps a whole-paragraph field off the paragraph's constructs when a proofErr follows it", () => {
    const paragraph = el("w:p", {}, [
      ...complexFieldRuns(" Y "),
      el("w:proofErr", { "w:type": "spellEnd" }),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(asParagraph(doc.sections[0]?.blocks[1]).constructs).toBeUndefined();
    expect(asConstructStart(doc.sections[0]?.blocks[0]).descriptor).toEqual({
      kind: "field",
      instruction: " Y ",
    });
  });

  it("keeps a bookmark-flanked simple field off the paragraph's constructs while bracketing the paragraph", () => {
    const paragraph = el("w:p", {}, [
      el("w:bookmarkStart", { "w:id": "11", "w:name": "Flank" }),
      el("w:fldSimple", { "w:instr": " DATE " }, [textRun("1 Jan")]),
      el("w:bookmarkEnd", { "w:id": "11" }),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(asParagraph(doc.sections[0]?.blocks[2]).constructs).toBeUndefined();
    // The bookmark's halves sit outside the field (the paragraph's only content child), so the bookmark opens first and the field nests inside it.
    expect(asConstructStart(doc.sections[0]?.blocks[0]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "Flank",
    });
    expect(asConstructStart(doc.sections[0]?.blocks[1]).descriptor).toEqual({
      kind: "field",
      instruction: " DATE ",
    });
    expect(asParagraph(doc.sections[0]?.blocks[2]).runs[0]?.text).toBe("1 Jan");
    expect(doc.sections[0]?.blocks[3]?.kind).toBe("constructEnd");
    expect(doc.sections[0]?.blocks[4]?.kind).toBe("constructEnd");
  });

  it("emits a simple field followed by text as a run extent, not a block construct", () => {
    const paragraph = el("w:p", {}, [
      el("w:fldSimple", { "w:instr": " DATE " }, [textRun("1 Jan")]),
      textRun(" trailing"),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(
      doc.sections[0]?.blocks.every((b) => b.kind !== "constructStart"),
    ).toBe(true);
    expect(firstParagraph(doc).constructs).toEqual([
      {
        descriptor: { kind: "field", instruction: " DATE " },
        startRun: 0,
        endRun: 1,
      },
    ]);
  });

  it("reads a mid-paragraph simple field with no @w:instr as an empty instruction", () => {
    const paragraph = el("w:p", {}, [
      textRun("lead"),
      el("w:fldSimple", {}, [textRun("cached")]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(firstParagraph(doc).constructs).toEqual([
      {
        descriptor: { kind: "field", instruction: "" },
        startRun: 1,
        endRun: 2,
      },
    ]);
  });

  it("brackets a whole-paragraph simple field with no @w:instr as an empty-instruction construct", () => {
    const paragraph = el("w:p", {}, [
      el("w:fldSimple", {}, [textRun("cached")]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(asConstructStart(doc.sections[0]?.blocks[0]).descriptor).toEqual({
      kind: "field",
      instruction: "",
    });
  });
});

describe("readDocxContent: section-crossing construct extents", () => {
  it("drops a bookmark crossing a section break without eating the bookmark wholly inside the later section", () => {
    const body = el("w:body", {}, [
      el("w:bookmarkStart", { "w:id": "1", "w:name": "Wide" }),
      el("w:p", {}, [
        el("w:pPr", {}, [
          el("w:sectPr", {}, [
            el("w:pgSz", { "w:w": "12240", "w:h": "15840" }),
          ]),
        ]),
        textRun("first"),
      ]),
      el("w:bookmarkStart", { "w:id": "2", "w:name": "Inner" }),
      el("w:p", {}, [textRun("second")]),
      el("w:bookmarkEnd", { "w:id": "1" }),
      el("w:p", {}, [textRun("third")]),
      el("w:bookmarkEnd", { "w:id": "2" }),
      el("w:sectPr", {}, [el("w:pgSz", { "w:w": "12240", "w:h": "15840" })]),
    ]);
    const doc = readDocxContent({
      parts: {
        "word/document.xml": {
          kind: "xml",
          nodes: [el("w:document", {}, [body])],
        },
      },
    });
    expect(doc.sections).toHaveLength(2);
    // The wide bookmark's start must not leak into the first section either: its extent crosses the break, so no marker at all.
    expect(
      (doc.sections[0]?.blocks ?? []).every((b) => b.kind !== "constructStart"),
    ).toBe(true);
    const second = doc.sections[1]?.blocks ?? [];
    expect(asConstructStart(second[0]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "Inner",
    });
    expect(asParagraph(second[1]).runs[0]?.text).toBe("second");
    expect(asParagraph(second[2]).runs[0]?.text).toBe("third");
    expect(second[3]?.kind).toBe("constructEnd");
  });
});
