import { describe, expect, it } from "vitest";
import type { XmlElement } from "../../model/node";
import { readChartResidue } from "./chart";

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
