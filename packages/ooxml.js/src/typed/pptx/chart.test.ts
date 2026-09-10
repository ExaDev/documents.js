import { describe, expect, it } from "vitest";
import type { XmlElement } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { readChartResidue, readChartTable } from "./chart";

function chartRoot(): XmlElement {
  return {
    type: "element",
    tag: "c:chartSpace",
    attributes: [],
    children: [
      { type: "element", tag: "c:chart", attributes: [], children: [] },
    ],
  };
}

describe("readChartResidue", () => {
  it("returns the same residue object for repeated calls against the same root, rather than re-serialising it", () => {
    // Multiple graphic frames in one package can share a single relationship target, so readChartFrame hands this function the identical chartRoot instance each time -- without caching, N frames sharing one chart part would re-run buildXml N times over the same tree.
    const root = chartRoot();
    const first = readChartResidue(root, "xlsx");
    const second = readChartResidue(root, "xlsx");
    expect(second).toBe(first);
  });

  it("does not share a cache entry across two distinct chart roots", () => {
    const first = readChartResidue(chartRoot(), "xlsx");
    const second = readChartResidue(chartRoot(), "xlsx");
    expect(second).not.toBe(first);
    expect(second.xml).toBe(first.xml);
  });
});

// One bar chart with a single series, its category labels and values in the caches PowerPoint writes
// beside the data reference.
function barChartRoot(): XmlElement {
  const cachedPoint = (idx: string, value: string) =>
    el("c:pt", { idx }, [el("c:v", {}, [txt(value)])]);
  return el("c:chartSpace", {}, [
    el("c:chart", {}, [
      el("c:plotArea", {}, [
        el("c:barChart", {}, [
          el("c:ser", {}, [
            el("c:tx", {}, [
              el("c:strRef", {}, [
                el("c:strCache", {}, [cachedPoint("0", "FY26")]),
              ]),
            ]),
            el("c:cat", {}, [
              el("c:strRef", {}, [
                el("c:strCache", {}, [
                  cachedPoint("0", "EMEA"),
                  cachedPoint("1", "APAC"),
                ]),
              ]),
            ]),
            el("c:val", {}, [
              el("c:numRef", {}, [
                el("c:numCache", {}, [
                  cachedPoint("0", "42"),
                  cachedPoint("1", "51"),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]),
  ]);
}

describe("readChartTable", () => {
  it('marks the table it produces as origin "chart"', () => {
    // A ContentTable is a native table, a chart's cached data, or a spreadsheet range, and a consumer
    // holding one cannot otherwise tell which. It matters: a chart's cached numbers are exact and
    // quotable, where a vision reading of the same chart would be approximate -- so the two have to be
    // distinguishable by something other than a consumer's guess.
    const table = readChartTable(barChartRoot(), {
      xPt: 0,
      yPt: 0,
      widthPt: 400,
      heightPt: 300,
    });

    expect(table?.origin).toBe("chart");
  });
});
