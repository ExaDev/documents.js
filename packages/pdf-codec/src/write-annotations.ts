// The link, annotation and residue-restoration family, split from write.ts: link annotation dicts (external and internal), destination view arrays, the notes annotation, xref entry formatting, and the residue rows a round trip restores verbatim.
import type { SourceResidue } from "document-schema.js";
import type {
  LayoutDestinationTarget,
  LayoutDocument,
  LayoutInternalLink,
  LayoutLink,
} from "./layout";
import type { PdfObject } from "./objects";
import { ByteReader } from "./bytes/reader";
import {
  pdfArray,
  pdfDict,
  pdfHexString,
  pdfName,
  pdfNull,
  pdfNum,
  pdfRef,
} from "./objects";
import { NOTES_ANNOTATION_AUTHOR } from "./notes-annotation-author";
import { parseValue } from "./parse";
import { textToPdfString } from "./write";
export function buildLinkAnnotDict(link: Readonly<LayoutLink>): PdfObject {
  return pdfDict({
    Type: pdfName("Annot"),
    Subtype: pdfName("Link"),
    Rect: pdfArray(
      [
        link.xPt,
        link.yPt,
        link.xPt + link.widthPt,
        link.yPt + link.heightPt,
      ].map((n) => pdfNum(n)),
    ),
    Border: pdfArray([0, 0, 0].map((n) => pdfNum(n))), // zero-width: an invisible clickable region, not a drawn box
    A: pdfDict({
      Type: pdfName("Action"),
      S: pdfName("URI"),
      URI: pdfHexString(new TextEncoder().encode(link.uri)),
    }),
  });
}

// A display destination array's view half (ISO 32000-1 Table 151) — the inverse of navigation.ts's parseDestination, spelling the target back as the direct array form so the written link needs no /Dests or /Names tree to resolve. Absent coordinates are null, exactly as a producer that omitted them would write.
export function destinationViewArray(
  target: Readonly<LayoutDestinationTarget>,
): PdfObject[] {
  const n = (value: number | undefined): PdfObject =>
    value === undefined ? pdfNull() : pdfNum(value);
  if (target.kind === "xyz") {
    return [pdfName("XYZ"), n(target.leftPt), n(target.topPt), n(target.zoom)];
  }
  if (target.kind === "fitH") {
    return [pdfName("FitH"), n(target.topPt)];
  }
  if (target.kind === "fitV") {
    return [pdfName("FitV"), n(target.leftPt)];
  }
  if (target.kind === "fitR") {
    return [
      pdfName("FitR"),
      n(target.leftPt),
      n(target.bottomPt),
      n(target.rightPt),
      n(target.topPt),
    ];
  }
  if (target.kind === "fitBH") {
    return [pdfName("FitBH"), n(target.topPt)];
  }
  if (target.kind === "fitBV") {
    return [pdfName("FitBV"), n(target.leftPt)];
  }
  return [pdfName(target.kind === "fitB" ? "FitB" : "Fit")];
}

// The direct destination array a destinations-table NAME resolves to — [pageRef, view] — shared by internal links and outline items so the two can never spell the same target differently. The error message names the referer (what) so a caller violating the destinations-table invariant knows which construct tripped it.
export function resolveDestinationArray(
  doc: LayoutDocument,
  pageAllocs: readonly { pageNum: number }[],
  name: string,
  what: string,
): PdfObject[] {
  const destination = doc.destinations?.find((d) => d.name === name);
  if (destination === undefined) {
    throw new Error(
      `${what} names destination "${name}", which the document's destinations table does not carry — this is a caller-invariant violation`,
    );
  }
  const targetPage = pageAllocs[destination.pageIndex];
  if (targetPage === undefined) {
    throw new Error(
      `destination "${destination.name}" names page index ${destination.pageIndex}, which is beyond the document's own pages — this is a caller-invariant violation`,
    );
  }
  return [
    pdfRef(targetPage.pageNum, 0),
    ...destinationViewArray(destination.target),
  ];
}

export function buildInternalLinkAnnotDict(
  link: Readonly<LayoutInternalLink>,
  doc: LayoutDocument,
  pageAllocs: readonly { pageNum: number }[],
): PdfObject {
  return pdfDict({
    Type: pdfName("Annot"),
    Subtype: pdfName("Link"),
    Rect: pdfArray(
      [
        link.xPt,
        link.yPt,
        link.xPt + link.widthPt,
        link.yPt + link.heightPt,
      ].map((v) => pdfNum(v)),
    ),
    Border: pdfArray([0, 0, 0].map((v) => pdfNum(v))),
    Dest: pdfArray(
      resolveDestinationArray(
        doc,
        pageAllocs,
        link.destination,
        "internal link",
      ),
    ),
  });
}

export function isLinkItem(item: {
  readonly kind: string;
}): item is LayoutLink {
  return item.kind === "link";
}

export function isInternalLinkItem(item: {
  readonly kind: string;
}): item is LayoutInternalLink {
  return item.kind === "internalLink";
}

// PDF has no native concept of hidden presenter notes, but it does have a standard construct for "a note attached to a page that isn't part of the page's visible content": a /Subtype /Text annotation (the same one Acrobat's own sticky-note tool creates), with the Hidden annotation flag (ISO 32000-1 Table 165, bit position 2, value 2 — "do not display the annotation... regardless of its annotation flags... in any way") set so it never renders or prints. This is how pptx speaker notes survive pptxToPdf -> pdfToPptx: reusing a real, standard PDF construct that generic PDF tooling already knows to preserve in an Annots array, rather than a bespoke private dictionary key nothing else would recognise. /T marks authorship so read.ts's readPageNotes only ever treats an annotation genuinely written by this function as recovered notes, not a real sticky note a human or another tool happened to leave on the page.
const NOTES_ANNOTATION_HIDDEN_FLAG = 2;

export function buildNotesAnnotDict(notes: string): PdfObject {
  return pdfDict({
    Type: pdfName("Annot"),
    Subtype: pdfName("Text"),
    Rect: pdfArray([0, 0, 0, 0].map((n) => pdfNum(n))),
    Contents: textToPdfString(notes),
    T: textToPdfString(NOTES_ANNOTATION_AUTHOR),
    F: pdfNum(NOTES_ANNOTATION_HIDDEN_FLAG),
  });
}

export interface AllocatedObject {
  readonly num: number;
  readonly value: PdfObject;
}

// Writes a fixed 20-byte classic xref entry: 10-digit offset, space, 5-digit generation, space, 'n'/'f', space, LF — exactly 10+1+5+1+1+1+1 = 20 bytes, one of the three EOL forms the spec permits (ISO 32000-1 7.5.4).
const XREF_OFFSET_DIGITS = 10;
const XREF_GENERATION_DIGITS = 5;

export function xrefEntry(
  offset: number,
  generation: number,
  inUse: boolean,
): string {
  return `${offset.toString().padStart(XREF_OFFSET_DIGITS, "0")} ${generation.toString().padStart(XREF_GENERATION_DIGITS, "0")} ${inUse ? "n" : "f"} \n`;
}

// #967 residue parse-back: the inverse of serializeObjectToText the read side's readDocumentResidue used to quarantine each row. One object from the row's text through the ordinary lexer/parser; a row that does not parse at all restores as nothing (skip, never throw — residue is opacity, not data this writer depends on).
export function parseResidueRow(
  residue: Readonly<SourceResidue>,
): PdfObject | undefined {
  // Parse diagnostics here describe the SOURCE producer's serialisation, not this writer's output — nothing downstream can act on them, so the sink drops them on the floor.
  const reader = new ByteReader(new TextEncoder().encode(residue.xml));
  return parseValue(reader, () => undefined);
}

// True when the parsed object names an indirect object anywhere inside — the marker that the row is tied to the source file's own object graph and cannot be restorable in this one.
export function objectContainsReference(obj: PdfObject): boolean {
  if (obj.kind === "ref") {
    return true;
  }
  if (obj.kind === "array") {
    return obj.items.some(objectContainsReference);
  }
  if (obj.kind === "dict") {
    return [...obj.entries.values()].some(objectContainsReference);
  }
  if (obj.kind === "stream") {
    return [...obj.dict.entries.values()].some(objectContainsReference);
  }
  return false;
}

// One residue row restored, or undefined when absent, unparseable, or reference-carrying.
export function restoreResidueRow(
  source: Record<string, SourceResidue> | undefined,
  key: string,
): PdfObject | undefined {
  const row = source?.[key];
  if (row === undefined) {
    return undefined;
  }
  const parsed = parseResidueRow(row);
  if (parsed === undefined || objectContainsReference(parsed)) {
    return undefined;
  }
  return parsed;
}
