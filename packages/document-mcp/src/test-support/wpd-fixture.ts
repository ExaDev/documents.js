// A minimal but structurally authentic WordPerfect 6.x file: a real 512-byte prefix header, a one-record (index-header-only) index area, no packets, and a document area built from real WPFF Document Structure function bytes -- mirroring this package's own src/test-support/odf-formula-fixture.ts convention (that file hand-authors odf's own byte structure since neither odf.js nor documents.js exposes a writer for it; wpd-codec exposes no writer at all, for the identical reason). documents.js's own internal src/test-support/wpd.ts carries the same construction (never exported, so not reusable directly from this package either) -- this is that same small, spec-grounded port, not a new design.
import { WPD_INDEX_RECORD_SIZE } from "wpd-codec/container/prefix";

const PREFIX_HEADER_SIZE = 512;
const FILE_ID = [0xff, 0x57, 0x50, 0x43];

function putUint16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function putUint32(bytes: Uint8Array, offset: number, value: number): void {
  putUint16(bytes, offset, value & 0xffff);
  putUint16(bytes, offset + 2, (value >>> 16) & 0xffff);
}

// The ASCII characters of a string as document-area bytes -- every character in the single-byte printable range passes through unchanged except a space, which WordPerfect represents as the Soft Space function (0x80) rather than byte 0x20 (the international shorthand for the sharp s).
function documentAreaText(value: string): number[] {
  return [...value].map((character) => {
    const code = character.charCodeAt(0);
    return code === 0x20 ? 0x80 : code;
  });
}

function buildPacketFreeWpdFile(documentArea: readonly number[]): Uint8Array {
  const documentAreaStart = PREFIX_HEADER_SIZE + WPD_INDEX_RECORD_SIZE; // one record: the index header, no packets.
  const fileSize = documentAreaStart + documentArea.length;

  const bytes = new Uint8Array(fileSize);
  bytes.set(FILE_ID, 0);
  putUint32(bytes, 4, documentAreaStart);
  bytes[8] = 1; // product type: WordPerfect
  bytes[9] = 0x0a; // file type: WordPerfect document
  bytes[10] = 2; // major version: the 6.x-X6 lineage
  bytes[11] = 1; // minor version
  putUint16(bytes, 12, 0); // not encrypted
  putUint16(bytes, 14, PREFIX_HEADER_SIZE); // pointer to the index area
  putUint32(bytes, 16, 5); // the documented reserved long at the head of the extended header
  putUint32(bytes, 20, fileSize);

  bytes[PREFIX_HEADER_SIZE] = 2; // index header flags
  putUint16(bytes, PREFIX_HEADER_SIZE + 2, 1); // record count: the index header alone

  bytes.set(documentArea, documentAreaStart);
  return bytes;
}

// One real paragraph of ordinary body text, matching this package's own docx/odt fixtures in buildFormatFixtures().
export function wpdFixtureBytes(): Uint8Array<ArrayBuffer> {
  return buildPacketFreeWpdFile(
    documentAreaText("A paragraph of ordinary body text."),
  ) as Uint8Array<ArrayBuffer>;
}
