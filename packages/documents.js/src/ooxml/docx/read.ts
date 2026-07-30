import type { Package, Relationship, XmlElement, XmlNode } from 'ooxml.js';
import { attr, childrenWithTag, resolveRelationships, rootElement, textContent } from 'ooxml.js';
import type { LayoutColor } from '../../model/color';
import { rgbHexToColor } from '../../model/color';
import type { ContentBlock, ContentDocument, ContentListMembership, ContentParagraph, ContentRun, ContentSection, ContentTable, ContentTableCell } from '../../model/content';
import { CONTENT_FORMAT_VERSION } from '../../model/content';
import type { Margins, PageSize } from '../../model/geometry';
import { PAGE_SIZE_LETTER } from '../../model/geometry';
import { twipsToPt } from '../../model/units';
import { readCoreProperties } from '../core-properties';
import type { DrawingTheme } from '../drawingml';
import { EMPTY_THEME, readTheme } from '../drawingml';
import type { DocxStyleContext } from './styles';
import { resolveParagraphProperties, resolveRunProperties } from './styles';

// Package -> ContentDocument (the wordprocessing variant). Walks WordprocessingML directly over Package/XmlElement rather than building on ooxml.js's own readDocx, whose 'paragraphs' field (even after the upstream fix landed in ooxml.js 1.3.1) still carries no styling/geometry data and flattens document order across tables -- unusable as a basis for a layout engine. Headers/footers and live PAGE/NUMPAGES field substitution are not implemented in this pass -- a deliberate, tracked narrowing from the plan's original scope, not a silent gap: fields resolve to their cached result text (Word already computed it; re-evaluating is unnecessary per the plan's own reasoning), which is correct for every field except one whose value would change under this converter's own, different pagination.

const DOCUMENT_PART_PATH = 'word/document.xml';
const STYLES_PART_PATH = 'word/styles.xml';
const THEME_REL_SUFFIX = '/theme';

// Word's own default page margins (1 inch each side) and page size (US Letter), used whenever a section's w:sectPr omits w:pgMar/w:pgSz.
const DEFAULT_MARGIN_PT = 72;
const DEFAULT_MARGINS: Margins = { topPt: DEFAULT_MARGIN_PT, rightPt: DEFAULT_MARGIN_PT, bottomPt: DEFAULT_MARGIN_PT, leftPt: DEFAULT_MARGIN_PT };

function readPageSize(sectPr: XmlElement): PageSize {
  const pgSz = childrenWithTag(sectPr, 'w:pgSz')[0];
  const w = pgSz === undefined ? undefined : attr(pgSz, 'w:w');
  const h = pgSz === undefined ? undefined : attr(pgSz, 'w:h');
  return w === undefined || h === undefined ? PAGE_SIZE_LETTER : { widthPt: twipsToPt(Number(w)), heightPt: twipsToPt(Number(h)) };
}

function readMargins(sectPr: XmlElement): Margins {
  const pgMar = childrenWithTag(sectPr, 'w:pgMar')[0];
  if (pgMar === undefined) {
    return DEFAULT_MARGINS;
  }
  const top = attr(pgMar, 'w:top');
  const right = attr(pgMar, 'w:right');
  const bottom = attr(pgMar, 'w:bottom');
  const left = attr(pgMar, 'w:left');
  return {
    topPt: top === undefined ? DEFAULT_MARGIN_PT : twipsToPt(Number(top)),
    rightPt: right === undefined ? DEFAULT_MARGIN_PT : twipsToPt(Number(right)),
    bottomPt: bottom === undefined ? DEFAULT_MARGIN_PT : twipsToPt(Number(bottom)),
    leftPt: left === undefined ? DEFAULT_MARGIN_PT : twipsToPt(Number(left)),
  };
}

function readListMembership(pPr: XmlElement | undefined): ContentListMembership | undefined {
  const numPr = pPr === undefined ? undefined : childrenWithTag(pPr, 'w:numPr')[0];
  if (numPr === undefined) {
    return undefined;
  }
  const numIdEl = childrenWithTag(numPr, 'w:numId')[0];
  const numId = numIdEl === undefined ? undefined : attr(numIdEl, 'w:val');
  if (numId === undefined) {
    return undefined;
  }
  const ilvlEl = childrenWithTag(numPr, 'w:ilvl')[0];
  const ilvlVal = ilvlEl === undefined ? undefined : attr(ilvlEl, 'w:val');
  return { numId, level: ilvlVal === undefined ? 0 : Number(ilvlVal) };
}

function readToggle(el: XmlElement | undefined): boolean {
  if (el === undefined) {
    return false;
  }
  const val = attr(el, 'w:val');
  return val === undefined || (val !== '0' && val !== 'false' && val !== 'off');
}

function hasPageBreakBefore(paragraph: XmlElement): boolean {
  const pPr = childrenWithTag(paragraph, 'w:pPr')[0];
  return readToggle(pPr === undefined ? undefined : childrenWithTag(pPr, 'w:pageBreakBefore')[0]);
}

// A run's own w:t/w:tab/w:br children are ordered and interleaved (e.g. "text" w:tab "more text" within one w:r) -- concatenating only w:t would silently drop the tab. w:tab becomes a literal '\t', w:br/w:cr a literal '\n' (every w:br type, including an explicit page break, is treated as a plain line break for v1 -- splitting one paragraph into two at a mid-run page break is a real but rare-enough case to defer).
function readRunText(run: XmlElement): string {
  let text = '';
  for (const child of run.children) {
    if (child.type !== 'element') {
      continue;
    }
    if (child.tag === 'w:t') {
      text += textContent(child);
    } else if (child.tag === 'w:tab') {
      text += '\t';
    } else if (child.tag === 'w:br' || child.tag === 'w:cr') {
      text += '\n';
    }
  }
  return text;
}

function readRun(run: XmlElement, paragraph: XmlElement, context: DocxStyleContext): ContentRun {
  const props = resolveRunProperties(run, paragraph, context);
  return {
    text: readRunText(run),
    bold: props.bold,
    italic: props.italic,
    underline: props.underline,
    strike: props.strike,
    fontFamily: props.fontFamily,
    sizePt: props.sizePt,
    color: props.color,
  };
}

// Walks a paragraph's own children producing its runs, tracking two things across siblings: complex-field state (w:fldChar begin/separate/end -- only the cached result between separate and end is visible content, per the plan's own field-handling rule) and the enclosing hyperlink target (w:hyperlink, resolved via the document's relationships), threaded through w:ins/w:fldSimple recursion. w:del is not recursed into: its own runs use w:delText rather than w:t, so even if visited they would contribute no text -- skipping the element entirely is simpler and matches the plan's "w:del (skip)" rule directly.
function readParagraphRuns(paragraph: XmlElement, context: DocxStyleContext, rels: ReadonlyMap<string, Relationship>): ContentRun[] {
  const runs: ContentRun[] = [];
  let fieldState: 'none' | 'code' | 'result' = 'none';

  function walk(nodes: readonly XmlNode[], hyperlinkTarget: string | undefined): void {
    for (const node of nodes) {
      if (node.type !== 'element') {
        continue;
      }
      if (node.tag === 'w:r') {
        const fldChar = childrenWithTag(node, 'w:fldChar')[0];
        if (fldChar !== undefined) {
          const type = attr(fldChar, 'w:fldCharType');
          if (type === 'begin') {
            fieldState = 'code';
          } else if (type === 'separate') {
            fieldState = 'result';
          } else if (type === 'end') {
            fieldState = 'none';
          }
          continue;
        }
        if (fieldState === 'code') {
          continue;
        }
        const run = readRun(node, paragraph, context);
        runs.push(hyperlinkTarget === undefined ? run : { ...run, hyperlink: hyperlinkTarget });
      } else if (node.tag === 'w:fldSimple') {
        walk(node.children, hyperlinkTarget);
      } else if (node.tag === 'w:hyperlink') {
        const rId = attr(node, 'r:id');
        const target = rId === undefined ? undefined : rels.get(rId)?.target;
        walk(node.children, target ?? hyperlinkTarget);
      } else if (node.tag === 'w:ins') {
        walk(node.children, hyperlinkTarget);
      }
    }
  }

  walk(paragraph.children, undefined);
  return runs;
}

function readParagraph(paragraph: XmlElement, context: DocxStyleContext, rels: ReadonlyMap<string, Relationship>): ContentParagraph {
  const pPr = childrenWithTag(paragraph, 'w:pPr')[0];
  const pStyleEl = pPr === undefined ? undefined : childrenWithTag(pPr, 'w:pStyle')[0];
  const props = resolveParagraphProperties(paragraph, context);
  return {
    kind: 'paragraph',
    runs: readParagraphRuns(paragraph, context, rels),
    styleId: pStyleEl === undefined ? undefined : attr(pStyleEl, 'w:val'),
    alignment: props.alignment,
    list: readListMembership(pPr),
    spacingBeforePt: props.spacingBeforePt,
    spacingAfterPt: props.spacingAfterPt,
    lineSpacing: props.lineSpacing,
    indentLeftPt: props.indentLeftPt,
    indentFirstLinePt: props.indentFirstLinePt,
  };
}

// w:shd/@w:fill is a 6-hex-digit colour, or "auto"/"none" meaning no fill -- both defer rather than asserting a colour, the same convention as w:color/@w:val.
function readCellShading(tcPr: XmlElement | undefined): LayoutColor | undefined {
  const shd = tcPr === undefined ? undefined : childrenWithTag(tcPr, 'w:shd')[0];
  const fill = shd === undefined ? undefined : attr(shd, 'w:fill');
  return fill === undefined || fill === 'auto' || fill === 'none' ? undefined : rgbHexToColor(fill);
}

interface RawCell {
  readonly gridSpan: number;
  readonly isVMergeContinuation: boolean;
  readonly background: LayoutColor | undefined;
  readonly blocks: ContentBlock[];
}

// w:vMerge's own presence-without-@w:val means "continue" (per ECMA-376, "restart" must be explicit) -- distinct from no w:vMerge element at all, which means this cell isn't part of any vertical merge.
function readRawCell(tc: XmlElement, context: DocxStyleContext, rels: ReadonlyMap<string, Relationship>): RawCell {
  const tcPr = childrenWithTag(tc, 'w:tcPr')[0];
  const gridSpanEl = tcPr === undefined ? undefined : childrenWithTag(tcPr, 'w:gridSpan')[0];
  const gridSpanVal = gridSpanEl === undefined ? undefined : attr(gridSpanEl, 'w:val');
  const vMerge = tcPr === undefined ? undefined : childrenWithTag(tcPr, 'w:vMerge')[0];
  const vMergeVal = vMerge === undefined ? undefined : (attr(vMerge, 'w:val') ?? 'continue');
  return {
    gridSpan: gridSpanVal === undefined ? 1 : Number(gridSpanVal),
    isVMergeContinuation: vMergeVal === 'continue',
    background: readCellShading(tcPr),
    // readRawCell/readTable and readBodyBlocks are mutually recursive (a cell can contain a nested table) -- both are function declarations, so hoisting makes this forward reference safe.
    blocks: readBodyBlocks(tc.children, context, rels),
  };
}

// Column indices account for preceding cells' own gridSpan (a spanned cell occupies multiple grid columns); a vMerge-restart anchor's rowSpan is computed by scanning subsequent rows for a "continue" cell at the same column index, matching the anchor's own gridSpan -- ECMA-376 doesn't store the span count directly the way pptx's a:tc/@rowSpan does, so it must be derived.
function readTable(tbl: XmlElement, context: DocxStyleContext, rels: ReadonlyMap<string, Relationship>): ContentTable {
  const tblGrid = childrenWithTag(tbl, 'w:tblGrid')[0];
  const columnWidthsPt = tblGrid === undefined ? [] : childrenWithTag(tblGrid, 'w:gridCol').map((col) => twipsToPt(Number(attr(col, 'w:w') ?? '0')));

  const rawRows: RawCell[][] = childrenWithTag(tbl, 'w:tr').map((tr) => childrenWithTag(tr, 'w:tc').map((tc) => readRawCell(tc, context, rels)));
  const rowColumnIndices: number[][] = rawRows.map((row) => {
    const indices: number[] = [];
    let col = 0;
    for (const cell of row) {
      indices.push(col);
      col += cell.gridSpan;
    }
    return indices;
  });

  const rows = rawRows.map((row, rowIndex) => ({
    cells: row.map((cell, cellIndex): ContentTableCell => {
      if (cell.isVMergeContinuation) {
        return { blocks: [] };
      }
      const colIndex = rowColumnIndices[rowIndex]![cellIndex]!;
      let rowSpan = 1;
      for (let r = rowIndex + 1; r < rawRows.length; r++) {
        const matchIndex = rowColumnIndices[r]!.indexOf(colIndex);
        const matchCell = matchIndex === -1 ? undefined : rawRows[r]![matchIndex];
        if (!matchCell?.isVMergeContinuation) {
          break;
        }
        rowSpan++;
      }
      return {
        blocks: cell.blocks,
        colSpan: cell.gridSpan > 1 ? cell.gridSpan : undefined,
        rowSpan: rowSpan > 1 ? rowSpan : undefined,
        background: cell.background,
      };
    }),
  }));

  return { kind: 'table', columnWidthsPt, rows };
}

// Walks block-level content (w:p, w:tbl), recursing into w:sdt (content controls), w:ins (inserted content), and mc:AlternateContent (Fallback preferred, else the first Choice) -- the same handling ooxml.js's own docx reader was just fixed to apply to w:tbl specifically. w:del is skipped at the block level too (a whole deleted paragraph/table).
function readBodyBlocks(nodes: readonly XmlNode[], context: DocxStyleContext, rels: ReadonlyMap<string, Relationship>): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const node of nodes) {
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'w:p') {
      if (hasPageBreakBefore(node)) {
        blocks.push({ kind: 'pageBreak' });
      }
      blocks.push(readParagraph(node, context, rels));
    } else if (node.tag === 'w:tbl') {
      blocks.push(readTable(node, context, rels));
    } else if (node.tag === 'w:sdt') {
      const sdtContent = childrenWithTag(node, 'w:sdtContent')[0];
      if (sdtContent !== undefined) {
        blocks.push(...readBodyBlocks(sdtContent.children, context, rels));
      }
    } else if (node.tag === 'w:ins') {
      blocks.push(...readBodyBlocks(node.children, context, rels));
    } else if (node.tag === 'mc:AlternateContent') {
      const target = childrenWithTag(node, 'mc:Fallback')[0] ?? childrenWithTag(node, 'mc:Choice')[0];
      if (target !== undefined) {
        blocks.push(...readBodyBlocks(target.children, context, rels));
      }
    }
  }
  return blocks;
}

// A mid-document section break is an otherwise-ordinary w:p whose w:pPr carries its own w:sectPr, describing the section that paragraph (and everything since the previous break) belongs to; the body's own trailing w:sectPr (a direct child, not nested in any paragraph) closes the final section. Multi-section support falls out of this directly: each section break just starts a fresh blocks accumulator.
function readSections(body: XmlElement, context: DocxStyleContext, rels: ReadonlyMap<string, Relationship>): ContentSection[] {
  const sections: ContentSection[] = [];
  let currentBlocks: ContentBlock[] = [];

  for (const node of body.children) {
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'w:sectPr') {
      sections.push({ pageSize: readPageSize(node), margins: readMargins(node), blocks: currentBlocks });
      currentBlocks = [];
      continue;
    }
    if (node.tag === 'w:p') {
      const pPr = childrenWithTag(node, 'w:pPr')[0];
      const sectPr = pPr === undefined ? undefined : childrenWithTag(pPr, 'w:sectPr')[0];
      if (hasPageBreakBefore(node)) {
        currentBlocks.push({ kind: 'pageBreak' });
      }
      currentBlocks.push(readParagraph(node, context, rels));
      if (sectPr !== undefined) {
        sections.push({ pageSize: readPageSize(sectPr), margins: readMargins(sectPr), blocks: currentBlocks });
        currentBlocks = [];
      }
      continue;
    }
    currentBlocks.push(...readBodyBlocks([node], context, rels));
  }

  if (currentBlocks.length > 0 || sections.length === 0) {
    sections.push({ pageSize: PAGE_SIZE_LETTER, margins: DEFAULT_MARGINS, blocks: currentBlocks });
  }
  return sections;
}

function readDocumentTheme(pkg: Package, docRels: ReadonlyMap<string, Relationship>): DrawingTheme {
  for (const rel of docRels.values()) {
    if (rel.type.endsWith(THEME_REL_SUFFIX)) {
      const themeRoot = rootElement(pkg.parts[rel.target]);
      if (themeRoot !== undefined) {
        return readTheme(themeRoot);
      }
    }
  }
  return EMPTY_THEME;
}

export function readDocxContent(pkg: Package): ContentDocument {
  const documentRoot = rootElement(pkg.parts[DOCUMENT_PART_PATH]);
  if (documentRoot === undefined) {
    throw new Error(`package has no ${DOCUMENT_PART_PATH} part`);
  }
  const body = childrenWithTag(documentRoot, 'w:body')[0];
  if (body === undefined) {
    throw new Error(`${DOCUMENT_PART_PATH} has no w:body element`);
  }

  const docRels = resolveRelationships(pkg, DOCUMENT_PART_PATH);
  const context: DocxStyleContext = { stylesRoot: rootElement(pkg.parts[STYLES_PART_PATH]), theme: readDocumentTheme(pkg, docRels) };

  return { kind: 'wordprocessing', formatVersion: CONTENT_FORMAT_VERSION, metadata: readCoreProperties(pkg), sections: readSections(body, context, docRels) };
}
