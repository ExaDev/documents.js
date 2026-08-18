import type { ContentBlock, ContentDocument, ContentDrawPage, ContentSection, ContentShape, ContentSlide } from 'document-schema.js';

import { SLIDE_SIZE_WIDESCREEN, PAGE_SIZE_A4 } from 'document-schema.js';

// Cross-variant content bridges: transforms between ContentDocument variants that do NOT share a common shape (wordprocessing ↔ presentation, wordprocessing ↔ spreadsheet, drawing ↔ presentation), so pairs like docx↔pptx, odt↔xlsx, or odg↔odp can bypass PDF entirely through the content pivot. Unlike the same-variant bridges (odt↔docx, odp↔pptx, ods↔xlsx), which are a direct read→build copy because both sides share one ContentDocument variant, these are genuine semantic TRANSFORMS — a flow document has no slide boundaries, a deck has no flow — so each direction is an approximation, documented per direction below.

type WordprocessingContentDocument = Extract<ContentDocument, { kind: 'wordprocessing' }>;
type PresentationContentDocument = Extract<ContentDocument, { kind: 'presentation' }>;
type DrawingContentDocument = Extract<ContentDocument, { kind: 'drawing' }>;

// Default text-box insets matching PowerPoint's own documented body-placeholder defaults (91440 EMU = 0.125in ≈ 9pt sides; 45720 EMU = 0.0625in ≈ 4.5pt top/bottom — the same values readOdpContent's own createOdp example uses).
const DEFAULT_INSET_LEFT_PT = 9.14;
const DEFAULT_INSET_TOP_PT = 4.57;
const DEFAULT_INSET_RIGHT_PT = 9.14;
const DEFAULT_INSET_BOTTOM_PT = 4.57;

// Heuristic: does this block start a new slide? A heading paragraph (styleId starting with 'Heading') or a page break does. Everything else accumulates into the current slide.
function startsNewSlide(block: ContentBlock): boolean {
  if (block.kind === 'pageBreak') {
    return true;
  }
  if (block.kind === 'paragraph' && block.styleId?.startsWith('Heading') === true) {
    return true;
  }
  return false;
}

// wordprocessing → presentation: splits a flow document's blocks into slides at heading or page-break boundaries. Each slide gets one full-width text-box shape holding that slide's own accumulated blocks. A document with no headings produces a single slide carrying everything -- a crude approximation, not a faithful deck, but the blocks themselves (paragraphs, tables, images, list membership, run styling) survive intact. Slide size is taken from the first section's page size (or widescreen 16:9 if the document has no sections).
export function wordprocessingToPresentation(doc: WordprocessingContentDocument): PresentationContentDocument {
  const allBlocks: ContentBlock[] = doc.sections.flatMap((section) => section.blocks);
  const slideSize = doc.sections[0]?.pageSize ?? SLIDE_SIZE_WIDESCREEN;

  // Split into slide-groups at heading/page-break boundaries.
  const slideGroups: ContentBlock[][] = [];
  let current: ContentBlock[] = [];
  for (const block of allBlocks) {
    if (startsNewSlide(block) && current.length > 0) {
      slideGroups.push(current);
      current = [];
    }
    if (block.kind !== 'pageBreak') {
      current.push(block);
    }
  }
  if (current.length > 0 || slideGroups.length === 0) {
    slideGroups.push(current);
  }

  const slides: ContentSlide[] = slideGroups.map((blocks) => {
    const shape: ContentShape = {
      frame: { xPt: 0, yPt: 0, widthPt: slideSize.widthPt, heightPt: slideSize.heightPt },
      insetLeftPt: DEFAULT_INSET_LEFT_PT,
      insetTopPt: DEFAULT_INSET_TOP_PT,
      insetRightPt: DEFAULT_INSET_RIGHT_PT,
      insetBottomPt: DEFAULT_INSET_BOTTOM_PT,
      blocks,
    };
    return { size: slideSize, shapes: [shape], notes: '' };
  });

  return { kind: 'presentation', metadata: doc.metadata, slides };
}

// presentation → wordprocessing: concatenates every slide's shapes' blocks into one flow document (one section, A4 page). A deck has no flow structure, so slide boundaries are lost -- the blocks themselves (paragraphs, tables, images) survive intact, just concatenated. Each slide's content becomes a contiguous run of paragraphs in the resulting section.
export function presentationToWordprocessing(doc: PresentationContentDocument): WordprocessingContentDocument {
  const allBlocks: ContentBlock[] = doc.slides.flatMap((slide) => slide.shapes.flatMap((shape) => shape.blocks));
  const section: ContentSection = {
    pageSize: PAGE_SIZE_A4,
    margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
    blocks: allBlocks,
  };
  return { kind: 'wordprocessing', metadata: doc.metadata, sections: [section] };
}

// drawing → presentation: each draw page becomes a slide carrying the identical ContentShape array (ContentShape is the exact same type in both ContentDrawPage.shapes and ContentSlide.shapes -- the layout engines already share the convertShape function verbatim, so the shapes need zero per-shape adaptation). A slide is a strict subset of a draw page for shapes, so every text box, image, and table on the page survives intact at its own frame. What is lost: a draw page's vector primitives (rect/ellipse/line/path) have no slot on a ContentSlide at all, so vectors are silently dropped on this hop -- the same class of lossiness as wordprocessingToPresentation's own heading-boundary heuristic (a target-variant construct with no source counterpart), not an approximation of the vectors themselves. Slide size is the draw page's own size, carried through unchanged.
export function drawingToPresentation(doc: DrawingContentDocument): PresentationContentDocument {
  const slides: ContentSlide[] = doc.pages.map((page) => ({ size: page.size, shapes: page.shapes, notes: '' }));
  return { kind: 'presentation', metadata: doc.metadata, slides };
}

// presentation → drawing: each slide becomes a draw page carrying the identical ContentShape array, plus an empty vectors array (a slide carries no vector primitives, so there is nothing to populate it with). This direction is clean -- a slide is a strict subset of a draw page (size + shapes), so nothing the source carries is lost on the shapes axis. What is lost: a slide's speaker notes have no field on a ContentDrawPage, so notes are dropped on this hop, the same target-variant-has-no-counterpart class as the reverse direction's vector loss.
export function presentationToDrawing(doc: PresentationContentDocument): DrawingContentDocument {
  const pages: ContentDrawPage[] = doc.slides.map((slide) => ({ size: slide.size, shapes: slide.shapes, vectors: [] }));
  return { kind: 'drawing', metadata: doc.metadata, pages };
}
