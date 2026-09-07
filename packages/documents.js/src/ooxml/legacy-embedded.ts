import type {
  ContentDocument,
  ContentEmbeddedObjectKind,
} from "document-schema.js";
import { isCompoundFile } from "archive-codec";
import { readDocContent } from "doc-codec";
import { readXlsContent } from "xls-codec";
import { readPptContent } from "../ppt/read";

// A classic OLE compound-file embedding (word|ppt/embeddings/oleObjectN.bin) holds either a modern
// producer's whole nested OOXML package -- a ZIP, or a ZIP wrapped in the compound file's own "Package" stream -- which ooxml.js's own embedded-object reader (typed/embedded.ts) already recovers, or a classic Word 97/Excel 97/PowerPoint 97 document, whose native streams sit directly in the compound file's OWN root storage with no "Package" stream at all. ooxml.js has no reader for that second shape (doc-codec/xls-codec/ppt-codec exist to decode exactly those three formats, but ooxml.js cannot depend on its own siblings without inventing a peer edge between format codecs -- ExaDev/documents.js#921), so this composes the three legacy readers here instead, the one place in this workspace that already depends on ooxml.js and all three legacy codecs at once.
//
// Each legacy reader's own first step is archive-codec's readCompoundFile, which throws immediately on bytes that don't carry a stream its format expects (doc-codec's DocFormatError when no "WordDocument" stream exists, xls-codec's BiffFormatError, ppt-codec's own PptFormatError/ PptEncryptedError) -- so trying all three in turn on a payload that turns out to be, say, an .xls costs two cheap, near-instant stream-name lookups before the third succeeds, never a wasted full parse. A payload this cannot place as any of the three (a compound file holding some other kind of legacy OLE object entirely, or one this workspace has no reader for) degrades to undefined, exactly the same second-order-content tier ooxml.js's own embedded-object reader already applies to a payload it cannot decode -- one bad embedding never fails the host document's own read.
export interface LegacyEmbeddedPayload {
  readonly objectKind: Extract<
    ContentEmbeddedObjectKind,
    "wordprocessing" | "spreadsheet" | "presentation"
  >;
  readonly document: ContentDocument;
}

export function decodeLegacyEmbeddedObject(
  bytes: Uint8Array<ArrayBuffer>,
): LegacyEmbeddedPayload | undefined {
  if (!isCompoundFile(bytes)) {
    return undefined;
  }
  try {
    return { objectKind: "wordprocessing", document: readDocContent(bytes) };
  } catch {
    // Not a Word Binary File -- fall through to the next candidate format.
  }
  try {
    return { objectKind: "spreadsheet", document: readXlsContent(bytes) };
  } catch {
    // Not a BIFF8 workbook -- fall through to the next candidate format.
  }
  try {
    return { objectKind: "presentation", document: readPptContent(bytes) };
  } catch {
    // Not a PowerPoint 97 deck either -- no legacy reader here can place this payload.
  }
  return undefined;
}
