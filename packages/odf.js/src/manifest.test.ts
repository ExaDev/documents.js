import { describe, expect, it } from "vitest";
import type { Package } from "./model/package";
import { bytesToBase64 } from "./util/base64";
import { buildXml } from "./xml/build";
import { el, txt } from "./xml/fragment";
import { readMimetype } from "./mimetype";
import { MANIFEST_PART } from "./package-io/write";
import {
  buildManifest,
  readManifest,
  setDocumentMediaType,
  syncManifest,
  validateManifest,
  writeManifest,
  type Manifest,
} from "./manifest";

const ODT_MEDIA_TYPE = "application/vnd.oasis.opendocument.text";
const PNG_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5,
]);
const JPEG_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 1, 2, 3,
]);
const WMF_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([
  0xd7, 0xcd, 0xc6, 0x9a, 1, 2, 3,
]);

function binaryPart(bytes: Uint8Array<ArrayBuffer>): {
  kind: "binary";
  base64: string;
} {
  return { kind: "binary", base64: bytesToBase64(bytes) };
}

// A minimal, real-shaped .odt package: mimetype + content.xml + an image LibreOffice itself cannot classify (WMF), no manifest.xml yet.
function baseOdtPackage(): Package {
  return {
    parts: {
      mimetype: binaryPart(new TextEncoder().encode(ODT_MEDIA_TYPE)),
      "content.xml": {
        kind: "xml",
        nodes: [el("office:document-content", {}, [])],
      },
      "styles.xml": {
        kind: "xml",
        nodes: [el("office:document-styles", {}, [])],
      },
      "Pictures/image1.png": binaryPart(PNG_BYTES),
      "Pictures/image2.wmf": binaryPart(WMF_BYTES),
    },
  };
}

describe("buildManifest", () => {
  it("derives a root entry from the package's own mimetype part plus one entry per remaining part, excluding manifest.xml and mimetype", () => {
    const manifest = buildManifest(baseOdtPackage());
    expect(manifest.entries.find((e) => e.fullPath === "/")).toEqual({
      fullPath: "/",
      mediaType: ODT_MEDIA_TYPE,
      version: "1.3",
    });
    const paths = manifest.entries.map((e) => e.fullPath).sort();
    expect(paths).toEqual(
      [
        "/",
        "Pictures/image1.png",
        "Pictures/image2.wmf",
        "content.xml",
        "styles.xml",
      ].sort(),
    );
  });

  it('gives the four standard content parts "text/xml", regardless of nesting depth', () => {
    const pkg = baseOdtPackage();
    pkg.parts["embedded/content.xml"] = { kind: "xml", nodes: [] };
    const manifest = buildManifest(pkg, {
      mediaTypeOverrides: { "embedded/": ODT_MEDIA_TYPE },
    });
    expect(
      manifest.entries.find((e) => e.fullPath === "content.xml")?.mediaType,
    ).toBe("text/xml");
    expect(
      manifest.entries.find((e) => e.fullPath === "styles.xml")?.mediaType,
    ).toBe("text/xml");
    expect(
      manifest.entries.find((e) => e.fullPath === "embedded/content.xml")
        ?.mediaType,
    ).toBe("text/xml");
  });

  it("sniffs PNG/JPEG bytes for a binary part with no recognised extension", () => {
    const pkg = baseOdtPackage();
    pkg.parts["Thumbnails/thumbnail"] = binaryPart(JPEG_BYTES);
    const manifest = buildManifest(pkg);
    expect(
      manifest.entries.find((e) => e.fullPath === "Pictures/image1.png")
        ?.mediaType,
    ).toBe("image/png");
    expect(
      manifest.entries.find((e) => e.fullPath === "Thumbnails/thumbnail")
        ?.mediaType,
    ).toBe("image/jpeg");
  });

  it('falls back to empty string -- not "application/octet-stream" -- for a part it cannot classify by name or by sniffing', () => {
    const manifest = buildManifest(baseOdtPackage());
    expect(
      manifest.entries.find((e) => e.fullPath === "Pictures/image2.wmf")
        ?.mediaType,
    ).toBe("");
  });

  it("resolves an ODF-family extension (e.g. an embedded .odt) against media-type.ts's table", () => {
    const pkg = baseOdtPackage();
    pkg.parts["Object 1/replacement.odt"] = binaryPart(
      new TextEncoder().encode("not really a document"),
    );
    const manifest = buildManifest(pkg);
    expect(
      manifest.entries.find((e) => e.fullPath === "Object 1/replacement.odt")
        ?.mediaType,
    ).toBe(ODT_MEDIA_TYPE);
  });

  it("an explicit mediaTypeOverrides entry wins over every automatic resolution rule", () => {
    const pkg = baseOdtPackage();
    const manifest = buildManifest(pkg, {
      mediaTypeOverrides: { "content.xml": "application/x-custom" },
    });
    expect(
      manifest.entries.find((e) => e.fullPath === "content.xml")?.mediaType,
    ).toBe("application/x-custom");
  });

  it("emits a directory entry only for a genuine embedded-subdocument directory (one containing its own content.xml), never for a plain media folder", () => {
    const pkg = baseOdtPackage();
    pkg.parts["Object 1/content.xml"] = { kind: "xml", nodes: [] };
    pkg.parts["Object 1/styles.xml"] = { kind: "xml", nodes: [] };
    const manifest = buildManifest(pkg, {
      mediaTypeOverrides: { "Object 1/": ODT_MEDIA_TYPE },
    });
    expect(
      manifest.entries.find((e) => e.fullPath === "Object 1/")?.mediaType,
    ).toBe(ODT_MEDIA_TYPE);
    // "Pictures/" itself holds only images, no content.xml -- it must never get a synthesized directory entry.
    expect(
      manifest.entries.find((e) => e.fullPath === "Pictures/"),
    ).toBeUndefined();
  });

  it("throws when it cannot determine the root document media type from either the mimetype part or an override", () => {
    expect(() =>
      buildManifest({ parts: { "content.xml": { kind: "xml", nodes: [] } } }),
    ).toThrow(/documentMediaType/);
  });

  it("documentMediaType option overrides an existing mimetype part", () => {
    const manifest = buildManifest(baseOdtPackage(), {
      documentMediaType: "application/vnd.oasis.opendocument.text-template",
    });
    expect(manifest.entries.find((e) => e.fullPath === "/")?.mediaType).toBe(
      "application/vnd.oasis.opendocument.text-template",
    );
  });
});

describe("writeManifest / readManifest round trip", () => {
  it("reads back exactly the manifest that was written", () => {
    const pkg = baseOdtPackage();
    const manifest = buildManifest(pkg);
    writeManifest(pkg, manifest);
    expect(readManifest(pkg)).toEqual(manifest);
  });

  it("serializes manifest:file-entry attributes in full-path, version, media-type order, matching real-world ODF output", () => {
    const pkg = baseOdtPackage();
    writeManifest(pkg, {
      version: "1.3",
      entries: [{ fullPath: "/", mediaType: ODT_MEDIA_TYPE, version: "1.3" }],
    });
    const part = pkg.parts[MANIFEST_PART];
    if (part?.kind !== "xml") {
      throw new Error("expected an xml part");
    }
    const xml = buildXml(part.nodes);
    expect(xml).toContain(
      '<manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="' +
        ODT_MEDIA_TYPE +
        '"></manifest:file-entry>',
    );
  });

  it("readManifest throws for a package with no manifest part", () => {
    expect(() => readManifest({ parts: {} })).toThrow();
  });

  it("readManifest throws when the manifest XML has no manifest:manifest root element", () => {
    const pkg: Package = {
      parts: {
        [MANIFEST_PART]: { kind: "xml", nodes: [el("not-a-manifest-root")] },
      },
    };
    expect(() => readManifest(pkg)).toThrow(/manifest:manifest root element/);
  });

  it("readManifest throws when manifest:manifest is missing its required manifest:version attribute", () => {
    const pkg: Package = {
      parts: {
        [MANIFEST_PART]: {
          kind: "xml",
          nodes: [
            el("manifest:manifest", {
              "xmlns:manifest":
                "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0",
            }),
          ],
        },
      },
    };
    expect(() => readManifest(pkg)).toThrow(/manifest:version/);
  });

  it("readManifest throws when a manifest:file-entry is missing manifest:full-path or manifest:media-type", () => {
    const pkg: Package = {
      parts: {
        [MANIFEST_PART]: {
          kind: "xml",
          nodes: [
            el("manifest:manifest", { "manifest:version": "1.3" }, [
              el("manifest:file-entry", { "manifest:full-path": "/" }),
            ]),
          ],
        },
      },
    };
    expect(() => readManifest(pkg)).toThrow(
      /manifest:full-path or manifest:media-type/,
    );
  });
});

describe("syncManifest", () => {
  it("is idempotent: calling it twice in a row produces byte-identical manifest.xml both times", () => {
    const pkg = baseOdtPackage();
    syncManifest(pkg);
    const part1 = pkg.parts[MANIFEST_PART];
    if (part1?.kind !== "xml") {
      throw new Error("expected an xml part");
    }
    const xml1 = buildXml(part1.nodes);

    syncManifest(pkg);
    const part2 = pkg.parts[MANIFEST_PART];
    if (part2?.kind !== "xml") {
      throw new Error("expected an xml part");
    }
    const xml2 = buildXml(part2.nodes);

    expect(xml2).toBe(xml1);
  });

  it("leaves every other part untouched", () => {
    const pkg = baseOdtPackage();
    const before = JSON.stringify(pkg.parts["content.xml"]);
    syncManifest(pkg);
    expect(JSON.stringify(pkg.parts["content.xml"])).toBe(before);
  });
});

describe("validateManifest", () => {
  it("reports an error when the package has no manifest part at all", () => {
    const problems = validateManifest({ parts: {} });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.severity).toBe("error");
    expect(problems[0]?.message).toContain(MANIFEST_PART);
  });

  it("reports no problems for a manifest that exhaustively and correctly describes the package", () => {
    const pkg = baseOdtPackage();
    syncManifest(pkg);
    expect(validateManifest(pkg)).toEqual([]);
  });

  it("reports an error when the manifest part exists but was parsed as binary rather than XML", () => {
    const pkg = baseOdtPackage();
    pkg.parts[MANIFEST_PART] = { kind: "binary", base64: "" };
    const problems = validateManifest(pkg);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.severity).toBe("error");
    expect(problems[0]?.message).toContain("not XML");
  });

  it("reports an error when the manifest XML has no manifest:manifest root element", () => {
    const pkg = baseOdtPackage();
    pkg.parts[MANIFEST_PART] = {
      kind: "xml",
      nodes: [el("not-a-manifest-root")],
    };
    const problems = validateManifest(pkg);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.severity).toBe("error");
    expect(problems[0]?.message).toContain("manifest:manifest root element");
  });

  it("reports an error, not a throw, when the manifest XML is malformed (a file-entry missing a required attribute)", () => {
    const pkg = baseOdtPackage();
    const root = el(
      "manifest:manifest",
      {
        "xmlns:manifest": "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0",
        "manifest:version": "1.3",
      },
      [
        el("manifest:file-entry", { "manifest:full-path": "/" }), // missing manifest:media-type
      ],
    );
    pkg.parts[MANIFEST_PART] = { kind: "xml", nodes: [root] };
    const problems = validateManifest(pkg);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.severity).toBe("error");
    expect(problems[0]?.message).toContain("failed to parse");
  });

  it('reports an error when the manifest has no root ("/") entry', () => {
    const pkg = baseOdtPackage();
    syncManifest(pkg);
    const manifest = readManifest(pkg);
    writeManifest(pkg, {
      version: manifest.version,
      entries: manifest.entries.filter((e) => e.fullPath !== "/"),
    });
    const problems = validateManifest(pkg);
    expect(
      problems.some(
        (p) => p.severity === "error" && p.message.includes("no root"),
      ),
    ).toBe(true);
  });

  it("reports an error when the root entry media type disagrees with the mimetype part", () => {
    const pkg = baseOdtPackage();
    syncManifest(pkg);
    writeManifest(pkg, {
      version: "1.3",
      entries: [
        {
          fullPath: "/",
          mediaType: "application/vnd.oasis.opendocument.spreadsheet",
          version: "1.3",
        },
      ],
    });
    const problems = validateManifest(pkg);
    expect(problems.some((p) => p.severity === "error" && p.path === "/")).toBe(
      true,
    );
  });

  it("reports a warning for a manifest entry with no corresponding part", () => {
    const pkg = baseOdtPackage();
    syncManifest(pkg);
    const manifest = readManifest(pkg);
    writeManifest(pkg, {
      ...manifest,
      entries: [
        ...manifest.entries,
        { fullPath: "ghost.xml", mediaType: "text/xml" },
      ],
    });
    const problems = validateManifest(pkg);
    const problem = problems.find((p) => p.path === "ghost.xml");
    expect(problem?.severity).toBe("warning");
    expect(problem?.message).toContain("ghost.xml");
  });

  it("reports a warning for a part with no manifest entry", () => {
    const pkg = baseOdtPackage();
    syncManifest(pkg);
    pkg.parts["settings.xml"] = { kind: "xml", nodes: [] };
    const problems = validateManifest(pkg);
    const problem = problems.find((p) => p.path === "settings.xml");
    expect(problem?.severity).toBe("warning");
    expect(problem?.message).toContain("settings.xml");
  });

  it("detects manifest:encryption-data on a file-entry and reports it as a warning", () => {
    const pkg = baseOdtPackage();
    const encryptedEntry = el(
      "manifest:file-entry",
      {
        "manifest:full-path": "content.xml",
        "manifest:media-type": "text/xml",
      },
      [
        el(
          "manifest:encryption-data",
          { "manifest:checksum-type": "SHA1/1K", "manifest:checksum": "abc==" },
          [
            el("manifest:algorithm", {
              "manifest:algorithm-name": "Blowfish CFB",
            }),
            el("manifest:key-derivation", {
              "manifest:key-derivation-name": "PBKDF2",
              "manifest:salt": "xyz==",
            }),
            el("manifest:start-key-generation", {
              "manifest:start-key-generation-name": "SHA1",
            }),
          ],
        ),
      ],
    );
    const root = el(
      "manifest:manifest",
      {
        "xmlns:manifest": "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0",
        "manifest:version": "1.3",
      },
      [
        el("manifest:file-entry", {
          "manifest:full-path": "/",
          "manifest:version": "1.3",
          "manifest:media-type": ODT_MEDIA_TYPE,
        }),
        txt("\n  "), // stray whitespace between elements -- exercises validateManifest's own non-file-entry-child skip
        encryptedEntry,
      ],
    );
    pkg.parts[MANIFEST_PART] = { kind: "xml", nodes: [root] };

    const problems = validateManifest(pkg);
    const problem = problems.find((p) => p.path === "content.xml");
    expect(problem?.severity).toBe("warning");
    expect(problem?.message).toContain("manifest:encryption-data");
  });
});

describe("setDocumentMediaType", () => {
  it("creates a fresh one-entry manifest when the package has none yet", () => {
    const pkg: Package = { parts: {} };
    setDocumentMediaType(pkg, ODT_MEDIA_TYPE);
    expect(readManifest(pkg)).toEqual({
      version: "1.3",
      entries: [{ fullPath: "/", mediaType: ODT_MEDIA_TYPE, version: "1.3" }],
    });
  });

  it("atomically updates both the mimetype part and the manifest root entry", () => {
    const pkg = baseOdtPackage();
    syncManifest(pkg);
    setDocumentMediaType(
      pkg,
      "application/vnd.oasis.opendocument.text-template",
    );

    expect(readMimetype(pkg)).toBe(
      "application/vnd.oasis.opendocument.text-template",
    );

    const manifest = readManifest(pkg);
    expect(manifest.entries.find((e) => e.fullPath === "/")?.mediaType).toBe(
      "application/vnd.oasis.opendocument.text-template",
    );
  });

  it("preserves every non-root entry already in the manifest", () => {
    const pkg = baseOdtPackage();
    syncManifest(pkg);
    const before = readManifest(pkg).entries.filter((e) => e.fullPath !== "/");
    setDocumentMediaType(
      pkg,
      "application/vnd.oasis.opendocument.text-template",
    );
    const after = readManifest(pkg).entries.filter((e) => e.fullPath !== "/");
    expect(after).toEqual(before);
  });

  it("keeps manifest:manifest's own version and the root entry's version in step with the version argument", () => {
    const pkg = baseOdtPackage();
    syncManifest(pkg);
    setDocumentMediaType(pkg, ODT_MEDIA_TYPE, "1.2");
    const manifest = readManifest(pkg);
    expect(manifest.version).toBe("1.2");
    expect(manifest.entries.find((e) => e.fullPath === "/")?.version).toBe(
      "1.2",
    );
  });
});

// Exercises the whole read/build/write loop against a value shaped exactly like a real LibreOffice manifest.xml, pinning that readManifest's structural model matches ground truth captured from a real ODF package.
describe("a real-world-shaped manifest round-trips through the Manifest model unchanged", () => {
  it("round-trips", () => {
    const manifest: Manifest = {
      version: "1.2",
      entries: [
        { fullPath: "/", mediaType: ODT_MEDIA_TYPE, version: "1.2" },
        {
          fullPath: "Pictures/2000008600001923000012C24E0D0895.wmf",
          mediaType: "",
        },
        { fullPath: "meta.xml", mediaType: "text/xml" },
        { fullPath: "settings.xml", mediaType: "text/xml" },
        { fullPath: "content.xml", mediaType: "text/xml" },
        { fullPath: "styles.xml", mediaType: "text/xml" },
      ],
    };
    const pkg: Package = { parts: {} };
    writeManifest(pkg, manifest);
    expect(readManifest(pkg)).toEqual(manifest);
  });
});
