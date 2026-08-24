import { describe, expect, it } from "vitest";
import { el } from "../../xml/fragment";
import {
  parseLinePoints,
  parseMargins,
  parseBox,
  parsePageSize,
} from "./geometry";

// Fixtures below marked "real LibreOffice output" are copied verbatim from styles.xml's style:page-layout-properties (the ja_ott_normal.ott template) and a Writer image-frame draw:custom-shape (Modern_business_letter_serif.ott's header) -- both under /Applications/LibreOffice.app/Contents/Resources/template/**, LibreOffice 26.2.5.2.

describe("parsePageSize", () => {
  it("parses fo:page-width/fo:page-height (real LibreOffice output, A4 portrait)", () => {
    const element = el("style:page-layout-properties", {
      "fo:page-width": "21.0cm",
      "fo:page-height": "29.7cm",
    });
    const size = parsePageSize(element);
    expect(size?.widthPt).toBeCloseTo((21.0 * 72) / 2.54, 6);
    expect(size?.heightPt).toBeCloseTo((29.7 * 72) / 2.54, 6);
  });

  it("parses an exact pt-based page size with no rounding drift", () => {
    const element = el("style:page-layout-properties", {
      "fo:page-width": "612pt",
      "fo:page-height": "792pt",
    });
    expect(parsePageSize(element)).toEqual({ widthPt: 612, heightPt: 792 });
  });

  it("returns undefined when only one dimension is present", () => {
    expect(
      parsePageSize(
        el("style:page-layout-properties", { "fo:page-width": "21cm" }),
      ),
    ).toBeUndefined();
    expect(
      parsePageSize(
        el("style:page-layout-properties", { "fo:page-height": "29.7cm" }),
      ),
    ).toBeUndefined();
  });

  it("returns undefined when neither dimension is present", () => {
    expect(parsePageSize(el("style:page-layout-properties"))).toBeUndefined();
  });

  it("returns undefined when a dimension is present but unparseable, never a partial result", () => {
    const element = el("style:page-layout-properties", {
      "fo:page-width": "not-a-length",
      "fo:page-height": "29.7cm",
    });
    expect(parsePageSize(element)).toBeUndefined();
  });
});

describe("parseMargins", () => {
  it("parses all four margins (real LibreOffice output, Mpm1 page layout)", () => {
    const element = el("style:page-layout-properties", {
      "fo:margin-top": "2cm",
      "fo:margin-bottom": "2cm",
      "fo:margin-left": "4.5cm",
      "fo:margin-right": "2cm",
    });
    const margins = parseMargins(element);
    expect(margins?.topPt).toBeCloseTo((2 * 72) / 2.54, 6);
    expect(margins?.bottomPt).toBeCloseTo((2 * 72) / 2.54, 6);
    expect(margins?.leftPt).toBeCloseTo((4.5 * 72) / 2.54, 6);
    expect(margins?.rightPt).toBeCloseTo((2 * 72) / 2.54, 6);
  });

  it("parses exact pt-based margins with no rounding drift", () => {
    const element = el("style:page-layout-properties", {
      "fo:margin-top": "72pt",
      "fo:margin-bottom": "72pt",
      "fo:margin-left": "90pt",
      "fo:margin-right": "90pt",
    });
    expect(parseMargins(element)).toEqual({
      topPt: 72,
      bottomPt: 72,
      leftPt: 90,
      rightPt: 90,
    });
  });

  it("returns undefined when any one of the four margins is missing", () => {
    expect(
      parseMargins(
        el("style:page-layout-properties", {
          "fo:margin-bottom": "1cm",
          "fo:margin-left": "1cm",
          "fo:margin-right": "1cm",
        }),
      ),
    ).toBeUndefined();
    expect(
      parseMargins(
        el("style:page-layout-properties", {
          "fo:margin-top": "1cm",
          "fo:margin-left": "1cm",
          "fo:margin-right": "1cm",
        }),
      ),
    ).toBeUndefined();
    expect(
      parseMargins(
        el("style:page-layout-properties", {
          "fo:margin-top": "1cm",
          "fo:margin-bottom": "1cm",
          "fo:margin-right": "1cm",
        }),
      ),
    ).toBeUndefined();
    expect(
      parseMargins(
        el("style:page-layout-properties", {
          "fo:margin-top": "1cm",
          "fo:margin-bottom": "1cm",
          "fo:margin-left": "1cm",
        }),
      ),
    ).toBeUndefined();
  });

  it("returns undefined when a margin is present but unparseable", () => {
    const element = el("style:page-layout-properties", {
      "fo:margin-top": "1cm",
      "fo:margin-bottom": "1cm",
      "fo:margin-left": "auto",
      "fo:margin-right": "1cm",
    });
    expect(parseMargins(element)).toBeUndefined();
  });
});

describe("parseBox", () => {
  it("parses svg:x/svg:y/svg:width/svg:height (real LibreOffice output, a Writer header custom-shape frame)", () => {
    const element = el("draw:custom-shape", {
      "svg:x": "-3.946cm",
      "svg:y": "-0.707cm",
      "svg:width": "3.539cm",
      "svg:height": "27.5cm",
    });
    const box = parseBox(element);
    expect(box?.xPt).toBeCloseTo((-3.946 * 72) / 2.54, 6);
    expect(box?.yPt).toBeCloseTo((-0.707 * 72) / 2.54, 6);
    expect(box?.widthPt).toBeCloseTo((3.539 * 72) / 2.54, 6);
    expect(box?.heightPt).toBeCloseTo((27.5 * 72) / 2.54, 6);
  });

  it("parses an exact pt-based box with no rounding drift", () => {
    const element = el("draw:frame", {
      "svg:x": "10pt",
      "svg:y": "20pt",
      "svg:width": "100pt",
      "svg:height": "50pt",
    });
    expect(parseBox(element)).toEqual({
      xPt: 10,
      yPt: 20,
      widthPt: 100,
      heightPt: 50,
    });
  });

  it("returns undefined when any one of the four attributes is missing", () => {
    expect(
      parseBox(
        el("draw:frame", {
          "svg:y": "1pt",
          "svg:width": "1pt",
          "svg:height": "1pt",
        }),
      ),
    ).toBeUndefined();
    expect(
      parseBox(
        el("draw:frame", {
          "svg:x": "1pt",
          "svg:width": "1pt",
          "svg:height": "1pt",
        }),
      ),
    ).toBeUndefined();
    expect(
      parseBox(
        el("draw:frame", {
          "svg:x": "1pt",
          "svg:y": "1pt",
          "svg:height": "1pt",
        }),
      ),
    ).toBeUndefined();
    expect(
      parseBox(
        el("draw:frame", {
          "svg:x": "1pt",
          "svg:y": "1pt",
          "svg:width": "1pt",
        }),
      ),
    ).toBeUndefined();
  });

  it("returns undefined when an attribute is present but unparseable", () => {
    const element = el("draw:frame", {
      "svg:x": "1pt",
      "svg:y": "1pt",
      "svg:width": "auto",
      "svg:height": "1pt",
    });
    expect(parseBox(element)).toBeUndefined();
  });
});

describe("parseLinePoints", () => {
  it("parses svg:x1/y1/x2/y2 (real LibreOffice draw:line output) into from/to points", () => {
    const element = el("draw:line", {
      "svg:x1": "9cm",
      "svg:y1": "1cm",
      "svg:x2": "13cm",
      "svg:y2": "4cm",
    });
    const points = parseLinePoints(element);
    expect(points?.from.xPt).toBeCloseTo((9 * 72) / 2.54, 6);
    expect(points?.from.yPt).toBeCloseTo((1 * 72) / 2.54, 6);
    expect(points?.to.xPt).toBeCloseTo((13 * 72) / 2.54, 6);
    expect(points?.to.yPt).toBeCloseTo((4 * 72) / 2.54, 6);
  });

  it("parses an exact pt-based line with no rounding drift", () => {
    const element = el("draw:line", {
      "svg:x1": "0pt",
      "svg:y1": "0pt",
      "svg:x2": "10pt",
      "svg:y2": "20pt",
    });
    expect(parseLinePoints(element)).toEqual({
      from: { xPt: 0, yPt: 0 },
      to: { xPt: 10, yPt: 20 },
    });
  });

  it("returns undefined when any one of the four endpoint attributes is missing", () => {
    expect(
      parseLinePoints(
        el("draw:line", { "svg:y1": "1pt", "svg:x2": "1pt", "svg:y2": "1pt" }),
      ),
    ).toBeUndefined();
    expect(
      parseLinePoints(
        el("draw:line", { "svg:x1": "1pt", "svg:x2": "1pt", "svg:y2": "1pt" }),
      ),
    ).toBeUndefined();
    expect(
      parseLinePoints(
        el("draw:line", { "svg:x1": "1pt", "svg:y1": "1pt", "svg:y2": "1pt" }),
      ),
    ).toBeUndefined();
    expect(
      parseLinePoints(
        el("draw:line", { "svg:x1": "1pt", "svg:y1": "1pt", "svg:x2": "1pt" }),
      ),
    ).toBeUndefined();
  });

  it("returns undefined when an endpoint attribute is present but unparseable", () => {
    const element = el("draw:line", {
      "svg:x1": "1pt",
      "svg:y1": "auto",
      "svg:x2": "1pt",
      "svg:y2": "1pt",
    });
    expect(parseLinePoints(element)).toBeUndefined();
  });
});
