import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentConstructStart,
  ContentParagraph,
  ContentTable,
} from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { readDocxContent } from "./read";
const HYPERLINK_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const THEME_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";
const IMAGE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
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

function asTable(block: ContentBlock | undefined): ContentTable {
  if (block?.kind !== "table") {
    throw new Error("expected a table block");
  }
  return block;
}

function buildFixturePackage(): Package {
  const docDefaultsRPr = el("w:rPr", {}, [el("w:sz", { "w:val": "20" })]);
  const normalStyle = el(
    "w:style",
    { "w:type": "paragraph", "w:styleId": "Normal", "w:default": "1" },
    [el("w:rPr", {}, [el("w:rFonts", { "w:asciiTheme": "minorHAnsi" })])],
  );
  const heading1Style = el(
    "w:style",
    { "w:type": "paragraph", "w:styleId": "Heading1" },
    [
      el("w:basedOn", { "w:val": "Normal" }),
      el("w:rPr", {}, [el("w:b"), el("w:sz", { "w:val": "36" })]),
    ],
  );
  const styles = el("w:styles", {}, [
    el("w:docDefaults", {}, [el("w:rPrDefault", {}, [docDefaultsRPr])]),
    normalStyle,
    heading1Style,
  ]);

  const titlePara = el("w:p", {}, [
    el("w:pPr", {}, [el("w:pStyle", { "w:val": "Heading1" })]),
    el("w:r", {}, [el("w:t", {}, [txt("Title")])]),
  ]);

  const pageBreakPara = el("w:p", {}, [
    el("w:pPr", {}, [el("w:pageBreakBefore")]),
    el("w:r", {}, [el("w:t", {}, [txt("After a page break")])]),
  ]);

  const hyperlinkPara = el("w:p", {}, [
    el("w:hyperlink", { "r:id": "rIdHlink" }, [
      el("w:r", {}, [el("w:t", {}, [txt("link text")])]),
    ]),
  ]);

  const fieldPara = el("w:p", {}, [
    el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "begin" })]),
    el("w:r", {}, [el("w:instrText", {}, [txt(" PAGE ")])]),
    el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "separate" })]),
    el("w:r", {}, [el("w:t", {}, [txt("1")])]),
    el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "end" })]),
  ]);

  const insertedPara = el("w:ins", { "w:id": "1" }, [
    el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("Inserted")])])]),
  ]);
  const deletedPara = el("w:del", { "w:id": "2" }, [
    el("w:p", {}, [el("w:r", {}, [el("w:delText", {}, [txt("Deleted")])])]),
  ]);

  const sdtPara = el("w:sdt", {}, [
    el("w:sdtContent", {}, [
      el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("Content control")])])]),
    ]),
  ]);

  const altContent = el("mc:AlternateContent", {}, [
    el("mc:Choice", { Requires: "wps" }, [
      el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("Choice")])])]),
    ]),
    el("mc:Fallback", {}, [
      el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("Fallback")])])]),
    ]),
  ]);

  const listPara = el("w:p", {}, [
    el("w:pPr", {}, [
      el("w:numPr", {}, [
        el("w:ilvl", { "w:val": "1" }),
        el("w:numId", { "w:val": "5" }),
      ]),
    ]),
    el("w:r", {}, [el("w:t", {}, [txt("List item")])]),
  ]);

  const tabBreakPara = el("w:p", {}, [
    el("w:r", {}, [
      el("w:t", {}, [txt("a")]),
      el("w:tab"),
      el("w:t", {}, [txt("b")]),
      el("w:br"),
      el("w:t", {}, [txt("c")]),
    ]),
  ]);

  const mergedCellBorders = el("w:tcBorders", {}, [
    el("w:top", { "w:val": "single", "w:sz": "8", "w:color": "00FF00" }),
    el("w:left", { "w:val": "nil" }),
    el("w:bottom", { "w:val": "dashed", "w:color": "auto" }),
  ]);
  const mergedCell = el("w:tc", {}, [
    el("w:tcPr", {}, [
      el("w:gridSpan", { "w:val": "2" }),
      el("w:shd", { "w:fill": "FF0000" }),
      mergedCellBorders,
    ]),
    el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("Merged")])])]),
  ]);
  const vMergeAnchor = el("w:tc", {}, [
    el("w:tcPr", {}, [el("w:vMerge", { "w:val": "restart" })]),
    el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("Top")])])]),
  ]);
  const vMergeContinuation1 = el("w:tc", {}, [
    el("w:tcPr", {}, [el("w:vMerge")]),
    el("w:p"),
  ]);
  const vMergeContinuation2 = el("w:tc", {}, [
    el("w:tcPr", {}, [el("w:vMerge")]),
    el("w:p"),
  ]);
  const table = el("w:tbl", {}, [
    el("w:tblGrid", {}, [
      el("w:gridCol", { "w:w": "2880" }),
      el("w:gridCol", { "w:w": "2880" }),
    ]),
    el("w:tr", {}, [mergedCell]),
    el("w:tr", {}, [
      vMergeAnchor,
      el("w:tc", {}, [
        el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("Right1")])])]),
      ]),
    ]),
    el("w:tr", {}, [
      vMergeContinuation1,
      el("w:tc", {}, [
        el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("Right2")])])]),
      ]),
    ]),
    el("w:tr", {}, [
      vMergeContinuation2,
      el("w:tc", {}, [
        el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("Right3")])])]),
      ]),
    ]),
  ]);

  const sectionBreakPara = el("w:p", {}, [
    el("w:pPr", {}, [
      el("w:sectPr", {}, [
        el("w:type", { "w:val": "continuous" }),
        el("w:pgSz", { "w:w": "11906", "w:h": "16838" }),
        el("w:pgMar", {
          "w:top": "1440",
          "w:right": "1440",
          "w:bottom": "1440",
          "w:left": "1440",
        }),
      ]),
    ]),
  ]);
  const secondSectionPara = el("w:p", {}, [
    el("w:r", {}, [el("w:t", {}, [txt("Second section")])]),
  ]);
  const inlineImagePara = el("w:p", {}, [
    el("w:r", {}, [
      drawingElement("wp:inline", "rIdInlineImage", "Inline alt text"),
    ]),
  ]);
  const floatingImagePara = el("w:p", {}, [
    el("w:r", {}, [
      drawingElement("wp:anchor", "rIdFloatingImage", "Floating alt text"),
    ]),
  ]);
  const finalSectPr = el("w:sectPr", {}, [
    el("w:pgSz", { "w:w": "12240", "w:h": "15840" }),
    el("w:pgMar", {
      "w:top": "720",
      "w:right": "720",
      "w:bottom": "720",
      "w:left": "720",
    }),
  ]);

  const body = el("w:body", {}, [
    titlePara,
    pageBreakPara,
    hyperlinkPara,
    fieldPara,
    insertedPara,
    deletedPara,
    sdtPara,
    altContent,
    listPara,
    tabBreakPara,
    table,
    sectionBreakPara,
    secondSectionPara,
    inlineImagePara,
    floatingImagePara,
    finalSectPr,
  ]);
  const document = el("w:document", {}, [body]);

  const theme = el("a:theme", {}, [
    el("a:themeElements", {}, [
      el("a:fontScheme", {}, [
        el("a:majorFont", {}, [el("a:latin", { typeface: "Major Font" })]),
        el("a:minorFont", {}, [el("a:latin", { typeface: "Minor Font" })]),
      ]),
    ]),
  ]);

  const documentRels = rels([
    {
      id: "rIdHlink",
      type: HYPERLINK_REL,
      target: "https://example.com",
      external: true,
    },
    { id: "rIdTheme", type: THEME_REL, target: "theme/theme1.xml" },
    { id: "rIdInlineImage", type: IMAGE_REL, target: "media/image1.png" },
    { id: "rIdFloatingImage", type: IMAGE_REL, target: "media/image2.png" },
  ]);

  const core = el("cp:coreProperties", {}, [
    el("dc:title", {}, [txt("Fixture Document")]),
  ]);

  const numbering = el("w:numbering", {}, [
    el("w:abstractNum", { "w:abstractNumId": "0" }, [
      el("w:lvl", { "w:ilvl": "0" }, [
        el("w:start", { "w:val": "1" }),
        el("w:numFmt", { "w:val": "decimal" }),
        el("w:lvlText", { "w:val": "%1." }),
      ]),
      el("w:lvl", { "w:ilvl": "1" }, [
        el("w:start", { "w:val": "1" }),
        el("w:numFmt", { "w:val": "lowerRoman" }),
        el("w:lvlText", { "w:val": "%2)" }),
      ]),
    ]),
    el("w:num", { "w:numId": "5" }, [el("w:abstractNumId", { "w:val": "0" })]),
  ]);

  return {
    parts: {
      "word/document.xml": { kind: "xml", nodes: [document] },
      "word/_rels/document.xml.rels": { kind: "xml", nodes: [documentRels] },
      "word/styles.xml": { kind: "xml", nodes: [styles] },
      "word/theme/theme1.xml": { kind: "xml", nodes: [theme] },
      "word/numbering.xml": { kind: "xml", nodes: [numbering] },
      "docProps/core.xml": { kind: "xml", nodes: [core] },
      "word/media/image1.png": { kind: "binary", base64: TINY_PNG_BASE64 },
      "word/media/image2.png": { kind: "binary", base64: TINY_PNG_BASE64 },
    },
  };
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

describe("readDocxContent: block-level bookmarks, duplicate ids, and out-of-order halves", () => {
  function flowDoc(children: readonly XmlElement[]) {
    const body = el("w:body", {}, [
      ...children,
      el("w:sectPr", {}, [el("w:pgSz", { "w:w": "12240", "w:h": "15840" })]),
    ]);
    return readDocxContent({
      parts: {
        "word/document.xml": {
          kind: "xml",
          nodes: [el("w:document", {}, [body])],
        },
      },
    });
  }

  it("brackets a whole block-level bookmark with a name, and drops one with no @w:name at all", () => {
    const doc = flowDoc([
      el("w:bookmarkStart", { "w:id": "1", "w:name": "Target" }),
      el("w:p", {}, [textRun("Bookmarked paragraph")]),
      el("w:bookmarkEnd", { "w:id": "1" }),
      el("w:bookmarkStart", { "w:id": "2" }),
      el("w:p", {}, [textRun("Unnamed bookmark paragraph")]),
      el("w:bookmarkEnd", { "w:id": "2" }),
    ]);
    expect(asConstructStart(doc.sections[0]?.blocks[0]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "Target",
    });
    expect(doc.sections[0]?.blocks[2]?.kind).toBe("constructEnd");
    expect(asParagraph(doc.sections[0]?.blocks[3]).runs[0]?.text).toBe(
      "Unnamed bookmark paragraph",
    );
    // constructStart for the named bookmark, its paragraph, the matching constructEnd, then the unnamed bookmark's own paragraph — an unnamed w:bookmarkStart/End pair opens no construct block of its own.
    const EXPECTED_BLOCK_COUNT = 4;
    expect(doc.sections[0]?.blocks).toHaveLength(EXPECTED_BLOCK_COUNT);
  });

  it("drops a range marker pair with a duplicate id (two starts sharing one id)", () => {
    const doc = flowDoc([
      el("w:bookmarkStart", { "w:id": "1", "w:name": "First" }),
      el("w:bookmarkStart", { "w:id": "1", "w:name": "Duplicate" }),
      el("w:p", {}, [textRun("Ambiguous")]),
      el("w:bookmarkEnd", { "w:id": "1" }),
    ]);
    expect(
      doc.sections[0]?.blocks.every((b) => b.kind !== "constructStart"),
    ).toBe(true);
  });

  it("drops a comment range whose end sits before its start in document order", () => {
    const doc = flowDoc([
      el("w:p", {}, [textRun("Before")]),
      el("w:commentRangeEnd", { "w:id": "7" }),
      el("w:p", {}, [textRun("Between")]),
      el("w:commentRangeStart", { "w:id": "7" }),
      el("w:p", {}, [textRun("After")]),
    ]);
    expect(
      doc.sections[0]?.blocks.every((b) => b.kind !== "constructStart"),
    ).toBe(true);
  });
});

describe("readDocxContent: paragraph-scoped bookmark markers", () => {
  it("brackets a whole paragraph in a bookmark marker pair when both halves sit inside it but outside its own runs", () => {
    const paragraph = el("w:p", {}, [
      el("w:bookmarkStart", { "w:id": "3", "w:name": "WholeParaBookmark" }),
      textRun("Bookmarked text"),
      el("w:bookmarkEnd", { "w:id": "3" }),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(asConstructStart(doc.sections[0]?.blocks[0]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "WholeParaBookmark",
    });
    expect(asParagraph(doc.sections[0]?.blocks[1]).runs[0]?.text).toBe(
      "Bookmarked text",
    );
    expect(doc.sections[0]?.blocks[2]?.kind).toBe("constructEnd");
  });
});

describe("readDocxContent: sections fallback for a document with no w:sectPr anywhere", () => {
  it("still produces one empty default section for a body with no content and no w:sectPr at all", () => {
    const body = el("w:body", {}, []);
    const doc = readDocxContent({
      parts: {
        "word/document.xml": {
          kind: "xml",
          nodes: [el("w:document", {}, [body])],
        },
      },
    });
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]?.blocks).toEqual([]);
    expect(doc.sections[0]?.pageSize).toEqual({ widthPt: 612, heightPt: 792 });
  });
});

describe("readDocxContent: comment/footnote optional id, author, and type fields", () => {
  it("carries a comment's own id and author when both are present, and omits id/author when absent", () => {
    const pkg = buildFixturePackage();
    pkg.parts["word/comments.xml"] = {
      kind: "xml",
      nodes: [
        el("w:comments", {}, [
          el("w:comment", { "w:id": "9", "w:author": "Reviewer" }, [
            el("w:p", {}, [textRun("with id")]),
          ]),
          el("w:comment", {}, [el("w:p", {}, [textRun("no id or author")])]),
        ]),
      ],
    };
    const doc = readDocxContent(pkg);
    expect(doc.comments[0]).toStrictEqual({
      id: "9",
      author: "Reviewer",
      text: "with id",
    });
    // toStrictEqual (not toEqual) so that a mutant which sets id/author to an explicit undefined, rather than leaving the key genuinely absent, is caught rather than treated as equivalent.
    expect(doc.comments[1]).toStrictEqual({ text: "no id or author" });
  });

  it("carries a footnote's own id, and its own w:type when present", () => {
    const pkg = buildFixturePackage();
    pkg.parts["word/footnotes.xml"] = {
      kind: "xml",
      nodes: [
        el("w:footnotes", {}, [
          el("w:footnote", { "w:id": "4", "w:type": "continuationNotice" }, [
            el("w:p", {}, [textRun("typed note")]),
          ]),
          el("w:footnote", {}, [el("w:p", {}, [textRun("no id or type")])]),
        ]),
      ],
    };
    const doc = readDocxContent(pkg);
    expect(doc.footnotes[0]).toStrictEqual({
      id: "4",
      type: "continuationNotice",
      text: "typed note",
    });
    expect(doc.footnotes[1]).toStrictEqual({ text: "no id or type" });
  });
});

describe("readDocxContent: header/footer reference edge cases", () => {
  it("skips a header reference whose @w:type is unrecognised, and one whose r:id does not resolve to a relationship", () => {
    const HEADER_REFERENCE_REL =
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header";
    const body = el("w:body", {}, [
      el("w:p", {}, [
        el("w:pPr", {}, [
          el("w:sectPr", {}, [
            el("w:headerReference", { "w:type": "bogus", "r:id": "rIdA" }),
            el("w:headerReference", {
              "w:type": "default",
              "r:id": "rIdMissing",
            }),
            el("w:pgSz", { "w:w": "12240", "w:h": "15840" }),
          ]),
        ]),
      ]),
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
              { id: "rIdA", type: HEADER_REFERENCE_REL, target: "header1.xml" },
            ]),
          ],
        },
      },
    };
    const doc = readDocxContent(pkg);
    expect(doc.sectionHeaderFooters[0]?.header).toBeUndefined();
  });
});

describe("readDocxContent: word/document.xml missing w:body", () => {
  it("throws with the part path named in the message", () => {
    const pkg: Package = {
      parts: {
        "word/document.xml": {
          kind: "xml",
          nodes: [el("w:document", {}, [])],
        },
      },
    };
    expect(() => readDocxContent(pkg)).toThrow(
      "readDocxContent: word/document.xml has no w:body element",
    );
  });
});

describe("readDocxContent: construct re-indexing after a page-break split with a non-zero offset", () => {
  it("re-indexes a construct after the split run correctly when the split run's own after-half is empty", () => {
    const paragraph = el("w:p", {}, [
      textRun("lead run"),
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("before")]),
        el("w:br", { "w:type": "page" }),
      ]),
      el("w:bookmarkStart", { "w:id": "9", "w:name": "afterEmpty" }),
      textRun("bookmarked"),
      el("w:bookmarkEnd", { "w:id": "9" }),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    const after = asParagraph(blocks[2]);
    expect(after.runs.map((r) => r.text)).toEqual(["bookmarked"]);
    expect(after.constructs).toEqual([
      {
        descriptor: {
          kind: "anchor",
          anchorType: "bookmark",
          name: "afterEmpty",
        },
        startRun: 0,
        endRun: 1,
      },
    ]);
  });
});

describe("readDocxContent: cell/paragraph borders with the surrounding property element present but no border element at all", () => {
  it("leaves a cell's own borders undefined when w:tcPr is present but carries no w:tcBorders", () => {
    const table = el("w:tbl", {}, [
      el("w:tblGrid", {}, [el("w:gridCol", { "w:w": "1440" })]),
      el("w:tr", {}, [
        el("w:tc", {}, [
          el("w:tcPr", {}, [el("w:shd", { "w:fill": "00FF00" })]),
          el("w:p", {}, [textRun("cell")]),
        ]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(table));
    expect(
      asTable(doc.sections[0]?.blocks[0]).rows[0]?.cells[0]?.borders,
    ).toBeUndefined();
  });
});
