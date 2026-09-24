// A hand-built minimal [MS-CFB] compound-file writer for the reader's tests (ooxml.js's embedded-payload fixtures mirror this layout in their own test-support): given slash-separated stream paths and their bytes, it emits a genuine compound file — version 3 (512-byte sectors) by default, version 4 (4096-byte sectors, the 512-byte header zero-padded out to the full sector-sized header region) via the majorVersion option — always with the 4096-byte mini-stream cutoff and 64-byte mini sectors both versions mandate, whose header, DIFAT, FAT, directory, and mini-FAT the reader under test must parse to get the streams back.
//
// Construction, in the order the bytes are laid out:
//
// 1. Storage tree: each entry's path splits on '/'; intermediate segments become storage entries (directory object type 1), the last segment the stream entry (type 2). Entry IDs are assigned root-first then depth-first in the given order; the root storage entry (type 5, name "Root Entry") is always ID 0, as [MS-CFB] 2.6.1 requires of the first directory entry.
// 2. Sector layout, in order: FAT sectors, then directory sectors (4 entries per 512-byte sector), then the FAT-resident streams' data sectors, then the mini stream's sectors, then the mini-FAT sector(s). The FAT-sector count reaches a fixed point against the total sector count, because each FAT sector maps 128 sectors including itself.
// 3. Streams shorter than the cutoff live in the mini stream: every small stream is zero-padded to a whole number of 64-byte mini sectors, and the small streams concatenate into one byte string stored as the root entry's own stream (its starting sector and size), carved up by the mini-FAT's chains. Streams at or above the cutoff occupy whole FAT-chained sectors of their own.
// 4. The directory tree links a storage's children as a right-sibling chain (the storage's child points at the first, each child's right sibling at the next). [MS-CFB] recommends producers order and balance the sibling tree by name; that is a recommendation about tree shape, not a reader requirement, and this writer deliberately skips it — the reader under test traverses left/right/child structurally, exactly as real-world readers must for the unbalanced trees real producers emit.
// 5. FAT marking: FAT sectors are FATSECT (0xFFFFFFFD); the directory, mini-stream, and mini-FAT sectors and every big stream's sectors chain with ENDOFCHAIN (0xFFFFFFFE) terminators; unused entries are FREESECT (0xFFFFFFFF). The DIFAT lives entirely in the header's 109-entry array (no DIFAT sectors), so FirstDIFATSectorLocation is ENDOFCHAIN.
//
// Test-support only: excluded from the published dist per the family convention, and names are limited to ASCII of at most 31 characters (the directory entry's 64-byte UTF-16 name field including its null terminator).
//
// Copied from archive-codec's own test-support rather than imported, for the same reason ooxml.js keeps its own copy: test-support is excluded from every package's published dist, so there is nothing to import at build time. This package needs it to wrap a hand-built BIFF8 record stream in the compound-file container a real .xls carries it in, so the end-to-end reader tests exercise the actual container path rather than starting from an already-extracted stream.

export interface CompoundFileEntrySpec {
  readonly path: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

export interface CompoundFileOptions {
  readonly majorVersion?: 3 | 4;
}

export interface StorageNode {
  readonly name: string;
  readonly children: StorageNode[];
  stream?: Uint8Array<ArrayBuffer>;
}

export interface DirectoryRecord {
  readonly node: StorageNode;
  readonly id: number;
  rightId: number;
}

/** A node's own DirectoryRecord, which compoundFile's own record() walk (called once, over the whole tree, before this is ever read) has already created for every node the tree can reach through a `children` array — so a node genuinely missing here would mean that walk itself is broken, not a caller passing a node from outside the tree. */
export function requiredRecord(
  recordOf: ReadonlyMap<StorageNode, DirectoryRecord>,
  node: StorageNode,
): DirectoryRecord {
  const found = recordOf.get(node);
  if (found === undefined) {
    throw new Error(
      "internal error: compoundFile's own record() walk never visited a node its own tree links to",
    );
  }
  return found;
}

/** A stream's own starting sector (big-stream sector or mini-stream sector alike), which compoundFile's own sector-allocation pass (run once, over every stream of the kind `startOf` tracks, before this is ever read) has already assigned by the same record id being looked up here — so an id genuinely missing here would mean that allocation pass itself skipped a stream it should have placed. */
export function requiredSectorStart(
  startOf: ReadonlyMap<number, number>,
  id: number,
): number {
  const found = startOf.get(id);
  if (found === undefined) {
    throw new Error(
      "internal error: compoundFile's own sector-allocation pass never assigned a start sector to one of its own streams",
    );
  }
  return found;
}

/** The split path a compound-file entry is being placed at. Wrapped rather than passed as a bare array because requiredLeaf below genuinely removes the leaf from it: the caller then walks what remains as the entry's own parent storages, so the pop is load-bearing rather than incidental. */
export interface PathSegmentSink {
  readonly segments: string[];
}

/** A compound-file entry path's own last segment, REMOVED from `sink.segments` so what remains is the entry's own parent storage path. entry.path.split("/") always yields at least one element (String.prototype.split never returns an empty array), so `.pop()` can never actually return undefined here — reachable only by calling this function directly with an already-empty array, which no real path ever produces. */
export function requiredLeaf(sink: PathSegmentSink): string {
  const leaf = sink.segments.pop();
  if (leaf === undefined) {
    throw new Error(
      'internal error: a compound-file entry path\'s own split("/") produced no segments at all',
    );
  }
  return leaf;
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

// A stream/storage name reaching this function is always non-empty: every leaf and intermediate path segment is validated non-empty before a StorageNode is ever built for it (compoundFile's own path-splitting loop below), and the one node this validation never touches — the root — is always written under the substituted literal name "Root Entry", never its own construction-time value. So only the ASCII-alphabet and 31-character bounds are this function's own real contract; a name genuinely reaching here empty would be this module's own bug, not a caller's.
export function checkedName(node: StorageNode): Uint8Array<ArrayBuffer> {
  const encoded = enc(node.name);
  if (encoded.length > 31 || encoded.some((byte) => byte > 0x7f)) {
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
  for (const [i, byte] of encoded.entries()) {
    entry.setUint8(i * 2, byte);
    entry.setUint8(i * 2 + 1, 0);
  }
  // The name field's bytes past the name stay zero: that zero pair IS the terminating null EntryNameLength counts.
  put16(entry, 0x40, encoded.length * 2 + 2);
  entry.setUint8(0x42, objectType);
  entry.setUint8(0x43, 1); // colour flag: black — meaningless to a structural reader
  put32(entry, 0x44, NOSTREAM);
  put32(entry, 0x48, rightId);
  put32(entry, 0x4c, childId);
  put32(entry, 0x74, startSector);
  put32(entry, 0x78, size);
  // Bytes 0x7c-0x7f (the stream size's own high 32 bits) stay zero — entry is a view into a freshly-allocated, zero-initialised directory buffer, so writing 0 there again would restate what is already true rather than change anything.
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
  // Sector geometry is the version's own: 512-byte sectors for version 3, 4096 for version 4 — whose 512-byte header the file zero-pads out to the full first sector ([MS-CFB] 2.2), so sector N always starts at (N + 1) * sectorSize, never 512 + N * sectorSize.
  const majorVersion = options.majorVersion ?? 3;
  const sectorSize = majorVersion === 4 ? 4096 : 512;
  const sectorShift = majorVersion === 4 ? 12 : 9;
  const entriesPerDirectorySector = sectorSize / 128;
  const fatEntriesPerSector = sectorSize / 4;

  // [MS-CFB] 2.6.1 fixes the root storage entry's own name at "Root Entry" — stated directly here rather than substituted only at the point its own directory entry gets written, so the one name this module ever writes for the root is the one it was actually constructed with.
  const root: StorageNode = { name: "Root Entry", children: [] };
  for (const entry of entries) {
    const segments = entry.path.split("/");
    const leaf = requiredLeaf({ segments });
    if (leaf.length === 0 || segments.some((segment) => segment.length === 0)) {
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
    for (const [i, child] of node.children.entries()) {
      const next = node.children[i + 1];
      requiredRecord(recordOf, child).rightId =
        next === undefined ? NOSTREAM : requiredRecord(recordOf, next).id;
    }
  }

  // Narrowed through a type predicate rather than a boolean one, because `filter` with a boolean callback leaves the element type alone: the two partitions below would still carry `stream?: Uint8Array` even though the predicate is exactly what rules the absent case out, and every later read would need a fallback that can never be taken.
  const smallStreamRecords = records
    .filter(hasStream)
    .filter(({ node }) => node.stream.length < MINI_STREAM_CUTOFF);
  const bigStreamRecords = records
    .filter(hasStream)
    .filter(({ node }) => node.stream.length >= MINI_STREAM_CUTOFF);

  // The mini stream: every small stream padded to whole mini sectors, concatenated; each stream's start is its first mini sector's index. Paired into one {record, chunk} entry per small stream, rather than two same-length arrays walked by a shared index, so nothing here ever needs to prove the two arrays stayed in step.
  const miniEntries = smallStreamRecords.map((streamRecord) => ({
    record: streamRecord,
    chunk: padToMultiple(streamRecord.node.stream, MINI_SECTOR_SIZE),
  }));
  const miniStream = new Uint8Array(
    miniEntries.reduce((total, { chunk }) => total + chunk.length, 0),
  );
  let miniOffset = 0;
  const miniStartOf = new Map<number, number>();
  for (const { record: streamRecord, chunk } of miniEntries) {
    miniStartOf.set(streamRecord.id, miniOffset / MINI_SECTOR_SIZE);
    miniStream.set(chunk, miniOffset);
    miniOffset += chunk.length;
  }
  const miniSectorCount = miniStream.length / MINI_SECTOR_SIZE;

  // Paired into one {record, sectorCount} entry per big stream, for the identical reason miniEntries pairs a small stream with its own padded chunk above.
  const bigEntries = bigStreamRecords.map((streamRecord) => ({
    record: streamRecord,
    sectorCount: Math.ceil(streamRecord.node.stream.length / sectorSize),
  }));
  const directorySectorCount = Math.ceil(
    records.length / entriesPerDirectorySector,
  );
  const miniStreamSectorCount = Math.ceil(miniStream.length / sectorSize);
  // No zero-sector special case: Math.ceil(0 / fatEntriesPerSector) is already 0 on its own.
  const miniFatSectorCount = Math.ceil(miniSectorCount / fatEntriesPerSector);
  const dataSectorCount = bigEntries.reduce(
    (total, { sectorCount }) => total + sectorCount,
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
  const fatSectors = [...Array(fatSectorCount).keys()];
  const directoryStart = fatSectorCount;
  let nextSector = directoryStart + directorySectorCount;
  const bigStartOf = new Map<number, number>();
  for (const { record: streamRecord, sectorCount } of bigEntries) {
    bigStartOf.set(streamRecord.id, nextSector);
    nextSector += sectorCount;
  }
  const miniStreamStart = nextSector;
  nextSector += miniStreamSectorCount;
  const miniFatStart = nextSector;

  const fat = new Uint32Array(fatSectorCount * fatEntriesPerSector).fill(
    FREESECT,
  );
  const chain = (start: number, count: number): void => {
    for (const i of Array(count).keys()) {
      fat[start + i] = i === count - 1 ? ENDOFCHAIN : start + i + 1;
    }
  };
  for (const sector of fatSectors) {
    fat[sector] = FATSECT;
  }
  chain(directoryStart, directorySectorCount);
  for (const { record: streamRecord, sectorCount } of bigEntries) {
    chain(requiredSectorStart(bigStartOf, streamRecord.id), sectorCount);
  }
  chain(miniStreamStart, miniStreamSectorCount);
  chain(miniFatStart, miniFatSectorCount);

  // The mini-FAT: one chain per small stream over its run of consecutive mini sectors.
  const miniFat = new Uint32Array(
    miniFatSectorCount * fatEntriesPerSector,
  ).fill(FREESECT);
  for (const { id, node } of smallStreamRecords) {
    const start = requiredSectorStart(miniStartOf, id);
    const count = Math.ceil(node.stream.length / MINI_SECTOR_SIZE);
    for (const j of Array(count).keys()) {
      miniFat[start + j] = j === count - 1 ? ENDOFCHAIN : start + j + 1;
    }
  }

  // Directory sectors: entry n sits at byte n * 128 of the concatenated chain.
  const directory = new Uint8Array(directorySectorCount * sectorSize);
  for (const { node, id, rightId } of records) {
    const entry = new DataView(directory.buffer, id * 128, 128);
    const firstChild = node.children[0];
    const childId =
      firstChild === undefined
        ? NOSTREAM
        : requiredRecord(recordOf, firstChild).id;
    if (node === root) {
      const start = miniStream.length === 0 ? ENDOFCHAIN : miniStreamStart;
      writeDirectoryEntry(
        entry,
        node,
        5,
        childId,
        NOSTREAM,
        start,
        miniStream.length,
      );
    } else if (node.stream !== undefined) {
      // Every stream record is in exactly one of miniStartOf/bigStartOf, split by its own byte length against MINI_STREAM_CUTOFF when smallStreamRecords/bigStreamRecords were partitioned — never both, and never neither.
      const start = miniStartOf.has(id)
        ? requiredSectorStart(miniStartOf, id)
        : requiredSectorStart(bigStartOf, id);
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
  for (const [i, byte] of magic.entries()) {
    file[i] = byte;
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
  // Byte 0x48 (the DIFAT's own sector count) stays zero — view is backed by a freshly-allocated, zero-initialised file buffer, so writing 0 there again would restate what is already true rather than change anything. The 109-entry DIFAT array is a fixed header field regardless of how many FAT sectors this file actually has — 109 is [MS-CFB] 2.2's own header array width, not a value derived from fatSectors, so the two are independent constants that only happen to be compared here. fatSectors[i] already reads back undefined past its own real length on its own, exactly what the FREESECT fallback states, so nothing here needs to check that length a second time.
  for (const i of Array(109).keys()) {
    put32(view, 0x4c + i * 4, fatSectors[i] ?? FREESECT);
  }

  const copySector = (sector: number, bytes: Uint8Array): void => {
    file.set(bytes, sectorSize + sector * sectorSize);
  };
  for (const [i, sector] of fatSectors.entries()) {
    copySector(sector, new Uint8Array(fat.buffer, i * sectorSize, sectorSize));
  }
  for (const i of Array(directorySectorCount).keys()) {
    copySector(
      directoryStart + i,
      directory.subarray(i * sectorSize, (i + 1) * sectorSize),
    );
  }
  for (const record of bigStreamRecords) {
    copySector(
      requiredSectorStart(bigStartOf, record.id),
      padToMultiple(record.node.stream, sectorSize),
    );
  }
  // No length guard: an empty mini stream sets zero bytes at its own start sector either way, so a guard here would only ever skip a call that was already a no-op.
  copySector(miniStreamStart, miniStream);
  for (const i of Array(miniFatSectorCount).keys()) {
    copySector(
      miniFatStart + i,
      new Uint8Array(miniFat.buffer, i * sectorSize, sectorSize),
    );
  }
  return file;
}
