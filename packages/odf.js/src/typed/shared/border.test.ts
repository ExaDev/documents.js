import { describe, expect, it } from "vitest";
import { parseBorderEdge, formatBorderEdge } from "./border";

describe("parseBorderEdge", () => {
  it("parses a real border's three tokens", () => {
    expect(parseBorderEdge("0.05pt solid #000000")).toEqual({
      border: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.05, style: "solid" },
    });
  });

  it("tolerates surrounding whitespace around the whole value", () => {
    expect(parseBorderEdge(" 0.05pt solid #000000 ")).toEqual({
      border: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.05, style: "solid" },
    });
  });

  it("collapses a run of several spaces between tokens into one separator", () => {
    expect(parseBorderEdge("0.05pt   solid    #000000")).toEqual({
      border: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.05, style: "solid" },
    });
  });

  it("returns undefined for a token count other than three", () => {
    expect(parseBorderEdge("0.05pt solid")).toBeUndefined();
    expect(parseBorderEdge("0.05pt solid #000000 extra")).toBeUndefined();
  });

  it("treats 'none' or 'hidden' as an explicit no-border marker", () => {
    expect(parseBorderEdge("0.05pt none #000000")).toEqual({ none: true });
    expect(parseBorderEdge("0.05pt hidden #000000")).toEqual({ none: true });
  });

  it("returns undefined for an unparseable length or colour", () => {
    expect(parseBorderEdge("notalength solid #000000")).toBeUndefined();
    expect(parseBorderEdge("0.05pt solid notacolor")).toBeUndefined();
  });

  it("returns undefined for a zero or negative width, a non-border", () => {
    expect(parseBorderEdge("0pt solid #000000")).toBeUndefined();
    expect(parseBorderEdge("-0.05pt solid #000000")).toBeUndefined();
  });

  it("leaves style unset for a style token ODF allows but this schema has no member for", () => {
    expect(parseBorderEdge("0.05pt groove #000000")).toEqual({
      border: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.05 },
    });
  });
});

describe("formatBorderEdge", () => {
  it("formats width, style, and colour as the three-token shorthand", () => {
    expect(
      formatBorderEdge({
        color: { r: 0, g: 0, b: 0 },
        widthPt: 0.05,
        style: "dashed",
      }),
    ).toBe("0.05pt dashed #000000");
  });

  it("defaults an absent style to 'solid'", () => {
    expect(
      formatBorderEdge({ color: { r: 0, g: 0, b: 0 }, widthPt: 0.05 }),
    ).toBe("0.05pt solid #000000");
  });
});
