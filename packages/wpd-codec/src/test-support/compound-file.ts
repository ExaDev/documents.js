// A minimal [MS-CFB] compound file carrying exactly one root-level stream, for exercising the WP7-and-later container path against archive-codec's real reader rather than a stub.
//
// Deliberately narrow: WordPerfect's wrapper puts the document in one root-level stream named PerfectOffice_MAIN, so one stream is the whole shape this package's tests need. archive-codec has a general fixture builder of its own, but its src/test-support is excluded from the published dist (as this one is), so it is not importable from here -- and reproducing 380 lines of general storage-tree, DIFAT, and multi-sector machinery to place one stream at the root would be the larger thing, not the smaller one.
//
// Version 3 geometry throughout: 512-byte sectors, 64-byte mini sectors, the 4096-byte mini-stream cutoff, and the DIFAT entirely inside the header's 109-entry array. Sector N begins at file offset (N + 1) * 512, since the 512-byte header occupies the region before sector 0.

const SECTOR_SIZE = 512;
const MINI_SECTOR_SIZE = 64;
const MINI_STREAM_CUTOFF = 4096;
const DIRECTORY_ENTRY_SIZE = 128;
const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const FATSECT = 0xfffffffd;
const NOSTREAM = 0xffffffff;
const DIFAT_ENTRY_COUNT = 109;

function sectorsFor(byteLength: number, sectorSize: number): number {
  return Math.ceil(byteLength / sectorSize);
}

function writeChain(table: Uint32Array, start: number, count: number): void {
  Array.from({ length: count }, (_, offset) => offset).forEach((offset) => {
    table[start + offset] =
      offset === count - 1 ? ENDOFCHAIN : start + offset + 1;
  });
}

// The fields every directory entry carries regardless of its own name: object type, sibling/child links (this fixture's two entries are unrelated siblings, so both left and right stay NOSTREAM's own 0xFF fill), child id, start sector, and size. Name and name-length are deliberately NOT written here: archive-codec's own reader (src/cfb/read.ts) only validates and reads an entry's name/nameLength once the directory tree walk reaches it via root.child, and the root entry itself (id 0) is read directly as entries[0] without ever entering that walk -- "its own name is the 'Root Entry' convention and nothing depends on it" -- so the root is the one caller with no real name value to write, and every non-root caller writes its own name separately, after this.
function writeDirectoryEntryFields(
  directory: Uint8Array,
  id: number,
  objectType: number,
  childId: number,
  startSector: number,
  size: number,
): void {
  const entryOffset = id * DIRECTORY_ENTRY_SIZE;
  const view = new DataView(
    directory.buffer,
    directory.byteOffset + entryOffset,
    DIRECTORY_ENTRY_SIZE,
  );
  view.setUint8(0x42, objectType);
  new Uint8Array(
    directory.buffer,
    directory.byteOffset + entryOffset + 0x44,
    8,
  ).fill(0xff);
  view.setUint32(0x4c, childId, true);
  view.setUint32(0x74, startSector, true);
  view.setUint32(0x78, size, true);
}

// The name and its own length field, per [MS-CFB] 2.6.1: only a non-root entry's name is ever read back (see writeDirectoryEntryFields' own comment), so this is called for every entry except the root.
function writeDirectoryEntryName(
  directory: Uint8Array,
  id: number,
  name: string,
): void {
  const entryOffset = id * DIRECTORY_ENTRY_SIZE;
  const view = new DataView(
    directory.buffer,
    directory.byteOffset + entryOffset,
    DIRECTORY_ENTRY_SIZE,
  );
  for (const [index, character] of [...name].entries()) {
    view.setUint16(index * 2, character.charCodeAt(0), true);
  }
  view.setUint16(0x40, name.length * 2 + 2, true);
}

export function compoundFileWithStream(
  name: string,
  stream: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const inMiniStream = stream.length < MINI_STREAM_CUTOFF;

  // The mini stream area's own declared pool size, per [MS-CFB]'s own mini-sector granularity: archive-codec's reader (src/cfb/read.ts) carves each entry's own mini-sectors out of a pool bounded by exactly this many bytes (the root entry's own `size` field), so it must be rounded up to a whole number of 64-byte mini sectors even though the real stream data inside it is shorter -- a pool declared only as large as the raw stream would undercount the mini-sector chain by one whenever the stream's own length is not itself a multiple of MINI_SECTOR_SIZE.
  const miniStreamPoolSize = inMiniStream
    ? sectorsFor(stream.length, MINI_SECTOR_SIZE) * MINI_SECTOR_SIZE
    : 0;

  const directorySectorCount = 1;
  const bigStreamSectorCount = inMiniStream
    ? 0
    : sectorsFor(stream.length, SECTOR_SIZE);
  const miniStreamSectorCount = sectorsFor(miniStreamPoolSize, SECTOR_SIZE);
  const miniFatSectorCount = inMiniStream ? 1 : 0;
  const fatSectorCount = 1;

  const regionSizes = [
    fatSectorCount,
    directorySectorCount,
    bigStreamSectorCount,
    miniStreamSectorCount,
    miniFatSectorCount,
  ];
  const regionStarts = regionSizes.reduce<number[]>(
    (starts, size) => [...starts, (starts.at(-1) ?? 0) + size],
    [0],
  );
  const [
    ,
    ,
    bigStreamStart = 0,
    miniStreamStart = 0,
    miniFatStart = 0,
    totalSectors = 0,
  ] = regionStarts;

  const fat = new Uint32Array(SECTOR_SIZE / 4).fill(FREESECT);
  fat[0] = FATSECT;
  writeChain(fat, fatSectorCount, directorySectorCount);
  writeChain(fat, bigStreamStart, bigStreamSectorCount);
  writeChain(fat, miniStreamStart, miniStreamSectorCount);
  writeChain(fat, miniFatStart, miniFatSectorCount);

  const directory = new Uint8Array(directorySectorCount * SECTOR_SIZE);
  writeDirectoryEntryFields(
    directory,
    0,
    5,
    1,
    miniStreamPoolSize === 0 ? ENDOFCHAIN : miniStreamStart,
    miniStreamPoolSize,
  );
  writeDirectoryEntryFields(
    directory,
    1,
    2,
    NOSTREAM,
    inMiniStream ? 0 : bigStreamStart,
    stream.length,
  );
  writeDirectoryEntryName(directory, 1, name);

  const file = new Uint8Array(SECTOR_SIZE + totalSectors * SECTOR_SIZE);
  const view = new DataView(file.buffer);
  file.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  view.setUint16(0x1a, 3, true);
  view.setUint16(0x1c, 0xfffe, true);
  view.setUint16(0x1e, 9, true);
  view.setUint16(0x20, 6, true);
  view.setUint32(0x30, fatSectorCount, true);
  view.setUint32(0x38, MINI_STREAM_CUTOFF, true);
  view.setUint32(0x3c, inMiniStream ? miniFatStart : ENDOFCHAIN, true);
  view.setUint32(0x44, ENDOFCHAIN, true);

  const difat = new Uint32Array(file.buffer, 0x4c, DIFAT_ENTRY_COUNT);
  difat.fill(FREESECT);
  difat[0] = 0;

  const putSector = (sector: number, bytes: Uint8Array): void => {
    file.set(bytes, SECTOR_SIZE + sector * SECTOR_SIZE);
  };
  putSector(0, new Uint8Array(fat.buffer));
  putSector(fatSectorCount, directory);
  // Written unconditionally at bigStreamStart, in the mini-stream case too: bigStreamSectorCount is 0 whenever inMiniStream, which makes bigStreamStart and miniStreamStart the very same region start (the cumulative region-size walk above never advances between them), and file's own backing buffer starts fully zeroed, so writing the raw, unpadded stream there lands on exactly the same bytes a separately zero-padded copy would have -- the trailing pad bytes miniStreamPoolSize declares are already zero either way.
  putSector(bigStreamStart, stream);
  if (inMiniStream) {
    const miniSectorCount = sectorsFor(stream.length, MINI_SECTOR_SIZE);
    const miniFat = new Uint32Array(SECTOR_SIZE / 4).fill(FREESECT);
    writeChain(miniFat, 0, miniSectorCount);
    putSector(miniFatStart, new Uint8Array(miniFat.buffer));
  }
  return file;
}
