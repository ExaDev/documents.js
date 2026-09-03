import { isCompoundFile, readCompoundFile } from "archive-codec";
import { WpdNotAWordPerfectFileError } from "../errors";
import {
  hasWordPerfectFileId,
  readFileHeader,
  type WpdFileHeader,
} from "./header";
import { readPrefixPackets, type WpdPrefixPacket } from "./prefix";

// -- The two containers a WordPerfect 6.x-X6 document arrives in, per WPFF Document Structure, "WordPerfect X6 Files" --
//
// WordPerfect 6.x writes the prefix and document area straight to disk, so the file's first four bytes are the WP file ID. "WordPerfect added support for the Microsoft OLE Compound File format specification in WP7. The Compound document wraps the WordPerfect file ... The name of the WordPerfect Stream is PerfectOffice_MAIN. This stream holds the WP file."
//
// Both spellings are in scope and neither is a version signal on its own: "When creating WordPerfect 7/8 documents you do not need to include the OLE Compound Document wrapper. WordPerfect will read in WP 7/8 documents without it." So the container is decided by inspecting the bytes, exactly as the SDK instructs -- "if the file is a Compound file, the file id will be found at an offset within the Compound document and the application must check for and read the PerfectOffice_Main Stream to identify the file as a WordPerfect file" -- and never by the file's extension or its header's version bytes.
//
// The compound-file half is archive-codec's bounded MS-CFB reader rather than anything written here: a compound file's sectors, FAT chains, and directory entries are container structure with no document-format knowledge in them, which is precisely that package's charter.

// "The name of the WordPerfect Stream is PerfectOffice_MAIN." A root-level stream, so archive-codec reports its path with no storage prefix.
export const PERFECT_OFFICE_MAIN_STREAM = "PerfectOffice_MAIN";

// The storage holding OLE embedded objects, named here because the README's Remaining scope refers to it; nothing reads it yet.
export const PERFECT_OFFICE_OBJECTS_STORAGE = "PerfectOffice_OBJECTS";

export interface WpdDocumentContainer {
  readonly header: WpdFileHeader;
  readonly packets: readonly WpdPrefixPacket[];
  // The WordPerfect file's own bytes: the buffer itself for a bare WP 6.x file, or the PerfectOffice_MAIN stream's contents for an OLE-wrapped one.
  readonly bytes: Uint8Array<ArrayBuffer>;
  // Where the document area begins, and where this reader stops walking it.
  readonly documentAreaOffset: number;
  readonly documentAreaEnd: number;
  // True when the bytes arrived inside an OLE compound file. Recorded because it is the one fact about the container a caller can act on -- an OLE-wrapped file may carry embedded objects a bare one cannot.
  readonly compound: boolean;
}

// document-schema.js's ContentCodec port types a read as taking a plain Uint8Array, whose backing buffer may be a SharedArrayBuffer, while archive-codec's compound-file reader requires an ArrayBuffer-backed view. A type predicate resolves the two soundly rather than asserting past the difference: the overwhelmingly common case narrows with no copy at all, and a genuinely shared-memory view is copied into its own ArrayBuffer, which is the only honest way to produce a value of a type it does not already have.
function isArrayBufferBacked(
  bytes: Uint8Array,
): bytes is Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer;
}

function toArrayBufferBacked(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (isArrayBufferBacked(bytes)) {
    return bytes;
  }
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

// Pulls the WordPerfect byte stream out of whichever container holds it. A buffer that is neither a bare WordPerfect file nor a compound file carrying a PerfectOffice_MAIN stream is not a WordPerfect document, and says so rather than being parsed speculatively.
function unwrapContainer(bytes: Uint8Array<ArrayBuffer>): {
  bytes: Uint8Array<ArrayBuffer>;
  compound: boolean;
} {
  if (hasWordPerfectFileId(bytes)) {
    return { bytes, compound: false };
  }
  if (isCompoundFile(bytes)) {
    const main = readCompoundFile(bytes).find(
      (stream) => stream.path === PERFECT_OFFICE_MAIN_STREAM,
    );
    if (main === undefined) {
      throw new WpdNotAWordPerfectFileError(
        `This OLE compound file carries no ${PERFECT_OFFICE_MAIN_STREAM} stream, so it holds no WordPerfect document.`,
      );
    }
    return { bytes: main.bytes, compound: true };
  }
  throw new WpdNotAWordPerfectFileError(
    "These bytes are neither a WordPerfect file (which opens with the file ID FF 57 50 43) nor an OLE compound file that could contain one.",
  );
}

// Where the document area stops. The header's own {file size} would be the answer if it could be trusted, and the SDK is unusually direct that it often cannot: "A common problem occurs when this field is not updated after creating a file or modifying an existing file. If the file size points to the beginning of the document area, then text is added to the document, this field must be updated or it will appear that the document is blank." So the field is honoured only where it is self-consistent -- past the document area's start and within the bytes actually present -- and the buffer's own end is used otherwise. Believing a stale field over the bytes in hand is exactly how a real document reads back empty.
function documentAreaEnd(
  bytes: Uint8Array<ArrayBuffer>,
  header: WpdFileHeader,
): number {
  const { fileSize, documentAreaOffset } = header;
  if (fileSize > documentAreaOffset && fileSize <= bytes.length) {
    return fileSize;
  }
  return bytes.length;
}

export function openWpdDocument(input: Uint8Array): WpdDocumentContainer {
  const { bytes, compound } = unwrapContainer(toArrayBufferBacked(input));
  const header = readFileHeader(bytes);
  const packets = readPrefixPackets(bytes, header);
  return {
    header,
    packets,
    bytes,
    documentAreaOffset: header.documentAreaOffset,
    documentAreaEnd: documentAreaEnd(bytes, header),
    compound,
  };
}
