import { isCompoundFile } from './detect';

// A bounded reader for the classic OLE compound-file container ([MS-CFB]): header and sector-size parsing, DIFAT/FAT chain walking, the directory entry tree, and stream extraction from both the FAT and the mini stream. It exists because the ZIP-payload spelling is not the only way an OOXML package embeds an object -- real-world Word and PowerPoint files frequently store the embeddee as an OLE compound file (word|ppt/embeddings/oleObject1.bin), whose storages and streams this reader surfaces (see documents.js#739). Structural knowledge only: it knows sectors, chains, and directory entries, never that any stream is a document.

// [MS-CFB] 2.3 special FAT values: a chain slot either names the chain's next sector, ends it (ENDOFCHAIN), or describes the sector itself (FATSECT marks a sector holding FAT data, DIFSECT one holding DIFAT data, FREESECT marks an unused slot).
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const FATSECT = 0xfffffffd;
const DIFSECT = 0xfffffffc;
// [MS-CFB] 2.6.1: the sibling/child link value that means "no entry".
const NOSTREAM = 0xffffffff;
// [MS-CFB] 2.2: the header is 512 bytes regardless of sector size, and the header's own DIFAT array holds 109 sector numbers.
const HEADER_SIZE = 512;
const HEADER_DIFAT_ENTRIES = 109;
// Directory entry object types ([MS-CFB] 2.6.1): 1 storage, 2 stream, 5 root storage (0 marks an unallocated padding entry, which no well-formed entry tree reaches).
const OBJECT_TYPE_STORAGE = 1;
const OBJECT_TYPE_STREAM = 2;
const OBJECT_TYPE_ROOT = 5;

// Cumulative-extraction derivation: a compound file stores its streams uncompressed, so honest content cannot exceed the file itself -- but the FAT is attacker-controlled bytes, and nothing structural stops one sector from appearing in many chains, so a hostile file with S stream entries can each declare a chain covering the whole file and extract S x file-size bytes from an input of a few kilobytes. One budget shared across every extracted stream bounds that multiplication at a single figure. The 512 MiB is the same figure the family already grants one honest decompressed stream (byte-codec's MAX_INFLATE_OUTPUT_BYTES, re-used as archive-codec's MAX_WALK_TOTAL_BYTES): a compound file holding genuine documents decompresses nothing, so its total stream content sits well inside what one compressed stream already may.
export const MAX_CFB_TOTAL_STREAM_BYTES = 512 * 1024 * 1024;

// Thrown when input claiming the compound-file signature does not conform to [MS-CFB]: a bad header field, a chain that cycles or points outside the file, a directory entry outside the entry array, or a declared stream size its chain cannot fill. A distinct error class (rather than a plain Error) because malformed-container detection is one half of this package's contract -- a consumer must be able to catch structural failure by name and decide its own degradation, rather than parse a message string.
export class CompoundFileFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompoundFileFormatError';
  }
}

// One extracted stream: its path is the slash-joined names of the storages enclosing it plus its own name, root-relative with no leading slash (a root-level stream's path is just its name -- the OLE packaging's "Package" stream reads back as 'Package').
export interface CompoundFileStream {
  readonly path: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

export interface ReadCompoundFileOptions {
  readonly maxTotalBytes?: number;
}

interface DirectoryEntry {
  readonly name: string;
  readonly nameLength: number;
  readonly objectType: number;
  readonly leftSibling: number;
  readonly rightSibling: number;
  readonly child: number;
  readonly startSector: number;
  readonly size: number;
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

// Reads every stream out of a compound file, in deterministic in-order tree-walk order (left siblings, the entry itself, right siblings -- the order the spec's name-sorted sibling trees produce). Throws CompoundFileFormatError on any structural nonconformance rather than returning a partial listing: a malformed container must fail loudly, never look complete while silently missing streams.
export function readCompoundFile(bytes: Uint8Array<ArrayBuffer>, options: ReadCompoundFileOptions = {}): CompoundFileStream[] {
  const maxTotalBytes = options.maxTotalBytes ?? MAX_CFB_TOTAL_STREAM_BYTES;
  if (!isCompoundFile(bytes)) {
    throw new CompoundFileFormatError('readCompoundFile input does not carry the compound-file signature (leading magic bytes are not D0 CF 11 E0 A1 B1 1A E1)');
  }
  if (bytes.length < HEADER_SIZE) {
    throw new CompoundFileFormatError(`compound file is ${bytes.length} bytes, shorter than the fixed ${HEADER_SIZE}-byte header`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Header fields and their [MS-CFB] 2.2 invariants. Sector shift is validated as exactly the version's mandated value (0x0009 for version 3, 0x000C for version 4) rather than merely "large enough to address the file": every other derived offset depends on it, and a header that disagrees with its own version is not a variant, it is corruption.
  const majorVersion = u16(view, 0x1a);
  if (majorVersion !== 3 && majorVersion !== 4) {
    throw new CompoundFileFormatError(`compound file major version ${majorVersion} is not 3 or 4`);
  }
  if (u16(view, 0x1c) !== 0xfffe) {
    throw new CompoundFileFormatError('compound file byte order is not little-endian');
  }
  const sectorShift = u16(view, 0x1e);
  if ((majorVersion === 3 && sectorShift !== 9) || (majorVersion === 4 && sectorShift !== 12)) {
    throw new CompoundFileFormatError(`compound file sector shift 2^${sectorShift} does not match major version ${majorVersion} (version 3 requires 512-byte sectors, version 4 requires 4096-byte)`);
  }
  const miniSectorShift = u16(view, 0x20);
  if (miniSectorShift !== 6) {
    throw new CompoundFileFormatError(`compound file mini sector shift 2^${miniSectorShift} is not the mandated 64-byte mini sector`);
  }
  const sectorSize = 1 << sectorShift;
  const miniSectorSize = 1 << miniSectorShift;
  const miniStreamCutoff = u32(view, 0x38);
  if (miniStreamCutoff < miniSectorSize) {
    throw new CompoundFileFormatError(`compound file mini stream cutoff ${miniStreamCutoff} is smaller than the ${miniSectorSize}-byte mini sector itself`);
  }
  // The cutoff is honoured as declared rather than required to be 0x1000: the spec fixes that value for producers, but which stream lives in the mini stream is the header field's own decision, and a reader that hardcoded 4096 would misplace every stream in a file whose producer wrote a different cutoff.
  const firstDirectorySector = u32(view, 0x30);
  const firstMiniFatSector = u32(view, 0x3c);
  const firstDifatSector = u32(view, 0x44);

  // Sector N occupies bytes [(N + 1) * sectorSize, (N + 2) * sectorSize): the header takes the first sectorSize bytes of the file (its second half is unused padding in version 3), so a sector number is valid only when the file fully contains its end. This derivation doubles as every chain's cycle bound -- a chain of more than sectorCount sectors must revisit one, because every valid sector number is below sectorCount.
  const sectorCount = Math.floor(bytes.length / sectorSize) - 1;
  if (sectorCount < 1) {
    throw new CompoundFileFormatError(`compound file holds no complete ${sectorSize}-byte sector after its header`);
  }
  const sectorOffset = (sector: number): number => HEADER_SIZE + sector * sectorSize;
  const sectorBytes = (sector: number): Uint8Array<ArrayBuffer> => bytes.subarray(sectorOffset(sector), sectorOffset(sector) + sectorSize);

  // The DIFAT: the header's 109-entry array, extended by DIFAT sectors chained through their final slot when the file has more FAT sectors than the header can name. FREESECT entries are padding, not locations.
  const fatSectorIds: number[] = [];
  const acceptFatSector = (sector: number, provenance: string): void => {
    if (sector === FREESECT) {
      return;
    }
    if (sector >= sectorCount) {
      throw new CompoundFileFormatError(`${provenance} names FAT sector ${sector}, which is outside the file's ${sectorCount} sectors`);
    }
    fatSectorIds.push(sector);
  };
  for (let i = 0; i < HEADER_DIFAT_ENTRIES; i++) {
    acceptFatSector(u32(view, 0x4c + i * 4), 'the header DIFAT array');
  }
  let difatSector = firstDifatSector;
  let difatSectorsWalked = 0;
  while (difatSector !== ENDOFCHAIN) {
    if (difatSector >= sectorCount) {
      throw new CompoundFileFormatError(`the DIFAT chain names sector ${difatSector}, which is outside the file's ${sectorCount} sectors`);
    }
    if (++difatSectorsWalked > sectorCount) {
      throw new CompoundFileFormatError('the DIFAT chain visits more sectors than the file holds, so it must cycle');
    }
    const difatView = new DataView(bytes.buffer, bytes.byteOffset + sectorOffset(difatSector), sectorSize);
    const entriesPerDifatSector = sectorSize / 4 - 1;
    for (let i = 0; i < entriesPerDifatSector; i++) {
      acceptFatSector(u32(difatView, i * 4), 'a DIFAT sector');
    }
    difatSector = u32(difatView, entriesPerDifatSector * 4);
  }
  if (fatSectorIds.length === 0) {
    throw new CompoundFileFormatError('compound file declares no FAT sectors, so no sector chain can be walked');
  }

  // One flat FAT table over the DIFAT-listed sectors, addressed by sector number: entry k of the table describes sector k.
  const fatBytes = new Uint8Array(fatSectorIds.length * sectorSize);
  for (let i = 0; i < fatSectorIds.length; i++) {
    fatBytes.set(sectorBytes(fatSectorIds[i] ?? 0), i * sectorSize);
  }
  const fat = new DataView(fatBytes.buffer);

  const fatEntry = (sector: number): number => {
    const offset = sector * 4;
    if (offset < 0 || offset + 4 > fatBytes.length) {
      throw new CompoundFileFormatError(`FAT entry for sector ${sector} lies beyond the sectors the DIFAT named`);
    }
    return fat.getUint32(offset, true);
  };

  const chainSectorIds = (start: number): number[] => {
    const ids: number[] = [];
    let current = start;
    while (current !== ENDOFCHAIN) {
      if (current >= sectorCount) {
        throw new CompoundFileFormatError(`a FAT chain steps to sector ${current}, which is outside the file's ${sectorCount} sectors`);
      }
      if (ids.length >= sectorCount) {
        throw new CompoundFileFormatError('a FAT chain visits more sectors than the file holds, so it must cycle');
      }
      ids.push(current);
      const next = fatEntry(current);
      if (next === FREESECT || next === FATSECT || next === DIFSECT) {
        throw new CompoundFileFormatError(`a FAT chain steps to sector ${current}'s entry ${next}, which is a sector-role marker, not a chain continuation`);
      }
      current = next;
    }
    return ids;
  };

  const chainBytes = (start: number): Uint8Array<ArrayBuffer> => {
    const ids = chainSectorIds(start);
    const out = new Uint8Array(ids.length * sectorSize);
    for (let i = 0; i < ids.length; i++) {
      out.set(sectorBytes(ids[i] ?? 0), i * sectorSize);
    }
    return out;
  };

  // The directory: a FAT chain of whole sectors, carved into 128-byte entries numbered from 0 across the whole chain. Header count fields (directory, FAT, mini-FAT sector counts) are deliberately not cross-checked against the chains: the chains are the authority, and real-world writers have historically botched the counts while writing walkable chains.
  const directoryBytes = chainBytes(firstDirectorySector);
  if (directoryBytes.length === 0) {
    throw new CompoundFileFormatError('compound file has an empty directory chain');
  }
  const directoryView = new DataView(directoryBytes.buffer);
  const entryCount = directoryBytes.length / 128;
  const nameDecoder = new TextDecoder('utf-16le');
  const entries: DirectoryEntry[] = [];
  for (let id = 0; id < entryCount; id++) {
    const base = id * 128;
    const nameLength = u16(directoryView, base + 0x40);
    // The length counts the terminating null, so the name itself is the first nameLength - 2 bytes of the field. Name and type are validated when the entry tree reaches an entry, not here: unallocated entries pad every directory sector to 4-per-sector and their bytes are arbitrary, so a parse-time check would reject well-formed files.
    entries.push({
      name: nameDecoder.decode(directoryBytes.subarray(base, base + Math.max(0, nameLength - 2))),
      nameLength,
      objectType: directoryView.getUint8(base + 0x42),
      leftSibling: u32(directoryView, base + 0x44),
      rightSibling: u32(directoryView, base + 0x48),
      child: u32(directoryView, base + 0x4c),
      startSector: u32(directoryView, base + 0x74),
      size: u32(directoryView, base + 0x78) + u32(directoryView, base + 0x7c) * 4294967296,
    });
  }
  const root = entries[0];
  // Only the root's type matters to reading -- its stream is the mini stream and its child starts the entry tree; its own name is the "Root Entry" convention and nothing depends on it.
  if (root === undefined || root.objectType !== OBJECT_TYPE_ROOT) {
    throw new CompoundFileFormatError('the first directory entry is not the root storage entry (object type 5), as [MS-CFB] 2.6.1 requires');
  }

  // The mini stream: the root entry's own stream, held in ordinary FAT sectors, carved into 64-byte mini sectors that streams shorter than the cutoff occupy.
  const miniStream = chainBytes(root.startSector).subarray(0, root.size);
  const miniSectorCount = Math.floor(miniStream.length / miniSectorSize);
  const miniFatBytes = chainBytes(firstMiniFatSector);
  const miniFat = new DataView(miniFatBytes.buffer);

  const miniChainSectorIds = (start: number): number[] => {
    const ids: number[] = [];
    let current = start;
    while (current !== ENDOFCHAIN) {
      if (current >= miniSectorCount) {
        throw new CompoundFileFormatError(`a mini-FAT chain steps to mini sector ${current}, which is outside the mini stream's ${miniSectorCount} mini sectors`);
      }
      if (ids.length >= miniSectorCount) {
        throw new CompoundFileFormatError('a mini-FAT chain visits more mini sectors than the mini stream holds, so it must cycle');
      }
      ids.push(current);
      const next = miniFat.getUint32(current * 4, true);
      if (next === FREESECT || next === FATSECT || next === DIFSECT) {
        throw new CompoundFileFormatError(`a mini-FAT chain steps to mini sector ${current}'s entry ${next}, which is a sector-role marker, not a chain continuation`);
      }
      current = next;
    }
    return ids;
  };

  let totalExtractedBytes = 0;
  const extractStream = (entry: DirectoryEntry): Uint8Array<ArrayBuffer> => {
    // A zero-length stream has no sectors and its starting sector location is meaningless ([MS-CFB] 2.6.1), so it extracts as empty without walking anything.
    if (entry.size === 0) {
      return new Uint8Array(0);
    }
    if (entry.size > Number.MAX_SAFE_INTEGER) {
      throw new CompoundFileFormatError(`stream '${entry.name}' declares a size beyond the integer range this reader addresses`);
    }
    let out: Uint8Array<ArrayBuffer>;
    if (entry.size < miniStreamCutoff) {
      const ids = miniChainSectorIds(entry.startSector);
      const raw = new Uint8Array(ids.length * miniSectorSize);
      for (let i = 0; i < ids.length; i++) {
        const miniSector = ids[i] ?? 0;
        raw.set(miniStream.subarray(miniSector * miniSectorSize, (miniSector + 1) * miniSectorSize), i * miniSectorSize);
      }
      out = raw;
    } else {
      out = chainBytes(entry.startSector);
    }
    if (out.length < entry.size) {
      throw new CompoundFileFormatError(`stream '${entry.name}' declares ${entry.size} bytes but its chain holds only ${out.length}`);
    }
    totalExtractedBytes += entry.size;
    if (totalExtractedBytes > maxTotalBytes) {
      throw new CompoundFileFormatError(`cumulative extracted stream size exceeded the ${maxTotalBytes}-byte budget at '${entry.name}'`);
    }
    return out.slice(0, entry.size);
  };

  // The entry tree: a storage's child link points at one child, whose left/right siblings are the storage's other children, and [MS-CFB] recommends (but only recommends) producers keep that sibling tree sorted and balanced -- so traversal is structural, not assuming any shape. In-order (left, self, right) gives the deterministic order a name-sorted tree would have. The walk is iterative, not recursive: sibling chains in real compound files can be long (balancing is only recommended), and a recursive walk would spend the call stack on them, failing a corrupted deep chain with a stack overflow instead of this reader's named error. A visited set catches sibling/child cycles and bounds each entry to one visit.
  const streams: CompoundFileStream[] = [];
  const visited = new Set<number>();
  type Frame = { readonly id: number; readonly prefix: string; readonly stage: 'descend' } | { readonly entry: DirectoryEntry; readonly prefix: string; readonly stage: 'self' };
  const stack: Frame[] = [{ id: root.child, prefix: '', stage: 'descend' }];
  for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
    if (frame.stage === 'descend') {
      const { id, prefix } = frame;
      if (id === NOSTREAM) {
        continue;
      }
      const entry = entries[id];
      // First encounter: bounds, cycle, and shape validation happen here only -- the self-stage revisit of the same entry must not trip the visited set.
      if (id >= entryCount || entry === undefined) {
        throw new CompoundFileFormatError(`the directory tree links to entry ${id}, which is outside the directory's ${entryCount} entries`);
      }
      if (visited.has(id)) {
        throw new CompoundFileFormatError(`the directory tree reaches entry ${id} twice, so its sibling and child links cycle`);
      }
      visited.add(id);
      if (entry.nameLength < 2 || entry.nameLength > 64 || entry.nameLength % 2 === 1) {
        throw new CompoundFileFormatError(`directory entry ${id} declares name length ${entry.nameLength}, which is not an even byte count between 2 and 64`);
      }
      if (entry.objectType !== OBJECT_TYPE_STORAGE && entry.objectType !== OBJECT_TYPE_STREAM && entry.objectType !== OBJECT_TYPE_ROOT) {
        throw new CompoundFileFormatError(`directory entry ${id} ('${entry.name}') carries object type ${entry.objectType}, which is not a storage (1), stream (2), or root (5) entry`);
      }
      // LIFO order: push the self frame first so the left subtree pops and completes before this entry's own emission, matching in-order (left, self, right).
      stack.push({ entry, prefix, stage: 'self' });
      stack.push({ id: entry.leftSibling, prefix, stage: 'descend' });
    } else if (frame.entry.objectType === OBJECT_TYPE_STREAM) {
      streams.push({ path: frame.prefix + frame.entry.name, bytes: extractStream(frame.entry) });
      stack.push({ id: frame.entry.rightSibling, prefix: frame.prefix, stage: 'descend' });
    } else if (frame.entry.objectType === OBJECT_TYPE_STORAGE) {
      stack.push({ id: frame.entry.rightSibling, prefix: frame.prefix, stage: 'descend' });
      stack.push({ id: frame.entry.child, prefix: `${frame.prefix}${frame.entry.name}/`, stage: 'descend' });
    } else {
      // Unallocated entries are padding no well-formed tree reaches, and a second type-5 entry would be a second root.
      throw new CompoundFileFormatError(`the directory tree reaches entry ${frame.entry.name}, which is not a storage or stream entry`);
    }
  }
  return streams;
}
