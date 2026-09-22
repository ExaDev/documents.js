import { describe, expect, it } from "vitest";
import { EPUB_MIME_TYPE } from "../format";
import { readImageDimensions } from "../image/dimensions";
import { unzipPackage } from "../zip";
import { assertMimetypeEntryLayout } from "./zip";
import { fixtureEpub2Bytes } from "./epub2-fixture";
import { fixtureEpub2MultichapterBytes } from "./epub2-multichapter-fixture";
import { fixtureEpubMultichapterBytes } from "./epub-multichapter-fixture";
import { fixtureEpub3Bytes } from "./epub3-fixture";

// These fixture builders assemble a real zip byte-for-byte, entry path by entry path — a wrong path or a mimetype entry that isn't genuinely stored uncompressed would still let most reading tests pass, since readEpubContent resolves paths through the OPF manifest rather than by any fixed position. Verified directly here against the fixture's own real byte output, the same way the pipeline-level "OCF-mandated mimetype-first/stored byte layout" test verifies the writer's output.
describe.each([
  ["fixtureEpub3Bytes", fixtureEpub3Bytes, ["OEBPS/nav.xhtml"], 6],
  ["fixtureEpub2Bytes", fixtureEpub2Bytes, ["OEBPS/toc.ncx"], 5],
  [
    "fixtureEpubMultichapterBytes",
    fixtureEpubMultichapterBytes,
    ["OEBPS/nav.xhtml", "OEBPS/chapter2.xhtml"],
    6,
  ],
  [
    "fixtureEpub2MultichapterBytes",
    fixtureEpub2MultichapterBytes,
    ["OEBPS/toc.ncx", "OEBPS/chapter2.xhtml"],
    6,
  ],
] as const)("%s", (_name, buildBytes, expectedPaths, expectedEntryCount) => {
  it("stores the mimetype entry first and genuinely uncompressed", () => {
    expect(() => {
      assertMimetypeEntryLayout(buildBytes(), EPUB_MIME_TYPE);
    }).not.toThrow();
  });

  it("zips every entry under its own real, distinct path, with its own real content", () => {
    const entries = unzipPackage(buildBytes());
    for (const path of expectedPaths) {
      const bytes = entries[path];
      if (bytes === undefined) {
        throw new Error(`expected a "${path}" entry`);
      }
      // Real length, not merely present: fflate silently zips a missing `bytes` value as a genuine, present, zero-length entry rather than throwing.
      expect(bytes.length).toBeGreaterThan(0);
    }
    // Every path is unique: a mutated path colliding with another real entry would silently overwrite it rather than fail outright, so the entry count itself is part of what proves no two declared paths collapsed into one.
    expect(Object.keys(entries)).toHaveLength(expectedEntryCount);
  });
});

describe("fixtureEpub3Bytes", () => {
  it("builds a cover PNG whose IHDR genuinely declares 2x2 pixels", () => {
    const entries = unzipPackage(fixtureEpub3Bytes());
    const coverBytes = entries["OEBPS/images/cover.png"];
    if (coverBytes === undefined) {
      throw new Error("expected a cover.png entry");
    }
    expect(readImageDimensions(coverBytes)).toEqual({
      widthPx: 2,
      heightPx: 2,
    });
  });
});
