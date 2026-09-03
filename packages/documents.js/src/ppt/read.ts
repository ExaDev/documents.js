import type { ContentDocument } from "document-schema.js";
import { readPptContent as readPptFlat } from "ppt-codec";

// Bytes -> ContentDocument (the presentation variant). A thin adapter over ppt-codec's own readPptContent (imported here as readPptFlat because this module's own export already holds that name; the same aliasing src/ooxml/pptx/read.ts and src/odf/odp/read.ts use for the identical reason), mirroring those two modules exactly: ppt-codec's PptDocument is already { metadata, slides }, the identical flat shape ooxml.js's own readPptxContent and odf.js's own readOdpContent produce before those two adapters wrap them, so this is nothing more than the envelope wrap. Unlike the ooxml/odf adapters, there is no second pass to splice in here -- ppt-codec has no embedded-formula or vector-recovery detection of its own (see that package's README scope note), so wrapping the flat result is genuinely the whole job.
export function readPptContent(
  bytes: Uint8Array<ArrayBuffer>,
): ContentDocument {
  const { metadata, slides } = readPptFlat(bytes);
  return {
    kind: "presentation",
    metadata: { ...metadata },
    slides: [...slides],
  };
}
