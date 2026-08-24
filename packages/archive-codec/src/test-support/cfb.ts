// A hand-built minimal [MS-CFB] compound-file writer for the reader's tests (ooxml.js's embedded-payload fixtures mirror this layout in their own test-support): given slash-separated stream paths and their bytes, it emits a genuine compound file -- version 3 (512-byte sectors) by default, version 4 (4096-byte sectors, the 512-byte header zero-padded out to the full sector-sized header region) via the majorVersion option -- always with the 4096-byte mini-stream cutoff and 64-byte mini sectors both versions mandate, whose header, DIFAT, FAT, directory, and mini-FAT the reader under test must parse to get the streams back.
//
// Construction, in the order the bytes are laid out:
//
// 1. Storage tree: each entry's path splits on '/'; intermediate segments become storage entries (directory object type 1), the last segment the stream entry (type 2). Entry IDs are assigned root-first then depth-first in the given order; the root storage entry (type 5, name "Root Entry") is always ID 0, as [MS-CFB] 2.6.1 requires of the first directory entry.
// 2. Sector layout, in order: FAT sectors, then directory sectors (4 entries per 512-byte sector), then the FAT-resident streams' data sectors, then the mini stream's sectors, then the mini-FAT sector(s). The FAT-sector count reaches a fixed point against the total sector count, because each FAT sector maps 128 sectors including itself.
// 3. Streams shorter than the cutoff live in the mini stream: every small stream is zero-padded to a whole number of 64-byte mini sectors, and the small streams concatenate into one byte string stored as the root entry's own stream (its starting sector and size), carved up by the mini-FAT's chains. Streams at or above the cutoff occupy whole FAT-chained sectors of their own.
// 4. The directory tree links a storage's children as a right-sibling chain (the storage's child points at the first, each child's right sibling at the next). [MS-CFB] recommends producers order and balance the sibling tree by name; that is a recommendation about tree shape, not a reader requirement, and this writer deliberately skips it -- the reader under test traverses left/right/child structurally, exactly as real-world readers must for the unbalanced trees real producers emit.
// 5. FAT marking: FAT sectors are FATSECT (0xFFFFFFFD); the directory, mini-stream, and mini-FAT sectors and every big stream's sectors chain with ENDOFCHAIN (0xFFFFFFFE) terminators; unused entries are FREESECT (0xFFFFFFFF). The DIFAT lives entirely in the header's 109-entry array (no DIFAT sectors), so FirstDIFATSectorLocation is ENDOFCHAIN.
//
// Test-support only: excluded from the published dist per the family convention, and names are limited to ASCII of at most 31 characters (the directory entry's 64-byte UTF-16 name field including its null terminator).

export interface CompoundFileEntrySpec {
  readonly path: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

export interface CompoundFileOptions {
  readonly majorVersion?: 3 | 4;
}

interface StorageNode {
  readonly name: string;
  readonly children: StorageNode[];
  stream?: Uint8Array<ArrayBuffer>;
}

interface DirectoryRecord {
  readonly node: StorageNode;
  readonly id: number;
  rightId: number;
}

/** A directory record whose node genuinely carries a stream, so reads of it need no absent case. */
interface StreamRecord extends DirectoryRecord {
  readonly node: StorageNode & { stream: Uint8Array<ArrayBuffer> };
}

function hasStream(record: DirectoryRecord): record is StreamRecord {
  return record.node.stream !== undefined;
}

const MINI_SECTOR_SIZE = 64;
const MINI_STREAM_CUTOFF = 4096;
const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const FATSECT = 0xfffffffd;
const NOSTREAM = 0xffffffff;

const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

function put16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function put32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

function checkedName(node: StorageNode): Uint8Array<ArrayBuffer> {
  const encoded = enc(node.name);
  if (
    node.name.length === 0 ||
    encoded.length > 31 ||
    encoded.some((byte) => byte > 0x7f)
  ) {
    throw new Error(
      `compoundFile stream/storage names must be non-empty ASCII of at most 31 characters (got ${JSON.stringify(node.name)})`,
    );
  }
  return encoded;
}

function writeDirectoryEntry(
  entry: DataView,
  node: StorageNode,
  objectType: number,
  childId: number,
  rightId: number,
  startSector: number,
  size: number,
): void {
  const encoded = checkedName(node);
  for (let i = 0; i < encoded.length; i++) {
    entry.setUint8(i * 2, encoded[i] ?? 0);
    entry.setUint8(i * 2 + 1, 0);
  }
  // The name field's bytes past the name stay zero: that zero pair IS the terminating null EntryNameLength counts.
  put16(entry, 0x40, encoded.length * 2 + 2);
  entry.setUint8(0x42, objectType);
  entry.setUint8(0x43, 1); // colour flag: black -- meaningless to a structural reader
  put32(entry, 0x44, NOSTREAM);
  put32(entry, 0x48, rightId);
  put32(entry, 0x4c, childId);
  put32(entry, 0x74, startSector);
  put32(entry, 0x78, size);
  put32(entry, 0x7c, 0);
}

function padToMultiple(
  bytes: Uint8Array<ArrayBuffer>,
  multiple: number,
): Uint8Array<ArrayBuffer> {
  const padded = new Uint8Array(Math.ceil(bytes.length / multiple) * multiple);
  padded.set(bytes);
  return padded;
}

// Builds the compound file for the given entries (version 3 unless majorVersion names 4). Stream order and storage layout are deterministic (input order), so identical inputs produce byte-identical files.
export function compoundFile(
  entries: readonly CompoundFileEntrySpec[],
  options: CompoundFileOptions = {},
): Uint8Array<ArrayBuffer> {
  // Sector geometry is the version's own: 512-byte sectors for version 3, 4096 for version 4 -- whose 512-byte header the file zero-pads out to the full first sector ([MS-CFB] 2.2), so sector N always starts at (N + 1) * sectorSize, never 512 + N * sectorSize.
  const majorVersion = options.majorVersion ?? 3;
  const sectorSize = majorVersion === 4 ? 4096 : 512;
  const sectorShift = majorVersion === 4 ? 12 : 9;
  const entriesPerDirectorySector = sectorSize / 128;
  const fatEntriesPerSector = sectorSize / 4;

  const root: StorageNode = { name: "", children: [] };
  for (const entry of entries) {
    const segments = entry.path.split("/");
    const leaf = segments.pop();
    if (
      leaf === undefined ||
      leaf.length === 0 ||
      segments.some((segment) => segment.length === 0)
    ) {
      throw new Error(
        `compoundFile entry paths must be slash-separated with no empty segments (got ${JSON.stringify(entry.path)})`,
      );
    }
    let node = root;
    for (const segment of segments) {
      let child = node.children.find(
        (candidate) =>
          candidate.name === segment && candidate.stream === undefined,
      );
      if (child === undefined) {
        child = { name: segment, children: [] };
        node.children.push(child);
      }
      node = child;
    }
    if (node.children.some((candidate) => candidate.name === leaf)) {
      throw new Error(
        `compoundFile entry path used twice (got ${JSON.stringify(entry.path)})`,
      );
    }
    node.children.push({ name: leaf, children: [], stream: entry.bytes });
  }

  // Directory entry IDs: the root is 0, then depth-first in insertion order.
  const records: DirectoryRecord[] = [];
  const recordOf = new Map<StorageNode, DirectoryRecord>();
  const record = (node: StorageNode): DirectoryRecord => {
    const created: DirectoryRecord = {
      node,
      id: records.length,
      rightId: NOSTREAM,
    };
    records.push(created);
    recordOf.set(node, created);
    for (const child of node.children) {
      record(child);
    }
    return created;
  };
  record(root);
  // Sibling chains: each storage's children link right, one to the next.
  for (const { node } of records) {
    for (let i = 0; i < node.children.length; i++) {
      const childRecord = recordOf.get(node.children[i] ?? node);
      const next = node.children[i + 1];
      if (childRecord !== undefined) {
        childRecord.rightId =
          next === undefined ? NOSTREAM : (recordOf.get(next)?.id ?? NOSTREAM);
      }
    }
  }

  // Narrowed through a type predicate rather than a boolean one, because `filter` with a boolean callback leaves the element type alone: the two partitions below would still carry `stream?: Uint8Array` even though the predicate is exactly what rules the absent case out, and every later read would need a fallback that can never be taken.
  const smallStreamRecords = records
    .filter(hasStream)
    .filter(({ node }) => node.stream.length < MINI_STREAM_CUTOFF);
  const bigStreamRecords = records
    .filter(hasStream)
    .filter(({ node }) => node.stream.length >= MINI_STREAM_CUTOFF);

  // The mini stream: every small stream padded to whole mini sectors, concatenated; each stream's start is its first mini sector's index.
  const miniChunks = smallStreamRecords.map(({ node }) =>
    padToMultiple(node.stream, MINI_SECTOR_SIZE),
  );
  const miniStream = new Uint8Array(
    miniChunks.reduce((total, chunk) => total + chunk.length, 0),
  );
  let miniOffset = 0;
  const miniStartOf = new Map<number, number>();
  for (let i = 0; i < smallStreamRecords.length; i++) {
    miniStartOf.set(
      smallStreamRecords[i]?.id ?? -1,
      miniOffset / MINI_SECTOR_SIZE,
    );
    miniStream.set(miniChunks[i] ?? new Uint8Array(0), miniOffset);
    miniOffset += miniChunks[i]?.length ?? 0;
  }
  const miniSectorCount = miniStream.length / MINI_SECTOR_SIZE;

  const bigSectorCounts = bigStreamRecords.map(({ node }) =>
    Math.ceil(node.stream.length / sectorSize),
  );
  const directorySectorCount = Math.ceil(
    records.length / entriesPerDirectorySector,
  );
  const miniStreamSectorCount = Math.ceil(miniStream.length / sectorSize);
  const miniFatSectorCount =
    miniSectorCount === 0
      ? 0
      : Math.ceil(miniSectorCount / fatEntriesPerSector);
  const dataSectorCount = bigSectorCounts.reduce(
    (total, count) => total + count,
    0,
  );
  // FAT-sector fixed point: the FAT sectors must between them map every sector of the file, themselves included.
  let fatSectorCount = 1;
  let totalSectors: number;
  for (;;) {
    totalSectors =
      fatSectorCount +
      directorySectorCount +
      dataSectorCount +
      miniStreamSectorCount +
      miniFatSectorCount;
    const needed = Math.max(1, Math.ceil(totalSectors / fatEntriesPerSector));
    if (needed === fatSectorCount) {
      break;
    }
    fatSectorCount = needed;
  }

  // Sector allocation in layout order.
  const fatSectors: number[] = [];
  for (let i = 0; i < fatSectorCount; i++) {
    fatSectors.push(i);
  }
  const directoryStart = fatSectorCount;
  let nextSector = directoryStart + directorySectorCount;
  const bigStartOf = new Map<number, number>();
  for (let i = 0; i < bigStreamRecords.length; i++) {
    bigStartOf.set(bigStreamRecords[i]?.id ?? -1, nextSector);
    nextSector += bigSectorCounts[i] ?? 0;
  }
  const miniStreamStart = nextSector;
  nextSector += miniStreamSectorCount;
  const miniFatStart = nextSector;

  const fat = new Uint32Array(fatSectorCount * fatEntriesPerSector).fill(
    FREESECT,
  );
  const chain = (start: number, count: number): void => {
    for (let i = 0; i < count; i++) {
      fat[start + i] = i === count - 1 ? ENDOFCHAIN : start + i + 1;
    }
  };
  for (const sector of fatSectors) {
    fat[sector] = FATSECT;
  }
  chain(directoryStart, directorySectorCount);
  for (let i = 0; i < bigStreamRecords.length; i++) {
    chain(
      bigStartOf.get(bigStreamRecords[i]?.id ?? -1) ?? 0,
      bigSectorCounts[i] ?? 0,
    );
  }
  chain(miniStreamStart, miniStreamSectorCount);
  chain(miniFatStart, miniFatSectorCount);

  // The mini-FAT: one chain per small stream over its run of consecutive mini sectors.
  const miniFat = new Uint32Array(
    miniFatSectorCount * fatEntriesPerSector,
  ).fill(FREESECT);
  for (const { id, node } of smallStreamRecords) {
    const start = miniStartOf.get(id) ?? 0;
    const count = Math.ceil(node.stream.length / MINI_SECTOR_SIZE);
    for (let j = 0; j < count; j++) {
      miniFat[start + j] = j === count - 1 ? ENDOFCHAIN : start + j + 1;
    }
  }

  // Directory sectors: entry n sits at byte n * 128 of the concatenated chain.
  const directory = new Uint8Array(directorySectorCount * sectorSize);
  for (const { node, id, rightId } of records) {
    const entry = new DataView(directory.buffer, id * 128, 128);
    const childId =
      node.children.length === 0
        ? NOSTREAM
        : (recordOf.get(node.children[0] ?? node)?.id ?? NOSTREAM);
    if (node === root) {
      const start = miniStream.length === 0 ? ENDOFCHAIN : miniStreamStart;
      writeDirectoryEntry(
        entry,
        { ...node, name: "Root Entry" },
        5,
        childId,
        NOSTREAM,
        start,
        miniStream.length,
      );
    } else if (node.stream !== undefined) {
      const start = miniStartOf.has(id)
        ? (miniStartOf.get(id) ?? 0)
        : (bigStartOf.get(id) ?? ENDOFCHAIN);
      writeDirectoryEntry(
        entry,
        node,
        2,
        NOSTREAM,
        rightId,
        start,
        node.stream.length,
      );
    } else {
      writeDirectoryEntry(entry, node, 1, childId, rightId, ENDOFCHAIN, 0);
    }
  }

  // The header: little-endian, the version's own sector shifts, DIFAT in the header array only. The directory-sector count is 0 for version 3 (the spec fixes it there) and the real count for version 4; the reader deliberately does not cross-check either way, but the writer stays spec-conformant.
  const file = new Uint8Array(sectorSize + totalSectors * sectorSize);
  const view = new DataView(file.buffer);
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  for (let i = 0; i < magic.length; i++) {
    file[i] = magic[i] ?? 0;
  }
  put16(view, 0x18, 0x3e); // minor version: the value producers commonly write; readers ignore it
  put16(view, 0x1a, majorVersion);
  put16(view, 0x1c, 0xfffe); // byte order: little-endian
  put16(view, 0x1e, sectorShift);
  put16(view, 0x20, 6); // mini sector shift: 2^6 = 64-byte mini sectors
  put32(view, 0x28, majorVersion === 3 ? 0 : directorySectorCount);
  put32(view, 0x2c, fatSectorCount);
  put32(view, 0x30, directoryStart);
  put32(view, 0x38, MINI_STREAM_CUTOFF);
  put32(view, 0x3c, miniSectorCount === 0 ? ENDOFCHAIN : miniFatStart);
  put32(view, 0x40, miniFatSectorCount);
  put32(view, 0x44, ENDOFCHAIN); // first DIFAT sector: none, the DIFAT fits the header array
  put32(view, 0x48, 0);
  for (let i = 0; i < 109; i++) {
    put32(
      view,
      0x4c + i * 4,
      i < fatSectors.length ? (fatSectors[i] ?? FREESECT) : FREESECT,
    );
  }

  const copySector = (sector: number, bytes: Uint8Array): void => {
    file.set(bytes, sectorSize + sector * sectorSize);
  };
  for (let i = 0; i < fatSectorCount; i++) {
    copySector(
      fatSectors[i] ?? 0,
      new Uint8Array(fat.buffer, i * sectorSize, sectorSize),
    );
  }
  for (let i = 0; i < directorySectorCount; i++) {
    copySector(
      directoryStart + i,
      directory.subarray(i * sectorSize, (i + 1) * sectorSize),
    );
  }
  for (const record of bigStreamRecords) {
    copySector(
      bigStartOf.get(record.id) ?? 0,
      padToMultiple(record.node.stream, sectorSize),
    );
  }
  if (miniStream.length > 0) {
    copySector(miniStreamStart, miniStream);
  }
  for (let i = 0; i < miniFatSectorCount; i++) {
    copySector(
      miniFatStart + i,
      new Uint8Array(miniFat.buffer, i * sectorSize, sectorSize),
    );
  }
  return file;
}
