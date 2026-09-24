// A minimal wordprocessing ContentDocument builder shared by the RTF writer's own test suite: every test needs a full document to hand writeRtfContent, but almost none of them care about anything beyond a single section's blocks, so this fixes the page geometry and margins once and lets each test supply only what it's actually asserting on.

import type { ContentDocument, ContentSection } from "document-schema.js";
import { asciiText } from "./bytes";
import { writeRtfContent } from "../write";

export const LETTER_SECTION: Omit<ContentSection, "blocks"> = {
  pageSize: { widthPt: 612, heightPt: 792 },
  margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
};

export function wordprocessing(
  blocks: ContentSection["blocks"],
  metadata: ContentDocument["metadata"] = {},
): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata,
    sections: [{ ...LETTER_SECTION, blocks }],
  };
}

// Writes a document and decodes the result back to a string for assertion — the writer's own output is 7-bit ASCII by construction, so this is exact, never lossy, unlike decoding through a codepage.
export function write(document: ContentDocument): string {
  return asciiText(writeRtfContent(document));
}
