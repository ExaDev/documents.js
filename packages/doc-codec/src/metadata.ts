import type { SummaryInformationProperties } from "archive-codec";
import type { LayoutMetadata } from "document-schema.js";
import { DocFormatError } from "./errors";

// Maps between the seven fields archive-codec's oleps/summary-information module reads from and writes to a "\x05SummaryInformation" stream, and document-schema.js's own LayoutMetadata -- the shared metadata shape a ContentDocument's `metadata` field always is. This is the only document-format-specific knowledge in the metadata path: archive-codec knows PID 2 means a title, this module knows LayoutMetadata's `title` is where that belongs for a wordprocessing document.
//
// The mapping is not 1:1 in either direction, and each gap is a genuine, permanent one rather than a TODO:
// - SummaryInformation's `comments` and `lastPrintedIso` have no LayoutMetadata field to land in -- LayoutMetadata was designed around what every format in the family can supply, and no other codec has a "last printed" or free-text "comments" concept, so these are read from the stream by archive-codec but simply never reach a ContentDocument.
// - LayoutMetadata's `creator`, `producer`, and `language` have no SummaryInformation equivalent to write into -- `producer` is a PDF-only concept in this schema, `creator`/`language` are not among the seven fields this package's own SummaryInformation support covers (see the package README's metadata scope note).
// - SummaryInformation's own `lastSavedIso` is LayoutMetadata's `modifiedIso`: the same fact ("when was this last written"), named differently by the two vocabularies.

export function summaryInformationToLayoutMetadata(
  info: SummaryInformationProperties,
): LayoutMetadata {
  return {
    title: info.title,
    subject: info.subject,
    author: info.author,
    keywords: info.keywords === undefined ? undefined : [...info.keywords],
    createdIso: info.createdIso,
    modifiedIso: info.lastSavedIso,
  };
}

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
  return {
    title: metadata.title,
    subject: metadata.subject,
    author: metadata.author,
    keywords: metadata.keywords,
    createdIso: metadata.createdIso,
    lastSavedIso: metadata.modifiedIso,
  };
}

/** Whether a LayoutMetadata carries anything SummaryInformation can actually represent -- `creator`/`producer`/`language` alone should not force a stream carrying nothing but the CodePage property into existence, since a reader would see that back as `{}` regardless (see writeDocContent's own call site). */
export function hasSummaryInformationFields(metadata: LayoutMetadata): boolean {
  return (
    metadata.title !== undefined ||
    metadata.subject !== undefined ||
    metadata.author !== undefined ||
    (metadata.keywords !== undefined && metadata.keywords.length > 0) ||
    metadata.createdIso !== undefined ||
    metadata.modifiedIso !== undefined
  );
}
