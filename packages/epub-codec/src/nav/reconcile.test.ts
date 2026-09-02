import { describe, expect, it } from "vitest";
import { navMatchesSpine } from "./reconcile";

describe("navMatchesSpine", () => {
  it("matches an identical sequence", () => {
    expect(
      navMatchesSpine(["a.xhtml", "b.xhtml"], ["a.xhtml", "b.xhtml"]),
    ).toBe(true);
  });

  it("does not match a different order", () => {
    expect(
      navMatchesSpine(["b.xhtml", "a.xhtml"], ["a.xhtml", "b.xhtml"]),
    ).toBe(false);
  });

  it("does not match a different length", () => {
    expect(navMatchesSpine(["a.xhtml"], ["a.xhtml", "b.xhtml"])).toBe(false);
  });
});
