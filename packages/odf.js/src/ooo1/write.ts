import type { ContentDocument, DocumentTree } from "document-schema.js";
import type { Package } from "../model/package";
import { transformToOoo1Package } from "./transform";
import {
  writeOdt,
  writeOdtContent,
  type OdtWriteOptions,
} from "../typed/odt/write";
import {
  writeOds,
  writeOdsContent,
  type OdsWriteOptions,
} from "../typed/ods/write";
import {
  writeOdp,
  writeOdpContent,
  type OdpWriteOptions,
} from "../typed/odp/write";

// The OpenOffice.org 1.x / StarOffice 6-7 writers: .sxw (Writer), built from typed/odt/write.ts's own writeOdt/writeOdtContent; .sxc (Calc), built from typed/ods/write.ts's own writeOds/writeOdsContent; .sxi (Impress), built from typed/odp/write.ts's own writeOdp/writeOdpContent -- in all three cases a real ODF Package, rewritten into genuine OpenOffice.org 1.x XML by transformToOoo1Package, this format's own inverse of ./transform.ts's transformOoo1Package (the SAME module the readers on the other side of this package run: readSxw is readOdt(transformOoo1Package(pkg)), readSxc is readOds(transformOoo1Package(pkg)), readSxi is readOdp(transformOoo1Package(pkg)), so each writer's own round-trip law is readSxw(writeSxw(document))/readSxc(writeSxc(document))/readSxi(writeSxi(document)) reading back the document it was given, up to the exact same normalisation writeOdt's/writeOds's/writeOdp's own normaliseOdtContent/normaliseOdsContent/normaliseOdpContent already states -- see write.test.ts in this directory).
//
// Each is its ODF counterpart's output run through one more transform, not a second writer: every construct writeOdt/writeOdtContent can write (paragraphs, headings, runs with character formatting and hyperlinks, whitespace, lists, tables, images, explicit page breaks, per-section page geometry, and meta.xml) therefore writes to .sxw too; every construct writeOds/writeOdsContent can write (every office:value-type, column widths/row heights, hidden rows/columns, merged ranges, cell background/borders/alignment, verbatim formulas, cell-anchored images, print settings, and multiple sheets) therefore writes to .sxc too; every construct writeOdp/writeOdpContent can write (a slide's positioned shapes with formatted text/lists, a rotated shape's draw:transform, a shape carrying a table or an image as its sole content, per-shape text insets, per-slide page geometry, speaker notes, and a shape's own draw:z-index paint order) therefore writes to .sxi too -- the same one-fix-both-formats property transformOoo1Package already gives the READ side, now true of the write side for each pair that has an ODF writer underneath it. What writeOdt/writeOds/writeOdp refuse (the odt fidelity constructs -- fields, bookmarks, notes, annotations, tracked changes, divisions, index wrappers, forms; the ods embedded objects, data-validation rules, and conditional-formatting rules; the odp fidelity constructs a shape's own text cannot carry) these writers refuse too, for the identical reason stated in each: a document that silently lost semantic content would be worse than one this writer declined to produce at all.
//
// .sxd (Draw) has no writer yet, because odf.js's own typed layer has no writeOdg to build one on -- see this package's README (Status) for what remains.

// A wordprocessing DocumentTree as a real .sxw Package.
export function writeSxw(
  document: DocumentTree,
  options: OdtWriteOptions = {},
): Package {
  return transformToOoo1Package(writeOdt(document, options));
}

// A wordprocessing ContentDocument as a real .sxw Package, the flat-level sibling of writeSxw above -- exactly the same split writeOdt/writeOdtContent themselves carry, mirrored one direction further out.
export function writeSxwContent(
  document: ContentDocument,
  options: OdtWriteOptions = {},
): Package {
  return transformToOoo1Package(writeOdtContent(document, options));
}

// A spreadsheet DocumentTree as a real .sxc Package, exactly mirroring writeSxw's own relationship to writeOdt above.
export function writeSxc(
  document: DocumentTree,
  options: OdsWriteOptions = {},
): Package {
  return transformToOoo1Package(writeOds(document, options));
}

// A spreadsheet ContentDocument as a real .sxc Package, the flat-level sibling of writeSxc above -- exactly the same split writeOds/writeOdsContent themselves carry, mirrored one direction further out.
export function writeSxcContent(
  document: ContentDocument,
  options: OdsWriteOptions = {},
): Package {
  return transformToOoo1Package(writeOdsContent(document, options));
}

// A presentation DocumentTree as a real .sxi Package, exactly mirroring writeSxw's/writeSxc's own relationship to writeOdt/writeOds above.
export function writeSxi(
  document: DocumentTree,
  options: OdpWriteOptions = {},
): Package {
  return transformToOoo1Package(writeOdp(document, options));
}

// A presentation ContentDocument as a real .sxi Package, the flat-level sibling of writeSxi above -- exactly the same split writeOdp/writeOdpContent themselves carry, mirrored one direction further out.
export function writeSxiContent(
  document: ContentDocument,
  options: OdpWriteOptions = {},
): Package {
  return transformToOoo1Package(writeOdpContent(document, options));
}
