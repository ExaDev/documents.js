import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentParagraph,
  ContentTable,
  ContentTableCell,
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
const FILL_RED = { r: 1, g: 0, b: 0 };
const FILL_BLUE = { r: 0, g: 0, b: 1 };
const FILL_GREEN = { r: 0, g: 1, b: 0 };

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

function firstShapeParagraph(
  shapes: readonly ReturnType<typeof el>[],
): ContentParagraph {
  const doc = readPptxContent(minimalSlidePackage(shapes));
  return asParagraph(doc.slides[0]?.shapes[0]?.blocks[0]);
}

function textShape(paragraph: ReturnType<typeof el>): ReturnType<typeof el> {
  return el("p:sp", {}, [
    el("p:nvSpPr", {}, [
      el("p:cNvPr", { id: "2", name: "Shape 1" }),
      el("p:cNvSpPr"),
      el("p:nvPr"),
    ]),
    // An explicit xfrm, not inherited placeholder geometry: this minimal package has no layout/master chain for resolveShapeFrame to inherit from, so a shape with no own frame at all resolves to no frame and is dropped from the slide entirely.
    el("p:spPr", {}, [
      el("a:xfrm", {}, [
        el("a:off", { x: "0", y: "0" }),
        el("a:ext", { cx: "914400", cy: "914400" }),
      ]),
    ]),
    el("p:txBody", {}, [paragraph]),
  ]);
}

function minimalTableGraphicFrame(
  gridCols: readonly ReturnType<typeof el>[],
  rows: readonly ReturnType<typeof el>[],
  xfrmAttrs: Readonly<Record<string, string>> = {},
): ReturnType<typeof el> {
  return el("p:graphicFrame", {}, [
    el("p:nvGraphicFramePr", {}, [el("p:cNvPr", { id: "2", name: "Table 1" })]),
    el("p:xfrm", xfrmAttrs, [
      el("a:off", { x: "914400", y: "914400" }),
      el("a:ext", { cx: "1828800", cy: "914400" }),
    ]),
    el("a:graphic", {}, [
      el(
        "a:graphicData",
        { uri: "http://schemas.openxmlformats.org/drawingml/2006/table" },
        [el("a:tbl", {}, [el("a:tblGrid", {}, gridCols), ...rows])],
      ),
    ]),
  ]);
}

function readOnlyTableCell(frame: ReturnType<typeof el>): ContentTableCell {
  const doc = readPptxContent(minimalSlidePackage([frame]));
  const shape = doc.slides[0]?.shapes.find((s) => s.name === "Table 1");
  const table = asTable(shape?.blocks[0]);
  const cell = table.rows[0]?.cells[0];
  if (cell === undefined) {
    throw new Error("expected a cell");
  }
  return cell;
}

describe("readPptxContent: a:spcBef present but carrying no a:spcPts value", () => {
  it("leaves spacingBeforePt undefined when a:spcBef has no a:spcPts child", () => {
    const para = firstShapeParagraph([
      textShape(
        el("a:p", {}, [
          el("a:pPr", {}, [el("a:spcBef", {})]),
          el("a:r", {}, [el("a:t", {}, [txt("x")])]),
        ]),
      ),
    ]);
    expect(para.spacingBeforePt).toBeUndefined();
  });
});

describe("readPptxContent: a:spcAft", () => {
  it("reads an absolute a:spcAft the same way a:spcBef is read", () => {
    const para = firstShapeParagraph([
      textShape(
        el("a:p", {}, [
          el("a:pPr", {}, [
            el("a:spcAft", {}, [el("a:spcPts", { val: "400" })]),
          ]),
          el("a:r", {}, [el("a:t", {}, [txt("x")])]),
        ]),
      ),
    ]);
    const EXPECTED_SPACING_AFTER_PT = 4; // a:spcPts's own val="400" (hundredths of a point)
    expect(para.spacingAfterPt).toBe(EXPECTED_SPACING_AFTER_PT);
  });
});

describe("readPptxContent: a paragraph-level a:pPr/a:defRPr overrides the master cascade", () => {
  it("gives a run with no own rPr the paragraph's own a:defRPr size, not the (absent) master default", () => {
    const para = firstShapeParagraph([
      textShape(
        el("a:p", {}, [
          el("a:pPr", {}, [el("a:defRPr", { sz: "3600" })]),
          el("a:r", {}, [el("a:t", {}, [txt("x")])]),
        ]),
      ),
    ]);
    const EXPECTED_DEFRPR_SIZE_PT = 36; // a:defRPr's own sz="3600" (hundredths of a point)
    expect(para.runs[0]?.sizePt).toBe(EXPECTED_DEFRPR_SIZE_PT);
  });
});

describe("readPptxContent: the a:fld-only field-construct branch never fires for an a:r", () => {
  it("creates no field construct for an a:r, even one carrying a stray @type attribute of its own", () => {
    // @type on a:r is not a real ECMA-376 attribute — it exists here purely to prove the field-construct branch is gated on child.tag === 'a:fld', not merely on whatever attr(child, 'type') happens to return.
    const para = firstShapeParagraph([
      textShape(
        el("a:p", {}, [
          el("a:r", { type: "slidenum" }, [el("a:t", {}, [txt("x")])]),
        ]),
      ),
    ]);
    expect(para.constructs).toBeUndefined();
  });
});

describe("readPptxContent: an a:fld with @type but no cached a:t", () => {
  it('reads cachedResult: "" for a field with no a:t child at all', () => {
    const para = firstShapeParagraph([
      textShape(
        el("a:p", {}, [
          el(
            "a:fld",
            { id: "{00000000-0000-0000-0000-000000000000}", type: "slidenum" },
            [],
          ),
        ]),
      ),
    ]);
    expect(para.constructs?.[0]).toEqual({
      descriptor: { kind: "field", instruction: "slidenum", cachedResult: "" },
      startRun: 0,
      endRun: 1,
    });
  });
});

describe("readPptxContent: a:br within a paragraph", () => {
  it("reads a forced line break as a run of its own, carrying a literal newline, between the runs either side of it", () => {
    const para = firstShapeParagraph([
      textShape(
        el("a:p", {}, [
          el("a:r", {}, [el("a:t", {}, [txt("before")])]),
          el("a:br"),
          el("a:r", {}, [el("a:t", {}, [txt("after")])]),
        ]),
      ),
    ]);
    expect(para.runs.map((run) => run.text)).toEqual(["before", "\n", "after"]);
  });
});

// A standalone table graphicFrame, built without buildFixturePackage's own layout/master chain, so a single cell's border/fill/rotation behaviour can be isolated the same way minimalSlidePackage isolates a paragraph's own properties elsewhere in this file.
describe("readPptxContent: a table cell's borders object carries only the edges that actually resolved", () => {
  function cellFrame(
    tcPrChildren: readonly ReturnType<typeof el>[],
  ): ReturnType<typeof el> {
    const cell = el("a:tc", {}, [
      el("a:tcPr", {}, tcPrChildren),
      el("a:txBody", {}, [
        el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt("x")])])]),
      ]),
    ]);
    return minimalTableGraphicFrame(
      [el("a:gridCol", { w: "914400" })],
      [el("a:tr", {}, [cell])],
    );
  }

  it("carries only a 'top' key when just a:lnT resolves — left/right/bottom are genuinely absent, not present-and-undefined", () => {
    const cell = readOnlyTableCell(
      cellFrame([
        el("a:lnT", { w: "12700" }, [
          el("a:solidFill", {}, [el("a:srgbClr", { val: "FF0000" })]),
        ]),
      ]),
    );
    expect(cell.borders).toStrictEqual({
      top: { color: FILL_RED, widthPt: 1, style: undefined },
    });
  });

  it("carries only a 'bottom' key when just a:lnB resolves — left/right/top are genuinely absent, not present-and-undefined", () => {
    const cell = readOnlyTableCell(
      cellFrame([
        el("a:lnB", { w: "25400" }, [
          el("a:solidFill", {}, [el("a:srgbClr", { val: "0000FF" })]),
        ]),
      ]),
    );
    expect(cell.borders).toStrictEqual({
      bottom: { color: FILL_BLUE, widthPt: 2, style: undefined },
    });
  });
});

describe("readPptxContent: a:pattFill's own foreground/background colours are included only when they resolve", () => {
  function patternCell(
    pattFillChildren: readonly ReturnType<typeof el>[],
  ): ContentTableCell {
    return readOnlyTableCell(
      minimalTableGraphicFrame(
        [el("a:gridCol", { w: "914400" })],
        [
          el("a:tr", {}, [
            el("a:tc", {}, [
              el("a:tcPr", {}, [
                el("a:pattFill", { prst: "pct25" }, pattFillChildren),
              ]),
              el("a:txBody", {}, [
                el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt("x")])])]),
              ]),
            ]),
          ]),
        ],
      ),
    );
  }

  it("carries only foregroundColor when a:bgClr is absent — no backgroundColor key at all, not an undefined-valued one", () => {
    const cell = patternCell([
      el("a:fgClr", {}, [el("a:srgbClr", { val: "00FF00" })]),
    ]);
    expect(cell.background).toStrictEqual({
      kind: "pattern",
      patternType: "percent25",
      foregroundColor: FILL_GREEN,
    });
  });

  it("carries only backgroundColor when a:fgClr is absent — no foregroundColor key at all, not an undefined-valued one", () => {
    const cell = patternCell([
      el("a:bgClr", {}, [el("a:srgbClr", { val: "0000FF" })]),
    ]);
    expect(cell.background).toStrictEqual({
      kind: "pattern",
      patternType: "percent25",
      backgroundColor: FILL_BLUE,
    });
  });
});
