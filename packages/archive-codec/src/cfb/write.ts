import type { CompoundFileStream } from "./read";

// The write half of the classic OLE compound-file container ([MS-CFB]): given the same named-stream vocabulary readCompoundFile returns, it emits a conformant compound file -- header, FAT, DIFAT (header array and chained DIFAT sectors), directory entries as genuine red-black sibling trees, and the mini-FAT/mini-stream allocation small streams take. It exists because the family's legacy binary codecs (doc-codec, xls-codec, ppt-codec, wpd-codec) can read their [MS-CFB]-contained formats but cannot produce them: a .doc, .xls, or .ppt writer needs a compound file to put its own binary streams into, and that container is structural knowledge exactly as the reader's is -- sectors, chains, and directory entries, never that any stream is a document (see documents.js#815, #816, #817).
//
// Deliberately the mirror image of readCompoundFile: it takes the array that returns, so writeCompoundFile(readCompoundFile(bytes)) is a well-typed round trip rather than a translation between two vocabularies. Nested storages come with that symmetry -- the reader emits slash-joined paths for streams inside storages, so a writer that could not accept one would not be able to re-write what its own package had just read, even though no legacy-format codec needs nesting for its own streams.
//
// Size, and why only one ceiling is checked. The header's own DIFAT array names 109 FAT sectors, which for version 3 covers 6.875 MB ([MS-CFB] 2.5) -- a limit a real .doc or .xls passes routinely, so chained DIFAT sectors are written rather than a size cap being imposed. What remains is the version 3 per-stream ceiling of 0x80000000 bytes, which is checked and throws, because past it the 64-bit stream-size field would need its high half and the spec forbids that in a version 3 file. The format's own sector-number ceiling (MAXREGSECT, 0xFFFFFFFA) is not checked because it cannot be reached: at the smallest sector size it stands for roughly 2 TB, and this writer builds the file in one Uint8Array, whose own allocation limit is orders of magnitude lower and fails loudly on its own.

// [MS-CFB] 2.3 special FAT values, and 2.6.1's sibling/child terminator. Restated here rather than imported from ./read: the reader keeps them private, and a writer that shared a mutable module-level surface with the reader would couple the two halves for no gain beyond four constants.
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const FATSECT = 0xfffffffd;
const DIFSECT = 0xfffffffc;
const NOSTREAM = 0xffffffff;
// A FREESECT is four 0xFF bytes, so filling a byte range with this is filling it with FREESECT entries -- which is how every FAT, mini-FAT, and DIFAT region below starts out, and how the spec's requirement that entries past the end of the file read FREESECT is met without a second pass over the tail.
const FREESECT_FILL_BYTE = FREESECT & 0xff;
// [MS-CFB] 2.2: the header is 512 bytes whatever the sector size, and its own DIFAT array names the first 109 FAT sectors.
const HEADER_DIFAT_ENTRIES = 109;
const HEADER_DIFAT_OFFSET = 0x4c;
// [MS-CFB] 2.6.1: every directory entry is exactly 128 bytes, and its name field holds at most 32 UTF-16 code points including the terminating null.
const DIRECTORY_ENTRY_SIZE = 128;
const MAX_NAME_CODE_UNITS = 31;
// [MS-CFB] 2.2: the mini sector size is fixed at 2^6, and the cutoff MUST be written as 0x00001000 -- a stream at or above it is allocated from the FAT, below it from the mini FAT.
const MINI_SECTOR_SHIFT = 6;
const MINI_SECTOR_SIZE = 1 << MINI_SECTOR_SHIFT;
const MINI_STREAM_CUTOFF = 0x1000;
// [MS-CFB] 2.6.1 object types and colour flags.
const OBJECT_TYPE_STORAGE = 1;
const OBJECT_TYPE_STREAM = 2;
const OBJECT_TYPE_ROOT = 5;
const COLOUR_RED = 0;
const COLOUR_BLACK = 1;
// The first directory entry's name is not load-bearing -- readers reach the entry by its position and its type-5 object type -- but "Root Entry" is what every producer writes and what an inspecting human expects to see.
const ROOT_ENTRY_NAME = "Root Entry";
// [MS-CFB] 2.6.1: a version 3 file's stream size MUST be at most 0x80000000, so the high half of the 64-bit size field is always zero there. Version 4 has no such ceiling.
const MAX_VERSION_3_STREAM_BYTES = 0x80000000;
// [MS-CFB] 2.6.1: '/' cannot reach a name at all, since this API spells storage nesting with it; the other three are rejected here.
const ILLEGAL_NAME_CHARACTERS = ["\\", ":", "!"] as const;

// Thrown when the streams a caller asked to write cannot be expressed as a conformant compound file: an illegal or over-long name, an empty path segment, or two siblings whose names collide under the format's own case-insensitive ordering. A distinct class from the reader's CompoundFileFormatError because the two describe opposite failures -- that one says the bytes handed in are malformed, this one says the request is unwritable -- and a consumer that catches one has no business swallowing the other.
export class CompoundFileWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompoundFileWriteError";
  }
}

export interface WriteCompoundFileOptions {
  // Version 3 (512-byte sectors) unless named otherwise: it is what every legacy Office binary format is written as, and what the four codecs consuming this writer produce. Version 4 (4096-byte sectors) writes the same structures with the header zero-padded out to its full first sector.
  readonly majorVersion?: 3 | 4;
}

interface StorageNode {
  readonly name: string;
  readonly children: TreeNode[];
}

interface StreamNode {
  readonly name: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

// Storage and stream are distinguished by which field each carries rather than by a tag: no node can hold both, so the presence of `children` already discriminates the union and a `kind` field would be a second source of truth for the same fact.
type TreeNode = StorageNode | StreamNode;

function isStorage(node: TreeNode): node is StorageNode {
  return "children" in node;
}

// [MS-CFB] 2.6.1 gives the first directory entry its own object type: entry 0 is the root storage (5), every other storage an ordinary one (1), and everything else a stream (2).
function objectTypeOf(entry: PlannedEntry): number {
  if (entry.id === 0) {
    return OBJECT_TYPE_ROOT;
  }
  return isStorage(entry.node) ? OBJECT_TYPE_STORAGE : OBJECT_TYPE_STREAM;
}

// One directory entry under construction. Its name, type, and content are fixed when the path tree is built; its sibling links and colour are filled in by the red-black construction, and its sector and size once the layout is known -- three passes over one object rather than three parallel arrays indexed by entry id.
interface PlannedEntry {
  readonly id: number;
  readonly node: TreeNode;
  left: number;
  right: number;
  child: number;
  colour: number;
  startSector: number;
  size: number;
}

// One stream's entry paired with the bytes it carries, for the two allocation partitions. The pairing is what keeps the emission passes free of a storage case they can never actually meet: a partition is built where the union is already narrowed, so nothing downstream has to narrow it again.
interface ResidentStream {
  readonly entry: PlannedEntry;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

// [MS-CFB] 2.6.4 uppercases one UTF-16 code point at a time using the simple (single-code-point) case mapping. JavaScript's toUpperCase applies the FULL mapping, which can expand one code unit into several ('ß' becomes 'SS'); wherever it does, the simple mapping is the identity, so an expansion means the code unit is left alone. Surrogates are never uppercased, because the spec's mapping is per code point and a surrogate is half of one.
function upperCodeUnit(value: string, index: number): number {
  const unit = value.charCodeAt(index);
  if (unit >= 0xd800 && unit <= 0xdfff) {
    return unit;
  }
  const upper = String.fromCharCode(unit).toUpperCase();
  return upper.length === 1 ? upper.charCodeAt(0) : unit;
}

// The [MS-CFB] 2.6.4 sorting relationship: a shorter name is less than a longer one, and equal-length names compare by uppercased UTF-16 code point. Length is compared as the code-unit count rather than the Directory Entry Name Length field the spec names, because that field is exactly (code units + 1) * 2 -- a strictly increasing function of the same quantity, so the two orderings are identical. Names that compare equal are the same name to the format, which is why this doubles as the sibling-uniqueness test.
function compareEntryNames(left: string, right: string): number {
  if (left.length !== right.length) {
    return left.length - right.length;
  }
  for (let i = 0; i < left.length; i++) {
    const difference = upperCodeUnit(left, i) - upperCodeUnit(right, i);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function checkedSegment(name: string, path: string): string {
  if (name.length === 0) {
    throw new CompoundFileWriteError(
      `stream path ${JSON.stringify(path)} has an empty name segment; every segment must name a storage, and the last must name the stream`,
    );
  }
  if (name.length > MAX_NAME_CODE_UNITS) {
    throw new CompoundFileWriteError(
      `'${name}' is ${name.length} UTF-16 code points, more than the ${MAX_NAME_CODE_UNITS} a directory entry's name field holds alongside its terminating null (in stream path ${JSON.stringify(path)})`,
    );
  }
  for (const illegal of ILLEGAL_NAME_CHARACTERS) {
    if (name.includes(illegal)) {
      throw new CompoundFileWriteError(
        `'${name}' holds '${illegal}', which [MS-CFB] 2.6.1 forbids in a storage or stream name (in stream path ${JSON.stringify(path)})`,
      );
    }
  }
  return name;
}

// Grafts one stream onto the storage tree, creating the storages its path names along the way. Sibling identity is the format's own ordering, not string equality, so 'Table' and 'TABLE' collide here exactly as they would for a reader searching the sibling tree.
function addStream(
  root: StorageNode,
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
): void {
  const segments = path.split("/");
  let storage = root;
  let depth = 0;
  for (const segment of segments) {
    depth += 1;
    const name = checkedSegment(segment, path);
    const existing = storage.children.find(
      (child) => compareEntryNames(child.name, name) === 0,
    );
    if (depth === segments.length) {
      if (existing !== undefined) {
        throw new CompoundFileWriteError(
          `stream path ${JSON.stringify(path)} collides with '${existing.name}', which the file already holds in the same storage ([MS-CFB] 2.6.4 requires siblings to have unique names)`,
        );
      }
      storage.children.push({ name, bytes });
    } else if (existing === undefined) {
      const created: StorageNode = { name, children: [] };
      storage.children.push(created);
      storage = created;
    } else if (isStorage(existing)) {
      storage = existing;
    } else {
      throw new CompoundFileWriteError(
        `stream path ${JSON.stringify(path)} needs '${existing.name}' to be a storage, but the file already holds a stream by that name`,
      );
    }
  }
}

// The depth of the deepest node in the balanced tree linkSiblings builds over `count` siblings. Each recursion halves the sibling count, so the deepest node sits at floor(log2(count)) -- computed by bit length rather than Math.log2, which is a float operation whose rounding at exact powers of two would silently mis-colour a whole level.
function deepestDepth(count: number): number {
  return count === 0 ? 0 : 31 - Math.clz32(count);
}

// Builds one storage's sibling red-black tree over its already-sorted children, returning its root, and satisfies every [MS-CFB] 2.6.4 constraint by construction rather than by rebalancing: splitting a sorted list at its midpoint gives a binary search tree whose nodes sit at depths 0..D for D = floor(log2 n) and whose empty positions sit at depths no shallower than floor(log2(n+1)) >= D, so colouring exactly the depth-D nodes red makes every root-to-leaf path carry D + 1 black nodes (a path reaching depth D + 1 does so only through a red node, which adds none) with no two reds adjacent (reds share only black parents at depth D - 1) and a black root (depth 0 is red only when D is 0, the lone-sibling case, which is coloured black instead).
//
// The spec permits the degenerate all-black colouring, and readers that only traverse would accept a right-sibling chain too -- but a chain is not a search tree, so a reader that binary-searches the siblings by name (which is what the tree is for) would fail to find entries in one. Building the balanced tree costs nothing here and is the shape real producers emit.
function linkSiblings(
  siblings: readonly PlannedEntry[],
  depth: number,
  deepest: number,
): PlannedEntry | undefined {
  const midpoint = siblings.length >> 1;
  const before = siblings.slice(0, midpoint);
  const [node, ...after] = siblings.slice(midpoint);
  if (node === undefined) {
    return undefined;
  }
  node.colour = depth === deepest && deepest > 0 ? COLOUR_RED : COLOUR_BLACK;
  const left = linkSiblings(before, depth + 1, deepest);
  const right = linkSiblings(after, depth + 1, deepest);
  node.left = left === undefined ? NOSTREAM : left.id;
  node.right = right === undefined ? NOSTREAM : right.id;
  return node;
}

// The planned directory, with its root entry named separately: entry 0 is always the root storage, and carrying it out of the plan directly is what lets the mini stream's own location be written to it later without an indexed lookup whose absent case could not happen.
interface DirectoryPlan {
  readonly rootPlan: PlannedEntry;
  readonly plans: readonly PlannedEntry[];
}

// Assigns directory entry ids and sibling trees. Ids run breadth-first with each storage's children in the format's own name order, so the directory a caller gets back depends only on the set of paths, never on the order they were supplied in -- two callers building the same file from differently ordered lists produce identical bytes. The walk is iterative because storage nesting depth is whatever the caller's paths say it is, and a deep path must not become a deep call stack.
function planDirectory(root: StorageNode): DirectoryPlan {
  const plans: PlannedEntry[] = [];
  const plan = (node: TreeNode): PlannedEntry => {
    const created: PlannedEntry = {
      id: plans.length,
      node,
      left: NOSTREAM,
      right: NOSTREAM,
      child: NOSTREAM,
      colour: COLOUR_BLACK,
      startSector: 0,
      size: 0,
    };
    plans.push(created);
    return created;
  };

  const rootPlan = plan(root);
  let frontier: PlannedEntry[] = [rootPlan];
  while (frontier.length > 0) {
    const next: PlannedEntry[] = [];
    for (const parent of frontier) {
      const node = parent.node;
      if (!isStorage(node)) {
        continue;
      }
      node.children.sort((left, right) =>
        compareEntryNames(left.name, right.name),
      );
      const children: PlannedEntry[] = [];
      for (const child of node.children) {
        const childPlan = plan(child);
        children.push(childPlan);
        next.push(childPlan);
      }
      const subtree = linkSiblings(children, 0, deepestDepth(children.length));
      parent.child = subtree === undefined ? NOSTREAM : subtree.id;
    }
    frontier = next;
  }
  return { rootPlan, plans };
}

// Writes the streams as a compound file. Version 3 (512-byte sectors) unless options say otherwise. Throws CompoundFileWriteError when the request itself cannot be expressed -- an illegal name, an empty path segment, colliding siblings, or a version 3 stream past the 2 GB the format allows one -- rather than emitting a file that only looks valid.
export function writeCompoundFile(
  streams: readonly CompoundFileStream[],
  options: WriteCompoundFileOptions = {},
): Uint8Array<ArrayBuffer> {
  const majorVersion = options.majorVersion ?? 3;
  const sectorShift = majorVersion === 4 ? 12 : 9;
  const sectorSize = 1 << sectorShift;
  const entriesPerFatSector = sectorSize / 4;
  const entriesPerDirectorySector = sectorSize / DIRECTORY_ENTRY_SIZE;
  // A DIFAT sector spends its last slot on the pointer to the next one ([MS-CFB] 2.5), so it names one fewer FAT sector than a FAT sector holds entries.
  const difatEntriesPerSector = entriesPerFatSector - 1;

  const root: StorageNode = { name: ROOT_ENTRY_NAME, children: [] };
  for (const { path, bytes } of streams) {
    if (majorVersion === 3 && bytes.length > MAX_VERSION_3_STREAM_BYTES) {
      throw new CompoundFileWriteError(
        `stream ${JSON.stringify(path)} is ${bytes.length} bytes, past the ${MAX_VERSION_3_STREAM_BYTES}-byte ceiling [MS-CFB] 2.6.1 puts on a version 3 stream; write the file as version 4 instead`,
      );
    }
    addStream(root, path, bytes);
  }
  const { rootPlan, plans } = planDirectory(root);

  // Streams split by the header's own cutoff: at or above it a stream gets whole FAT-chained sectors, below it a run of 64-byte mini sectors carved out of the root entry's own stream. A zero-length stream takes neither -- it has no chain at all, and its starting sector is meaningless ([MS-CFB] 2.6.1). Each partition carries its bytes alongside its entry, so the emission passes below never have to re-narrow a storage back out of a list that by construction holds only streams.
  const miniResident: ResidentStream[] = [];
  const fatResident: ResidentStream[] = [];
  for (const entry of plans) {
    const node = entry.node;
    if (isStorage(node)) {
      continue;
    }
    entry.size = node.bytes.length;
    if (node.bytes.length === 0) {
      entry.startSector = ENDOFCHAIN;
    } else if (node.bytes.length < MINI_STREAM_CUTOFF) {
      miniResident.push({ entry, bytes: node.bytes });
    } else {
      fatResident.push({ entry, bytes: node.bytes });
    }
  }

  // The mini stream: each small stream padded out to a whole number of mini sectors and concatenated, so a stream's starting mini sector is where its own run begins.
  let miniSectorCount = 0;
  for (const { entry, bytes } of miniResident) {
    entry.startSector = miniSectorCount;
    miniSectorCount += Math.ceil(bytes.length / MINI_SECTOR_SIZE);
  }
  const miniStreamBytes = miniSectorCount * MINI_SECTOR_SIZE;

  const directorySectorCount = Math.ceil(
    plans.length / entriesPerDirectorySector,
  );
  const miniStreamSectorCount = Math.ceil(miniStreamBytes / sectorSize);
  const miniFatSectorCount = Math.ceil(miniSectorCount / entriesPerFatSector);
  let fatStreamSectorCount = 0;
  for (const { bytes } of fatResident) {
    fatStreamSectorCount += Math.ceil(bytes.length / sectorSize);
  }

  // The FAT has to map every sector of the file including its own, and past 109 FAT sectors the DIFAT spills out of the header into sectors that are themselves part of the file: two counts, each defined in terms of a total that both of them grow. Both are monotonically non-decreasing in that total and bounded by it, so iterating from the smallest possible pair reaches the fixed point rather than oscillating.
  const totalSectorsGiven = (fat: number, difat: number): number =>
    fat +
    difat +
    directorySectorCount +
    fatStreamSectorCount +
    miniStreamSectorCount +
    miniFatSectorCount;
  let fatSectorCount = 1;
  let difatSectorCount = 0;
  for (;;) {
    const neededFat = Math.max(
      1,
      Math.ceil(
        totalSectorsGiven(fatSectorCount, difatSectorCount) /
          entriesPerFatSector,
      ),
    );
    const neededDifat =
      neededFat <= HEADER_DIFAT_ENTRIES
        ? 0
        : Math.ceil((neededFat - HEADER_DIFAT_ENTRIES) / difatEntriesPerSector);
    if (neededFat === fatSectorCount && neededDifat === difatSectorCount) {
      break;
    }
    fatSectorCount = neededFat;
    difatSectorCount = neededDifat;
  }
  const totalSectors = totalSectorsGiven(fatSectorCount, difatSectorCount);

  // Sector allocation, in the order the sectors are laid out in the file. Nothing in [MS-CFB] fixes an order; putting the FAT first makes the header's DIFAT array the identity run 0..fatSectorCount-1, and grouping each kind contiguously makes every chain a run of consecutive sectors.
  const difatStart = fatSectorCount;
  const directoryStart = difatStart + difatSectorCount;
  let nextSector = directoryStart + directorySectorCount;
  for (const { entry, bytes } of fatResident) {
    entry.startSector = nextSector;
    nextSector += Math.ceil(bytes.length / sectorSize);
  }
  const miniStreamStart = nextSector;
  nextSector += miniStreamSectorCount;
  const miniFatStart = nextSector;

  rootPlan.startSector = miniSectorCount === 0 ? ENDOFCHAIN : miniStreamStart;
  rootPlan.size = miniStreamBytes;

  // Sector N occupies bytes [(N + 1) * sectorSize, (N + 2) * sectorSize) ([MS-CFB] 2.3): the header takes the whole first sector, which for version 4 means its 512 bytes followed by 3584 zero bytes of padding the allocation already provides.
  const file = new Uint8Array(sectorSize * (1 + totalSectors));
  const view = new DataView(file.buffer);
  const putU16 = (offset: number, value: number): void => {
    view.setUint16(offset, value, true);
  };
  const putU32 = (offset: number, value: number): void => {
    view.setUint32(offset, value, true);
  };
  const sectorOffset = (sector: number): number => (sector + 1) * sectorSize;

  file.fill(
    FREESECT_FILL_BYTE,
    sectorOffset(0),
    sectorOffset(0) + fatSectorCount * sectorSize,
  );
  file.fill(
    FREESECT_FILL_BYTE,
    sectorOffset(miniFatStart),
    sectorOffset(miniFatStart) + miniFatSectorCount * sectorSize,
  );
  file.fill(
    FREESECT_FILL_BYTE,
    sectorOffset(difatStart),
    sectorOffset(difatStart) + difatSectorCount * sectorSize,
  );
  file.fill(
    FREESECT_FILL_BYTE,
    HEADER_DIFAT_OFFSET,
    HEADER_DIFAT_OFFSET + HEADER_DIFAT_ENTRIES * 4,
  );

  const setFat = (sector: number, value: number): void => {
    putU32(
      sectorOffset(Math.floor(sector / entriesPerFatSector)) +
        (sector % entriesPerFatSector) * 4,
      value,
    );
  };
  const chainSectors = (start: number, count: number): void => {
    for (let i = 0; i < count; i++) {
      setFat(start + i, i === count - 1 ? ENDOFCHAIN : start + i + 1);
    }
  };

  // The FAT describes its own sectors and the DIFAT's with role markers rather than chaining them ([MS-CFB] 2.3, 2.5); everything else is a chain.
  for (let i = 0; i < fatSectorCount; i++) {
    setFat(i, FATSECT);
  }
  for (let i = 0; i < difatSectorCount; i++) {
    setFat(difatStart + i, DIFSECT);
  }
  chainSectors(directoryStart, directorySectorCount);
  for (const { entry, bytes } of fatResident) {
    chainSectors(entry.startSector, Math.ceil(bytes.length / sectorSize));
  }
  chainSectors(miniStreamStart, miniStreamSectorCount);
  chainSectors(miniFatStart, miniFatSectorCount);

  // The DIFAT: index n names the (n+1)th FAT sector, the header carrying the first 109 and chained DIFAT sectors the rest, each spending its last slot on the next sector's location and the last of them on ENDOFCHAIN.
  for (let i = 0; i < Math.min(fatSectorCount, HEADER_DIFAT_ENTRIES); i++) {
    putU32(HEADER_DIFAT_OFFSET + i * 4, i);
  }
  for (let sector = 0; sector < difatSectorCount; sector++) {
    const base = sectorOffset(difatStart + sector);
    for (let i = 0; i < difatEntriesPerSector; i++) {
      const fatIndex =
        HEADER_DIFAT_ENTRIES + sector * difatEntriesPerSector + i;
      if (fatIndex < fatSectorCount) {
        putU32(base + i * 4, fatIndex);
      }
    }
    putU32(
      base + difatEntriesPerSector * 4,
      sector === difatSectorCount - 1 ? ENDOFCHAIN : difatStart + sector + 1,
    );
  }

  // The mini FAT chains each small stream's run of mini sectors, in the same order the runs were laid down in the mini stream.
  const setMiniFat = (miniSector: number, value: number): void => {
    putU32(
      sectorOffset(
        miniFatStart + Math.floor(miniSector / entriesPerFatSector),
      ) +
        (miniSector % entriesPerFatSector) * 4,
      value,
    );
  };
  for (const { entry, bytes } of miniResident) {
    const count = Math.ceil(bytes.length / MINI_SECTOR_SIZE);
    for (let i = 0; i < count; i++) {
      setMiniFat(
        entry.startSector + i,
        i === count - 1 ? ENDOFCHAIN : entry.startSector + i + 1,
      );
    }
  }

  // Stream content. Both arms write into an allocation that is already zero, so the tail of a stream's last sector (or last mini sector) is padding without a second write.
  for (const { entry, bytes } of fatResident) {
    file.set(bytes, sectorOffset(entry.startSector));
  }
  for (const { entry, bytes } of miniResident) {
    file.set(
      bytes,
      sectorOffset(miniStreamStart) + entry.startSector * MINI_SECTOR_SIZE,
    );
  }

  const entryOffset = (id: number): number =>
    sectorOffset(directoryStart + Math.floor(id / entriesPerDirectorySector)) +
    (id % entriesPerDirectorySector) * DIRECTORY_ENTRY_SIZE;

  for (const entry of plans) {
    const base = entryOffset(entry.id);
    const node = entry.node;
    const name = node.name;
    for (let i = 0; i < name.length; i++) {
      putU16(base + i * 2, name.charCodeAt(i));
    }
    // The already-zero code unit past the name is the terminating null the length counts.
    putU16(base + 0x40, (name.length + 1) * 2);
    view.setUint8(base + 0x42, objectTypeOf(entry));
    view.setUint8(base + 0x43, entry.colour);
    putU32(base + 0x44, entry.left);
    putU32(base + 0x48, entry.right);
    putU32(base + 0x4c, entry.child);
    // CLSID (0x50), state bits (0x60), creation time (0x64), and modified time (0x6c) stay zero: [MS-CFB] 2.6.1 requires that of a stream entry and of the root's timestamps, and an implementation that does not let callers set a storage's class or state bits MUST default them to zero -- which is exactly this one, since none of it survives a round trip through the stream vocabulary this writer takes.
    putU32(base + 0x74, entry.startSector);
    putU32(base + 0x78, entry.size >>> 0);
    putU32(base + 0x7c, Math.floor(entry.size / 4294967296));
  }
  // Directory entries past the last real one pad their sector out. They stay object type 0 (unallocated) with a zero-length name, and only their links need writing, since NOSTREAM is not the zero the allocation already holds.
  for (
    let id = plans.length;
    id < directorySectorCount * entriesPerDirectorySector;
    id++
  ) {
    const base = entryOffset(id);
    putU32(base + 0x44, NOSTREAM);
    putU32(base + 0x48, NOSTREAM);
    putU32(base + 0x4c, NOSTREAM);
  }

  // The header ([MS-CFB] 2.2). Header CLSID (0x08), reserved (0x22), and the transaction signature number (0x34) stay zero, each because the spec requires it.
  file.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  putU16(0x18, 0x003e); // minor version: the value the spec names for major version 3 and 4 alike
  putU16(0x1a, majorVersion);
  putU16(0x1c, 0xfffe); // byte order mark: little-endian
  putU16(0x1e, sectorShift);
  putU16(0x20, MINI_SECTOR_SHIFT);
  // The directory-sector count MUST be zero in a version 3 file -- the field is unsupported there -- and carries the real count in version 4.
  putU32(0x28, majorVersion === 3 ? 0 : directorySectorCount);
  putU32(0x2c, fatSectorCount);
  putU32(0x30, directoryStart);
  putU32(0x38, MINI_STREAM_CUTOFF);
  putU32(0x3c, miniFatSectorCount === 0 ? ENDOFCHAIN : miniFatStart);
  putU32(0x40, miniFatSectorCount);
  putU32(0x44, difatSectorCount === 0 ? ENDOFCHAIN : difatStart);
  putU32(0x48, difatSectorCount);

  return file;
}
