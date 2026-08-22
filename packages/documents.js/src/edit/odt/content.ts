import type { ContentBlock, ContentDocument, ContentEmbeddedObjectBlock, ContentImageBlock, ContentParagraph, ContentTable } from 'document-schema.js';
import type { Package } from 'odf.js';
import { base64ToBytes } from 'odf.js';
import { drawingOfBlock, embeddedDrawingVectors, FLOW_CONTAINER_ORIGIN } from '../../model/embedded-drawing';
import { formulaOfBlock, formulaPlaceholderText } from '../../model/formula';
import { resolveMetadataTimestamps } from '../../model/metadata';
import type { ClockPort } from '../../ports/clock';
import { systemClock } from '../../ports/clock';
import type { OdtBody } from './editor';
import { OdtEditor } from './editor';
import { createEmptyOdtPackage } from './scaffold';
import type { OdtList, OdtListItem } from './list';
import type { OdtParagraph } from './paragraph';
import { headingStyleName } from './paragraph';
import type { OdtTable, OdtTableCell } from './table';

// clock resolves content.metadata's own createdIso/modifiedIso the same way createOdt does (src/model/metadata.ts's resolveMetadataTimestamps) -- systemClock by default, never overwriting a createdIso/modifiedIso the source content already carried.
export interface BuildOdtPackageOptions {
  readonly clock?: ClockPort;
}

// ContentDocument -> a fresh odt Package, built entirely through the same edit/odt/* live-view primitives a caller would use by hand -- the odt-side counterpart to src/edit/docx/content.ts's buildDocxPackage, and the write-side counterpart to src/odf/odt/read.ts's readOdtContent. Used by the PDF->odt conversion path (src/layout/reconstruct.ts's output never contains a ContentTable, since PDF table reconstruction degrades to tab-separated text), but written to handle the full ContentBlock union any other caller's ContentDocument might carry, mirroring buildDocxPackage's own scope exactly. Constructs its own package directly (createEmptyOdtPackage + OdtEditor) rather than calling createOdt(), mirroring buildDocxPackage's own identical reasoning: createOdt() always starts metadata from {}, but this function needs the SOURCE content's own metadata to reach resolveMetadataTimestamps.
//
// Image blocks ARE written here, unlike an earlier version of this function: OdtParagraph.insertImageAfter (src/edit/odt/paragraph.ts) writes a real inline draw:frame/draw:image, and src/odf/odt/read.ts's own readOdtContent now runs a second detection pass (src/odf/image/detect.ts) that recovers it back, closing the round trip odf.js's own readOdt alone cannot: that reader still does not dispatch on draw:frame/draw:image at all.
export function buildOdtPackage(content: ContentDocument, options?: BuildOdtPackageOptions): Package {
  if (content.kind !== 'wordprocessing') {
    throw new Error('buildOdtPackage requires a wordprocessing ContentDocument');
  }
  const clock = options?.clock ?? systemClock;
  const metadata = resolveMetadataTimestamps(content.metadata, clock);
  const editor = new OdtEditor(createEmptyOdtPackage({ metadata }));
  content.sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) {
      // A section boundary becomes a page break -- distinct per-section page size/margins isn't modelled by this bridge yet, mirroring buildDocxPackage's own identical single-page-layout scope (createOdt()'s single scaffolded page-layout covers every caller this function currently has).
      editor.body.appendPageBreak();
    }
    appendBlocks(editor.body, section.blocks);
  });
  return editor.toPackage();
}

// readOdtContent's own image detection (src/odf/image/detect.ts, via src/odf/odt/read.ts's collectImagePlacements) never consumes the paragraph an inline image is found in -- ContentImageBlock has nowhere to record inline membership, unlike a formula/drawing embeddedObject block, which stands in for the whole paragraph it replaced -- so a real inline image always arrives as [paragraph, image], the identical two-block shape ooxml.js's own readDocx produces for a docx inline image, and for the identical reason (see buildDocxPackage's own isMergeableImageParagraph, src/edit/docx/content.ts). Writing both blocks back as two independent paragraphs would insert a spurious extra empty paragraph before every image on every odt round trip; this instead recognises exactly that shape and writes it back as the single physical paragraph it came from, populating the paragraph's own properties and then calling insertImageAfter on that SAME paragraph.
//
// A list-member paragraph (block.list !== undefined) is deliberately excluded here, unlike docx's version: OdtParagraph carries no flat list property the way DocxParagraph does -- ODF nests a list structurally (text:list/text:list-item, see list.ts) -- so merging one into a plain body.appendParagraph() would silently drop it out of its enclosing list tree. Leaving that rare combination unmerged costs one extra empty paragraph, not lost list membership; appendBlocks' own list-run branch below still handles it.
function isMergeableImageParagraph(block: ContentBlock): block is ContentParagraph {
  return block.kind === 'paragraph' && block.list === undefined && block.runs.every((run) => run.text === '');
}

function appendMergedImageParagraph(body: OdtBody, paragraphBlock: ContentParagraph, imageBlock: ContentImageBlock): void {
  // Only the paragraph's own properties are written here, never its runs -- every run.text in a mergeable paragraph is an empty placeholder for the image's own inline position (see this function's own top comment), and writing it via populateParagraph would add a real, spurious empty-text run alongside the image frame insertImageAfter is about to append. The identity branch mirrors populateParagraph's own (heading promote subsumes the verbatim styleId) rather than calling it, since this path must keep writing no runs.
  const paragraph = body.appendParagraph();
  if (paragraphBlock.headingLevel !== undefined) {
    paragraph.headingLevel = paragraphBlock.headingLevel;
  } else if (paragraphBlock.styleId !== undefined) {
    paragraph.styleId = paragraphBlock.styleId;
  }
  if (paragraphBlock.alignment !== undefined) {
    paragraph.alignment = paragraphBlock.alignment;
  }
  paragraph.insertImageAfter({ format: imageBlock.format, bytes: base64ToBytes(imageBlock.base64), widthPt: imageBlock.widthPt, heightPt: imageBlock.heightPt, altText: imageBlock.altText });
}

// Walks a flat block list, routing maximal consecutive runs of list-member paragraphs (block.list !== undefined, docx's own flat numId/level model -- see paragraph.ts's own DocxParagraph.list) through appendListRun instead of appendBlock, since ODF has no flat paragraph-level list property to set the way buildDocxPackage's own populateParagraph does (see that file's own paragraph.list assignment); a list only exists in ODF as a real text:list/text:list-item tree, so it has to be built as one. A paragraph immediately followed by an image block (the shape readOdtContent now produces for a real inline image -- see isMergeableImageParagraph above) is merged into one physical paragraph+image instead, checked ahead of the list-run branch since it never applies to a list-member paragraph anyway. Every other block kind is unaffected and still goes through appendBlock one at a time.
function appendBlocks(body: OdtBody, blocks: readonly ContentBlock[]): void {
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block === undefined) {
      i++;
      continue;
    }
    const next = blocks[i + 1];
    if (isMergeableImageParagraph(block) && next?.kind === 'image') {
      appendMergedImageParagraph(body, block, next);
      i += 2;
      continue;
    }
    if (block.kind === 'paragraph' && block.list !== undefined) {
      const run: ContentParagraph[] = [];
      while (i < blocks.length) {
        const candidate = blocks[i];
        if (candidate?.kind !== 'paragraph' || candidate.list === undefined) {
          break;
        }
        run.push(candidate);
        i++;
      }
      appendListRun(body, run);
      continue;
    }
    appendBlock(body, block);
    i++;
  }
}

// Builds a real nested text:list/text:list-item tree from a flat run of list-member paragraphs, the inverse of odf.js's own readOdtContent list-reading (src/typed/odt/read.ts's readListItems: each top-level text:list gets a synthetic numId, each level of text:list nesting increments ContentParagraph.list.level by one). A run of consecutive paragraphs sharing the same numId stays in one text:list; a numId change starts a brand-new top-level list, mirroring how a real docx numbering restart looks once flattened into ContentParagraph.list. Level changes within one numId walk a stack of open OdtList levels, descending one level at a time via the most recently added item's own addNestedList() -- ODF has no way to open a nested list except from inside an existing item, so a paragraph whose level jumps more than one deeper than the currently open list in a single step (skipping an intermediate level entirely, something no known real docx producer emits) lands one level shallower than declared rather than fabricating an empty intermediate item to descend through; ascending back towards the top level has no such constraint and always lands exactly on the declared level.
function appendListRun(body: OdtBody, paragraphs: readonly ContentParagraph[]): void {
  let stack: OdtList[] = [];
  let lastItem: OdtListItem | undefined;
  let activeNumId: string | undefined;

  for (const para of paragraphs) {
    const membership = para.list;
    if (membership === undefined) {
      continue; // unreachable given the caller's own filter -- narrows the type for the reads below.
    }
    if (activeNumId === undefined || membership.numId !== activeNumId) {
      stack = [body.appendList()];
      lastItem = undefined;
      activeNumId = membership.numId;
    }
    // The first item of a fresh list has no item to nest under yet, so it always starts at level 0 regardless of its own declared level -- matches the "cannot skip an intermediate level" bound this function's own top comment documents.
    const targetLevel = lastItem === undefined ? 0 : membership.level;
    while (stack.length - 1 < targetLevel && lastItem !== undefined) {
      stack.push(lastItem.addNestedList());
      lastItem = undefined;
    }
    while (stack.length - 1 > targetLevel) {
      stack.pop();
    }
    const currentList = stack[stack.length - 1];
    if (currentList === undefined) {
      continue; // unreachable: stack always holds at least one list once activeNumId is set.
    }
    const item = currentList.addItem();
    // A text:list-item directly contains its member text:p/text:h elements, so a heading inside a list (a numbered heading in docx terms) promotes exactly as a body paragraph does -- the one container below office:text whose model carries text:h.
    populateParagraph(item.appendParagraph(), para, { headings: 'element' });
    lastItem = item;
  }
}

// Exported so src/edit/odp/content.ts's own buildOdpPackage can reuse this exact resolve-alignment-then-append-styled-runs logic for a presentation shape's own paragraphs -- a draw:frame's draw:text-box holds the identical text:p/text:span content model office:text does, interned into the identical content.xml StyleRegistry (see src/edit/odt/props.ts), so there is no presentation-specific variant of this function to write.
export interface PopulateParagraphOptions {
  // How the paragraph's container's content model carries a heading. 'element': the container takes a real text:h (office:text, its text:list-item children, and table:table-cell -- odf.js's own readers read one back from all three), so a headingLevel promotes the element. 'style-name': the container takes no text:h at all (a draw:text-box is (text:p | text:list)*), so the paragraph stays a text:p and its text:style-name is pointed at the scaffold's Heading_20_N definition instead -- the depth itself is still lost as a format-boundary loss, but the heading keeps its visual weight and a reference that resolves. 'none': the call site's paragraph is never a heading (a stand-in literal, an ods cell's runs-only text:p), so a headingLevel would have nowhere to land and is dropped with the producer's styleId still written verbatim.
  readonly headings: 'element' | 'style-name' | 'none';
}

export function populateParagraph(paragraph: OdtParagraph, block: ContentParagraph, options: PopulateParagraphOptions): void {
  if (options.headings === 'element' && block.headingLevel !== undefined) {
    // Promoted FIRST, before every applyStyleChange-based setter below: each of those resolves the paragraph's CURRENT style-name cascade and repoints text:style-name at an interned automatic style, so the Heading_20_N reference must already be in place for alignment/spacing/indent to layer on top of the heading style's own properties. The producer's styleId is deliberately not written for a heading: every heading source's styleId is the synthetic family-wide "Heading{N}" spelling (the exact shape odf.js's own readParagraphOrHeading synthesises back from a text:h), a name no odt defines -- the headingLevel setter writes the ODF-resolvable Heading_20_N spelling of the same depth instead.
    paragraph.headingLevel = block.headingLevel;
  } else if (options.headings === 'style-name' && block.headingLevel !== undefined) {
    // The same first-set ordering and the same not-the-producer's-styleId reasoning as the promote branch above, for the one container shape that cannot take a text:h: the style reference must land before the applyStyleChange-based setters so they layer on top of the heading style's own properties, and Heading_20_N (the resolvable spelling the scaffold defines) is written rather than the synthetic "Heading{N}" one.
    paragraph.styleId = headingStyleName(block.headingLevel);
  } else if (block.styleId !== undefined) {
    paragraph.styleId = block.styleId;
  }
  if (block.alignment !== undefined) {
    paragraph.alignment = block.alignment;
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
    const odtRun = paragraph.appendRun({ text: run.text });
    if (run.bold === true) {
      odtRun.bold = true;
    }
    if (run.italic === true) {
      odtRun.italic = true;
    }
    if (run.underline === true) {
      odtRun.underline = true;
    }
    if (run.strike === true) {
      odtRun.strike = true;
    }
    if (run.fontFamily !== undefined) {
      odtRun.fontFamily = run.fontFamily;
    }
    if (run.sizePt !== undefined) {
      odtRun.sizePt = run.sizePt;
    }
    if (run.color !== undefined) {
      odtRun.color = run.color;
    }
    if (run.hyperlink !== undefined) {
      paragraph.wrapLastRunInHyperlink(run.hyperlink);
    }
  }
}

function populateCellBlocks(cell: OdtTableCell, blocks: readonly ContentBlock[]): void {
  const [firstBlock, ...restBlocks] = blocks;
  const firstParagraph = cell.paragraphs()[0];
  if (firstBlock?.kind === 'paragraph' && firstParagraph !== undefined) {
    // headings: 'element' -- a table:table-cell is one of the three containers whose content model carries text:h, and odf.js's own cell reader reads one back (typed/shared/table.ts walks text:p and text:h), so a cell heading promotes exactly as a body paragraph does.
    populateParagraph(firstParagraph, firstBlock, { headings: 'element' });
  } else if (firstBlock?.kind === 'image' && firstParagraph !== undefined) {
    // Reuses buildCell's own pre-built empty first paragraph for the image, rather than appending a fresh one via appendCellBlock -- avoiding a stray blank paragraph ahead of the image when it is the cell's only content. OdtTableCell.appendParagraph already threads this.pkg through (see table.ts), so insertImageAfter works inside a cell with zero extra plumbing -- a genuine odt advantage over docx's own documented table-cell image limitation.
    firstParagraph.insertImageAfter({ format: firstBlock.format, bytes: base64ToBytes(firstBlock.base64), widthPt: firstBlock.widthPt, heightPt: firstBlock.heightPt, altText: firstBlock.altText });
  } else if (firstBlock !== undefined) {
    appendCellBlock(cell, firstBlock);
  }
  for (const remaining of restBlocks) {
    appendCellBlock(cell, remaining);
  }
}

// Unlike docx's gridSpan (see the identically-named function in src/edit/docx/content.ts), ODF needs a real table:covered-table-cell element for EVERY grid position a merge consumes, horizontal or vertical -- odf.js's own readTableRow pushes one `{ blocks: [] }` array entry per covered-table-cell it finds (see typed/shared/table.ts), so ContentTable.rows[].cells already has exactly one entry per grid column in every row, master cells and covered placeholders alike. This walks each row left to right, consuming those placeholder entries as it goes: horizontalCoverRemaining accounts for the REST OF THIS ROW'S OWN entries a colSpan>1 master cell just consumed, and verticalMerges (keyed by grid column index) accounts for a rowSpan>1 master's entries in EVERY row below it, across the full width of its own colSpan. Exported so src/edit/odp/content.ts's own buildOdpPackage can reuse this exact merge-aware population logic for a slide shape's own table:table content (a draw:frame's table:table is byte-for-byte the same content model a document-level one is -- see odf.js's own readDrawFrameContent) -- the table.ts primitives it walks (OdtTable.appendEmptyRow/OdtTableRow.appendCell/appendCoveredCell) are already format-neutral over WHERE the table:table element lives.
export function populateOdtTable(table: OdtTable, block: ContentTable): void {
  const verticalMerges = new Map<number, number>();
  block.rows.forEach((row) => {
    const tableRow = table.appendEmptyRow();
    let colIndex = 0;
    let horizontalCoverRemaining = 0;
    row.cells.forEach((cell) => {
      if (horizontalCoverRemaining > 0) {
        tableRow.appendCoveredCell();
        horizontalCoverRemaining -= 1;
        colIndex += 1;
        return;
      }
      const verticalRemaining = verticalMerges.get(colIndex);
      if (verticalRemaining !== undefined && verticalRemaining > 0) {
        tableRow.appendCoveredCell();
        verticalMerges.set(colIndex, verticalRemaining - 1);
        colIndex += 1;
        return;
      }
      const tableCell = tableRow.appendCell();
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
      if (cell.background !== undefined) {
        tableCell.background = cell.background;
      }
      if (cell.borders !== undefined) {
        tableCell.borders = cell.borders;
      }
      populateCellBlocks(tableCell, cell.blocks);
      colIndex += 1;
    });
  });
}

function appendTable(body: OdtBody, block: ContentTable): void {
  const columns = block.columnWidthsPt.length;
  if (block.rows.length === 0 || columns === 0) {
    return;
  }
  const table = body.appendTable({ rows: 0, columns, columnWidthsPt: block.columnWidthsPt });
  populateOdtTable(table, block);
}

function appendCellBlock(cell: OdtTableCell, block: ContentBlock): void {
  if (block.kind === 'paragraph') {
    // headings: 'element' -- see populateCellBlocks: the cell's content model carries text:h and odf.js reads it back, so every paragraph block in a cell promotes, not only the first.
    populateParagraph(cell.appendParagraph(), block, { headings: 'element' });
  } else if (block.kind === 'image') {
    const paragraph = cell.appendParagraph();
    paragraph.insertImageAfter({ format: block.format, bytes: base64ToBytes(block.base64), widthPt: block.widthPt, heightPt: block.heightPt, altText: block.altText });
  }
  // Nested tables inside a table cell are still out of scope for this bridge -- ContentBlock permits arbitrary nesting, but PDF-sourced content (the one caller today) never produces it, mirroring buildDocxPackage's own identical comment.
}

// A bare image block reaching here (i.e. not already consumed by appendBlocks' own merge-back check above) gets a fresh paragraph of its own -- mirrors buildDocxPackage's own appendBlock 'image' case exactly.
function appendBlock(body: OdtBody, block: ContentBlock): void {
  if (block.kind === 'paragraph') {
    populateParagraph(body.appendParagraph(), block, { headings: 'element' });
  } else if (block.kind === 'image') {
    const paragraph = body.appendParagraph();
    paragraph.insertImageAfter({ format: block.format, bytes: base64ToBytes(block.base64), widthPt: block.widthPt, heightPt: block.heightPt, altText: block.altText });
  } else if (block.kind === 'pageBreak') {
    body.appendPageBreak();
  } else if (block.kind === 'table') {
    appendTable(body, block);
  } else if (block.kind === 'embeddedObject') {
    appendEmbeddedObject(body, block);
  }
}

// An embedded formula becomes a paragraph carrying a REAL ODF formula sub-document -- a nested "Object N/content.xml" holding the block's own MathML, referenced from a draw:frame/draw:object and listed in the package manifest with the genuine formula media type (src/odf-package/formula.ts, via OdtBody.appendFormula). Exactly what odf.js's own readOdfEmbeddedFormula reads back, and the ODF-side symmetry of buildDocxPackage's own OMML writing: a formula crossing docx -> odt arrives as a formula, not as text.
//
// The plain-text stand-in (the formula's own StarMath annotation, or the literal "[formula]") remains the fallback for exactly one case, mirroring buildDocxPackage's own identical narrowing: a formula carrying no MathML nodes at all. Writing an empty formula sub-document would produce an object real consumers render as an empty box, and writing nothing at all would make the formula vanish without trace -- the silent-loss failure mode this codebase's conventions rule out.
//
// A 'drawing' objectKind -- what reconstructWordprocessing wraps a page's recovered vector primitives in (src/layout/reconstruct.ts) -- becomes a paragraph carrying REAL draw:rect/draw:ellipse/draw:line/draw:path elements, page-anchored so the recovered page-absolute coordinates land where they were recovered from (OdtBody.appendVectors, src/edit/odt/editor.ts). Those elements are built by src/edit/odg/vector.ts's own writer, imported and reused rather than reimplemented: ODF's vector-primitive vocabulary is identical in a text document and a drawing, and odf.js's own readDrawPageContent reads both through one function.
//
// The remaining objectKinds (a nested wordprocessing/presentation/spreadsheet document) are still unhandled: no reader this package depends on produces one.
function appendEmbeddedObject(body: OdtBody, block: ContentEmbeddedObjectBlock): void {
  if (drawingOfBlock(block) !== undefined) {
    body.appendVectors(embeddedDrawingVectors(block, FLOW_CONTAINER_ORIGIN));
    return;
  }
  const formula = formulaOfBlock(block);
  if (formula === undefined) {
    return;
  }
  if (formula.mathml.length === 0) {
    // headings: 'none' -- a stand-in paragraph is never a heading; the literal block here carries no headingLevel.
    populateParagraph(body.appendParagraph(), { kind: 'paragraph', runs: [{ text: formulaPlaceholderText(formula) }] }, { headings: 'none' });
    return;
  }
  body.appendFormula(formula, block.frame);
}
