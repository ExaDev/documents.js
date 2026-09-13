import { describe, expect, it } from "vitest";
import {
  defaultTriangleSubpaths,
  parseColorField,
  parseStrokeField,
} from "./vector-fields";

describe("parseColorField", () => {
  it("parses three space-separated numbers", () => {
    expect(parseColorField("0.1 0.2 0.3")).toEqual({
      r: 0.1,
      g: 0.2,
      b: 0.3,
    });
  });

  it("returns undefined for an empty string", () => {
    expect(parseColorField("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only input", () => {
    expect(parseColorField("   ")).toBeUndefined();
  });

  it("returns undefined when fewer than three numbers are given", () => {
    expect(parseColorField("0.1 0.2")).toBeUndefined();
  });

  it("returns undefined when a component is non-numeric", () => {
    expect(parseColorField("0.1 x 0.3")).toBeUndefined();
  });

  it("returns undefined when a component is non-finite", () => {
    expect(parseColorField("0.1 Infinity 0.3")).toBeUndefined();
  });

  it("tolerates multiple spaces between components", () => {
    expect(parseColorField("0.1   0.2   0.3")).toEqual({
      r: 0.1,
      g: 0.2,
      b: 0.3,
    });
  });
});

describe("parseStrokeField", () => {
  it("parses four space-separated numbers into a colour and width", () => {
    expect(parseStrokeField("0.1 0.2 0.3 2.5")).toEqual({
      color: { r: 0.1, g: 0.2, b: 0.3 },
      widthPt: 2.5,
    });
  });

  it("returns undefined for an empty string", () => {
    expect(parseStrokeField("")).toBeUndefined();
  });

  it("returns undefined when fewer than four numbers are given", () => {
    expect(parseStrokeField("0.1 0.2 0.3")).toBeUndefined();
  });

  it("returns undefined when the width component is non-numeric", () => {
    expect(parseStrokeField("0.1 0.2 0.3 x")).toBeUndefined();
  });

  it("returns undefined when any component is non-finite", () => {
    expect(parseStrokeField("0.1 0.2 Infinity 2.5")).toBeUndefined();
  });
});

describe("defaultTriangleSubpaths", () => {
  it("builds a single closed subpath spanning the given frame", () => {
    const subpaths = defaultTriangleSubpaths(100, 50);
    expect(subpaths).toEqual([
      {
        start: { xPt: 0, yPt: 50 },
        segments: [
          { kind: "line", to: { xPt: 50, yPt: 0 } },
          { kind: "line", to: { xPt: 100, yPt: 50 } },
        ],
        closed: true,
      },
    ]);
  });

  it("scales the apex to exactly half the given width", () => {
    const [subpath] = defaultTriangleSubpaths(60, 40);
    expect(subpath?.segments[0]?.to).toEqual({ xPt: 30, yPt: 0 });
  });
});
