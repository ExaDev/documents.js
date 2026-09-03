import { describe, expect, it } from "vitest";
import {
  WpdEncryptedDocumentError,
  WpdNotAWordPerfectFileError,
  WpdUnsupportedVersionError,
} from "../errors";
import {
  GENERIC_HEADER_DOCUMENT_AREA_OFFSET,
  GENERIC_HEADER_INDEX_AREA_OFFSET,
  GENERIC_HEADER_SIZE,
  genericHeaderBytes,
} from "../test-support/generic-header";
import { readFileHeader } from "./header";

// A minimal conforming 16-byte header, assembled field by field from the SDK's own "File Header Format" table rather than copied from a real file, so each assertion below points at one named field.
function headerBytes(
  overrides: {
    id?: readonly number[];
    documentAreaOffset?: number;
    productType?: number;
    fileType?: number;
    majorVersion?: number;
    minorVersion?: number;
    encryption?: number;
    indexAreaOffset?: number;
  } = {},
): Uint8Array {
  const bytes = new Uint8Array(1024);
  bytes.set(overrides.id ?? [0xff, 0x57, 0x50, 0x43], 0);
  const documentAreaOffset = overrides.documentAreaOffset ?? 718;
  bytes[4] = documentAreaOffset & 0xff;
  bytes[5] = (documentAreaOffset >>> 8) & 0xff;
  bytes[6] = (documentAreaOffset >>> 16) & 0xff;
  bytes[7] = (documentAreaOffset >>> 24) & 0xff;
  bytes[8] = overrides.productType ?? 1;
  bytes[9] = overrides.fileType ?? 0x0a;
  bytes[10] = overrides.majorVersion ?? 2;
  bytes[11] = overrides.minorVersion ?? 1;
  const encryption = overrides.encryption ?? 0;
  bytes[12] = encryption & 0xff;
  bytes[13] = (encryption >>> 8) & 0xff;
  const indexAreaOffset = overrides.indexAreaOffset ?? 512;
  bytes[14] = indexAreaOffset & 0xff;
  bytes[15] = (indexAreaOffset >>> 8) & 0xff;
  return bytes;
}

describe("readFileHeader", () => {
  it("reads every field of the SDK's own generic header example", () => {
    const header = readFileHeader(genericHeaderBytes());

    expect(header).toEqual({
      documentAreaOffset: GENERIC_HEADER_DOCUMENT_AREA_OFFSET,
      productType: 1,
      fileType: 0x0a,
      majorVersion: 2,
      minorVersion: 1,
      indexAreaOffset: GENERIC_HEADER_INDEX_AREA_OFFSET,
      fileSize: GENERIC_HEADER_SIZE,
    });
  });

  it("rejects a file whose first four bytes are not the -1,'WPC' file ID", () => {
    expect(() =>
      readFileHeader(headerBytes({ id: [0x50, 0x4b, 0x03, 0x04] })),
    ).toThrow(WpdNotAWordPerfectFileError);
  });

  it("rejects an encrypted document rather than returning an unreadable header", () => {
    expect(() => readFileHeader(headerBytes({ encryption: 1 }))).toThrow(
      WpdEncryptedDocumentError,
    );
  });

  it("rejects a WordPerfect 5.x file, whose major version is not the 6.x-X6 lineage's 2", () => {
    expect(() => readFileHeader(headerBytes({ majorVersion: 0 }))).toThrow(
      WpdUnsupportedVersionError,
    );
  });

  it("rejects a non-document WordPerfect file, such as a printer resource file", () => {
    expect(() => readFileHeader(headerBytes({ fileType: 0x10 }))).toThrow(
      WpdUnsupportedVersionError,
    );
  });

  it("rejects a file from another Corel product", () => {
    expect(() => readFileHeader(headerBytes({ productType: 3 }))).toThrow(
      WpdUnsupportedVersionError,
    );
  });
});
