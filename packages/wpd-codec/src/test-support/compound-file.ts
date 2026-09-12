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

function writeDirectoryEntry(
  directory: Uint8Array,
  id: number,
  name: string,
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
  for (const [index, character] of [...name].entries()) {
    view.setUint16(index * 2, character.charCodeAt(0), true);
  }
  view.setUint16(0x40, name.length * 2 + 2, true);
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

export function compoundFileWithStream(
  name: string,
  stream: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const inMiniStream = stream.length < MINI_STREAM_CUTOFF;

  const miniStream = inMiniStream
    ? new Uint8Array(
        sectorsFor(stream.length, MINI_SECTOR_SIZE) * MINI_SECTOR_SIZE,
      )
    : new Uint8Array(0);
  miniStream.set(inMiniStream ? stream : new Uint8Array(0));

  const directorySectorCount = 1;
  const bigStreamSectorCount = inMiniStream
    ? 0
    : sectorsFor(stream.length, SECTOR_SIZE);
  const miniStreamSectorCount = sectorsFor(miniStream.length, SECTOR_SIZE);
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
  writeDirectoryEntry(
    directory,
    0,
    "",
    5,
    1,
    miniStream.length === 0 ? ENDOFCHAIN : miniStreamStart,
    miniStream.length,
  );
  writeDirectoryEntry(
    directory,
    1,
    name,
    2,
    NOSTREAM,
    inMiniStream ? 0 : bigStreamStart,
    stream.length,
  );

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
  if (inMiniStream) {
    putSector(miniStreamStart, miniStream);
  } else {
    putSector(bigStreamStart, stream);
  }
  if (inMiniStream) {
    const miniSectorCount = sectorsFor(stream.length, MINI_SECTOR_SIZE);
    const miniFat = new Uint32Array(SECTOR_SIZE / 4).fill(FREESECT);
    writeChain(miniFat, 0, miniSectorCount);
    putSector(miniFatStart, new Uint8Array(miniFat.buffer));
  }
  return file;
}
