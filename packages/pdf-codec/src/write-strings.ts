// The PDF string/date/info-dict helpers, split from write.ts: text string encoding with its UTF-16 pair re-encoding, the two-digit pad, ISO-date formatting, and the /Info dictionary builder.
import type { LayoutDocument } from "./layout";
import type { PdfDict, PdfObject } from "./objects";
import { BITS_PER_BYTE, BYTE_MASK } from "./write-images";
import { pdfDict, pdfHexString } from "./objects";

export function textToPdfString(text: string): PdfObject {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xfe;
  bytes[1] = 0xff;
  // split("") yields one single-code-unit string per element — the UTF-16 code units themselves, surrogate halves included, which is what the pair-at-a-time re-encoding below consumes. The write position is driven by its own running offset rather than by an index bounded on text.length because the target array is sized to exactly that length: an off-by-one past its end writes into the void, where no assertion could ever see it.
  let offset = 2;
  for (const unit of text.split("")) {
    const code = unit.charCodeAt(0);
    bytes[offset] = (code >> BITS_PER_BYTE) & BYTE_MASK;
    bytes[offset + 1] = code & BYTE_MASK;
    offset += 2;
  }
  return pdfHexString(bytes);
}

export function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function formatPdfDate(iso: string): string {
  const date = new Date(iso);
  return `D:${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;
}

export function buildInfoDict(doc: LayoutDocument): PdfDict {
  const entries = new Map<string, PdfObject>();
  // Always this package's own identity, regardless of doc.metadata.producer (which describes whatever produced the *source* document this LayoutDocument came from, not this PDF) — deliberately no version string, so byte-golden tests never need updating on a version bump.
  entries.set("Producer", textToPdfString("documents.js"));
  if (doc.metadata.title !== undefined) {
    entries.set("Title", textToPdfString(doc.metadata.title));
  }
  if (doc.metadata.author !== undefined) {
    entries.set("Author", textToPdfString(doc.metadata.author));
  }
  if (doc.metadata.subject !== undefined) {
    entries.set("Subject", textToPdfString(doc.metadata.subject));
  }
  if (doc.metadata.keywords !== undefined) {
    entries.set("Keywords", textToPdfString(doc.metadata.keywords.join(", ")));
  }
  if (doc.metadata.creator !== undefined) {
    entries.set("Creator", textToPdfString(doc.metadata.creator));
  }
  if (doc.metadata.createdIso !== undefined) {
    entries.set(
      "CreationDate",
      textToPdfString(formatPdfDate(doc.metadata.createdIso)),
    );
  }
  if (doc.metadata.modifiedIso !== undefined) {
    entries.set(
      "ModDate",
      textToPdfString(formatPdfDate(doc.metadata.modifiedIso)),
    );
  }
  return pdfDict(entries);
}
