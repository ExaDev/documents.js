import type { LayoutMetadata } from "document-schema.js";
import type { ClockPort } from "../ports/clock";

// The single write-side precedence rule every create*/build*Package entry point (createDocx/createPptx/createOdt/createOdp/createOds/createOdg, buildDocxPackage/buildPptxPackage/buildOdtPackage/buildOdpPackage/buildOdsPackage/buildOdgPackage) calls before stamping a document's docProps/core.xml (OOXML) or office:meta (ODF): a document that already carries BOTH createdIso and modifiedIso keeps them completely untouched -- the clock (src/ports/clock.ts's own ClockPort) is never even consulted in that case, which is what keeps rebuilding an existing, already-timestamped document from clobbering its real creation date with "now". Otherwise, clock.now() is read exactly ONCE and reused for whichever of the two fields was genuinely missing: once, so a freshly created document's created/modified timestamps agree with each other exactly; only for the missing field(s), so a document that already states one of the two (an imported createdIso with no modifiedIso yet, say) never has its existing value overwritten.
export function resolveMetadataTimestamps(
  metadata: LayoutMetadata,
  clock?: ClockPort,
): LayoutMetadata {
  // No clock supplied (the X-to-PDF conversion path's own default -- see src/convert/convert.ts) means "leave the source document's own timestamps exactly as they are and stamp nothing": a document that carried no createdIso/modifiedIso stays that way, which is what keeps an X-to-PDF conversion byte-identical to the pre-clock pipeline when no caller opts in. Every create*/build* edit-side entry point passes systemClock explicitly, so a freshly created document's missing timestamps are still filled as they always were.
  if (clock === undefined) {
    return metadata;
  }
  if (metadata.createdIso !== undefined && metadata.modifiedIso !== undefined) {
    return metadata;
  }
  const now = clock.now().toISOString();
  return {
    ...metadata,
    createdIso: metadata.createdIso ?? now,
    modifiedIso: metadata.modifiedIso ?? now,
  };
}
