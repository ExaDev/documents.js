import { describe, expect, it } from "vitest";
import { decodeWpgGraphic } from "./wpg";
import { NO_TEXT, record, startWpgData, word, wpg } from "../test-support/wpg";

describe("readPolyline boundaries and branching", () => {
  it("refuses a Polyline with no room for its own point count", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x15, [...word(0x8000)]), // flags only, no count field
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["Polyline"]);
  });

  it("refuses a zero-point Polyline", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x15, [...word(0x8000), ...word(0)]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["Polyline"]);
  });

  it("refuses a Polyline truncated partway through its own point list", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x15, [
        ...word(0x8000),
        ...word(3), // declares 3 points
        ...word(0),
        ...word(0), // only the first point's bytes are present
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["Polyline"]);
  });

  it("keeps a single point as a one-segment path rather than the two-point line variant", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x15, [...word(0x8000), ...word(1), ...word(10), ...word(20)]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    expect(path.subpaths[0]?.segments).toEqual([]);
  });

  it("keeps a closed two-point Polyline as a path rather than the line variant", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x25, [0, 0, 0, 0]),
      record(0x2b, [...word(1), ...word(1)]),
      record(0x15, [
        ...word(0x8000 | 0x4000), // FRM|CLOSE
        ...word(2),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    expect(path.subpaths[0]?.closed).toBe(true);
  });

  it("keeps a two-point unclosed Polyline with no resolved stroke as a path rather than the line variant", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      // No FRM bit, so no stroke resolves even though there are exactly two points.
      record(0x15, [
        ...word(0),
        ...word(2),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    expect(path.subpaths[0]?.closed).toBe(false);
  });

  it("computes a multi-point path's bounding frame from each point's own extreme, not just the first or last", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x15, [
        ...word(0),
        ...word(4),
        ...word(10),
        ...word(50),
        ...word(90),
        ...word(80),
        ...word(50),
        ...word(10),
        ...word(30),
        ...word(90),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    expect(path.frame).toEqual({
      xPt: 10,
      yPt: 54,
      widthPt: 80,
      heightPt: 80,
    });
  });

  it("applies the nonzero winding-rule fill only when both FIL and the winding flag are set", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x31, [0, 255, 0, 0]), // Brush Fore Color: green, fully opaque
      record(0x15, [
        ...word(0x2000 | 0x1000), // FIL and the path-winding bit (bit 12)
        ...word(3),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    expect(path.fillRule).toBe("nonzero");
  });

  it("omits fillRule for a filled path when the winding bit is not set", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x31, [0, 255, 0, 0]),
      record(0x15, [
        ...word(0x2000), // FIL only
        ...word(3),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    expect(path.fillRule).toBeUndefined();
  });

  it("includes fillOpacity for a translucent fill and omits it for a fully opaque one", () => {
    const translucent = wpg([
      record(0x01, startWpgData({})),
      record(0x31, [0, 255, 0, 128]), // green, alpha (transparency) 128/255
      record(0x15, [
        ...word(0x2000),
        ...word(3),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
    ]);
    const opaque = wpg([
      record(0x01, startWpgData({})),
      record(0x31, [0, 255, 0, 0]), // green, fully opaque
      record(0x15, [
        ...word(0x2000),
        ...word(3),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
    ]);
    const decodedTranslucent = decodeWpgGraphic(translucent, NO_TEXT);
    const decodedOpaque = decodeWpgGraphic(opaque, NO_TEXT);
    if (
      decodedTranslucent?.status !== "decoded" ||
      decodedOpaque?.status !== "decoded"
    ) {
      throw new Error("expected decoded graphics");
    }
    const translucentPath = decodedTranslucent.vectors[0];
    const opaquePath = decodedOpaque.vectors[0];
    if (translucentPath?.kind !== "path" || opaquePath?.kind !== "path") {
      throw new Error("expected path vectors");
    }
    expect(translucentPath.fillOpacity).toBeCloseTo(1 - 128 / 255);
    expect(opaquePath.fillOpacity).toBeUndefined();
  });
});

describe("readWpgRectangle's rounded-corner path", () => {
  // rx and ry are checked independently ("if EITHER... is less than or equal to zero"), so each boundary needs its own isolated test with the other axis held well clear of zero, otherwise a wrong comparison on one axis hides behind the other axis' own, correct, square-corner trigger.
  it("treats rx of exactly zero as a square corner even with a real, positive ry", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x18, [
        ...word(0x8000), // FRM only
        ...word(0),
        ...word(0),
        ...word(100),
        ...word(60),
        ...word(0), // rx: exactly zero
        ...word(6), // ry: a real, positive radius
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
  });

  it("treats ry of exactly zero as a square corner even with a real, positive rx", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x18, [
        ...word(0x8000), // FRM only
        ...word(0),
        ...word(0),
        ...word(100),
        ...word(60),
        ...word(10), // rx: a real, positive radius
        ...word(0), // ry: exactly zero
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
  });

  it("keeps each axis' own corner radius unclamped when neither exceeds half its side", () => {
    const kappa = (4 / 3) * (Math.SQRT2 - 1);
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x18, [
        ...word(0x8000), // FRM only
        ...word(0),
        ...word(0), // xll, yll (raw)
        ...word(100),
        ...word(60), // xur, yur (raw), so raw width 100, raw height 60
        ...word(10), // rx
        ...word(6), // ry
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    const width = path.frame.widthPt;
    const height = path.frame.heightPt;
    const cornerRxPt = 10;
    const cornerRyPt = 6;
    const kx = cornerRxPt * kappa;
    const ky = cornerRyPt * kappa;
    const subpath = path.subpaths[0];
    if (subpath === undefined) throw new Error("expected a subpath");
    expect(subpath.start).toEqual({ xPt: 0, yPt: height / 2 });
    const [line1, cubic1, line2, cubic2, line3, cubic3, line4, cubic4, line5] =
      subpath.segments;
    if (
      line1?.kind !== "line" ||
      cubic1?.kind !== "cubic" ||
      line2?.kind !== "line" ||
      cubic2?.kind !== "cubic" ||
      line3?.kind !== "line" ||
      cubic3?.kind !== "cubic" ||
      line4?.kind !== "line" ||
      cubic4?.kind !== "cubic" ||
      line5?.kind !== "line"
    ) {
      throw new Error("expected the rounded-rectangle's nine segments");
    }
    expect(line1.to).toEqual({ xPt: cornerRxPt, yPt: 0 });
    expect(cubic1.control1.xPt).toBeCloseTo(cornerRxPt - kx);
    expect(cubic1.control1.yPt).toBe(0);
    expect(cubic1.control2.xPt).toBe(width);
    expect(cubic1.control2.yPt).toBeCloseTo(cornerRyPt - ky);
    expect(cubic1.to).toEqual({ xPt: width, yPt: cornerRyPt });
    expect(line2.to).toEqual({ xPt: width, yPt: height - cornerRyPt });
    expect(cubic2.control1.xPt).toBe(width);
    expect(cubic2.control1.yPt).toBeCloseTo(height - cornerRyPt + ky);
    expect(cubic2.control2.xPt).toBeCloseTo(width - cornerRxPt + kx);
    expect(cubic2.control2.yPt).toBe(height);
    expect(cubic2.to).toEqual({ xPt: width - cornerRxPt, yPt: height });
    expect(line3.to).toEqual({ xPt: cornerRxPt, yPt: height });
    expect(cubic3.control1.xPt).toBeCloseTo(cornerRxPt - kx);
    expect(cubic3.control1.yPt).toBe(height);
    expect(cubic3.control2.xPt).toBe(0);
    expect(cubic3.control2.yPt).toBeCloseTo(height - cornerRyPt + ky);
    expect(cubic3.to).toEqual({ xPt: 0, yPt: height - cornerRyPt });
    expect(line4.to).toEqual({ xPt: 0, yPt: cornerRyPt });
    expect(cubic4.control1.xPt).toBe(0);
    expect(cubic4.control1.yPt).toBeCloseTo(cornerRyPt - ky);
    expect(cubic4.control2.xPt).toBeCloseTo(cornerRxPt - kx);
    expect(cubic4.control2.yPt).toBe(0);
    expect(cubic4.to).toEqual({ xPt: cornerRxPt, yPt: 0 });
    expect(line5.to).toEqual({ xPt: 0, yPt: height / 2 });
    expect(subpath.closed).toBe(true);
    expect(Object.hasOwn(path, "stroke")).toBe(false);
  });

  it("clamps each axis' own corner radius to half its side when the declared radius is larger", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x18, [
        ...word(0x8000),
        ...word(0),
        ...word(0),
        ...word(100),
        ...word(60),
        ...word(1000), // rx, far larger than half the 100pt width
        ...word(1000), // ry, far larger than half the 60pt height
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    const subpath = path.subpaths[0];
    const [firstLine, firstCubic] = subpath?.segments ?? [];
    if (firstLine?.kind !== "line") throw new Error("expected a line segment");
    if (firstCubic?.kind !== "cubic")
      throw new Error("expected a cubic segment");
    // Clamped to half the width (50) and half the height (30), not the declared 1000. cornerRyPt (the height's own clamp) surfaces only in the first cubic's own endpoint, never in the first line, which always ends at y=0 regardless of either axis' radius.
    expect(firstLine.to).toEqual({ xPt: 50, yPt: 0 });
    expect(firstCubic.to).toEqual({ xPt: 100, yPt: 30 });
    expect(Object.hasOwn(path, "stroke")).toBe(false);
  });

  it("carries a real stroke on a rounded rectangle, not just a square one", () => {
    // Every other rounded-rectangle fixture in this file has no active pen width, so its own stroke is always absent regardless, proving the rounded path's own stroke spread actually fires needs one with a real, active pen width behind it.
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x25, [255, 0, 0, 0]), // Pen Fore Color: red, opaque
      record(0x2b, [...word(2), ...word(2)]), // Pen Size: 2 units
      record(0x18, [
        ...word(0x8000), // FRM only
        ...word(0),
        ...word(0),
        ...word(100),
        ...word(60),
        ...word(10), // rx
        ...word(6), // ry
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    expect(path.stroke).toEqual({ color: { r: 1, g: 0, b: 0 }, widthPt: 2 });
  });

  it("refuses a Rectangle with no room for its own six coordinates", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x18, [
        ...word(0x8000),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
        ...word(0),
        // ry's own two bytes are missing
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["Rectangle"]);
  });

  it("includes fillOpacity for a translucent rectangle fill", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x31, [255, 0, 0, 64]), // red, alpha (transparency) 64/255
      record(0x18, [
        ...word(0x2000),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
        ...word(0),
        ...word(0),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
    expect(rect.fillOpacity).toBeCloseTo(1 - 64 / 255);
  });

  it("omits fillOpacity for a fully opaque rectangle fill", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x31, [255, 0, 0, 0]), // red, fully opaque
      record(0x18, [
        ...word(0x2000),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
        ...word(0),
        ...word(0),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
    expect(Object.hasOwn(rect, "fillOpacity")).toBe(false);
  });

  it("gives a rectangle no fill field at all when FIL is not set", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x18, [
        ...word(0x8000), // FRM only, no FIL, and no pen size record so no stroke either
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
        ...word(0),
        ...word(0),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
    expect(Object.hasOwn(rect, "fill")).toBe(false);
    expect(Object.hasOwn(rect, "stroke")).toBe(false);
  });
});

describe("readWpgFullEllipse's boundaries and endpoint check", () => {
  it("refuses an Arc one byte short of its own eight coordinates plus flags byte", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x19, [
        ...word(0x2000),
        ...word(72),
        ...word(72),
        ...word(36),
        ...word(24),
        ...word(0),
        ...word(0),
        ...word(0),
        // ey's own two bytes and the trailing arc-flags byte are missing
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["Arc"]);
  });

  it("refuses an Arc with all eight of its own coordinates present but not its trailing arc-flags byte", () => {
    // Exactly the 8 real coordinates, no more: the +1 the check requires for the (never-read) arc-flags byte is the one byte genuinely missing here.
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x19, [
        ...word(0x2000),
        ...word(72),
        ...word(72),
        ...word(36),
        ...word(24),
        ...word(0),
        ...word(0),
        ...word(0),
        ...word(0),
        // no trailing arc-flags byte
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["Arc"]);
  });

  it("refuses an Arc whose initial and terminal X offsets differ alone", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x19, [
        ...word(0x2000),
        ...word(72),
        ...word(72),
        ...word(36),
        ...word(24),
        ...word(10),
        ...word(5), // ix, iy
        ...word(20),
        ...word(5), // ex, ey, x differs, y matches
        0,
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["Arc"]);
  });

  it("refuses an Arc whose initial and terminal Y offsets differ alone", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x19, [
        ...word(0x2000),
        ...word(72),
        ...word(72),
        ...word(36),
        ...word(24),
        ...word(10),
        ...word(5), // ix, iy
        ...word(10),
        ...word(9), // ex, ey, y differs, x matches
        0,
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["Arc"]);
  });

  it("gives an unfilled ellipse no fill field at all", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x19, [
        ...word(0), // no FIL, no FRM
        ...word(72),
        ...word(72),
        ...word(36),
        ...word(24),
        ...word(0),
        ...word(0),
        ...word(0),
        ...word(0),
        0,
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const ellipse = decoded.vectors[0];
    if (ellipse?.kind !== "ellipse") throw new Error("expected an ellipse");
    expect(Object.hasOwn(ellipse, "fill")).toBe(false);
    expect(Object.hasOwn(ellipse, "stroke")).toBe(false);
  });

  it("omits fillOpacity for a fully opaque, filled ellipse", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x31, [255, 0, 0, 0]), // red, fully opaque
      record(0x19, [
        ...word(0x2000), // FIL only
        ...word(72),
        ...word(72),
        ...word(36),
        ...word(24),
        ...word(0),
        ...word(0),
        ...word(0),
        ...word(0),
        0,
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const ellipse = decoded.vectors[0];
    if (ellipse?.kind !== "ellipse") throw new Error("expected an ellipse");
    expect(ellipse.fill).toEqual({ r: 1, g: 0, b: 0 });
    expect(Object.hasOwn(ellipse, "fillOpacity")).toBe(false);
  });

  it("includes fillOpacity for a translucent ellipse fill and a stroke for a framed one", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x25, [0, 0, 255, 0]), // blue pen, fully opaque
      record(0x2b, [...word(1), ...word(1)]),
      record(0x31, [255, 0, 0, 128]), // red brush, alpha (transparency) 128/255
      record(0x19, [
        ...word(0x2000 | 0x8000), // FIL and FRM
        ...word(72),
        ...word(72),
        ...word(36),
        ...word(24),
        ...word(0),
        ...word(0),
        ...word(0),
        ...word(0),
        0,
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const ellipse = decoded.vectors[0];
    if (ellipse?.kind !== "ellipse") throw new Error("expected an ellipse");
    expect(ellipse.fillOpacity).toBeCloseTo(1 - 128 / 255);
    expect(ellipse.stroke?.color).toEqual({ r: 0, g: 0, b: 1 });
  });
});

describe("readPolyline's own point-local-to-frame arithmetic and stroke", () => {
  it("shifts every path point by subtracting the frame's own origin, not adding it", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x15, [
        ...word(0),
        ...word(4),
        ...word(10),
        ...word(50),
        ...word(90),
        ...word(80),
        ...word(50),
        ...word(10),
        ...word(30),
        ...word(90),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    // Frame is {xPt:10, yPt:54}; the raw points convert to (10,94),(90,64),(50,134),(30,54).
    expect(path.subpaths[0]?.start).toEqual({ xPt: 0, yPt: 40 });
    expect(path.subpaths[0]?.segments).toEqual([
      { kind: "line", to: { xPt: 80, yPt: 10 } },
      { kind: "line", to: { xPt: 40, yPt: 80 } },
      { kind: "line", to: { xPt: 20, yPt: 0 } },
    ]);
    // FIL is not set: the path must carry no fill at all.
    expect(Object.hasOwn(path, "fill")).toBe(false);
  });

  it("carries a stroke onto a multi-point (non-two-point-line) path when a stroke resolves", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x25, [255, 0, 0, 0]), // red pen
      record(0x2b, [...word(3), ...word(3)]), // width 3
      record(0x15, [
        ...word(0x8000), // FRM
        ...word(3),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    expect(path.stroke).toEqual({ color: { r: 1, g: 0, b: 0 }, widthPt: 3 });
  });

  it("gives a Polyline no stroke when FRM is not set, even with a real pen width already active", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x25, [255, 0, 0, 0]),
      record(0x2b, [...word(3), ...word(3)]),
      // No FRM bit: a stroke must not resolve regardless of the active pen width.
      record(0x15, [
        ...word(0),
        ...word(3),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    // Not just an undefined value: the key itself must be absent, since toEqual/toBeUndefined can't tell "no stroke key at all" from "a stroke key holding undefined", and only the former is what an absent stroke should actually produce.
    expect(path).not.toHaveProperty("stroke");
  });

  it("refuses a Polyline whose weakened per-point bounds check would otherwise read a coordinate past the buffer", () => {
    // count = 2; the first point's own 4 bytes are present in full, but the second point has only its own X, not its Y.
    const data = [
      ...word(0x8000), // flags
      ...word(2), // count
      ...word(5),
      ...word(5), // point 1: full
      ...word(7), // point 2: X only, no Y
    ];
    const graphic = wpg([record(0x01, startWpgData({})), record(0x15, data)]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["Polyline"]);
  });
});
