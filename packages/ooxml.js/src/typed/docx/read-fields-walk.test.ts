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

describe("readDocxContent: paragraph-scoped comment markers and empty-paragraph bookmark edges", () => {
  it("brackets a whole paragraph in a comment marker pair when both halves sit inside it but outside its runs", () => {
    const paragraph = el("w:p", {}, [
      el("w:commentRangeStart", { "w:id": "31" }),
      textRun("Annotated"),
      el("w:commentRangeEnd", { "w:id": "31" }),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(asConstructStart(doc.sections[0]?.blocks[0]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "comment",
      name: "31",
    });
    expect(asParagraph(doc.sections[0]?.blocks[1]).runs[0]?.text).toBe(
      "Annotated",
    );
    expect(doc.sections[0]?.blocks[2]?.kind).toBe("constructEnd");
  });

  it("wraps an otherwise-empty paragraph in its own bookmark pair rather than pinning it to a point", () => {
    const paragraph = el("w:p", {}, [
      el("w:bookmarkStart", { "w:id": "41", "w:name": "Empty" }),
      el("w:bookmarkEnd", { "w:id": "41" }),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    // The bookmark's constructStart, the (empty) paragraph it wraps, and the matching constructEnd.
    const EXPECTED_BLOCK_COUNT = 3;
    expect(blocks).toHaveLength(EXPECTED_BLOCK_COUNT);
    expect(asConstructStart(blocks[0]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "Empty",
    });
    expect(asParagraph(blocks[1]).runs).toEqual([]);
    expect(blocks[2]?.kind).toBe("constructEnd");
  });
});

describe("readDocxContent: theme resolution order and part-level joins", () => {
  it("resolves the theme from the relationship whose type ends in /theme even when an earlier relationship targets an existing xml part", () => {
    const styles = el("w:styles", {}, [
      el("w:docDefaults", {}, [
        el("w:rPrDefault", {}, [
          el("w:rPr", {}, [el("w:rFonts", { "w:asciiTheme": "minorHAnsi" })]),
        ]),
      ]),
    ]);
    const theme = el("a:theme", {}, [
      el("a:themeElements", {}, [
        el("a:fontScheme", {}, [
          el("a:minorFont", {}, [el("a:latin", { typeface: "Minor Font" })]),
        ]),
      ]),
    ]);
    const body = el("w:body", {}, [
      el("w:p", {}, [textRun("themed")]),
      el("w:sectPr", {}, [el("w:pgSz", { "w:w": "12240", "w:h": "15840" })]),
    ]);
    const doc = readDocxContent({
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
                id: "rIdStyles",
                type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
                target: "styles.xml",
              },
              { id: "rIdTheme", type: THEME_REL, target: "theme/theme1.xml" },
            ]),
          ],
        },
        "word/styles.xml": { kind: "xml", nodes: [styles] },
        "word/theme/theme1.xml": { kind: "xml", nodes: [theme] },
      },
    });
    expect(firstParagraph(doc).runs[0]?.fontFamily).toBe("Minor Font");
  });

  it("joins a comment's several text runs with no separator", () => {
    const pkg = buildFixturePackage();
    pkg.parts["word/comments.xml"] = {
      kind: "xml",
      nodes: [
        el("w:comments", {}, [
          el("w:comment", { "w:id": "5", "w:author": "Ann" }, [
            el("w:p", {}, [
              el("w:r", {}, [el("w:t", {}, [txt("first ")])]),
              el("w:r", {}, [el("w:t", {}, [txt("second")])]),
            ]),
          ]),
        ]),
      ],
    };
    const doc = readDocxContent(pkg);
    expect(doc.comments[0]?.text).toBe("first second");
  });

  it("joins a footnote's several text runs with no separator", () => {
    const pkg = buildFixturePackage();
    pkg.parts["word/footnotes.xml"] = {
      kind: "xml",
      nodes: [
        el("w:footnotes", {}, [
          el("w:footnote", { "w:id": "3" }, [
            el("w:p", {}, [
              el("w:r", {}, [el("w:t", {}, [txt("note ")])]),
              el("w:r", {}, [el("w:t", {}, [txt("tail")])]),
            ]),
          ]),
        ]),
      ],
    };
    const doc = readDocxContent(pkg);
    expect(doc.footnotes[0]?.text).toBe("note tail");
  });

  it("skips a header-shaped part whose path does not end in .xml", () => {
    const pkg = buildFixturePackage();
    pkg.parts["word/header1"] = {
      kind: "xml",
      nodes: [el("w:hdr", {}, [el("w:p", {}, [textRun("Extensionless")])])],
    };
    const doc = readDocxContent(pkg);
    expect(
      doc.headerFooterParts.every((part) => part.path !== "word/header1"),
    ).toBe(true);
  });

  it("drops a header part's run-level tracked deletion rather than carrying its content", () => {
    const pkg = buildFixturePackage();
    pkg.parts["word/header2.xml"] = {
      kind: "xml",
      nodes: [
        el("w:hdr", {}, [
          el("w:p", {}, [
            textRun("Kept"),
            el(
              "w:del",
              {
                "w:id": "1",
                "w:author": "Ed",
                "w:date": "2024-01-01T00:00:00Z",
              },
              [el("w:r", {}, [el("w:delText", {}, [txt("Deleted")])])],
            ),
          ]),
        ]),
      ],
    };
    const doc = readDocxContent(pkg);
    const header = doc.headerFooterParts.find(
      (part) => part.path === "word/header2.xml",
    );
    expect(
      header?.blocks.map((b) =>
        b.kind === "paragraph" ? b.runs.map((r) => r.text) : b.kind,
      ),
    ).toEqual([["Kept"]]);
  });
});

describe("readDocxContent: lifted-image anchor offsets across tab, break, and deleted-text children", () => {
  function offsetParts(): Package["parts"] {
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

  function anchorOf(
    doc: ReturnType<typeof readDocxContent>,
  ): ContentImageBlock {
    return asImage(doc.sections[0]?.blocks[1]);
  }

  it("counts a tab before an image in the same run as one character of offset", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("ab")]),
        el("w:tab"),
        drawingElement("wp:inline", "rIdImg", "tab alt"),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph, offsetParts()));
    expect(anchorOf(doc).anchorRunIndex).toBe(0);
    // "ab" (2 characters) plus the tab counted as one character of offset.
    const ANCHOR_OFFSET_AFTER_AB_PLUS_CONTROL_CHAR = 3;
    expect(anchorOf(doc).anchorOffset).toBe(
      ANCHOR_OFFSET_AFTER_AB_PLUS_CONTROL_CHAR,
    );
  });

  it("counts a line break before an image in the same run as one character of offset", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("ab")]),
        el("w:br"),
        drawingElement("wp:inline", "rIdImg", "br alt"),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph, offsetParts()));
    expect(anchorOf(doc).anchorRunIndex).toBe(0);
    // "ab" (2 characters) plus the line break counted as one character of offset.
    const ANCHOR_OFFSET_AFTER_AB_PLUS_CONTROL_CHAR = 3;
    expect(anchorOf(doc).anchorOffset).toBe(
      ANCHOR_OFFSET_AFTER_AB_PLUS_CONTROL_CHAR,
    );
  });

  it("counts a carriage return before an image in the same run as one character of offset", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("ab")]),
        el("w:cr"),
        drawingElement("wp:inline", "rIdImg", "cr alt"),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph, offsetParts()));
    expect(anchorOf(doc).anchorRunIndex).toBe(0);
    // "ab" (2 characters) plus the carriage return counted as one character of offset.
    const ANCHOR_OFFSET_AFTER_AB_PLUS_CONTROL_CHAR = 3;
    expect(anchorOf(doc).anchorOffset).toBe(
      ANCHOR_OFFSET_AFTER_AB_PLUS_CONTROL_CHAR,
    );
  });

  it("counts deleted text before an image inside a carried deletion", () => {
    const deleted = el(
      "w:del",
      { "w:id": "1", "w:author": "Ed", "w:date": "2024-01-01T00:00:00Z" },
      [
        el("w:p", {}, [
          el("w:r", {}, [
            el("w:delText", { "xml:space": "preserve" }, [txt("xy")]),
            drawingElement("wp:inline", "rIdImg", "deleted alt"),
          ]),
        ]),
      ],
    );
    const doc = readDocxContent(paragraphPackage(deleted, offsetParts()));
    // The flow-level w:del brackets its paragraph with provenance markers, so the image is located rather than assumed at a fixed index.
    const image = (doc.sections[0]?.blocks ?? []).find(
      (b) => b.kind === "image",
    );
    expect(image).toBeDefined();
    if (image?.kind !== "image") {
      throw new Error("expected an image block");
    }
    expect(image.anchorRunIndex).toBe(0);
    expect(image.anchorOffset).toBe(2);
  });
});

describe("readDocxContent: run-walk guard edges for marker halves, reference ids, and anchor offsets", () => {
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

  it("keeps a mid-paragraph comment range's run extent when a permission start shares its id", () => {
    const paragraph = el("w:p", {}, [
      textRun("lead"),
      el("w:commentRangeStart", { "w:id": "7" }),
      el("w:permStart", { "w:id": "7" }),
      textRun("annotated"),
      el("w:commentRangeEnd", { "w:id": "7" }),
      textRun("tail"),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(firstParagraph(doc).constructs).toEqual([
      {
        descriptor: { kind: "anchor", anchorType: "comment", name: "7" },
        startRun: 1,
        endRun: 2,
      },
    ]);
  });

  it("records no point anchor for a footnote reference carrying no @w:id", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [el("w:footnoteReference", {})]),
      textRun("after"),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(firstParagraph(doc).constructs).toBeUndefined();
  });

  it("does not count a run-properties child toward a lifted image's anchor offset", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:rPr", {}, [el("w:b", {})]),
        el("w:t", { "xml:space": "preserve" }, [txt("ab")]),
        drawingElement("wp:inline", "rIdImg", "rPr alt"),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph, imageParts()));
    const image = asImage(doc.sections[0]?.blocks[1]);
    expect(image.anchorRunIndex).toBe(0);
    expect(image.anchorOffset).toBe(2);
  });
});

describe("readDocxContent: flow-level tracked-change carry and stray body children", () => {
  const ED = {
    "w:id": "1",
    "w:author": "Ed",
    "w:date": "2024-01-01T00:00:00Z",
  };

  function flowDoc(
    children: readonly XmlElement[],
  ): ReturnType<typeof readDocxContent> {
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

  it("carries a nested run-level deletion inside a flow-level w:del", () => {
    const doc = flowDoc([
      el("w:del", { ...ED, "w:id": "1" }, [
        el("w:p", {}, [
          textRun("kept"),
          el("w:del", { ...ED, "w:id": "2" }, [
            el("w:r", {}, [el("w:delText", {}, [txt("gone")])]),
          ]),
        ]),
      ]),
    ]);
    expect(
      asParagraph(doc.sections[0]?.blocks[1]).runs.map((r) => r.text),
    ).toEqual(["kept", "gone"]);
  });

  it("drops a nested run-level deletion inside a flow-level w:ins", () => {
    const doc = flowDoc([
      el("w:ins", { ...ED, "w:id": "3" }, [
        el("w:p", {}, [
          textRun("kept"),
          el("w:del", { ...ED, "w:id": "4" }, [
            el("w:r", {}, [el("w:delText", {}, [txt("gone")])]),
          ]),
        ]),
      ]),
    ]);
    expect(
      asParagraph(doc.sections[0]?.blocks[1]).runs.map((r) => r.text),
    ).toEqual(["kept"]);
  });

  it("unwraps an alternate-content block whose only branch is a Choice", () => {
    const doc = flowDoc([
      el("mc:AlternateContent", {}, [
        el("mc:Choice", { Requires: "wps" }, [
          el("w:p", {}, [textRun("chosen")]),
        ]),
      ]),
    ]);
    expect(asParagraph(doc.sections[0]?.blocks[0]).runs[0]?.text).toBe(
      "chosen",
    );
  });

  it("treats a stray body-level proofErr as content-less, never as a section break", () => {
    const doc = flowDoc([
      el("w:p", {}, [textRun("One")]),
      el("w:proofErr", { "w:type": "spellStart" }),
      el("w:p", {}, [textRun("Two")]),
    ]);
    expect(doc.sections).toHaveLength(1);
    expect(
      (doc.sections[0]?.blocks ?? []).map((b) =>
        b.kind === "paragraph" ? b.runs[0]?.text : b.kind,
      ),
    ).toEqual(["One", "Two"]);
  });
});
