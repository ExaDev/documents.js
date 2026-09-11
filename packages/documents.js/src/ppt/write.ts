import type { ContentDocument } from "document-schema.js";
import { writeDocContent } from "doc-codec";
import { writePptContent as writePptFlat } from "ppt-codec";
import { writeXlsContent } from "xls-codec";

// ContentDocument -> bytes (the presentation variant). A thin adapter over ppt-codec's own writePptContent, which -- unlike buildPptxPackage/buildOdpPackage (src/edit/pptx/content.ts, src/edit/odp/content.ts), both of which already take a full ContentDocument and narrow it internally -- takes the flat PptDocument shape { metadata, slides } directly. So this module's whole job is the narrow-and-unwrap those two builders already do internally via their own `content.kind !== 'presentation'` check: read.ts's own envelope wrap, run in reverse.
//
// The second job is the write-side mirror of read.ts's decode wiring: ppt-codec cannot itself turn a shape's own embedded-object document back into [MS-CFB] storage bytes, since it depends on no sibling format codec. serialiseEmbeddedObject dispatches on the nested document's own kind to whichever codec here already writes that shape -- doc-codec/xls-codec directly, and this module's own writePptContent recursively for a nested presentation (a .ppt embedding another .ppt is exactly as legitimate as one embedding a Word document) -- returning undefined for a kind none of those three can serialise (formula/drawing/chart have no legacy-Office binary spelling), which ppt-codec's own writer degrades to a shape carrying no clientData at all, identical to a shape whose embedded object it was never handed in the first place.
function serialiseEmbeddedObject(
  document: ContentDocument,
): Uint8Array<ArrayBuffer> | undefined {
  switch (document.kind) {
    case "wordprocessing":
      return writeDocContent(document);
    case "spreadsheet":
      return writeXlsContent(document);
    case "presentation":
      return writePptContent(document);
    case "formula":
    case "drawing":
      return undefined;
  }
}

export function writePptContent(
  content: ContentDocument,
): Uint8Array<ArrayBuffer> {
  if (content.kind !== "presentation") {
    throw new Error(
      `writePptContent requires a presentation ContentDocument, got '${content.kind}'`,
    );
  }
  return writePptFlat(
    { metadata: content.metadata, slides: content.slides },
    { serialiseEmbeddedObject },
  );
}
