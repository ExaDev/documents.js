import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentConstructStart,
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

function textRun(text: string): XmlElement {
  return el("w:r", {}, [el("w:t", { "xml:space": "preserve" }, [txt(text)])]);
}

function firstParagraph(
  doc: ReturnType<typeof readDocxContent>,
): ContentParagraph {
  return asParagraph(doc.sections[0]?.blocks[0]);
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
    // Heading1's own sz val="36" half-points, halved to 18pt, overriding docDefaults' own 20 half-points (10pt).
    const HEADING1_SIZE_PT = 18;
    expect(title.runs[0]?.sizePt).toBe(HEADING1_SIZE_PT);
    expect(title.runs[0]?.bold).toBe(true); // from Heading1
  });

  it("resolves a theme font reference from the default style", () => {
    const doc = readDocxContent(buildFixturePackage());
    // blocks: [0]=title [1]=pageBreak [2]=pageBreakPara [3]=hyperlinkPara [4]=the field's own constructStart [5]=fieldPara — the field paragraph's run inherits Normal's asciiTheme reference (no style of its own).
    const fieldPara = asParagraph(doc.sections[0]?.blocks[5]);
    expect(fieldPara.runs[0]?.fontFamily).toBe("Minor Font");
  });
});

// A dedicated minimal fixture for heading-level resolution: a built-in Heading2 carrying its own w:outlineLvl, a custom style based on it (the case name-matching the styleId against /^Heading\d+$/ silently misses), a paragraph with a direct w:pPr/w:outlineLvl, one beyond the schema's six-level heading domain, and one with no outline level anywhere in its cascade.
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
    // The schema's ContentHeading domain tops out at level 6; Word's own outline levels run 1-9, so anything from 6 upward narrows onto this same top level.
    const MAX_SCHEMA_HEADING_LEVEL = 6;
    expect(asParagraph(doc.sections[0]?.blocks[3]).headingLevel).toBe(
      MAX_SCHEMA_HEADING_LEVEL,
    );
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
