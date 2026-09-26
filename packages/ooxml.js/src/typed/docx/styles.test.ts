import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import { el } from "../../xml/fragment";
import { EMPTY_THEME } from "../shared/drawingml";
import { resolveRunProperties } from "./styles";
const ACCENT1_R = 0.2;
const ACCENT1_G = 0.4;
const ACCENT1_B = 0.6;
// toBeCloseTo precision (decimal places) for the colour-blend assertions below: tight enough to catch a real blend-math bug, loose enough to tolerate ordinary floating-point noise from the tint/shade arithmetic.
const COLOR_PRECISION_DIGITS = 5;

function paragraphWithRun(
  pPrChildren: readonly XmlElement[],
  run: XmlElement,
): { paragraph: XmlElement; run: XmlElement } {
  return { paragraph: el("w:p", {}, [el("w:pPr", {}, pPrChildren), run]), run };
}

function runEl(rPrChildren: readonly XmlElement[]): XmlElement {
  return el("w:r", {}, [el("w:rPr", {}, rPrChildren)]);
}

describe("resolveRunProperties: toggle properties", () => {
  it("bare presence of a toggle element means on", () => {
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([el("w:b"), el("w:i")]),
    );
    const props = resolveRunProperties(run, paragraph, {
      stylesRoot: undefined,
      theme: EMPTY_THEME,
    });
    expect(props.bold).toBe(true);
    expect(props.italic).toBe(true);
  });

  it('w:val="0"/"false"/"off" turns a toggle off', () => {
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([
        el("w:b", { "w:val": "0" }),
        el("w:i", { "w:val": "false" }),
        el("w:strike", { "w:val": "off" }),
      ]),
    );
    const props = resolveRunProperties(run, paragraph, {
      stylesRoot: undefined,
      theme: EMPTY_THEME,
    });
    expect(props.bold).toBe(false);
    expect(props.italic).toBe(false);
    expect(props.strike).toBe(false);
  });

  it("absence of a toggle element leaves the property undefined, not off", () => {
    const { paragraph, run } = paragraphWithRun([], runEl([]));
    const props = resolveRunProperties(run, paragraph, {
      stylesRoot: undefined,
      theme: EMPTY_THEME,
    });
    expect(props.bold).toBeUndefined();
  });

  it("a sibling property (colour) forcing a non-empty w:rPr still leaves every absent toggle undefined, not false (regression: ExaDev/documents.js#962's own 4th claim — confirmed stale, not a live bug: readRunPropertiesLayer/mergeRunLayer already propagate an absent toggle through every cascade layer correctly)", () => {
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([el("w:color", { "w:val": "FF0000" })]),
    );
    const props = resolveRunProperties(run, paragraph, {
      stylesRoot: undefined,
      theme: EMPTY_THEME,
    });
    expect(props.color).toBeDefined();
    expect(props.bold).toBeUndefined();
    expect(props.italic).toBeUndefined();
    expect(props.underline).toBeUndefined();
    expect(props.strike).toBeUndefined();
  });
});

describe("resolveRunProperties: underline", () => {
  it('any value other than "none" means underlined', () => {
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([el("w:u", { "w:val": "single" })]),
    );
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).underline,
    ).toBe(true);
  });

  it('"none" means not underlined', () => {
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([el("w:u", { "w:val": "none" })]),
    );
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).underline,
    ).toBe(false);
  });

  it("a <w:u> with no w:val at all means not underlined, unlike a toggle property's bare-presence-means-on rule", () => {
    const { paragraph, run } = paragraphWithRun([], runEl([el("w:u")]));
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).underline,
    ).toBe(false);
  });
});

describe("resolveRunProperties: colour", () => {
  it("reads a literal hex colour", () => {
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([el("w:color", { "w:val": "FF0000" })]),
    );
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).color,
    ).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('"auto" defers rather than asserting a colour', () => {
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([el("w:color", { "w:val": "auto" })]),
    );
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).color,
    ).toBeUndefined();
  });

  it("resolves w:themeColor against the theme colour scheme, taking precedence over w:val", () => {
    const themedTheme = {
      colorScheme: new Map([["accent1", { r: 0.2, g: 0.4, b: 0.6 }]]),
      majorFont: "Major Font",
      minorFont: "Minor Font",
    };
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([el("w:color", { "w:val": "FF0000", "w:themeColor": "accent1" })]),
    );
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: undefined,
        theme: themedTheme,
      }).color,
    ).toEqual({ r: 0.2, g: 0.4, b: 0.6 });
  });

  it("resolves the background1/text1/background2/text2 logical theme colour names to their dark/light slot pair", () => {
    const themedTheme = {
      colorScheme: new Map([
        ["dk1", { r: 0, g: 0, b: 0 }],
        ["lt1", { r: 1, g: 1, b: 1 }],
      ]),
      majorFont: "Major Font",
      minorFont: "Minor Font",
    };
    const text1 = paragraphWithRun(
      [],
      runEl([el("w:color", { "w:themeColor": "text1" })]),
    );
    const background1 = paragraphWithRun(
      [],
      runEl([el("w:color", { "w:themeColor": "background1" })]),
    );
    expect(
      resolveRunProperties(text1.run, text1.paragraph, {
        stylesRoot: undefined,
        theme: themedTheme,
      }).color,
    ).toEqual({ r: 0, g: 0, b: 0 });
    expect(
      resolveRunProperties(background1.run, background1.paragraph, {
        stylesRoot: undefined,
        theme: themedTheme,
      }).color,
    ).toEqual({ r: 1, g: 1, b: 1 });
  });

  it("w:themeTint byte 0xFF leaves the resolved theme colour unchanged (regression: ExaDev/documents.js#962 — previously ignored entirely)", () => {
    const themedTheme = {
      colorScheme: new Map([["accent1", { r: 0.2, g: 0.4, b: 0.6 }]]),
      majorFont: "Major Font",
      minorFont: "Minor Font",
    };
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([
        el("w:color", { "w:themeColor": "accent1", "w:themeTint": "FF" }),
      ]),
    );
    const color = resolveRunProperties(run, paragraph, {
      stylesRoot: undefined,
      theme: themedTheme,
    }).color;
    expect(color?.r).toBeCloseTo(ACCENT1_R, COLOR_PRECISION_DIGITS);
    expect(color?.g).toBeCloseTo(ACCENT1_G, COLOR_PRECISION_DIGITS);
    expect(color?.b).toBeCloseTo(ACCENT1_B, COLOR_PRECISION_DIGITS);
  });

  it("w:themeTint byte 0x00 lightens the resolved theme colour fully to white, hue and saturation notwithstanding", () => {
    const themedTheme = {
      colorScheme: new Map([["accent1", { r: 0.2, g: 0.4, b: 0.6 }]]),
      majorFont: "Major Font",
      minorFont: "Minor Font",
    };
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([
        el("w:color", { "w:themeColor": "accent1", "w:themeTint": "00" }),
      ]),
    );
    const color = resolveRunProperties(run, paragraph, {
      stylesRoot: undefined,
      theme: themedTheme,
    }).color;
    expect(color?.r).toBeCloseTo(1, COLOR_PRECISION_DIGITS);
    expect(color?.g).toBeCloseTo(1, COLOR_PRECISION_DIGITS);
    expect(color?.b).toBeCloseTo(1, COLOR_PRECISION_DIGITS);
  });

  it("w:themeShade byte 0x00 darkens the resolved theme colour fully to black", () => {
    const themedTheme = {
      colorScheme: new Map([["accent1", { r: 0.2, g: 0.4, b: 0.6 }]]),
      majorFont: "Major Font",
      minorFont: "Minor Font",
    };
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([
        el("w:color", { "w:themeColor": "accent1", "w:themeShade": "00" }),
      ]),
    );
    const color = resolveRunProperties(run, paragraph, {
      stylesRoot: undefined,
      theme: themedTheme,
    }).color;
    expect(color?.r).toBeCloseTo(0, COLOR_PRECISION_DIGITS);
    expect(color?.g).toBeCloseTo(0, COLOR_PRECISION_DIGITS);
    expect(color?.b).toBeCloseTo(0, COLOR_PRECISION_DIGITS);
  });

  it("w:themeShade byte 0xFF leaves the resolved theme colour unchanged", () => {
    const themedTheme = {
      colorScheme: new Map([["accent1", { r: 0.2, g: 0.4, b: 0.6 }]]),
      majorFont: "Major Font",
      minorFont: "Minor Font",
    };
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([
        el("w:color", { "w:themeColor": "accent1", "w:themeShade": "FF" }),
      ]),
    );
    const color = resolveRunProperties(run, paragraph, {
      stylesRoot: undefined,
      theme: themedTheme,
    }).color;
    expect(color?.r).toBeCloseTo(ACCENT1_R, COLOR_PRECISION_DIGITS);
    expect(color?.g).toBeCloseTo(ACCENT1_G, COLOR_PRECISION_DIGITS);
    expect(color?.b).toBeCloseTo(ACCENT1_B, COLOR_PRECISION_DIGITS);
  });

  it("a mid-range w:themeTint noticeably lightens the colour without reaching white", () => {
    const themedTheme = {
      colorScheme: new Map([["accent1", { r: 0.2, g: 0.4, b: 0.6 }]]),
      majorFont: "Major Font",
      minorFont: "Minor Font",
    };
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([
        el("w:color", { "w:themeColor": "accent1", "w:themeTint": "80" }),
      ]),
    );
    const color = resolveRunProperties(run, paragraph, {
      stylesRoot: undefined,
      theme: themedTheme,
    }).color;
    // Lighter than the base colour on every channel, but not fully white.
    expect(color!.r).toBeGreaterThan(ACCENT1_R);
    expect(color!.g).toBeGreaterThan(ACCENT1_G);
    expect(color!.b).toBeGreaterThan(ACCENT1_B);
    expect(color!.r).toBeLessThan(1);
  });

  it("ignores a malformed w:themeShade/w:themeTint (not a two-hex-digit byte) rather than throwing or silently miscolouring", () => {
    const themedTheme = {
      colorScheme: new Map([["accent1", { r: 0.2, g: 0.4, b: 0.6 }]]),
      majorFont: "Major Font",
      minorFont: "Minor Font",
    };
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([
        el("w:color", { "w:themeColor": "accent1", "w:themeTint": "not-hex" }),
      ]),
    );
    const color = resolveRunProperties(run, paragraph, {
      stylesRoot: undefined,
      theme: themedTheme,
    }).color;
    expect(color).toEqual({ r: 0.2, g: 0.4, b: 0.6 });
  });

  it("rejects a themeTint byte with a non-hex character BEFORE its two valid hex digits, not just any non-hex value", () => {
    const themedTheme = {
      colorScheme: new Map([["accent1", { r: 0.2, g: 0.4, b: 0.6 }]]),
      majorFont: "Major Font",
      minorFont: "Minor Font",
    };
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([
        el("w:color", { "w:themeColor": "accent1", "w:themeTint": "z0f" }),
      ]),
    );
    const color = resolveRunProperties(run, paragraph, {
      stylesRoot: undefined,
      theme: themedTheme,
    }).color;
    expect(color).toEqual({ r: 0.2, g: 0.4, b: 0.6 });
  });

  it("rejects a themeTint byte with a non-hex character AFTER its two valid hex digits, not just a too-short value", () => {
    const themedTheme = {
      colorScheme: new Map([["accent1", { r: 0.2, g: 0.4, b: 0.6 }]]),
      majorFont: "Major Font",
      minorFont: "Minor Font",
    };
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([
        el("w:color", { "w:themeColor": "accent1", "w:themeTint": "0fz" }),
      ]),
    );
    const color = resolveRunProperties(run, paragraph, {
      stylesRoot: undefined,
      theme: themedTheme,
    }).color;
    expect(color).toEqual({ r: 0.2, g: 0.4, b: 0.6 });
  });

  it("falls back to w:val when the theme colour reference does not resolve", () => {
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([el("w:color", { "w:val": "00FF00", "w:themeColor": "accent1" })]),
    );
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).color,
    ).toEqual({ r: 0, g: 1, b: 0 });
  });
});
