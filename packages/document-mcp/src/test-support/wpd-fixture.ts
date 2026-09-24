// A minimal but structurally authentic WordPerfect 6.x file: a real 512-byte prefix header, a one-record (index-header-only) index area, no packets, and a document area built from real WPFF Document Structure function bytes — mirroring this package's own src/test-support/odf-formula-fixture.ts convention (that file hand-authors odf's own byte structure since neither odf.js nor documents.js exposes a writer for it; wpd-codec exposes no writer at all, for the identical reason). documents.js's own internal src/test-support/wpd.ts carries the same construction (never exported, so not reusable directly from this package either) — this is that same small, spec-grounded port, not a new design.
import { WPD_INDEX_RECORD_SIZE } from "wpd-codec/container/prefix";

const PREFIX_HEADER_SIZE = 512;

// The prefix header's own leading four bytes: 0xff marks the file as not plain ASCII text (WordPerfect reserves every byte from 0x80 up for this), followed by the literal ASCII characters "WPC" that give the format its name.
const FILE_ID_NOT_TEXT_MARKER = 0xff;
const FILE_ID_W = 0x57;
const FILE_ID_P = 0x50;
const FILE_ID_C = 0x43;
const FILE_ID = [FILE_ID_NOT_TEXT_MARKER, FILE_ID_W, FILE_ID_P, FILE_ID_C];

const BITS_PER_BYTE = 8;
const BITS_PER_WORD = 16;
const LOW_BYTE_MASK = 0xff;
const LOW_WORD_MASK = 0xffff;

function putUint16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & LOW_BYTE_MASK;
  bytes[offset + 1] = (value >>> BITS_PER_BYTE) & LOW_BYTE_MASK;
}

function putUint32(bytes: Uint8Array, offset: number, value: number): void {
  putUint16(bytes, offset, value & LOW_WORD_MASK);
  putUint16(bytes, offset + 2, (value >>> BITS_PER_WORD) & LOW_WORD_MASK);
}

const ASCII_SPACE = 0x20;
const WP_SOFT_SPACE_FUNCTION = 0x80;

// The ASCII characters of a string as document-area bytes. Every character in the single-byte printable range passes through unchanged except a space, which WordPerfect represents as the Soft Space function rather than the plain ASCII space byte.
function documentAreaText(value: string): number[] {
  return [...value].map((character) => {
    const code = character.charCodeAt(0);
    return code === ASCII_SPACE ? WP_SOFT_SPACE_FUNCTION : code;
  });
}

// Byte offsets of the prefix header's own fields, per the WPD 6.x prefix header layout this fixture reproduces.
const OFFSET_DOCUMENT_AREA_POINTER = 4;
const OFFSET_ENCRYPTION_FLAG = 12;
const OFFSET_INDEX_AREA_POINTER = 14;
const OFFSET_RESERVED_LONG = 16;
const OFFSET_FILE_SIZE = 20;

const RESERVED_LONG_VALUE = 5; // the documented reserved long at the head of the extended header
const INDEX_HEADER_RECORD_COUNT = 1;
const INDEX_HEADER_FLAGS = 2;

function buildPacketFreeWpdFile(documentArea: readonly number[]): Uint8Array {
  const documentAreaStart = PREFIX_HEADER_SIZE + WPD_INDEX_RECORD_SIZE; // one record: the index header, no packets.
  const fileSize = documentAreaStart + documentArea.length;

  const bytes = new Uint8Array(fileSize);
  bytes.set(FILE_ID, 0);
  putUint32(bytes, OFFSET_DOCUMENT_AREA_POINTER, documentAreaStart);
  bytes[8] = 1; // product type: WordPerfect
  bytes[9] = 0x0a; // file type: WordPerfect document
  bytes[10] = 2; // major version: the 6.x-X6 lineage
  bytes[11] = 1; // minor version
  putUint16(bytes, OFFSET_ENCRYPTION_FLAG, 0); // not encrypted
  putUint16(bytes, OFFSET_INDEX_AREA_POINTER, PREFIX_HEADER_SIZE); // pointer to the index area
  putUint32(bytes, OFFSET_RESERVED_LONG, RESERVED_LONG_VALUE);
  putUint32(bytes, OFFSET_FILE_SIZE, fileSize);

  bytes[PREFIX_HEADER_SIZE] = INDEX_HEADER_FLAGS;
  putUint16(bytes, PREFIX_HEADER_SIZE + 2, INDEX_HEADER_RECORD_COUNT); // record count: the index header alone

  bytes.set(documentArea, documentAreaStart);
  return bytes;
}

// One real paragraph of ordinary body text, matching this package's own docx/odt fixtures in buildFormatFixtures().
export function wpdFixtureBytes(): Uint8Array<ArrayBuffer> {
  return buildPacketFreeWpdFile(
    documentAreaText("A paragraph of ordinary body text."),
  ) as Uint8Array<ArrayBuffer>;
}
