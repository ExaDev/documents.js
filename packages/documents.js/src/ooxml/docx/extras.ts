import type { Comment, Footnote, HeaderFooterPart, NumberingDefinitions, Package, SectionHeaderFooterReferences } from 'ooxml.js';
import { readDocxContent as readDocxFlat } from 'ooxml.js';

// The docx metadata readDocxContent (./read.ts) deliberately drops because it genuinely doesn't fit ContentDocument's section/block shape: comments, footnotes, headers/footers, and numbering (abstractNum/num) definitions. ooxml.js's own readDocxContent (the flat DocxDocument reader since ooxml.js 4.0.0; the bare readDocx name now reads the tree-form DocumentPackage) already reads all four -- this is a thin re-projection of that same call, exposed as its own real return type rather than forced into a shape that doesn't model it. Comment/Footnote/NumberingDefinitions/HeaderFooterPart/SectionHeaderFooterReferences are ooxml.js's own types, reused directly rather than mirrored locally.
//
// Headers and footers are carried BOTH ways, matching the upstream reader's own shape: the flat `headers`/`footers` string arrays (one entry per part-name-matching part, concatenated w:t text) those fields have always held, and the structural model -- `headerFooterParts` (each section-referenced part as real block flow) plus `sectionHeaderFooters` (which section references which part at which default/first/even slot). The structural model is the one a consumer should read: the flat arrays are a derived summary that also catches parts no section references, and their removal from the upstream published shape is tracked rather than taken, so they stay deprecated-but-populated here until that break lands.
export interface DocxExtras {
  readonly comments: readonly Comment[];
  readonly footnotes: readonly Footnote[];
  /** @deprecated A derived per-part text summary -- read `headerFooterParts`/`sectionHeaderFooters` instead; this field leaves with the tracked upstream break. */
  readonly headers: readonly string[];
  /** @deprecated A derived per-part text summary -- read `headerFooterParts`/`sectionHeaderFooters` instead; this field leaves with the tracked upstream break. */
  readonly footers: readonly string[];
  readonly headerFooterParts: readonly HeaderFooterPart[];
  readonly sectionHeaderFooters: readonly SectionHeaderFooterReferences[];
  readonly numbering: NumberingDefinitions;
}

// Package -> DocxExtras. Calls the upstream reader a second time when a caller also calls readDocxContent on the same package -- an accepted cost of two independently-usable pipeline stages (matching every other "each stage independently exported" pair in this codebase) rather than a reason to fuse the two into one combined return shape neither caller asked for.
export function readDocxExtras(pkg: Package): DocxExtras {
  const docxDoc = readDocxFlat(pkg);
  return {
    comments: docxDoc.comments,
    footnotes: docxDoc.footnotes,
    headers: docxDoc.headers,
    footers: docxDoc.footers,
    headerFooterParts: docxDoc.headerFooterParts,
    sectionHeaderFooters: docxDoc.sectionHeaderFooters,
    numbering: docxDoc.numbering,
  };
}
