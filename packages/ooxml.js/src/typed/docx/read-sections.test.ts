import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import type { ContentBlock, ContentParagraph } from "document-schema.js";
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

function sectionOnlyPackage(sectPr: XmlElement): Package {
  const body = el("w:body", {}, [sectPr]);
  return {
    parts: {
      "word/document.xml": {
        kind: "xml",
        nodes: [el("w:document", {}, [body])],
      },
      "word/_rels/document.xml.rels": { kind: "xml", nodes: [rels([])] },
    },
  };
}

describe("readDocxContent: comments, footnotes, header and footer parts", () => {
  it("reads comment author and text from word/comments.xml", () => {
    const pkg = buildFixturePackage();
    pkg.parts["word/comments.xml"] = {
      kind: "xml",
      nodes: [
        el("w:comments", {}, [
          el("w:comment", { "w:author": "Ann" }, [
            el("w:p", {}, [
              el("w:r", {}, [el("w:t", {}, [txt("comment text")])]),
            ]),
          ]),
        ]),
      ],
    };
    const doc = readDocxContent(pkg);
    expect(doc.comments).toHaveLength(1);
    expect(doc.comments[0]?.author).toBe("Ann");
    expect(doc.comments[0]?.text).toBe("comment text");
  });

  it("reads footnotes and skips separator and continuation marks", () => {
    const pkg = buildFixturePackage();
    pkg.parts["word/footnotes.xml"] = {
      kind: "xml",
      nodes: [
        el("w:footnotes", {}, [
          el("w:footnote", { "w:id": "-1", "w:type": "separator" }, [
            el("w:p", {}, [el("w:r", {}, [el("w:t")])]),
          ]),
          el("w:footnote", { "w:id": "1" }, [
            el("w:p", {}, [
              el("w:r", {}, [el("w:t", {}, [txt("real footnote")])]),
            ]),
          ]),
        ]),
      ],
    };
    const doc = readDocxContent(pkg);
    expect(doc.footnotes).toHaveLength(1);
    expect(doc.footnotes[0]?.text).toBe("real footnote");
    expect(doc.footnotes[0]?.type).toBeUndefined();
  });

  it("reads each header and footer part as block flow", () => {
    const pkg = buildFixturePackage();
    pkg.parts["word/header1.xml"] = {
      kind: "xml",
      nodes: [
        el("w:hdr", {}, [
          el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("Header text")])])]),
        ]),
      ],
    };
    pkg.parts["word/footer1.xml"] = {
      kind: "xml",
      nodes: [
        el("w:ftr", {}, [
          el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("Footer text")])])]),
        ]),
      ],
    };
    const doc = readDocxContent(pkg);
    // buildFixturePackage's docDefaults ask for 20 half-points and its Normal style resolves minorHAnsi against the empty theme's own minor-font name, so the part blocks' runs carry the resolved cascade.
    expect(doc.headerFooterParts).toEqual([
      {
        path: "word/footer1.xml",
        kind: "footer",
        blocks: [
          {
            kind: "paragraph",
            runs: [
              { text: "Footer text", fontFamily: "Minor Font", sizePt: 10 },
            ],
          },
        ],
      },
      {
        path: "word/header1.xml",
        kind: "header",
        blocks: [
          {
            kind: "paragraph",
            runs: [
              { text: "Header text", fontFamily: "Minor Font", sizePt: 10 },
            ],
          },
        ],
      },
    ]);
  });

  it("leaves comments/footnotes/header-footer parts empty when their parts are absent", () => {
    const doc = readDocxContent(buildFixturePackage());
    expect(doc.comments).toEqual([]);
    expect(doc.footnotes).toEqual([]);
    expect(doc.endnotes).toEqual([]);
    expect(doc.headerFooterParts).toEqual([]);
  });
});

describe("readDocxContent: header/footer structure", () => {
  const HEADER_REL =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header";
  const FOOTER_REL =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer";

  function headerFooterPackage(): Package {
    const firstSectionBreak = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:sectPr", {}, [
          el("w:headerReference", {
            "w:type": "default",
            "r:id": "rIdHeader1",
          }),
          el("w:footerReference", { "w:type": "even", "r:id": "rIdFooter1" }),
          el("w:pgSz", { "w:w": "11906", "w:h": "16838" }),
        ]),
      ]),
    ]);
    const finalSectPr = el("w:sectPr", {}, [
      el("w:headerReference", { "w:type": "default", "r:id": "rIdHeader1" }),
      el("w:headerReference", { "w:type": "first", "r:id": "rIdHeader2" }),
      el("w:pgSz", { "w:w": "12240", "w:h": "15840" }),
    ]);
    const body = el("w:body", {}, [
      firstSectionBreak,
      el("w:p", {}, [textRun("Second section")]),
      finalSectPr,
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
              { id: "rIdHeader1", type: HEADER_REL, target: "header1.xml" },
              { id: "rIdHeader2", type: HEADER_REL, target: "header2.xml" },
              { id: "rIdFooter1", type: FOOTER_REL, target: "footer1.xml" },
            ]),
          ],
        },
        "word/header1.xml": {
          kind: "xml",
          nodes: [
            el("w:hdr", {}, [
              el("w:p", {}, [textRun("Running header")]),
              el("w:p", {}, [textRun("Second line")]),
            ]),
          ],
        },
        "word/header2.xml": {
          kind: "xml",
          nodes: [
            el("w:hdr", {}, [el("w:p", {}, [textRun("First-page header")])]),
          ],
        },
        "word/footer1.xml": {
          kind: "xml",
          nodes: [
            el("w:ftr", {}, [el("w:p", {}, [textRun("Even-page footer")])]),
          ],
        },
      },
    };
  }

  it("reads each referenced header/footer part as block flow, walked by the same block machinery as the body", () => {
    const doc = readDocxContent(headerFooterPackage());
    expect(doc.headerFooterParts).toEqual([
      {
        path: "word/footer1.xml",
        kind: "footer",
        blocks: [{ kind: "paragraph", runs: [{ text: "Even-page footer" }] }],
      },
      {
        path: "word/header1.xml",
        kind: "header",
        blocks: [
          { kind: "paragraph", runs: [{ text: "Running header" }] },
          { kind: "paragraph", runs: [{ text: "Second line" }] },
        ],
      },
      {
        path: "word/header2.xml",
        kind: "header",
        blocks: [{ kind: "paragraph", runs: [{ text: "First-page header" }] }],
      },
    ]);
  });

  it("reads an unreferenced header/footer part too, not only parts a section names", () => {
    const pkg = headerFooterPackage();
    pkg.parts["word/header9.xml"] = {
      kind: "xml",
      nodes: [el("w:hdr", {}, [el("w:p", {}, [textRun("Orphan header")])])],
    };
    const doc = readDocxContent(pkg);
    expect(doc.headerFooterParts.map((part) => part.path)).toEqual([
      "word/footer1.xml",
      "word/header1.xml",
      "word/header2.xml",
      "word/header9.xml",
    ]);
    // The orphan joins no section's references — sectionHeaderFooters keeps spelling exactly what the sections spell.
    expect(doc.sectionHeaderFooters).toEqual([
      {
        header: { default: "word/header1.xml" },
        footer: { even: "word/footer1.xml" },
      },
      { header: { default: "word/header1.xml", first: "word/header2.xml" } },
    ]);
  });

  it("records which section references which part at which slot, keeping the odd/even/first distinction, with a shared part named once by both sections", () => {
    const doc = readDocxContent(headerFooterPackage());
    expect(doc.sectionHeaderFooters).toEqual([
      {
        header: { default: "word/header1.xml" },
        footer: { even: "word/footer1.xml" },
      },
      { header: { default: "word/header1.xml", first: "word/header2.xml" } },
    ]);
  });
});

// A single-section, sectPr-only body: readSections closes the one implicit section entirely from that sectPr, with no paragraphs at all, so readPageSize/readMargins' own fallback branches are exercised in isolation from every other section-level concern.
describe("readDocxContent: page size and margin fallbacks", () => {
  it("falls back to the Letter default page size when w:pgSz is entirely absent", () => {
    const doc = readDocxContent(sectionOnlyPackage(el("w:sectPr", {}, [])));
    expect(doc.sections[0]?.pageSize).toEqual({ widthPt: 612, heightPt: 792 });
  });

  it("falls back to the Letter default page size when w:pgSz carries only @w:w or only @w:h", () => {
    const widthOnly = readDocxContent(
      sectionOnlyPackage(
        el("w:sectPr", {}, [el("w:pgSz", { "w:w": "11906" })]),
      ),
    );
    expect(widthOnly.sections[0]?.pageSize).toEqual({
      widthPt: 612,
      heightPt: 792,
    });
    const heightOnly = readDocxContent(
      sectionOnlyPackage(
        el("w:sectPr", {}, [el("w:pgSz", { "w:h": "16838" })]),
      ),
    );
    expect(heightOnly.sections[0]?.pageSize).toEqual({
      widthPt: 612,
      heightPt: 792,
    });
  });

  it("falls back to the default 1in margins entirely when the section carries no w:pgMar at all", () => {
    const doc = readDocxContent(sectionOnlyPackage(el("w:sectPr", {}, [])));
    expect(doc.sections[0]?.margins).toEqual({
      topPt: 72,
      rightPt: 72,
      bottomPt: 72,
      leftPt: 72,
    });
  });

  it("fills in only the edges w:pgMar omits, converting whichever edges it does spell", () => {
    const doc = readDocxContent(
      sectionOnlyPackage(
        el("w:sectPr", {}, [
          el("w:pgMar", { "w:top": "2880", "w:left": "720" }),
        ]),
      ),
    );
    expect(doc.sections[0]?.margins).toEqual({
      topPt: 144,
      rightPt: 72,
      bottomPt: 72,
      leftPt: 36,
    });
  });

  it("recognises every w:sectPr/w:type value, not just continuous", () => {
    for (const val of ["nextPage", "evenPage", "oddPage"] as const) {
      const doc = readDocxContent(
        sectionOnlyPackage(
          el("w:sectPr", {}, [el("w:type", { "w:val": val })]),
        ),
      );
      expect(doc.sections[0]?.breakType).toBe(val);
    }
  });

  it("leaves breakType absent for an unrecognised w:type value", () => {
    const doc = readDocxContent(
      sectionOnlyPackage(
        el("w:sectPr", {}, [el("w:type", { "w:val": "nonsense" })]),
      ),
    );
    expect(doc.sections[0]?.breakType).toBeUndefined();
  });
});

describe("readDocxContent: w:pageBreakBefore toggle values", () => {
  function pageBreakBeforeDoc(val: string | undefined) {
    const pPrChildren =
      val === undefined
        ? [el("w:pageBreakBefore")]
        : [el("w:pageBreakBefore", { "w:val": val })];
    const paragraph = el("w:p", {}, [
      el("w:pPr", {}, pPrChildren),
      textRun("text"),
    ]);
    return readDocxContent(paragraphPackage(paragraph));
  }

  it("treats w:val of 0, false, or off as explicitly disabling the page break", () => {
    for (const val of ["0", "false", "off"]) {
      expect(pageBreakBeforeDoc(val).sections[0]?.blocks[0]?.kind).toBe(
        "paragraph",
      );
    }
  });

  it("treats any other w:val as enabling the page break, same as an absent @w:val", () => {
    expect(pageBreakBeforeDoc("1").sections[0]?.blocks[0]?.kind).toBe(
      "pageBreak",
    );
    expect(pageBreakBeforeDoc(undefined).sections[0]?.blocks[0]?.kind).toBe(
      "pageBreak",
    );
  });
});

describe("readDocxContent: list membership edge cases", () => {
  it("leaves list undefined when w:numPr carries no w:numId", () => {
    const paragraph = el("w:p", {}, [
      el("w:pPr", {}, [el("w:numPr", {}, [el("w:ilvl", { "w:val": "0" })])]),
      textRun("no numId"),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(firstParagraph(doc).list).toBeUndefined();
  });

  it("defaults level to 0 when w:numPr carries a w:numId but no w:ilvl", () => {
    const paragraph = el("w:p", {}, [
      el("w:pPr", {}, [el("w:numPr", {}, [el("w:numId", { "w:val": "5" })])]),
      textRun("top-level item"),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(firstParagraph(doc).list).toEqual({ numId: "5", level: 0 });
  });
});

describe("readDocxContent: findRunPageBreakOffset's own accounting for w:tab/w:br/w:cr/w:delText", () => {
  it("counts a preceding w:tab as one character when locating a mid-run page break", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("a")]),
        el("w:tab"),
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("after")]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(asParagraph(blocks[0]).runs.map((r) => r.text)).toEqual(["a\t"]);
    expect(blocks[1]?.kind).toBe("pageBreak");
    expect(asParagraph(blocks[2]).runs.map((r) => r.text)).toEqual(["after"]);
  });

  it("counts a preceding non-page w:br and a preceding w:cr as one character each when locating a mid-run page break", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("a")]),
        el("w:br"),
        el("w:cr"),
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("after")]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(asParagraph(blocks[0]).runs.map((r) => r.text)).toEqual(["a\n\n"]);
    expect(blocks[1]?.kind).toBe("pageBreak");
    expect(asParagraph(blocks[2]).runs.map((r) => r.text)).toEqual(["after"]);
  });

  it("counts a preceding w:delText's own length when locating a mid-run page break inside a wholly deleted paragraph", () => {
    const paragraph = el("w:del", { "w:id": "9" }, [
      el("w:p", {}, [
        el("w:r", {}, [
          el("w:delText", { "xml:space": "preserve" }, [txt("gone")]),
          el("w:br", { "w:type": "page" }),
          el("w:delText", { "xml:space": "preserve" }, [txt("more")]),
        ]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(asParagraph(blocks[1]).runs.map((r) => r.text)).toEqual(["gone"]);
    expect(blocks[2]?.kind).toBe("pageBreak");
    expect(asParagraph(blocks[3]).runs.map((r) => r.text)).toEqual(["more"]);
  });
});
