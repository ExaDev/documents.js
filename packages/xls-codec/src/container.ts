import { isCompoundFile, readCompoundFile } from "archive-codec";

import { BiffFormatError } from "./biff/records";

// The outer half of a .xls file. A workbook is not a bare BIFF stream on disk: it lives inside an [MS-CFB] compound file -- a small filesystem in a file, the same container .doc and .ppt use -- as a stream named "Workbook" ([MS-XLS] 2.1.7.20). https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/f682f4b0-8c6b-444e-83f8-52d156f1e8ba
//
// archive-codec's bounded CFB reader does the container work, so this module is only the stream selection on top of it -- which is also why a Microsoft Works .xlr reads through this package with no special-casing: Works 9 writes the identical BIFF8 "Workbook" stream and adds its own "WksSSWorkBook" stream beside it, and selecting by name simply ignores the extra one.

/** The stream a BIFF8 workbook lives in. Matched exactly and case-sensitively, which is how archive-codec reports a directory entry's name. */
const WORKBOOK_STREAM = "Workbook";

/** BIFF5 and BIFF7 workbooks name their stream "Book" instead. Recognised only to say so in an error, never read: those are different formats record-for-record, not older spellings of this one. */
const LEGACY_WORKBOOK_STREAM = "Book";

/** The [MS-OLEPS] Property Set Stream a .xls's title/author/dates live in when present ([MS-OSHARED] 2.3.3.2.2) -- a genuinely optional stream, unlike Workbook, since a valid BIFF8 workbook need not carry document properties at all. */
export const SUMMARY_INFORMATION_STREAM = "\x05SummaryInformation";

/** An MBD Embedding Storage's own directory name ([MS-XLS] 2.1.7): "MBD" followed by the eight-uppercase-hex-digit spelling of the storage id an embedded object's own FtPictFmla names -- workbook/drawing-writer.ts writes exactly this spelling, and a real producer's own embeddings use the identical convention. */
const EMBEDDING_STORAGE_PATTERN = /^MBD([0-9A-F]{8})\/Package$/;

export interface WorkbookStreams {
  readonly workbook: Uint8Array<ArrayBuffer>;
  /** The raw "\x05SummaryInformation" stream bytes, or undefined when the container carries none. */
  readonly metadata: Uint8Array<ArrayBuffer> | undefined;
  /** Every "MBD<hex>/Package" Embedding Storage's own Package-stream bytes, keyed by the storage id its directory name spells -- an embedded object's own FtPictFmla names this same id (workbook/drawing.ts's own readEmbeddedObjectPackage resolves it). Empty when the workbook embeds no OLE object at all. */
  readonly embeddingStreams: ReadonlyMap<number, Uint8Array<ArrayBuffer>>;
}

/**
 * Extracts the BIFF8 record stream, and the optional metadata stream beside it, from a .xls file's compound-file container.
 *
 * Throws rather than returning undefined for anything that is not a readable BIFF8 workbook: a caller wanting a soft answer asks isXlsFile first.
 */
export function readWorkbookStreams(
  bytes: Uint8Array<ArrayBuffer>,
): WorkbookStreams {
  if (!isCompoundFile(bytes)) {
    throw new BiffFormatError(
      "not a compound file: a .xls workbook is a [MS-CFB] container holding a 'Workbook' stream",
    );
  }
  const streams = readWorkbookContainer(bytes);
  const workbook = streams.find((stream) => stream.path === WORKBOOK_STREAM);
  if (workbook !== undefined) {
    const metadata = streams.find(
      (stream) => stream.path === SUMMARY_INFORMATION_STREAM,
    );
    const embeddingStreams = new Map<number, Uint8Array<ArrayBuffer>>();
    for (const stream of streams) {
      const match = EMBEDDING_STORAGE_PATTERN.exec(stream.path);
      if (match?.[1] !== undefined) {
        embeddingStreams.set(Number.parseInt(match[1], 16), stream.bytes);
      }
    }
    return {
      workbook: workbook.bytes,
      metadata: metadata?.bytes,
      embeddingStreams,
    };
  }
  if (streams.some((stream) => stream.path === LEGACY_WORKBOOK_STREAM)) {
    throw new BiffFormatError(
      "compound file holds a 'Book' stream rather than a 'Workbook' stream, so it is a BIFF5/BIFF7 workbook; this reader implements BIFF8 only",
    );
  }
  throw new BiffFormatError(
    "compound file holds no 'Workbook' stream, so it is not a .xls workbook",
  );
}

/** archive-codec's own reader, with every failure it can throw -- its own typed CompoundFileFormatError, or a raw RangeError from a DataView read on a malformed mini-FAT chain -- wrapped into BiffFormatError, so a caller catching that one type sees one error type for "this is not a workbook this package can read" regardless of which layer inside archive-codec actually noticed the corruption. */
function readWorkbookContainer(
  bytes: Uint8Array<ArrayBuffer>,
): ReturnType<typeof readCompoundFile> {
  try {
    return readCompoundFile(bytes);
  } catch (error) {
    throw new BiffFormatError(
      `compound-file container could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Whether these bytes are a workbook this package can read.
 *
 * Checks for the compound-file container AND a "Workbook" stream inside it, rather than the container magic alone: .doc, .ppt, .msg, and a dozen other things are compound files too, so the magic bytes on their own would claim a Word document is a spreadsheet. A Microsoft Works .xlr passes, deliberately -- it carries the same BIFF8 "Workbook" stream.
 */
export function isXlsFile(bytes: Uint8Array<ArrayBuffer>): boolean {
  if (!isCompoundFile(bytes)) {
    return false;
  }
  try {
    return readCompoundFile(bytes).some(
      (stream) => stream.path === WORKBOOK_STREAM,
    );
  } catch {
    // A container too malformed to enumerate is not a workbook this package can read, which is exactly what this predicate reports. The caller that wants the reason calls readWorkbookStreams and catches its error.
    return false;
  }
}
