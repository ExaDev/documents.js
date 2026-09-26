import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentConstructStart,
  ContentImageBlock,
  ContentParagraph,
  ContentTable,
} from "document-schema.js";
import { rgbHexToColor } from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { bytesToBase64 } from "byte-codec";
import { minimalXlsxBytes } from "../../test-support/embedded";
import { eighthPointsToPt } from "../shared/units";
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
    // Every paragraph between begin and end — including the begin/code/separate/end paragraphs' own, mostly-empty, paragraph blocks — stays inside the marker pair; only the result paragraph carries real text.
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
    // Half a point in eighth-point units, the default this test's own name describes for a missing @w:sz.
    const DEFAULT_BORDER_WIDTH_EIGHTH_POINTS = 4;
    expect(table.rows[0]?.cells[0]?.borders?.left).toEqual({
      color: rgbHexToColor("112233"),
      widthPt: eighthPointsToPt(DEFAULT_BORDER_WIDTH_EIGHTH_POINTS),
      style: "solid",
    });
    expect(table.rows[0]?.cells[0]?.borders?.right).toEqual({
      color: rgbHexToColor("445566"),
      widthPt: eighthPointsToPt(DEFAULT_BORDER_WIDTH_EIGHTH_POINTS),
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
    // Matches this fixture's own w:right/@w:sz="16" (2pt).
    const BORDER_WIDTH_EIGHTH_POINTS = 16;
    const table = tableWithCellBorders(
      el("w:tcBorders", {}, [
        el("w:right", {
          "w:val": "single",
          "w:sz": String(BORDER_WIDTH_EIGHTH_POINTS),
          "w:color": "010203",
        }),
      ]),
    );
    expect(table.rows[0]?.cells[0]?.borders).toEqual({
      right: {
        color: rgbHexToColor("010203"),
        widthPt: eighthPointsToPt(BORDER_WIDTH_EIGHTH_POINTS),
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

  function headerFlagsOf(rows: readonly XmlElement[]): (boolean | undefined)[] {
    const table = el("w:tbl", {}, [
      el("w:tblGrid", {}, [el("w:gridCol", { "w:w": "1440" })]),
      ...rows,
    ]);
    return asTable(
      readDocxContent(paragraphPackage(table)).sections[0]?.blocks[0],
    ).rows.map((row) => row.isHeader);
  }

  function rowWithTrPr(children: readonly XmlElement[]): XmlElement {
    return el("w:tr", {}, [
      el("w:trPr", {}, children),
      el("w:tc", {}, [el("w:p", {}, [textRun("a")])]),
    ]);
  }

  it("reads w:trPr/w:tblHeader into the row's own isHeader, and leaves a row without one unflagged", () => {
    expect(
      headerFlagsOf([
        rowWithTrPr([el("w:tblHeader", {})]),
        rowWithTrPr([]),
        el("w:tr", {}, [el("w:tc", {}, [el("w:p", {}, [textRun("b")])])]),
      ]),
    ).toEqual([true, undefined, undefined]);
  });

  it("reads w:tblHeader as the on/off property it is, so an explicitly disabled one is not a header", () => {
    expect(
      headerFlagsOf([
        rowWithTrPr([el("w:tblHeader", { "w:val": "true" })]),
        rowWithTrPr([el("w:tblHeader", { "w:val": "1" })]),
        rowWithTrPr([el("w:tblHeader", { "w:val": "0" })]),
        rowWithTrPr([el("w:tblHeader", { "w:val": "false" })]),
      ]),
    ).toEqual([true, true, undefined, undefined]);
  });

  // Word only repeats a mid-table header row when every row above it is marked too, but that is its own rendering rule: the reader states what the file states, so the flag is not quietly moved or dropped on the way in.
  it("reads a header flag on a row that is neither the first nor contiguous with the first", () => {
    expect(
      headerFlagsOf([
        rowWithTrPr([]),
        rowWithTrPr([el("w:tblHeader", {})]),
        rowWithTrPr([]),
        rowWithTrPr([el("w:tblHeader", {})]),
      ]),
    ).toEqual([undefined, true, undefined, true]);
  });
});
