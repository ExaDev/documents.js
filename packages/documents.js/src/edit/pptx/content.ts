import type {
  ContentBlock,
  ContentDocument,
  ContentParagraph,
  ContentShape,
  ContentTable,
} from "document-schema.js";
import { resolveCellFillColor } from "document-schema.js";
import type { Package } from "ooxml.js";
import type { EmbeddedPresentationSerialiser } from "ooxml.js";
import { base64ToBytes, encodePackage } from "ooxml.js";
import {
  drawingOfBlock,
  embeddedDrawingVectors,
} from "../../model/embedded-drawing";
import { formulaOfBlock, formulaPlaceholderText } from "../../model/formula";
import { resolveMetadataTimestamps } from "../../model/metadata";
import type { OmmlDiagnosticSink } from "../../ooxml/pptx/formula";
import type { ClockPort } from "../../ports/clock";
import { systemClock } from "../../ports/clock";
import type { DrawingParagraphInit } from "./shape";
import { PptxEditor } from "./editor";
import { createEmptyPptxPackage } from "./scaffold";
import type { PptxSlide } from "./slide";
import type { PptxTable, PptxTableCell } from "./table";

// clock resolves content.metadata's own createdIso/modifiedIso the same way createPptx does (src/model/metadata.ts's resolveMetadataTimestamps) -- systemClock by default, never overwriting a createdIso/modifiedIso the source content already carried. onMathDiagnostic mirrors BuildDocxPackageOptions's own field exactly (src/edit/docx/content.ts) -- ExaDev/documents.js#563's write side now has the identical MathML -> OMML degrade-diagnostic channel docx already exposes.
export interface BuildPptxPackageOptions {
  readonly clock?: ClockPort;
  readonly onMathDiagnostic?: OmmlDiagnosticSink;
}

// ContentDocument -> a fresh pptx Package, the write-side counterpart to src/ooxml/pptx/read.ts's readPptxContent. Used by the PDF->pptx conversion path. Constructs its own package directly (createEmptyPptxPackage + PptxEditor) rather than calling createPptx(), mirroring buildDocxPackage's own identical reasoning (src/edit/docx/content.ts): createPptx() always starts metadata from {}, but this function needs the SOURCE content's own metadata to reach resolveMetadataTimestamps.
//
// One remaining gap, bounded and tracked rather than silent: every slide shares one deck-wide size (p:sldSz is presentation-level, not per-slide) -- taken from the first slide, since PDF-reconstructed pages that come from a single source document invariably share one page size in practice.
export function buildPptxPackage(
  content: ContentDocument,
  options?: BuildPptxPackageOptions,
): Package {
  if (content.kind !== "presentation") {
    throw new Error("buildPptxPackage requires a presentation ContentDocument");
  }
  const clock = options?.clock ?? systemClock;
  const metadata = resolveMetadataTimestamps(content.metadata, clock);
  const editor = new PptxEditor(createEmptyPptxPackage({ metadata }));
  const firstSlide = content.slides[0];
  if (firstSlide !== undefined) {
    editor.slideSize = firstSlide.size;
  }
  for (const slide of content.slides) {
    const pptxSlide = editor.addSlide();
    for (const shape of slide.shapes) {
      appendShape(pptxSlide, shape, options);
    }
    if (slide.notes.length > 0) {
      pptxSlide.notes = slide.notes;
    }
  }
  return editor.toPackage();
}

// The wiring half of #742's port: ooxml.js's docx writer (buildDocxPackageFromContent/buildDocxPackage) accepts an injected presentation serialiser because the only pptx writer in the ecosystem -- this buildPptxPackage -- sits one layer above it, where a dependency would invert the family's layering. This value is that serialiser: pass it as BuildDocxContentOptions.serialiseEmbeddedPresentation and a docx whose embedded OLE object carries a presentation document (readDocxContent genuinely recovers one) round-trips through the pair instead of being refused, the nested deck re-serialised into a real word/embeddings/oleObjectN.pptx payload by the identical builder the pptx write path uses.
export const embeddedPresentationSerialiser: EmbeddedPresentationSerialiser = (
  document,
) => encodePackage(buildPptxPackage(document));

function appendShape(
  slide: PptxSlide,
  shape: ContentShape,
  options?: BuildPptxPackageOptions,
): void {
  const [onlyBlock] = shape.blocks;
  // A shape carrying nothing but a recovered DRAWING (src/layout/reconstruct.ts's own vector recovery wraps one in a shape, since a slide has no other container for a block) becomes one real DrawingML autoshape per vector primitive on the slide's own shape tree -- NOT a single containing shape, since PresentationML positions every p:sp against the slide directly and has no "shape holding loose geometry" construct to nest them in. The vectors are translated by the wrapping shape's own frame origin, since that frame is where the embedded drawing sits on the slide.
  if (
    shape.blocks.length === 1 &&
    onlyBlock?.kind === "embeddedObject" &&
    drawingOfBlock(onlyBlock) !== undefined
  ) {
    for (const vector of embeddedDrawingVectors(onlyBlock, shape.frame)) {
      slide.addVector(vector);
    }
    return;
  }
  // A shape carrying a real embedded formula (ExaDev/documents.js#563) becomes a text box holding one real OOXML equation -- PptxShape.appendOfficeMath, the identical src/omml/write.ts translator buildDocxPackage already uses. A formula whose MathML produces no OMML content at all falls back to its own plain-text stand-in, mirroring buildDocxPackage's own appendEmbeddedObject narrowing exactly (src/edit/docx/content.ts).
  if (shape.blocks.length === 1 && onlyBlock?.kind === "embeddedObject") {
    const formula = formulaOfBlock(onlyBlock);
    if (formula !== undefined) {
      const textShape = slide.addTextBox({ frame: shape.frame, text: "" });
      const { written, diagnostics } = textShape.appendOfficeMath(
        formula.mathml,
      );
      for (const diagnostic of diagnostics) {
        options?.onMathDiagnostic?.(diagnostic, {
          sourcePath: onlyBlock.sourcePath,
        });
      }
      if (!written) {
        textShape.setParagraphs([
          { runs: [{ text: formulaPlaceholderText(formula) }] },
        ]);
      }
      return;
    }
  }
  if (shape.blocks.length === 1 && onlyBlock?.kind === "image") {
    if (onlyBlock.format === "svg") {
      throw new Error(
        "buildPptxPackage: an image block in svg format has no OOXML blip this writer can produce (PresentationML's a:blip only references a raster part PowerPoint decodes directly -- png/jpeg/gif)",
      );
    }
    const imageShape = slide.addImage({
      frame: shape.frame,
      format: onlyBlock.format,
      bytes: base64ToBytes(onlyBlock.base64),
      altText: onlyBlock.altText,
    });
    if (shape.rotationDeg !== undefined) {
      imageShape.rotationDeg = shape.rotationDeg;
    }
    if (shape.name !== undefined) {
      imageShape.name = shape.name;
    }
    return;
  }
  if (shape.blocks.length === 1 && onlyBlock?.kind === "table") {
    const table = slide.addTable({
      frame: shape.frame,
      rotationDeg: shape.rotationDeg,
      table: {
        rows: onlyBlock.rows.length,
        columns: onlyBlock.columnWidthsPt.length,
        columnWidthsPt: onlyBlock.columnWidthsPt,
      },
    });
    populatePptxTable(table, onlyBlock, (url) => slide.registerHyperlink(url));
    return;
  }
  const paragraphs: DrawingParagraphInit[] = [];
  for (const block of shape.blocks) {
    if (block.kind !== "paragraph") {
      continue; // a nested table or image mixed alongside other blocks inside a single text shape is out of scope -- neither PDF-reconstructed shapes nor a real pptx/odp slide shape mix kinds this way (see reconstruct.ts and the odp<->pptx table-in-shape fixture in bridges.test.ts)
    }
    paragraphs.push(
      paragraphInitFromBlock(block, (url) => slide.registerHyperlink(url)),
    );
  }
  const textBox = slide.addTextBox({ frame: shape.frame, text: "" });
  if (shape.rotationDeg !== undefined) {
    textBox.rotationDeg = shape.rotationDeg;
  }
  if (shape.name !== undefined) {
    textBox.name = shape.name;
  }
  // ContentShape's insets are required numbers (document-schema.js's ContentShapeSchema), so thread them unconditionally -- matching ooxml.js's own readPptxContent, which reads them back as defaults (91440/45720 EMU) when the source carried none. Setting them writes real lIns/tIns/rIns/bIns EMU attributes onto a:bodyPr.
  textBox.insetLeftPt = shape.insetLeftPt;
  textBox.insetTopPt = shape.insetTopPt;
  textBox.insetRightPt = shape.insetRightPt;
  textBox.insetBottomPt = shape.insetBottomPt;
  textBox.setParagraphs(paragraphs);
}

// Threads a ContentParagraph's full decoration surface -- runs, alignment, and the spacing/indent fields DrawingParagraphInit now carries -- into a DrawingParagraphInit. Used by both appendShape (a text-box shape's own paragraphs) and populateCellParagraphs (a table cell's own paragraphs), so the two stay in sync rather than each repeating the field list.
function paragraphInitFromBlock(
  block: ContentParagraph,
  resolveHyperlinkRId?: (url: string) => string,
): DrawingParagraphInit {
  return {
    alignment: block.alignment,
    spacingBeforePt: block.spacingBeforePt,
    spacingAfterPt: block.spacingAfterPt,
    lineSpacing: block.lineSpacing,
    indentLeftPt: block.indentLeftPt,
    indentFirstLinePt: block.indentFirstLinePt,
    runs: block.runs.map((run) => ({
      text: run.text,
      bold: run.bold,
      italic: run.italic,
      underline: run.underline,
      strike: run.strike,
      fontFamily: run.fontFamily,
      sizePt: run.sizePt,
      color: run.color,
      hyperlinkRId:
        run.hyperlink !== undefined && resolveHyperlinkRId !== undefined
          ? resolveHyperlinkRId(run.hyperlink)
          : undefined,
    })),
  };
}

function populateCellParagraphs(
  cell: PptxTableCell,
  blocks: readonly ContentBlock[],
  resolveHyperlinkRId?: (url: string) => string,
): void {
  const paragraphs: DrawingParagraphInit[] = [];
  for (const block of blocks) {
    if (block.kind !== "paragraph") {
      continue; // a nested table or image inside a table cell is out of scope, mirroring appendShape's own identical text-shape scope narrowing above
    }
    paragraphs.push(paragraphInitFromBlock(block, resolveHyperlinkRId));
  }
  cell.setParagraphs(paragraphs);
}

// Unlike docx's gridSpan-collapses-the-row model, ooxml.js's own readTable (typed/pptx/read.ts) always reads exactly `columns` cells per row regardless of merges -- a covered position is a real a:tc marked hMerge/vMerge="1" (see table.ts's own PptxTableCell), never an omitted or replaced element -- so ContentTable.rows[].cells already has one entry per grid column, in grid-column order, for a pptx-sourced table. That means colIndex === cellIndex directly, with no running-offset bookkeeping needed the way docx's own gridSpan-aware writer (src/edit/docx/content.ts) or ODF's own covered-table-cell writer (src/edit/odt/content.ts) each require.
function populatePptxTable(
  table: PptxTable,
  block: ContentTable,
  resolveHyperlinkRId?: (url: string) => string,
): void {
  const verticalMerges = new Map<number, number>();
  block.rows.forEach((row, rowIndex) => {
    let horizontalCoverRemaining = 0;
    row.cells.forEach((cell, colIndex) => {
      const tableCell = table.cell(rowIndex, colIndex);
      const verticalRemaining = verticalMerges.get(colIndex);
      const isVerticallyCovered =
        verticalRemaining !== undefined && verticalRemaining > 0;
      const isHorizontallyCovered = horizontalCoverRemaining > 0;
      if (isVerticallyCovered || isHorizontallyCovered) {
        if (isHorizontallyCovered) {
          tableCell.horizontalMerge = true;
          horizontalCoverRemaining -= 1;
        }
        if (isVerticallyCovered) {
          tableCell.verticalMerge = true;
          verticalMerges.set(colIndex, verticalRemaining - 1);
        }
        return;
      }
      const span = cell.colSpan ?? 1;
      if (span > 1) {
        tableCell.colSpan = span;
        horizontalCoverRemaining = span - 1;
      }
      if (cell.rowSpan !== undefined && cell.rowSpan > 1) {
        tableCell.rowSpan = cell.rowSpan;
        for (let c = 0; c < span; c++) {
          verticalMerges.set(colIndex + c, cell.rowSpan - 1);
        }
      }
      // PptxTableCell.background models one flat colour (DrawingML's own <a:solidFill>, the only fill kind this editor's table-cell writer states), so a 'pattern' fill (ExaDev/documents.js#951) writes through resolveCellFillColor's own single representative colour.
      if (cell.background !== undefined) {
        tableCell.background = resolveCellFillColor(cell.background);
      }
      if (cell.borders !== undefined) {
        tableCell.borders = cell.borders;
      }
      populateCellParagraphs(tableCell, cell.blocks, resolveHyperlinkRId);
    });
  });
}
