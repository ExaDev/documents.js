import { describe, expect, it } from "vitest";
import { resolveHrefTarget } from "./link-target";

describe("resolveHrefTarget", () => {
  it("returns undefined for an empty href", () => {
    expect(resolveHrefTarget("OEBPS/chapter1.xhtml", "")).toBeUndefined();
  });

  it("returns undefined for a scheme-carrying (external) href", () => {
    expect(
      resolveHrefTarget("OEBPS/chapter1.xhtml", "https://example.com#x"),
    ).toBeUndefined();
  });

  it("returns undefined for an href with no fragment at all", () => {
    expect(
      resolveHrefTarget("OEBPS/chapter1.xhtml", "chapter2.xhtml"),
    ).toBeUndefined();
  });

  it("returns undefined for an href whose fragment is empty (a trailing bare '#')", () => {
    expect(
      resolveHrefTarget("OEBPS/chapter1.xhtml", "chapter2.xhtml#"),
    ).toBeUndefined();
  });

  it("resolves a same-document fragment against sourceHref itself", () => {
    expect(resolveHrefTarget("OEBPS/chapter1.xhtml", "#note1")).toEqual({
      targetHref: "OEBPS/chapter1.xhtml",
      fragment: "note1",
    });
  });

  it("resolves a cross-document fragment against sourceHref's own directory", () => {
    expect(
      resolveHrefTarget("OEBPS/chapter1.xhtml", "chapter2.xhtml#note1"),
    ).toEqual({
      targetHref: "OEBPS/chapter2.xhtml",
      fragment: "note1",
    });
  });

  it("resolves a hash appearing at index 1, distinguishing 'no hash found' from 'hash found at a small index'", () => {
    expect(resolveHrefTarget("OEBPS/chapter1.xhtml", "a#frag")).toEqual({
      targetHref: "OEBPS/a",
      fragment: "frag",
    });
  });

  it("resolves a subdirectory path portion with its own fragment", () => {
    expect(
      resolveHrefTarget("OEBPS/chapter1.xhtml", "images/notes.xhtml#n2"),
    ).toEqual({
      targetHref: "OEBPS/images/notes.xhtml",
      fragment: "n2",
    });
  });
});
