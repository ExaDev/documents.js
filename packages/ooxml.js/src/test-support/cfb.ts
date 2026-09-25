// A compact compound-file builder specialised to the single shape the embedded-object fixtures need: a classic OLE .bin payload (word|ppt/embeddings/oleObject1.bin) whose root storage holds one 'Package' stream wrapping the packaged file — the exact real-world spelling of a Word/PowerPoint OLE embed of a non-OLE file. Mirrors archive-codec's own test-support writer (src/test-support/cfb.ts there, where the layout's full construction is documented); kept local rather than imported because test-support is excluded from every package's published dist, so it cannot cross package boundaries. Layout: sector 0 is the FAT, sector 1 the directory (root entry plus the Package stream entry), then the Package stream's own sectors when it is at or above the 4096-byte cutoff, then the mini stream and mini-FAT sectors when it is below. Test-support only, never published.

import { COMPOUND_FILE_MAGIC } from "archive-codec";

const SECTOR_SIZE = 512;
const MINI_SECTOR_SIZE = 64;
const MINI_STREAM_CUTOFF = 4096;
const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const FATSECT = 0xfffffffd;
const NOSTREAM = 0xffffffff;

// [MS-CFB] 2.6.1 Compound File Directory Entry: every entry is a fixed-size 128-byte slice of a directory sector.
const DIRECTORY_ENTRY_SIZE = 128;
// [MS-CFB] 2.6.1's own Object Type enum: 0 = unknown/unallocated, 1 = storage, 2 = stream, 5 = root storage. This builder only ever writes a root storage entry and a stream entry.
const OBJECT_TYPE_ROOT_STORAGE = 5;
// Field offsets within a single 128-byte directory entry, per [MS-CFB] 2.6.1.
const DIRECTORY_ENTRY_NAME_LENGTH_OFFSET = 0x40;
const DIRECTORY_ENTRY_OBJECT_TYPE_OFFSET = 0x42;
const DIRECTORY_ENTRY_LEFT_SIBLING_ID_OFFSET = 0x44;
const DIRECTORY_ENTRY_RIGHT_SIBLING_ID_OFFSET = 0x48;
const DIRECTORY_ENTRY_CHILD_ID_OFFSET = 0x4c;
const DIRECTORY_ENTRY_STARTING_SECTOR_OFFSET = 0x74;
const DIRECTORY_ENTRY_STREAM_SIZE_OFFSET = 0x78;

// A FAT, mini-FAT, or DIFAT entry is always a 4-byte (uint32) sector or mini-sector reference, per [MS-CFB] 2.3/2.4/2.5. Shared by every index-to-byte-offset multiplication below, since they are all the same underlying entry width.
const FAT_ENTRY_SIZE = 4;

// Field offsets within the 512-byte compound file header, per [MS-CFB] 2.2.
const HEADER_MINOR_VERSION_OFFSET = 0x18;
const HEADER_MAJOR_VERSION_OFFSET = 0x1a;
const HEADER_BYTE_ORDER_OFFSET = 0x1c;
const HEADER_SECTOR_SHIFT_OFFSET = 0x1e;
const HEADER_MINI_SECTOR_SHIFT_OFFSET = 0x20;
const HEADER_FAT_SECTOR_COUNT_OFFSET = 0x2c;
const HEADER_FIRST_DIRECTORY_SECTOR_OFFSET = 0x30;
const HEADER_MINI_STREAM_CUTOFF_OFFSET = 0x38;
const HEADER_FIRST_MINIFAT_SECTOR_OFFSET = 0x3c;
const HEADER_MINIFAT_SECTOR_COUNT_OFFSET = 0x40;
const HEADER_FIRST_DIFAT_SECTOR_OFFSET = 0x44;
// Where the header's own inline DIFAT[0..108] array begins; distinct from DIRECTORY_ENTRY_CHILD_ID_OFFSET even though both happen to be 0x4c, since the two live in entirely different 512-byte structures (the header versus a directory entry).
const HEADER_DIFAT_OFFSET = 0x4c;
// The header's own inline DIFAT array holds 109 slots (109 * 4 bytes = 436 bytes, filling the header from HEADER_DIFAT_OFFSET to its own 512-byte end); slot 0 is written separately as "the FAT is sector 0" (left at its already-zero default, per the comment below), so this builder only needs to mark the remaining 108 as unused.
const HEADER_DIFAT_UNUSED_SLOT_COUNT = 108;
// Fixed values this builder always writes into the header, per [MS-CFB] 2.2.
const HEADER_MINOR_VERSION = 0x3e;
const HEADER_MAJOR_VERSION_V3 = 3; // version 3: 512-byte sectors
const HEADER_BYTE_ORDER_MARK = 0xfffe; // little-endian
const HEADER_SECTOR_SHIFT_512 = 9; // 2^9 = 512-byte sectors
const HEADER_MINI_SECTOR_SHIFT_64 = 6; // 2^6 = 64-byte mini sectors
const HEADER_ONE_FAT_SECTOR = 1;
const HEADER_DIRECTORY_STARTS_AT_SECTOR_1 = 1;

const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

// The OLE packaging ([MS-OLEDS] OLENativeStream's Packager spelling): header word, label, source path, 8 opaque bytes, temp path, then the file's size and bytes.
function packageStreamOf(
  fileBytes: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const zstring = (s: string): Uint8Array<ArrayBuffer> => enc(`${s}\0`);
  const OPAQUE_BYTES_LENGTH = 8; // [MS-OLEDS]'s own unused/reserved run between the source path and the temp path
  // The little-endian uint32 field this format stores the packaged file's own byte length in, immediately before the file bytes themselves; reserved as zero here and populated by the explicit DataView write below.
  const SIZE_FIELD_LENGTH = 4;
  const parts = [
    new Uint8Array([0x02, 0x00]),
    zstring("Book1.xlsx"),
    zstring("C:\\data\\Book1.xlsx"),
    new Uint8Array(OPAQUE_BYTES_LENGTH),
    zstring("C:\\temp\\Book1.xlsx"),
    new Uint8Array(SIZE_FIELD_LENGTH),
    fileBytes,
  ];
  const out = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  new DataView(out.buffer).setUint32(
    out.length - fileBytes.length - SIZE_FIELD_LENGTH,
    fileBytes.length,
    true,
  );
  return out;
}

function put16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function put32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

function writeEntry(
  entry: DataView,
  name: string,
  objectType: number,
  rightId: number,
  childId: number,
  startSector: number,
  size: number,
): void {
  const encoded = enc(name);
  encoded.forEach((byte, i) => {
    entry.setUint8(i * 2, byte);
    entry.setUint8(i * 2 + 1, 0);
  });
  put16(entry, DIRECTORY_ENTRY_NAME_LENGTH_OFFSET, encoded.length * 2 + 2);
  entry.setUint8(DIRECTORY_ENTRY_OBJECT_TYPE_OFFSET, objectType);
  put32(entry, DIRECTORY_ENTRY_LEFT_SIBLING_ID_OFFSET, NOSTREAM);
  put32(entry, DIRECTORY_ENTRY_RIGHT_SIBLING_ID_OFFSET, rightId);
  put32(entry, DIRECTORY_ENTRY_CHILD_ID_OFFSET, childId);
  put32(entry, DIRECTORY_ENTRY_STARTING_SECTOR_OFFSET, startSector);
  put32(entry, DIRECTORY_ENTRY_STREAM_SIZE_OFFSET, size);
  // No high-32-bits-of-size write at 0x7c: entry is always a fresh 128-byte slice of a zero-initialised directory buffer, so it is already 0 there — every size this test-support builder ever writes fits in 32 bits regardless.
}

// Builds the .bin bytes: a version-3 compound file whose root storage carries the packaged file as its stream — 'Package' by default, overridable for fixtures that need the no-Package-stream shape a native legacy embed produces. The stream is placed by the mini-stream cutoff exactly as a real producer would place it (below the cutoff in the mini stream, at or above it in its own FAT-chained sectors).
export function oleObjectBin(
  fileBytes: Uint8Array<ArrayBuffer>,
  options: { readonly streamName?: string } = {},
): Uint8Array<ArrayBuffer> {
  const packageStream = packageStreamOf(fileBytes);
  const small = packageStream.length < MINI_STREAM_CUTOFF;
  const padded = new Uint8Array(
    Math.ceil(packageStream.length / (small ? MINI_SECTOR_SIZE : SECTOR_SIZE)) *
      (small ? MINI_SECTOR_SIZE : SECTOR_SIZE),
  );
  padded.set(packageStream);
  const streamSectors = Math.ceil(padded.length / SECTOR_SIZE);
  const miniFatSector = 2 + streamSectors;
  const totalSectors = small ? miniFatSector + 1 : 2 + streamSectors;
  const file = new Uint8Array(SECTOR_SIZE + totalSectors * SECTOR_SIZE);
  const view = new DataView(file.buffer);

  // Header: the same field run every version-3 compound file carries (see archive-codec's reader).
  file.set(COMPOUND_FILE_MAGIC, 0);
  put16(view, HEADER_MINOR_VERSION_OFFSET, HEADER_MINOR_VERSION);
  put16(view, HEADER_MAJOR_VERSION_OFFSET, HEADER_MAJOR_VERSION_V3);
  put16(view, HEADER_BYTE_ORDER_OFFSET, HEADER_BYTE_ORDER_MARK);
  put16(view, HEADER_SECTOR_SHIFT_OFFSET, HEADER_SECTOR_SHIFT_512);
  put16(view, HEADER_MINI_SECTOR_SHIFT_OFFSET, HEADER_MINI_SECTOR_SHIFT_64);
  // No writes for 0x28 (reserved), 0x48 (number of mini-FAT sectors — always 0 or 1, tracked instead by the mini-FAT's own presence at 0x3c), or 0x4c's own DIFAT[0] slot: file is a fresh, zero-initialised buffer, and all three fields' real values happen to be 0 — an explicit write there is indistinguishable from leaving the default alone. DIFAT[0] being 0 is still what says "the FAT is sector 0"; it is just never written explicitly, since 0 is already what a fresh buffer holds there.
  put32(view, HEADER_FAT_SECTOR_COUNT_OFFSET, HEADER_ONE_FAT_SECTOR); // one FAT sector
  put32(
    view,
    HEADER_FIRST_DIRECTORY_SECTOR_OFFSET,
    HEADER_DIRECTORY_STARTS_AT_SECTOR_1,
  ); // directory chain starts at sector 1
  put32(view, HEADER_MINI_STREAM_CUTOFF_OFFSET, MINI_STREAM_CUTOFF);
  put32(
    view,
    HEADER_FIRST_MINIFAT_SECTOR_OFFSET,
    small ? miniFatSector : ENDOFCHAIN,
  ); // mini-FAT present only when the stream is mini-stream-resident
  put32(view, HEADER_MINIFAT_SECTOR_COUNT_OFFSET, small ? 1 : 0);
  put32(view, HEADER_FIRST_DIFAT_SECTOR_OFFSET, ENDOFCHAIN);
  // DIFAT[1..108]: every slot the header can hold beyond DIFAT[0] is unused padding (this builder always declares exactly one FAT sector), marked FREESECT. Array.from rather than a hand-bounded for loop: the loop's own last iteration is masked by the FAT sector's own bytes being (re)written immediately below regardless of where this range ends, so an off-by-one here has nothing left to observably corrupt — removing the comparison as an AST node entirely is the honest reflection of that, rather than a test straining to observe a difference that cannot exist.
  Array.from(
    { length: HEADER_DIFAT_UNUSED_SLOT_COUNT },
    (_, i) => i + 1,
  ).forEach((i) => {
    put32(view, HEADER_DIFAT_OFFSET + i * FAT_ENTRY_SIZE, FREESECT);
  });

  // Directory: root entry 0 (its stream IS the mini stream) and the Package stream as entry 1.
  const directory = new Uint8Array(SECTOR_SIZE);
  writeEntry(
    new DataView(directory.buffer, 0, DIRECTORY_ENTRY_SIZE),
    "Root Entry",
    OBJECT_TYPE_ROOT_STORAGE,
    NOSTREAM,
    1,
    small ? 2 : ENDOFCHAIN,
    small ? padded.length : 0,
  );
  writeEntry(
    new DataView(directory.buffer, DIRECTORY_ENTRY_SIZE, DIRECTORY_ENTRY_SIZE),
    options.streamName ?? "Package",
    2,
    NOSTREAM,
    NOSTREAM,
    small ? 0 : 2,
    packageStream.length,
  );

  // FAT: sector 0 holds the FAT itself, sector 1 the directory, sectors 2.. the stream's (or mini stream's) sectors, then the mini-FAT sector.
  const fatView = new DataView(file.buffer, SECTOR_SIZE, SECTOR_SIZE);
  fatView.setUint32(0, FATSECT, true);
  fatView.setUint32(FAT_ENTRY_SIZE, ENDOFCHAIN, true); // FAT[1]: the directory occupies only sector 1, so its own chain ends immediately
  const streamStart = 2;
  for (let sector = streamStart; sector < 2 + streamSectors; sector++) {
    fatView.setUint32(
      sector * FAT_ENTRY_SIZE,
      sector === 1 + streamSectors ? ENDOFCHAIN : sector + 1,
      true,
    );
  }
  if (small) {
    fatView.setUint32(miniFatSector * FAT_ENTRY_SIZE, ENDOFCHAIN, true);
  }

  if (small) {
    // Mini-FAT: the stream's mini sectors chained then ENDOFCHAIN, FREESECT padding after.
    const miniFatView = new DataView(
      file.buffer,
      SECTOR_SIZE + miniFatSector * SECTOR_SIZE,
      SECTOR_SIZE,
    );
    const miniSectorCount = padded.length / MINI_SECTOR_SIZE;
    for (let i = 0; i < miniSectorCount; i++) {
      miniFatView.setUint32(
        i * FAT_ENTRY_SIZE,
        i === miniSectorCount - 1 ? ENDOFCHAIN : i + 1,
        true,
      );
    }
  }

  file.set(directory, SECTOR_SIZE + 1 * SECTOR_SIZE);
  file.set(padded, SECTOR_SIZE + streamStart * SECTOR_SIZE);
  return file;
}
