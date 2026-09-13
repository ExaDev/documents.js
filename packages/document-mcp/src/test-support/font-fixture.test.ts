import { createFontRegistry, type ResolvedFace } from "documents.js";
import { describe, expect, it } from "vitest";
import { requireEmbeddedFace, vendoredFontBytes } from "./font-fixture";

const STANDARD_RESOLUTION: ResolvedFace = {
  kind: "standard",
  standardName: "Helvetica",
  matched: true,
};

describe("requireEmbeddedFace", () => {
  it("returns the resolution unchanged when it is already embedded", () => {
    const resolved = createFontRegistry().resolve({
      family: "Cambria",
      weight: "normal",
      style: "normal",
    });

    expect(requireEmbeddedFace(resolved)).toBe(resolved);
  });

  it("throws naming the actual kind when the registry falls through to a standard face", () => {
    expect(() => requireEmbeddedFace(STANDARD_RESOLUTION)).toThrow(
      "expected documents.js's vendored substitute table to embed a face for Cambria, got a standard face",
    );
  });
});

describe("vendoredFontBytes", () => {
  it("returns a non-empty real font program", () => {
    expect(vendoredFontBytes().length).toBeGreaterThan(0);
  });
});
