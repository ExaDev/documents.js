import type { ContentDrawPage, DocumentTree, LayoutMetadata, SourceResidue } from 'document-schema.js';
import { assembleTree, PAGE_SIZE_A4 } from 'document-schema.js';
import type { XmlElement } from '../../model/node';
import type { Package } from '../../model/package';
import { childrenWithTag, findChildElement, rootElement } from '../../xml/query';
import { readOdfMetadata } from '../shared/metadata';
import { resolveDrawPageSize } from '../shared/masterpage';
import { collectOdfNonContentPartResidue, collectOdfUnmappedShapeResidue, odfResidue } from '../shared/constructs';
import { readDrawPageContent } from '../draw/shapes';

// Resolves a Package into { metadata, pages }: office:drawing's own draw:page content model was verified structurally IDENTICAL to office:presentation's, against both the OASIS ODF schema (draw:page's own attribute/content-model definition is a single, format-agnostic schema fragment shared by both office:body children, not two separate definitions) and a real .odg file built via the LibreOffice UNO API -- document order is native here exactly like odp (a draw:page's own position among its office:drawing siblings IS page order, with nothing resolution-worthy above it), and the SAME draw:frame/draw:g/vector-primitive content-walking logic (readDrawPageContent, typed/draw/shapes.ts) and the SAME master-page -> page-layout size-resolution chain (resolveDrawPageSize, typed/shared/masterpage.ts) apply unchanged.
//
// FACTORING DECISION: what genuinely differs between odp and odg is not draw:page's own content model, but everything AROUND it -- odg has no presentation:notes concept and no slide-specific wrapper to build, while (per shapes.ts's own vector-primitive additions this module now also draws on) a drawing commonly carries bare vector-primitive shapes directly under draw:page/draw:g, something a presentation's own draw:page can equally carry per the schema but rarely does in real Impress output. Given that, the SHARED page-size chain and the SHARED content walk were each factored out into typed/shared/masterpage.ts and typed/draw/shapes.ts respectively (both now used verbatim by readOdpContent too -- see masterpage.ts's own top-of-file note), while this module's own thin readPage/readOdgContent wrapper is kept separate from readOdpContent's own readSlide/readOdpContent wrapper: forcing the two format-specific wrappers into one shared function would mean threading an odp-only "does this format have notes" branch through odg's own call sites for no shared benefit, since neither wrapper is more than a few lines of format-specific glue over already-shared machinery -- matching odt/read.ts's own precedent for when duplicating a small amount of glue beats an awkward shared abstraction.

const CONTENT_PART = 'content.xml';

function readPage(page: XmlElement, pkg: Package): ContentDrawPage {
  // LibreOffice Draw's own out-of-the-box default page size for a freshly created, unmodified .odg (confirmed directly against a real Draw document's own style:page-layout-properties: 21cm x 29.7cm portrait, i.e. A4) -- used only when a page's own master-page/page-layout chain doesn't resolve. Deliberately A4-based, matching readOdtContent's own fallback choice and reasoning (each reader's own fallback should reflect the format it actually reads) rather than reusing readOdpContent's own SLIDE_SIZE_WIDESCREEN, which is Impress's default, not Draw's.
  const size = resolveDrawPageSize(page, pkg) ?? PAGE_SIZE_A4;
  const { shapes, vectors } = readDrawPageContent(page.children, pkg);
  // The page's own residue: the unmapped shape kinds and vendor-extension elements, collected over the same draw:g-only recursion boundary readDrawPageContent itself walks.
  const unmapped: XmlElement[] = [];
  collectOdfUnmappedShapeResidue(page.children, unmapped);
  const source = unmapped.length > 0 ? odfResidue('odg', ...unmapped) : undefined;
  return { size, shapes, vectors, ...(source !== undefined ? { source } : {}) };
}

export interface OdgDocument {
  metadata: LayoutMetadata;
  pages: ContentDrawPage[];
  // The package-tier residue table: non-content XML parts keyed by their part path. Present only when at least one quarantined -- the flat ContentDocument has no root source table, so this field is how the table reaches readOdg's assembled package root.
  source?: Record<string, SourceResidue>;
}

export function readOdgContent(pkg: Package): OdgDocument {
  const contentPart = pkg.parts[CONTENT_PART];
  const root = contentPart?.kind === 'xml' ? rootElement(contentPart.nodes) : undefined;
  const body = root === undefined ? undefined : findChildElement(root.children, 'office:body');
  const drawing = body === undefined ? undefined : findChildElement(body.children, 'office:drawing');
  const pages = drawing === undefined ? [] : childrenWithTag(drawing, 'draw:page');

  const source: Record<string, SourceResidue> = {};
  collectOdfNonContentPartResidue(pkg, 'odg', source);
  return {
    metadata: readOdfMetadata(pkg),
    pages: pages.map((page) => readPage(page, pkg)),
    ...(Object.keys(source).length > 0 ? { source } : {}),
  };
}

// Package -> DocumentTree: this module's PRIMARY entry point, the drawing mirror of readOdtContent/readOdt (see src/typed/odt/read.ts's own note on why assembleTree rather than bare decompose, and why no `pages` argument -- ContentDrawPage's own `pages` here are the DOCUMENT's authored draw pages, an entirely different thing from the package envelope's rendered-page-size array). readOdgContent above is unchanged and remains the flat, ContentDocument-level reader.
export function readOdg(pkg: Package): DocumentTree {
  const { metadata, pages, source } = readOdgContent(pkg);
  const assembled = assembleTree({ kind: 'drawing', metadata, pages });
  if (source !== undefined) {
    assembled.source = source;
  }
  return assembled;
}
