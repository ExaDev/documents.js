import type { LayoutMetadata } from "document-schema.js";
import type { SummaryInformationProperties } from "./summary-information";

// Maps between the seven fields ./summary-information.ts reads from and writes to a "\x05SummaryInformation" stream, and document-schema.js's own LayoutMetadata -- the shared metadata shape every codec's ContentDocument carries. This lives here rather than in doc-codec/xls-codec/ppt-codec because it used to be three byte-identical copies: LayoutMetadata is format-agnostic (document-schema.js is a foundation package, not tied to .doc/.xls/.ppt specifically), so nothing about this mapping is specific to any one of the three legacy binary formats that happen to consume it today.
//
// The mapping is not 1:1 in either direction, and each gap is a genuine, permanent one rather than a TODO:
// - SummaryInformation's `comments` and `lastPrintedIso` have no LayoutMetadata field to land in -- LayoutMetadata was designed around what every format in the family can supply, and no codec has a "last printed" or free-text "comments" concept, so these are read from the stream but never reach a ContentDocument.
// - LayoutMetadata's `creator`, `producer`, and `language` have no SummaryInformation equivalent to write into -- `producer` is a PDF-only concept in this schema, `creator`/`language` are not among the seven fields this package's own SummaryInformation support covers.
// - SummaryInformation's own `lastSavedIso` is LayoutMetadata's `modifiedIso`: the same fact ("when was this last written"), named differently by the two vocabularies.
//
// Deliberately does not validate createdIso/modifiedIso as real dates: this module has no error vocabulary of its own to report a malformed one through (see PropertySetFormatError's own read-side scope), and each caller reports that failure through its own named write-side error class (DocFormatError/BiffWriteError/PptUnsupportedContentError). A caller validates both fields itself, immediately before calling layoutMetadataToSummaryInformation.

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

export function layoutMetadataToSummaryInformation(
  metadata: LayoutMetadata,
): SummaryInformationProperties {
  return {
    title: metadata.title,
    subject: metadata.subject,
    author: metadata.author,
    keywords: metadata.keywords,
    createdIso: metadata.createdIso,
    lastSavedIso: metadata.modifiedIso,
  };
}

/** Whether a LayoutMetadata carries anything SummaryInformation can actually represent -- `creator`/`producer`/`language` alone should not force a stream carrying nothing but the CodePage property into existence, since a reader would see that back as `{}` regardless (see each caller's own write-side entry point). */
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
