import { unzipPackage } from "odf.js";
import { describe, expect, it } from "vitest";
import { odfFormulaBytes } from "./odf-formula-fixture";

// ODF (OASIS Open Document Format Part 3, "Packages") requires the "mimetype" part to be the zip's very first entry, stored uncompressed with a zero-length extra field, so a reader can identify the container's media type from fixed byte offsets alone. Checked directly against the raw zip bytes (a DataView over the local file header, not odf.js's own unzipPackage, which normalises stored vs deflated content away entirely) -- otherwise nothing pins the entry's own name or its "stored" flag, both of which a real ODF-consuming reader depends on.
function assertMimetypeEntryLayout(bytes: Uint8Array, mediaType: string): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  expect(
    Array.from(bytes.subarray(0, 4)),
    "local file header signature",
  ).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(view.getUint16(8, true), "compression method (0 = stored)").toBe(0);
  const filenameLength = view.getUint16(26, true);
  expect(filenameLength, 'filename length ("mimetype".length)').toBe(8);
  expect(view.getUint16(28, true), "extra field length").toBe(0);
  expect(
    decoder.decode(bytes.subarray(30, 30 + filenameLength)),
    "filename bytes",
  ).toBe("mimetype");
  const contentStart = 30 + filenameLength;
  expect(
    decoder.decode(
      bytes.subarray(contentStart, contentStart + mediaType.length),
    ),
    "mimetype content bytes",
  ).toBe(mediaType);
}

describe("odfFormulaBytes", () => {
  it("places a stored mimetype entry declaring the real ODF formula media type first", () => {
    assertMimetypeEntryLayout(
      odfFormulaBytes(),
      "application/vnd.oasis.opendocument.formula",
    );
  });

  it("carries a math:math element under content.xml", () => {
    const unzipped = unzipPackage(odfFormulaBytes());
    const contentXml = unzipped["content.xml"];
    if (contentXml === undefined) {
      throw new Error("expected a content.xml entry in the zip");
    }
    expect(new TextDecoder().decode(contentXml)).toContain("<math:math");
  });
});
