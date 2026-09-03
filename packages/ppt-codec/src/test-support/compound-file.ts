// A minimal [MS-CFB] compound-file writer for this package's own end-to-end test: given flat stream names and their bytes, it emits a real version-3 compound file that archive-codec's reader parses, so the read path can be exercised from a file's first byte rather than from streams handed to it. It is deliberately narrower than archive-codec's own test builder (which the family convention already duplicates per package rather than publishing): no nested storages, and every stream lives in FAT-chained sectors because the header declares the smallest legal mini-stream cutoff, which removes the mini-FAT from the layout entirely. [MS-CFB] 2.2 Compound File Header, 2.6.1 Compound File Directory Entry: https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/53989ce4-7b05-4f8d-829b-d08d6148375b
//
// Test-support only: excluded from the published dist per the family convention.

const SECTOR_SIZE = 512;
const HEADER_SIZE = 512;
const DIRECTORY_ENTRY_SIZE = 128;
const ENTRIES_PER_DIRECTORY_SECTOR = SECTOR_SIZE / DIRECTORY_ENTRY_SIZE;
const FAT_ENTRIES_PER_SECTOR = SECTOR_SIZE / 4;
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
  for (let i = 0; i < fatSectors; i++) {
    fat[i] = FATSECT;
  }
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
  file.set(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 0);
  view.setUint16(0x18, 0x003e, true); // minorVersion
  view.setUint16(0x1a, 3, true); // majorVersion
  view.setUint16(0x1c, 0xfffe, true); // little-endian byte order mark
  view.setUint16(0x1e, 9, true); // sectorShift: 512-byte sectors
  view.setUint16(0x20, MINI_SECTOR_SHIFT, true);
  view.setUint32(0x2c, fatSectors, true);
  view.setUint32(0x30, firstDirectorySector, true);
  view.setUint32(0x38, MINI_STREAM_CUTOFF, true);
  view.setUint32(0x3c, ENDOFCHAIN, true); // firstMiniFatSector
  view.setUint32(0x40, 0, true); // miniFatSectorCount
  view.setUint32(0x44, ENDOFCHAIN, true); // firstDifatSector
  view.setUint32(0x48, 0, true); // difatSectorCount
  for (let i = 0; i < HEADER_DIFAT_ENTRIES; i++) {
    view.setUint32(0x4c + i * 4, i < fatSectors ? i : FREESECT, true);
  }

  // Sector N begins at (N + 1) * SECTOR_SIZE, the header occupying the first.
  const sectorOffset = (sector: number): number => (sector + 1) * SECTOR_SIZE;

  for (let i = 0; i < fat.length; i++) {
    view.setUint32(sectorOffset(0) + i * 4, fat[i] ?? FREESECT, true);
  }

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
    for (let i = 0; i < name.length; i++) {
      view.setUint16(at + i * 2, name.charCodeAt(i), true);
    }
    view.setUint16(at + 0x40, name.length * 2 + 2, true);
    view.setUint8(at + 0x42, objectType);
    view.setUint8(at + 0x43, 1); // colour flag, meaningless to a structural reader
    view.setUint32(at + 0x44, NOSTREAM, true); // left sibling
    view.setUint32(at + 0x48, rightId, true);
    view.setUint32(at + 0x4c, childId, true);
    view.setUint32(at + 0x74, startSector, true);
    view.setUint32(at + 0x78, size, true);
    view.setUint32(at + 0x7c, 0, true); // the stream size's high dword
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
