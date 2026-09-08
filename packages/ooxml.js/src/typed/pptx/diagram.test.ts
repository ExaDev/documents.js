import { describe, expect, it } from "vitest";
import type { XmlElement } from "../../model/node";
import { readDiagramResidue } from "./diagram";

function part(tag: string): XmlElement {
  return { type: "element", tag, attributes: [], children: [] };
}

describe("readDiagramResidue", () => {
  it("returns the same residue object for repeated calls against the same triple of roots", () => {
    // Multiple graphic frames can share one diagram's layout/quickStyle/colour relationship targets, so this must cache by object identity the same way readChartResidue does.
    const layout = part("dgm:relIds");
    const quickStyle = part("dgm:styleData");
    const colors = part("dgm:colorsDef");
    const first = readDiagramResidue(layout, quickStyle, colors);
    const second = readDiagramResidue(layout, quickStyle, colors);
    expect(second).toBe(first);
  });

  it("distinguishes triples that share some but not all roots", () => {
    const layout = part("dgm:relIds");
    const quickStyleA = part("dgm:styleData");
    const quickStyleB = part("dgm:styleData");
    const colors = part("dgm:colorsDef");
    const first = readDiagramResidue(layout, quickStyleA, colors);
    const second = readDiagramResidue(layout, quickStyleB, colors);
    expect(second).not.toBe(first);
  });

  it("returns undefined, uncached, when every part is absent", () => {
    expect(readDiagramResidue(undefined, undefined, undefined)).toBeUndefined();
  });
});
