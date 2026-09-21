import type {
  ContentBlock,
  ContentDocument,
  ContentParagraph,
  ContentShape,
  ContentTable,
  ContentTableCell,
} from "document-schema.js";
import {
  resolveCellFillColor,
  tableCellColumnSpan,
  tableCellRowSpan,
  tableGridColumnCount,
  walkTableGrid,
} from "document-schema.js";
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
import { assertTableObeysGridRule } from "../table-grid";
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
    // A table with no rows is refused rather than written as an a:tbl holding a grid and nothing else: ODF requires at least one row, so the same table is refused in every presentation format instead of written by one and not the other.
    if (onlyBlock.rows.length === 0) {
      throw new Error(
        "buildPptxPackage: table has no rows, and a table with no rows cannot be written in every presentation format (ODF requires at least one table:table-row)",
      );
    }
    // The grid is as wide as the rows and columnWidthsPt together state, so a table that states no column widths still gets one a:gridCol per grid column; a column with no stated width takes an equal share of the default table width, the same as any column created without one.
    const table = slide.addTable({
      frame: shape.frame,
      rotationDeg: shape.rotationDeg,
      table: {
        rows: onlyBlock.rows.length,
        columns: tableGridColumnCount(onlyBlock),
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

// A DrawingML table's own a:tr always carries exactly `columns` a:tc elements regardless of merges -- a covered position is a real a:tc marked hMerge/vMerge="1" (see table.ts's own PptxTableCell), never an omitted or replaced element -- and ContentTable's grid rule (ContentTableCell in document-schema.js) gives every row exactly one entry per grid column too, so an entry's array index is its a:tc's own column with no running-offset bookkeeping. walkTableGrid classifies each entry: an anchor carries its spans and its content, while a covered entry states which side of its region it lies on and carries only its own background and borders, since its content belongs to the anchor. A position the region reaches along its own row is marked hMerge and one it reaches from an earlier row is marked vMerge, both at once for the interior of a region wider and taller than one cell, as real PowerPoint output states it.
function populatePptxTable(
  table: PptxTable,
  block: ContentTable,
  resolveHyperlinkRId?: (url: string) => string,
): void {
  assertTableObeysGridRule(block, "buildPptxPackage");
  walkTableGrid(block).forEach((positions, rowIndex) => {
    positions.forEach((position) => {
      const { cell, columnIndex } = position;
      const tableCell = table.cell(rowIndex, columnIndex);
      if (position.anchorRowIndex !== undefined) {
        tableCell.horizontalMerge = columnIndex > position.anchorColumnIndex;
        tableCell.verticalMerge = rowIndex > position.anchorRowIndex;
        applyCellDecoration(tableCell, cell);
        return;
      }
      const colSpan = tableCellColumnSpan(cell);
      if (colSpan > 1) {
        tableCell.colSpan = colSpan;
      }
      const rowSpan = tableCellRowSpan(cell);
      if (rowSpan > 1) {
        tableCell.rowSpan = rowSpan;
      }
      applyCellDecoration(tableCell, cell);
      populateCellParagraphs(tableCell, cell.blocks, resolveHyperlinkRId);
    });
  });
}

// PptxTableCell.background models one flat colour (DrawingML's own <a:solidFill>, the only fill kind this editor's table-cell writer states), so a 'pattern' fill (ExaDev/documents.js#951) writes through resolveCellFillColor's own single representative colour. Shared by an anchor and a covered entry, since the a:tc each becomes carries its own a:tcPr.
function applyCellDecoration(
  target: PptxTableCell,
  cell: ContentTableCell,
): void {
  if (cell.background !== undefined) {
    target.background = resolveCellFillColor(cell.background);
  }
  // PptxTableCell.borders and .verticalAlign both clear their own a:tcPr state when handed undefined and mint nothing, so an absent value needs no guard of its own.
  target.borders = cell.borders;
  target.verticalAlign = cell.verticalAlign;
}
