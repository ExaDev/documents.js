import type { DocumentPackage } from 'document-schema.js';
import { assemblePackage, flattenPackage } from 'document-schema.js';
import type { Package } from '../model/package';
import { readDocxContent } from './docx/read';
import { buildDocxPackageFromContent } from './docx/write';
import { readPptxContent } from './pptx/read';
import { buildXlsxPackageFromContent } from './xlsx/build';
import { readXlsxContent } from './xlsx/content';

// This package's DocumentPackage-native surface: one reader per OOXML format producing document-schema.js's tree-form DocumentPackage, and one writer per format consuming it. These carry the primary names (readDocx, readPptx, readXlsx, buildDocxPackage, buildXlsxPackage) because the tree is the shape a caller holding a whole document wants -- containers grouped, headings and lists nested, constructs promoted to the region they span, repeated formatting factored into a styles table. The flat, content-level functions each of these wraps keep working unchanged under a `Content` name (readDocxContent, readPptxContent, readXlsxContent, buildDocxPackageFromContent, buildXlsxPackageFromContent), which is what a caller driving its own pipeline stage-by-stage -- documents.js's conversion engine, most of this repo's own tests -- reaches for.
//
// Every reader here composes through assemblePackage rather than bare decompose, matching every DocumentPackage construction site in this family: assemblePackage is decompose plus the styles-minting pass (document-schema.js's src/factor-styles.ts), and a reader IS a construction site -- it is where a package first comes into existence, so it is where minting belongs. decompose alone is for a caller composing its own boundary who has already decided minting runs elsewhere (or not at all); it stays reachable by importing document-schema.js, and is re-exported from this package's barrel alongside flattenPackage for exactly that caller. No reader passes assemblePackage's optional `pages` argument: that array is each RENDERED page's size, which only a layout pass can produce, and this package runs none -- an ooxml.js package is content-only, exactly as a bridge conversion's own package is.
//
// Every writer here composes through flattenPackage, which is both directions' inverse and the pass that materialises any styles-table refs back into direct properties -- so a package that arrived minted (as one of these readers produced it), one a caller hand-built with no table at all, and one re-minted by factorStyles all write out to the same bytes. Each writer then states its own kind contract in its own name: flattenPackage carries the root kind through untouched, so the check that narrows its result to the arm the format writer needs is also the check that refuses a presentation package handed to buildDocxPackage -- a caller error named at this boundary, in the caller's own DocumentPackage vocabulary, rather than reported further in by a function the caller never called.
//
// What a package-native reader does NOT carry is the per-format data that has no ContentDocument spelling and therefore no DocumentPackage spelling either: readDocxContent's own comments, footnotes, headers, footers, and numbering definitions all live on DocxDocument, outside its `sections`, and none of them survives into the tree. That is not a loss this module introduces -- buildDocxPackageFromContent already writes none of those parts, so they never survived the flat pair either -- but it is the reason readDocxContent stays exported rather than being folded away: it is the only function in this package that returns them at all.
//
// A second, more load-bearing consequence of minting: a run or paragraph a package-native reader hands back is NOT self-describing the way its flat, content-level counterpart is. assemblePackage's styles-minting pass factors any formatting tuple that repeats across two or more positions onto the enclosing group's `style` ref, stripping the matching keys off every paragraph/run the ref covers -- so the bold+colour on three paragraphs sharing one run style comes back as a bare `{"text": "..."}` run plus a `style: "s1"` ref two or three levels up, not as `{"text": "...", "bold": true, "color": {...}}`. A caller reading a run's REAL effective formatting off a tree must resolve that ref chain first (resolveStyleChain -> overlayStyleEntries -> applyRunStyleProperties/applyParagraphStyleProperties, re-exported from this package's barrel alongside the tree vocabulary above), where a caller of readDocxContent/readPptxContent/readXlsxContent never has to: those functions return fully materialised ContentDocuments, no refs, no table to consult. This is the single biggest behavioural difference between the primary, DocumentPackage-native names and the `Content` ones -- not a fidelity loss, since flattenPackage resolves every ref back before a writer ever sees it, but a real shape difference a caller walking the tree by hand must account for.

// A decoded docx Package -> the tree-form DocumentPackage, via readDocxContent's own full style-cascade and construct walk. The DocxDocument fields outside `sections` (comments, footnotes, headers, footers, numbering) have no place in the tree and are dropped here; readDocxContent is the reader that returns them.
export function readDocx(pkg: Package): DocumentPackage {
  const { metadata, sections } = readDocxContent(pkg);
  return assemblePackage({ kind: 'wordprocessing', metadata, sections });
}

// The inverse: a wordprocessing DocumentPackage -> a complete, freshly-built docx Package (never a write-back into a decoded one). Exactly buildDocxPackageFromContent's own fidelity, since that is what this delegates to once the tree is flattened -- see its module comment for what a docx round trip through the pair does and does not preserve.
export function buildDocxPackage(document: DocumentPackage): Package {
  const content = flattenPackage(document);
  if (content.kind !== 'wordprocessing') {
    throw new Error(`buildDocxPackage: expected a DocumentPackage of kind "wordprocessing", got "${content.kind}"`);
  }
  return buildDocxPackageFromContent(content);
}

// A decoded pptx Package -> the tree-form DocumentPackage, via readPptxContent's own placeholder/layout/master/theme inheritance walk. Read-only: PresentationML has no writer in this package, so there is no buildPptxPackage to pair this with.
export function readPptx(pkg: Package): DocumentPackage {
  const { metadata, slides } = readPptxContent(pkg);
  return assemblePackage({ kind: 'presentation', metadata, slides });
}

// A decoded xlsx Package -> the tree-form DocumentPackage, via readXlsxContent (the geometry- and print-settings-rich reader), which already returns a full ContentDocument envelope and so needs no envelope wrap here. Not to be confused with readXlsxWorkbook (typed/xlsx.ts): that is a different reading view of the same bytes -- cell values only, no write side, no ContentDocument shape to decompose.
export function readXlsx(pkg: Package): DocumentPackage {
  return assemblePackage(readXlsxContent(pkg));
}

// The inverse: a spreadsheet DocumentPackage -> a complete, freshly-built xlsx Package. Exactly buildXlsxPackageFromContent's own fidelity (cell comments excepted, as that writer's own comment states).
export function buildXlsxPackage(document: DocumentPackage): Package {
  const content = flattenPackage(document);
  if (content.kind !== 'spreadsheet') {
    throw new Error(`buildXlsxPackage: expected a DocumentPackage of kind "spreadsheet", got "${content.kind}"`);
  }
  return buildXlsxPackageFromContent(content);
}
