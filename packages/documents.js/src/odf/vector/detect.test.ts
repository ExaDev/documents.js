import type { ContentVector } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { groupVectorsByShapePosition } from "./detect";

function rect(paintOrder: number | undefined): ContentVector {
  return {
    kind: "rect",
    frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
    fill: { r: 1, g: 0, b: 0 },
    paintOrder,
  };
}

describe("groupVectorsByShapePosition", () => {
  it("throws when a vector carries no paintOrder at all, naming odf.js's own stamping contract", () => {
    expect(() => {
      groupVectorsByShapePosition([], [rect(undefined)]);
    }).toThrow(
      "expected odf.js's own readDrawPageContent to stamp every shape/vector with a paintOrder",
    );
  });

  it("a vector sharing a shape's own paintOrder exactly is NOT counted as coming before that shape", () => {
    // odf.js's real, single shared counter can never actually produce this collision (see the module comment on the function under test), but the boundary itself — strictly less than, not less-than-or-equal — is still this function's own contract and worth pinning directly.
    const groups = groupVectorsByShapePosition([5], [rect(5)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.insertBeforeShapeIndex).toBe(0);
  });

  it("a vector strictly after a shape's paintOrder is grouped behind it", () => {
    const groups = groupVectorsByShapePosition([5], [rect(6)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.insertBeforeShapeIndex).toBe(1);
  });
});
