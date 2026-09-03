import type { SummaryInformationProperties } from "archive-codec";
import { layoutMetadataToSummaryInformation as mapLayoutMetadataToSummaryInformation } from "archive-codec";
import type { LayoutMetadata } from "document-schema.js";
import { DocFormatError } from "./errors";

// The LayoutMetadata <-> SummaryInformationProperties mapping itself is format-agnostic (document-schema.js's LayoutMetadata is not specific to .doc), so the pure mapping (and hasSummaryInformationFields/summaryInformationToLayoutMetadata, which need no package-local wrapping) lives in archive-codec/oleps/layout-metadata.ts, shared with xls-codec and ppt-codec, rather than being copied here -- read.ts and write.ts import those two directly from "archive-codec". What stays package-local is the one piece that genuinely is doc-codec's own: reporting a malformed createdIso/modifiedIso through this package's own error vocabulary (see requireValidIsoDate below).

// writeSummaryInformationStream converts createdIso/lastSavedIso straight into a FILETIME via `new Date(iso)`; a malformed string produces an Invalid Date, whose getTime() is NaN, and archive-codec's own BigInt(NaN) conversion throws an opaque RangeError with no indication which field or package caused it. Validated here, at the boundary into archive-codec's own shape, so a caller sees a DocFormatError naming the actual field instead.
function requireValidIsoDate(
  value: string | undefined,
  field: "createdIso" | "modifiedIso",
): void {
  if (value !== undefined && Number.isNaN(new Date(value).getTime())) {
    throw new DocFormatError(
      `LayoutMetadata.${field} "${value}" is not a valid date string, so it cannot be written as a SummaryInformation FILETIME property`,
    );
  }
}

export function layoutMetadataToSummaryInformation(
  metadata: LayoutMetadata,
): SummaryInformationProperties {
  requireValidIsoDate(metadata.createdIso, "createdIso");
  requireValidIsoDate(metadata.modifiedIso, "modifiedIso");
  return mapLayoutMetadataToSummaryInformation(metadata);
}
