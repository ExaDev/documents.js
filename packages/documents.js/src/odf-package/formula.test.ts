import type { Package } from "odf.js";
import { describe, expect, it } from "vitest";
import { nextObjectIndex } from "./formula";

function packageWithParts(paths: readonly string[]): Package {
  const parts: Package["parts"] = {};
  for (const path of paths) {
    parts[path] = { kind: "xml", nodes: [] };
  }
  return { parts };
}

describe("nextObjectIndex", () => {
  it("is 1 for a package with no existing Object directories at all", () => {
    expect(nextObjectIndex(packageWithParts(["content.xml"]))).toBe(1);
  });

  it("is one past the highest index present, regardless of encounter order", () => {
    expect(
      nextObjectIndex(
        packageWithParts([
          "Object 3/content.xml",
          "Object 1/content.xml",
          "Object 2/content.xml",
        ]),
      ),
    ).toBe(4);
  });

  it("resumes from a gap left by a removed object, rather than reusing the lowest free index", () => {
    expect(
      nextObjectIndex(
        packageWithParts(["Object 1/content.xml", "Object 5/content.xml"]),
      ),
    ).toBe(6);
  });
});
