import type {
  ContentBlock,
  ContentEmbeddedObjectBlock,
  ContentImageBlock,
  ContentParagraph,
  ContentRun,
  ContentSheet,
  ContentSheetCell,
  ContentTableCell,
  ContentTable,
  ContentVector,
  DocumentTree,
  LayoutFrame,
  PositionedFormula,
  TextMeasurer,
} from "document-schema.js";
import {
  COLOR_BLACK,
  DEFAULT_LAYOUT_FONT,
  flattenTree,
  resolveCellFillColor,
} from "document-schema.js";
import {
  createFontMeasurer,
  createFontRegistry,
  LAYOUT_FORMAT_VERSION,
  loadMathFont,
  writePdf,
} from "pdf-codec";
import { base64ToBytes } from "ooxml.js";
import { flipY } from "../model/geometry";
import { convertVector } from "../layout/drawing";
import { NOMINAL_CELL_TEXT_SIZE_PT } from "../layout/sheets";
import {
  formulaSizePtForFrame,
  NOMINAL_TEXT_SIZE_PT,
  pushCellBorderLines,
  registerImage,
  runFont,
} from "../layout/shared";
import {
  atomizeForWrap,
  firstWrappedLineOf,
  type WrapAtom,
} from "../layout/text-layout";
import { layoutFormula } from "../mathml/layout";
import { formulaOfBlock } from "../model/formula";
import { DOCUMENT_FORMAT_CODECS } from "../codecs/registry";
import { requireArrayBufferBytes } from "../model/bytes";
import { READ_ONLY_FORMATS } from "./capability";
import type { DocumentFormat } from "./port";
import type {
  FontRegistry,
  LayoutDocument,
  LayoutImage,
  LayoutImageAsset,
  LayoutItem,
  LayoutPage,
} from "pdf-codec";

// Builds any DocumentFormat's own bytes from an already-assembled tree-form DocumentTree -- the reverse of what every ergonomic X-to-PDF/PDF-to-X conversion's own onDocument callback hands back. The tree is flattened once at this boundary (flattenTree, which also materialises any styles-table refs away): the builders' public signatures already take the flat ContentDocument, so nothing downstream of this point knows the tree exists -- the boundary design in one sentence. Every target except 'pdf' dispatches through DOCUMENT_FORMAT_CODECS (src/codecs/registry.ts), building a fresh package through the identical buildXPackage function the matching pdf-to-X/bridge conversion already uses, then encoding it with that format's own codec -- xlsx goes through this exact same dispatch (DOCUMENT_FORMAT_CODECS.xlsx.content.write wraps ooxml.js's buildXlsxPackageFromContent), no longer a named exception. 'odf' still has no builder at all -- a standalone formula document has no write path from ContentDocument to begin with -- so it alone is rejected outright ahead of the registry lookup.
export function buildDocumentBytes(
  pkg: DocumentTree,
  target: DocumentFormat,
): Uint8Array<ArrayBuffer> {
  if (target === "pdf") {
    if (pkg.pages === undefined) {
      throw new Error(
        "this DocumentTree has no pages -- only a package dumped from a <format>-to-pdf or pdf-to-<format> conversion carries them; a bridge conversion's own dump (e.g. odt-to-docx) never does, so 'pdf' is not a reachable target from it",
      );
    }
    const { document: layout, formulas, fonts } = packageToLayout(pkg);
    // The fonts registry is the same one the walk measured through, so the re-render draws at the advances its re-derived wrap was measured against. writePdf treats an empty formulas array and an omitted option identically (its embedded math font group is allocated only when the array is non-empty), and a registry with no resolved faces is the no-op it always was, so a package with no formulas still builds byte-identical to before.
    return writePdf(
      layout,
      formulas.length > 0 ? { formulas, fonts } : { fonts },
    );
  }
  // A read-only format (capability.ts's READ_ONLY_FORMATS) has no writer at all, so naming one as a target is a caller error with a real answer rather than a registry gap: 'odf' (a standalone formula document) has no ContentDocument-to-formula path anywhere in the family, and 'wpd' has none because wpd-codec deliberately ships no writer. One check covers both, and covers whichever read-only format joins them next.
  if (READ_ONLY_FORMATS.has(target)) {
    throw new Error(
      `'${target}' is a read-only format: it cannot be built from a DocumentTree, because there is no ContentDocument-to-${target} builder`,
    );
  }
  const content = DOCUMENT_FORMAT_CODECS[target].content;
  if (!content?.write) {
    throw new Error(
      `DocumentFormat '${target}' has no content.write codec in DOCUMENT_FORMAT_CODECS, is not 'pdf', and is not read-only -- this is an internal invariant violation, not a caller error`,
    );
  }
  return requireArrayBufferBytes(content.write(flattenTree(pkg)));
}

// --- The frames-to-layout inverse ----------------------------------------------------------------
//
// Rebuilds the pdf-codec LayoutDocument a package's own frames + pages describe: a mechanical inverse that walks the content tree and emits LayoutItems from each node's own recorded placements. This is the fusion-faithful direction -- the package now CARRIES the positions (a layout pass stamped them onto content's own nodes), so from-package reconstructs the pdf-codec view from them rather than needing a parallel layout side-channel, which is exactly the second-tree coupling the fused DocumentTree design removed.
//
// One honest limit, a structural property of what a package records rather than a gap in this walk: a bare DocumentTree carries no source-EMBEDDED font bytes, so text re-renders through pdf-codec's vendored substitutes and the standard 14 rather than the source document's own embedded faces.
//
// The two limits this walk used to carry are closed:
//
// 1. Wrap distribution is RE-DERIVED, not guessed: a run's frames each record the tight width of the fragment the original wrap placed there (shared.ts's textBoxForFragment stamps the same measurement the wrapping pass made), and re-wrapping the run's remaining text against each frame's own recorded width through the same registry-backed metrics the re-render draws with (wrapRunsToWidth, the identical line-breaker the layout engines run) reproduces the original split wherever the original also resolved through the vendored/standard layers -- and where it did not (an embedded face the rebuild no longer has), the re-derived wrap and the re-render at least stay consistent with each other, wrapping and drawing through the same substitute metrics, where the old behaviour drew one long overflowing line.
// 2. An embedded formula is RE-TYPESET from its own recorded MathML: the formula block carries the full ContentFormula (mathml tree and all) in the content, so its frame is enough to re-run the identical layoutFormula + loadMathFont pipeline the original pass ran, at the size the recorded frame's own two-pass fit recovers. Only a formula whose source carried no MathML at all (mathml: []) still renders as nothing -- there is genuinely nothing to typeset.

interface FrameWalkState {
  readonly pages: LayoutPage[];
  readonly images: Record<string, LayoutImageAsset>;
  // The measurer the wrap re-derivation below measures through, built over the same registry the re-render draws through (state.fonts) so a re-derived split and its re-render agree with each other by construction -- measuring one face's advances while drawing another's is exactly the drift measure.ts's own module comment forbids.
  readonly measurer: TextMeasurer;
  // The registry both halves of the rebuild share: pdf-codec's vendored substitutes ahead of the standard 14, with no source-embedded faces (the one layer a bare DocumentTree does not carry). Measuring through it is what makes the re-derived wrap reproduce the original split wherever the original also resolved through the vendored/standard layers, and drawing through it is what makes the re-render match that measurement.
  readonly fonts: FontRegistry;
  // Every embedded formula re-typeset during the walk, for buildDocumentBytes to hand to writePdf's own formulas side channel -- the same hand-off convertWordprocessingToLayout's own result makes.
  readonly formulas: PositionedFormula[];
}

// The page a frame's own pageIndex names, or undefined when it points outside the package's own pages array -- an internally inconsistent or hand-edited package. There is nothing to render such a frame onto, so each emitter skips it; every other frame in the same tree still renders.
function pageOfFrame(
  state: FrameWalkState,
  frame: LayoutFrame,
): LayoutPage | undefined {
  return state.pages[frame.pageIndex];
}

// One run's emission. A single-frame run (the common case: an unwrapped line, a spreadsheet cell) renders its whole text at that frame exactly as before. A multi-frame run is a wrapped line set: each frame's own width is the tight measured width of the fragment the original wrap placed there, so re-wrapping the remaining text against each frame's width through wrapRunsToWidth -- the identical line-breaker the layout engines themselves run -- reproduces the fragment boundaries wherever the original drew through the same standard-14 metrics, and a hyperlink covers every fragment it spans (one link per frame, the same way the engines stamp a link over each wrapped fragment). Font resolution mirrors the layout engines' own defaults (shared.ts's runFont and NOMINAL_TEXT_SIZE_PT), so a run that carried no explicit formatting renders as it would have laid out.
function emitRun(state: FrameWalkState, run: ContentRun): void {
  const frames = run.frames ?? [];
  const font = runFont(run);
  const sizePt = run.sizePt ?? NOMINAL_TEXT_SIZE_PT;
  const color = run.color ?? COLOR_BLACK;

  // The frames a page actually exists for -- an out-of-range pageIndex drops that placement, exactly as every other emitter here drops one.
  const placements = frames.filter(
    (frame) => pageOfFrame(state, frame) !== undefined,
  );
  if (placements.length === 0) {
    return;
  }

  const fragments =
    placements.length === 1
      ? [run.text]
      : rederiveWrapFragments(
          run.text,
          font,
          sizePt,
          placements,
          state.measurer,
        );

  // Text that no frame's budget could hold (more fragments than frames) joins the last fragment rather than being dropped -- the same overflow failure mode a single-frame run has always had, confined to the tail.
  for (const [index, frame] of placements.entries()) {
    const page = pageOfFrame(state, frame);
    if (page === undefined) {
      continue;
    }
    const text =
      index === placements.length - 1
        ? fragments.slice(index).join(" ")
        : fragments[index];
    if (text !== undefined && text !== "") {
      page.items.push({
        kind: "text",
        text,
        xPt: frame.xPt,
        yPt: frame.yPt,
        font,
        sizePt,
        color,
        underline: run.underline,
      });
    }
    if (run.hyperlink !== undefined) {
      page.items.push({
        kind: "link",
        uri: run.hyperlink,
        xPt: frame.xPt,
        yPt: frame.yPt,
        widthPt: frame.widthPt,
        heightPt: frame.heightPt,
      });
    }
  }
}

// Re-derives a wrapped run's per-frame fragments: wrap the remaining text against each frame's own recorded width, take the first line as that frame's fragment, and carry the rest to the next frame. wrapRunsToWidth consumed exactly a prefix of the remaining text (its fragments come from tokenising that text), so the remainder is recovered by slicing; if that prefix property ever fails to hold for some wrap edge case, the whole run falls back to the single-frame rendering rather than emitting text that does not match its frames.
function rederiveWrapFragments(
  text: string,
  font: ReturnType<typeof runFont>,
  sizePt: number,
  frames: readonly LayoutFrame[],
  measurer: TextMeasurer,
): string[] {
  // Atomise once, then consume one line per frame from the already-measured atoms: each frame takes only line 1 of a wrap at its own recorded width, so re-running the whole-text wrapper per frame measured the entire remaining suffix N times for N frames -- quadratic work an untrusted many-frame run could drive into seconds of event-loop blockage through the from_package MCP tool. The incremental consumer spends each atom's measurement once. The consistency guard runs against the same running remaining-string the whole-text approach used (sliced and trimStart-ed per consumed line), not against a concatenation of per-line texts: a wrap boundary's glue is consumed by the wrap itself and belongs to no fragment, so a prefix-concatenation guard would spuriously trip on every space at a wrap point.
  let atoms = atomizeForWrap(
    [{ text, font, sizePt, color: COLOR_BLACK }],
    measurer,
  );
  let remaining = text;
  const fragments: string[] = [];
  for (const frame of frames) {
    if (remaining === "" || atoms.length === 0) {
      break;
    }
    const { line, rest } = firstWrappedLineOf(atoms, measurer, frame.widthPt);
    const consumed = line.fragments.map((f) => f.text).join("");
    if (!remaining.startsWith(consumed)) {
      return [text];
    }
    remaining = remaining.slice(consumed.length).trimStart();
    fragments.push(consumed.trimEnd());
    atoms = trimLeadingGlueAtoms(rest);
  }
  return fragments;
}

// A consumed line's trailing glue is trimmed by the consumer itself; the NEXT line must not begin with the glue that ended the previous one (the whole-text wrapper skips it when starting its next line), so the incremental caller trims leading glue between frames -- the join the wrapper performs implicitly by never queueing a line-leading glue onto a fresh line.
function trimLeadingGlueAtoms(atoms: readonly WrapAtom[]): WrapAtom[] {
  let start = 0;
  while (start < atoms.length && atoms[start]?.kind === "glue") {
    start++;
  }
  return atoms.slice(start);
}

// A paragraph's own frames record its list-marker placements (engine.ts stamps the paragraph node, not any run, for the marker it derives from list membership). The marker text itself came from the engine's own per-numId counters, which a package does not carry, so there is nothing honest to re-render at those positions -- the frames stay recorded on the node (traceability) and emit nothing here.
function emitParagraph(
  state: FrameWalkState,
  paragraph: ContentParagraph,
): void {
  for (const run of paragraph.runs) {
    emitRun(state, run);
  }
}

function emitImageBlock(
  state: FrameWalkState,
  block: ContentImageBlock,
  frames: readonly LayoutFrame[] | undefined,
): void {
  for (const frame of frames ?? []) {
    const page = pageOfFrame(state, frame);
    if (page === undefined) {
      continue;
    }
    const imageId = registerImage(block, state.images);
    const image: LayoutImage = {
      kind: "image",
      imageId,
      xPt: frame.xPt,
      yPt: frame.yPt,
      widthPt: frame.widthPt,
      heightPt: frame.heightPt,
    };
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
    // A rect's own fill is one flat colour, so a 'pattern' fill (ExaDev/documents.js#951) renders as resolveCellFillColor's own single representative colour rather than the genuine two-colour pattern PDF rendering has no primitive for -- and that resolution can itself come back undefined (an unresolvable theme/indexed colour, or the reserved gray125 pattern with no explicit colours), which is genuinely no fill rather than a reason to skip resolving at all, so the guard checks the RESOLVED colour, not merely whether the cell declared a background object.
    const cellFill =
      cell.background === undefined
        ? undefined
        : resolveCellFillColor(cell.background);
    if (cellFill !== undefined) {
      page.items.push({
        kind: "rect",
        xPt: frame.xPt,
        yPt: frame.yPt,
        widthPt: frame.widthPt,
        heightPt: frame.heightPt,
        fill: cellFill,
      });
    }
    if (cell.borders !== undefined) {
      const frameYDown = flipY(
        {
          xPt: frame.xPt,
          yPt: frame.yPt,
          widthPt: frame.widthPt,
          heightPt: frame.heightPt,
        },
        page.heightPt,
      );
      pushCellBorderLines(
        cell.borders,
        frameYDown,
        page.heightPt,
        cell.sourcePath,
        page.items,
      );
    }
  }
  for (const block of cell.blocks) {
    if (block.kind === "paragraph") {
      emitParagraph(state, block);
    } else if (block.kind === "image") {
      emitImageBlock(state, block, block.frames);
    } else if (block.kind === "table") {
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
  const hasStampedRuns = (cell.runs ?? []).some(
    (run) => (run.frames?.length ?? 0) > 0,
  );
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
      page.items.push({
        kind: "text",
        text: cell.displayText,
        xPt: frame.xPt,
        yPt: frame.yPt,
        font: DEFAULT_LAYOUT_FONT,
        sizePt: NOMINAL_CELL_TEXT_SIZE_PT,
        color: COLOR_BLACK,
      });
    }
  }
  for (const frame of cell.frames ?? []) {
    const page = pageOfFrame(state, frame);
    if (page === undefined) {
      continue;
    }
    // A rect's own fill is one flat colour, so a 'pattern' fill (ExaDev/documents.js#951) renders as resolveCellFillColor's own single representative colour rather than the genuine two-colour pattern PDF rendering has no primitive for -- and that resolution can itself come back undefined (an unresolvable theme/indexed colour, or the reserved gray125 pattern with no explicit colours), which is genuinely no fill rather than a reason to skip resolving at all, so the guard checks the RESOLVED colour, not merely whether the cell declared a background object.
    const cellFill =
      cell.background === undefined
        ? undefined
        : resolveCellFillColor(cell.background);
    if (cellFill !== undefined) {
      page.items.push({
        kind: "rect",
        xPt: frame.xPt,
        yPt: frame.yPt,
        widthPt: frame.widthPt,
        heightPt: frame.heightPt,
        fill: cellFill,
      });
    }
    if (cell.borders !== undefined) {
      const frameYDown = flipY(
        {
          xPt: frame.xPt,
          yPt: frame.yPt,
          widthPt: frame.widthPt,
          heightPt: frame.heightPt,
        },
        page.heightPt,
      );
      pushCellBorderLines(
        cell.borders,
        frameYDown,
        page.heightPt,
        cell.sourcePath,
        page.items,
      );
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
      const layoutImage: LayoutImage = {
        kind: "image",
        imageId,
        xPt: frame.xPt,
        yPt: frame.yPt,
        widthPt: frame.widthPt,
        heightPt: frame.heightPt,
      };
      page.items.push(layoutImage);
    }
  }
}

// The shared block walk for the three shape-carrying variants (wordprocessing sections, presentation slides, drawing pages): paragraphs/images/tables/embedded objects emit from their own frames wherever they sit in the tree.
function emitBlocks(
  state: FrameWalkState,
  blocks: readonly ContentBlock[],
): void {
  for (const block of blocks) {
    if (block.kind === "paragraph") {
      emitParagraph(state, block);
    } else if (block.kind === "image") {
      emitImageBlock(state, block, block.frames);
    } else if (block.kind === "table") {
      emitTable(state, block);
    } else if (block.kind === "embeddedObject") {
      emitEmbeddedObjectBlock(state, block);
    }
    // 'pageBreak' emits nothing: it is structural, with no placement of its own.
  }
}

// One embedded object block. A formula is re-typeset at its own recorded frames through the identical layoutFormula + loadMathFont pipeline the original layout pass ran (formulaSizePtForFrame's two-pass fit against the recorded frame recovers the size the original chose), landing in writePdf's own formulas side channel -- the same channel the original pass used, which is why nothing of this renders as a page item. A non-formula embedded object (a chart, a sub-document) still emits nothing: the original pass did not render its glyphs either, so the frame stays a position record. A formula whose source carried no MathML (mathml: []) has nothing to typeset and renders as nothing -- the honest floor, not a guess.
function emitEmbeddedObjectBlock(
  state: FrameWalkState,
  block: ContentEmbeddedObjectBlock,
): void {
  const formula = formulaOfBlock(block);
  if (formula === undefined || formula.mathml.length === 0) {
    return;
  }
  const { metricsAt } = loadMathFont();
  for (const frame of block.frames ?? []) {
    if (pageOfFrame(state, frame) === undefined) {
      continue;
    }
    const sizePt = formulaSizePtForFrame(formula.mathml, frame, metricsAt);
    const { box } = layoutFormula(formula.mathml, {
      metrics: metricsAt(sizePt),
      sizePt,
      color: COLOR_BLACK,
    });
    state.formulas.push({
      pageIndex: frame.pageIndex,
      xPt: frame.xPt,
      yPt: frame.yPt,
      box,
    });
  }
}

// The public inverse. Flattens the tree once (materialising any styles refs away) and walks the flat content's own structure in document order, so the items land on each page in the same order the original layout pass emitted them (paint order is array order); a package whose content carries no frames at all (a bridge dump, or fresh reader output) still rebuilds the pages themselves, empty. Walking the flattened form rather than the tree directly is a deliberate one-implementation choice: flatten is the single tree-to-flat authority (bijection-tested), the walk below stays the flat document walk it always was, and every other consumer (buildDocumentBytes, lintMathCoherence) shares the same flattened view.
export function layoutDocumentFromPackage(pkg: DocumentTree): LayoutDocument {
  return packageToLayout(pkg).document;
}

// The full walk both consumers share: the LayoutDocument a package's frames describe, plus the re-typeset positioned formulas that travel beside it. layoutDocumentFromPackage is the LayoutDocument-only public view; buildDocumentBytes needs the formulas half too, and both must run the identical walk so the public view and the built bytes never disagree.
function packageToLayout(pkg: DocumentTree): {
  document: LayoutDocument;
  formulas: PositionedFormula[];
  fonts: FontRegistry;
} {
  const pages: LayoutPage[] = (pkg.pages ?? []).map((page) => ({
    widthPt: page.widthPt,
    heightPt: page.heightPt,
    items: [],
  }));
  // The tree's own embedded font faces (document-schema.js's tree-only `fonts` table, spliced by whichever construction site read a package that embedded them) feed the rebuild's registry as sourceFonts, so a rebuild renders through the document's real faces rather than vendored substitutes and the standard 14 -- the one layer of the original package a tree previously could not carry (ExaDev/documents.js#1192). An empty or absent table keeps the identical registry construction a tree without embedded fonts always had, byte-for-byte.
  const fonts =
    pkg.fonts !== undefined && pkg.fonts.length > 0
      ? createFontRegistry({
          sourceFonts: pkg.fonts.map((face) => ({
            family: face.family,
            bold: face.bold,
            italic: face.italic,
            bytes: requireArrayBufferBytes(base64ToBytes(face.base64)),
          })),
        })
      : createFontRegistry({});
  const state: FrameWalkState = {
    pages,
    images: {},
    measurer: createFontMeasurer(fonts),
    fonts,
    formulas: [],
  };
  const content = flattenTree(pkg);
  if (content.kind === "wordprocessing") {
    for (const section of content.sections) {
      emitBlocks(state, section.blocks);
    }
  } else if (content.kind === "presentation") {
    for (const slide of content.slides) {
      for (const shape of slide.shapes) {
        // A shape's own frames carry no renderable payload (a bare shape emits no item of its own -- its content blocks carry everything), so only its blocks walk.
        emitBlocks(state, shape.blocks);
      }
    }
  } else if (content.kind === "spreadsheet") {
    for (const sheet of content.sheets) {
      emitSheet(state, sheet);
    }
  } else if (content.kind === "drawing") {
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
  return {
    document: {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: content.metadata,
      pages,
      images: state.images,
    },
    formulas: state.formulas,
    fonts: state.fonts,
  };
}
