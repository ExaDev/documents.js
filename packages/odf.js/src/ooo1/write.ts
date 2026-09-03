import type { ContentDocument, DocumentTree } from "document-schema.js";
import type { Package } from "../model/package";
import { transformToOoo1Package } from "./transform";
import {
  writeOdt,
  writeOdtContent,
  type OdtWriteOptions,
} from "../typed/odt/write";

// The OpenOffice.org 1.x / StarOffice 6-7 writers: .sxw (Writer), built from typed/odt/write.ts's own writeOdt/ writeOdtContent -- a real ODF Package -- and then rewritten into genuine OpenOffice.org 1.x XML by transformToOoo1Package, this format's own inverse of ./transform.ts's transformOoo1Package (the SAME module the readers on the other side of this package run: readSxw is readOdt(transformOoo1Package(pkg)), so writeSxw's own round-trip law is readSxw(writeSxw(document)) reading back the document it was given, up to the exact same normalisation writeOdt's own normaliseOdtContent already states -- see write-round-trip.test.ts in this directory).
//
// Each is its ODF counterpart's output run through one more transform, not a second writer: every construct writeOdt/writeOdtContent can write (paragraphs, headings, runs with character formatting and hyperlinks, whitespace, lists, tables, images, explicit page breaks, per-section page geometry, and meta.xml) therefore writes to .sxw too, and a fix to the ODF writer fixes both formats at once -- the same one-fix-both-formats property transformOoo1Package already gives the READ side. What writeOdt refuses (the fidelity constructs -- fields, bookmarks, notes, annotations, tracked changes, divisions, index wrappers, forms -- and embedded objects) this writer refuses too, for the identical reason stated there: a document that silently lost semantic content would be worse than one this writer declined to produce at all.
//
// .sxc/.sxi/.sxd (Calc/Impress/Draw) have no writer yet, because odf.js's own typed layer has no writeOds/writeOdp/ writeOdg to build one on -- see this package's README (Status) for what remains.

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
