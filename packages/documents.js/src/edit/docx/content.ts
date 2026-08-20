import type { ContentBlock, ContentDocument, ContentEmbeddedObjectBlock, ContentParagraph, ContentTable } from 'document-schema.js';
import type { Package } from 'ooxml.js';
import { resolveMetadataTimestamps } from '../../model/metadata';
import { drawingOfBlock, embeddedDrawingVectors, FLOW_CONTAINER_ORIGIN } from '../../model/embedded-drawing';
import { formulaOfBlock, formulaPlaceholderText } from '../../model/formula';
import { base64ToBytes } from 'ooxml.js';
import type { ClockPort } from '../../ports/clock';
import { systemClock } from '../../ports/clock';
import { ptToTwips } from '../../model/units';
import type { OmmlDiagnostic } from '../../omml/shared';
import type { DocxBody } from './editor';
import { DocxEditor } from './editor';
import { createEmptyDocxPackage } from './scaffold';
import { buildNumberingRoot, declaration as numberingDeclaration, NUMBERING_CONTENT_TYPE, NUMBERING_REL_TYPE, NUMBERING_PART_PATH, type NumberingEntry } from './numbering';
import { ensureContentTypeOverride } from '../../opc/content-types';
import { addRelationship } from '../../opc/rels';
import type { DocxParagraph } from './paragraph';
import type { DocxTableCell } from './table';

// Reports every MathML construct that degraded or was approximated while an embedded formula was translated into OMML (see src/omml/write.ts). `sourcePath` is the formula block's own path back into the source ContentDocument, when it carries one, so a caller can name which formula each diagnostic came from rather than only which construct. `clock` resolves content.metadata's own createdIso/modifiedIso the same way createDocx does (src/model/metadata.ts's resolveMetadataTimestamps) -- systemClock by default, so a rebuilt document still gets real timestamps, but never overwriting a createdIso/modifiedIso the source content already carried.
export interface BuildDocxPackageOptions {
  readonly onMathDiagnostic?: (diagnostic: OmmlDiagnostic, context: { readonly sourcePath?: string }) => void;
  readonly clock?: ClockPort;
}

// ContentDocument -> a fresh docx Package, built entirely through the same edit/docx/* live-view primitives a caller would use by hand -- the write-side counterpart to src/ooxml/docx/read.ts's readDocxContent. Used by the PDF->docx conversion path (src/layout/reconstruct.ts's output never contains a ContentTable, since PDF table reconstruction degrades to tab-separated text), but written to handle the full ContentBlock union for any other caller that wants a ContentDocument turned into real docx bytes. Constructs its own package directly (createEmptyDocxPackage + DocxEditor) rather than calling createDocx(), since createDocx() always starts metadata from {} -- this function needs the SOURCE content's own metadata to reach resolveMetadataTimestamps, not an empty object.
export function buildDocxPackage(content: ContentDocument, options?: BuildDocxPackageOptions): Package {
  if (content.kind !== 'wordprocessing') {
    throw new Error('buildDocxPackage requires a wordprocessing ContentDocument');
  }
  const clock = options?.clock ?? systemClock;
  const metadata = resolveMetadataTimestamps(content.metadata, clock);
  const pkg = createEmptyDocxPackage({ metadata });
  // Pre-pass: collect every distinct list numId + its levels across all blocks (recursing into table cells), then synthesise a word/numbering.xml so the w:numPr/w:numId references DocxParagraph.list writes actually resolve in Word. Without this, numIds dangle and Word renders no bullets.
  const numIdLevels = new Map<string | undefined, Set<number>>();
  for (const section of content.sections) {
    collectListNumIds(section.blocks, numIdLevels);
  }
  const remap = new Map<string | undefined, string>();
  if (numIdLevels.size > 0) {
    const entries: NumberingEntry[] = [];
    let abstractNumId = 0;
    let numId = 1;
    for (const [sourceNumId, levels] of numIdLevels) {
      const remapped = String(numId);
      remap.set(sourceNumId, remapped);
      entries.push({ sourceNumId, remappedNumId: remapped, abstractNumId: String(abstractNumId), levels: [...levels].sort((a, b) => a - b) });
      abstractNumId += 1;
      numId += 1;
    }
    const numberingRoot = buildNumberingRoot(entries);
    pkg.parts[NUMBERING_PART_PATH] = { kind: 'xml', nodes: [numberingDeclaration(), numberingRoot] };
    ensureContentTypeOverride(pkg, NUMBERING_PART_PATH, NUMBERING_CONTENT_TYPE);
    addRelationship(pkg, 'word/document.xml', { type: NUMBERING_REL_TYPE, target: 'numbering.xml' });
  }
  const editor = new DocxEditor(pkg);
  const sections = numIdLevels.size > 0
    ? content.sections.map((section) => ({ ...section, blocks: remapListNumIds(section.blocks, remap) }))
    : content.sections;
  sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) {
      // A section boundary becomes a page break -- distinct per-section page size/margins (w:sectPr per section) isn't modelled by this bridge yet, since createDocx()'s single scaffolded section covers every caller this function currently has.
      editor.body.appendPageBreak();
    }
    appendBlocks(editor.body, section.blocks, options);
  });
  return editor.toPackage();
}

// ooxml.js's flat docx reader (real docx image reading since ooxml.js 2.6.1) always represents an inline image as TWO adjacent ContentBlocks sourced from the one physical <w:p>: a paragraph block carrying that paragraph's own (possibly all-empty) text runs, immediately followed by an image block for the w:drawing found inside it -- there is no signal in ContentDocument distinguishing that pairing from a genuinely separate, intentionally-blank paragraph that happens to sit immediately before an unrelated image. Writing both blocks back as two independent paragraphs (the naive per-block loop) is round-trip-safe for the rare separate-blank-paragraph case but wrong for the overwhelmingly common inline-image case, inserting a spurious extra empty paragraph before every image on every docx round trip. isMergeableImageParagraph/appendBlocks instead special-case exactly the pattern readDocxContent always produces for a genuine inline image (a paragraph whose runs are all empty text, directly followed by an image block) and write it back as the single physical paragraph it came from, by populating the paragraph's own properties/runs and then calling insertImageAfter on that SAME paragraph rather than a fresh one -- consuming both ContentBlocks in one step. A paragraph with any non-empty run text is never merged, since ooxml.js's own reader only ever emits the image as a trailing sibling of an all-empty-runs paragraph (confirmed against real readDocxContent output: a drawing inside a paragraph that also carries real text produces the drawing's own empty-text run inline within that SAME paragraph block, never as a separate block at all -- see this repo's README Gotchas).
function isMergeableImageParagraph(block: ContentBlock): block is ContentParagraph {
  return block.kind === 'paragraph' && block.runs.every((run) => run.text === '');
}

// Walks blocks recursively (paragraphs at any level, including inside table cells), collecting every distinct list numId and the set of levels each uses -- the input to the numbering.xml synthesis pre-pass above.
// The pre-pass map is keyed by a membership's numId OR its absence (undefined): numId is optional since schema 4.0.0 -- an OOXML drawing paragraph or a de-numIded bridge product carries only a level -- and every distinct key, present or absent, needs its own numbering definition for the numIds DocxParagraph.list writes to resolve. All memberships sharing the absent key land on one shared w:num, which is exactly right for a bullet-template table: the only thing a numbering definition distinguishes is the marker template, and every level of every entry this synthesiser emits is the same bullet anyway.
function collectListNumIds(blocks: readonly ContentBlock[], out: Map<string | undefined, Set<number>>): void {
  for (const block of blocks) {
    if (block.kind === 'paragraph' && block.list !== undefined) {
      let levels = out.get(block.list.numId);
      if (levels === undefined) {
        levels = new Set<number>();
        out.set(block.list.numId, levels);
      }
      levels.add(block.list.level);
    } else if (block.kind === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          collectListNumIds(cell.blocks, out);
        }
      }
    }
  }
}

// Remaps source ContentListMembership numIds through the numbering pre-pass's source-to-docx integer map, producing a new block list where every list paragraph's numId is the one the synthesised numbering.xml actually defines. Returns the input unchanged when the map is empty (the no-list case), avoiding a needless shallow clone.
function remapListNumIds(blocks: readonly ContentBlock[], numIdMap: ReadonlyMap<string | undefined, string>): ContentBlock[] {
  if (numIdMap.size === 0) {
    return [...blocks];
  }
  return blocks.map((block) => {
    if (block.kind === 'paragraph' && block.list !== undefined) {
      const remapped = numIdMap.get(block.list.numId);
      return remapped === undefined ? block : { ...block, list: { numId: remapped, level: block.list.level } };
    }
    if (block.kind === 'table') {
      return { ...block, rows: block.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell, blocks: remapListNumIds(cell.blocks, numIdMap) })) })) };
    }
    return block;
  });
}

function appendBlocks(body: DocxBody, blocks: readonly ContentBlock[], options: BuildDocxPackageOptions | undefined): void {
  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index];
    const next = blocks[index + 1];
    if (block !== undefined && isMergeableImageParagraph(block) && next?.kind === 'image') {
      // Only the paragraph's own properties are written here, never its runs -- every run.text in a mergeable paragraph is an empty placeholder for the drawing's own run position (see this function's own top comment), and writing it via populateParagraph would add a real, spurious empty-text run alongside the one insertImageAfter is about to add for the drawing itself, doubling up on the re-read.
      const paragraph = body.appendParagraph();
      paragraph.styleId = block.styleId;
      paragraph.alignment = block.alignment;
      paragraph.list = block.list;
      paragraph.insertImageAfter({ format: next.format, bytes: base64ToBytes(next.base64), widthPt: next.widthPt, heightPt: next.heightPt, altText: next.altText });
      index += 2;
      continue;
    }
    if (block !== undefined) {
      appendBlock(body, block, options);
    }
    index += 1;
  }
}

function populateParagraph(paragraph: DocxParagraph, block: ContentParagraph): void {
  paragraph.styleId = block.styleId;
  paragraph.alignment = block.alignment;
  paragraph.list = block.list;
  if (block.headingLevel !== undefined) {
    paragraph.headingLevel = block.headingLevel;
  }
  if (block.spacingBeforePt !== undefined) {
    paragraph.spacingBeforePt = block.spacingBeforePt;
  }
  if (block.spacingAfterPt !== undefined) {
    paragraph.spacingAfterPt = block.spacingAfterPt;
  }
  if (block.lineSpacing !== undefined) {
    paragraph.lineSpacing = block.lineSpacing;
  }
  if (block.indentLeftPt !== undefined) {
    paragraph.indentLeftPt = block.indentLeftPt;
  }
  if (block.indentFirstLinePt !== undefined) {
    paragraph.indentFirstLinePt = block.indentFirstLinePt;
  }
  for (const run of block.runs) {
    if (run.text === '\t') {
      paragraph.appendTab();
      continue;
    }
    const docxRun = paragraph.appendRun({ text: run.text });
    if (run.bold === true) {
      docxRun.bold = true;
    }
    if (run.italic === true) {
      docxRun.italic = true;
    }
    if (run.underline === true) {
      docxRun.underline = true;
    }
    if (run.strike === true) {
      docxRun.strike = true;
    }
    if (run.fontFamily !== undefined) {
      docxRun.fontFamily = run.fontFamily;
    }
    if (run.sizePt !== undefined) {
      docxRun.sizePt = run.sizePt;
    }
    if (run.color !== undefined) {
      docxRun.color = run.color;
    }
    if (run.hyperlink !== undefined) {
      paragraph.wrapLastRunInHyperlink(run.hyperlink);
    }
  }
}

function populateCellBlocks(cell: DocxTableCell, blocks: readonly ContentBlock[]): void {
  const [firstBlock, ...restBlocks] = blocks;
  const firstParagraph = cell.paragraphs()[0];
  if (firstBlock?.kind === 'paragraph' && firstParagraph !== undefined) {
    populateParagraph(firstParagraph, firstBlock);
  } else if (firstBlock !== undefined) {
    appendCellBlock(cell, firstBlock);
  }
  for (const remaining of restBlocks) {
    appendCellBlock(cell, remaining);
  }
}

// docx (unlike ODF -- see appendTable in src/edit/odt/content.ts) never writes a placeholder element for a column consumed by a horizontal merge, so ContentTable.rows[].cells has exactly one array entry per REAL w:tc the row will contain -- appendRow(row.cells.length) below builds precisely that many, rather than the fixed `columns` grid every row would otherwise get. A vertical merge (rowSpan), by contrast, still needs one real w:tc per covered row (Word has nowhere else to hang that row's own content), so those covered rows' own entries in `row.cells` (present as ordinary, usually-empty cells -- see ooxml.js's own readTable) are written as w:vMerge="continue" cells here rather than populated as fresh content. verticalMerges tracks, per grid column index (accounting for colSpan), how many further rows remain covered and what gridSpan the continuation cells in those rows should themselves carry, so a merge that is both column- and row-spanning covers the full rectangle, not just its own starting column.
function appendTable(body: DocxBody, block: ContentTable): void {
  const columns = block.columnWidthsPt.length;
  if (block.rows.length === 0 || columns === 0) {
    return;
  }
  const table = body.appendTable({ rows: 0, columns, columnWidthsTwips: block.columnWidthsPt.map(ptToTwips) });
  const verticalMerges = new Map<number, { rowsRemaining: number; gridSpan: number }>();
  block.rows.forEach((row) => {
    const tableRow = table.appendRow(row.cells.length);
    if (row.heightPt !== undefined) {
      tableRow.heightPt = row.heightPt;
    }
    const domCells = tableRow.cells();
    let colIndex = 0;
    row.cells.forEach((cell, cellIndex) => {
      const tableCell = domCells[cellIndex];
      if (tableCell === undefined) {
        return;
      }
      const active = verticalMerges.get(colIndex);
      if (active !== undefined && active.rowsRemaining > 0) {
        if (active.gridSpan > 1) {
          tableCell.colSpan = active.gridSpan;
        }
        tableCell.verticalMerge = 'continue';
        verticalMerges.set(colIndex, { rowsRemaining: active.rowsRemaining - 1, gridSpan: active.gridSpan });
        colIndex += active.gridSpan;
        return;
      }
      const span = cell.colSpan ?? 1;
      if (span > 1) {
        tableCell.colSpan = span;
      }
      if (cell.rowSpan !== undefined && cell.rowSpan > 1) {
        tableCell.verticalMerge = 'restart';
        verticalMerges.set(colIndex, { rowsRemaining: cell.rowSpan - 1, gridSpan: span });
      }
      if (cell.background !== undefined) {
        tableCell.background = cell.background;
      }
      if (cell.borders !== undefined) {
        tableCell.borders = cell.borders;
      }
      populateCellBlocks(tableCell, cell.blocks);
      colIndex += span;
    });
  });
}

function appendCellBlock(cell: DocxTableCell, block: ContentBlock): void {
  if (block.kind === 'paragraph') {
    populateParagraph(cell.appendParagraph(), block);
  }
  // Nested tables and images inside a table cell are out of scope for this bridge -- ContentBlock permits arbitrary nesting, but PDF-sourced content (the one caller today) never produces it.
}

function appendBlock(body: DocxBody, block: ContentBlock, options: BuildDocxPackageOptions | undefined): void {
  if (block.kind === 'paragraph') {
    populateParagraph(body.appendParagraph(), block);
  } else if (block.kind === 'image') {
    const paragraph = body.appendParagraph();
    paragraph.insertImageAfter({ format: block.format, bytes: base64ToBytes(block.base64), widthPt: block.widthPt, heightPt: block.heightPt, altText: block.altText });
  } else if (block.kind === 'pageBreak') {
    body.appendPageBreak();
  } else if (block.kind === 'table') {
    appendTable(body, block);
  } else if (block.kind === 'embeddedObject') {
    appendEmbeddedObject(body, block, options);
  }
}

// An embedded formula becomes a paragraph carrying a REAL OMML display equation (m:oMathPara > m:oMath), structurally translated from the block's own MathML by src/omml/write.ts -- genuinely editable Word math, not a picture and not a plain-text stand-in. This is what makes a formula survive the odt -> docx bridge and an .odm chapter as math rather than as text.
//
// The plain-text stand-in (the formula's own StarMath annotation, or the literal "[formula]") remains the fallback for exactly one case: a formula whose MathML produced no OMML content at all -- an empty mathml array, or a block whose document is not a formula document. Writing nothing there would make the formula vanish without trace, the silent-loss failure mode this codebase's conventions rule out. An individual MathML construct with no OMML counterpart degrades on its own, inside the equation, with a diagnostic -- see src/omml/write.ts -- rather than dragging the whole formula down to text.
//
// A 'drawing' objectKind -- what reconstructWordprocessing wraps a page's recovered vector primitives in (src/layout/reconstruct.ts) -- becomes a paragraph carrying one real page-anchored DrawingML shape per vector (src/edit/docx/vector.ts, built on the shared preset/custom-geometry writer pptx uses too). The remaining objectKinds (a nested wordprocessing/presentation/spreadsheet document) are still unhandled: no reader this package depends on produces one.
function appendEmbeddedObject(body: DocxBody, block: ContentEmbeddedObjectBlock, options: BuildDocxPackageOptions | undefined): void {
  if (drawingOfBlock(block) !== undefined) {
    body.appendParagraph().appendVectorAnchors(embeddedDrawingVectors(block, FLOW_CONTAINER_ORIGIN));
    return;
  }
  const formula = formulaOfBlock(block);
  if (formula === undefined) {
    return;
  }
  const paragraph = body.appendParagraph();
  const { written, diagnostics } = paragraph.appendOfficeMath(formula.mathml);
  for (const diagnostic of diagnostics) {
    options?.onMathDiagnostic?.(diagnostic, { sourcePath: block.sourcePath });
  }
  if (!written) {
    paragraph.appendRun({ text: formulaPlaceholderText(formula) });
  }
}
