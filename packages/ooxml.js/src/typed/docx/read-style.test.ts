import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentParagraph,
  ContentTable,
} from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { readDocxContent } from "./read";
import { buildDocxPackageFromContent } from "./write";
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

function firstParagraph(
  doc: ReturnType<typeof readDocxContent>,
): ContentParagraph {
  return asParagraph(doc.sections[0]?.blocks[0]);
}

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
    // The named character style supersedes its basedOn chain: the chain says superscript, the direct rPr turns it back off, and the resolved run carries no verticalAlign — baseline, the schema's own spelling of the field's absence.
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
    // Both gridCol widths are 2880 twips in the fixture below (twipsToPt(2880)).
    const GRID_COL_WIDTH_PT = 144;
    expect(table.columns.map((c) => c.widthPt)).toEqual([
      GRID_COL_WIDTH_PT,
      GRID_COL_WIDTH_PT,
    ]);
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
    // The vMerge anchor plus its two continuation rows below.
    const MERGED_CELL_ROW_SPAN = 3;
    expect(table.rows[1]?.cells[0]?.rowSpan).toBe(MERGED_CELL_ROW_SPAN);
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
    // 560 twips (twipsToPt(560)); a 5-digit precision is tighter than this exact division needs but costs nothing.
    const ROW_HEIGHT_PT = 28;
    const ROW_HEIGHT_PRECISION = 5;
    expect(table.rows[0]?.heightPt).toBeCloseTo(
      ROW_HEIGHT_PT,
      ROW_HEIGHT_PRECISION,
    );
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
