import { z } from 'zod';
import type { Package } from '../../model/package';
import type { XmlElement, XmlNode } from '../../model/node';
import type { Color, ContentBlock, ContentBorder, ContentCellBorders, ContentImageBlock, ContentListMembership, ContentParagraph, ContentRun, ContentSection, ContentStrokeStyle, ContentTable, ContentTableCell, Margins, PageSize } from 'document-schema.js';
import { COLOR_BLACK, ContentSectionSchema, PAGE_SIZE_LETTER, clampHeadingLevel, rgbHexToColor } from 'document-schema.js';
import { DocumentMetadataSchema, readCoreProperties } from '../shared/metadata';
import { eighthPointsToPt, emuToPt, twipsToPt } from '../shared/units';
import type { DrawingTheme } from '../shared/drawingml';
import { EMPTY_THEME, readTheme } from '../shared/drawingml';
import { assignSourcePaths } from '../shared/source-path';
import { sniffImageFormat } from '../../image/sniff';
import { base64ToBytes } from '../../util/base64';
import type { Relationship } from '../util';
import { attr, childrenWithTag, elementsWithTag, resolveRelationships, rootElement, textContent } from '../util';
import type { DocxStyleContext } from './styles';
import { resolveParagraphProperties, resolveRunProperties } from './styles';
import { NumberingDefinitionSchema, readNumberingDefinitions } from './numbering';

// Package -> DocxDocument. Walks word/document.xml directly, resolving the full style cascade (docDefaults -> named-style basedOn chains -> paragraph-mark run properties -> character styles -> direct formatting) and DrawingML theme references for each run, so document order, styling, and geometry are all preserved -- unlike a naive reader that flattens paragraphs/tables into separate arrays with no shared ordering. Headers/footers keep their prior flat-text projection; live PAGE/NUMPAGES field substitution is not implemented -- fields resolve to their cached result text (Word already computed it), which is correct for every field except one whose value would change under a different pagination this reader doesn't perform. Ported from documents.js's src/ooxml/docx/read.ts (the section/style-cascade walk) merged with this package's own prior comment/footnote/header/footer reading.

export const CommentSchema = z.object({
  author: z.string().optional(),
  text: z.string(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const FootnoteSchema = z.object({
  type: z.string().optional(),
  text: z.string(),
});
export type Footnote = z.infer<typeof FootnoteSchema>;

export const DocxDocumentSchema = z.object({
  metadata: DocumentMetadataSchema,
  sections: z.array(ContentSectionSchema),
  comments: z.array(CommentSchema),
  footnotes: z.array(FootnoteSchema),
  headers: z.array(z.string()),
  footers: z.array(z.string()),
  // word/numbering.xml's own abstractNum/num definitions, keyed by w:numId -- see numbering.ts's own doc comment for why this sits as a separate top-level field rather than folded into ContentListMembership (the numId/level membership every list paragraph already carries via ContentParagraph.list, read unchanged by readListMembership below).
  numbering: z.record(z.string(), NumberingDefinitionSchema),
});
export type DocxDocument = z.infer<typeof DocxDocumentSchema>;

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

// A run's own w:t/w:tab/w:br children are ordered and interleaved (e.g. "text" w:tab "more text" within one w:r) -- concatenating only w:t would silently drop the tab. w:tab becomes a literal '\t', w:br/w:cr a literal '\n' (every w:br type, including an explicit page break, is treated as a plain line break here -- splitting one paragraph into two at a mid-run page break is a real but rare-enough case to defer).
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

// A w:drawing wraps exactly one wp:inline (in-flow) or wp:anchor (floating/wrapped) container, both of which share the same wp:extent (EMU size) and wp:docPr (name/alt-text) children, and both of which reach the actual picture through an identical a:graphic/a:graphicData/pic:pic/pic:blipFill/a:blip chain -- so both placements resolve through one function. wp:anchor's own wp:positionH/wp:positionV (page/margin/paragraph-relative offset) is read by nothing here: ContentImageBlock has no absolute x/y positioning field at all (unlike ContentShape's frame), so a floating image has nowhere to record its real anchored position -- it is deliberately placed in the block flow at the point its own w:drawing was encountered, i.e. exactly where an inline image would land. This is a real, honest scope narrowing (a floating image's on-page position is lost, not silently wrong), not an attempt at true anchored placement.
function readDrawingImage(drawing: XmlElement, rels: ReadonlyMap<string, Relationship>, pkg: Package): ContentImageBlock | undefined {
  const container = childrenWithTag(drawing, 'wp:inline')[0] ?? childrenWithTag(drawing, 'wp:anchor')[0];
  if (container === undefined) {
    return undefined;
  }
  const extent = childrenWithTag(container, 'wp:extent')[0];
  const cx = extent === undefined ? undefined : attr(extent, 'cx');
  const cy = extent === undefined ? undefined : attr(extent, 'cy');
  if (cx === undefined || cy === undefined) {
    return undefined;
  }
  const docPr = childrenWithTag(container, 'wp:docPr')[0];
  const altText = docPr === undefined ? undefined : (attr(docPr, 'descr') ?? attr(docPr, 'title'));
  const blip = elementsWithTag(container.children, 'a:blip')[0];
  const rId = blip === undefined ? undefined : attr(blip, 'r:embed');
  const rel = rId === undefined ? undefined : rels.get(rId);
  const mediaPart = rel === undefined ? undefined : pkg.parts[rel.target];
  if (mediaPart?.kind !== 'binary') {
    return undefined;
  }
  const bytes = base64ToBytes(mediaPart.base64);
  const format = sniffImageFormat(bytes);
  if (format === undefined) {
    return undefined;
  }
  const image: ContentImageBlock = { kind: 'image', format, base64: mediaPart.base64, widthPt: emuToPt(Number(cx)), heightPt: emuToPt(Number(cy)) };
  if (altText !== undefined) {
    image.altText = altText;
  }
  return image;
}

// Collects every w:drawing found anywhere inside a paragraph's own content (nested inside w:r, w:hyperlink, w:ins, w:fldSimple), in document order, while excluding w:del subtrees entirely -- mirroring readParagraphRuns' own tracked-changes handling, since a deleted drawing's own w:r sits inside w:del alongside w:delText runs.
function collectDrawings(nodes: readonly XmlNode[], out: XmlElement[]): void {
  for (const node of nodes) {
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'w:del') {
      continue;
    }
    if (node.tag === 'w:drawing') {
      out.push(node);
      continue;
    }
    collectDrawings(node.children, out);
  }
}

// ContentRun has no field to carry an inline image (unlike ContentShape's blocks list in pptx) -- an image found inside a paragraph's own runs is therefore surfaced as its own sibling ContentImageBlock, appended immediately after that paragraph's block, rather than nested inside it. This preserves block-level document order (the image still appears right after the paragraph that contained it) at the cost of losing the image's exact character-level position within that paragraph's text -- a real, bounded scope narrowing forced by ContentParagraph's own shape, not a silent drop.
function readParagraphImages(paragraph: XmlElement, rels: ReadonlyMap<string, Relationship>, pkg: Package): ContentImageBlock[] {
  const drawings: XmlElement[] = [];
  collectDrawings(paragraph.children, drawings);
  const images: ContentImageBlock[] = [];
  for (const drawing of drawings) {
    const image = readDrawingImage(drawing, rels, pkg);
    if (image !== undefined) {
      images.push(image);
    }
  }
  return images;
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

// Walks a paragraph's own children producing its runs, tracking two things across siblings: complex-field state (w:fldChar begin/separate/end -- only the cached result between separate and end is visible content) and the enclosing hyperlink target (w:hyperlink, resolved via the document's relationships), threaded through w:ins/w:fldSimple recursion. w:del is not recursed into: its own runs use w:delText rather than w:t, so even if visited they would contribute no text -- skipping the element entirely is simpler.
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
    // w:outlineLvl is 0-based (0 is a level-1 heading). Word's own outline levels run 1-9 while the schema's heading domain is 1-6, so clampHeadingLevel narrows levels 7-9 onto 6 -- the same closest-matching-value convention readAlignment (styles.ts) applies to w:jc's both/distribute.
    headingLevel: props.outlineLvl === undefined ? undefined : clampHeadingLevel(props.outlineLvl + 1),
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
function readCellShading(tcPr: XmlElement | undefined): Color | undefined {
  const shd = tcPr === undefined ? undefined : childrenWithTag(tcPr, 'w:shd')[0];
  const fill = shd === undefined ? undefined : attr(shd, 'w:fill');
  return fill === undefined || fill === 'auto' || fill === 'none' ? undefined : rgbHexToColor(fill);
}

// WordprocessingML's own ST_Border enumeration has several dozen decorative line styles (wave, threeDEmboss, dashDotStroked, ...) that ContentBorder's four-member ContentStrokeStyle can't distinguish individually -- each maps to whichever of solid/dashed/dotted/double it visually resembles most closely, the same "narrow to the closest matching value" convention readAlignment (styles.ts) already applies to w:jc's own both/distribute -> justify. Anything unmapped defaults to 'solid' rather than being dropped, since a border with an unrecognised style is still visually a border.
const BORDER_STYLE_MAP: ReadonlyMap<string, ContentStrokeStyle> = new Map([
  ['single', 'solid'],
  ['thick', 'solid'],
  ['triple', 'solid'],
  ['outset', 'solid'],
  ['inset', 'solid'],
  ['threeDEmboss', 'solid'],
  ['threeDEngrave', 'solid'],
  ['dashed', 'dashed'],
  ['dashSmallGap', 'dashed'],
  ['dashDotStroked', 'dashed'],
  ['dotDash', 'dashed'],
  ['dotted', 'dotted'],
  ['dotDotDash', 'dotted'],
  ['double', 'double'],
  ['doubleWave', 'double'],
]);

// ECMA-376's own default border width whenever @w:sz is present on a genuine (non-nil/none) edge but the attribute itself is absent -- 4 eighths of a point, i.e. half a point, the width Word's own UI defaults a newly-applied border to.
const DEFAULT_BORDER_WIDTH_EIGHTH_POINTS = 4;

// One w:tcBorders child (w:top/w:left/w:right/w:bottom): @w:val is the line style ('nil'/'none' means no border on that edge, mirroring readCellShading's own 'auto'/'none' treatment), @w:sz is the width in eighths of a point (ST_EighthPointMeasure -- see units.ts's own EIGHTH_POINTS_PER_POINT comment for why this isn't the half-point w:sz font-size uses), and @w:color is a 6-hex-digit RGB value or 'auto' (resolved to black, matching real Word rendering of an unspecified/automatic border colour).
function readCellBorderEdge(tcBorders: XmlElement | undefined, tag: string): ContentBorder | undefined {
  const edge = tcBorders === undefined ? undefined : childrenWithTag(tcBorders, tag)[0];
  const val = edge === undefined ? undefined : attr(edge, 'w:val');
  if (edge === undefined || val === undefined || val === 'nil' || val === 'none') {
    return undefined;
  }
  const sz = attr(edge, 'w:sz');
  const colorVal = attr(edge, 'w:color');
  const color = colorVal === undefined || colorVal === 'auto' ? COLOR_BLACK : rgbHexToColor(colorVal);
  return {
    color,
    widthPt: eighthPointsToPt(sz === undefined ? DEFAULT_BORDER_WIDTH_EIGHTH_POINTS : Number(sz)),
    style: BORDER_STYLE_MAP.get(val) ?? 'solid',
  };
}

// w:left/w:right also accept the RTL-neutral w:start/w:end aliases, mirroring resolveParagraphProperties' own w:ind/@w:left-vs-@w:start handling in styles.ts. Returns undefined (rather than an all-undefined object) when the cell declares no w:tcBorders at all, or declares one with every edge nil/none -- distinguishing "no border information present" from "borders explicitly present but empty" isn't meaningful here, so both collapse to the same absent result.
function readCellBorders(tcPr: XmlElement | undefined): ContentCellBorders | undefined {
  const tcBorders = tcPr === undefined ? undefined : childrenWithTag(tcPr, 'w:tcBorders')[0];
  if (tcBorders === undefined) {
    return undefined;
  }
  const borders: ContentCellBorders = {};
  const left = readCellBorderEdge(tcBorders, 'w:left') ?? readCellBorderEdge(tcBorders, 'w:start');
  const right = readCellBorderEdge(tcBorders, 'w:right') ?? readCellBorderEdge(tcBorders, 'w:end');
  const top = readCellBorderEdge(tcBorders, 'w:top');
  const bottom = readCellBorderEdge(tcBorders, 'w:bottom');
  if (left !== undefined) {
    borders.left = left;
  }
  if (right !== undefined) {
    borders.right = right;
  }
  if (top !== undefined) {
    borders.top = top;
  }
  if (bottom !== undefined) {
    borders.bottom = bottom;
  }
  return Object.keys(borders).length === 0 ? undefined : borders;
}

interface RawCell {
  readonly gridSpan: number;
  readonly isVMergeContinuation: boolean;
  readonly background: Color | undefined;
  readonly borders: ContentCellBorders | undefined;
  readonly blocks: ContentBlock[];
}

// w:vMerge's own presence-without-@w:val means "continue" (per ECMA-376, "restart" must be explicit) -- distinct from no w:vMerge element at all, which means this cell isn't part of any vertical merge.
function readRawCell(tc: XmlElement, context: DocxStyleContext, rels: ReadonlyMap<string, Relationship>, pkg: Package): RawCell {
  const tcPr = childrenWithTag(tc, 'w:tcPr')[0];
  const gridSpanEl = tcPr === undefined ? undefined : childrenWithTag(tcPr, 'w:gridSpan')[0];
  const gridSpanVal = gridSpanEl === undefined ? undefined : attr(gridSpanEl, 'w:val');
  const vMerge = tcPr === undefined ? undefined : childrenWithTag(tcPr, 'w:vMerge')[0];
  const vMergeVal = vMerge === undefined ? undefined : (attr(vMerge, 'w:val') ?? 'continue');
  return {
    gridSpan: gridSpanVal === undefined ? 1 : Number(gridSpanVal),
    isVMergeContinuation: vMergeVal === 'continue',
    background: readCellShading(tcPr),
    borders: readCellBorders(tcPr),
    // readRawCell/readTable and readBodyBlocks are mutually recursive (a cell can contain a nested table) -- both are function declarations, so hoisting makes this forward reference safe.
    blocks: readBodyBlocks(tc.children, context, rels, pkg),
  };
}

// w:trHeight@w:val is in twips (ECMA-376 17.4.81); absent when the row has no explicit height, in which case heightPt stays undefined and the consumer falls back to its own default -- matching how readPageSize/readMargins leave pageSize/margins untouched rather than synthesising a value.
function readRowHeightPt(tr: XmlElement): number | undefined {
  const trPr = childrenWithTag(tr, 'w:trPr')[0];
  if (trPr === undefined) {
    return undefined;
  }
  const trHeight = childrenWithTag(trPr, 'w:trHeight')[0];
  const val = trHeight === undefined ? undefined : attr(trHeight, 'w:val');
  return val === undefined ? undefined : twipsToPt(Number(val));
}

// Column indices account for preceding cells' own gridSpan (a spanned cell occupies multiple grid columns); a vMerge-restart anchor's rowSpan is computed by scanning subsequent rows for a "continue" cell at the same column index, matching the anchor's own gridSpan -- ECMA-376 doesn't store the span count directly the way pptx's a:tc/@rowSpan does, so it must be derived.
function readTable(tbl: XmlElement, context: DocxStyleContext, rels: ReadonlyMap<string, Relationship>, pkg: Package): ContentTable {
  const tblGrid = childrenWithTag(tbl, 'w:tblGrid')[0];
  const columnWidthsPt = tblGrid === undefined ? [] : childrenWithTag(tblGrid, 'w:gridCol').map((col) => twipsToPt(Number(attr(col, 'w:w') ?? '0')));

  const trs = childrenWithTag(tbl, 'w:tr');
  const rawRows: RawCell[][] = trs.map((tr) => childrenWithTag(tr, 'w:tc').map((tc) => readRawCell(tc, context, rels, pkg)));
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
    heightPt: readRowHeightPt(trs[rowIndex]!),
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
        borders: cell.borders,
      };
    }),
  }));

  return { kind: 'table', columnWidthsPt, rows };
}

// Walks block-level content (w:p, w:tbl), recursing into w:sdt (content controls), w:ins (inserted content), and mc:AlternateContent (Fallback preferred, else the first Choice). w:del is skipped at the block level too (a whole deleted paragraph/table). Any w:drawing found inside a paragraph is surfaced as a sibling ContentImageBlock immediately following that paragraph's own block -- see readParagraphImages.
function readBodyBlocks(nodes: readonly XmlNode[], context: DocxStyleContext, rels: ReadonlyMap<string, Relationship>, pkg: Package): ContentBlock[] {
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
      blocks.push(...readParagraphImages(node, rels, pkg));
    } else if (node.tag === 'w:tbl') {
      blocks.push(readTable(node, context, rels, pkg));
    } else if (node.tag === 'w:sdt') {
      const sdtContent = childrenWithTag(node, 'w:sdtContent')[0];
      if (sdtContent !== undefined) {
        blocks.push(...readBodyBlocks(sdtContent.children, context, rels, pkg));
      }
    } else if (node.tag === 'w:ins') {
      blocks.push(...readBodyBlocks(node.children, context, rels, pkg));
    } else if (node.tag === 'mc:AlternateContent') {
      const target = childrenWithTag(node, 'mc:Fallback')[0] ?? childrenWithTag(node, 'mc:Choice')[0];
      if (target !== undefined) {
        blocks.push(...readBodyBlocks(target.children, context, rels, pkg));
      }
    }
  }
  return blocks;
}

// A mid-document section break is an otherwise-ordinary w:p whose w:pPr carries its own w:sectPr, describing the section that paragraph (and everything since the previous break) belongs to; the body's own trailing w:sectPr (a direct child, not nested in any paragraph) closes the final section. Multi-section support falls out of this directly: each section break just starts a fresh blocks accumulator.
function readSections(body: XmlElement, context: DocxStyleContext, rels: ReadonlyMap<string, Relationship>, pkg: Package): ContentSection[] {
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
      currentBlocks.push(...readParagraphImages(node, rels, pkg));
      if (sectPr !== undefined) {
        sections.push({ pageSize: readPageSize(sectPr), margins: readMargins(sectPr), blocks: currentBlocks });
        currentBlocks = [];
      }
      continue;
    }
    currentBlocks.push(...readBodyBlocks([node], context, rels, pkg));
  }

  if (currentBlocks.length > 0 || sections.length === 0) {
    sections.push({ pageSize: PAGE_SIZE_LETTER, margins: DEFAULT_MARGINS, blocks: currentBlocks });
  }
  sections.forEach((section, sectionIndex) => assignSourcePaths(section.blocks, `sections[${sectionIndex}]`));
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

function readComment(comment: XmlElement): Comment {
  const author = attr(comment, 'w:author');
  const text = elementsWithTag(comment.children, 'w:t').map(textContent).join('');
  const result: Comment = { text };
  if (author !== undefined) {
    result.author = author;
  }
  return result;
}

function readFootnote(footnote: XmlElement): Footnote {
  const type = attr(footnote, 'w:type');
  const text = elementsWithTag(footnote.children, 'w:t').map(textContent).join('');
  const result: Footnote = { text };
  if (type !== undefined) {
    result.type = type;
  }
  return result;
}

function readComments(pkg: Package): Comment[] {
  const root = rootElement(pkg.parts['word/comments.xml']);
  if (root === undefined) {
    return [];
  }
  return childrenWithTag(root, 'w:comment').map(readComment);
}

function readFootnotes(pkg: Package): Footnote[] {
  const root = rootElement(pkg.parts['word/footnotes.xml']);
  if (root === undefined) {
    return [];
  }
  const out: Footnote[] = [];
  for (const fn of childrenWithTag(root, 'w:footnote')) {
    const type = attr(fn, 'w:type');
    if (type === 'separator' || type === 'continuationSeparator') {
      continue;
    }
    out.push(readFootnote(fn));
  }
  return out;
}

// Concatenated w:t text of every word/header*.xml or word/footer*.xml part (matched by part-key prefix); each part contributes one entry, in package-key order.
function readHeaderFooterText(pkg: Package, prefix: string): string[] {
  const out: string[] = [];
  for (const path of Object.keys(pkg.parts)) {
    if (!path.startsWith(prefix) || !path.endsWith('.xml')) {
      continue;
    }
    const part = pkg.parts[path];
    if (part?.kind !== 'xml') {
      continue;
    }
    out.push(elementsWithTag(part.nodes, 'w:t').map(textContent).join(''));
  }
  return out;
}

// Resolves a generic OOXML Package into DocxDocument: the WordprocessingML style cascade, DrawingML theme resolution (including w:themeColor run-colour references, resolved against the theme's own colour scheme), ordered sections of paragraphs/tables/page-breaks/images (document order preserved, including inside tables, with cell background AND border styling read from w:tcBorders), plus comments, footnotes, header/footer text, and word/numbering.xml's own abstractNum/num level definitions (numbering.ts's readNumberingDefinitions). An inline (wp:inline) or floating/anchored (wp:anchor) w:drawing is resolved to a real ContentImageBlock via the containing part's own relationships, sniffed from its actual media-part bytes rather than trusted from any extension/content-type -- but a floating image's own wp:anchor position (page/margin/paragraph-relative offset) is never read, since ContentImageBlock has no absolute positioning field to record it in; it lands in the block flow at the point its w:drawing was encountered, same as an inline image. It is a one-way read, not a round-trip path: information not modelled here is dropped (section break types other than plain w:sectPr -- ContentSection itself has no field to record w:type's nextPage/continuous/evenPage/oddPage distinction, a document-schema.js addition out of this package's own scope; live PAGE/NUMPAGES field re-evaluation; w:themeShade/w:themeTint refinement of a resolved theme colour; a floating image's own anchored position; and any image whose bytes don't sniff as PNG/JPEG), and a DocxDocument cannot be written back to a package.
export function readDocx(pkg: Package): DocxDocument {
  const documentRoot = rootElement(pkg.parts[DOCUMENT_PART_PATH]);
  if (documentRoot === undefined) {
    throw new Error(`readDocx: package has no ${DOCUMENT_PART_PATH} part`);
  }
  const body = childrenWithTag(documentRoot, 'w:body')[0];
  if (body === undefined) {
    throw new Error(`readDocx: ${DOCUMENT_PART_PATH} has no w:body element`);
  }

  const docRels = resolveRelationships(pkg, DOCUMENT_PART_PATH);
  const context: DocxStyleContext = { stylesRoot: rootElement(pkg.parts[STYLES_PART_PATH]), theme: readDocumentTheme(pkg, docRels) };

  return {
    metadata: readCoreProperties(pkg),
    sections: readSections(body, context, docRels, pkg),
    comments: readComments(pkg),
    footnotes: readFootnotes(pkg),
    headers: readHeaderFooterText(pkg, 'word/header'),
    footers: readHeaderFooterText(pkg, 'word/footer'),
    numbering: readNumberingDefinitions(pkg),
  };
}
