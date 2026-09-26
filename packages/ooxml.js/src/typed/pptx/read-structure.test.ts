import type { Package } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";
import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentImageBlock,
  ContentParagraph,
  ContentTable,
} from "document-schema.js";
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

function asTable(block: ContentBlock | undefined): ContentTable {
  if (block?.kind !== "table") {
    throw new Error("expected a table block");
  }
  return block;
}

function asImage(block: ContentBlock | undefined): ContentImageBlock {
  if (block?.kind !== "image") {
    throw new Error("expected an image block");
  }
  return block;
}

// A depth-first search for the first element named tag whose own attribute attrName equals attrValue — used to mutate one specific p:cNvPr in place within buildFixturePackage's already-parsed slide tree, rather than duplicating the whole fixture to exercise a single attribute variant.
function findElementByTagAndAttr(
  nodes: readonly XmlNode[],
  tag: string,
  attrName: string,
  attrValue: string,
): XmlElement | undefined {
  for (const node of nodes) {
    if (node.type !== "element") {
      continue;
    }
    if (
      node.tag === tag &&
      node.attributes.some((a) => a.name === attrName && a.value === attrValue)
    ) {
      return node;
    }
    const found = findElementByTagAndAttr(
      node.children,
      tag,
      attrName,
      attrValue,
    );
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
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

describe("readPptxContent: images", () => {
  it("reads a PNG image, sized to the shape's own frame", () => {
    const doc = readPptxContent(buildFixturePackage());
    const picShape = doc.slides[1]?.shapes.find((s) => s.name === "Picture 1");
    const image = asImage(picShape?.blocks[0]);
    expect(image.kind).toBe("image");
    expect(image.format).toBe("png");
    const FIXTURE_PICTURE_SIZE_PT = 80; // the fixture's own square frame for Picture 1
    expect(image.widthPt).toBe(FIXTURE_PICTURE_SIZE_PT);
    expect(image.heightPt).toBe(FIXTURE_PICTURE_SIZE_PT);
  });

  it("reads p:cNvPr/@descr as ContentImageBlock.altText", () => {
    const doc = readPptxContent(buildFixturePackage());
    const picShape = doc.slides[1]?.shapes.find((s) => s.name === "Picture 1");
    const image = asImage(picShape?.blocks[0]);
    expect(image.altText).toBe("A red circle");
  });

  it("falls back to p:cNvPr/@title when @descr is absent", () => {
    const pkg = buildFixturePackage();
    const slide1 = pkg.parts["ppt/slides/slide1.xml"];
    if (slide1?.kind !== "xml") {
      throw new Error("expected ppt/slides/slide1.xml");
    }
    const cNvPr = findElementByTagAndAttr(
      slide1.nodes,
      "p:cNvPr",
      "name",
      "Picture 1",
    );
    if (cNvPr === undefined) {
      throw new Error("expected Picture 1's p:cNvPr");
    }
    cNvPr.attributes = cNvPr.attributes
      .filter((a) => a.name !== "descr")
      .concat({ name: "title", value: "Titled only" });

    const doc = readPptxContent(pkg);
    const picShape = doc.slides[1]?.shapes.find((s) => s.name === "Picture 1");
    const image = asImage(picShape?.blocks[0]);
    expect(image.altText).toBe("Titled only");
  });
});

describe("readPptxContent: tables", () => {
  it("reads column widths, a merged cell's colSpan, and its continuation cell as empty", () => {
    const doc = readPptxContent(buildFixturePackage());
    const tableShape = doc.slides[1]?.shapes.find((s) => s.name === "Table 1");
    const table = asTable(tableShape?.blocks[0]);
    // The fixture's own two column widths for Table 1.
    const FIXTURE_FIRST_COLUMN_WIDTH_PT = 100;
    const FIXTURE_SECOND_COLUMN_WIDTH_PT = 150;
    expect(table.columns.map((c) => c.widthPt)).toEqual([
      FIXTURE_FIRST_COLUMN_WIDTH_PT,
      FIXTURE_SECOND_COLUMN_WIDTH_PT,
    ]);
    expect(table.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(asParagraph(table.rows[0]?.cells[0]?.blocks[0]).runs[0]?.text).toBe(
      "Merged",
    );
    expect(table.rows[0]?.cells[1]?.blocks).toEqual([]);
  });

  it("reads a row's explicit height, and leaves it undefined when a:tr has no h attribute", () => {
    const doc = readPptxContent(buildFixturePackage());
    const tableShape = doc.slides[1]?.shapes.find((s) => s.name === "Table 1");
    const table = asTable(tableShape?.blocks[0]);
    const FIXTURE_FIRST_ROW_HEIGHT_PT = 36; // the fixture's own explicit a:tr/@h for the first row
    expect(table.rows[0]?.heightPt).toBe(FIXTURE_FIRST_ROW_HEIGHT_PT);
    expect(table.rows[1]?.heightPt).toBeUndefined();
  });

  it("reads a cell's background fill", () => {
    const doc = readPptxContent(buildFixturePackage());
    const tableShape = doc.slides[1]?.shapes.find((s) => s.name === "Table 1");
    const table = asTable(tableShape?.blocks[0]);
    expect(table.rows[1]?.cells[0]?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 0, b: 0 },
    });
  });

  // ExaDev/documents.js#1024: a genuine a:pattFill, not just a:solidFill, now resolves to a real 'pattern' ContentCellFill.
  it("resolves an a:pattFill with a mapped percentage preset to a 'pattern' fill", () => {
    const doc = readPptxContent(buildFixturePackage());
    const tableShape = doc.slides[1]?.shapes.find((s) => s.name === "Table 1");
    const table = asTable(tableShape?.blocks[0]);
    expect(table.rows[4]?.cells[0]?.background).toEqual({
      kind: "pattern",
      patternType: "percent25",
      foregroundColor: { r: 0, g: 1, b: 0 },
      backgroundColor: { r: 0, g: 0, b: 1 },
    });
  });

  it("reads an a:pattFill preset outside the mapped percentage subset as no background", () => {
    const doc = readPptxContent(buildFixturePackage());
    const tableShape = doc.slides[1]?.shapes.find((s) => s.name === "Table 1");
    const table = asTable(tableShape?.blocks[0]);
    expect(table.rows[4]?.cells[1]?.background).toBeUndefined();
  });

  it("reads a cell's four a:lnL/a:lnR/a:lnT/a:lnB border edges, each edge's colour, width, and preset dash pattern", () => {
    const doc = readPptxContent(buildFixturePackage());
    const tableShape = doc.slides[1]?.shapes.find((s) => s.name === "Table 1");
    const table = asTable(tableShape?.blocks[0]);
    expect(table.rows[1]?.cells[0]?.borders).toEqual({
      left: { color: { r: 0, g: 0, b: 1 }, widthPt: 1 },
      right: { color: { r: 0, g: 1, b: 0 }, widthPt: 2, style: "dashed" },
      top: { color: { r: 1, g: 1, b: 0 }, widthPt: 0.5, style: "dotted" },
      bottom: { color: { r: 0, g: 0, b: 0 }, widthPt: 1.5, style: "solid" },
    });
  });

  it("reads no borders for a cell whose a:tcPr declares none", () => {
    const doc = readPptxContent(buildFixturePackage());
    const tableShape = doc.slides[1]?.shapes.find((s) => s.name === "Table 1");
    const table = asTable(tableShape?.blocks[0]);
    expect(table.rows[1]?.cells[1]?.borders).toBeUndefined();
    expect(table.rows[0]?.cells[0]?.borders).toBeUndefined();
  });

  it("reads no borders for a cell whose a:tcPr is present but every edge is unresolvable (missing @w, explicit a:noFill, or the edge absent entirely)", () => {
    const doc = readPptxContent(buildFixturePackage());
    const tableShape = doc.slides[1]?.shapes.find((s) => s.name === "Table 1");
    const table = asTable(tableShape?.blocks[0]);
    expect(table.rows[2]?.cells[0]?.borders).toBeUndefined();
  });

  it("treats a resolved zero-width edge as no border, and defaults an unrecognised a:prstDash token to 'solid' rather than dropping the edge", () => {
    const doc = readPptxContent(buildFixturePackage());
    const tableShape = doc.slides[1]?.shapes.find((s) => s.name === "Table 1");
    const table = asTable(tableShape?.blocks[0]);
    expect(table.rows[2]?.cells[1]?.borders).toEqual({
      right: { color: { r: 0, g: 0, b: 1 }, widthPt: 1, style: "solid" },
    });
  });

  it("treats a genuinely non-numeric @w (not just zero) as an unresolvable edge, leaving the cell's other edges readable", () => {
    const doc = readPptxContent(buildFixturePackage());
    const tableShape = doc.slides[1]?.shapes.find((s) => s.name === "Table 1");
    const table = asTable(tableShape?.blocks[0]);
    expect(table.rows[3]?.cells[0]?.borders).toEqual({
      right: { color: { r: 1, g: 0, b: 1 }, widthPt: 1 },
    });
  });

  // ExaDev/documents.js#1376: a:tcPr/@anchor never used to be read at all.
  it("reads a:tcPr/@anchor's three mapped values (t/ctr/b) as verticalAlign", () => {
    const table = tableFromRows([
      [
        el("a:tc", {}, [
          el("a:txBody", {}, [el("a:p")]),
          el("a:tcPr", { anchor: "t" }),
        ]),
        el("a:tc", {}, [
          el("a:txBody", {}, [el("a:p")]),
          el("a:tcPr", { anchor: "ctr" }),
        ]),
        el("a:tc", {}, [
          el("a:txBody", {}, [el("a:p")]),
          el("a:tcPr", { anchor: "b" }),
        ]),
      ],
    ]);
    expect(table.rows[0]?.cells[0]?.verticalAlign).toBe("top");
    expect(table.rows[0]?.cells[1]?.verticalAlign).toBe("center");
    expect(table.rows[0]?.cells[2]?.verticalAlign).toBe("bottom");
  });

  it("leaves verticalAlign undefined when a:tcPr carries no @anchor, and for @anchor values with no pivot equivalent (just/dist)", () => {
    const table = tableFromRows([
      [
        textCell("No tcPr"),
        el("a:tc", {}, [el("a:txBody", {}, [el("a:p")]), el("a:tcPr", {})]),
        el("a:tc", {}, [
          el("a:txBody", {}, [el("a:p")]),
          el("a:tcPr", { anchor: "just" }),
        ]),
        el("a:tc", {}, [
          el("a:txBody", {}, [el("a:p")]),
          el("a:tcPr", { anchor: "dist" }),
        ]),
      ],
    ]);
    expect(table.rows[0]?.cells[0]?.verticalAlign).toBeUndefined();
    expect(table.rows[0]?.cells[1]?.verticalAlign).toBeUndefined();
    expect(table.rows[0]?.cells[2]?.verticalAlign).toBeUndefined();
    expect(table.rows[0]?.cells[3]?.verticalAlign).toBeUndefined();
  });
});

// A depth-first search for the first element with the given tag, the untargeted counterpart of findElementByTagAndAttr.
