import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentParagraph,
  ContentTable,
} from "document-schema.js";
import { el, txt } from "../../xml/fragment";
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

const SLIDE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const SLIDE_LAYOUT_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";
const CHART_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";

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
function chartFixturePackage(): Package {
  const revenue = el("c:ser", {}, [
    el("c:tx", {}, [
      el("c:strRef", {}, [
        el("c:f", {}, [txt("Sheet1!$B$1")]),
        el("c:strCache", {}, [
          el("c:ptCount", { val: "1" }),
          el("c:pt", { idx: "0" }, [el("c:v", {}, [txt("Revenue")])]),
        ]),
      ]),
    ]),
    el("c:cat", {}, [
      el("c:strRef", {}, [
        el("c:strCache", {}, [
          el("c:ptCount", { val: "2" }),
          el("c:pt", { idx: "0" }, [el("c:v", {}, [txt("Q1")])]),
          el("c:pt", { idx: "1" }, [el("c:v", {}, [txt("Q2")])]),
        ]),
      ]),
    ]),
    el("c:val", {}, [
      el("c:numRef", {}, [
        el("c:numCache", {}, [
          el("c:ptCount", { val: "2" }),
          el("c:pt", { idx: "0" }, [el("c:v", {}, [txt("8.5")])]),
          el("c:pt", { idx: "1" }, [el("c:v", {}, [txt("12")])]),
        ]),
      ]),
    ]),
  ]);
  const cost = el("c:ser", {}, [
    el("c:tx", {}, [el("c:v", {}, [txt("Cost")])]),
    el("c:cat", {}, [
      el("c:strRef", {}, [
        el("c:strCache", {}, [
          el("c:ptCount", { val: "3" }),
          el("c:pt", { idx: "0" }, [el("c:v", {}, [txt("Q1")])]),
          el("c:pt", { idx: "1" }, [el("c:v", {}, [txt("Q2")])]),
          el("c:pt", { idx: "2" }, [el("c:v", {}, [txt("Q3")])]),
        ]),
      ]),
    ]),
    el("c:val", {}, [
      el("c:numRef", {}, [
        el("c:numCache", {}, [
          el("c:ptCount", { val: "3" }),
          el("c:pt", { idx: "0" }, [el("c:v", {}, [txt("4")])]),
          el("c:pt", { idx: "1" }, [el("c:v", {}, [txt("5")])]),
          el("c:pt", { idx: "2" }, [el("c:v", {}, [txt("6")])]),
        ]),
      ]),
    ]),
  ]);
  const chartSpace = el("c:chartSpace", {}, [
    el("c:chart", {}, [
      el("c:plotArea", {}, [el("c:barChart", {}, [revenue, cost])]),
    ]),
  ]);

  const chartFrame = el("p:graphicFrame", {}, [
    el("p:nvGraphicFramePr", {}, [el("p:cNvPr", { id: "2", name: "Chart 1" })]),
    el("p:xfrm", {}, [
      el("a:off", { x: "914400", y: "1828800" }),
      el("a:ext", { cx: "4572000", cy: "2743200" }),
    ]),
    el("a:graphic", {}, [
      el(
        "a:graphicData",
        { uri: "http://schemas.openxmlformats.org/drawingml/2006/chart" },
        [el("c:chart", { "r:id": "rIdChart" })],
      ),
    ]),
  ]);
  const slide = el("p:sld", {}, [
    el("p:cSld", {}, [el("p:spTree", {}, [chartFrame])]),
  ]);
  const presentation = el("p:presentation", {}, [
    el("p:sldIdLst", {}, [el("p:sldId", { id: "256", "r:id": "rId1" })]),
  ]);
  const presentationRels = rels([
    { id: "rId1", type: SLIDE_REL, target: "slides/slide1.xml" },
  ]);
  const slideRels = rels([
    { id: "rIdChart", type: CHART_REL, target: "../charts/chart1.xml" },
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
      "ppt/charts/chart1.xml": { kind: "xml", nodes: [chartSpace] },
    },
  };
}

function cellText(
  block: ContentBlock | undefined,
  row: number,
  column: number,
): string | undefined {
  if (block?.kind !== "table") {
    throw new Error("expected a table block");
  }
  return asParagraph(block.rows[row]?.cells[column]?.blocks[0]).runs[0]?.text;
}

describe("readPptxContent: internal slide-jump links (a:hlinkClick to a slide)", () => {
  // A deck of two slides where slide1 jumps to slide2: one paragraph of three runs whose middle run carries the jump, and a second paragraph whose run carries an action-only jump (ppaction://hlinkshowjump names no target part, so it has nothing to resolve and stays unrecorded).
  function slideJumpFixturePackage(): Package {
    const jumpShape = el("p:sp", {}, [
      el("p:nvSpPr", {}, [
        el("p:cNvPr", { id: "2", name: "Jumper" }),
        el("p:cNvSpPr"),
        el("p:nvPr"),
      ]),
      el("p:spPr", {}, [
        el("a:xfrm", {}, [
          el("a:off", { x: "914400", y: "914400" }),
          el("a:ext", { cx: "7315200", cy: "457200" }),
        ]),
      ]),
      el("p:txBody", {}, [
        el("a:p", {}, [
          el("a:r", {}, [el("a:t", {}, [txt("See ")])]),
          el("a:r", {}, [
            el("a:rPr", {}, [
              el("a:hlinkClick", {
                "r:id": "rIdJump",
                action: "ppaction://hlinksldjump",
              }),
            ]),
            el("a:t", {}, [txt("the next slide")]),
          ]),
          el("a:r", {}, [el("a:t", {}, [txt(" for details")])]),
        ]),
        el("a:p", {}, [
          el("a:r", {}, [
            el("a:rPr", {}, [
              el("a:hlinkClick", {
                action: "ppaction://hlinkshowjump?jump=nextslide",
              }),
            ]),
            el("a:t", {}, [txt("action only")]),
          ]),
        ]),
      ]),
    ]);
    const slide1 = el("p:sld", {}, [
      el("p:cSld", {}, [el("p:spTree", {}, [jumpShape])]),
    ]);
    const slide2 = el("p:sld", {}, [el("p:cSld", {}, [el("p:spTree")])]);
    const presentation = el("p:presentation", {}, [
      el("p:sldIdLst", {}, [
        el("p:sldId", { id: "256", "r:id": "rId1" }),
        el("p:sldId", { id: "257", "r:id": "rId2" }),
      ]),
    ]);
    const presentationRels = rels([
      { id: "rId1", type: SLIDE_REL, target: "slides/slide1.xml" },
      { id: "rId2", type: SLIDE_REL, target: "slides/slide2.xml" },
    ]);
    // The slide-jump relationship lives in the SLIDE's own rels (a sibling part), exactly where PresentationML spells it — not in the presentation's.
    const slide1Rels = rels([
      { id: "rIdJump", type: SLIDE_REL, target: "slide2.xml" },
    ]);
    return {
      parts: {
        "ppt/presentation.xml": { kind: "xml", nodes: [presentation] },
        "ppt/_rels/presentation.xml.rels": {
          kind: "xml",
          nodes: [presentationRels],
        },
        "ppt/slides/slide1.xml": { kind: "xml", nodes: [slide1] },
        "ppt/slides/_rels/slide1.xml.rels": {
          kind: "xml",
          nodes: [slide1Rels],
        },
        "ppt/slides/slide2.xml": { kind: "xml", nodes: [slide2] },
      },
    };
  }

  it("reads a slide-jump hlinkClick as a link run construct whose internal anchor is the target slide's package part path", () => {
    const doc = readPptxContent(slideJumpFixturePackage());
    const paragraph = asParagraph(doc.slides[0]?.shapes[0]?.blocks[0]);
    expect(paragraph.runs.map((run) => run.text)).toEqual([
      "See ",
      "the next slide",
      " for details",
    ]);
    expect(paragraph.constructs).toEqual([
      {
        descriptor: {
          kind: "link",
          target: { kind: "internal", anchor: "ppt/slides/slide2.xml" },
        },
        startRun: 1,
        endRun: 2,
      },
    ]);
  });

  it("leaves the jumping run's own flat hyperlink field unset — the internal target is the construct's, never a URI", () => {
    const doc = readPptxContent(slideJumpFixturePackage());
    const paragraph = asParagraph(doc.slides[0]?.shapes[0]?.blocks[0]);
    expect(paragraph.runs[1]?.hyperlink).toBeUndefined();
  });

  it("records nothing for an action-only jump, whose hlinkClick names an action verb and no target part", () => {
    const doc = readPptxContent(slideJumpFixturePackage());
    const paragraph = asParagraph(doc.slides[0]?.shapes[0]?.blocks[1]);
    expect(paragraph.constructs).toBeUndefined();
  });

  // readInternalSlideJump's own condition needs BOTH a non-External targetMode and a slide-typed relationship — neither alone is sufficient. A run resolving to a relationship of the slide type but marked External (unusual, but distinct from the ordinary "no TargetMode at all" internal spelling every other fixture here uses) must still read as no jump, exactly like the ordinary external-hyperlink case, proving the targetMode check pulls its own weight rather than being implied by the type check beside it.
  function edgeCaseJumpPackage(
    rel: Readonly<{
      type: string;
      external?: boolean;
    }>,
  ): Package {
    const shape = el("p:sp", {}, [
      el("p:nvSpPr", {}, [
        el("p:cNvPr", { id: "2", name: "Edge" }),
        el("p:cNvSpPr"),
        el("p:nvPr"),
      ]),
      el("p:spPr", {}, [
        el("a:xfrm", {}, [
          el("a:off", { x: "914400", y: "914400" }),
          el("a:ext", { cx: "914400", cy: "457200" }),
        ]),
      ]),
      el("p:txBody", {}, [
        el("a:p", {}, [
          el("a:r", {}, [
            el("a:rPr", {}, [el("a:hlinkClick", { "r:id": "rIdEdge" })]),
            el("a:t", {}, [txt("edge")]),
          ]),
        ]),
      ]),
    ]);
    const slide = el("p:sld", {}, [
      el("p:cSld", {}, [el("p:spTree", {}, [shape])]),
    ]);
    const presentation = el("p:presentation", {}, [
      el("p:sldIdLst", {}, [el("p:sldId", { id: "256", "r:id": "rId1" })]),
    ]);
    const presentationRels = rels([
      { id: "rId1", type: SLIDE_REL, target: "slides/slide1.xml" },
    ]);
    const slideRels = rels([
      {
        id: "rIdEdge",
        type: rel.type,
        target: rel.external === true ? "slide99.xml" : "slide2.xml",
        external: rel.external,
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
      },
    };
  }

  it("records no jump for a slide-typed relationship explicitly marked External, even though the type matches", () => {
    const doc = readPptxContent(
      edgeCaseJumpPackage({ type: SLIDE_REL, external: true }),
    );
    const paragraph = asParagraph(doc.slides[0]?.shapes[0]?.blocks[0]);
    expect(paragraph.constructs).toBeUndefined();
  });

  it("records no jump for an ordinary internal relationship whose type is not the slide relationship type", () => {
    const doc = readPptxContent(
      edgeCaseJumpPackage({ type: SLIDE_LAYOUT_REL }),
    );
    const paragraph = asParagraph(doc.slides[0]?.shapes[0]?.blocks[0]);
    expect(paragraph.constructs).toBeUndefined();
  });
});

describe("readPptxContent: chart graphic frames", () => {
  it("reads the chart part's cached series/category model as a table block", () => {
    const doc = readPptxContent(chartFixturePackage());
    const chartShape = doc.slides[0]?.shapes.find((s) => s.name === "Chart 1");
    const table = asTable(chartShape?.blocks[0]);
    // Header row: empty corner cell over the category column, then one column per series.
    expect(table.rows[0]?.cells[0]?.blocks).toEqual([]);
    expect(cellText(table, 0, 1)).toBe("Revenue");
    expect(cellText(table, 0, 2)).toBe("Cost");
  });

  it("marks the cached-model table origin: 'chart' — a chart's numbers, not an authored data table", () => {
    const doc = readPptxContent(chartFixturePackage());
    const chartShape = doc.slides[0]?.shapes.find((s) => s.name === "Chart 1");
    const table = asTable(chartShape?.blocks[0]);
    expect(table.origin).toBe("chart");
  });

  it("reads one row per category index, in index order, with each series' cached value in its own column", () => {
    const doc = readPptxContent(chartFixturePackage());
    const chartShape = doc.slides[0]?.shapes.find((s) => s.name === "Chart 1");
    const table = asTable(chartShape?.blocks[0]);
    expect(cellText(table, 1, 0)).toBe("Q1");
    expect(cellText(table, 1, 1)).toBe("8.5");
    expect(cellText(table, 1, 2)).toBe("4");
    const CACHED_MODEL_Q3_ROW_INDEX = 3; // the fixture's own third category row
    expect(cellText(table, CACHED_MODEL_Q3_ROW_INDEX, 0)).toBe("Q3");
    // A category only series 2 labels still gets its row; series 1 has no cached value there, which reads as an empty cell.
    expect(table.rows[3]?.cells[1]?.blocks).toEqual([]);
    expect(cellText(table, CACHED_MODEL_Q3_ROW_INDEX, 2)).toBe("6");
  });

  it("splits the frame's own width evenly across the category and series columns", () => {
    const doc = readPptxContent(chartFixturePackage());
    const chartShape = doc.slides[0]?.shapes.find((s) => s.name === "Chart 1");
    const EQUAL_COLUMN_WIDTH_PT = 120; // the frame's own total width split evenly across the category column and both series columns
    expect(
      asTable(chartShape?.blocks[0]).columns.map((c) => c.widthPt),
    ).toEqual([
      EQUAL_COLUMN_WIDTH_PT,
      EQUAL_COLUMN_WIDTH_PT,
      EQUAL_COLUMN_WIDTH_PT,
    ]);
  });

  it("keeps the frame's geometry with empty content when the chart reference resolves to no readable chart", () => {
    // The c:chart r:id points at a relationship the slide does not carry.
    const brokenFrame = el("p:graphicFrame", {}, [
      el("p:nvGraphicFramePr", {}, [
        el("p:cNvPr", { id: "2", name: "Chart 1" }),
      ]),
      el("p:xfrm", {}, [
        el("a:off", { x: "914400", y: "1828800" }),
        el("a:ext", { cx: "4572000", cy: "2743200" }),
      ]),
      el("a:graphic", {}, [
        el(
          "a:graphicData",
          { uri: "http://schemas.openxmlformats.org/drawingml/2006/chart" },
          [el("c:chart", { "r:id": "rIdMissing" })],
        ),
      ]),
    ]);
    const slide = el("p:sld", {}, [
      el("p:cSld", {}, [el("p:spTree", {}, [brokenFrame])]),
    ]);
    const presentation = el("p:presentation", {}, [
      el("p:sldIdLst", {}, [el("p:sldId", { id: "256", "r:id": "rId1" })]),
    ]);
    const pkg: Package = {
      parts: {
        "ppt/presentation.xml": { kind: "xml", nodes: [presentation] },
        "ppt/_rels/presentation.xml.rels": {
          kind: "xml",
          nodes: [
            rels([
              { id: "rId1", type: SLIDE_REL, target: "slides/slide1.xml" },
            ]),
          ],
        },
        "ppt/slides/slide1.xml": { kind: "xml", nodes: [slide] },
      },
    };
    const doc = readPptxContent(pkg);
    const chartShape = doc.slides[0]?.shapes.find((s) => s.name === "Chart 1");
    expect(chartShape?.frame).toEqual({
      xPt: 72,
      yPt: 144,
      widthPt: 360,
      heightPt: 216,
    });
    expect(chartShape?.blocks).toEqual([]);
  });

  it("assigns sourcePath into the chart table's cells", () => {
    const doc = readPptxContent(chartFixturePackage());
    const chartShape = doc.slides[0]?.shapes.find((s) => s.name === "Chart 1");
    const table = asTable(chartShape?.blocks[0]);
    expect(table.sourcePath).toBe("slides[0].shapes[0].blocks[0]");
    expect(asParagraph(table.rows[1]?.cells[1]?.blocks[0]).sourcePath).toBe(
      "slides[0].shapes[0].blocks[0].rows[1].cells[1].blocks[0]",
    );
  });

  it("quarantines the whole chart part — type, axes, colours, everything readChartTable itself does not read — as pptx residue on the table", () => {
    const doc = readPptxContent(chartFixturePackage());
    const chartShape = doc.slides[0]?.shapes.find((s) => s.name === "Chart 1");
    const table = asTable(chartShape?.blocks[0]);
    expect(table.source?.format).toBe("pptx");
    expect(table.source?.xml).toContain("c:chartSpace");
    expect(table.source?.xml).toContain("c:barChart");
  });
});

// A SmartArt graphic frame's dgm:relIds carries four relationship ids; only r:dm (the data model — the semantic graph of nodes and text) is read. The tree below: doc -> [Strategy (node 1, srcOrd 0), Cost (node 2, srcOrd 1), textless (node 4, srcOrd 2), Assistant (asst 5, srcOrd 3)], with Strategy -> [Quality/Details (node 3), a parTrans point whose text must not surface]. cxnLst order is deliberately scrambled against srcOrd to prove the sort, and a presOf edge to node 2 must not duplicate its text (readDiagramText in src/typed/pptx/diagram.ts).
