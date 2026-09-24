import { unzipPackage } from "odf.js";
import { describe, expect, it } from "vitest";
import { odfFormulaBytes } from "./odf-formula-fixture";

// The ZIP local file header's own fixed field offsets (PKWARE's APPNOTE.TXT section 4.3.7), all little-endian: the 4-byte "PK\x03\x04" signature at 0, a 2-byte compression method at 8, a 2-byte filename length at 26, a 2-byte extra field length at 28, then the filename bytes themselves starting at the header's own fixed 30-byte size.
const ZIP_SIGNATURE_P = 0x50;
const ZIP_SIGNATURE_K = 0x4b;
const ZIP_SIGNATURE_LOCAL_FILE_MARKER = 0x03;
const ZIP_SIGNATURE_LOCAL_FILE_HEADER = 0x04;
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = [
  ZIP_SIGNATURE_P,
  ZIP_SIGNATURE_K,
  ZIP_SIGNATURE_LOCAL_FILE_MARKER,
  ZIP_SIGNATURE_LOCAL_FILE_HEADER,
];
const ZIP_SIGNATURE_LENGTH = ZIP_LOCAL_FILE_HEADER_SIGNATURE.length;
const ZIP_COMPRESSION_METHOD_OFFSET = 8;
const ZIP_COMPRESSION_METHOD_STORED = 0;
const ZIP_FILENAME_LENGTH_OFFSET = 26;
const ZIP_EXTRA_FIELD_LENGTH_OFFSET = 28;
const ZIP_LOCAL_FILE_HEADER_SIZE = 30;
const MIMETYPE_ENTRY_NAME = "mimetype";

// ODF (OASIS Open Document Format Part 3, "Packages") requires the "mimetype" part to be the zip's very first entry, stored uncompressed with a zero-length extra field, so a reader can identify the container's media type from fixed byte offsets alone. Checked directly against the raw zip bytes (a DataView over the local file header, not odf.js's own unzipPackage, which normalises stored vs deflated content away entirely) — otherwise nothing pins the entry's own name or its "stored" flag, both of which a real ODF-consuming reader depends on.
function assertMimetypeEntryLayout(bytes: Uint8Array, mediaType: string): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  expect(
    Array.from(bytes.subarray(0, ZIP_SIGNATURE_LENGTH)),
    "local file header signature",
  ).toEqual(ZIP_LOCAL_FILE_HEADER_SIGNATURE);
  expect(
    view.getUint16(ZIP_COMPRESSION_METHOD_OFFSET, true),
    "compression method (0 = stored)",
  ).toBe(ZIP_COMPRESSION_METHOD_STORED);
  const filenameLength = view.getUint16(ZIP_FILENAME_LENGTH_OFFSET, true);
  expect(filenameLength, 'filename length ("mimetype".length)').toBe(
    MIMETYPE_ENTRY_NAME.length,
  );
  expect(
    view.getUint16(ZIP_EXTRA_FIELD_LENGTH_OFFSET, true),
    "extra field length",
  ).toBe(0);
  expect(
    decoder.decode(
      bytes.subarray(
        ZIP_LOCAL_FILE_HEADER_SIZE,
        ZIP_LOCAL_FILE_HEADER_SIZE + filenameLength,
      ),
    ),
    "filename bytes",
  ).toBe(MIMETYPE_ENTRY_NAME);
  const contentStart = ZIP_LOCAL_FILE_HEADER_SIZE + filenameLength;
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
