import { isZipArchive } from "./detect";
import { unzipPackage } from "./container";

// Depth derivation: real producers do not nest archives deeply. The motivating case -- an OOXML package embedding another OOXML package as an OLE object (word/embeddings/*.xlsx) -- bottoms out at depth 2, and the deepest legitimate nesting the format ecosystem emits (J2EE packaging, where an EAR embeds WARs that themselves embed JARs) tops out around depth 3. 8 more than doubles that ceiling before any honest document is rejected, while still bounding the recursion against adversarial input: a ZIP quine is depth-unbounded, and without a cap a single crafted archive would recurse until the host exhausts memory. An entry's depth is its ancestors.length + 1 (entries of the root archive are depth 1).
export const MAX_WALK_DEPTH = 8;

// Cumulative-size derivation: byte-codec caps one honest decompressed stream at 512 MiB (its MAX_INFLATE_OUTPUT_BYTES), and that per-stream cap does not compose across recursion -- N nested levels each "honest" under it multiply to N x 512 MiB, and a bomb's leverage is exactly that multiplication (a megabyte archive can declare terabytes of nested content). One budget shared across every entry of every nesting level turns the multiplication into addition bounded at a single figure. The same 512 MiB the family already grants one stream serves, since a recursive walk over honest documents decompresses a handful of complete documents, which must fit inside what one single stream already gets. Counted post-hoc on actual decompressed lengths -- declared sizes in hostile headers must not be trusted -- matching byte-codec's own post-hoc per-stream cap; the transient in-memory peak is thereby bounded by the budget plus at most one archive's contents.
export const MAX_WALK_TOTAL_BYTES = 512 * 1024 * 1024;

// One entry of the flattened walk listing. ancestors is the chain of nested-ZIP entry paths leading to the entry's own archive, outermost first -- for a file inside word/embeddings/oleObject1.xlsx within a docx, ancestors is ['word/embeddings/oleObject1.xlsx'] and path is the file's path within that embedded package. An entry's depth is ancestors.length + 1.
export interface ArchiveWalkEntry {
  readonly path: string;
  readonly ancestors: readonly string[];
  readonly bytes: Uint8Array<ArrayBuffer>;
}

export type ArchiveWalkLimit = "depth" | "total-bytes";

// Thrown when a walk exceeds its depth cap or cumulative decompressed-bytes budget. A distinct error class (rather than a plain Error) because the guards are this package's reason to exist: a consumer must be able to discriminate a limit hit from a corrupt-archive failure and decide its own degradation, which the limit field provides.
export class ArchiveWalkLimitError extends Error {
  readonly limit: ArchiveWalkLimit;

  constructor(limit: ArchiveWalkLimit, message: string) {
    super(message);
    this.name = "ArchiveWalkLimitError";
    this.limit = limit;
  }
}

export interface WalkArchiveOptions {
  readonly maxDepth?: number;
  readonly maxTotalBytes?: number;
}

// Recursively walks a ZIP archive: lists every entry of the root archive, detects entries that are themselves ZIPs by their leading magic bytes, and descends into them, returning one flat listing of every inner entry with its ancestor chain. Both guards throw rather than truncate -- an input outside the contract must fail loudly, never silently return a partial listing that looks complete (an adversarial nest is exactly the input most likely to hit a cap).
export function walkArchive(
  bytes: Uint8Array<ArrayBuffer>,
  options: WalkArchiveOptions = {},
): ArchiveWalkEntry[] {
  const maxDepth = options.maxDepth ?? MAX_WALK_DEPTH;
  const maxTotalBytes = options.maxTotalBytes ?? MAX_WALK_TOTAL_BYTES;
  if (!isZipArchive(bytes)) {
    throw new Error(
      "walkArchive input is not a ZIP archive (leading magic bytes are not PK\\x03\\x04 or PK\\x05\\x06)",
    );
  }
  const entries: ArchiveWalkEntry[] = [];
  let totalBytes = 0;
  visit(bytes, []);
  return entries;

  // visit() lists archive's entries at depth ancestors.length + 1. The depth check fires at descent time, before the too-deep archive is decompressed at all.
  function visit(
    archive: Uint8Array<ArrayBuffer>,
    ancestors: readonly string[],
  ): void {
    const depth = ancestors.length + 1;
    if (depth > maxDepth) {
      throw new ArchiveWalkLimitError(
        "depth",
        `archive nesting exceeds the maximum walk depth of ${maxDepth} at ${ancestors.join(" > ")}`,
      );
    }
    for (const [path, entryBytes] of Object.entries(unzipPackage(archive))) {
      // Directory entries (trailing '/', zero bytes) contribute nothing to the budget and can never match the ZIP magic.
      totalBytes += entryBytes.length;
      if (totalBytes > maxTotalBytes) {
        throw new ArchiveWalkLimitError(
          "total-bytes",
          `cumulative decompressed size of the walk exceeded the ${maxTotalBytes}-byte budget at ${path}`,
        );
      }
      entries.push({ path, ancestors, bytes: entryBytes });
      if (isZipArchive(entryBytes)) {
        visit(entryBytes, [...ancestors, path]);
      }
    }
  }
}
