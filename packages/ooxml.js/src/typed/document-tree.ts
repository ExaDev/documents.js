import type { DocumentTree } from "document-schema.js";
import { assembleTree, flattenTree } from "document-schema.js";
import type { Package } from "../model/package";
import { readDocxContent } from "./docx/read";
import { buildDocxPackageFromContent } from "./docx/write";
import type { BuildDocxContentOptions } from "./docx/write";
import { readPptxContent } from "./pptx/read";
import { buildXlsxPackageFromContent } from "./xlsx/build";
import { readXlsxContent } from "./xlsx/content";
import { readWorkbookDefinitions } from "./xlsx/definitions";

// This package's DocumentTree-native surface: one reader per OOXML format producing document-schema.js's tree-form DocumentTree, and one writer per format consuming it. These carry the primary names (readDocx, readPptx, readXlsx, buildDocxPackage, buildXlsxPackage) because the tree is the shape a caller holding a whole document wants -- containers grouped, headings and lists nested, constructs promoted to the region they span, repeated formatting factored into a styles table. The flat, content-level functions each of these wraps keep working unchanged under a `Content` name (readDocxContent, readPptxContent, readXlsxContent, buildDocxPackageFromContent, buildXlsxPackageFromContent), which is what a caller driving its own pipeline stage-by-stage -- documents.js's conversion engine, most of this repo's own tests -- reaches for.
//
// Every reader here composes through assembleTree rather than bare decompose, matching every DocumentTree construction site in this family: assembleTree is decompose plus the styles-minting pass (document-schema.js's src/factor-styles.ts), and a reader IS a construction site -- it is where a package first comes into existence, so it is where minting belongs. decompose alone is for a caller composing its own boundary who has already decided minting runs elsewhere (or not at all); it stays reachable by importing document-schema.js, and is re-exported from this package's barrel alongside flattenTree for exactly that caller. No reader passes assembleTree's optional `pages` argument: that array is each RENDERED page's size, which only a layout pass can produce, and this package runs none -- an ooxml.js package is content-only, exactly as a bridge conversion's own package is.
//
// Every writer here composes through flattenTree, which is both directions' inverse and the pass that materialises any styles-table refs back into direct properties -- so a package that arrived minted (as one of these readers produced it), one a caller hand-built with no table at all, and one re-minted by factorStyles all write out to the same bytes. Each writer then states its own kind contract in its own name: flattenTree carries the root kind through untouched, so the check that narrows its result to the arm the format writer needs is also the check that refuses a presentation package handed to buildDocxPackage -- a caller error named at this boundary, in the caller's own DocumentTree vocabulary, rather than reported further in by a function the caller never called.
//
// What a package-native reader does NOT carry is the per-format data that has no ContentDocument spelling and therefore no DocumentTree spelling either: readDocxContent's own comments, footnotes, header/footer parts, and numbering definitions all live on DocxDocument, outside its `sections`, and none of them survives into the tree. That is not a loss this module introduces -- buildDocxPackageFromContent already writes none of those parts, so they never survived the flat pair either -- but it is the reason readDocxContent stays exported rather than being folded away: it is the only function in this package that returns them at all.
//
// A second, more load-bearing consequence of minting: a run or paragraph a package-native reader hands back is NOT self-describing the way its flat, content-level counterpart is. assembleTree's styles-minting pass factors any formatting tuple that repeats across two or more positions onto the enclosing group's `style` ref, stripping the matching keys off every paragraph/run the ref covers -- so the bold+colour on three paragraphs sharing one run style comes back as a bare `{"text": "..."}` run plus a `style: "s1"` ref two or three levels up, not as `{"text": "...", "bold": true, "color": {...}}`. A caller reading a run's REAL effective formatting off a tree must resolve that ref chain first (resolveStyleChain -> overlayStyleEntries -> applyRunStyleProperties/applyParagraphStyleProperties, re-exported from this package's barrel alongside the tree vocabulary above), where a caller of readDocxContent/readPptxContent/readXlsxContent never has to: those functions return fully materialised ContentDocuments, no refs, no table to consult. This is the single biggest behavioural difference between the primary, DocumentTree-native names and the `Content` ones -- not a fidelity loss, since flattenTree resolves every ref back before a writer ever sees it, but a real shape difference a caller walking the tree by hand must account for.

// A decoded docx Package -> the tree-form DocumentTree, via readDocxContent's own full style-cascade and construct walk. The DocxDocument fields outside `sections` (comments, footnotes, header/footer parts, numbering) have no place in the tree and are dropped here; readDocxContent is the reader that returns them.
export function readDocx(pkg: Package): DocumentTree {
  const { metadata, sections } = readDocxContent(pkg);
  return assembleTree({ kind: "wordprocessing", metadata, sections });
}

// The inverse: a wordprocessing DocumentTree -> a complete, freshly-built docx Package (never a write-back into a decoded one). Exactly buildDocxPackageFromContent's own fidelity, since that is what this delegates to once the tree is flattened -- see its module comment for what a docx round trip through the pair does and does not preserve. The options are that flat writer's own, threaded straight through: an embedded presentation block rides the tree exactly like a flat one, so the injected serialiser (EmbeddedPresentationSerialiser's own comment states why it is a port) has to reach the flat writer or the tree pair would refuse what the flat pair serialises.
export function buildDocxPackage(
  document: DocumentTree,
  options?: BuildDocxContentOptions,
): Package {
  const content = flattenTree(document);
  if (content.kind !== "wordprocessing") {
    throw new Error(
      `buildDocxPackage: expected a DocumentTree of kind "wordprocessing", got "${content.kind}"`,
    );
  }
  return buildDocxPackageFromContent(content, options);
}

// A decoded pptx Package -> the tree-form DocumentTree, via readPptxContent's own placeholder/layout/master/theme inheritance walk. Read-only: PresentationML has no writer in this package, so there is no buildPptxPackage to pair this with.
export function readPptx(pkg: Package): DocumentTree {
  const { metadata, slides } = readPptxContent(pkg);
  return assembleTree({ kind: "presentation", metadata, slides });
}

// A decoded xlsx Package -> the tree-form DocumentTree, via readXlsxContent (the geometry- and print-settings-rich reader), which already returns a full ContentDocument envelope and so needs no envelope wrap here. Not to be confused with readXlsxWorkbook (typed/xlsx.ts): that is a different reading view of the same bytes -- cell values only, no write side, no ContentDocument shape to decompose.
//
// The one thing this reader carries that its flat half cannot: the workbook's general defined names and table/List objects ride the tree root's definitions table (typed/xlsx/definitions.ts), the landing document-schema.js's own verdict gives a sheet-scoped named range -- no block-flow extent to wrap, so a definitions entry naming its range, and the definitions facility is tree-only. flattenTree drops the table on the way back down, so buildXlsxPackage(readXlsx(pkg)) still builds exactly the package buildXlsxPackageFromContent(readXlsxContent(pkg)) does: the write pair gains nothing here (it emits no xl/tables part and only the two _xlnm print names), an asymmetry pinned in document-tree.test.ts.
export function readXlsx(pkg: Package): DocumentTree {
  const definitions = readWorkbookDefinitions(pkg);
  const tree = assembleTree(readXlsxContent(pkg));
  return definitions === undefined ? tree : { ...tree, definitions };
}

// The inverse: a spreadsheet DocumentTree -> a complete, freshly-built xlsx Package. Exactly buildXlsxPackageFromContent's own fidelity (cell comments excepted, as that writer's own comment states).
export function buildXlsxPackage(document: DocumentTree): Package {
  const content = flattenTree(document);
  if (content.kind !== "spreadsheet") {
    throw new Error(
      `buildXlsxPackage: expected a DocumentTree of kind "spreadsheet", got "${content.kind}"`,
    );
  }
  return buildXlsxPackageFromContent(content);
}
