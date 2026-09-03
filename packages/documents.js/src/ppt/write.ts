import type { ContentDocument } from "document-schema.js";
import { writePptContent as writePptFlat } from "ppt-codec";

// ContentDocument -> bytes (the presentation variant). A thin adapter over ppt-codec's own writePptContent, which -- unlike buildPptxPackage/buildOdpPackage (src/edit/pptx/content.ts, src/edit/odp/content.ts), both of which already take a full ContentDocument and narrow it internally -- takes the flat PptDocument shape { metadata, slides } directly. So this module's whole job is the narrow-and-unwrap those two builders already do internally via their own `content.kind !== 'presentation'` check: read.ts's own envelope wrap, run in reverse.
export function writePptContent(
  content: ContentDocument,
): Uint8Array<ArrayBuffer> {
  if (content.kind !== "presentation") {
    throw new Error(
      `writePptContent requires a presentation ContentDocument, got '${content.kind}'`,
    );
  }
  return writePptFlat({ metadata: content.metadata, slides: content.slides });
}
