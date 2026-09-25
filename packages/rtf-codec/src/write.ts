// The write side: a ContentDocument or DocumentTree to RTF bytes, deterministic and byte-stable for one input.
//
// The output targets the same <File> production the reader reads — '{' <header> <document> '}' — and states its header tables in the order the grammar requires (\rtf1, character set, \deffN, then \fonttbl, \colortbl, \stylesheet, the list tables), because "each of the various header tables should appear, if they exist, in this order" and "a property must be defined before being referenced" (RTF 1.9.1, "Header").
//
// THREE TABLES ARE MINTED, NOT COPIED. A ContentDocument carries fonts as free-text family names on runs, colours as sRGB triples, headings as a canonical level, and lists as an opaque numId — none of them as the indices RTF's body actually references. So the writer walks the document once to collect every distinct font family, colour, heading level, and list, mints the four tables from what it found, and then walks it again to emit a body whose \fN, \cfN, \sN and \lsN indices point into them. Two passes, not one, because a table has to be complete before the body that references it is written.
//
// EVERY NON-ASCII CHARACTER LEAVES AS \uN. RTF's own advice is to emit "\uN followed by the best ANSI representation it can manage. Often a question mark is used if no reasonable ANSI character exists", and that is exactly what this writer does, with \uc1 declared once so the fallback is one character. It deliberately does NOT try to find a code page that could carry a given character as a \'hh byte: the output is then pure 7-bit ASCII whatever the input contained, which is the property that makes it safe to transmit and trivially diffable, and it costs nothing a reader can see — a conforming reader takes \uN and discards the fallback. A character outside the Basic Multilingual Plane is emitted as its two UTF-16 code units, which is what "\uN ... represents the Unicode character value expressed as a decimal number" means for a format whose parameter is a signed 16-bit integer, and matches the spec's own instruction that "Unicode values greater than 32767 are expressed as negative numbers".
//
// The RtfWriter class this module once built has been split into a plain, explicitly-threaded Writer state object (write-state.ts) plus a handful of write-*.ts modules, one per writing concern (write-header.ts, write-body.ts, write-table.ts, write-image.ts), each holding the functions that used to be that concern's own private methods. This module keeps only the top-level orchestration: mint the tables, write the header, walk the sections, encode the result.

import type { ContentDocument, DocumentTree } from "document-schema.js";
import {
  RtfDiagnosticCodes,
  RtfUnsupportedDocumentKindError,
  type RtfDiagnosticSink,
} from "./diagnostics";
import type { WriteRtfOptions } from "./options";
import { collectTables } from "./write-tables";
import { writeHeader } from "./write-header";
import { writeSection } from "./write-body";
import { raw, type Writer } from "./write-state";
import { flattenTree } from "document-schema.js";

// Strips a character down to the 7-bit ASCII range encodeAscii below produces.
const ASCII_7BIT_MASK = 0x7f;

// The return type is the narrower Uint8Array<ArrayBuffer>, not the default Uint8Array<ArrayBufferLike>, matching document-schema.js's own ProvidedFont.bytes and documents.js's package codecs: a SharedArrayBuffer-backed view is not something this writer can produce, and z.instanceof(Uint8Array)'s own inferred output type is the narrow one, so widening here would make the z.codec() pair in src/codec.ts fail to typecheck.
function encodeAscii(text: string): Uint8Array<ArrayBuffer> {
  // Uint8Array.from's own array-like traversal (length + per-index mapfn), not a hand-written index < text.length loop: a preallocated Uint8Array silently ignores an out-of-bounds index assignment rather than throwing or growing, so an off-by-one loop bound here is unobservable through `out` regardless of the comparison used — Array.from removes the comparison as an AST node entirely rather than leaving an equivalent one standing.
  return Uint8Array.from(
    { length: text.length },
    (_, index) => text.charCodeAt(index) & ASCII_7BIT_MASK,
  );
}

export function writeRtfContent(
  document: ContentDocument,
  options: WriteRtfOptions = {},
): Uint8Array<ArrayBuffer> {
  options.signal?.throwIfAborted();
  if (document.kind !== "wordprocessing") {
    throw new RtfUnsupportedDocumentKindError(document.kind);
  }
  const sink: RtfDiagnosticSink =
    options.sink ??
    (() => {
      /* discards every diagnostic */
    });
  const writer: Writer = {
    out: "",
    openConstructs: [],
    tables: collectTables(document),
    sink,
    lineEnding: options.lineEnding ?? "\n",
  };
  writeHeader(writer, document);
  for (const [index, section] of document.sections.entries()) {
    writeSection(writer, section, index === 0);
  }
  raw(writer, "}");
  // The output is 7-bit ASCII by construction: every reserved character is escaped and every non-ASCII character left as a \uN, so encoding it one byte per code unit is exact rather than lossy.
  return encodeAscii(writer.out);
}

export function writeRtf(
  documentPackage: DocumentTree,
  options: WriteRtfOptions = {},
): Uint8Array<ArrayBuffer> {
  const sink = options.sink;
  if (sink !== undefined && hasPackageTables(documentPackage)) {
    sink({
      code: RtfDiagnosticCodes.PACKAGE_TABLE_DROPPED,
      severity: "info",
      message:
        "the package's definitions/layers/attachments/destinations tables are dropped: flattening resolves style refs, and RTF has no destination for the remaining tenants",
    });
  }
  return writeRtfContent(flattenTree(documentPackage), options);
}

function hasPackageTables(documentPackage: DocumentTree): boolean {
  return (
    documentPackage.definitions !== undefined ||
    documentPackage.layers !== undefined ||
    documentPackage.attachments !== undefined ||
    documentPackage.destinations !== undefined
  );
}
