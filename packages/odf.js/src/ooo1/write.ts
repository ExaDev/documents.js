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

// The OpenOffice.org 1.x / StarOffice 6-7 writers: .sxw (Writer), built from typed/odt/write.ts's own writeOdt/ writeOdtContent, and .sxc (Calc), built from typed/ods/write.ts's own writeOds/writeOdsContent -- in both cases a real ODF Package, rewritten into genuine OpenOffice.org 1.x XML by transformToOoo1Package, this format's own inverse of ./transform.ts's transformOoo1Package (the SAME module the readers on the other side of this package run: readSxw is readOdt(transformOoo1Package(pkg)), readSxc is readOds(transformOoo1Package(pkg)), so each writer's own round-trip law is readSxw(writeSxw(document))/readSxc(writeSxc(document)) reading back the document it was given, up to the exact same normalisation writeOdt's/writeOds's own normaliseOdtContent/normaliseOdsContent already states -- see write.test.ts in this directory).
//
// Each is its ODF counterpart's output run through one more transform, not a second writer: every construct writeOdt/writeOdtContent can write (paragraphs, headings, runs with character formatting and hyperlinks, whitespace, lists, tables, images, explicit page breaks, per-section page geometry, and meta.xml) therefore writes to .sxw too, and every construct writeOds/writeOdsContent can write (every office:value-type, column widths/row heights, hidden rows/columns, merged ranges, cell background/borders/alignment, verbatim formulas, cell-anchored images, print settings, and multiple sheets) therefore writes to .sxc too -- the same one-fix-both-formats property transformOoo1Package already gives the READ side, now true of the write side for each pair that has an ODF writer underneath it. What writeOdt/writeOds refuse (the odt fidelity constructs -- fields, bookmarks, notes, annotations, tracked changes, divisions, index wrappers, forms; the ods embedded objects, data-validation rules, and conditional-formatting rules) these writers refuse too, for the identical reason stated in each: a document that silently lost semantic content would be worse than one this writer declined to produce at all.
//
// .sxi/.sxd (Impress/Draw) have no writer yet, because odf.js's own typed layer has no writeOdp/writeOdg to build one on -- see this package's README (Status) for what remains.

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
