import { describe, expect, it } from "vitest";
import type { Package } from "../model/package";
import {
  localFileHeaderNames,
  readUint16LE,
  readUint32LE,
} from "../test-support/zip";
import {
  serializePackage,
  orderedPackagePartPaths,
  MIMETYPE_PART,
  MANIFEST_PART,
} from "./write";

function packageOf(parts: Package["parts"]): Package {
  return { parts };
}

// Walks local file headers exactly as localFileHeaderNames does, but also returns each entry's own compression-method field (0 = stored, 8 = deflated) -- what a non-mimetype part's storage mode actually is, which localFileHeaderNames itself has no need to expose.
function localFileHeaderCompressionMethods(bytes: Uint8Array): number[] {
  const methods: number[] = [];
  let offset = 0;
  while (offset < bytes.length && readUint32LE(bytes, offset) === 0x04034b50) {
    methods.push(readUint16LE(bytes, offset + 8));
    const compressedSize = readUint32LE(bytes, offset + 18);
    const filenameLength = readUint16LE(bytes, offset + 26);
    const extraLength = readUint16LE(bytes, offset + 28);
    offset = offset + 30 + filenameLength + extraLength + compressedSize;
  }
  return methods;
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

  it("stores only the mimetype entry uncompressed; every other part is deflated (compression method 8), not also stored", () => {
    const pkg = packageOf({
      [MIMETYPE_PART]: { kind: "binary", base64: "" },
      "content.xml": { kind: "xml", nodes: [] },
    });
    const methods = localFileHeaderCompressionMethods(serializePackage(pkg));
    expect(methods).toEqual([0, 8]);
  });
});
