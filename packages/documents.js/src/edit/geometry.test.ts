import type { Box } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { el } from "../xml/fragment";
import { applyOdfGeometry, buildTransformAttr } from "./geometry";

function attr(node: ReturnType<typeof el>, name: string): string | undefined {
  return node.attributes.find((a) => a.name === name)?.value;
}

const frame: Box = { xPt: 10, yPt: 20, widthPt: 100, heightPt: 50 };

describe("applyOdfGeometry", () => {
  it("writes plain svg:x/svg:y and removes draw:transform when rotationDeg is undefined", () => {
    const node = el("draw:frame", {
      "draw:transform": "rotate(1) translate(2 3)",
    });
    applyOdfGeometry(node, frame, undefined);
    expect(attr(node, "svg:width")).toBe("100pt");
    expect(attr(node, "svg:height")).toBe("50pt");
    expect(attr(node, "svg:x")).toBe("10pt");
    expect(attr(node, "svg:y")).toBe("20pt");
    expect(attr(node, "draw:transform")).toBeUndefined();
  });

  it("writes plain svg:x/svg:y and removes draw:transform when rotationDeg is exactly 0", () => {
    const node = el("draw:frame", {
      "draw:transform": "rotate(1) translate(2 3)",
    });
    applyOdfGeometry(node, frame, 0);
    expect(attr(node, "svg:x")).toBe("10pt");
    expect(attr(node, "svg:y")).toBe("20pt");
    expect(attr(node, "draw:transform")).toBeUndefined();
  });

  it("writes draw:transform and removes svg:x/svg:y for a non-zero rotation", () => {
    const node = el("draw:frame", { "svg:x": "10pt", "svg:y": "20pt" });
    applyOdfGeometry(node, frame, 90);
    expect(attr(node, "svg:x")).toBeUndefined();
    expect(attr(node, "svg:y")).toBeUndefined();
    expect(attr(node, "draw:transform")).toBe(buildTransformAttr(frame, 90));
  });
});

describe("buildTransformAttr", () => {
  it("round-trips the frame's own centre through the rotate+translate composition", () => {
    const transform = buildTransformAttr(frame, 90);
    expect(transform).toMatch(
      /^rotate\(-1\.5707963267948966\) translate\(-?\d+(\.\d+)?pt -?\d+(\.\d+)?pt\)$/,
    );
  });

  it("produces a zero translate when rotating an already-centred (origin) frame with zero angle", () => {
    const centred: Box = { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 };
    expect(buildTransformAttr(centred, 0)).toBe("rotate(0) translate(0pt 0pt)");
  });
});
