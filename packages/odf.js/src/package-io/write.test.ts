import { describe, expect, it } from "vitest";
import type { Package } from "../model/package";
import { localFileHeaderNames } from "../test-support/zip";
import {
  serializePackage,
  orderedPackagePartPaths,
  MIMETYPE_PART,
  MANIFEST_PART,
} from "./write";

function packageOf(parts: Package["parts"]): Package {
  return { parts };
}

describe("orderedPackagePartPaths", () => {
  it("lists the manifest path exactly once, never once hoisted and once again among the rest", () => {
    const paths = orderedPackagePartPaths(
      packageOf({
        [MIMETYPE_PART]: { kind: "binary", base64: "" },
        [MANIFEST_PART]: { kind: "xml", nodes: [] },
        "content.xml": { kind: "xml", nodes: [] },
      }),
    );
    expect(paths.filter((path) => path === MANIFEST_PART)).toHaveLength(1);
    expect(paths).toEqual([MIMETYPE_PART, MANIFEST_PART, "content.xml"]);
  });
});

describe("serializePackage", () => {
  it("hoists mimetype first, then manifest, then every remaining part in its own key order", () => {
    const pkg = packageOf({
      "content.xml": { kind: "xml", nodes: [] },
      [MANIFEST_PART]: { kind: "xml", nodes: [] },
      [MIMETYPE_PART]: { kind: "binary", base64: "" },
      "styles.xml": { kind: "xml", nodes: [] },
    });
    const names = localFileHeaderNames(serializePackage(pkg));
    expect(names).toEqual([
      MIMETYPE_PART,
      MANIFEST_PART,
      "content.xml",
      "styles.xml",
    ]);
  });

  it("emits the manifest entry exactly once, not once hoisted and once again as a remaining part", () => {
    const pkg = packageOf({
      [MIMETYPE_PART]: { kind: "binary", base64: "" },
      [MANIFEST_PART]: { kind: "xml", nodes: [] },
      "content.xml": { kind: "xml", nodes: [] },
    });
    const names = localFileHeaderNames(serializePackage(pkg));
    expect(names.filter((name) => name === MANIFEST_PART)).toHaveLength(1);
  });

  it("never fabricates a mimetype or manifest part that was not already in the package", () => {
    const pkg = packageOf({ "content.xml": { kind: "xml", nodes: [] } });
    const names = localFileHeaderNames(serializePackage(pkg));
    expect(names).toEqual(["content.xml"]);
  });
});
