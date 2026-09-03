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

function sectorsFor(byteLength: number, sectorSize: number): number {
  return Math.ceil(byteLength / sectorSize);
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
  const view = new DataView(
    directory.buffer,
    directory.byteOffset + id * DIRECTORY_ENTRY_SIZE,
    DIRECTORY_ENTRY_SIZE,
  );
  for (let index = 0; index < name.length; index += 1) {
    view.setUint16(index * 2, name.charCodeAt(index), true);
  }
  // The zero pair past the last character is the terminating null this length counts.
  view.setUint16(0x40, name.length * 2 + 2, true);
  view.setUint8(0x42, objectType);
  view.setUint8(0x43, 1); // colour flag: black, meaningless to a structural reader
  view.setUint32(0x44, NOSTREAM, true); // left sibling
  view.setUint32(0x48, NOSTREAM, true); // right sibling
  view.setUint32(0x4c, childId, true);
  view.setUint32(0x74, startSector, true);
  view.setUint32(0x78, size, true);
  view.setUint32(0x7c, 0, true);
}

export function compoundFileWithStream(
  name: string,
  stream: Uint8Array,
): Uint8Array {
  const inMiniStream = stream.length < MINI_STREAM_CUTOFF;

  // The mini stream is every small stream padded to whole mini sectors and concatenated; here that is the one stream.
  const miniStream = inMiniStream
    ? new Uint8Array(
        sectorsFor(stream.length, MINI_SECTOR_SIZE) * MINI_SECTOR_SIZE,
      )
    : new Uint8Array(0);
  miniStream.set(inMiniStream ? stream : new Uint8Array(0));

  const directorySectorCount = 1; // two entries fit one 512-byte sector
  const bigStreamSectorCount = inMiniStream
    ? 0
    : sectorsFor(stream.length, SECTOR_SIZE);
  const miniStreamSectorCount = sectorsFor(miniStream.length, SECTOR_SIZE);
  const miniFatSectorCount = inMiniStream ? 1 : 0;
  const fatSectorCount = 1; // one FAT sector maps 128 sectors, far more than this file uses

  const bigStreamStart = fatSectorCount + directorySectorCount;
  const miniStreamStart = bigStreamStart + bigStreamSectorCount;
  const miniFatStart = miniStreamStart + miniStreamSectorCount;
  const totalSectors =
    fatSectorCount +
    directorySectorCount +
    bigStreamSectorCount +
    miniStreamSectorCount +
    miniFatSectorCount;

  const fat = new Uint32Array(SECTOR_SIZE / 4).fill(FREESECT);
  fat[0] = FATSECT;
  const chain = (start: number, count: number): void => {
    for (let index = 0; index < count; index += 1) {
      fat[start + index] = index === count - 1 ? ENDOFCHAIN : start + index + 1;
    }
  };
  chain(fatSectorCount, directorySectorCount);
  chain(bigStreamStart, bigStreamSectorCount);
  chain(miniStreamStart, miniStreamSectorCount);
  chain(miniFatStart, miniFatSectorCount);

  const miniFat = new Uint32Array(SECTOR_SIZE / 4).fill(FREESECT);
  if (inMiniStream) {
    const miniSectorCount = sectorsFor(stream.length, MINI_SECTOR_SIZE);
    for (let index = 0; index < miniSectorCount; index += 1) {
      miniFat[index] = index === miniSectorCount - 1 ? ENDOFCHAIN : index + 1;
    }
  }

  const directory = new Uint8Array(directorySectorCount * SECTOR_SIZE);
  writeDirectoryEntry(
    directory,
    0,
    "Root Entry",
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
  view.setUint16(0x18, 0x3e, true); // minor version, the value real producers write
  view.setUint16(0x1a, 3, true); // major version
  view.setUint16(0x1c, 0xfffe, true); // little-endian byte order
  view.setUint16(0x1e, 9, true); // sector shift: 2^9 = 512
  view.setUint16(0x20, 6, true); // mini sector shift: 2^6 = 64
  view.setUint32(0x28, 0, true); // directory sector count: fixed at 0 for version 3
  view.setUint32(0x2c, fatSectorCount, true);
  view.setUint32(0x30, fatSectorCount, true);
  view.setUint32(0x38, MINI_STREAM_CUTOFF, true);
  view.setUint32(0x3c, inMiniStream ? miniFatStart : ENDOFCHAIN, true);
  view.setUint32(0x40, miniFatSectorCount, true);
  view.setUint32(0x44, ENDOFCHAIN, true); // first DIFAT sector: none needed
  view.setUint32(0x48, 0, true);
  for (let index = 0; index < 109; index += 1) {
    view.setUint32(0x4c + index * 4, index === 0 ? 0 : FREESECT, true);
  }

  const putSector = (sector: number, bytes: Uint8Array): void => {
    file.set(bytes, SECTOR_SIZE + sector * SECTOR_SIZE);
  };
  putSector(0, new Uint8Array(fat.buffer));
  putSector(fatSectorCount, directory);
  if (!inMiniStream) {
    putSector(bigStreamStart, stream);
  }
  if (miniStream.length > 0) {
    putSector(miniStreamStart, miniStream);
  }
  if (inMiniStream) {
    putSector(miniFatStart, new Uint8Array(miniFat.buffer));
  }
  return file;
}
