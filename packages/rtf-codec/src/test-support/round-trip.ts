// Writes a document to RTF and reads it straight back, for the writer test suite's own round-trip assertions: what a real consumer would see after this package's writer hands its output to this package's own reader.

import type { ContentDocument } from "document-schema.js";
import { readRtfContent } from "../read";
import { writeRtfContent } from "../write";

export function roundTrip(document: ContentDocument): ContentDocument {
  return readRtfContent(writeRtfContent(document)).document;
}
