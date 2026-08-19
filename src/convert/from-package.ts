import type { ContentBlock, ContentImageBlock, ContentParagraph, ContentRun, ContentSheet, ContentSheetCell, ContentTableCell, ContentTable, ContentVector, DocumentPackage, LayoutFrame } from 'document-schema.js';
import { COLOR_BLACK, DEFAULT_LAYOUT_FONT, flattenPackage } from 'document-schema.js';
import { LAYOUT_FORMAT_VERSION, writePdf } from 'pdf-codec';
import { flipY } from '../model/geometry';
import { convertVector } from '../layout/drawing';
import { NOMINAL_CELL_TEXT_SIZE_PT } from '../layout/sheets';
import { NOMINAL_TEXT_SIZE_PT, pushCellBorderLines, registerImage, runFont } from '../layout/shared';
import { DOCUMENT_FORMAT_CODECS, requireArrayBufferBytes } from '../codecs/registry';
import type { DocumentFormat } from './port';
import type { LayoutDocument, LayoutImage, LayoutImageAsset, LayoutItem, LayoutLink, LayoutPage, LayoutText } from 'pdf-codec';

// Builds any DocumentFormat's own bytes from an already-assembled tree-form DocumentPackage -- the reverse of what every ergonomic X-to-PDF/PDF-to-X conversion's own onDocument callback hands back. The tree is flattened once at this boundary (flattenPackage, which also materialises any styles-table refs away): the builders' public signatures already take the flat ContentDocument, so nothing downstream of this point knows the tree exists -- the boundary design in one sentence. Every target except 'pdf' dispatches through DOCUMENT_FORMAT_CODECS (src/codecs/registry.ts), building a fresh package through the identical buildXPackage function the matching pdf-to-X/bridge conversion already uses, then encoding it with that format's own codec -- xlsx goes through this exact same dispatch (DOCUMENT_FORMAT_CODECS.xlsx.content.write wraps ooxml.js's buildXlsxPackage), no longer a named exception. 'odf' still has no builder at all -- a standalone formula document has no write path from ContentDocument to begin with -- so it alone is rejected outright ahead of the registry lookup.
export function buildDocumentBytes(pkg: DocumentPackage, target: DocumentFormat): Uint8Array<ArrayBuffer> {
  if (target === 'pdf') {
    if (pkg.pages === undefined) {
      throw new Error("this DocumentPackage has no pages -- only a package dumped from a <format>-to-pdf or pdf-to-<format> conversion carries them; a bridge conversion's own dump (e.g. odt-to-docx) never does, so 'pdf' is not a reachable target from it");
    }
    return writePdf(layoutDocumentFromPackage(pkg));
  }
  if (target === 'odf') {
    throw new Error("'odf' (a standalone formula document) cannot be built from a DocumentPackage -- there is no ContentDocument-to-odf builder");
  }
  const content = DOCUMENT_FORMAT_CODECS[target].content;
  if (!content?.write) {
    throw new Error(`DocumentFormat '${target}' has no content.write codec in DOCUMENT_FORMAT_CODECS, and is not 'pdf'/'odf' -- this is an internal invariant violation, not a caller error`);
  }
  return requireArrayBufferBytes(content.write(flattenPackage(pkg)));
}

// --- The frames-to-layout inverse ----------------------------------------------------------------
//
// Rebuilds the pdf-codec LayoutDocument a package's own frames + pages describe: a mechanical inverse that walks the content tree and emits LayoutItems from each node's own recorded placements. This is the fusion-faithful direction -- the package now CARRIES the positions (a layout pass stamped them onto content's own nodes), so from-package reconstructs the pdf-codec view from them rather than needing a parallel layout side-channel, which is exactly the second-tree coupling the fused DocumentPackage design removed.
//
// Two honest limits, both structural properties of what a package records, not gaps in this walk:
//
// 1. A run's frames record POSITIONS, not the wrap decisions that distributed its text across them. Re-splitting the text would need the font metrics the original layout pass had; guessing a split would garble words. So a run's full text renders once, at its first recorded placement, and its further frames carry no additional text -- a single-frame run (the common case: an unwrapped line, a spreadsheet cell) round-trips exactly; a wrapped run re-renders as one long overflowing line. A spreadsheet cell is exempt by construction: sheets.ts lays cell text out as a single line, so a cell's own displayText at its own frame is an exact re-render.
// 2. No font registry and no positioned formulas survive a bare DocumentPackage, exactly as before the fusion: a formula block's frame records where it sat while its glyphs render as nothing, and text draws through the standard 14 or a caller-configured default face.

interface FrameWalkState {
  readonly pages: LayoutPage[];
  readonly images: Record<string, LayoutImageAsset>;
}

// The page a frame's own pageIndex names, or undefined when it points outside the package's own pages array -- an internally inconsistent or hand-edited package. There is nothing to render such a frame onto, so each emitter skips it; every other frame in the same tree still renders.
function pageOfFrame(state: FrameWalkState, frame: LayoutFrame): LayoutPage | undefined {
  return state.pages[frame.pageIndex];
}

// One run's emission: the run's full text at its FIRST frame (the wrap-decision limit above), plus a LayoutLink alongside when the run is hyperlinked. Font resolution mirrors the layout engines' own defaults (shared.ts's runFont and NOMINAL_TEXT_SIZE_PT), so a run that carried no explicit formatting renders as it would have laid out.
function emitRun(state: FrameWalkState, run: ContentRun): void {
  const frame = run.frames?.[0];
  if (frame === undefined) {
    return;
  }
  const page = pageOfFrame(state, frame);
  if (page === undefined) {
    return;
  }
  const font = runFont(run);
  const sizePt = run.sizePt ?? NOMINAL_TEXT_SIZE_PT;
  const textItem: LayoutText = { kind: 'text', text: run.text, xPt: frame.xPt, yPt: frame.yPt, font, sizePt, color: run.color ?? COLOR_BLACK, underline: run.underline };
  page.items.push(textItem);
  if (run.hyperlink !== undefined) {
    const link: LayoutLink = { kind: 'link', uri: run.hyperlink, xPt: frame.xPt, yPt: frame.yPt, widthPt: frame.widthPt, heightPt: frame.heightPt };
    page.items.push(link);
  }
}

// A paragraph's own frames record its list-marker placements (engine.ts stamps the paragraph node, not any run, for the marker it derives from list membership). The marker text itself came from the engine's own per-numId counters, which a package does not carry, so there is nothing honest to re-render at those positions -- the frames stay recorded on the node (traceability) and emit nothing here.
function emitParagraph(state: FrameWalkState, paragraph: ContentParagraph): void {
  for (const run of paragraph.runs) {
    emitRun(state, run);
  }
}

function emitImageBlock(state: FrameWalkState, block: ContentImageBlock, frames: readonly LayoutFrame[] | undefined): void {
  for (const frame of frames ?? []) {
    const page = pageOfFrame(state, frame);
    if (page === undefined) {
      continue;
    }
    const imageId = registerImage(block, state.images);
    const image: LayoutImage = { kind: 'image', imageId, xPt: frame.xPt, yPt: frame.yPt, widthPt: frame.widthPt, heightPt: frame.heightPt };
    page.items.push(image);
  }
}

// A table cell's own frame is the whole cell box: its declared background re-renders as the LayoutRect the engine emitted, and its declared borders as the same four edge lines pushCellBorderLines produces from a y-down frame -- flipY is its own exact inverse, so un-flipping through the package's own page height recovers the frame the original emission started from.
function emitTableCell(state: FrameWalkState, cell: ContentTableCell): void {
  for (const frame of cell.frames ?? []) {
    const page = pageOfFrame(state, frame);
    if (page === undefined) {
      continue;
    }
    if (cell.background !== undefined) {
      page.items.push({ kind: 'rect', xPt: frame.xPt, yPt: frame.yPt, widthPt: frame.widthPt, heightPt: frame.heightPt, fill: cell.background });
    }
    if (cell.borders !== undefined) {
      const frameYDown = flipY({ xPt: frame.xPt, yPt: frame.yPt, widthPt: frame.widthPt, heightPt: frame.heightPt }, page.heightPt);
      pushCellBorderLines(cell.borders, frameYDown, page.heightPt, cell.sourcePath, page.items);
    }
  }
  for (const block of cell.blocks) {
    if (block.kind === 'paragraph') {
      emitParagraph(state, block);
    } else if (block.kind === 'image') {
      emitImageBlock(state, block, block.frames);
    } else if (block.kind === 'table') {
      emitTable(state, block);
    }
  }
}

function emitTable(state: FrameWalkState, table: ContentTable): void {
  for (const row of table.rows) {
    for (const cell of row.cells) {
      emitTableCell(state, cell);
    }
  }
}

// One drawing vector: re-runs the layout engine's own single vector-to-item conversion against the frame's own page height, so the rebuilt geometry is identical to a fresh layout pass's emission by construction (one implementation, no drift) -- a vector's own frame plus the page height fully determine its placement, which is what makes the exact re-derivation possible where text wrapping is not.
function emitVector(state: FrameWalkState, vector: ContentVector): void {
  for (const frame of vector.frames ?? []) {
    const page = pageOfFrame(state, frame);
    if (page === undefined) {
      continue;
    }
    const items: LayoutItem[] = page.items;
    convertVector(vector, page.heightPt, items);
  }
}

// One spreadsheet cell. A cell whose runs carry stamped frames renders those (per-run styling survives); a cell with no runs -- or none that rendered, e.g. a numeric overflow the engine replaced with a synthesised '###' -- falls back to its displayText at the cell's own frames through the same nominal font/size the sheets engine itself renders an unstyled cell at. Exact either way, per the single-line note in the module doc above.
function emitSheetCell(state: FrameWalkState, cell: ContentSheetCell): void {
  const hasStampedRuns = (cell.runs ?? []).some((run) => (run.frames?.length ?? 0) > 0);
  if (hasStampedRuns) {
    for (const run of cell.runs ?? []) {
      emitRun(state, run);
    }
  } else {
    for (const frame of cell.frames ?? []) {
      const page = pageOfFrame(state, frame);
      if (page === undefined) {
        continue;
      }
      page.items.push({ kind: 'text', text: cell.displayText, xPt: frame.xPt, yPt: frame.yPt, font: DEFAULT_LAYOUT_FONT, sizePt: NOMINAL_CELL_TEXT_SIZE_PT, color: COLOR_BLACK });
    }
  }
  for (const frame of cell.frames ?? []) {
    const page = pageOfFrame(state, frame);
    if (page === undefined) {
      continue;
    }
    if (cell.background !== undefined) {
      page.items.push({ kind: 'rect', xPt: frame.xPt, yPt: frame.yPt, widthPt: frame.widthPt, heightPt: frame.heightPt, fill: cell.background });
    }
    if (cell.borders !== undefined) {
      const frameYDown = flipY({ xPt: frame.xPt, yPt: frame.yPt, widthPt: frame.widthPt, heightPt: frame.heightPt }, page.heightPt);
      pushCellBorderLines(cell.borders, frameYDown, page.heightPt, cell.sourcePath, page.items);
    }
  }
}

// One sheet: every populated cell, then every floating (cell-anchored) image at its own recorded frames.
function emitSheet(state: FrameWalkState, sheet: ContentSheet): void {
  for (const cell of sheet.cells) {
    emitSheetCell(state, cell);
  }
  for (const image of sheet.images) {
    for (const frame of image.frames ?? []) {
      const page = pageOfFrame(state, frame);
      if (page === undefined) {
        continue;
      }
      const imageId = registerImage(image, state.images);
      const layoutImage: LayoutImage = { kind: 'image', imageId, xPt: frame.xPt, yPt: frame.yPt, widthPt: frame.widthPt, heightPt: frame.heightPt };
      page.items.push(layoutImage);
    }
  }
}

// The shared block walk for the three shape-carrying variants (wordprocessing sections, presentation slides, drawing pages): paragraphs/images/tables/embedded objects emit from their own frames wherever they sit in the tree.
function emitBlocks(state: FrameWalkState, blocks: readonly ContentBlock[]): void {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      emitParagraph(state, block);
    } else if (block.kind === 'image') {
      emitImageBlock(state, block, block.frames);
    } else if (block.kind === 'table') {
      emitTable(state, block);
    }
    // 'embeddedObject' and 'pageBreak' emit nothing: an embedded formula's glyphs rendered through writePdf's positioned-formulas channel (CID-font glyph runs with no LayoutItem kind, which never travelled in a DocumentPackage even before the fusion -- its frame is honoured as a position record on the node, and nothing renders from it), and a page break is structural, with no placement of its own.
  }
}

// The public inverse. Flattens the tree once (materialising any styles refs away) and walks the flat content's own structure in document order, so the items land on each page in the same order the original layout pass emitted them (paint order is array order); a package whose content carries no frames at all (a bridge dump, or fresh reader output) still rebuilds the pages themselves, empty. Walking the flattened form rather than the tree directly is a deliberate one-implementation choice: flatten is the single tree-to-flat authority (bijection-tested), the walk below stays the flat document walk it always was, and every other consumer (buildDocumentBytes, lintMathCoherence) shares the same flattened view.
export function layoutDocumentFromPackage(pkg: DocumentPackage): LayoutDocument {
  const pages: LayoutPage[] = (pkg.pages ?? []).map((page) => ({ widthPt: page.widthPt, heightPt: page.heightPt, items: [] }));
  const state: FrameWalkState = { pages, images: {} };
  const content = flattenPackage(pkg);
  if (content.kind === 'wordprocessing') {
    for (const section of content.sections) {
      emitBlocks(state, section.blocks);
    }
  } else if (content.kind === 'presentation') {
    for (const slide of content.slides) {
      for (const shape of slide.shapes) {
        // A shape's own frames carry no renderable payload (a bare shape emits no item of its own -- its content blocks carry everything), so only its blocks walk.
        emitBlocks(state, shape.blocks);
      }
    }
  } else if (content.kind === 'spreadsheet') {
    for (const sheet of content.sheets) {
      emitSheet(state, sheet);
    }
  } else if (content.kind === 'drawing') {
    for (const drawPage of content.pages) {
      for (const vector of drawPage.vectors) {
        emitVector(state, vector);
      }
      for (const shape of drawPage.shapes) {
        emitBlocks(state, shape.blocks);
      }
    }
  }
  // 'formula' content has no frames to walk at all: a standalone formula document renders through writePdf's own formula positioning (see convert.ts's odfToPdf), of which a package carries no record beyond the page sizes themselves.
  return { formatVersion: LAYOUT_FORMAT_VERSION, metadata: content.metadata, pages, images: state.images };
}
