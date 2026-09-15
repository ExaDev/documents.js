import { describe, expect, it } from "vitest";
import {
  caladeaItalicBytes,
  carlitoBoldBytes,
  carlitoItalicBytes,
} from "./fonts";

describe("loadFace's own per-face cache", () => {
  it("returns the identical array instance on a second call for the same face, proving the cached branch actually ran", () => {
    const first = carlitoBoldBytes();
    const second = carlitoBoldBytes();
    expect(second).toBe(first);
  });

  it("inflates real bytes on the very first call for a face, not a stale undefined placeholder", () => {
    // caladeaItalicBytes is not called anywhere else in this file, so this is genuinely that face's first lookup against a fresh, empty cache in this test module instance.
    const bytes = caladeaItalicBytes();
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("keeps two different faces' inflated bytes distinct rather than sharing one cache slot", () => {
    const bold = carlitoBoldBytes();
    const italic = carlitoItalicBytes();
    expect(bold).not.toEqual(italic);
  });
});
