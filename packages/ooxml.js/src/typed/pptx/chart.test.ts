import { describe, expect, it } from "vitest";
import type { Box } from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { readChartResidue, readChartTable } from "./chart";

const FRAME: Box = { xPt: 0, yPt: 0, widthPt: 300, heightPt: 200 };

function cPt(idx: string, value: string) {
  return el("c:pt", { idx }, [el("c:v", {}, [txt(value)])]);
}

function numCache(...pts: ReturnType<typeof cPt>[]) {
  return el("c:numCache", {}, pts);
}

function ser(...children: ReturnType<typeof el>[]) {
  return el("c:ser", {}, children);
}

function chartRootWith(...ser_: ReturnType<typeof el>[]) {
  return el("c:chartSpace", {}, [
    el("c:chart", {}, [el("c:plotArea", {}, ser_)]),
  ]);
}

describe("readChartTable", () => {
  it("returns undefined when the chart root has no <c:chart> at all", () => {
    expect(readChartTable(el("c:chartSpace"), FRAME)).toBeUndefined();
  });

  it("returns undefined when <c:chart> has no <c:plotArea>", () => {
    const chartRoot = el("c:chartSpace", {}, [el("c:chart")]);
    expect(readChartTable(chartRoot, FRAME)).toBeUndefined();
  });

  it("returns undefined when the plot area carries no series at all", () => {
    const chartRoot = chartRootWith();
    expect(readChartTable(chartRoot, FRAME)).toBeUndefined();
  });

  it("reads a single series' cached category/value points via c:numRef/c:numCache", () => {
    const chartRoot = chartRootWith(
      ser(
        el("c:tx", {}, [el("c:v", {}, [txt("Series A")])]),
        el("c:cat", {}, [
          el("c:numRef", {}, [numCache(cPt("0", "Jan"), cPt("1", "Feb"))]),
        ]),
        el("c:val", {}, [
          el("c:numRef", {}, [numCache(cPt("0", "10"), cPt("1", "20"))]),
        ]),
      ),
    );
    const table = readChartTable(chartRoot, FRAME);
    expect(table?.origin).toBe("chart");
    expect(table?.rows).toEqual([
      {
        cells: [
          { blocks: [] },
          { blocks: [{ kind: "paragraph", runs: [{ text: "Series A" }] }] },
        ],
      },
      {
        cells: [
          { blocks: [{ kind: "paragraph", runs: [{ text: "Jan" }] }] },
          { blocks: [{ kind: "paragraph", runs: [{ text: "10" }] }] },
        ],
      },
      {
        cells: [
          { blocks: [{ kind: "paragraph", runs: [{ text: "Feb" }] }] },
          { blocks: [{ kind: "paragraph", runs: [{ text: "20" }] }] },
        ],
      },
    ]);
  });

  it("splits the frame width evenly across every column (category + one per series)", () => {
    const chartRoot = chartRootWith(
      ser(
        el("c:cat", {}, [el("c:numRef", {}, [numCache(cPt("0", "A"))])]),
        el("c:val", {}, [el("c:numRef", {}, [numCache(cPt("0", "1"))])]),
      ),
    );
    const table = readChartTable(chartRoot, { ...FRAME, widthPt: 400 });
    expect(table?.columnWidthsPt).toEqual([200, 200]);
  });

  it("sorts category indexes NUMERICALLY, not lexicographically or in insertion order", () => {
    const chartRoot = chartRootWith(
      ser(
        el("c:cat", {}, [
          el("c:numRef", {}, [
            numCache(cPt("10", "ten"), cPt("2", "two"), cPt("1", "one")),
          ]),
        ]),
        el("c:val", {}, [el("c:numRef", {}, [numCache(cPt("0", "x"))])]),
      ),
    );
    const table = readChartTable(chartRoot, FRAME);
    // Row 0 is the header; rows 1.. follow in ascending numeric index order: 1, 2, 10.
    const categoryLabels = table?.rows
      .slice(1)
      .map((row) => row.cells[0]?.blocks[0]);
    expect(categoryLabels).toEqual([
      { kind: "paragraph", runs: [{ text: "one" }] },
      { kind: "paragraph", runs: [{ text: "two" }] },
      { kind: "paragraph", runs: [{ text: "ten" }] },
    ]);
  });

  it("keeps the FIRST series' category label at a shared index, not a later series' overwrite", () => {
    const chartRoot = chartRootWith(
      ser(
        el("c:cat", {}, [el("c:numRef", {}, [numCache(cPt("0", "first"))])]),
        el("c:val", {}, [el("c:numRef", {}, [numCache(cPt("0", "1"))])]),
      ),
      ser(
        el("c:cat", {}, [el("c:numRef", {}, [numCache(cPt("0", "second"))])]),
        el("c:val", {}, [el("c:numRef", {}, [numCache(cPt("0", "2"))])]),
      ),
    );
    const table = readChartTable(chartRoot, FRAME);
    expect(table?.rows[1]?.cells[0]).toEqual({
      blocks: [{ kind: "paragraph", runs: [{ text: "first" }] }],
    });
  });

  it("reads a scatter series' c:xVal/c:yVal as the category/value axes", () => {
    const chartRoot = chartRootWith(
      ser(
        el("c:xVal", {}, [el("c:numRef", {}, [numCache(cPt("0", "1.5"))])]),
        el("c:yVal", {}, [el("c:numRef", {}, [numCache(cPt("0", "2.5"))])]),
      ),
    );
    const table = readChartTable(chartRoot, FRAME);
    expect(table?.rows[1]?.cells).toEqual([
      { blocks: [{ kind: "paragraph", runs: [{ text: "1.5" }] }] },
      { blocks: [{ kind: "paragraph", runs: [{ text: "2.5" }] }] },
    ]);
  });

  it("prefers c:cat over c:xVal when a series carries both", () => {
    const chartRoot = chartRootWith(
      ser(
        el("c:cat", {}, [el("c:numRef", {}, [numCache(cPt("0", "cat"))])]),
        el("c:xVal", {}, [el("c:numRef", {}, [numCache(cPt("0", "xval"))])]),
        el("c:val", {}, [el("c:numRef", {}, [numCache(cPt("0", "1"))])]),
      ),
    );
    const table = readChartTable(chartRoot, FRAME);
    expect(table?.rows[1]?.cells[0]).toEqual({
      blocks: [{ kind: "paragraph", runs: [{ text: "cat" }] }],
    });
  });

  it("reads a series name from a cached string reference when c:tx has no inline c:v", () => {
    const chartRoot = chartRootWith(
      ser(
        el("c:tx", {}, [
          el("c:strRef", {}, [el("c:strCache", {}, [cPt("0", "Cached Name")])]),
        ]),
        el("c:cat", {}, [el("c:numRef", {}, [numCache(cPt("0", "A"))])]),
        el("c:val", {}, [el("c:numRef", {}, [numCache(cPt("0", "1"))])]),
      ),
    );
    const table = readChartTable(chartRoot, FRAME);
    expect(table?.rows[0]?.cells[1]).toEqual({
      blocks: [{ kind: "paragraph", runs: [{ text: "Cached Name" }] }],
    });
  });

  it("reads no series name at all as an empty header cell, not a literal 'undefined'", () => {
    const chartRoot = chartRootWith(
      ser(
        el("c:cat", {}, [el("c:numRef", {}, [numCache(cPt("0", "A"))])]),
        el("c:val", {}, [el("c:numRef", {}, [numCache(cPt("0", "1"))])]),
      ),
    );
    const table = readChartTable(chartRoot, FRAME);
    expect(table?.rows[0]?.cells[1]).toEqual({ blocks: [] });
  });

  it("reads the deepest (last) level of a multi-level cached string reference", () => {
    const chartRoot = chartRootWith(
      ser(
        el("c:cat", {}, [
          el("c:multiLvlStrRef", {}, [
            el("c:multiLvlStrCache", {}, [
              el("c:lvl", {}, [cPt("0", "outer")]),
              el("c:lvl", {}, [cPt("0", "inner")]),
            ]),
          ]),
        ]),
        el("c:val", {}, [el("c:numRef", {}, [numCache(cPt("0", "1"))])]),
      ),
    );
    const table = readChartTable(chartRoot, FRAME);
    expect(table?.rows[1]?.cells[0]).toEqual({
      blocks: [{ kind: "paragraph", runs: [{ text: "inner" }] }],
    });
  });

  it("reads points sitting directly on the source itself when no ref/cache wrapper exists", () => {
    const chartRoot = chartRootWith(
      ser(
        el("c:cat", {}, [cPt("0", "inline-cat")]),
        el("c:val", {}, [cPt("0", "inline-val")]),
      ),
    );
    const table = readChartTable(chartRoot, FRAME);
    expect(table?.rows[1]?.cells).toEqual([
      { blocks: [{ kind: "paragraph", runs: [{ text: "inline-cat" }] }] },
      { blocks: [{ kind: "paragraph", runs: [{ text: "inline-val" }] }] },
    ]);
  });

  it("skips a c:pt with no idx or no c:v child, rather than crashing or fabricating a point", () => {
    const chartRoot = chartRootWith(
      ser(
        el("c:cat", {}, [
          el("c:numRef", {}, [
            el("c:numCache", {}, [
              el("c:pt", {}, [el("c:v", {}, [txt("no-idx")])]),
              el("c:pt", { idx: "1" }, []),
              cPt("0", "kept"),
            ]),
          ]),
        ]),
        el("c:val", {}, [el("c:numRef", {}, [numCache(cPt("0", "1"))])]),
      ),
    );
    const table = readChartTable(chartRoot, FRAME);
    // Only index 0 ("kept") should have made it through -- the header row plus exactly one data row.
    expect(table?.rows).toHaveLength(2);
    expect(table?.rows[1]?.cells[0]).toEqual({
      blocks: [{ kind: "paragraph", runs: [{ text: "kept" }] }],
    });
  });
});

describe("readChartResidue", () => {
  it("serialises the whole chart root as xml residue of the given format", () => {
    const chartRoot = el("c:chartSpace", { "xmlns:c": "urn:example" }, []);
    const residue = readChartResidue(chartRoot, "pptx");
    expect(residue.format).toBe("pptx");
    expect(residue.xml).toContain("c:chartSpace");
  });

  it("caches by the chart root's own object identity, returning the SAME residue for the same element", () => {
    const chartRoot = el("c:chartSpace", {}, []);
    const first = readChartResidue(chartRoot, "xlsx");
    const second = readChartResidue(chartRoot, "xlsx");
    expect(second).toBe(first);
  });

  it("does not share a cache entry between two distinct chart root elements, even if structurally identical", () => {
    const a = el("c:chartSpace", {}, []);
    const b = el("c:chartSpace", {}, []);
    const residueA = readChartResidue(a, "pptx");
    const residueB = readChartResidue(b, "pptx");
    expect(residueB).not.toBe(residueA);
    expect(residueB).toEqual(residueA);
  });
});
