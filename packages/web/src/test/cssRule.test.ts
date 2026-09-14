import { describe, expect, it } from "vitest";

import { mountWithClassName } from "./cssRule";

describe("mountWithClassName", () => {
  it("appends the element to document.body, so getComputedStyle resolves it against the real cascade", () => {
    const { element, cleanup } = mountWithClassName("probe-class");
    expect(document.body.contains(element)).toBe(true);
    expect(element.className).toBe("probe-class");
    cleanup();
  });

  it("removes the element from the document once cleanup runs", () => {
    const { element, cleanup } = mountWithClassName("probe-class");
    cleanup();
    expect(document.body.contains(element)).toBe(false);
  });
});
