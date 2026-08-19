import type { Comment, Footnote, NumberingDefinitions, Package } from 'ooxml.js';
import { readDocxContent as readDocxFlat } from 'ooxml.js';

// The docx metadata readDocxContent (./read.ts) deliberately drops because it genuinely doesn't fit ContentDocument's section/block shape: comments, footnotes, headers/footers, and numbering (abstractNum/num) definitions. ooxml.js's own readDocxContent (the flat DocxDocument reader since ooxml.js 4.0.0; the bare readDocx name now reads the tree-form DocumentPackage) already reads all four -- this is a thin re-projection of that same call, exposed as its own real return type rather than forced into a shape that doesn't model it. Comment/Footnote/NumberingDefinitions are ooxml.js's own types, reused directly rather than mirrored locally.
export interface DocxExtras {
  readonly comments: readonly Comment[];
  readonly footnotes: readonly Footnote[];
  readonly headers: readonly string[];
  readonly footers: readonly string[];
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
    numbering: docxDoc.numbering,
  };
}
