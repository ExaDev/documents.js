import { describe, expect, it } from "vitest";
import type { XmlElement } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { readDiagramResidue, readDiagramText } from "./diagram";

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

// A two-node data model: a doc root, two content nodes, and the parOf connections making it a tree.
function dataModelRoot(): XmlElement {
  const point = (id: string, text: string, type?: string) =>
    el("dgm:pt", type === undefined ? { modelId: id } : { modelId: id, type }, [
      el("dgm:t", {}, [
        el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt(text)])])]),
      ]),
    ]);
  const cxn = (srcId: string, destId: string, srcOrd: string) =>
    el("dgm:cxn", { srcId, destId, type: "parOf", srcOrd });
  return el("dgm:dataModel", {}, [
    el("dgm:ptLst", {}, [
      point("root", "", "doc"),
      point("a", "Ad hoc"),
      point("b", "Repeatable"),
    ]),
    el("dgm:cxnLst", {}, [cxn("root", "a", "0"), cxn("root", "b", "1")]),
  ]);
}

describe("readDiagramText", () => {
  it('marks every node paragraph as origin "diagram"', () => {
    // SmartArt node text reaches the model as ordinary paragraphs, so nothing otherwise distinguishes a
    // process flow's step labels from body prose -- and they are not the same thing: the relationships
    // between the nodes (the arrows, the hierarchy) are not recovered, which a consumer reading them as
    // prose needs to know.
    const paragraphs = readDiagramText(dataModelRoot());

    expect(paragraphs.length).toBeGreaterThan(0);
    expect(paragraphs.every((p) => p.origin === "diagram")).toBe(true);
  });
});
