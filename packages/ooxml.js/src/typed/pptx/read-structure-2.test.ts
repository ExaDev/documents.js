import type { Package } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";
import { describe, expect, it } from "vitest";
import type { ContentBlock, ContentTable } from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { bytesToBase64 } from "byte-codec";
import { PNG_SIGNATURE } from "../../image/sniff";
import { readPptxContent } from "./read";
function asTable(block: ContentBlock | undefined): ContentTable {
  if (block?.kind !== "table") {
    throw new Error("expected a table block");
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

function findElementByTag(
  nodes: readonly XmlNode[],
  tag: string,
): XmlElement | undefined {
  for (const node of nodes) {
    if (node.type !== "element") {
      continue;
    }
    if (node.tag === tag) {
      return node;
    }
    const found = findElementByTag(node.children, tag);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

const FILL_RED = { r: 1, g: 0, b: 0 };
const FILL_BLUE = { r: 0, g: 0, b: 1 };
const FILL_GREEN = { r: 0, g: 1, b: 0 };

function solidFillEl(hex: string): XmlElement {
  return el("a:solidFill", {}, [el("a:srgbClr", { val: hex })]);
}

function textCell(
  text: string,
  attrs: Readonly<Record<string, string>> = {},
): XmlElement {
  return el("a:tc", attrs, [
    el("a:txBody", {}, [
      el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt(text)])])]),
    ]),
  ]);
}

// A covered a:tc: hMerge/vMerge state which side of the region it lies on, and its own a:tcPr (when given) carries the decoration. The a:txBody is the empty one PowerPoint itself writes for a covered position.
function coveredCell(
  attrs: Readonly<Record<string, string>>,
  tcPrChildren: readonly XmlElement[] | undefined,
): XmlElement {
  return el("a:tc", attrs, [
    el("a:txBody", {}, [el("a:p")]),
    ...(tcPrChildren === undefined
      ? []
      : [el("a:tcPr", {}, [...tcPrChildren])]),
  ]);
}

// The fixture deck with its "Table 1" replaced by a table of the given rows, one 100pt-wide grid column per entry of the first row.
function tableFromRows(rows: readonly XmlElement[][]): ContentTable {
  const pkg = buildFixturePackage();
  const slide1 = pkg.parts["ppt/slides/slide1.xml"];
  if (slide1?.kind !== "xml") {
    throw new Error("expected ppt/slides/slide1.xml");
  }
  const tbl = findElementByTag(slide1.nodes, "a:tbl");
  if (tbl === undefined) {
    throw new Error("expected the fixture's a:tbl");
  }
  const columnCount = rows[0]?.length ?? 0;
  tbl.children = [
    el(
      "a:tblGrid",
      {},
      Array.from({ length: columnCount }, () =>
        el("a:gridCol", { w: "1270000" }),
      ),
    ),
    ...rows.map((cells) => el("a:tr", {}, cells)),
  ];
  const doc = readPptxContent(pkg);
  const shape = doc.slides[1]?.shapes.find((s) => s.name === "Table 1");
  return asTable(shape?.blocks[0]);
}

describe("readPptxContent: a covered table position's own decoration", () => {
  it("reads an hMerge continuation's own solid fill, with no blocks and no spans", () => {
    const table = tableFromRows([
      [
        textCell("Anchor", { gridSpan: "2" }),
        coveredCell({ hMerge: "1" }, [solidFillEl("FF0000")]),
      ],
    ]);
    const covered = table.rows[0]?.cells[1];
    expect(covered?.blocks).toEqual([]);
    expect(covered?.background).toEqual({ kind: "solid", color: FILL_RED });
    expect(covered?.colSpan).toBeUndefined();
    expect(covered?.rowSpan).toBeUndefined();
  });

  it("reads a vMerge continuation's own solid fill, with no blocks and no spans", () => {
    const table = tableFromRows([
      [textCell("Anchor", { rowSpan: "2" }), textCell("Beside")],
      [
        coveredCell({ vMerge: "1" }, [solidFillEl("0000FF")]),
        textCell("Below"),
      ],
    ]);
    const covered = table.rows[1]?.cells[0];
    expect(covered?.blocks).toEqual([]);
    expect(covered?.background).toEqual({ kind: "solid", color: FILL_BLUE });
    expect(covered?.colSpan).toBeUndefined();
    expect(covered?.rowSpan).toBeUndefined();
  });

  it("reads a covered position's own a:tcPr/@anchor as verticalAlign", () => {
    const table = tableFromRows([
      [
        textCell("Anchor", { gridSpan: "2" }),
        el("a:tc", { hMerge: "1" }, [
          el("a:txBody", {}, [el("a:p")]),
          el("a:tcPr", { anchor: "ctr" }),
        ]),
      ],
    ]);
    const covered = table.rows[0]?.cells[1];
    expect(covered?.blocks).toEqual([]);
    expect(covered?.verticalAlign).toBe("center");
  });

  it("reads a covered position's own borders", () => {
    const table = tableFromRows([
      [
        textCell("Anchor", { gridSpan: "2" }),
        coveredCell({ hMerge: "1" }, [
          el("a:lnL", { w: "12700" }, [solidFillEl("00FF00")]),
          el("a:lnB", { w: "25400" }, [
            solidFillEl("0000FF"),
            el("a:prstDash", { val: "dash" }),
          ]),
        ]),
      ],
    ]);
    const covered = table.rows[0]?.cells[1];
    expect(covered?.blocks).toEqual([]);
    expect(covered?.borders).toEqual({
      left: { color: FILL_GREEN, widthPt: 1 },
      bottom: { color: FILL_BLUE, widthPt: 2, style: "dashed" },
    });
    expect(covered?.background).toBeUndefined();
  });

  it("leaves an anchor's own colSpan and rowSpan undefined when it states neither, and reads each one when stated", () => {
    const table = tableFromRows([
      [
        textCell("Plain"),
        textCell("Wide", { gridSpan: "2" }),
        coveredCell({ hMerge: "1" }, undefined),
      ],
      [textCell("Tall", { rowSpan: "2" }), textCell("B"), textCell("C")],
      [coveredCell({ vMerge: "1" }, undefined), textCell("D"), textCell("E")],
    ]);
    const plain = table.rows[0]?.cells[0];
    expect(plain?.colSpan).toBeUndefined();
    expect(plain?.rowSpan).toBeUndefined();
    expect(table.rows[0]?.cells[1]?.colSpan).toBe(2);
    expect(table.rows[0]?.cells[1]?.rowSpan).toBeUndefined();
    expect(table.rows[1]?.cells[0]?.colSpan).toBeUndefined();
    expect(table.rows[1]?.cells[0]?.rowSpan).toBe(2);
  });

  it("reads a covered position with no a:tcPr as a plain block-less cell carrying no decoration", () => {
    const table = tableFromRows([
      [
        textCell("Anchor", { gridSpan: "2" }),
        coveredCell({ hMerge: "1" }, undefined),
      ],
    ]);
    const covered = table.rows[0]?.cells[1];
    expect(covered).toEqual({ blocks: [] });
    expect(covered?.background).toBeUndefined();
    expect(covered?.borders).toBeUndefined();
    expect(covered?.colSpan).toBeUndefined();
    expect(covered?.rowSpan).toBeUndefined();
  });

  it("reads a covered position whose a:tcPr states nothing this model carries as carrying no decoration", () => {
    const table = tableFromRows([
      [
        textCell("Anchor", { gridSpan: "2" }),
        coveredCell({ hMerge: "1" }, [el("a:noFill")]),
      ],
    ]);
    const covered = table.rows[0]?.cells[1];
    expect(covered).toEqual({ blocks: [] });
    expect(covered?.background).toBeUndefined();
    expect(covered?.borders).toBeUndefined();
  });

  it("gives every position of a 2x2 merge its own fill, the interior one included", () => {
    const table = tableFromRows([
      [
        el("a:tc", { gridSpan: "2", rowSpan: "2" }, [
          el("a:txBody", {}, [
            el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt("Anchor")])])]),
          ]),
          el("a:tcPr", {}, [solidFillEl("FF0000")]),
        ]),
        coveredCell({ hMerge: "1" }, [solidFillEl("00FF00")]),
      ],
      [
        coveredCell({ vMerge: "1" }, [solidFillEl("0000FF")]),
        coveredCell({ hMerge: "1", vMerge: "1" }, [solidFillEl("FFFF00")]),
      ],
    ]);
    expect(table.rows.map((row) => row.cells.length)).toEqual([2, 2]);
    expect(table.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(table.rows[0]?.cells[0]?.rowSpan).toBe(2);
    expect(table.rows[0]?.cells[0]?.background).toEqual({
      kind: "solid",
      color: FILL_RED,
    });
    expect(table.rows[0]?.cells[1]?.background).toEqual({
      kind: "solid",
      color: FILL_GREEN,
    });
    expect(table.rows[1]?.cells[0]?.background).toEqual({
      kind: "solid",
      color: FILL_BLUE,
    });
    const interior = table.rows[1]?.cells[1];
    expect(interior?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 1, b: 0 },
    });
    expect(interior?.blocks).toEqual([]);
    expect(interior?.colSpan).toBeUndefined();
    expect(interior?.rowSpan).toBeUndefined();
  });
});

// ExaDev/documents.js#1400: a:prstDash has no 'double' member (ST_PresetLineDashVal, ECMA-376 20.1.10.48), so a double border edge is instead stated on @cmpd="dbl" (ST_CompoundLine, ECMA-376 20.1.2.2.24), the same attribute a:ln itself carries — a:lnL/a:lnR/a:lnT/a:lnB share it because all five are typed CT_LineProperties.
describe("readPptxContent: a cell border's double stroke style", () => {
  it('reads @cmpd="dbl" as style: "double"', () => {
    const table = tableFromRows([
      [
        el("a:tc", {}, [
          el("a:txBody", {}, [
            el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt("A")])])]),
          ]),
          el("a:tcPr", {}, [
            el("a:lnL", { w: "12700", cmpd: "dbl" }, [solidFillEl("FF0000")]),
          ]),
        ]),
      ],
    ]);
    expect(table.rows[0]?.cells[0]?.borders).toEqual({
      left: { color: FILL_RED, widthPt: 1, style: "double" },
    });
  });

  it('@cmpd="dbl" takes priority over an a:prstDash also present on the same edge, since ContentStrokeStyle has no way to state both at once', () => {
    const table = tableFromRows([
      [
        el("a:tc", {}, [
          el("a:txBody", {}, [
            el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt("A")])])]),
          ]),
          el("a:tcPr", {}, [
            el("a:lnL", { w: "12700", cmpd: "dbl" }, [
              solidFillEl("FF0000"),
              el("a:prstDash", { val: "dash" }),
            ]),
          ]),
        ]),
      ],
    ]);
    expect(table.rows[0]?.cells[0]?.borders).toEqual({
      left: { color: FILL_RED, widthPt: 1, style: "double" },
    });
  });

  it('a @cmpd value other than "dbl" is ignored, falling back to a:prstDash (or no style at all)', () => {
    const table = tableFromRows([
      [
        el("a:tc", {}, [
          el("a:txBody", {}, [
            el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt("A")])])]),
          ]),
          el("a:tcPr", {}, [
            el("a:lnL", { w: "12700", cmpd: "thickThin" }, [
              solidFillEl("FF0000"),
            ]),
          ]),
        ]),
      ],
    ]);
    expect(table.rows[0]?.cells[0]?.borders).toEqual({
      left: { color: FILL_RED, widthPt: 1 },
    });
  });
});
