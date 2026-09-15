import type { ContentVector } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { rotationsOf, withoutRotation } from "./vectors";

const rect: ContentVector = {
  kind: "rect",
  frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
  rotationDeg: 30,
};

const line: ContentVector = {
  kind: "line",
  from: { xPt: 0, yPt: 0 },
  to: { xPt: 10, yPt: 10 },
  stroke: { widthPt: 1, color: { r: 0, g: 0, b: 0 } },
};

describe("withoutRotation", () => {
  it("strips rotationDeg from a non-line vector", () => {
    expect(withoutRotation([rect])).toEqual([
      { ...rect, rotationDeg: undefined },
    ]);
  });

  it("leaves a line vector, which has no rotationDeg field at all, untouched -- not spread with an explicit rotationDeg: undefined key added", () => {
    // toStrictEqual, not toEqual: toEqual treats an explicit `rotationDeg: undefined` key as indistinguishable from the key being absent altogether, which is exactly the difference this test needs to catch.
    expect(withoutRotation([line])).toStrictEqual([line]);
  });
});

describe("rotationsOf", () => {
  it("reports a non-line vector's own rotationDeg", () => {
    expect(rotationsOf([rect])).toEqual([30]);
  });

  it("reports undefined for a line, positionally", () => {
    expect(rotationsOf([rect, line])).toEqual([30, undefined]);
  });
});
