import { describe, expect, it } from "vitest";
import { parseSvgColor, parseSvgDashStyle, parseSvgPaint } from "./paint";

describe("parseSvgColor", () => {
  it("resolves the named keywords case-insensitively, normalised to the 0..1 float triplet", () => {
    expect(parseSvgColor("red")).toEqual({ r: 1, g: 0, b: 0 });
    expect(parseSvgColor("BLACK")).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseSvgColor("RebeccaPurple")).toEqual({
      r: 102 / 255,
      g: 51 / 255,
      b: 153 / 255,
    });
  });

  it("reads the 3, 4, 6, and 8 digit hex forms, expanding each pair of nibbles", () => {
    expect(parseSvgColor("#f00")).toEqual({ r: 1, g: 0, b: 0 });
    expect(parseSvgColor("#f00f")).toEqual({ r: 1, g: 0, b: 0 });
    expect(parseSvgColor("#ff0000")).toEqual({ r: 1, g: 0, b: 0 });
    // The 8-digit form\'s alpha is parsed for validity but not returned -- transparency is the reader\'s own diagnostic channel, never a flattened colour.
    expect(parseSvgColor("#ff000080")).toEqual({ r: 1, g: 0, b: 0 });
  });

  it("returns undefined for a hex digit count no form accepts", () => {
    expect(parseSvgColor("#ff000")).toBeUndefined();
    expect(parseSvgColor("#ff00000")).toBeUndefined();
    expect(parseSvgColor("#zzz")).toBeUndefined();
  });

  it("reads rgb()/rgba() in both the 0-255 and percentage forms, clamping the channel range", () => {
    expect(parseSvgColor("rgb(255, 0, 0)")).toEqual({ r: 1, g: 0, b: 0 });
    expect(parseSvgColor("rgb(100%, 0%, 0%)")).toEqual({ r: 1, g: 0, b: 0 });
    expect(parseSvgColor("rgba(300, -5, 0, 0.5)")).toEqual({
      r: 1,
      g: 0,
      b: 0,
    });
    expect(parseSvgColor("rgb(1 2 3)")).toEqual({
      r: 1 / 255,
      g: 2 / 255,
      b: 3 / 255,
    });
  });
});

describe("parseSvgPaint", () => {
  it("reads none, currentColor, and url references as their own kinds", () => {
    expect(parseSvgPaint("none")).toEqual({ kind: "none" });
    expect(parseSvgPaint("currentColor")).toEqual({ kind: "currentColor" });
    expect(parseSvgPaint("url(#grad1)")).toEqual({
      kind: "url",
      fragment: "grad1",
    });
    expect(parseSvgPaint("url('#grad1')")).toEqual({
      kind: "url",
      fragment: "grad1",
    });
  });

  it("reads a colour paint and returns undefined for a value no form matches", () => {
    expect(parseSvgPaint("blue")).toEqual({
      kind: "color",
      color: { r: 0, g: 0, b: 1 },
    });
    expect(parseSvgPaint("not-a-paint")).toBeUndefined();
  });
});

describe("parseSvgDashStyle", () => {
  it("maps dash patterns onto the two stroke styles the schema's own enum carries", () => {
    expect(parseSvgDashStyle(undefined)).toBeUndefined();
    expect(parseSvgDashStyle("none")).toBeUndefined();
    expect(parseSvgDashStyle("")).toBeUndefined();
    // A pattern whose every on-length is at most one user unit reads as dots; anything dash-shaped reads as dashed.
    expect(parseSvgDashStyle("6 4")).toBe("dashed");
    expect(parseSvgDashStyle("1 3")).toBe("dotted");
    expect(parseSvgDashStyle("0.5 1")).toBe("dotted");
    expect(parseSvgDashStyle("5,3,5,3")).toBe("dashed");
  });

  it("returns undefined for a malformed value, which is also the attribute's solid-stroke default", () => {
    expect(parseSvgDashStyle("x y")).toBeUndefined();
    expect(parseSvgDashStyle("-1 2")).toBeUndefined();
  });
});
