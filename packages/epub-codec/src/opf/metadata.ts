import type { LayoutMetadata } from "document-schema.js";
import { EpubDiagnosticCodes, type EpubDiagnosticSink } from "../diagnostics";
import type { XmlElement } from "../xml/node";
import { attrValue, childrenWithTag, textContent } from "../xml/query";

// Dublin Core <-> LayoutMetadata mapping, EPUB 3.3 section 5.2 (unchanged from EPUB 2's own OPF metadata, itself carried straight from OPF 2.0's Dublin Core requirement). One role decision drives the two fields that could otherwise collide: dc:creator names EPUB's human, byline-style author -- exactly the role ooxml.js's own dc:creator -> DocumentMetadata.author reading already established for OOXML core properties (NOT the "whoever last saved this" role odf.js's dc:creator plays for ODF, which has no EPUB analogue at all) -- so it maps to `author`, matching that established role rather than ODF's. `creator` itself (the tool that PRODUCED the file, LayoutMetadata's own "originating application" role -- ooxml.js's docProps/app.xml Application element, ODF's meta:generator) has no reliable Dublin Core analogue in an OPF and stays unmapped: EPUB carries no equivalent standard element, and guessing at a non-standard <meta name="generator"> some producers add would be inventing a convention rather than reading one.
//
// dc:subject has no direct LayoutMetadata field: EPUB producers commonly repeat it for BISAC/genre topics (multiple elements, unlike OOXML's single comma-separated cp:keywords), which is a much closer fit to `keywords` (an array) than to `subject` (a scalar description field with no clean EPUB source) -- so every dc:subject value maps there and `subject` stays unmapped. dc:date maps to `createdIso` as the nearest available field: Dublin Core's own date semantics are producer-defined (most commonly a publication date, sometimes the creation date), and EPUB 3's own dcterms:modified refinement meta (below) is the one field with an unambiguous "last modified" meaning, so the two are not treated as interchangeable spellings of one fact. dc:identifier, dc:publisher, dc:contributor, and dc:rights have no LayoutMetadata field at all and are never read -- METADATA_FIELD_UNMAPPED names this at the call site (src/read.ts), since an unrepresented Dublin Core element is a real, documented reading gap, not silent data loss this package pretends not to have.
// The Dublin Core elements with no LayoutMetadata field to land in at all (see this module's own top-of-file note) -- checked once per read so an unrepresented element is a reported, documented gap rather than silent data loss.
const UNMAPPED_DC_TAGS = ["dc:publisher", "dc:contributor", "dc:rights"];

export function readOpfMetadata(
  metadataElement: XmlElement,
  sink: EpubDiagnosticSink,
): LayoutMetadata {
  const metadata: LayoutMetadata = {};

  for (const tag of UNMAPPED_DC_TAGS) {
    if (childrenWithTag(metadataElement, tag).length > 0) {
      sink({
        code: EpubDiagnosticCodes.METADATA_FIELD_UNMAPPED,
        severity: "info",
        message: `<${tag}> has no document-schema.js LayoutMetadata field to carry it; dropped`,
      });
    }
  }

  const title = firstElementText(metadataElement, "dc:title");
  if (title !== undefined) {
    metadata.title = title;
  }

  const creators = childrenWithTag(metadataElement, "dc:creator")
    .map((element) => textContent(element.children).trim())
    .filter((value) => value.length > 0);
  if (creators.length > 0) {
    metadata.author = creators.join("; ");
  }

  const subjects = childrenWithTag(metadataElement, "dc:subject")
    .map((element) => textContent(element.children).trim())
    .filter((value) => value.length > 0);
  if (subjects.length > 0) {
    metadata.keywords = subjects;
  }

  const language = firstElementText(metadataElement, "dc:language");
  if (language !== undefined) {
    metadata.language = language;
  }

  const date = firstElementText(metadataElement, "dc:date");
  if (date !== undefined) {
    metadata.createdIso = date;
  }

  const modified = dctermsModified(metadataElement);
  if (modified !== undefined) {
    metadata.modifiedIso = modified;
  }

  return metadata;
}

function firstElementText(parent: XmlElement, tag: string): string | undefined {
  const element = childrenWithTag(parent, tag)[0];
  if (element === undefined) {
    return undefined;
  }
  const text = textContent(element.children).trim();
  return text.length > 0 ? text : undefined;
}

// EPUB 3's own last-modified timestamp: either a dedicated <meta property="dcterms:modified">TEXT</meta> element (the common spelling), or, for a package still carrying EPUB 2-style <meta name="..." content="..."/> elements, a name="dcterms:modified" variant some producers emit. Both are checked since real producers are inconsistent about which OPF metadata convention a given field uses.
function dctermsModified(metadataElement: XmlElement): string | undefined {
  for (const meta of childrenWithTag(metadataElement, "meta")) {
    if (attrValue(meta, "property") === "dcterms:modified") {
      const text = textContent(meta.children).trim();
      if (text.length > 0) {
        return text;
      }
    }
    if (attrValue(meta, "name") === "dcterms:modified") {
      const content = attrValue(meta, "content");
      if (content !== undefined && content.trim().length > 0) {
        return content.trim();
      }
    }
  }
  return undefined;
}
