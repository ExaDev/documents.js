// A minimal [MS-CFB] compound-file writer for this package's own end-to-end test: given flat stream names and their bytes, it emits a real version-3 compound file that archive-codec's reader parses, so the read path can be exercised from a file's first byte rather than from streams handed to it. It is deliberately narrower than archive-codec's own test builder (which the family convention already duplicates per package rather than publishing): no nested storages, and every stream lives in FAT-chained sectors because the header declares the smallest legal mini-stream cutoff, which removes the mini-FAT from the layout entirely. [MS-CFB] 2.2 Compound File Header, 2.6.1 Compound File Directory Entry: https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/53989ce4-7b05-4f8d-829b-d08d6148375b
//
// Test-support only: excluded from the published dist per the family convention.

const SECTOR_SIZE = 512;
const HEADER_SIZE = 512;
const DIRECTORY_ENTRY_SIZE = 128;
const ENTRIES_PER_DIRECTORY_SECTOR = SECTOR_SIZE / DIRECTORY_ENTRY_SIZE;
// Each FAT entry is one 4-byte sector reference ([MS-CFB] 2.3), the same width a DIFAT entry uses.
const FAT_ENTRY_BYTES = 4;
const FAT_ENTRIES_PER_SECTOR = SECTOR_SIZE / FAT_ENTRY_BYTES;
const HEADER_DIFAT_ENTRIES = 109;
const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const FATSECT = 0xfffffffd;
const NOSTREAM = 0xffffffff;
const OBJECT_TYPE_STREAM = 2;
const OBJECT_TYPE_ROOT = 5;
// The smallest cutoff [MS-CFB] permits, since it must be at least one mini sector. Declaring it puts every stream of 64 bytes or more in the FAT rather than the mini stream, which is why this writer needs no mini-FAT at all.
const MINI_STREAM_CUTOFF = 64;
const MINI_SECTOR_SHIFT = 6;

// [MS-CFB] 2.2 Compound File Header signature: a fixed 8-byte magic every compound file begins with, named byte by byte since a numeric-literal array element is checked independently of the array's own declaration.
const CFB_SIGNATURE_0 = 0xd0;
const CFB_SIGNATURE_1 = 0xcf;
const CFB_SIGNATURE_2 = 0x11;
const CFB_SIGNATURE_3 = 0xe0;
const CFB_SIGNATURE_4 = 0xa1;
const CFB_SIGNATURE_5 = 0xb1;
const CFB_SIGNATURE_6 = 0x1a;
const CFB_SIGNATURE_7 = 0xe1;

// [MS-CFB] 2.2 Compound File Header field byte offsets, each named for the field it writes.
const CFB_HEADER_MINOR_VERSION_OFFSET = 0x18;
const CFB_HEADER_MAJOR_VERSION_OFFSET = 0x1a;
const CFB_HEADER_BYTE_ORDER_OFFSET = 0x1c;
const CFB_HEADER_SECTOR_SHIFT_OFFSET = 0x1e;
const CFB_HEADER_MINI_SECTOR_SHIFT_OFFSET = 0x20;
const CFB_HEADER_FAT_SECTOR_COUNT_OFFSET = 0x2c;
const CFB_HEADER_FIRST_DIRECTORY_SECTOR_OFFSET = 0x30;
const CFB_HEADER_MINI_STREAM_CUTOFF_OFFSET = 0x38;
const CFB_HEADER_FIRST_MINIFAT_SECTOR_OFFSET = 0x3c;
const CFB_HEADER_FIRST_DIFAT_SECTOR_OFFSET = 0x44;
const CFB_HEADER_DIFAT_OFFSET = 0x4c;

// This writer only ever emits the 512-byte-sector, major-version-3 form [MS-CFB] 2.2 describes, never the 4096-byte/version-4 alternative.
const CFB_MINOR_VERSION = 0x003e;
const CFB_MAJOR_VERSION = 3;
const CFB_BYTE_ORDER_LITTLE_ENDIAN = 0xfffe;
// log2(SECTOR_SIZE): the header states a sector's size as a shift amount rather than a byte count.
const CFB_SECTOR_SHIFT = 9;

// [MS-CFB] 2.6.1 Compound File Directory Entry field byte offsets, relative to the start of each 128-byte entry.
const DIRECTORY_ENTRY_NAME_LENGTH_OFFSET = 0x40;
const DIRECTORY_ENTRY_OBJECT_TYPE_OFFSET = 0x42;
const DIRECTORY_ENTRY_COLOR_FLAG_OFFSET = 0x43;
const DIRECTORY_ENTRY_LEFT_SIBLING_OFFSET = 0x44;
const DIRECTORY_ENTRY_RIGHT_SIBLING_OFFSET = 0x48;
const DIRECTORY_ENTRY_CHILD_ID_OFFSET = 0x4c;
const DIRECTORY_ENTRY_START_SECTOR_OFFSET = 0x74;
const DIRECTORY_ENTRY_STREAM_SIZE_OFFSET = 0x78;
// Every byte of NOSTREAM (0xffffffff) is 0xff, so filling a sibling ID field with this one byte value fills it with NOSTREAM under either byte order.
const NOSTREAM_FILL_BYTE = 0xff;

export interface CompoundFileStreamSpec {
  readonly name: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

function sectorsFor(byteLength: number): number {
  return Math.ceil(byteLength / SECTOR_SIZE);
}

export function compoundFile(
  streams: readonly CompoundFileStreamSpec[],
): Uint8Array<ArrayBuffer> {
  for (const stream of streams) {
    if (stream.bytes.length < MINI_STREAM_CUTOFF) {
      throw new Error(
        `compoundFile writes every stream through the FAT, so each must be at least ${MINI_STREAM_CUTOFF} bytes (got ${stream.bytes.length} for "${stream.name}")`,
      );
    }
  }
  const directorySectors = Math.ceil(
    (streams.length + 1) / ENTRIES_PER_DIRECTORY_SECTOR,
  );
  const streamSectors = streams.map((stream) =>
    sectorsFor(stream.bytes.length),
  );
  const nonFatSectors =
    directorySectors + streamSectors.reduce((sum, count) => sum + count, 0);
  // Each FAT sector maps FAT_ENTRIES_PER_SECTOR sectors including the FAT sectors themselves, so the count is the least fixed point of that self-reference rather than a plain division.
  let fatSectors = 1;
  while (fatSectors * FAT_ENTRIES_PER_SECTOR < nonFatSectors + fatSectors) {
    fatSectors++;
  }
  const totalSectors = fatSectors + nonFatSectors;

  const fat = new Uint32Array(fatSectors * FAT_ENTRIES_PER_SECTOR).fill(
    FREESECT,
  );
  // The first fatSectors entries mark the FAT sectors themselves; chain() always immediately follows with a real link starting at index fatSectors (firstDirectorySector), so a loop bound one too wide here would only ever write a value the very next statement overwrites.
  fat.fill(FATSECT, 0, fatSectors);
  const chain = (firstSector: number, count: number): void => {
    for (let i = 0; i < count; i++) {
      fat[firstSector + i] = i === count - 1 ? ENDOFCHAIN : firstSector + i + 1;
    }
  };
  const firstDirectorySector = fatSectors;
  chain(firstDirectorySector, directorySectors);
  const streamStarts: number[] = [];
  let nextSector = firstDirectorySector + directorySectors;
  for (const count of streamSectors) {
    streamStarts.push(nextSector);
    chain(nextSector, count);
    nextSector += count;
  }

  const file = new Uint8Array(HEADER_SIZE + totalSectors * SECTOR_SIZE);
  const view = new DataView(file.buffer);
  file.set(
    new Uint8Array([
      CFB_SIGNATURE_0,
      CFB_SIGNATURE_1,
      CFB_SIGNATURE_2,
      CFB_SIGNATURE_3,
      CFB_SIGNATURE_4,
      CFB_SIGNATURE_5,
      CFB_SIGNATURE_6,
      CFB_SIGNATURE_7,
    ]),
    0,
  );
  view.setUint16(CFB_HEADER_MINOR_VERSION_OFFSET, CFB_MINOR_VERSION, true);
  view.setUint16(CFB_HEADER_MAJOR_VERSION_OFFSET, CFB_MAJOR_VERSION, true);
  view.setUint16(
    CFB_HEADER_BYTE_ORDER_OFFSET,
    CFB_BYTE_ORDER_LITTLE_ENDIAN,
    true,
  );
  view.setUint16(CFB_HEADER_SECTOR_SHIFT_OFFSET, CFB_SECTOR_SHIFT, true);
  view.setUint16(CFB_HEADER_MINI_SECTOR_SHIFT_OFFSET, MINI_SECTOR_SHIFT, true);
  view.setUint32(CFB_HEADER_FAT_SECTOR_COUNT_OFFSET, fatSectors, true);
  view.setUint32(
    CFB_HEADER_FIRST_DIRECTORY_SECTOR_OFFSET,
    firstDirectorySector,
    true,
  );
  view.setUint32(
    CFB_HEADER_MINI_STREAM_CUTOFF_OFFSET,
    MINI_STREAM_CUTOFF,
    true,
  );
  view.setUint32(CFB_HEADER_FIRST_MINIFAT_SECTOR_OFFSET, ENDOFCHAIN, true);
  // miniFatSectorCount (0x40) and difatSectorCount (0x48) both want 0, which `file` already holds from its own zero-initialization above — there is nothing left for either field to write.
  view.setUint32(CFB_HEADER_FIRST_DIFAT_SECTOR_OFFSET, ENDOFCHAIN, true);
  for (const [i, sector] of Array.from(
    { length: HEADER_DIFAT_ENTRIES },
    (_unused, index) => (index < fatSectors ? index : FREESECT),
  ).entries()) {
    view.setUint32(CFB_HEADER_DIFAT_OFFSET + i * FAT_ENTRY_BYTES, sector, true);
  }

  // Sector N begins at (N + 1) * SECTOR_SIZE, the header occupying the first.
  const sectorOffset = (sector: number): number => (sector + 1) * SECTOR_SIZE;

  fat.forEach((entry, i) => {
    view.setUint32(sectorOffset(0) + i * FAT_ENTRY_BYTES, entry, true);
  });

  const writeDirectoryEntry = (
    id: number,
    name: string,
    objectType: number,
    childId: number,
    rightId: number,
    startSector: number,
    size: number,
  ): void => {
    const at = sectorOffset(firstDirectorySector) + id * DIRECTORY_ENTRY_SIZE;
    for (const [i, char] of [...name].entries()) {
      view.setUint16(at + i * 2, char.charCodeAt(0), true);
    }
    view.setUint16(
      at + DIRECTORY_ENTRY_NAME_LENGTH_OFFSET,
      name.length * 2 + 2,
      true,
    );
    view.setUint8(at + DIRECTORY_ENTRY_OBJECT_TYPE_OFFSET, objectType);
    view.setUint8(at + DIRECTORY_ENTRY_COLOR_FLAG_OFFSET, 1); // colour flag, meaningless to a structural reader
    // Left sibling: always NOSTREAM, every byte 0xff, byte-symmetric under either byte order.
    file.fill(
      NOSTREAM_FILL_BYTE,
      at + DIRECTORY_ENTRY_LEFT_SIBLING_OFFSET,
      at + DIRECTORY_ENTRY_RIGHT_SIBLING_OFFSET,
    );
    view.setUint32(at + DIRECTORY_ENTRY_RIGHT_SIBLING_OFFSET, rightId, true);
    view.setUint32(at + DIRECTORY_ENTRY_CHILD_ID_OFFSET, childId, true);
    view.setUint32(at + DIRECTORY_ENTRY_START_SECTOR_OFFSET, startSector, true);
    view.setUint32(at + DIRECTORY_ENTRY_STREAM_SIZE_OFFSET, size, true);
    // The stream size's high dword (at + 0x7c) wants 0, which `file` already holds — no write needed.
  };

  writeDirectoryEntry(
    0,
    "Root Entry",
    OBJECT_TYPE_ROOT,
    streams.length > 0 ? 1 : NOSTREAM,
    NOSTREAM,
    ENDOFCHAIN,
    0,
  );
  for (const [index, stream] of streams.entries()) {
    const id = index + 1;
    const start = streamStarts[index] ?? 0;
    writeDirectoryEntry(
      id,
      stream.name,
      OBJECT_TYPE_STREAM,
      NOSTREAM,
      index + 1 < streams.length ? id + 1 : NOSTREAM,
      start,
      stream.bytes.length,
    );
    file.set(stream.bytes, sectorOffset(start));
  }
  return file;
}
