import { describe, expect, it } from "vitest";
import { el } from "../../xml/fragment";
import {
  applyOdfTransform,
  composeOdfGroupTransform,
  netRotationDeg,
  parseOdfTransform,
  resolveOdfShapeGeometry,
} from "./transform";

// The geometry expectations below are not derived from the OASIS spec text alone — they are the exact pixel-measured results of a real LibreOffice round trip: a 200pt x 60pt shape at svg:x=100pt/svg:y=100pt was rewritten with draw:transform="rotate(<radians>) translate(100pt 100pt)" for two different angles, converted to PDF via `soffice --headless --convert-to pdf`, rasterised, and its rendered bounding box measured in pixels. See transform.ts's own top-of-file note for why this was necessary (the naive SVG-transform-list reading gets the composition order/sign wrong).

const PRECISION_DIGITS = 6;
const closeTo = (value: number, expected: number) => {
  expect(value).toBeCloseTo(expected, PRECISION_DIGITS);
};

const POINTS_PER_INCH = 72;
const CM_PER_INCH = 2.54;

describe("parseOdfTransform", () => {
  it('parses "rotate(angle) translate(x y)" (no space before the parenthesis) into its function list, in document order', () => {
    const xCm = 2;
    const yCm = 3;
    expect(
      parseOdfTransform(
        `rotate(0.5235987755982988) translate(${xCm}cm ${yCm}cm)`,
      ),
    ).toEqual([
      { kind: "rotate", angleRad: 0.5235987755982988 },
      {
        kind: "translate",
        xPt: xCm * (POINTS_PER_INCH / CM_PER_INCH),
        yPt: yCm * (POINTS_PER_INCH / CM_PER_INCH),
      },
    ]);
  });

  it("parses the real LibreOffice-written form, WITH a space before the parenthesis (verified via an odp -> odp round trip)", () => {
    const xyCm = 3.528;
    expect(
      parseOdfTransform(
        `rotate (0.523598775598299) translate (${xyCm}cm ${xyCm}cm)`,
      ),
    ).toEqual([
      { kind: "rotate", angleRad: 0.523598775598299 },
      {
        kind: "translate",
        xPt: xyCm * (POINTS_PER_INCH / CM_PER_INCH),
        yPt: xyCm * (POINTS_PER_INCH / CM_PER_INCH),
      },
    ]);
  });

  it("defaults translate's y argument to 0 when only one length is given, per the ODF grammar", () => {
    expect(parseOdfTransform("translate(10pt)")).toEqual([
      { kind: "translate", xPt: 10, yPt: 0 },
    ]);
  });

  it("skips a function this module does not model (scale/skewX/skewY/matrix) without aborting the rest of the list", () => {
    expect(parseOdfTransform("scale(2 2) rotate(1.0) skewX(0.1)")).toEqual([
      { kind: "rotate", angleRad: 1.0 },
    ]);
  });

  it("skips a rotate/translate whose own argument does not parse, without aborting the rest of the list", () => {
    expect(
      parseOdfTransform("rotate(not-a-number) translate(10pt 20pt)"),
    ).toEqual([{ kind: "translate", xPt: 10, yPt: 20 }]);
    expect(parseOdfTransform("translate(not-a-length) rotate(1.0)")).toEqual([
      { kind: "rotate", angleRad: 1.0 },
    ]);
  });

  it("returns an empty list for a value with no recognised function at all", () => {
    expect(parseOdfTransform("")).toEqual([]);
    expect(parseOdfTransform("matrix(1 0 0 1 0 0)")).toEqual([]);
  });

  it("skips rotate() called with no argument at all, rather than treating it as angle zero", () => {
    expect(parseOdfTransform("rotate()")).toEqual([]);
  });

  it("does not parse an unmodelled function's own args as translate's, even when they'd otherwise look like valid lengths", () => {
    // scale's own two arguments ("10pt 10pt") are deliberately unit-bearing here, unlike the other "skips a function this module does not model" case above (whose "2 2" scale args fail to parse as lengths either way) — this is the case that actually distinguishes "genuinely skipped because it isn't translate" from "accidentally parsed as translate and happened to succeed".
    expect(parseOdfTransform("scale(10pt 10pt)")).toEqual([]);
  });

  it("collapses a run of several spaces between translate's own two arguments into one separator", () => {
    expect(parseOdfTransform("translate(10pt   20pt)")).toEqual([
      { kind: "translate", xPt: 10, yPt: 20 },
    ]);
  });
});

describe("applyOdfTransform: matches the real LibreOffice-rendered bounding box", () => {
  it("rotate(pi/2) translate(100pt 100pt) on a 200x60pt local box lands its corners at the pixel-measured x:[100,160] / y:[-100,100]", () => {
    const functions = parseOdfTransform(
      "rotate(1.5707963267948966) translate(100pt 100pt)",
    );
    const corners = [
      { xPt: 0, yPt: 0 },
      { xPt: 200, yPt: 0 },
      { xPt: 0, yPt: 60 },
      { xPt: 200, yPt: 60 },
    ].map((p) => applyOdfTransform(functions, p));
    const xs = corners.map((p) => p.xPt);
    const ys = corners.map((p) => p.yPt);
    const measuredMinXPt = 100;
    const measuredMaxXPt = 160;
    const measuredMinYPt = -100;
    const measuredMaxYPt = 100;
    closeTo(Math.min(...xs), measuredMinXPt);
    closeTo(Math.max(...xs), measuredMaxXPt);
    closeTo(Math.min(...ys), measuredMinYPt);
    closeTo(Math.max(...ys), measuredMaxYPt);
  });

  it("rotate(pi/6) translate(100pt 100pt) on the same box lands its corners at the pixel-measured x:[100,303.2] / y:[0,151.96]", () => {
    const functions = parseOdfTransform(
      "rotate(0.5235987755982988) translate(100pt 100pt)",
    );
    const corners = [
      { xPt: 0, yPt: 0 },
      { xPt: 200, yPt: 0 },
      { xPt: 0, yPt: 60 },
      { xPt: 200, yPt: 60 },
    ].map((p) => applyOdfTransform(functions, p));
    const xs = corners.map((p) => p.xPt);
    const ys = corners.map((p) => p.yPt);
    const measuredMinXPt = 100;
    const measuredMaxXPt = 303.205;
    const measuredMinYPt = 0;
    const measuredMaxYPt = 151.9615;
    const measuredPrecisionDigits = 2;
    closeTo(Math.min(...xs), measuredMinXPt);
    expect(Math.max(...xs)).toBeCloseTo(
      measuredMaxXPt,
      measuredPrecisionDigits,
    );
    closeTo(Math.min(...ys), measuredMinYPt);
    expect(Math.max(...ys)).toBeCloseTo(
      measuredMaxYPt,
      measuredPrecisionDigits,
    );
  });

  it("a bare translate is a plain offset, independent of any rotate", () => {
    expect(
      applyOdfTransform([{ kind: "translate", xPt: 10, yPt: -5 }], {
        xPt: 1,
        yPt: 2,
      }),
    ).toEqual({ xPt: 11, yPt: -3 });
  });

  it("an empty function list is the identity", () => {
    expect(applyOdfTransform([], { xPt: 7, yPt: 9 })).toEqual({
      xPt: 7,
      yPt: 9,
    });
  });
});

describe("netRotationDeg", () => {
  it("is the negated sum of every rotate() angle in the list, converted to degrees (translate contributes nothing)", () => {
    const quarterTurnRad = Math.PI / 2;
    const eighthTurnRad = quarterTurnRad / 2;
    const negativeQuarterTurnDeg = -90;
    closeTo(
      netRotationDeg([{ kind: "rotate", angleRad: quarterTurnRad }]),
      negativeQuarterTurnDeg,
    );
    closeTo(netRotationDeg([{ kind: "translate", xPt: 10, yPt: 10 }]), 0);
    closeTo(
      netRotationDeg([
        { kind: "rotate", angleRad: eighthTurnRad },
        { kind: "translate", xPt: 1, yPt: 1 },
        { kind: "rotate", angleRad: eighthTurnRad },
      ]),
      negativeQuarterTurnDeg,
    );
  });

  it("is exactly 0 for an empty list", () => {
    expect(netRotationDeg([])).toBe(-0);
  });
});

describe("resolveOdfShapeGeometry", () => {
  it("resolves a plain, unrotated svg:x/svg:y/svg:width/svg:height frame with no draw:transform at all", () => {
    const frame = el("draw:frame", {
      "svg:x": "100pt",
      "svg:y": "100pt",
      "svg:width": "200pt",
      "svg:height": "60pt",
    });
    expect(resolveOdfShapeGeometry(frame)).toEqual({
      frame: { xPt: 100, yPt: 100, widthPt: 200, heightPt: 60 },
      rotationDeg: undefined,
    });
  });

  it("returns undefined when svg:width/svg:height are missing (no explicit geometry to resolve at all)", () => {
    expect(
      resolveOdfShapeGeometry(
        el("draw:frame", { "svg:x": "10pt", "svg:y": "10pt" }),
      ),
    ).toBeUndefined();
  });

  it("resolves a rotated frame (draw:transform, no svg:x/svg:y) to a CENTER-pivoting frame + clockwise rotationDeg, matching the pixel-verified geometry", () => {
    // rotate(pi/2) translate(100pt 100pt) on a 200x60pt box: verified center = (130, 0) via applyOdfTransform's own confirmed formula, so top-left = (30, -30).
    const widthPt = 200;
    const heightPt = 60;
    const expectedXPt = 30;
    const expectedYPt = -30;
    const expectedRotationDeg = -90;
    const frame = el("draw:frame", {
      "svg:width": `${widthPt}pt`,
      "svg:height": `${heightPt}pt`,
      "draw:transform": "rotate(1.5707963267948966) translate(100pt 100pt)",
    });
    const result = resolveOdfShapeGeometry(frame);
    expect(result).toBeDefined();
    closeTo(result?.frame.xPt ?? NaN, expectedXPt);
    closeTo(result?.frame.yPt ?? NaN, expectedYPt);
    closeTo(result?.frame.widthPt ?? NaN, widthPt);
    closeTo(result?.frame.heightPt ?? NaN, heightPt);
    closeTo(result?.rotationDeg ?? NaN, expectedRotationDeg);
  });

  it("rotationDeg is undefined (not 0) for a draw:transform that carries only a translate, no rotate", () => {
    const frame = el("draw:frame", {
      "svg:width": "200pt",
      "svg:height": "60pt",
      "draw:transform": "translate(50pt 25pt)",
    });
    expect(resolveOdfShapeGeometry(frame)).toEqual({
      frame: { xPt: 50, yPt: 25, widthPt: 200, heightPt: 60 },
      rotationDeg: undefined,
    });
  });

  it("returns undefined when draw:transform is present but svg:width/svg:height are missing", () => {
    expect(
      resolveOdfShapeGeometry(
        el("draw:frame", { "draw:transform": "translate(10pt 10pt)" }),
      ),
    ).toBeUndefined();
  });
});

describe("composeOdfGroupTransform", () => {
  const child = {
    frame: { xPt: 50, yPt: 50, widthPt: 80, heightPt: 40 },
    rotationDeg: undefined,
  };

  it("is the identity when the group has no transform functions of its own (the common real-world case: a real LibreOffice-generated draw:g carries no draw:transform at all)", () => {
    expect(composeOdfGroupTransform([], child)).toBe(child);
  });

  it("composes a group rotate+translate onto a child with no rotation of its own — a concrete before/after example", () => {
    // Before: child center is (90, 70) [50+80/2, 50+40/2], no rotation. Group transform: rotate(pi/2) translate(100pt 100pt) — the SAME transform verified above against a real render, now applied to the child's own center instead of a local (0,0)-anchored box.
    const groupFunctions = parseOdfTransform(
      "rotate(1.5707963267948966) translate(100pt 100pt)",
    );
    const result = composeOdfGroupTransform(groupFunctions, child);
    // applyOdfTransform(groupFunctions, {xPt:90, yPt:70}): rotate first -> (70, -90), then translate -> (170, 10).
    const newCenterXPt = 170;
    const newCenterYPt = 10;
    const expectedRotationDeg = -90;
    closeTo(result.frame.xPt, newCenterXPt - child.frame.widthPt / 2);
    closeTo(result.frame.yPt, newCenterYPt - child.frame.heightPt / 2);
    closeTo(result.frame.widthPt, child.frame.widthPt); // unchanged — no scale in ODF's own group model
    closeTo(result.frame.heightPt, child.frame.heightPt);
    closeTo(result.rotationDeg ?? NaN, expectedRotationDeg);
  });

  it("adds the group's own rotation onto a child that already carries its own rotation", () => {
    const childRotationDeg = 30;
    const rotatedChild = {
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      rotationDeg: childRotationDeg,
    };
    const groupRotationDeg = -90;
    const groupFunctions = [{ kind: "rotate" as const, angleRad: Math.PI / 2 }]; // netRotationDeg = groupRotationDeg
    const result = composeOdfGroupTransform(groupFunctions, rotatedChild);
    closeTo(result.rotationDeg ?? NaN, childRotationDeg + groupRotationDeg);
  });

  it("cancels out to undefined rotationDeg when the composed rotation is exactly 0", () => {
    const groupFunctions = [{ kind: "rotate" as const, angleRad: Math.PI }]; // netRotationDeg = -180
    const rotatedChild = {
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      rotationDeg: 180,
    };
    expect(
      composeOdfGroupTransform(groupFunctions, rotatedChild).rotationDeg,
    ).toBeUndefined();
  });
});
