import { isCompoundFile, readCompoundFile } from "archive-codec";
import { readUint16LE } from "./bytes";
import { FIB_W_IDENT } from "./fib/offsets";

/** The stream a Word Binary File's FIB and text live in, [MS-DOC] 2.1.1. */
export const WORD_DOCUMENT_STREAM = "WordDocument";

/** The [MS-OLEPS] Property Set Stream a .doc's title/author/dates live in when present -- a genuinely optional stream, unlike WordDocument, since a valid Word Binary File need not carry document properties at all. */
export const SUMMARY_INFORMATION_STREAM = "\x05SummaryInformation";

// Whether these bytes are a Word Binary File. The compound-file signature alone is not enough to answer that: .xls and .ppt of the same era are compound files too, and so is any OLE embedding, so a detector that stopped at the magic bytes would claim every one of them. The distinguishing facts are the presence of a stream named "WordDocument" and the 0xA5EC signature at its own offset zero -- the two things [MS-DOC] requires of every conforming file and no sibling format has.
//
// This reads the whole container to answer, which is the honest cost of a correct answer: a compound file's directory is not at a fixed offset, so there is no cheaper place to look for a named stream. A caller with a path or a MIME type already in hand should use that instead of paying for this.
export function isDocBytes(bytes: Uint8Array<ArrayBuffer>): boolean {
  if (!isCompoundFile(bytes)) return false;
  let streams;
  try {
    streams = readCompoundFile(bytes);
  } catch {
    // A malformed container is not a .doc, and a detector's contract is to answer rather than to throw. The error is deliberately not rethrown or reported: a caller that wants the failure explained calls the reader, which surfaces it.
    return false;
  }
  const wordDocument = streams.find(
    (stream) => stream.path === WORD_DOCUMENT_STREAM,
  );
  if (wordDocument === undefined || wordDocument.bytes.length < 2) return false;
  return readUint16LE(wordDocument.bytes, 0) === FIB_W_IDENT;
}
