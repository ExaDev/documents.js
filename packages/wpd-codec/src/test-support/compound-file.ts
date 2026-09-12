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
  // Stryker disable next-line EqualityOperator: one extra iteration reads name.charCodeAt(name.length), which is NaN for any string -- DataView.setUint16 coerces a NaN value to 0 (ECMA-262 ToUint16), the same value the directory's own zero-initialised buffer already holds at that position, so the extra write changes nothing.
  for (let index = 0; index < name.length; index += 1) {
    view.setUint16(index * 2, name.charCodeAt(index), true);
  }
  // The zero pair past the last character is the terminating null this length counts.
  view.setUint16(0x40, name.length * 2 + 2, true);
  view.setUint8(0x42, objectType);
  // Stryker disable next-line CallExpression: archive-codec's own reader (src/cfb/read.ts) reads only offset 0x42 (objectType) from a directory entry; the colour flag at 0x43 is a red-black tree balancing hint the [MS-CFB] spec itself says a reader need not act on, and this reader never reads it.
  view.setUint8(0x43, 1); // colour flag: black, meaningless to a structural reader
  // Stryker disable next-line BooleanLiteral: NOSTREAM (0xFFFFFFFF) has identical bytes in either byte order, so which endianness this claims to use is unobservable for this specific value.
  view.setUint32(0x44, NOSTREAM, true); // left sibling
  // Stryker disable next-line BooleanLiteral: same reasoning as the left sibling immediately above.
  view.setUint32(0x48, NOSTREAM, true); // right sibling
  view.setUint32(0x4c, childId, true);
  view.setUint32(0x74, startSector, true);
  view.setUint32(0x78, size, true);
  // Stryker disable next-line BooleanLiteral: value 0 has identical (all-zero) bytes in either byte order.
  view.setUint32(0x7c, 0, true);
}

export function compoundFileWithStream(
  name: string,
  stream: Uint8Array,
): Uint8Array<ArrayBuffer> {
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
  // Stryker disable next-line ArithmeticOperator: whenever the mini stream is actually used (miniStream.length > 0, the only case anything ever reads from miniStreamStart), bigStreamSectorCount is always 0 by construction just above, so + and - agree; when the mini stream is unused (length 0), nothing ever reads this value at all (see the miniStream.length > 0 guard around putSector below).
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
  // Stryker disable next-line EqualityOperator: an extra iteration at index === count writes fat[start + count] = start + count + 1. For every call below but the last, start + count is exactly the next call's own start, and that next call's own first write (index 0) computes the identical value (next_start + 0 + 1 = start + count + 1) -- the stray write is always overwritten by the real one immediately after it. For the last call (miniFatStart), the corresponding slot is never referenced by any directory entry's own startSector, so nothing ever reads it either way.
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
    // Stryker disable next-line EqualityOperator: an extra iteration writes miniFat[miniSectorCount], but the real chain already ends one slot earlier with ENDOFCHAIN, so a reader walking it from the stream's own start sector stops before ever reaching this slot.
    for (let index = 0; index < miniSectorCount; index += 1) {
      miniFat[index] = index === miniSectorCount - 1 ? ENDOFCHAIN : index + 1;
    }
  }

  const directory = new Uint8Array(directorySectorCount * SECTOR_SIZE);
  // Stryker disable next-line StringLiteral: archive-codec's reader identifies the root entry solely by object type (5, checked below), never by name -- [MS-CFB] 2.6.1 fixes the name to "Root Entry" for producers, but nothing here reads it back.
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
  // Stryker disable next-line BooleanLiteral: the minor version is never read by archive-codec's reader (only major version, at 0x1a, gates anything), so which byte order this claims to write it in is unobservable.
  view.setUint16(0x18, 0x3e, true); // minor version, the value real producers write
  view.setUint16(0x1a, 3, true); // major version
  view.setUint16(0x1c, 0xfffe, true); // little-endian byte order
  view.setUint16(0x1e, 9, true); // sector shift: 2^9 = 512
  view.setUint16(0x20, 6, true); // mini sector shift: 2^6 = 64
  view.setUint32(0x28, 0, true); // directory sector count: fixed at 0 for version 3
  // Stryker disable next-line BooleanLiteral: the reader locates every FAT sector through the DIFAT array (0x4C onward) and its own chain, never through this declared count, so this field is never read back.
  view.setUint32(0x2c, fatSectorCount, true);
  view.setUint32(0x30, fatSectorCount, true);
  view.setUint32(0x38, MINI_STREAM_CUTOFF, true);
  view.setUint32(0x3c, inMiniStream ? miniFatStart : ENDOFCHAIN, true);
  // Stryker disable next-line BooleanLiteral: the reader walks the mini FAT chain from firstMiniFatSector until it hits ENDOFCHAIN, never consulting a declared sector count, so this field is never read back.
  view.setUint32(0x40, miniFatSectorCount, true);
  view.setUint32(0x44, ENDOFCHAIN, true); // first DIFAT sector: none needed
  // Stryker disable next-line BooleanLiteral: value 0 has identical (all-zero) bytes in either byte order, and this field (a declared DIFAT sector count) is never read back regardless.
  view.setUint32(0x48, 0, true);
  // Stryker disable next-line EqualityOperator,ConditionalExpression: an extra iteration (or the loop never running at all) only ever changes entries that are already, or become, indistinguishable to the reader from entry 0's own real value -- see the two mutants on the ternary just below for the full proof; between the two together, every input this loop can produce collects the identical single real FAT sector (0) into fatSectorIds, however many times, which the reader then treats identically to collecting it once.
  for (let index = 0; index < 109; index += 1) {
    // Stryker disable next-line ConditionalExpression,EqualityOperator: "true" (every entry becomes 0) reduces to the same "all entries name sector 0" case the loop-bound mutants above already cover; "index !== 0" (entry 0 becomes FREESECT, every other entry becomes 0) still leaves fatSectorIds naming only sector 0, repeated, which the reader's own flat FAT table construction collapses back to the identical real content regardless of how many times sector 0 is named.
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
