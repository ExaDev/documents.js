import type { ContentVector } from "document-schema.js";
import { childrenWithTag, attr } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { buildVectorShape } from "./vector";

function rect(): ContentVector {
  return {
    kind: "rect",
    frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 5 },
  };
}

describe("buildVectorShape", () => {
  it("wraps the shape properties in a real p:sp/p:nvSpPr with the expected child tags", () => {
    const sp = buildVectorShape(rect(), 3);
    expect(sp.tag).toBe("p:sp");
    expect(
      sp.children.map((c) => (c.type === "element" ? c.tag : c.type)),
    ).toEqual(["p:nvSpPr", "p:spPr"]);

    const [nvSpPr] = childrenWithTag(sp, "p:nvSpPr");
    expect(nvSpPr).toBeDefined();
    expect(
      nvSpPr === undefined
        ? []
        : nvSpPr.children.map((c) => (c.type === "element" ? c.tag : c.type)),
    ).toEqual(["p:cNvPr", "p:cNvSpPr", "p:nvPr"]);

    const [cNvPr] =
      nvSpPr === undefined ? [] : childrenWithTag(nvSpPr, "p:cNvPr");
    expect(cNvPr).toBeDefined();
    expect(cNvPr === undefined ? undefined : attr(cNvPr, "id")).toBe("3");
    expect(cNvPr === undefined ? undefined : attr(cNvPr, "name")).toBe(
      "Rect 3",
    );
  });

  it("derives the shape id and name from the supplied id, not a hardcoded value", () => {
    const sp = buildVectorShape(rect(), 7);
    const [nvSpPr] = childrenWithTag(sp, "p:nvSpPr");
    const [cNvPr] =
      nvSpPr === undefined ? [] : childrenWithTag(nvSpPr, "p:cNvPr");
    expect(cNvPr === undefined ? undefined : attr(cNvPr, "id")).toBe("7");
    expect(cNvPr === undefined ? undefined : attr(cNvPr, "name")).toBe(
      "Rect 7",
    );
  });
});
