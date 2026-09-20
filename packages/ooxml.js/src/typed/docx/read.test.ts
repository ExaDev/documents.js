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
import { rgbHexToColor } from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { bytesToBase64 } from "byte-codec";
import { zipPackage } from "../../zip";
import { oleObjectBin } from "../../test-support/cfb";
import {
  minimalDocxBytes,
  minimalPptxBytes,
  minimalXlsxBytes,
} from "../../test-support/embedded";
import { eighthPointsToPt } from "../shared/units";
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

// wp:inline and wp:anchor share the identical wp:extent/wp:docPr/a:graphic/a:graphicData/pic:pic/pic:blipFill/a:blip shape -- only the outer container tag differs (and, for wp:anchor, the wp:positionH/wp:positionV elements this fixture doesn't set -- see the dedicated "wp:anchor floating image position" describe block below for those).
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

describe("readDocxContent: verticalAlign and direction (w:vertAlign/w:rtl/w:bidi)", () => {
  it("reads w:vertAlign superscript/subscript onto ContentRun.verticalAlign, and w:rtl onto ContentRun.direction", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:rPr", {}, [el("w:vertAlign", { "w:val": "superscript" })]),
        el("w:t", {}, [txt("above")]),
      ]),
      el("w:r", {}, [
        el("w:rPr", {}, [el("w:vertAlign", { "w:val": "subscript" })]),
        el("w:t", {}, [txt("below")]),
      ]),
      el("w:r", {}, [
        el("w:rPr", {}, [el("w:rtl")]),
        el("w:t", {}, [txt("right to left")]),
      ]),
      el("w:r", {}, [
        el("w:rPr", {}, [el("w:rtl", { "w:val": "0" })]),
        el("w:t", {}, [txt("explicitly ltr")]),
      ]),
      textRun("plain"),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const runs = firstParagraph(doc).runs;
    expect(runs.map((run) => run.verticalAlign)).toEqual([
      "superscript",
      "subscript",
      undefined,
      undefined,
      undefined,
    ]);
    expect(runs.map((run) => run.direction)).toEqual([
      undefined,
      undefined,
      "rtl",
      "ltr",
      undefined,
    ]);
  });

  it("reads a baseline vertAlign as the explicit override of an inherited position, stating nothing on the run", () => {
    // The named character style supersedes its basedOn chain: the chain says superscript, the direct rPr turns it back off, and the resolved run carries no verticalAlign -- baseline, the schema's own spelling of the field's absence.
    const styles = el("w:styles", {}, [
      el(
        "w:style",
        { "w:type": "paragraph", "w:styleId": "Normal", "w:default": "1" },
        [],
      ),
      el("w:style", { "w:type": "character", "w:styleId": "Sup" }, [
        el("w:basedOn", { "w:val": "Normal" }),
        el("w:rPr", {}, [el("w:vertAlign", { "w:val": "superscript" })]),
      ]),
    ]);
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:rPr", {}, [
          el("w:rStyle", { "w:val": "Sup" }),
          el("w:vertAlign", { "w:val": "baseline" }),
        ]),
        el("w:t", {}, [txt("flattened")]),
      ]),
    ]);
    const doc = readDocxContent(
      paragraphPackage(paragraph, {
        "word/styles.xml": { kind: "xml", nodes: [styles] },
      }),
    );
    expect(firstParagraph(doc).runs[0]?.verticalAlign).toBeUndefined();
  });

  it("reads w:bidi onto ContentParagraph.direction, both on and explicitly off", () => {
    const on = readDocxContent(
      paragraphPackage(
        el("w:p", {}, [
          el("w:pPr", {}, [el("w:bidi")]),
          textRun("rtl paragraph"),
        ]),
      ),
    );
    expect(firstParagraph(on).direction).toBe("rtl");
    const off = readDocxContent(
      paragraphPackage(
        el("w:p", {}, [
          el("w:pPr", {}, [el("w:bidi", { "w:val": "0" })]),
          textRun("explicitly ltr paragraph"),
        ]),
      ),
    );
    expect(firstParagraph(off).direction).toBe("ltr");
  });

  it("round-trips verticalAlign, run direction, and paragraph direction through buildDocxPackageFromContent", () => {
    const paragraph = el("w:p", {}, [
      el("w:pPr", {}, [el("w:bidi")]),
      el("w:r", {}, [
        el("w:rPr", {}, [
          el("w:vertAlign", { "w:val": "superscript" }),
          el("w:rtl"),
        ]),
        el("w:t", {}, [txt("everything at once")]),
      ]),
    ]);
    const before = readDocxContent(paragraphPackage(paragraph));
    const after = readDocxContent(buildDocxPackageFromContent(before));
    const roundTripped = firstParagraph(after);
    expect(roundTripped.direction).toBe("rtl");
    expect(roundTripped.runs[0]?.verticalAlign).toBe("superscript");
    expect(roundTripped.runs[0]?.direction).toBe("rtl");
  });
});

describe("readDocxContent: tables", () => {
  it("reads column widths and a horizontally-merged cell's colSpan and background", () => {
    const doc = readDocxContent(buildFixturePackage());
    const table = asTable(doc.sections[0]?.blocks[19]);
    expect(table.columnWidthsPt).toEqual([144, 144]);
    expect(table.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(table.rows[0]?.cells[0]?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 0, b: 0 },
    });
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

  it("reads a drop-down form field with no listItem entries as options: [], not an absent options field", () => {
    const ffData = el("w:ffData", {}, [el("w:ddList", {}, [])]);
    const paragraphRead = firstParagraph(
      readDocxContent(formFieldPackage(ffData, " FORMDROPDOWN ", "")),
    );
    expect(paragraphRead.constructs?.[0]?.descriptor).toMatchObject({
      kind: "contentControl",
      controlType: "dropDown",
      options: [],
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

  it("reads a floating/anchored (wp:anchor) w:drawing as a real ContentImageBlock too, still placed in block flow at the point the w:drawing was encountered (floatPosition records the source's own anchored position separately -- see the dedicated describe block below; this fixture's own wp:anchor carries neither wp:positionH nor wp:positionV, so floatPosition stays absent here)", () => {
    const doc = readDocxContent(buildFixturePackage());
    const image = asImage(doc.sections[1]?.blocks[4]);
    expect(image.format).toBe("png");
    expect(image.altText).toBe("Floating alt text");
    expect(image.floatPosition).toBeUndefined();
  });

  it("assigns the image its own sourcePath alongside its containing paragraph", () => {
    const doc = readDocxContent(buildFixturePackage());
    expect(sourcePathOf(doc.sections[1]?.blocks[2])).toBe(
      "sections[1].blocks[2]",
    );
  });
});

describe("readDocxContent: lifted-image anchors (anchorRunIndex/anchorOffset)", () => {
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

  function imageRun(): XmlElement {
    return el("w:r", {}, [
      drawingElement("wp:inline", "rIdImg", "Anchored alt text"),
    ]);
  }

  it("anchors an image in its own run to the previous run at that run's full length", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [el("w:t", {}, [txt("Hello ")])]),
      imageRun(),
      el("w:r", {}, [el("w:t", {}, [txt("World")])]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph, imageParts()));
    // The image sits between two runs: anchor names the run whose text it followed (index 0, "Hello ") and the position after that run's whole text.
    const image = asImage(doc.sections[0]?.blocks[1]);
    expect(image.anchorRunIndex).toBe(0);
    expect(image.anchorOffset).toBe(6);
  });

  it("anchors an image at the paragraph's very start to (0, 0)", () => {
    const paragraph = el("w:p", {}, [
      imageRun(),
      el("w:r", {}, [el("w:t", {}, [txt("Trailing text")])]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph, imageParts()));
    const image = asImage(doc.sections[0]?.blocks[1]);
    expect(image.anchorRunIndex).toBe(0);
    expect(image.anchorOffset).toBe(0);
  });

  it("anchors an image sharing a run with text to that run at the length of the text preceding it", () => {
    const sharedRun = el("w:r", {}, [
      el("w:t", {}, [txt("foo")]),
      drawingElement("wp:inline", "rIdImg", "Mid-run alt text"),
      el("w:t", {}, [txt("bar")]),
    ]);
    const doc = readDocxContent(
      paragraphPackage(el("w:p", {}, [sharedRun]), imageParts()),
    );
    const image = asImage(doc.sections[0]?.blocks[1]);
    expect(image.anchorRunIndex).toBe(0);
    expect(image.anchorOffset).toBe(3);
  });

  it("anchors an image inside a hyperlink through the run the walk emitted for it", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [el("w:t", {}, [txt("See ")])]),
      el("w:hyperlink", { "r:id": "rIdLink" }, [
        el("w:r", {}, [el("w:t", {}, [txt("the proof")])]),
        imageRun(),
      ]),
    ]);
    const parts = imageParts();
    const relsPart = parts["word/_rels/document.xml.rels"];
    if (relsPart?.kind !== "xml") {
      throw new Error("expected document rels");
    }
    relsPart.nodes = [
      rels([
        { id: "rIdImg", type: IMAGE_REL, target: "media/image1.png" },
        {
          id: "rIdLink",
          type: HYPERLINK_REL,
          target: "https://example.invalid/",
          external: true,
        },
      ]),
    ];
    const doc = readDocxContent(paragraphPackage(paragraph, parts));
    // Runs as walked: [0] "See ", [1] "the proof" (hyperlink-wrapped), [2] the image's own empty run -- the anchor names run 1 at its full length.
    const image = asImage(doc.sections[0]?.blocks[1]);
    expect(image.anchorRunIndex).toBe(1);
    expect(image.anchorOffset).toBe(9);
  });

  it("round-trips an end-of-paragraph image's anchor through buildDocxPackageFromContent", () => {
    // The writer re-inlines a lifted image as the last run of its containing paragraph, so an image that already sat at the paragraph's end keeps its anchor through a round trip: (last run, that run's full length) is exactly where the written run lands.
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [el("w:t", {}, [txt("Signed: ")])]),
      imageRun(),
    ]);
    const before = readDocxContent(paragraphPackage(paragraph, imageParts()));
    const after = readDocxContent(buildDocxPackageFromContent(before));
    const image = asImage(after.sections[0]?.blocks[1]);
    expect(image.anchorRunIndex).toBe(0);
    expect(image.anchorOffset).toBe(8);
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

// A wp:anchor whose wp:positionH/wp:positionV carry whatever position children the caller supplies -- everything else (extent, docPr, the picture chain, the relationship, the media part) is the identical minimal shape drawingElement builds above, just with the position elements spliced in.
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

describe("readDocxContent: wp:anchor floating image position (ExaDev/documents.js#1087)", () => {
  it("reads an offset-based position on both axes -- wp:posOffset, an EMU integer converted to points", () => {
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

  it("reads an align-based position on both axes -- wp:align, a keyword", () => {
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

  it("reads one axis offset-based and the other align-based independently -- docx's own wp:positionH/wp:positionV choose per axis", () => {
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

describe("readDocxContent: w:pBdr (direct paragraph border formatting)", () => {
  it("reads a bottom-only border, the exact shape Word's AutoCorrect horizontal rule produces", () => {
    const paragraph = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:pBdr", {}, [
          el("w:bottom", {
            "w:val": "single",
            "w:sz": "6",
            "w:color": "000000",
          }),
        ]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const borders = firstParagraph(doc).borders;
    expect(borders?.bottom).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 0.75,
      style: "solid",
    });
    expect(borders?.top).toBeUndefined();
    expect(borders?.left).toBeUndefined();
    expect(borders?.right).toBeUndefined();
  });

  it("reads all four edges independently, mapping style keywords and resolving an auto colour to black", () => {
    const paragraph = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:pBdr", {}, [
          el("w:top", { "w:val": "single", "w:sz": "8", "w:color": "00FF00" }),
          el("w:left", { "w:val": "dashed", "w:color": "auto" }),
          el("w:bottom", {
            "w:val": "double",
            "w:sz": "12",
            "w:color": "0000FF",
          }),
          el("w:right", { "w:val": "dotted", "w:color": "FF0000" }),
        ]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const borders = firstParagraph(doc).borders;
    expect(borders?.top).toEqual({
      color: { r: 0, g: 1, b: 0 },
      widthPt: 1,
      style: "solid",
    });
    expect(borders?.left).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 0.5,
      style: "dashed",
    });
    expect(borders?.bottom).toEqual({
      color: { r: 0, g: 0, b: 1 },
      widthPt: 1.5,
      style: "double",
    });
    expect(borders?.right).toEqual({
      color: { r: 1, g: 0, b: 0 },
      widthPt: 0.5,
      style: "dotted",
    });
  });

  it("has no w:start/w:end RTL-alias fallback, unlike w:tcBorders -- a paragraph carrying only those is read as having no left/right border", () => {
    const paragraph = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:pBdr", {}, [
          el("w:start", {
            "w:val": "single",
            "w:sz": "8",
            "w:color": "000000",
          }),
          el("w:end", { "w:val": "single", "w:sz": "8", "w:color": "000000" }),
        ]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(firstParagraph(doc).borders).toBeUndefined();
  });

  it("leaves borders undefined when the paragraph carries no w:pBdr at all", () => {
    const paragraph = el("w:p", {}, [textRun("Plain paragraph")]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(firstParagraph(doc).borders).toBeUndefined();
  });

  it("leaves borders undefined when w:pBdr's own edges are all nil, matching readCellBorders' identical treatment", () => {
    const paragraph = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:pBdr", {}, [
          el("w:top", { "w:val": "nil" }),
          el("w:bottom", { "w:val": "none" }),
        ]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(firstParagraph(doc).borders).toBeUndefined();
  });
});

describe("readDocxContent: a mid-run page-type w:br splits the paragraph", () => {
  it("splits a paragraph with a page break inside one run's text into [before, pageBreak, after]", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("before")]),
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("after")]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(3);
    expect(asParagraph(blocks[0]).runs.map((r) => r.text)).toEqual(["before"]);
    expect(blocks[1]?.kind).toBe("pageBreak");
    expect(asParagraph(blocks[2]).runs.map((r) => r.text)).toEqual(["after"]);
  });

  it("splits across separate runs too, keeping every run entirely on its own side of the break", () => {
    const paragraph = el("w:p", {}, [
      textRun("first run"),
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("mid before")]),
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("mid after")]),
      ]),
      textRun("last run"),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(3);
    expect(asParagraph(blocks[0]).runs.map((r) => r.text)).toEqual([
      "first run",
      "mid before",
    ]);
    expect(blocks[1]?.kind).toBe("pageBreak");
    expect(asParagraph(blocks[2]).runs.map((r) => r.text)).toEqual([
      "mid after",
      "last run",
    ]);
  });

  it("both halves inherit the original paragraph's own paragraph-level formatting unchanged", () => {
    const paragraph = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:pStyle", { "w:val": "IntenseQuote" }),
        el("w:jc", { "w:val": "center" }),
      ]),
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("before")]),
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("after")]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    const before = asParagraph(blocks[0]);
    const after = asParagraph(blocks[2]);
    expect(before.styleId).toBe("IntenseQuote");
    expect(after.styleId).toBe("IntenseQuote");
    expect(before.alignment).toBe("center");
    expect(after.alignment).toBe("center");
  });

  it("both halves of the split run keep its own bold/italic/colour formatting", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:rPr", {}, [el("w:b"), el("w:i")]),
        el("w:t", { "xml:space": "preserve" }, [txt("before")]),
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("after")]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    const beforeRun = asParagraph(blocks[0]).runs[0];
    const afterRun = asParagraph(blocks[2]).runs[0];
    expect(beforeRun?.bold).toBe(true);
    expect(beforeRun?.italic).toBe(true);
    expect(afterRun?.bold).toBe(true);
    expect(afterRun?.italic).toBe(true);
  });

  it("does not leave an empty stand-in run when the break sits at the very start of a run's own text", () => {
    const paragraph = el("w:p", {}, [
      textRun("earlier run"),
      el("w:r", {}, [
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("after")]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(asParagraph(blocks[0]).runs.map((r) => r.text)).toEqual([
      "earlier run",
    ]);
    expect(asParagraph(blocks[2]).runs.map((r) => r.text)).toEqual(["after"]);
  });

  it("does not leave an empty stand-in run when the break sits at the very end of a run's own text", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("before")]),
        el("w:br", { "w:type": "page" }),
      ]),
      textRun("later run"),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(asParagraph(blocks[0]).runs.map((r) => r.text)).toEqual(["before"]);
    expect(asParagraph(blocks[2]).runs.map((r) => r.text)).toEqual([
      "later run",
    ]);
  });

  it("does not split on a w:br with no @w:type (textWrapping, the default) -- it still reads back as a literal newline", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("before")]),
        el("w:br"),
        el("w:t", { "xml:space": "preserve" }, [txt("after")]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(1);
    expect(asParagraph(blocks[0]).runs[0]?.text).toBe("before\nafter");
  });

  it('does not split on a column break (@w:type="column") either', () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("before")]),
        el("w:br", { "w:type": "column" }),
        el("w:t", { "xml:space": "preserve" }, [txt("after")]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(1);
    expect(asParagraph(blocks[0]).runs[0]?.text).toBe("before\nafter");
  });

  it("splits only on the FIRST page-type break in the paragraph -- a second one reads back as an ordinary newline in the after-half", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("first")]),
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("second")]),
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("third")]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(3);
    expect(asParagraph(blocks[0]).runs[0]?.text).toBe("first");
    expect(blocks[1]?.kind).toBe("pageBreak");
    expect(asParagraph(blocks[2]).runs[0]?.text).toBe("second\nthird");
  });

  it("keeps a bookmark extent entirely before the split run on the before-half, unchanged", () => {
    const paragraph = el("w:p", {}, [
      el("w:bookmarkStart", { "w:id": "1", "w:name": "early" }),
      textRun("bookmarked"),
      el("w:bookmarkEnd", { "w:id": "1" }),
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("before")]),
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("after")]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    const before = asParagraph(blocks[0]);
    expect(before.constructs).toEqual([
      {
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "early" },
        startRun: 0,
        endRun: 1,
      },
    ]);
    expect(asParagraph(blocks[2]).constructs).toBeUndefined();
  });

  it("keeps a bookmark extent entirely after the split run on the after-half, re-indexed from zero", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("before")]),
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("after")]),
      ]),
      el("w:bookmarkStart", { "w:id": "2", "w:name": "late" }),
      textRun("bookmarked"),
      el("w:bookmarkEnd", { "w:id": "2" }),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(asParagraph(blocks[0]).constructs).toBeUndefined();
    const after = asParagraph(blocks[2]);
    expect(after.runs.map((r) => r.text)).toEqual(["after", "bookmarked"]);
    // "bookmarked" is re-indexed run 1 in the after-half's own numbering (afterHalf itself occupies run 0), not run 0 -- the after-half's own run array is [afterHalf, ...original runs from pageBreak.runIndex+1 onward].
    expect(after.constructs).toEqual([
      {
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "late" },
        startRun: 1,
        endRun: 2,
      },
    ]);
  });

  it("drops a bookmark extent that spans across the split run itself, rather than mis-encoding it onto either half", () => {
    // "lead"/"trail" runs keep both bookmark halves inside the paragraph's own content range (not its very first/last child), so this is a genuine run-scoped extent rather than the whole-paragraph block-scoped shape recordParagraphRangeMarkers encodes separately.
    const paragraph = el("w:p", {}, [
      textRun("lead"),
      el("w:bookmarkStart", { "w:id": "3", "w:name": "spanning" }),
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("before")]),
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("after")]),
      ]),
      textRun("tail"),
      el("w:bookmarkEnd", { "w:id": "3" }),
      textRun("trail"),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(3);
    expect(asParagraph(blocks[0]).constructs).toBeUndefined();
    const after = asParagraph(blocks[2]);
    expect(after.runs.map((r) => r.text)).toEqual(["after", "tail", "trail"]);
    expect(after.constructs).toBeUndefined();
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

// A single-section, sectPr-only body: readSections closes the one implicit section entirely from that sectPr, with no paragraphs at all, so readPageSize/readMargins' own fallback branches are exercised in isolation from every other section-level concern.
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

describe("readDocxContent: readObjectEmbeddedObject malformed geometry", () => {
  it("skips a w:object whose w:dyaOrig is not numeric, rather than emitting a NaN-sized frame", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:object", { "w:dxaOrig": "1920", "w:dyaOrig": "not-a-number" }, [
          el("o:OLEObject", { Type: "Embed", "r:id": "rIdOle" }),
        ]),
      ]),
    ]);
    const doc = readDocxContent(
      paragraphPackage(paragraph, {
        "word/embeddings/oleObject1.xlsx": {
          kind: "binary",
          base64: bytesToBase64(minimalXlsxBytes()),
        },
      }),
    );
    // No dxaOrig/dyaOrig pair passes the finiteness check, so the object contributes no block at all.
    expect(doc.sections[0]?.blocks).toHaveLength(1);
  });
});

describe("readDocxContent: lifted media inside a w:object's own children, and deletion-scoped lifting", () => {
  it("recurses into a w:object's own children to lift a nested w:drawing, anchored at the object's own run position", () => {
    const paragraph = el("w:p", {}, [
      textRun("before "),
      el("w:r", {}, [
        el("w:object", { "w:dxaOrig": "1920", "w:dyaOrig": "1200" }, [
          drawingElement("wp:inline", "rIdNestedPreview", "Nested preview"),
          el("o:OLEObject", { Type: "Embed", "r:id": "rIdMissingOle" }),
        ]),
      ]),
    ]);
    const pkg = paragraphPackage(paragraph, {
      "word/media/nestedPreview.png": {
        kind: "binary",
        base64: TINY_PNG_BASE64,
      },
    });
    pkg.parts["word/_rels/document.xml.rels"] = {
      kind: "xml",
      nodes: [
        rels([
          {
            id: "rIdNestedPreview",
            type: IMAGE_REL,
            target: "media/nestedPreview.png",
          },
        ]),
      ],
    };
    const doc = readDocxContent(pkg);
    // The object's own OLE payload never resolves (rIdMissingOle has no relationship), so only the nested drawing surfaces as a lifted image, anchored to where the run before it ends.
    expect(doc.sections[0]?.blocks).toHaveLength(2);
    const image = asImage(doc.sections[0]?.blocks[1]);
    expect(image.altText).toBe("Nested preview");
    expect(image.anchorRunIndex).toBe(0);
    expect(image.anchorOffset).toBe("before ".length);
  });

  it("excludes a drawing nested inside a mid-paragraph w:del when the paragraph itself is not wholly deleted", () => {
    const paragraph = el("w:p", {}, [
      textRun("kept "),
      el("w:del", { "w:id": "3" }, [
        el("w:r", {}, [
          drawingElement("wp:inline", "rIdDeletedImg", "Deleted"),
        ]),
      ]),
    ]);
    const pkg = paragraphPackage(paragraph, {
      "word/media/deleted.png": { kind: "binary", base64: TINY_PNG_BASE64 },
    });
    pkg.parts["word/_rels/document.xml.rels"] = {
      kind: "xml",
      nodes: [
        rels([
          { id: "rIdDeletedImg", type: IMAGE_REL, target: "media/deleted.png" },
        ]),
      ],
    };
    const doc = readDocxContent(pkg);
    expect(doc.sections[0]?.blocks).toHaveLength(1);
    expect(
      asParagraph(doc.sections[0]?.blocks[0]).runs.map((r) => r.text),
    ).toEqual(["kept "]);
  });

  it("includes a drawing nested inside a mid-paragraph w:del when the whole paragraph is itself a tracked deletion", () => {
    const paragraph = el("w:del", { "w:id": "4" }, [
      el("w:p", {}, [
        el("w:del", { "w:id": "5" }, [
          el("w:r", {}, [drawingElement("wp:inline", "rIdKeptImg", "Kept")]),
        ]),
      ]),
    ]);
    const pkg = paragraphPackage(paragraph, {
      "word/media/kept.png": { kind: "binary", base64: TINY_PNG_BASE64 },
    });
    pkg.parts["word/_rels/document.xml.rels"] = {
      kind: "xml",
      nodes: [
        rels([{ id: "rIdKeptImg", type: IMAGE_REL, target: "media/kept.png" }]),
      ],
    };
    const doc = readDocxContent(pkg);
    const image = asImage(
      doc.sections[0]?.blocks.find((b) => b.kind === "image"),
    );
    expect(image.altText).toBe("Kept");
  });
});

describe("readDocxContent: field block-scope boundary checks", () => {
  it("encodes a field as a run extent, not a block marker, when text follows its end within the same paragraph", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "begin" })]),
      el("w:r", {}, [
        el("w:instrText", { "xml:space": "preserve" }, [txt(" PAGE ")]),
      ]),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "separate" })]),
      textRun("1"),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "end" })]),
      textRun(" of 10"),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const para = firstParagraph(doc);
    expect(para.constructs).toEqual([
      {
        descriptor: { kind: "field", instruction: " PAGE " },
        startRun: 0,
        endRun: 1,
      },
    ]);
    expect(para.runs.map((r) => r.text)).toEqual(["1", " of 10"]);
  });

  it("encodes a w:fldSimple as a run extent, not a block marker, when other content shares its paragraph", () => {
    const paragraph = el("w:p", {}, [
      textRun("See "),
      el("w:fldSimple", { "w:instr": " PAGE " }, [textRun("1")]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const para = firstParagraph(doc);
    expect(para.constructs).toEqual([
      {
        descriptor: { kind: "field", instruction: " PAGE " },
        startRun: 1,
        endRun: 2,
      },
    ]);
  });
});

describe("readDocxContent: a complex field spanning multiple paragraphs (the TOC shape)", () => {
  it("brackets a field whose begin is one paragraph's only content and whose end is a later paragraph's only content", () => {
    const beginPara = el("w:p", {}, [
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "begin" })]),
    ]);
    const codePara = el("w:p", {}, [
      el("w:r", {}, [
        el("w:instrText", { "xml:space": "preserve" }, [txt(" TOC ")]),
      ]),
    ]);
    const separatePara = el("w:p", {}, [
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "separate" })]),
    ]);
    const resultPara = el("w:p", {}, [textRun("Chapter 1 ... 1")]);
    const endPara = el("w:p", {}, [
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "end" })]),
    ]);
    const body = el("w:body", {}, [
      beginPara,
      codePara,
      separatePara,
      resultPara,
      endPara,
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
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(asConstructStart(blocks[0]).descriptor).toEqual({
      kind: "field",
      instruction: " TOC ",
    });
    // Every paragraph between begin and end -- including the begin/code/separate/end paragraphs' own, mostly-empty, paragraph blocks -- stays inside the marker pair; only the result paragraph carries real text.
    const resultParagraph = blocks.find(
      (block) =>
        block.kind === "paragraph" && block.runs[0]?.text === "Chapter 1 ... 1",
    );
    expect(resultParagraph).toBeDefined();
    expect(blocks[blocks.length - 1]?.kind).toBe("constructEnd");
  });
});

describe("readDocxContent: cell border w:start/w:end aliases, default width, and empty-borders collapse", () => {
  function tableWithCellBorders(tcBorders: XmlElement): ContentTable {
    const table = el("w:tbl", {}, [
      el("w:tblGrid", {}, [el("w:gridCol", { "w:w": "1440" })]),
      el("w:tr", {}, [
        el("w:tc", {}, [
          el("w:tcPr", {}, [tcBorders]),
          el("w:p", {}, [textRun("cell")]),
        ]),
      ]),
    ]);
    return asTable(
      readDocxContent(paragraphPackage(table)).sections[0]?.blocks[0],
    );
  }

  it("falls back to w:start/w:end when w:left/w:right are absent, and defaults a missing @w:sz to half a point", () => {
    const table = tableWithCellBorders(
      el("w:tcBorders", {}, [
        el("w:start", { "w:val": "single", "w:color": "112233" }),
        el("w:end", { "w:val": "single", "w:color": "445566" }),
      ]),
    );
    expect(table.rows[0]?.cells[0]?.borders?.left).toEqual({
      color: rgbHexToColor("112233"),
      widthPt: eighthPointsToPt(4),
      style: "solid",
    });
    expect(table.rows[0]?.cells[0]?.borders?.right).toEqual({
      color: rgbHexToColor("445566"),
      widthPt: eighthPointsToPt(4),
      style: "solid",
    });
  });

  it("prefers w:left/w:right over the w:start/w:end aliases when both are spelled", () => {
    const table = tableWithCellBorders(
      el("w:tcBorders", {}, [
        el("w:left", { "w:val": "single", "w:color": "AAAAAA" }),
        el("w:start", { "w:val": "single", "w:color": "BBBBBB" }),
      ]),
    );
    expect(table.rows[0]?.cells[0]?.borders?.left?.color).toEqual(
      rgbHexToColor("AAAAAA"),
    );
  });

  it("collapses to no borders at all when every edge is nil or none", () => {
    const table = tableWithCellBorders(
      el("w:tcBorders", {}, [
        el("w:top", { "w:val": "nil" }),
        el("w:bottom", { "w:val": "none" }),
      ]),
    );
    expect(table.rows[0]?.cells[0]?.borders).toBeUndefined();
  });

  it("reads a right-only border edge with an explicit @w:sz", () => {
    const table = tableWithCellBorders(
      el("w:tcBorders", {}, [
        el("w:right", { "w:val": "single", "w:sz": "16", "w:color": "010203" }),
      ]),
    );
    expect(table.rows[0]?.cells[0]?.borders).toEqual({
      right: {
        color: rgbHexToColor("010203"),
        widthPt: eighthPointsToPt(16),
        style: "solid",
      },
    });
  });
});

describe("readDocxContent: table span and row-height edge cases", () => {
  it("leaves colSpan and rowSpan undefined for an ordinary, unmerged cell", () => {
    const doc = readDocxContent(buildFixturePackage());
    const table = asTable(doc.sections[0]?.blocks[19]);
    expect(table.rows[1]?.cells[1]?.colSpan).toBeUndefined();
    expect(table.rows[1]?.cells[1]?.rowSpan).toBeUndefined();
  });

  it("leaves a row's own heightPt undefined when it carries no w:trPr at all, and when w:trPr carries no w:trHeight", () => {
    const noTrPr = el("w:tbl", {}, [
      el("w:tblGrid", {}, [el("w:gridCol", { "w:w": "1440" })]),
      el("w:tr", {}, [el("w:tc", {}, [el("w:p", {}, [textRun("a")])])]),
    ]);
    const noTrHeight = el("w:tbl", {}, [
      el("w:tblGrid", {}, [el("w:gridCol", { "w:w": "1440" })]),
      el("w:tr", {}, [
        el("w:trPr", {}, []),
        el("w:tc", {}, [el("w:p", {}, [textRun("b")])]),
      ]),
    ]);
    expect(
      asTable(readDocxContent(paragraphPackage(noTrPr)).sections[0]?.blocks[0])
        .rows[0]?.heightPt,
    ).toBeUndefined();
    expect(
      asTable(
        readDocxContent(paragraphPackage(noTrHeight)).sections[0]?.blocks[0],
      ).rows[0]?.heightPt,
    ).toBeUndefined();
  });
});

describe("readDocxContent: block-level bookmarks, duplicate ids, and out-of-order halves", () => {
  function flowDoc(children: XmlElement[]) {
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
    expect(doc.sections[0]?.blocks).toHaveLength(4);
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
    // The object's own run still emits (empty text -- a w:object contributes no run text), but no embedded block follows it.
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

describe("readDocxContent: complex-field instruction accumulation", () => {
  it("stops the instruction at the field's separate, ignoring instrText in the result half", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "begin" })]),
      el("w:r", {}, [
        el("w:instrText", { "xml:space": "preserve" }, [txt(" A ")]),
      ]),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "separate" })]),
      el("w:r", {}, [
        el("w:instrText", { "xml:space": "preserve" }, [txt(" B ")]),
      ]),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "end" })]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(asConstructStart(doc.sections[0]?.blocks[0]).descriptor).toEqual({
      kind: "field",
      instruction: " A ",
    });
  });

  it("keeps instruction text nested directly inside a hyperlink out of a whole-paragraph field's instruction", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "begin" })]),
      el("w:hyperlink", {}, [
        el("w:instrText", { "xml:space": "preserve" }, [txt(" POLLUTE ")]),
      ]),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "end" })]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(asConstructStart(doc.sections[0]?.blocks[0]).descriptor).toEqual({
      kind: "field",
      instruction: "",
    });
  });
});

describe("readDocxContent: discovery-order tie-breaks between constructs sharing one extent range", () => {
  // Several constructs can bracket the identical block range (two bookmarks around one paragraph, a bookmark around a content control, a content control around a tracked paragraph). Their emission order at the shared boundary is the source's own discovery order, carried by the walk's order counter -- these tests pin that order exactly, because a marker pair emitted in the wrong order decodes to the wrong nesting.
  function flowDoc(children: XmlElement[]): ReturnType<typeof readDocxContent> {
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

  it("opens two paragraph-scoped bookmarks over one paragraph in source order", () => {
    const paragraph = el("w:p", {}, [
      el("w:bookmarkStart", { "w:id": "1", "w:name": "First" }),
      el("w:bookmarkStart", { "w:id": "2", "w:name": "Second" }),
      textRun("Bookmarked"),
      el("w:bookmarkEnd", { "w:id": "1" }),
      el("w:bookmarkEnd", { "w:id": "2" }),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(asConstructStart(blocks[0]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "First",
    });
    expect(asConstructStart(blocks[1]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "Second",
    });
    expect(asParagraph(blocks[2]).runs[0]?.text).toBe("Bookmarked");
    expect(blocks[3]?.kind).toBe("constructEnd");
    expect(blocks[4]?.kind).toBe("constructEnd");
  });

  it("opens a whole-paragraph tracked change before the paragraph's own bookmark pair", () => {
    const paragraph = el("w:p", {}, [
      el("w:bookmarkStart", { "w:id": "3", "w:name": "Marked" }),
      el(
        "w:ins",
        { "w:id": "9", "w:author": "Ed", "w:date": "2024-01-01T00:00:00Z" },
        [textRun("Inserted")],
      ),
      el("w:bookmarkEnd", { "w:id": "3" }),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(asConstructStart(blocks[0]).descriptor).toEqual({
      kind: "provenance",
      change: "insertion",
      author: "Ed",
      dateIso: "2024-01-01T00:00:00Z",
    });
    expect(asConstructStart(blocks[1]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "Marked",
    });
    expect(asParagraph(blocks[2]).runs[0]?.text).toBe("Inserted");
    expect(blocks[3]?.kind).toBe("constructEnd");
    expect(blocks[4]?.kind).toBe("constructEnd");
  });

  it("opens a content control before the tracked-change extent of the paragraph it wraps", () => {
    const doc = readDocxContent(
      paragraphPackage(
        el("w:sdt", {}, [
          el("w:sdtContent", {}, [
            el("w:p", {}, [
              el(
                "w:ins",
                {
                  "w:id": "9",
                  "w:author": "Ed",
                  "w:date": "2024-01-01T00:00:00Z",
                },
                [textRun("Drafted")],
              ),
            ]),
          ]),
        ]),
      ),
    );
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(asConstructStart(blocks[0]).descriptor).toEqual({
      kind: "contentControl",
      controlType: "richText",
    });
    expect(asConstructStart(blocks[1]).descriptor).toEqual({
      kind: "provenance",
      change: "insertion",
      author: "Ed",
      dateIso: "2024-01-01T00:00:00Z",
    });
    expect(asParagraph(blocks[2]).runs[0]?.text).toBe("Drafted");
    expect(blocks[3]?.kind).toBe("constructEnd");
    expect(blocks[4]?.kind).toBe("constructEnd");
  });

  it("opens a block-level bookmark before a content control sharing its extent", () => {
    const doc = flowDoc([
      el("w:bookmarkStart", { "w:id": "7", "w:name": "Wrapped" }),
      el("w:sdt", {}, [
        el("w:sdtContent", {}, [el("w:p", {}, [textRun("Controlled")])]),
      ]),
      el("w:bookmarkEnd", { "w:id": "7" }),
    ]);
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(5);
    expect(asConstructStart(blocks[0]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "Wrapped",
    });
    expect(asConstructStart(blocks[1]).descriptor).toEqual({
      kind: "contentControl",
      controlType: "richText",
    });
    expect(asParagraph(blocks[2]).runs[0]?.text).toBe("Controlled");
    expect(blocks[3]?.kind).toBe("constructEnd");
    expect(blocks[4]?.kind).toBe("constructEnd");
  });

  it("opens point bookmarks sharing one block position in source order after an intervening wide bookmark close", () => {
    const doc = flowDoc([
      el("w:bookmarkStart", { "w:id": "8", "w:name": "Wide" }),
      el("w:p", {}, [textRun("One")]),
      el("w:bookmarkStart", { "w:id": "9", "w:name": "FirstPoint" }),
      el("w:bookmarkEnd", { "w:id": "9" }),
      el("w:bookmarkEnd", { "w:id": "8" }),
      el("w:bookmarkStart", { "w:id": "10", "w:name": "SecondPoint" }),
      el("w:bookmarkEnd", { "w:id": "10" }),
    ]);
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(7);
    expect(asConstructStart(blocks[0]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "Wide",
    });
    expect(asParagraph(blocks[1]).runs[0]?.text).toBe("One");
    expect(blocks[2]?.kind).toBe("constructEnd");
    expect(asConstructStart(blocks[3]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "FirstPoint",
    });
    expect(blocks[4]?.kind).toBe("constructEnd");
    expect(asConstructStart(blocks[5]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "SecondPoint",
    });
    expect(blocks[6]?.kind).toBe("constructEnd");
  });

  it("treats a body-level bookmark as content, never as a section break", () => {
    const doc = flowDoc([
      el("w:bookmarkStart", { "w:id": "12", "w:name": "Only" }),
      el("w:p", {}, [textRun("Solo")]),
      el("w:bookmarkEnd", { "w:id": "12" }),
    ]);
    expect(doc.sections).toHaveLength(1);
  });
});

describe("readDocxContent: section-split extent re-indexing and final-section handling", () => {
  function twoSectionDoc(
    trailingBodySectPr: boolean,
  ): ReturnType<typeof readDocxContent> {
    const bodyChildren: XmlElement[] = [
      el("w:p", {}, [textRun("First section")]),
      el("w:p", {}, [
        el("w:pPr", {}, [
          el("w:sectPr", {}, [
            el("w:pgSz", { "w:w": "12240", "w:h": "15840" }),
          ]),
        ]),
        textRun("Break paragraph"),
      ]),
      el("w:bookmarkStart", { "w:id": "20", "w:name": "SecondHalf" }),
      el("w:p", {}, [textRun("Second section")]),
      el("w:bookmarkEnd", { "w:id": "20" }),
    ];
    if (trailingBodySectPr) {
      bodyChildren.push(
        el("w:sectPr", {}, [el("w:pgSz", { "w:w": "12240", "w:h": "15840" })]),
      );
    }
    const body = el("w:body", {}, bodyChildren);
    return readDocxContent({
      parts: {
        "word/document.xml": {
          kind: "xml",
          nodes: [el("w:document", {}, [body])],
        },
      },
    });
  }

  it("re-indexes a construct into the second section's own coordinates and keeps it out of the first", () => {
    const doc = twoSectionDoc(true);
    expect(doc.sections).toHaveLength(2);
    const first = doc.sections[0]?.blocks ?? [];
    const second = doc.sections[1]?.blocks ?? [];
    expect(first.every((b) => b.kind !== "constructStart")).toBe(true);
    expect(
      first.map((b) => (b.kind === "paragraph" ? b.runs[0]?.text : b.kind)),
    ).toEqual(["First section", "Break paragraph"]);
    expect(asConstructStart(second[0]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "SecondHalf",
    });
    expect(asParagraph(second[1]).runs[0]?.text).toBe("Second section");
    expect(second[2]?.kind).toBe("constructEnd");
  });

  it("keeps the trailing section after a mid-document break even with no body-level sectPr", () => {
    const doc = twoSectionDoc(false);
    expect(doc.sections).toHaveLength(2);
    expect(asParagraph(doc.sections[1]?.blocks[1]).runs[0]?.text).toBe(
      "Second section",
    );
    expect(doc.sectionHeaderFooters).toStrictEqual([{}, {}]);
  });

  it("leaves breakType absent as a key on a section whose sectPr spells no w:type", () => {
    const doc = twoSectionDoc(false);
    expect(Object.hasOwn(doc.sections[1]!, "breakType")).toBe(false);
  });
});

describe("readDocxContent: table column and merge arithmetic", () => {
  function vMergeTable(
    topRestart: XmlElement,
    bottomContinue: XmlElement,
  ): XmlElement {
    return el("w:tbl", {}, [
      el("w:tblGrid", {}, [
        el("w:gridCol", { "w:w": "1440" }),
        el("w:gridCol", { "w:w": "2880" }),
      ]),
      el("w:tr", {}, [
        el("w:tc", {}, [el("w:p", {}, [textRun("left top")])]),
        topRestart,
      ]),
      el("w:tr", {}, [
        el("w:tc", {}, [el("w:p", {}, [textRun("left bottom")])]),
        bottomContinue,
      ]),
    ]);
  }

  it("derives a vertical merge's rowSpan on the second column from grid-column indices with plain unspanned cells", () => {
    const restart = el("w:tc", {}, [
      el("w:tcPr", {}, [el("w:vMerge", { "w:val": "restart" })]),
      el("w:p", {}, [textRun("merged")]),
    ]);
    const continuation = el("w:tc", {}, [
      el("w:tcPr", {}, [el("w:vMerge")]),
      el("w:p", {}, [textRun("hidden")]),
    ]);
    const doc = readDocxContent(
      paragraphPackage(vMergeTable(restart, continuation)),
    );
    const rows = asTable(doc.sections[0]?.blocks[0]).rows;
    expect(rows[0]?.cells[1]?.rowSpan).toBe(2);
    expect(rows[1]?.cells[1]).toStrictEqual({
      blocks: [],
      background: undefined,
      borders: undefined,
    });
  });

  it("keeps a vertical continuation's own shading rather than discarding the covered cell", () => {
    const restart = el("w:tc", {}, [
      el("w:tcPr", {}, [el("w:vMerge", { "w:val": "restart" })]),
      el("w:p", {}, [textRun("merged")]),
    ]);
    const continuation = el("w:tc", {}, [
      el("w:tcPr", {}, [
        el("w:vMerge"),
        el("w:shd", { "w:val": "clear", "w:fill": "FF0000" }),
      ]),
      el("w:p", {}, [textRun("hidden")]),
    ]);
    const doc = readDocxContent(
      paragraphPackage(vMergeTable(restart, continuation)),
    );
    const rows = asTable(doc.sections[0]?.blocks[0]).rows;
    expect(rows[1]?.cells[1]?.background).toEqual({
      kind: "solid",
      color: rgbHexToColor("FF0000"),
    });
    expect(rows[1]?.cells[1]?.blocks).toEqual([]);
  });

  it("supplies a cell at every column a w:gridSpan covers, so array index is grid column", () => {
    const table = el("w:tbl", {}, [
      el("w:tblGrid", {}, [
        el("w:gridCol", { "w:w": "1440" }),
        el("w:gridCol", { "w:w": "1440" }),
        el("w:gridCol", { "w:w": "1440" }),
      ]),
      el("w:tr", {}, [
        el("w:tc", {}, [
          el("w:tcPr", {}, [el("w:gridSpan", { "w:val": "2" })]),
          el("w:p", {}, [textRun("Region")]),
        ]),
        el("w:tc", {}, [el("w:p", {}, [textRun("Revenue")])]),
      ]),
    ]);
    const rows = asTable(
      readDocxContent(paragraphPackage(table)).sections[0]?.blocks[0],
    ).rows;
    expect(rows[0]?.cells.length).toBe(3);
    expect(rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(rows[0]?.cells[1]?.blocks).toEqual([]);
    expect(rows[0]?.cells[2]?.colSpan).toBeUndefined();
  });

  it("reads a grid column with no @w:w as zero width", () => {
    const table = el("w:tbl", {}, [
      el("w:tblGrid", {}, [
        el("w:gridCol", { "w:w": "1440" }),
        el("w:gridCol", {}),
      ]),
      el("w:tr", {}, [
        el("w:tc", {}, [el("w:p", {}, [textRun("a")])]),
        el("w:tc", {}, [el("w:p", {}, [textRun("b")])]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(table));
    expect(asTable(doc.sections[0]?.blocks[0]).columnWidthsPt).toEqual([72, 0]);
  });
});

describe("readDocxContent: range-marker pairing and tracked-paragraph qualification", () => {
  it("drops a bookmark pair whose id has two end halves", () => {
    const body = el("w:body", {}, [
      el("w:bookmarkStart", { "w:id": "1", "w:name": "Ambiguous" }),
      el("w:p", {}, [textRun("Bracketed")]),
      el("w:bookmarkEnd", { "w:id": "1" }),
      el("w:bookmarkEnd", { "w:id": "1" }),
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
    expect(
      doc.sections[0]?.blocks.every((b) => b.kind !== "constructStart"),
    ).toBe(true);
  });

  it("emits no provenance extent for a paragraph mixing tracked and untracked children", () => {
    const paragraph = el("w:p", {}, [
      el(
        "w:ins",
        { "w:id": "1", "w:author": "Ed", "w:date": "2024-01-01T00:00:00Z" },
        [textRun("tracked")],
      ),
      textRun("untracked"),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(
      doc.sections[0]?.blocks.every((b) => b.kind !== "constructStart"),
    ).toBe(true);
    expect(
      asParagraph(doc.sections[0]?.blocks[0]).runs.map((r) => r.text),
    ).toEqual(["tracked", "untracked"]);
  });

  it("emits a provenance extent for a paragraph whose every content child is the same insertion", () => {
    const paragraph = el("w:p", {}, [
      el(
        "w:ins",
        { "w:id": "1", "w:author": "Ann", "w:date": "2024-01-01T00:00:00Z" },
        [textRun("first")],
      ),
      el(
        "w:ins",
        { "w:id": "2", "w:author": "Ann", "w:date": "2024-01-01T00:00:00Z" },
        [textRun("second")],
      ),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(asConstructStart(doc.sections[0]?.blocks[0]).descriptor).toEqual({
      kind: "provenance",
      change: "insertion",
      author: "Ann",
      dateIso: "2024-01-01T00:00:00Z",
    });
    expect(
      asParagraph(doc.sections[0]?.blocks[1]).runs.map((r) => r.text),
    ).toEqual(["first", "second"]);
    expect(doc.sections[0]?.blocks[2]?.kind).toBe("constructEnd");
  });
});

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
    expect(blocks).toHaveLength(3);
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
    expect(anchorOf(doc).anchorOffset).toBe(3);
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
    expect(anchorOf(doc).anchorOffset).toBe(3);
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
    expect(anchorOf(doc).anchorOffset).toBe(3);
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

  function flowDoc(children: XmlElement[]): ReturnType<typeof readDocxContent> {
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
