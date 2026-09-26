import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import { el, txt } from "../../xml/fragment";
import { bytesToBase64 } from "byte-codec";
import { PNG_SIGNATURE } from "../../image/sniff";
import { readPptxContent } from "./read";
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

function smartArtFixturePackage(): Package {
  const para = (...runs: readonly XmlElement[]) => el("a:p", {}, runs);
  const r = (text: string) => el("a:r", {}, [el("a:t", {}, [txt(text)])]);
  const textPt = (
    modelId: string,
    type: string | undefined,
    paragraphs: readonly XmlElement[],
  ): XmlElement =>
    el("dgm:pt", type === undefined ? { modelId } : { modelId, type }, [
      el("dgm:t", {}, [el("a:bodyPr"), el("a:lstStyle"), ...paragraphs]),
    ]);
  const cxn = (srcId: string, destId: string, srcOrd: string, type?: string) =>
    el(
      "dgm:cxn",
      type === undefined
        ? { modelId: `${srcId}-${destId}`, srcId, destId, srcOrd, destOrd: "0" }
        : {
            modelId: `${srcId}-${destId}`,
            type,
            srcId,
            destId,
            srcOrd,
            destOrd: "0",
          },
    );

  const dataModel = el("dgm:dataModel", {}, [
    el("dgm:ptLst", {}, [
      textPt("0", "doc", [para()]),
      textPt("1", undefined, [para(r("Strategy"))]),
      textPt("2", undefined, [para(r("Cost"))]),
      textPt("3", undefined, [para(r("Quality")), para(r("Details"))]),
      textPt("4", undefined, [para()]),
      textPt("5", "asst", [para(r("Assistant"))]),
      textPt("6", "parTrans", [para(r("transition text"))]),
    ]),
    el("dgm:cxnLst", {}, [
      cxn("0", "2", "1"),
      cxn("0", "1", "0"),
      cxn("0", "4", "2"),
      cxn("0", "5", "3"),
      cxn("1", "3", "0"),
      cxn("1", "6", "1"),
      cxn("0", "2", "9", "presOf"),
    ]),
  ]);

  const diagramFrame = el("p:graphicFrame", {}, [
    el("p:nvGraphicFramePr", {}, [
      el("p:cNvPr", { id: "2", name: "Diagram 1" }),
    ]),
    el("p:xfrm", {}, [
      el("a:off", { x: "914400", y: "1828800" }),
      el("a:ext", { cx: "4572000", cy: "2743200" }),
    ]),
    el("a:graphic", {}, [
      el(
        "a:graphicData",
        { uri: "http://schemas.openxmlformats.org/drawingml/2006/diagram" },
        [
          el("dgm:relIds", {
            "r:dm": "rIdDm",
            "r:lo": "rIdLo",
            "r:qs": "rIdQs",
            "r:cs": "rIdCs",
          }),
        ],
      ),
    ]),
  ]);
  const slide = el("p:sld", {}, [
    el("p:cSld", {}, [el("p:spTree", {}, [diagramFrame])]),
  ]);
  const presentation = el("p:presentation", {}, [
    el("p:sldIdLst", {}, [el("p:sldId", { id: "256", "r:id": "rId1" })]),
  ]);
  const presentationRels = rels([
    { id: "rId1", type: SLIDE_REL, target: "slides/slide1.xml" },
  ]);
  const slideRels = rels([
    {
      id: "rIdDm",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData",
      target: "../diagrams/data1.xml",
    },
  ]);

  return {
    parts: {
      "ppt/presentation.xml": { kind: "xml", nodes: [presentation] },
      "ppt/_rels/presentation.xml.rels": {
        kind: "xml",
        nodes: [presentationRels],
      },
      "ppt/slides/slide1.xml": { kind: "xml", nodes: [slide] },
      "ppt/slides/_rels/slide1.xml.rels": { kind: "xml", nodes: [slideRels] },
      "ppt/diagrams/data1.xml": { kind: "xml", nodes: [dataModel] },
    },
  };
}

function minimalSlidePackage(
  shapes: readonly ReturnType<typeof el>[],
): Package {
  const slide = el("p:sld", {}, [
    el("p:cSld", {}, [el("p:spTree", {}, shapes)]),
  ]);
  const presentation = el("p:presentation", {}, [
    el("p:sldIdLst", {}, [el("p:sldId", { id: "256", "r:id": "rIdSlide1" })]),
    el("p:sldSz", { cx: "9144000", cy: "6858000" }),
  ]);
  const presentationRels = rels([
    { id: "rIdSlide1", type: SLIDE_REL, target: "slides/slide1.xml" },
  ]);
  return {
    parts: {
      "ppt/presentation.xml": { kind: "xml", nodes: [presentation] },
      "ppt/_rels/presentation.xml.rels": {
        kind: "xml",
        nodes: [presentationRels],
      },
      "ppt/slides/slide1.xml": { kind: "xml", nodes: [slide] },
      "ppt/slides/_rels/slide1.xml.rels": {
        kind: "xml",
        nodes: [rels([])],
      },
    },
  };
}

function notesPrecedenceFixturePackage(): Package {
  const shapeWithPh = (
    id: string,
    name: string,
    ph: Record<string, string> | undefined,
    runs: readonly ReturnType<typeof el>[],
  ) =>
    el("p:sp", {}, [
      el("p:nvSpPr", {}, [
        el("p:cNvPr", { id, name }),
        el("p:cNvSpPr"),
        el("p:nvPr", {}, ph === undefined ? [] : [el("p:ph", ph)]),
      ]),
      el("p:spPr"),
      el("p:txBody", {}, [el("a:p", {}, runs)]),
    ]);
  const r = (text: string) => el("a:r", {}, [el("a:t", {}, [txt(text)])]);
  const noPlaceholder = shapeWithPh("2", "NoPlaceholder", undefined, [
    r("NoPlaceholderText"),
  ]);
  const titleType = shapeWithPh("3", "TitleType", { type: "title" }, [
    r("TitleTypeText"),
  ]);
  // A bare p:ph with no @type at all is the real body placeholder — readNotes' own bodyShape predicate treats a typeless placeholder the same as an explicit type="body" one.
  const typelessBody = shapeWithPh("4", "TypelessBody", { idx: "1" }, [
    r("Alpha"),
    r("Beta"),
  ]);
  const explicitBody = shapeWithPh("5", "ExplicitBody", { type: "body" }, [
    r("ExplicitBodyText"),
  ]);
  const notesSlide = el("p:notes", {}, [
    el("p:cSld", {}, [
      el("p:spTree", {}, [
        noPlaceholder,
        titleType,
        typelessBody,
        explicitBody,
      ]),
    ]),
  ]);
  const slide = el("p:sld", {}, [el("p:cSld", {}, [el("p:spTree")])]);
  const presentation = el("p:presentation", {}, [
    el("p:sldIdLst", {}, [el("p:sldId", { id: "256", "r:id": "rId1" })]),
  ]);
  const presentationRels = rels([
    { id: "rId1", type: SLIDE_REL, target: "slides/slide1.xml" },
  ]);
  const slideRels = rels([
    {
      id: "rIdNotes",
      type: NOTES_SLIDE_REL,
      target: "../notesSlides/notesSlide1.xml",
    },
  ]);
  return {
    parts: {
      "ppt/presentation.xml": { kind: "xml", nodes: [presentation] },
      "ppt/_rels/presentation.xml.rels": {
        kind: "xml",
        nodes: [presentationRels],
      },
      "ppt/slides/slide1.xml": { kind: "xml", nodes: [slide] },
      "ppt/slides/_rels/slide1.xml.rels": { kind: "xml", nodes: [slideRels] },
      "ppt/notesSlides/notesSlide1.xml": { kind: "xml", nodes: [notesSlide] },
    },
  };
}

describe("readPptxContent: p:cxnSp connector shapes are never recursed into", () => {
  it("skips a p:cxnSp whole, even one synthetically holding a nested p:sp child", () => {
    // p:cxnSp cannot really carry a p:sp per ECMA-376 — this proves walkShapeTreeChildren's own tag check is what keeps a connector's content out of the flat shape list, not merely that connectors never have children in practice.
    const nestedShape = el("p:sp", {}, [
      el("p:nvSpPr", {}, [
        el("p:cNvPr", { id: "3", name: "ShouldNotAppear" }),
        el("p:cNvSpPr"),
        el("p:nvPr"),
      ]),
      el("p:spPr", {}, [
        el("a:xfrm", {}, [
          el("a:off", { x: "0", y: "0" }),
          el("a:ext", { cx: "914400", cy: "914400" }),
        ]),
      ]),
      el("p:txBody", {}, [
        el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt("nested")])])]),
      ]),
    ]);
    const cxnSp = el("p:cxnSp", {}, [
      el("p:nvCxnSpPr", {}, [el("p:cNvPr", { id: "2", name: "Connector" })]),
      nestedShape,
    ]);
    const doc = readPptxContent(minimalSlidePackage([cxnSp]));
    expect(doc.slides[0]?.shapes).toEqual([]);
  });
});

describe("readPptxContent: SmartArt colour part (r:cs) resolves into the diagram's own residue", () => {
  it("includes the colour part's own XML in source.xml when r:cs resolves to a real part, the same way r:lo/r:qs already do", () => {
    const pkg = smartArtFixturePackage();
    const colors = el("dgm:colorsDef", { uniqueId: "colors1" });
    pkg.parts["ppt/diagrams/colors1.xml"] = { kind: "xml", nodes: [colors] };
    pkg.parts["ppt/slides/_rels/slide1.xml.rels"] = {
      kind: "xml",
      nodes: [
        rels([
          {
            id: "rIdDm",
            type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData",
            target: "../diagrams/data1.xml",
          },
          {
            id: "rIdCs",
            type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramColors",
            target: "../diagrams/colors1.xml",
          },
        ]),
      ],
    };
    const doc = readPptxContent(pkg);
    const diagramShape = doc.slides[0]?.shapes.find(
      (s) => s.name === "Diagram 1",
    );
    expect(diagramShape?.source?.format).toBe("pptx");
    const xml = diagramShape?.source?.xml ?? "";
    expect(xml.indexOf("dgm:colorsDef")).toBeGreaterThanOrEqual(0);
  });
});

// Exercises readNotes' own bodyShape precedence: a shape with no placeholder at all, one with a placeholder of a different type, and one with an explicit type="body" placeholder — all of which the real body shape (a bare, typeless placeholder, PowerPoint's own default-to-body spelling) must be found ahead of, since shapes.find stops at the first match.
describe("readPptxContent: notes bodyShape precedence and fallback paths", () => {
  it("finds the typeless placeholder ahead of an earlier non-placeholder and non-body-typed shape, and joins its own runs with no separator", () => {
    const doc = readPptxContent(notesPrecedenceFixturePackage());
    expect(doc.slides[0]?.notes).toBe("AlphaBeta");
  });

  it('reads "" when the notesSlide relationship resolves but the target part is missing from the package', () => {
    const pkg = buildFixturePackage();
    delete pkg.parts["ppt/notesSlides/notesSlide1.xml"];
    const doc = readPptxContent(pkg);
    expect(doc.slides[1]?.notes).toBe("");
  });

  it("falls back to concatenating every a:t in the notes part, with no separator, when no shape qualifies as the body placeholder", () => {
    const titleOnly = el("p:sp", {}, [
      el("p:nvSpPr", {}, [
        el("p:cNvPr", { id: "2", name: "Title" }),
        el("p:cNvSpPr"),
        el("p:nvPr", {}, [el("p:ph", { type: "title" })]),
      ]),
      el("p:spPr"),
      el("p:txBody", {}, [
        el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt("Title")])])]),
      ]),
    ]);
    const slideNumOnly = el("p:sp", {}, [
      el("p:nvSpPr", {}, [
        el("p:cNvPr", { id: "3", name: "SlideNum" }),
        el("p:cNvSpPr"),
        el("p:nvPr", {}, [el("p:ph", { type: "sldNum" })]),
      ]),
      el("p:spPr"),
      el("p:txBody", {}, [
        el("a:p", {}, [
          el(
            "a:fld",
            {
              id: "{00000000-0000-0000-0000-000000000000}",
              type: "slidenum",
            },
            [el("a:t", {}, [txt("1")])],
          ),
        ]),
      ]),
    ]);
    const notesSlide = el("p:notes", {}, [
      el("p:cSld", {}, [el("p:spTree", {}, [titleOnly, slideNumOnly])]),
    ]);
    const slide = el("p:sld", {}, [el("p:cSld", {}, [el("p:spTree")])]);
    const presentation = el("p:presentation", {}, [
      el("p:sldIdLst", {}, [el("p:sldId", { id: "256", "r:id": "rId1" })]),
    ]);
    const presentationRels = rels([
      { id: "rId1", type: SLIDE_REL, target: "slides/slide1.xml" },
    ]);
    const slideRels = rels([
      {
        id: "rIdNotes",
        type: NOTES_SLIDE_REL,
        target: "../notesSlides/notesSlide1.xml",
      },
    ]);
    const pkg: Package = {
      parts: {
        "ppt/presentation.xml": { kind: "xml", nodes: [presentation] },
        "ppt/_rels/presentation.xml.rels": {
          kind: "xml",
          nodes: [presentationRels],
        },
        "ppt/slides/slide1.xml": { kind: "xml", nodes: [slide] },
        "ppt/slides/_rels/slide1.xml.rels": {
          kind: "xml",
          nodes: [slideRels],
        },
        "ppt/notesSlides/notesSlide1.xml": {
          kind: "xml",
          nodes: [notesSlide],
        },
      },
    };
    const doc = readPptxContent(pkg);
    expect(doc.slides[0]?.notes).toBe("Title1");
  });
});
