import { describe, expect, it } from "vitest";
import { headingStyleId, parseHeadingStyleId } from "./style-constants";

describe("headingStyleId / parseHeadingStyleId", () => {
  it("mints and parses a heading styleId for an ordinary level", () => {
    expect(headingStyleId(3)).toBe("Heading3");
    expect(parseHeadingStyleId("Heading3")).toBe(3);
  });

  it("parses a level past the markdown-reachable 1-6 ceiling, since ContentDocument is a shared cross-format pivot", () => {
    expect(parseHeadingStyleId("Heading7")).toBe(7);
  });

  it("rejects a shape this exact pattern does not match", () => {
    expect(parseHeadingStyleId("Heading")).toBeUndefined();
    expect(parseHeadingStyleId("heading1")).toBeUndefined();
    expect(parseHeadingStyleId("Quote")).toBeUndefined();
  });

  it("rejects level 0 -- a heading style level is always a positive integer", () => {
    expect(parseHeadingStyleId("Heading0")).toBeUndefined();
  });

  it("rejects a digit run so long it parses to a non-integer (Infinity), rather than reporting a bogus level", () => {
    expect(parseHeadingStyleId(`Heading${"9".repeat(400)}`)).toBeUndefined();
  });
});
