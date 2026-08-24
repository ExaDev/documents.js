import type { Package } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";
import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentConstructStart,
  ContentEmbeddedObjectBlock,
  ContentImageBlock,
  ContentParagraph,
  ContentTable,
} from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { bytesToBase64 } from "../../util/base64";
import { zipPackage } from "../../zip";
import { oleObjectBin } from "../../test-support/cfb";
import {
  minimalDocxBytes,
  minimalPptxBytes,
  minimalXlsxBytes,
} from "../../test-support/embedded";
import { attr, childrenWithTag, elementsWithTag, rootElement } from "../util";
import { readDocxContent } from "./read";
import { buildDocxPackageFromContent } from "./write";

// Ported from documents.js's src/ooxml/docx/read.test.ts, adapted to readDocxContent's own DocxDocument shape (sections directly, not wrapped in a ContentDocument discriminated union) and merged with this package's comment/footnote/header/footer coverage.

const HYPERLINK_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const THEME_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";
const IMAGE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const OLE_OBJECT_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject";
const PICTURE_GRAPHIC_URI =
  "http://schemas.openxmlformats.org/drawingml/2006/picture";

// A genuine, minimal 1x1 transparent PNG -- real magic bytes, so sniffImageFormat actually recognises it, not a placeholder string.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// wp:inline and wp:anchor share the identical wp:extent/wp:docPr/a:graphic/a:graphicData/pic:pic/pic:blipFill/a:blip shape -- only the outer container tag (and, for wp:anchor, the positioning elements readDrawingImage deliberately never reads) differs.
function drawingElement(
  containerTag: "wp:inline" | "wp:anchor",
  rId: string,
  altText: string,
  extent: { cx: string; cy: string } = { cx: "914400", cy: "457200" },
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
  entries: { id: string; type: string; target: string; external?: boolean }[],
): XmlElement {
  return el(
    "Relationships",
    {},
    entries.map((e) =>
      el(
        "Relationship",
        e.external
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

// The two construct-boundary markers have no sourcePath field at all (a boundary is not content), so reading one off an unnarrowed ContentBlock no longer type-checks -- this narrows past them for the assertions below, which only ever look at real content blocks.
function sourcePathOf(block: ContentBlock | undefined): string | undefined {
  if (
    block === undefined ||
    block.kind === "constructStart" ||
    block.kind === "constructEnd"
  ) {
    return undefined;
  }
  return block.sourcePath;
}

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

describe("readDocxContent: metadata", () => {
  it("reads document metadata via readCoreProperties", () => {
    const doc = readDocxContent(buildFixturePackage());
    expect(doc.metadata.title).toBe("Fixture Document");
  });

  it("throws when the package has no word/document.xml", () => {
    expect(() => readDocxContent({ parts: {} })).toThrow(/word\/document\.xml/);
  });
});

describe("readDocxContent: style cascade", () => {
  it("resolves a named style through its basedOn chain, overriding docDefaults", () => {
    const doc = readDocxContent(buildFixturePackage());
    const title = asParagraph(doc.sections[0]?.blocks[0]);
    expect(title.styleId).toBe("Heading1");
    expect(title.runs[0]?.sizePt).toBe(18); // Heading1's own 36 half-points, overriding docDefaults' 20
    expect(title.runs[0]?.bold).toBe(true); // from Heading1
  });

  it("resolves a theme font reference from the default style", () => {
    const doc = readDocxContent(buildFixturePackage());
    // blocks: [0]=title [1]=pageBreak [2]=pageBreakPara [3]=hyperlinkPara [4]=the field's own constructStart [5]=fieldPara -- the field paragraph's run inherits Normal's asciiTheme reference (no style of its own).
    const fieldPara = asParagraph(doc.sections[0]?.blocks[5]);
    expect(fieldPara.runs[0]?.fontFamily).toBe("Minor Font");
  });
});

// A dedicated minimal fixture for heading-level resolution: a built-in Heading2 carrying its own w:outlineLvl, a custom style based on it (the case name-matching the styleId against /^Heading\d+$/ silently misses), a paragraph with a direct w:pPr/w:outlineLvl, one beyond the schema's six-level heading domain, and one with no outline level anywhere in its cascade.
function buildHeadingFixturePackage(): Package {
  const normalStyle = el(
    "w:style",
    { "w:type": "paragraph", "w:styleId": "Normal", "w:default": "1" },
    [],
  );
  const heading2Style = el(
    "w:style",
    { "w:type": "paragraph", "w:styleId": "Heading2" },
    [
      el("w:basedOn", { "w:val": "Normal" }),
      el("w:pPr", {}, [el("w:outlineLvl", { "w:val": "1" })]),
    ],
  );
  const customSectionStyle = el(
    "w:style",
    { "w:type": "paragraph", "w:styleId": "CustomSection" },
    [el("w:basedOn", { "w:val": "Heading2" })],
  );
  const styles = el("w:styles", {}, [
    normalStyle,
    heading2Style,
    customSectionStyle,
  ]);

  const builtInHeadingPara = el("w:p", {}, [
    el("w:pPr", {}, [el("w:pStyle", { "w:val": "Heading2" })]),
    el("w:r", {}, [el("w:t", {}, [txt("Built-in heading")])]),
  ]);
  const customSectionPara = el("w:p", {}, [
    el("w:pPr", {}, [el("w:pStyle", { "w:val": "CustomSection" })]),
    el("w:r", {}, [el("w:t", {}, [txt("Custom section heading")])]),
  ]);
  const directOutlinePara = el("w:p", {}, [
    el("w:pPr", {}, [el("w:outlineLvl", { "w:val": "0" })]),
    el("w:r", {}, [el("w:t", {}, [txt("Direct outline level")])]),
  ]);
  const beyondDomainPara = el("w:p", {}, [
    el("w:pPr", {}, [el("w:outlineLvl", { "w:val": "8" })]),
    el("w:r", {}, [el("w:t", {}, [txt("Word level 9")])]),
  ]);
  const bodyPara = el("w:p", {}, [
    el("w:r", {}, [el("w:t", {}, [txt("Body text")])]),
  ]);

  const body = el("w:body", {}, [
    builtInHeadingPara,
    customSectionPara,
    directOutlinePara,
    beyondDomainPara,
    bodyPara,
    el("w:sectPr", {}, [el("w:pgSz", { "w:w": "12240", "w:h": "15840" })]),
  ]);
  return {
    parts: {
      "word/document.xml": {
        kind: "xml",
        nodes: [el("w:document", {}, [body])],
      },
      "word/styles.xml": { kind: "xml", nodes: [styles] },
    },
  };
}

describe("readDocxContent: heading levels", () => {
  it("resolves headingLevel from the style's own w:outlineLvl (0-based, +1), not by name-matching the styleId", () => {
    const doc = readDocxContent(buildHeadingFixturePackage());
    const builtIn = asParagraph(doc.sections[0]?.blocks[0]);
    expect(builtIn.styleId).toBe("Heading2");
    expect(builtIn.headingLevel).toBe(2);
  });

  it("a custom style based on a built-in heading resolves its level through w:basedOn while keeping its own styleId", () => {
    const doc = readDocxContent(buildHeadingFixturePackage());
    const custom = asParagraph(doc.sections[0]?.blocks[1]);
    expect(custom.styleId).toBe("CustomSection");
    expect(custom.headingLevel).toBe(2);
  });

  it("a direct w:pPr/w:outlineLvl populates headingLevel without any named style", () => {
    const doc = readDocxContent(buildHeadingFixturePackage());
    expect(asParagraph(doc.sections[0]?.blocks[2]).headingLevel).toBe(1);
  });

  it("narrows Word outline levels beyond six onto the schema heading domain's top level", () => {
    const doc = readDocxContent(buildHeadingFixturePackage());
    expect(asParagraph(doc.sections[0]?.blocks[3]).headingLevel).toBe(6);
  });

  it("leaves headingLevel undefined for a paragraph with no outline level anywhere in its cascade", () => {
    const doc = readDocxContent(buildHeadingFixturePackage());
    expect(
      asParagraph(doc.sections[0]?.blocks[4]).headingLevel,
    ).toBeUndefined();
  });
});

describe("readDocxContent: page breaks", () => {
  it("inserts a pageBreak block before a paragraph with w:pageBreakBefore", () => {
    const doc = readDocxContent(buildFixturePackage());
    expect(doc.sections[0]?.blocks[1]?.kind).toBe("pageBreak");
    expect(asParagraph(doc.sections[0]?.blocks[2]).runs[0]?.text).toBe(
      "After a page break",
    );
  });
});

describe("readDocxContent: hyperlinks", () => {
  it("resolves a hyperlink run's external target", () => {
    const doc = readDocxContent(buildFixturePackage());
    const hyperlinkPara = asParagraph(doc.sections[0]?.blocks[3]);
    expect(hyperlinkPara.runs[0]?.hyperlink).toBe("https://example.com");
  });

  it("decodes a relationship target's XML entities, so the hyperlink is the URI rather than its encoding", () => {
    const pkg = buildFixturePackage();
    pkg.parts["word/_rels/document.xml.rels"] = {
      kind: "xml",
      nodes: [
        el("Relationships", {}, [
          el("Relationship", {
            Id: "rIdHlink",
            Type: HYPERLINK_REL,
            Target: "https://example.com/search?a=1&amp;b=2",
            TargetMode: "External",
          }),
        ]),
      ],
    };
    const doc = readDocxContent(pkg);
    expect(asParagraph(doc.sections[0]?.blocks[3]).runs[0]?.hyperlink).toBe(
      "https://example.com/search?a=1&b=2",
    );
  });
});

describe("readDocxContent: fields", () => {
  it("keeps only the cached result text between fldChar separate and end, dropping the field code", () => {
    const doc = readDocxContent(buildFixturePackage());
    const fieldPara = asParagraph(doc.sections[0]?.blocks[5]);
    expect(fieldPara.runs).toHaveLength(1);
    expect(fieldPara.runs[0]?.text).toBe("1");
  });

  it("brackets a whole-paragraph complex field in a field construct carrying its instruction verbatim", () => {
    const doc = readDocxContent(buildFixturePackage());
    expect(asConstructStart(doc.sections[0]?.blocks[4]).descriptor).toEqual({
      kind: "field",
      instruction: " PAGE ",
    });
    expect(doc.sections[0]?.blocks[6]?.kind).toBe("constructEnd");
  });
});

describe("readDocxContent: tracked changes", () => {
  it("includes content wrapped in w:ins, bracketed by an insertion provenance construct", () => {
    const doc = readDocxContent(buildFixturePackage());
    expect(asConstructStart(doc.sections[0]?.blocks[7]).descriptor).toEqual({
      kind: "provenance",
      change: "insertion",
    });
    const inserted = asParagraph(doc.sections[0]?.blocks[8]);
    expect(inserted.runs[0]?.text).toBe("Inserted");
    expect(doc.sections[0]?.blocks[9]?.kind).toBe("constructEnd");
  });

  it("carries content wrapped in w:del as w:delText runs inside a deletion provenance construct", () => {
    const doc = readDocxContent(buildFixturePackage());
    expect(asConstructStart(doc.sections[0]?.blocks[10]).descriptor).toEqual({
      kind: "provenance",
      change: "deletion",
    });
    const deleted = asParagraph(doc.sections[0]?.blocks[11]);
    expect(deleted.runs[0]?.text).toBe("Deleted");
    expect(doc.sections[0]?.blocks[12]?.kind).toBe("constructEnd");
  });
});

describe("readDocxContent: content controls and alternate content", () => {
  it("recurses into w:sdt/w:sdtContent, bracketing the content in a contentControl construct", () => {
    const doc = readDocxContent(buildFixturePackage());
    expect(asConstructStart(doc.sections[0]?.blocks[13]).descriptor).toEqual({
      kind: "contentControl",
      controlType: "richText",
    });
    const sdtBlock = asParagraph(doc.sections[0]?.blocks[14]);
    expect(sdtBlock.runs[0]?.text).toBe("Content control");
    expect(doc.sections[0]?.blocks[15]?.kind).toBe("constructEnd");
  });

  it("prefers mc:Fallback over mc:Choice, without bracketing it as a construct", () => {
    const doc = readDocxContent(buildFixturePackage());
    const altBlock = asParagraph(doc.sections[0]?.blocks[16]);
    expect(altBlock.runs[0]?.text).toBe("Fallback");
  });
});

describe("readDocxContent: lists", () => {
  it("reads numId/level from w:numPr", () => {
    const doc = readDocxContent(buildFixturePackage());
    const listBlock = asParagraph(doc.sections[0]?.blocks[17]);
    expect(listBlock.list).toEqual({ numId: "5", level: 1 });
  });

  it("resolves that numId's own numbering definition from word/numbering.xml", () => {
    const doc = readDocxContent(buildFixturePackage());
    expect(doc.numbering["5"]?.levels["1"]).toEqual({
      format: "lowerRoman",
      text: "%2)",
      startAt: 1,
    });
    expect(doc.numbering["5"]?.levels["0"]).toEqual({
      format: "decimal",
      text: "%1.",
      startAt: 1,
    });
  });
});

describe("readDocxContent: run text with tab/break", () => {
  it("embeds w:tab as a literal tab and w:br as a literal newline within one run's text", () => {
    const doc = readDocxContent(buildFixturePackage());
    const tabBreakBlock = asParagraph(doc.sections[0]?.blocks[18]);
    expect(tabBreakBlock.runs[0]?.text).toBe("a\tb\nc");
  });
});

describe("readDocxContent: tables", () => {
  it("reads column widths and a horizontally-merged cell's colSpan and background", () => {
    const doc = readDocxContent(buildFixturePackage());
    const table = asTable(doc.sections[0]?.blocks[19]);
    expect(table.columnWidthsPt).toEqual([144, 144]);
    expect(table.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(table.rows[0]?.cells[0]?.background).toEqual({ r: 1, g: 0, b: 0 });
  });

  it("reads w:tcBorders into the cell's own borders, mapping style keywords and eighth-point widths, skipping a nil edge and resolving an auto colour to black", () => {
    const doc = readDocxContent(buildFixturePackage());
    const table = asTable(doc.sections[0]?.blocks[19]);
    const borders = table.rows[0]?.cells[0]?.borders;
    expect(borders?.top).toEqual({
      color: { r: 0, g: 1, b: 0 },
      widthPt: 1,
      style: "solid",
    });
    expect(borders?.left).toBeUndefined();
    expect(borders?.bottom).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 0.5,
      style: "dashed",
    });
    expect(borders?.right).toBeUndefined();
  });

  it("computes a vMerge anchor's rowSpan by scanning subsequent continuation rows, leaving them empty", () => {
    const doc = readDocxContent(buildFixturePackage());
    const table = asTable(doc.sections[0]?.blocks[19]);
    expect(table.rows[1]?.cells[0]?.rowSpan).toBe(3);
    expect(table.rows[2]?.cells[0]?.blocks).toEqual([]);
    expect(table.rows[3]?.cells[0]?.blocks).toEqual([]);
    expect(asParagraph(table.rows[1]?.cells[1]?.blocks[0]).runs[0]?.text).toBe(
      "Right1",
    );
  });

  it("reads w:trPr/w:trHeight@w:val (twips) into the row's own heightPt", () => {
    const tableEl = el("w:tbl", {}, [
      el("w:tblGrid", {}, [el("w:gridCol", { "w:w": "2880" })]),
      el("w:tr", {}, [
        el("w:trPr", {}, [el("w:trHeight", { "w:val": "560" })]),
        el("w:tc", {}, [
          el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("cell")])])]),
        ]),
      ]),
    ]);
    const body = el("w:body", {}, [
      tableEl,
      el("w:sectPr", {}, [el("w:pgSz", { "w:w": "12240", "w:h": "15840" })]),
    ]);
    const document = el("w:document", {}, [body]);
    const pkg: Package = {
      parts: { "word/document.xml": { kind: "xml", nodes: [document] } },
    };
    const doc = readDocxContent(pkg);
    const table = asTable(doc.sections[0]?.blocks[0]);
    expect(table.rows[0]?.heightPt).toBeCloseTo(28, 5); // 560 twips / 20 = 28 pt
  });
});

describe("readDocxContent: sourcePath", () => {
  it("assigns sections[N].blocks[N] and sections[N].blocks[N].runs[N] in document order", () => {
    const doc = readDocxContent(buildFixturePackage());
    const title = asParagraph(doc.sections[0]?.blocks[0]);
    expect(title.sourcePath).toBe("sections[0].blocks[0]");
    expect(title.runs[0]?.sourcePath).toBe("sections[0].blocks[0].runs[0]");
    expect(sourcePathOf(doc.sections[0]?.blocks[1])).toBe(
      "sections[0].blocks[1]",
    ); // the pageBreak block
    const secondSection = asParagraph(doc.sections[1]?.blocks[0]);
    expect(secondSection.sourcePath).toBe("sections[1].blocks[0]");
    expect(secondSection.runs[0]?.sourcePath).toBe(
      "sections[1].blocks[0].runs[0]",
    );
  });

  it("assigns a multi-run paragraph's runs their own zero-based index", () => {
    const doc = readDocxContent(buildFixturePackage());
    const tabBreakBlock = asParagraph(doc.sections[0]?.blocks[18]);
    expect(tabBreakBlock.sourcePath).toBe("sections[0].blocks[18]");
    expect(tabBreakBlock.runs[0]?.sourcePath).toBe(
      "sections[0].blocks[18].runs[0]",
    );
  });

  it("nests a table cell's own blocks under sections[N].blocks[N].rows[N].cells[N].blocks[N]", () => {
    const doc = readDocxContent(buildFixturePackage());
    const table = asTable(doc.sections[0]?.blocks[19]);
    expect(table.sourcePath).toBe("sections[0].blocks[19]");
    const mergedCell = asParagraph(table.rows[0]?.cells[0]?.blocks[0]);
    expect(mergedCell.sourcePath).toBe(
      "sections[0].blocks[19].rows[0].cells[0].blocks[0]",
    );
    expect(mergedCell.runs[0]?.sourcePath).toBe(
      "sections[0].blocks[19].rows[0].cells[0].blocks[0].runs[0]",
    );
    const right1Cell = asParagraph(table.rows[1]?.cells[1]?.blocks[0]);
    expect(right1Cell.sourcePath).toBe(
      "sections[0].blocks[19].rows[1].cells[1].blocks[0]",
    );
  });
});

describe("readDocxContent: multi-section support", () => {
  it("starts a new section at a mid-document w:pPr/w:sectPr, with that section's own page size and margins", () => {
    const doc = readDocxContent(buildFixturePackage());
    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0]?.pageSize).toEqual({
      widthPt: 595.3,
      heightPt: 841.9,
    }); // A4, twips->pt
    expect(doc.sections[0]?.margins).toEqual({
      topPt: 72,
      rightPt: 72,
      bottomPt: 72,
      leftPt: 72,
    });
  });

  it("closes the final section with the body's own trailing w:sectPr", () => {
    const doc = readDocxContent(buildFixturePackage());
    expect(doc.sections[1]?.pageSize).toEqual({ widthPt: 612, heightPt: 792 }); // US Letter, twips->pt
    expect(doc.sections[1]?.margins).toEqual({
      topPt: 36,
      rightPt: 36,
      bottomPt: 36,
      leftPt: 36,
    });
    expect(asParagraph(doc.sections[1]?.blocks[0]).runs[0]?.text).toBe(
      "Second section",
    );
  });

  it("reads a section's own w:sectPr/w:type onto ContentSection.breakType, leaving it absent when the sectPr spells none", () => {
    const doc = readDocxContent(buildFixturePackage());
    expect(doc.sections[0]?.breakType).toBe("continuous");
    // The final section's body-level sectPr carries no w:type, and an absent w:type IS WordprocessingML's own default (nextPage), so the field stays absent rather than storing the default.
    expect(doc.sections[1]?.breakType).toBeUndefined();
  });
});

// One-paragraph documents for the run-level construct rows: each test spells the exact run-level markup it exercises (a mid-paragraph field, an internal hyperlink, a comment range, a note reference, a legacy form field), because what is under test is precisely where inside one paragraph's runs each construct's extent lands.
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

describe("readDocxContent: run-level construct extents (the #750 docx rows)", () => {
  it("emits a field run extent over a mid-paragraph complex field's result runs, keeping the instruction and dropping the code runs", () => {
    const paragraph = el("w:p", {}, [
      textRun("Page "),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "begin" })]),
      el("w:r", {}, [
        el("w:instrText", { "xml:space": "preserve" }, [txt(" NUMPAGES ")]),
      ]),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "separate" })]),
      textRun("10"),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "end" })]),
      textRun(" of pages"),
    ]);
    const paragraphRead = firstParagraph(
      readDocxContent(paragraphPackage(paragraph)),
    );
    expect(paragraphRead.runs.map((run) => run.text)).toEqual([
      "Page ",
      "10",
      " of pages",
    ]);
    expect(paragraphRead.constructs).toEqual([
      {
        descriptor: { kind: "field", instruction: " NUMPAGES " },
        startRun: 1,
        endRun: 2,
      },
    ]);
  });

  it("emits a field run extent over a mid-paragraph w:fldSimple's runs, carrying @w:instr as the instruction", () => {
    const paragraph = el("w:p", {}, [
      textRun("Today is "),
      el("w:fldSimple", { "w:instr": " DATE " }, [textRun("2026-08-20")]),
      textRun("."),
    ]);
    const paragraphRead = firstParagraph(
      readDocxContent(paragraphPackage(paragraph)),
    );
    expect(paragraphRead.runs.map((run) => run.text)).toEqual([
      "Today is ",
      "2026-08-20",
      ".",
    ]);
    expect(paragraphRead.constructs).toEqual([
      {
        descriptor: { kind: "field", instruction: " DATE " },
        startRun: 1,
        endRun: 2,
      },
    ]);
  });

  it("does not double-encode a field the block walk already bracketed: a whole-paragraph field keeps its marker pair and gains no run extent", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "begin" })]),
      el("w:r", {}, [
        el("w:instrText", { "xml:space": "preserve" }, [txt(" PAGE ")]),
      ]),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "separate" })]),
      textRun("3"),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "end" })]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(asConstructStart(doc.sections[0]?.blocks[0]).descriptor).toEqual({
      kind: "field",
      instruction: " PAGE ",
    });
    expect(asParagraph(doc.sections[0]?.blocks[1]).constructs).toBeUndefined();
  });

  it("emits a link run extent with an internal target for w:hyperlink/@w:anchor, leaving the runs' own hyperlink unset", () => {
    const paragraph = el("w:p", {}, [
      textRun("See "),
      el("w:hyperlink", { "w:anchor": "targetBookmark" }, [
        textRun("the section"),
        textRun(" below"),
      ]),
      textRun(" for details"),
    ]);
    const paragraphRead = firstParagraph(
      readDocxContent(paragraphPackage(paragraph)),
    );
    expect(paragraphRead.runs.map((run) => run.hyperlink)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(paragraphRead.constructs).toEqual([
      {
        descriptor: {
          kind: "link",
          target: { kind: "internal", anchor: "targetBookmark" },
        },
        startRun: 1,
        endRun: 3,
      },
    ]);
  });

  it("emits an anchor run extent for a mid-paragraph comment range, named by the comment's own w:id, and keeps the block marker pair for a range spanning whole blocks", () => {
    const midParagraph = el("w:p", {}, [
      textRun("Some "),
      el("w:commentRangeStart", { "w:id": "7" }),
      textRun("commented"),
      el("w:commentRangeEnd", { "w:id": "7" }),
      el("w:r", {}, [el("w:commentReference", { "w:id": "7" })]),
      textRun(" words"),
    ]);
    const mid = firstParagraph(readDocxContent(paragraphPackage(midParagraph)));
    // The reference run contributes an empty-text run at its own position, and the range extent covers exactly the commented runs.
    expect(mid.runs.map((run) => run.text)).toEqual([
      "Some ",
      "commented",
      "",
      " words",
    ]);
    expect(mid.constructs).toEqual([
      {
        descriptor: { kind: "anchor", anchorType: "comment", name: "7" },
        startRun: 1,
        endRun: 2,
      },
      {
        descriptor: { kind: "anchor", anchorType: "comment", name: "7" },
        startRun: 2,
        endRun: 2,
      },
    ]);

    const blockScoped = el("w:body", {}, [
      el("w:commentRangeStart", { "w:id": "7" }),
      el("w:p", {}, [textRun("Commented paragraph")]),
      el("w:commentRangeEnd", { "w:id": "7" }),
      el("w:p", {}, [textRun("After")]),
      el("w:sectPr", {}, [el("w:pgSz", { "w:w": "12240", "w:h": "15840" })]),
    ]);
    const doc = readDocxContent({
      parts: {
        "word/document.xml": {
          kind: "xml",
          nodes: [el("w:document", {}, [blockScoped])],
        },
      },
    });
    expect(asConstructStart(doc.sections[0]?.blocks[0]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "comment",
      name: "7",
    });
    expect(asParagraph(doc.sections[0]?.blocks[1]).constructs).toBeUndefined();
  });

  it("reads the comment's own w:id beside its text, so an extent's name joins back to its body", () => {
    const commentsPart = {
      kind: "xml",
      nodes: [
        el("w:comments", {}, [
          el("w:comment", { "w:id": "7", "w:author": "A Reviewer" }, [
            el("w:p", {}, [textRun("A remark")]),
          ]),
        ]),
      ],
    } satisfies Package["parts"][string];
    const paragraph = el("w:p", {}, [
      textRun("Text"),
      el("w:r", {}, [el("w:commentReference", { "w:id": "7" })]),
    ]);
    const doc = readDocxContent(
      paragraphPackage(paragraph, { "word/comments.xml": commentsPart }),
    );
    expect(doc.comments).toEqual([
      { id: "7", author: "A Reviewer", text: "A remark" },
    ]);
    expect(firstParagraph(doc).constructs).toEqual([
      {
        descriptor: { kind: "anchor", anchorType: "comment", name: "7" },
        startRun: 1,
        endRun: 1,
      },
    ]);
  });

  it("emits a point anchor at a footnote reference run, and reads the footnote's own w:id so the two join", () => {
    const footnotesPart = {
      kind: "xml",
      nodes: [
        el("w:footnotes", {}, [
          el("w:footnote", { "w:id": "2" }, [
            el("w:p", {}, [textRun("The note body")]),
          ]),
        ]),
      ],
    } satisfies Package["parts"][string];
    const paragraph = el("w:p", {}, [
      textRun("A claim"),
      el("w:r", {}, [el("w:footnoteReference", { "w:id": "2" })]),
    ]);
    const doc = readDocxContent(
      paragraphPackage(paragraph, { "word/footnotes.xml": footnotesPart }),
    );
    expect(doc.footnotes).toEqual([{ id: "2", text: "The note body" }]);
    expect(firstParagraph(doc).constructs).toEqual([
      {
        descriptor: { kind: "anchor", anchorType: "footnote", name: "2" },
        startRun: 1,
        endRun: 1,
      },
    ]);
  });

  it("emits a point anchor at an endnote reference run, and reads word/endnotes.xml with each note's own w:id", () => {
    const endnotesPart = {
      kind: "xml",
      nodes: [
        el("w:endnotes", {}, [
          el("w:endnote", { "w:id": "1" }, [
            el("w:p", {}, [textRun("The endnote body")]),
          ]),
        ]),
      ],
    } satisfies Package["parts"][string];
    const paragraph = el("w:p", {}, [
      textRun("A point"),
      el("w:r", {}, [el("w:endnoteReference", { "w:id": "1" })]),
    ]);
    const doc = readDocxContent(
      paragraphPackage(paragraph, { "word/endnotes.xml": endnotesPart }),
    );
    expect(doc.endnotes).toEqual([{ id: "1", text: "The endnote body" }]);
    expect(firstParagraph(doc).constructs).toEqual([
      {
        descriptor: { kind: "anchor", anchorType: "endnote", name: "1" },
        startRun: 1,
        endRun: 1,
      },
    ]);
  });
});

describe("readDocxContent: legacy w:ffData form fields", () => {
  function formFieldPackage(
    ffData: XmlElement,
    instruction: string,
    result: string,
  ): Package {
    const paragraph = el("w:p", {}, [
      textRun("Answer: "),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "begin" }), ffData]),
      el("w:r", {}, [
        el("w:instrText", { "xml:space": "preserve" }, [txt(instruction)]),
      ]),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "separate" })]),
      textRun(result),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "end" })]),
    ]);
    return paragraphPackage(paragraph);
  }

  it("reads a checkbox form field as a contentControl run extent carrying its checked state, with the ffData quarantined verbatim in the residue", () => {
    const ffData = el("w:ffData", {}, [
      el("w:name", { "w:val": "consentBox" }),
      el("w:checkBox", {}, [
        el("w:default", { "w:val": "0" }),
        el("w:checked", { "w:val": "1" }),
      ]),
    ]);
    const paragraphRead = firstParagraph(
      readDocxContent(formFieldPackage(ffData, " FORMCHECKBOX ", "Yes")),
    );
    // The form field is ONE construct -- a contentControl -- never a field construct beside it: the FORMCHECKBOX instruction is mechanically derivable from the control type, so emitting both would encode one occurrence twice.
    expect(paragraphRead.constructs).toEqual([
      {
        descriptor: {
          kind: "contentControl",
          controlType: "checkbox",
          tag: "consentBox",
          checked: true,
          source: {
            format: "docx",
            xml: '<w:ffData><w:name w:val="consentBox"></w:name><w:checkBox><w:default w:val="0"></w:default><w:checked w:val="1"></w:checked></w:checkBox></w:ffData>',
          },
        },
        startRun: 1,
        endRun: 2,
      },
    ]);
    expect(paragraphRead.runs.map((run) => run.text)).toEqual([
      "Answer: ",
      "Yes",
    ]);
  });

  it("reads a drop-down form field as a contentControl carrying its list options", () => {
    const ffData = el("w:ffData", {}, [
      el("w:ddList", {}, [
        el("w:listItem", { "w:val": "red" }),
        el("w:listItem", { "w:displayText": "Green", "w:val": "green" }),
      ]),
    ]);
    const paragraphRead = firstParagraph(
      readDocxContent(formFieldPackage(ffData, " FORMDROPDOWN ", "green")),
    );
    expect(paragraphRead.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "dropDown",
      options: ["red", "Green"],
      source: {
        format: "docx",
        xml: '<w:ffData><w:ddList><w:listItem w:val="red"></w:listItem><w:listItem w:displayText="Green" w:val="green"></w:listItem></w:ddList></w:ffData>',
      },
    });
  });

  it("reads a text-input form field as a plainText contentControl", () => {
    const ffData = el("w:ffData", {}, [
      el("w:textInput", {}, [el("w:default", { "w:val": "typed" })]),
    ]);
    const paragraphRead = firstParagraph(
      readDocxContent(formFieldPackage(ffData, " FORMTEXT ", "typed")),
    );
    expect(paragraphRead.constructs?.[0]?.descriptor).toMatchObject({
      kind: "contentControl",
      controlType: "plainText",
    });
  });

  it("reads a whole-paragraph form field as a block-scoped contentControl marker pair, not a run extent", () => {
    const ffData = el("w:ffData", {}, [
      el("w:checkBox", {}, [el("w:default", { "w:val": "1" })]),
    ]);
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "begin" }), ffData]),
      el("w:r", {}, [
        el("w:instrText", { "xml:space": "preserve" }, [txt(" FORMCHECKBOX ")]),
      ]),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "separate" })]),
      textRun("Yes"),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "end" })]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(
      asConstructStart(doc.sections[0]?.blocks[0]).descriptor,
    ).toMatchObject({
      kind: "contentControl",
      controlType: "checkbox",
      checked: true,
    });
    expect(asParagraph(doc.sections[0]?.blocks[1]).constructs).toBeUndefined();
  });
});

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

describe("readDocxContent: images", () => {
  it("reads an inline (wp:inline) w:drawing as a real ContentImageBlock, sized from wp:extent EMU converted to points", () => {
    const doc = readDocxContent(buildFixturePackage());
    // section 1 blocks: [0] secondSectionPara, [1] inlineImagePara (empty text), [2] its image, [3] floatingImagePara, [4] its image.
    const image = asImage(doc.sections[1]?.blocks[2]);
    expect(image.format).toBe("png");
    expect(image.widthPt).toBe(72); // 914400 EMU -> 1in -> 72pt
    expect(image.heightPt).toBe(36); // 457200 EMU -> 0.5in -> 36pt
    expect(image.altText).toBe("Inline alt text");
    expect(image.base64).toBe(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    );
  });

  it("reads a floating/anchored (wp:anchor) w:drawing as a real ContentImageBlock too, falling back to inline block-flow placement since ContentImageBlock has no absolute position field", () => {
    const doc = readDocxContent(buildFixturePackage());
    const image = asImage(doc.sections[1]?.blocks[4]);
    expect(image.format).toBe("png");
    expect(image.altText).toBe("Floating alt text");
  });

  it("assigns the image its own sourcePath alongside its containing paragraph", () => {
    const doc = readDocxContent(buildFixturePackage());
    expect(sourcePathOf(doc.sections[1]?.blocks[2])).toBe(
      "sections[1].blocks[2]",
    );
  });
});

// An inline OLE object's real-world spelling: a w:r carries a w:object whose w:dxaOrig/w:dyaOrig (twips) size it, whose v:shape > v:imagedata names the raster preview picture rendered in its place (a VML spelling this reader has no path for, so the preview contributes no image block), and whose o:OLEObject names the payload part through its own relationship. The payload relationship is parameterised so a test can point rIdOle at whatever part shape it needs (the ZIP-payload case targets the default embeddings/oleObject1.xlsx; the classic-OLE case retargets to a .bin; the linked case goes external) -- the fixture itself ships no embeddings part, so each test adds exactly the payload bytes it wants. extraRuns splices additional runs after the object run inside the same paragraph.
function oleObjectFixturePackage(
  oleRel: { target: string; external?: boolean },
  extraRuns: XmlElement[] = [],
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

describe("readDocxContent: embedded OLE objects", () => {
  it("recovers a ZIP-payload OLE object as an embeddedObject block carrying the genuinely decoded sub-document", () => {
    // The payload part rIdOle targets now really exists: a minimal xlsx, as a modern producer writes an embedded workbook.
    const pkg = oleObjectFixturePackage({
      target: "embeddings/oleObject1.xlsx",
    });
    pkg.parts["word/embeddings/oleObject1.xlsx"] = {
      kind: "binary",
      base64: bytesToBase64(minimalXlsxBytes()),
    };
    const doc = readDocxContent(pkg);
    // The paragraph contributes its own (run-text-empty) block, then the object's recovered content as a sibling -- the same lifting convention an inline image follows. The VML preview has no reader, so it adds no image block.
    expect(doc.sections[0]?.blocks).toHaveLength(2);
    const embedded = asEmbeddedObject(doc.sections[0]?.blocks[1]);
    expect(embedded.objectKind).toBe("spreadsheet");
    // w:object's own w:dxaOrig/w:dyaOrig (twips) size the block; an inline flow object has no absolute position, so the frame sits at the origin.
    expect(embedded.frame).toEqual({
      xPt: 0,
      yPt: 0,
      widthPt: 96,
      heightPt: 60,
    });
    // The nested document is the genuinely decoded workbook, not just an envelope block.
    const sheet =
      embedded.document.kind === "spreadsheet"
        ? embedded.document.sheets[0]
        : undefined;
    expect(sheet?.name).toBe("Embedded");
    expect(sheet?.cells[0]?.value).toEqual({
      kind: "string",
      value: "Recovered cell",
    });
    expect(sourcePathOf(doc.sections[0]?.blocks[1])).toBe(
      "sections[0].blocks[1]",
    );
  });

  it("lifts an object and a drawing from one paragraph in their markup encounter order", () => {
    // A drawing run after the object run (reusing the fixture's own preview image part) must lift its image block after the object's embedded block, not before it.
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
    const doc = readDocxContent(pkg);
    expect(doc.sections[0]?.blocks).toHaveLength(3);
    expect(asEmbeddedObject(doc.sections[0]?.blocks[1]).objectKind).toBe(
      "spreadsheet",
    );
    expect(asImage(doc.sections[0]?.blocks[2]).altText).toBe(
      "Drawing after the object",
    );
  });

  it("recovers a classic compound-file .bin payload (an OLE-packaged xlsx) as an embeddedObject block", () => {
    // The legacy real-world spelling: rIdOle targets embeddings/oleObject1.bin, whose bytes are a CFB compound file carrying the embedded xlsx as an OLE-packaged 'Package' stream. The recovery must land on the same embeddedObject block the direct-ZIP spelling produces, sized identically from w:object's own geometry.
    const pkg = oleObjectFixturePackage({
      target: "embeddings/oleObject1.bin",
    });
    pkg.parts["word/embeddings/oleObject1.bin"] = {
      kind: "binary",
      base64: bytesToBase64(oleObjectBin(minimalXlsxBytes())),
    };
    const doc = readDocxContent(pkg);
    expect(doc.sections[0]?.blocks).toHaveLength(2);
    const embedded = asEmbeddedObject(doc.sections[0]?.blocks[1]);
    expect(embedded.objectKind).toBe("spreadsheet");
    expect(embedded.frame).toEqual({
      xPt: 0,
      yPt: 0,
      widthPt: 96,
      heightPt: 60,
    });
    const sheet =
      embedded.document.kind === "spreadsheet"
        ? embedded.document.sheets[0]
        : undefined;
    expect(sheet?.cells[0]?.value).toEqual({
      kind: "string",
      value: "Recovered cell",
    });
  });

  it("keeps a malformed compound-file .bin payload skipped, with no embedded block and no host-read failure", () => {
    // rIdOle retargeted at a part whose bytes carry the OLE/CFB magic but no walkable structure -- the named CompoundFileFormatError this decode throws is a property of the embedded payload, degraded to nothing rather than failing the paragraph, section, or document around it (the #737 failure policy extended to the CFB gate).
    const pkg = oleObjectFixturePackage({
      target: "embeddings/oleObject1.bin",
    });
    pkg.parts["word/embeddings/oleObject1.bin"] = {
      kind: "binary",
      base64: bytesToBase64(
        new Uint8Array([
          0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x01, 0x02, 0x03,
          0x04,
        ]),
      ),
    };
    const doc = readDocxContent(pkg);
    expect(doc.sections[0]?.blocks).toHaveLength(1);
    // The w:r carrying the object reads as an empty-text run, exactly as it did before embedded recovery existed.
    const paragraph = asParagraph(doc.sections[0]?.blocks[0]);
    expect(paragraph.runs).toHaveLength(1);
    expect(paragraph.runs[0]?.text).toBe("");
  });

  it("skips an externally-linked OLE object (TargetMode External) without resolving its target", () => {
    // A linked object's relationship target is a URI, not a package part -- the same part-lookup convention the image path applies leaves the paragraph as it was, and no ZIP detection ever runs against the link.
    const pkg = oleObjectFixturePackage({
      target: "file:///C:/data/Book1.xlsx",
      external: true,
    });
    const doc = readDocxContent(pkg);
    expect(doc.sections[0]?.blocks).toHaveLength(1);
  });

  it("skips a ZIP payload that is not a recognisable OOXML package without poisoning the host read", () => {
    // A ZIP payload that fails to decode as one of the three OOXML flavours (here: a plain archive) is skipped exactly like a non-ZIP payload -- one bad embedded object can never fail the whole document read.
    const pkg = oleObjectFixturePackage({ target: "embeddings/payload.zip" });
    pkg.parts["word/embeddings/payload.zip"] = {
      kind: "binary",
      base64: bytesToBase64(
        zipPackage({
          "readme.txt": new TextEncoder().encode("not a document package"),
        }),
      ),
    };
    const doc = readDocxContent(pkg);
    expect(doc.sections[0]?.blocks).toHaveLength(1);
    const paragraph = asParagraph(doc.sections[0]?.blocks[0]);
    expect(paragraph.runs).toHaveLength(1);
    expect(paragraph.runs[0]?.text).toBe("");
  });

  it("skips a w:object whose w:dxaOrig is not numeric, rather than emitting a NaN-sized frame", () => {
    // Malformed geometry degrades to no block, the tier every other numeric attribute reader here degrades on (readOutlineLevel's malformed @lvl is the family's own example): a NaN widthPt would emit a ContentEmbeddedObjectBlock no schema validator accepts, poisoning the whole section for every downstream consumer.
    const pkg = oleObjectFixturePackage(
      { target: "embeddings/oleObject1.xlsx" },
      [],
      "not-a-number",
    );
    pkg.parts["word/embeddings/oleObject1.xlsx"] = {
      kind: "binary",
      base64: bytesToBase64(minimalXlsxBytes()),
    };
    const doc = readDocxContent(pkg);
    expect(doc.sections[0]?.blocks).toHaveLength(1);
  });
});

// Every element with the given tag anywhere in the node forest -- the write-side assertions below need to reach a w:object nested inside w:body > w:p > w:r, far below the part root.
function findAllElements(
  nodes: readonly XmlNode[],
  tag: string,
  out: XmlElement[] = [],
): XmlElement[] {
  for (const node of nodes) {
    if (node.type !== "element") {
      continue;
    }
    if (node.tag === tag) {
      out.push(node);
    }
    findAllElements(node.children, tag, out);
  }
  return out;
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
    expect(after.sections[0]?.blocks).toHaveLength(3);
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
    expect(after.sections[0]?.blocks).toHaveLength(3);
    expect(asEmbeddedObject(after.sections[0]?.blocks[1]).objectKind).toBe(
      "spreadsheet",
    );
    expect(asImage(after.sections[0]?.blocks[2]).altText).toBe(
      "Drawing after the object",
    );
  });

  it("round-trips a recovered presentation embed through an injected embedded-presentation serialiser", () => {
    // The port (#742): ooxml.js has no PresentationML writer, but a caller one layer up does -- documents.js's buildPptxPackage -- and this package cannot depend on its own consumer. options.serialiseEmbeddedPresentation is the seam: the caller injects presentation-document -> pptx-bytes, and the writer serialises the embed exactly like an embedded workbook, into a real word/embeddings/oleObjectN.pptx part.
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
    // The nested document is the genuinely decoded payload the serialiser produced -- minimalPptxBytes' one slide, its paragraph block intact.
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
    // ooxml.js has no pptx writer (PresentationML is read-only in this package), so a presentation embed -- which readDocxContent genuinely recovers -- has no bytes this writer can produce on its own. The reader's degrade-tier rule inverts at the write boundary: a builder asked for a document it cannot faithfully produce throws instead of writing a file that silently lost the embed. The injected serialiser is the remedy, and the previous test proves it; with none injected this throw is the documented boundary.
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

describe("readDocxContent: malformed image geometry", () => {
  it("skips a w:drawing whose wp:extent carries a non-numeric EMU value, rather than emitting a NaN-sized image", () => {
    // The pre-existing parity hazard the embedded-object path would otherwise have widened: Number('nine') is NaN, and a NaN widthPt image block fails ContentImageBlock's own geometry schema for every downstream validator.
    const pkg = oleObjectFixturePackage(
      { target: "embeddings/oleObject1.xlsx" },
      [
        el("w:r", {}, [
          drawingElement("wp:inline", "rIdPreview", "Broken extent", {
            cx: "nine",
            cy: "457200",
          }),
        ]),
      ],
    );
    const doc = readDocxContent(pkg);
    // No embeddings part ships, so the object contributes nothing either -- the paragraph's own block is all that remains.
    expect(doc.sections[0]?.blocks).toHaveLength(1);
  });
});

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
    // The orphan joins no section's references -- sectionHeaderFooters keeps spelling exactly what the sections spell.
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
