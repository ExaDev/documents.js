import type { ContentCodec } from "document-schema.js";
import { z } from "zod";
import { WPD_FILE_ID } from "./container/header";
import { readWpdContent, type ReadWpdOptions } from "./read";

// wpdContentCodec: this package's read half stated as document-schema.js's own ContentCodec port, so a consumer dispatching over formats treats WordPerfect exactly as it treats every other one.
//
// Deliberately a bare ContentCodec rather than a z.codec() pair, which is what markdown-codec, epub-codec, and pdf-codec each expose. A z.codec() needs both directions, and there is no WordPerfect writer here — nor is one planned in this package's current scope. ContentCodec models that asymmetry as a first-class shape (`write` is optional on it precisely because the odf formula reader has the same permanent one-directional shape), so a read-only entry is the honest expression rather than a gap.

// The cheap, real magic-byte fact a WordPerfect document carries — either the -1,"WPC" file ID directly, or the OLE compound file signature of a WP7-and-later wrapper that may contain one. Matching pdf-codec's PdfBytesSchema and epub-codec's EpubBytesSchema precedent: a header check, not a parse. It deliberately does not also verify that a compound file genuinely holds a PerfectOffice_MAIN stream, which would mean reading the whole compound file inside schema validation, duplicating work readWpdContent already does and reporting it less specifically than WpdNotAWordPerfectFileError already does at read time.
//
// The Microsoft OLE2/Compound File Binary Format's own fixed 8-byte signature (D0 CF 11 E0 A1 B1 1A E1), not derivable from any ASCII reading; it predates any text encoding of its own.
const OLE_SIGNATURE_BYTE_0 = 0xd0;
const OLE_SIGNATURE_BYTE_1 = 0xcf;
const OLE_SIGNATURE_BYTE_2 = 0x11;
const OLE_SIGNATURE_BYTE_3 = 0xe0;
const OLE_SIGNATURE_BYTE_4 = 0xa1;
const OLE_SIGNATURE_BYTE_5 = 0xb1;
const OLE_SIGNATURE_BYTE_6 = 0x1a;
const OLE_SIGNATURE_BYTE_7 = 0xe1;
const COMPOUND_FILE_ID = [
  OLE_SIGNATURE_BYTE_0,
  OLE_SIGNATURE_BYTE_1,
  OLE_SIGNATURE_BYTE_2,
  OLE_SIGNATURE_BYTE_3,
  OLE_SIGNATURE_BYTE_4,
  OLE_SIGNATURE_BYTE_5,
  OLE_SIGNATURE_BYTE_6,
  OLE_SIGNATURE_BYTE_7,
];

function hasWordPerfectOrCompoundHeader(bytes: Uint8Array): boolean {
  return (
    WPD_FILE_ID.every((byte, index) => bytes[index] === byte) ||
    COMPOUND_FILE_ID.every((byte, index) => bytes[index] === byte)
  );
}

export const WpdBytesSchema = z
  .instanceof(Uint8Array)
  .refine(hasWordPerfectOrCompoundHeader, {
    message:
      "not a WordPerfect document (no FF 57 50 43 file ID, and no OLE compound file signature that could wrap one)",
  });

export const wpdContentCodec: ContentCodec<ReadWpdOptions> = {
  read: (bytes, options) => readWpdContent(bytes, options),
};
