import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import type { ContentBlock, ContentParagraph } from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { bytesToBase64 } from "byte-codec";
import { PNG_SIGNATURE } from "../../image/sniff";
import { readPptxContent } from "./read";
function asParagraph(block: ContentBlock | undefined): ContentParagraph {
  if (block?.kind !== "paragraph") {
    throw new Error("expected a paragraph block");
  }
  return block;
}

const SLIDE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const SLIDE_LAYOUT_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";
const SLIDE_MASTER_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster";
const THEME_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";
const IMAGE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const HYPERLINK_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const NOTES_SLIDE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";
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

// Only the PNG magic-byte signature matters to sniffImageFormat — the rest is arbitrary filler, not a real encoded image.
function tinyPngBase64(): string {
  const bytes = new Uint8Array([...PNG_SIGNATURE, 0, 0, 0, 0]);
  return bytesToBase64(bytes);
}

function buildFixturePackage(): Package {
  // --- slide1: title placeholder (inherited geometry + run cascade), hyperlink, underline/strike, image, table, group.
  const titleRun1 = el("a:r", {}, [el("a:t", {}, [txt("Hello")])]); // no own rPr: fully inherits from master titleStyle
  const titleRun2 = el("a:r", {}, [
    el("a:rPr", { sz: "2000", i: "1" }),
    el("a:t", {}, [txt(" World")]),
  ]); // explicit size+italic override, rest inherited
  const titlePara = el("a:p", {}, [titleRun1, titleRun2]);
  const titleShape = el("p:sp", {}, [
    el("p:nvSpPr", {}, [
      el("p:cNvPr", { id: "2", name: "Title 1" }),
      el("p:cNvSpPr"),
      el("p:nvPr", {}, [el("p:ph", { type: "title" })]),
    ]),
    el("p:spPr"), // no own xfrm — must inherit from layout
    el("p:txBody", {}, [titlePara]),
  ]);

  const hyperlinkRun = el("a:r", {}, [
    el("a:rPr", {}, [el("a:hlinkClick", { "r:id": "rIdHlink" })]),
    el("a:t", {}, [txt("link text")]),
  ]);
  const styledRun = el("a:r", {}, [
    el("a:rPr", { u: "sng", strike: "sngStrike" }),
    el("a:t", {}, [txt("styled")]),
  ]);
  const bodyPara = el("a:p", {}, [
    el("a:pPr", { algn: "ctr", marL: "457200", indent: "-457200" }, [
      el("a:spcBef", {}, [el("a:spcPts", { val: "600" })]),
      el("a:lnSpc", {}, [el("a:spcPct", { val: "150000" })]),
    ]),
    hyperlinkRun,
    styledRun,
  ]);
  const bodyShape = el("p:sp", {}, [
    el("p:nvSpPr", {}, [
      el("p:cNvPr", { id: "3", name: "Body 1" }),
      el("p:cNvSpPr"),
      el("p:nvPr"),
    ]),
    el("p:spPr", {}, [
      el("a:xfrm", {}, [
        el("a:off", { x: "914400", y: "2286000" }),
        el("a:ext", { cx: "3657600", cy: "914400" }),
      ]),
    ]),
    el("p:txBody", {}, [
      el(
        "a:bodyPr",
        { lIns: "182880", tIns: "91440", rIns: "182880", bIns: "91440" },
        [el("a:normAutofit", { fontScale: "92000", lnSpcReduction: "10000" })],
      ),
      bodyPara,
    ]),
  ]);

  const picShape = el("p:pic", {}, [
    el("p:nvPicPr", {}, [
      el("p:cNvPr", { id: "4", name: "Picture 1", descr: "A red circle" }),
      el("p:cNvPicPr"),
      el("p:nvPr"),
    ]),
    el("p:blipFill", {}, [el("a:blip", { "r:embed": "rIdImage" })]),
    el("p:spPr", {}, [
      el("a:xfrm", {}, [
        el("a:off", { x: "635000", y: "635000" }),
        el("a:ext", { cx: "1016000", cy: "1016000" }),
      ]),
    ]),
  ]);

  const mergedCell = el("a:tc", { gridSpan: "2" }, [
    el("a:txBody", {}, [
      el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt("Merged")])])]),
    ]),
  ]);
  const continuationCell = el("a:tc", { hMerge: "1" }, [
    el("a:txBody", {}, [el("a:p")]),
  ]);
  const cellA = el("a:tc", {}, [
    el("a:tcPr", {}, [
      el("a:solidFill", {}, [el("a:srgbClr", { val: "FF0000" })]),
      el("a:lnL", { w: "12700" }, [
        el("a:solidFill", {}, [el("a:srgbClr", { val: "0000FF" })]),
      ]),
      el("a:lnR", { w: "25400" }, [
        el("a:solidFill", {}, [el("a:srgbClr", { val: "00FF00" })]),
        el("a:prstDash", { val: "dash" }),
      ]),
      el("a:lnT", { w: "6350" }, [
        el("a:solidFill", {}, [el("a:srgbClr", { val: "FFFF00" })]),
        el("a:prstDash", { val: "dot" }),
      ]),
      el("a:lnB", { w: "19050" }, [
        el("a:solidFill", {}, [el("a:srgbClr", { val: "000000" })]),
        el("a:prstDash", { val: "solid" }),
      ]),
    ]),
    el("a:txBody", {}, [
      el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt("A")])])]),
    ]),
  ]);
  const cellB = el("a:tc", {}, [
    el("a:txBody", {}, [
      el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt("B")])])]),
    ]),
  ]);
  const cellAllEdgesUnresolvable = el("a:tc", {}, [
    el("a:tcPr", {}, [
      el("a:lnL", {}, [
        el("a:solidFill", {}, [el("a:srgbClr", { val: "0000FF" })]),
      ]), // missing @w
      el("a:lnR", { w: "12700" }, [el("a:noFill")]), // explicit noFill, no colour
      // a:lnT/a:lnB absent entirely
    ]),
    el("a:txBody", {}, [
      el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt("C")])])]),
    ]),
  ]);
  const cellZeroWidthAndUnknownDash = el("a:tc", {}, [
    el("a:tcPr", {}, [
      el("a:lnL", { w: "0" }, [
        el("a:solidFill", {}, [el("a:srgbClr", { val: "0000FF" })]),
      ]), // resolved width is zero — not visually a border
      el("a:lnR", { w: "12700" }, [
        el("a:solidFill", {}, [el("a:srgbClr", { val: "0000FF" })]),
        el("a:prstDash", { val: "notARealPrstDashValue" }),
      ]), // unrecognised dash token defaults to 'solid' rather than being dropped
    ]),
    el("a:txBody", {}, [
      el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt("D")])])]),
    ]),
  ]);
  const cellNonNumericWidth = el("a:tc", {}, [
    el("a:tcPr", {}, [
      el("a:lnL", { w: "abc" }, [
        el("a:solidFill", {}, [el("a:srgbClr", { val: "0000FF" })]),
      ]), // @w is not a number at all — not just zero
      el("a:lnR", { w: "12700" }, [
        el("a:solidFill", {}, [el("a:srgbClr", { val: "FF00FF" })]),
      ]),
    ]),
    el("a:txBody", {}, [
      el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt("E")])])]),
    ]),
  ]);
  const cellF = el("a:tc", {}, [
    el("a:txBody", {}, [
      el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt("F")])])]),
    ]),
  ]);
  const cellPatternFill = el("a:tc", {}, [
    el("a:tcPr", {}, [
      el("a:pattFill", { prst: "pct25" }, [
        el("a:fgClr", {}, [el("a:srgbClr", { val: "00FF00" })]),
        el("a:bgClr", {}, [el("a:srgbClr", { val: "0000FF" })]),
      ]),
    ]),
    el("a:txBody", {}, [
      el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt("G")])])]),
    ]),
  ]);
  const cellUnmappedPatternFill = el("a:tc", {}, [
    el("a:tcPr", {}, [
      // ST_PresetPatternVal has 54 members; "sphere" is one of the 42 with no ContentCellPatternTypeSchema counterpart.
      el("a:pattFill", { prst: "sphere" }, [
        el("a:fgClr", {}, [el("a:srgbClr", { val: "00FF00" })]),
        el("a:bgClr", {}, [el("a:srgbClr", { val: "0000FF" })]),
      ]),
    ]),
    el("a:txBody", {}, [
      el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt("H")])])]),
    ]),
  ]);
  const tbl = el("a:tbl", {}, [
    el("a:tblGrid", {}, [
      el("a:gridCol", { w: "1270000" }),
      el("a:gridCol", { w: "1905000" }),
    ]),
    el("a:tr", { h: "457200" }, [mergedCell, continuationCell]),
    el("a:tr", {}, [cellA, cellB]),
    el("a:tr", {}, [cellAllEdgesUnresolvable, cellZeroWidthAndUnknownDash]),
    el("a:tr", {}, [cellNonNumericWidth, cellF]),
    el("a:tr", {}, [cellPatternFill, cellUnmappedPatternFill]),
  ]);
  const tableFrame = el("p:graphicFrame", {}, [
    el("p:nvGraphicFramePr", {}, [el("p:cNvPr", { id: "5", name: "Table 1" })]),
    el("p:xfrm", {}, [
      el("a:off", { x: "914400", y: "3657600" }),
      el("a:ext", { cx: "3175000", cy: "914400" }),
    ]),
    el("a:graphic", {}, [
      el(
        "a:graphicData",
        { uri: "http://schemas.openxmlformats.org/drawingml/2006/table" },
        [tbl],
      ),
    ]),
  ]);

  const groupChildShape = el("p:sp", {}, [
    el("p:nvSpPr", {}, [
      el("p:cNvPr", { id: "7", name: "Grouped shape" }),
      el("p:cNvSpPr"),
      el("p:nvPr"),
    ]),
    el("p:spPr", {}, [
      el("a:xfrm", {}, [
        el("a:off", { x: "127000", y: "127000" }),
        el("a:ext", { cx: "254000", cy: "254000" }),
      ]),
    ]),
    el("p:txBody", {}, [
      el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt("Grouped")])])]),
    ]),
  ]);
  const groupShape = el("p:grpSp", {}, [
    el("p:nvGrpSpPr", {}, [el("p:cNvPr", { id: "6", name: "Group 1" })]),
    el("p:grpSpPr", {}, [
      el("a:xfrm", {}, [
        el("a:off", { x: "1270000", y: "1270000" }),
        el("a:ext", { cx: "2540000", cy: "2540000" }),
        el("a:chOff", { x: "0", y: "0" }),
        el("a:chExt", { cx: "1270000", cy: "1270000" }),
      ]),
    ]),
    groupChildShape,
  ]);

  const spTree1 = el("p:spTree", {}, [
    titleShape,
    bodyShape,
    picShape,
    tableFrame,
    groupShape,
  ]);
  const slide1 = el("p:sld", {}, [el("p:cSld", {}, [spTree1])]);

  const slide1Rels = rels([
    {
      id: "rIdLayout",
      type: SLIDE_LAYOUT_REL,
      target: "../slideLayouts/slideLayout1.xml",
    },
    { id: "rIdImage", type: IMAGE_REL, target: "../media/image1.png" },
    {
      id: "rIdHlink",
      type: HYPERLINK_REL,
      target: "https://example.com",
      external: true,
    },
    {
      id: "rIdNotes",
      type: NOTES_SLIDE_REL,
      target: "../notesSlides/notesSlide1.xml",
    },
  ]);

  // --- slide2: standalone, rotated shape, no layout/master.
  const slide2Shape = el("p:sp", {}, [
    el("p:nvSpPr", {}, [
      el("p:cNvPr", { id: "2", name: "Rotated" }),
      el("p:cNvSpPr"),
      el("p:nvPr"),
    ]),
    el("p:spPr", {}, [
      el("a:xfrm", { rot: "2700000" }, [
        el("a:off", { x: "127000", y: "127000" }),
        el("a:ext", { cx: "635000", cy: "635000" }),
      ]),
    ]),
    el("p:txBody", {}, [
      el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt("Second Slide")])])]),
    ]),
  ]);
  const slide2 = el("p:sld", {}, [
    el("p:cSld", {}, [el("p:spTree", {}, [slide2Shape])]),
  ]);

  // --- notesSlide1: a body placeholder with the actual speaker notes.
  const notesShape = el("p:sp", {}, [
    el("p:nvSpPr", {}, [
      el("p:cNvPr", { id: "2", name: "Notes Placeholder" }),
      el("p:cNvSpPr"),
      el("p:nvPr", {}, [el("p:ph", { type: "body", idx: "1" })]),
    ]),
    el("p:spPr"),
    el("p:txBody", {}, [
      el("a:p", {}, [
        el("a:r", {}, [el("a:t", {}, [txt("Speaker notes here")])]),
      ]),
    ]),
  ]);
  const slideNumShape = el("p:sp", {}, [
    el("p:nvSpPr", {}, [
      el("p:cNvPr", { id: "3", name: "Slide Number Placeholder" }),
      el("p:cNvSpPr"),
      el("p:nvPr", {}, [el("p:ph", { type: "sldNum", idx: "2" })]),
    ]),
    el("p:spPr"),
    el("p:txBody", {}, [
      el("a:p", {}, [
        el(
          "a:fld",
          { id: "{00000000-0000-0000-0000-000000000000}", type: "slidenum" },
          [el("a:t", {}, [txt("1")])],
        ),
      ]),
    ]),
  ]);
  const notesSlide1 = el("p:notes", {}, [
    el("p:cSld", {}, [el("p:spTree", {}, [notesShape, slideNumShape])]),
  ]);

  // --- layout: title placeholder with the geometry the slide's own title inherits.
  const layoutTitleShape = el("p:sp", {}, [
    el("p:nvSpPr", {}, [
      el("p:cNvPr", { id: "2", name: "Title Placeholder" }),
      el("p:cNvSpPr"),
      el("p:nvPr", {}, [el("p:ph", { type: "title" })]),
    ]),
    el("p:spPr", {}, [
      el("a:xfrm", {}, [
        el("a:off", { x: "914400", y: "457200" }),
        el("a:ext", { cx: "10363200", cy: "1143000" }),
      ]),
    ]),
  ]);
  const layout1 = el("p:sldLayout", {}, [
    el("p:cSld", {}, [el("p:spTree", {}, [layoutTitleShape])]),
  ]);
  const layout1Rels = rels([
    {
      id: "rId1",
      type: SLIDE_MASTER_REL,
      target: "../slideMasters/slideMaster1.xml",
    },
  ]);

  // --- master: clrMap, txStyles (the run-property cascade the title/body text inherits).
  const master1 = el("p:sldMaster", {}, [
    el("p:cSld", {}, [el("p:spTree")]),
    el("p:clrMap", {
      bg1: "lt1",
      tx1: "dk1",
      bg2: "lt2",
      tx2: "dk2",
      accent1: "accent1",
      accent2: "accent2",
      accent3: "accent3",
      accent4: "accent4",
      accent5: "accent5",
      accent6: "accent6",
      hlink: "hlink",
      folHlink: "folHlink",
    }),
    el("p:txStyles", {}, [
      el("p:titleStyle", {}, [
        el("a:lvl1pPr", {}, [
          el("a:defRPr", { sz: "4400", b: "1" }, [
            el("a:latin", { typeface: "+mj-lt" }),
            el("a:solidFill", {}, [el("a:schemeClr", { val: "tx1" })]),
          ]),
        ]),
      ]),
      el("p:bodyStyle", {}, [
        el("a:lvl1pPr", {}, [el("a:defRPr", { sz: "1800" })]),
      ]),
      el("p:otherStyle", {}, [
        el("a:lvl1pPr", {}, [el("a:defRPr", { sz: "1200" })]),
      ]),
    ]),
  ]);
  const master1Rels = rels([
    { id: "rId1", type: THEME_REL, target: "../theme/theme1.xml" },
  ]);

  const theme1 = el("a:theme", {}, [
    el("a:themeElements", {}, [
      el("a:clrScheme", {}, [
        el("a:dk1", {}, [
          el("a:sysClr", { val: "windowText", lastClr: "000000" }),
        ]),
        el("a:lt1", {}, [el("a:sysClr", { val: "window", lastClr: "FFFFFF" })]),
      ]),
      el("a:fontScheme", {}, [
        el("a:majorFont", {}, [el("a:latin", { typeface: "Aptos Display" })]),
        el("a:minorFont", {}, [el("a:latin", { typeface: "Aptos" })]),
      ]),
    ]),
  ]);

  const presentation = el("p:presentation", {}, [
    el("p:sldIdLst", {}, [
      el("p:sldId", { id: "257", "r:id": "rIdSlide2" }),
      el("p:sldId", { id: "256", "r:id": "rIdSlide1" }),
    ]),
    el("p:sldSz", { cx: "12192000", cy: "6858000" }),
  ]);
  const presentationRels = rels([
    { id: "rIdSlide2", type: SLIDE_REL, target: "slides/slide2.xml" },
    { id: "rIdSlide1", type: SLIDE_REL, target: "slides/slide1.xml" },
  ]);

  const core = el("cp:coreProperties", {}, [
    el("dc:title", {}, [txt("Fixture Deck")]),
  ]);

  return {
    parts: {
      "ppt/presentation.xml": { kind: "xml", nodes: [presentation] },
      "ppt/_rels/presentation.xml.rels": {
        kind: "xml",
        nodes: [presentationRels],
      },
      "ppt/slides/slide1.xml": { kind: "xml", nodes: [slide1] },
      "ppt/slides/_rels/slide1.xml.rels": { kind: "xml", nodes: [slide1Rels] },
      "ppt/slides/slide2.xml": { kind: "xml", nodes: [slide2] },
      "ppt/notesSlides/notesSlide1.xml": { kind: "xml", nodes: [notesSlide1] },
      "ppt/slideLayouts/slideLayout1.xml": { kind: "xml", nodes: [layout1] },
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels": {
        kind: "xml",
        nodes: [layout1Rels],
      },
      "ppt/slideMasters/slideMaster1.xml": { kind: "xml", nodes: [master1] },
      "ppt/slideMasters/_rels/slideMaster1.xml.rels": {
        kind: "xml",
        nodes: [master1Rels],
      },
      "ppt/theme/theme1.xml": { kind: "xml", nodes: [theme1] },
      "ppt/media/image1.png": { kind: "binary", base64: tinyPngBase64() },
      "docProps/core.xml": { kind: "xml", nodes: [core] },
    },
  };
}

describe("readPptxContent: slide size and order", () => {
  it("reads slide size from p:sldSz", () => {
    const doc = readPptxContent(buildFixturePackage());
    expect(doc.slides[0]?.size).toEqual({ widthPt: 960, heightPt: 540 });
  });

  it("orders slides via p:sldIdLst, not slide filename order", () => {
    const doc = readPptxContent(buildFixturePackage());
    // sldIdLst lists slide2 before slide1, so slides[0] must be slide2's content ("Second Slide").
    const firstShapeText = asParagraph(doc.slides[0]?.shapes[0]?.blocks[0])
      .runs[0]?.text;
    expect(firstShapeText).toBe("Second Slide");
  });

  it("reads document metadata via readCoreProperties", () => {
    const doc = readPptxContent(buildFixturePackage());
    expect(doc.metadata.title).toBe("Fixture Deck");
  });
});

describe("readPptxContent: placeholder inheritance and run cascade", () => {
  it("inherits the title placeholder's geometry from the layout when the slide has none of its own", () => {
    const doc = readPptxContent(buildFixturePackage());
    const titleShape = doc.slides[1]?.shapes.find((s) => s.name === "Title 1");
    expect(titleShape?.frame).toEqual({
      xPt: 72,
      yPt: 36,
      widthPt: 816,
      heightPt: 90,
    });
  });

  it("a run with no own rPr fully inherits size/bold/font/colour from the master titleStyle", () => {
    const doc = readPptxContent(buildFixturePackage());
    const titleShape = doc.slides[1]?.shapes.find((s) => s.name === "Title 1");
    const run = asParagraph(titleShape?.blocks[0]).runs[0];
    expect(run?.text).toBe("Hello");
    const MASTER_TITLE_STYLE_SIZE_PT = 44; // the fixture's own master titleStyle font size, inherited since this run sets no own rPr
    expect(run?.sizePt).toBe(MASTER_TITLE_STYLE_SIZE_PT);
    expect(run?.bold).toBe(true);
    expect(run?.fontFamily).toBe("Aptos Display"); // +mj-lt resolved via the theme
    expect(run?.color).toEqual({ r: 0, g: 0, b: 0 }); // tx1 -> dk1 via clrMap -> black
  });

  it("a run's own explicit properties override the cascade only for the fields it sets", () => {
    const doc = readPptxContent(buildFixturePackage());
    const titleShape = doc.slides[1]?.shapes.find((s) => s.name === "Title 1");
    const run = asParagraph(titleShape?.blocks[0]).runs[1];
    expect(run?.text).toBe(" World");
    const OVERRIDDEN_RUN_SIZE_PT = 20; // this run's own direct rPr size, overriding the master titleStyle
    expect(run?.sizePt).toBe(OVERRIDDEN_RUN_SIZE_PT); // overridden
    expect(run?.italic).toBe(true); // overridden
    expect(run?.bold).toBe(true); // still inherited from the master
    expect(run?.fontFamily).toBe("Aptos Display"); // still inherited
  });
});

describe("readPptxContent: paragraph formatting", () => {
  it("reads alignment, indent, absolute spacing, and percentage line spacing", () => {
    const doc = readPptxContent(buildFixturePackage());
    const bodyShape = doc.slides[1]?.shapes.find((s) => s.name === "Body 1");
    const para = asParagraph(bodyShape?.blocks[0]);
    expect(para.alignment).toBe("center");
    // The fixture's own explicit paragraph-formatting values: a positive left indent, an equal-magnitude negative first-line indent (a hanging indent back to the margin), an absolute spacing-before, and a 150% line-spacing multiplier.
    const FIXTURE_INDENT_LEFT_PT = 36;
    const FIXTURE_HANGING_INDENT_PT = -36;
    const FIXTURE_SPACING_BEFORE_PT = 6;
    const FIXTURE_LINE_SPACING_MULTIPLIER = 1.5;
    expect(para.indentLeftPt).toBe(FIXTURE_INDENT_LEFT_PT);
    expect(para.indentFirstLinePt).toBe(FIXTURE_HANGING_INDENT_PT);
    expect(para.spacingBeforePt).toBe(FIXTURE_SPACING_BEFORE_PT);
    expect(para.lineSpacing).toBe(FIXTURE_LINE_SPACING_MULTIPLIER);
  });

  it("resolves an external hyperlink through the slide's own relationships", () => {
    const doc = readPptxContent(buildFixturePackage());
    const bodyShape = doc.slides[1]?.shapes.find((s) => s.name === "Body 1");
    const para = asParagraph(bodyShape?.blocks[0]);
    expect(para.runs[0]?.hyperlink).toBe("https://example.com");
  });

  it("reads underline and strikethrough", () => {
    const doc = readPptxContent(buildFixturePackage());
    const bodyShape = doc.slides[1]?.shapes.find((s) => s.name === "Body 1");
    const para = asParagraph(bodyShape?.blocks[0]);
    expect(para.runs[1]?.underline).toBe(true);
    expect(para.runs[1]?.strike).toBe(true);
  });
});

describe("readPptxContent: text-box insets and autofit", () => {
  it("reads explicit a:bodyPr insets and a:normAutofit scaling", () => {
    const doc = readPptxContent(buildFixturePackage());
    const bodyShape = doc.slides[1]?.shapes.find((s) => s.name === "Body 1");
    // The fixture's own explicit a:bodyPr insets (left/right wider than top/bottom, a common real-world text-box convention) and a:normAutofit scaling (92% font scale, 10% line-spacing reduction).
    const FIXTURE_INSET_LEFT_RIGHT_PT = 14.4;
    const FIXTURE_INSET_TOP_BOTTOM_PT = 7.2;
    const FIXTURE_FONT_SCALE = 0.92;
    const FIXTURE_LINE_SPACING_REDUCTION = 0.1;
    expect(bodyShape?.insetLeftPt).toBe(FIXTURE_INSET_LEFT_RIGHT_PT);
    expect(bodyShape?.insetTopPt).toBe(FIXTURE_INSET_TOP_BOTTOM_PT);
    expect(bodyShape?.insetRightPt).toBe(FIXTURE_INSET_LEFT_RIGHT_PT);
    expect(bodyShape?.insetBottomPt).toBe(FIXTURE_INSET_TOP_BOTTOM_PT);
    expect(bodyShape?.fontScale).toBe(FIXTURE_FONT_SCALE);
    expect(bodyShape?.lineSpacingReduction).toBe(
      FIXTURE_LINE_SPACING_REDUCTION,
    );
  });

  it("falls back to ECMA-376's default insets when a:bodyPr is absent, with no autofit", () => {
    const doc = readPptxContent(buildFixturePackage());
    const titleShape = doc.slides[1]?.shapes.find((s) => s.name === "Title 1");
    // ECMA-376's own default a:bodyPr insets when the element is absent: 0.1 inch left/right, 0.05 inch top/bottom.
    const ECMA376_DEFAULT_INSET_LEFT_RIGHT_PT = 7.2;
    const ECMA376_DEFAULT_INSET_TOP_BOTTOM_PT = 3.6;
    expect(titleShape?.insetLeftPt).toBe(ECMA376_DEFAULT_INSET_LEFT_RIGHT_PT);
    expect(titleShape?.insetTopPt).toBe(ECMA376_DEFAULT_INSET_TOP_BOTTOM_PT);
    expect(titleShape?.insetRightPt).toBe(ECMA376_DEFAULT_INSET_LEFT_RIGHT_PT);
    expect(titleShape?.insetBottomPt).toBe(ECMA376_DEFAULT_INSET_TOP_BOTTOM_PT);
    expect(titleShape?.fontScale).toBeUndefined();
    expect(titleShape?.lineSpacingReduction).toBeUndefined();
  });

  it("reads zero insets for a picture, which has no text body at all", () => {
    const doc = readPptxContent(buildFixturePackage());
    const picShape = doc.slides[1]?.shapes.find((s) => s.name === "Picture 1");
    expect(picShape?.insetLeftPt).toBe(0);
    expect(picShape?.insetTopPt).toBe(0);
    expect(picShape?.insetRightPt).toBe(0);
    expect(picShape?.insetBottomPt).toBe(0);
  });
});
