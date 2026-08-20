import { z } from 'zod';
import type { Package } from '../../model/package';
import type { XmlElement, XmlNode } from '../../model/node';
import type { Color, ContentBlock, ContentBorder, ContentCellBorders, ContentEmbeddedObjectBlock, ContentImageBlock, ContentListMembership, ContentParagraph, ContentRun, ContentSection, ContentStrokeStyle, ContentTable, ContentTableCell, Margins, PageSize, ProvenanceChange } from 'document-schema.js';
import { COLOR_BLACK, ContentSectionSchema, PAGE_SIZE_LETTER, clampHeadingLevel, rgbHexToColor } from 'document-schema.js';
import { DocumentMetadataSchema, readCoreProperties } from '../shared/metadata';
import { readEmbeddedOoxmlPayload } from '../embedded';
import { eighthPointsToPt, emuToPt, twipsToPt } from '../shared/units';
import type { DrawingTheme } from '../shared/drawingml';
import { EMPTY_THEME, readTheme } from '../shared/drawingml';
import { assignSourcePaths } from '../shared/source-path';
import { sniffImageFormat } from '../../image/sniff';
import { base64ToBytes } from '../../util/base64';
import type { Relationship } from '../util';
import { attr, childrenWithTag, decodeEntities, elementsWithTag, resolveRelationships, rootElement, textContent } from '../util';
import type { DocxStyleContext } from './styles';
import { resolveParagraphProperties, resolveRunProperties } from './styles';
import { NumberingDefinitionSchema, readNumberingDefinitions } from './numbering';
import type { ConstructExtent, ParagraphContentIndex } from './constructs';
import {
  PROVENANCE_CHANGE_BY_TAG,
  bookmarkAnchorDescriptor,
  contentBearingChildren,
  fieldCharType,
  indexParagraphContent,
  insertConstructMarkers,
  isDeletedChange,
  readContentControlDescriptor,
  readProvenanceDescriptor,
  runInstructionText,
} from './constructs';

// Package -> DocxDocument. Walks word/document.xml directly, resolving the full style cascade (docDefaults -> named-style basedOn chains -> paragraph-mark run properties -> character styles -> direct formatting) and DrawingML theme references for each run, so document order, styling, and geometry are all preserved -- unlike a naive reader that flattens paragraphs/tables into separate arrays with no shared ordering. Headers/footers keep their prior flat-text projection; live PAGE/NUMPAGES field substitution is not implemented -- fields resolve to their cached result text (Word already computed it), which is correct for every field except one whose value would change under a different pagination this reader doesn't perform. Ported from documents.js's src/ooxml/docx/read.ts (the section/style-cascade walk) merged with this package's own prior comment/footnote/header/footer reading.
//
// This is the flat, content-level half of the docx read pair: readDocx (typed/document-package.ts) wraps it into a tree-form DocumentPackage, which is the primary name and the shape a caller holding a whole document wants. Reach for this one when you need what the tree has no spelling for -- the comments, footnotes, header/footer text, and numbering definitions DocxDocument carries outside `sections` -- or when driving a pipeline that already works in flat ContentSection[].
//
// Block-scoped fidelity constructs (structured document tags, complex and simple fields, bookmarks, tracked insertions/deletions/moves) are read into document-schema.js's constructStart/constructEnd marker pairs bracketing the blocks they span -- see typed/docx/constructs.ts for the descriptor shapes and the block-scope rule that decides which real-world occurrences are representable and which are not.

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

// Everything the block walk needs that does not change as it descends: the style/theme cascade context, the containing part's own relationships, and the package the media parts live in.
interface DocxReadContext {
  readonly styles: DocxStyleContext;
  readonly rels: ReadonlyMap<string, Relationship>;
  readonly pkg: Package;
}

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

// A run's own w:t/w:delText/w:tab/w:br children are ordered and interleaved (e.g. "text" w:tab "more text" within one w:r) -- concatenating only w:t would silently drop the tab. w:delText is the spelling a run takes inside a tracked deletion or move-from, and is read identically: a deletion's text is the whole point of carrying the deletion at all. w:tab becomes a literal '\t', w:br/w:cr a literal '\n' (every w:br type, including an explicit page break, is treated as a plain line break here -- splitting one paragraph into two at a mid-run page break is a real but rare-enough case to defer).
function readRunText(run: XmlElement): string {
  let text = '';
  for (const child of run.children) {
    if (child.type !== 'element') {
      continue;
    }
    if (child.tag === 'w:t' || child.tag === 'w:delText') {
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
function readDrawingImage(drawing: XmlElement, ctx: DocxReadContext): ContentImageBlock | undefined {
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
  const rel = rId === undefined ? undefined : ctx.rels.get(rId);
  const mediaPart = rel === undefined ? undefined : ctx.pkg.parts[rel.target];
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
    image.altText = decodeEntities(altText);
  }
  return image;
}

// Resolves a w:object's OLE payload (o:OLEObject/@r:id -> document relationship -> embeddings part) through readEmbeddedOoxmlPayload: a ZIP payload (a modern producer's embedded xlsx/docx/pptx) becomes the recovered sub-document's ContentEmbeddedObjectBlock, sized from w:object's own w:dxaOrig/w:dyaOrig (twips), while the classic non-ZIP OLE compound-file payload (.bin) and a ZIP that does not decode as one of the three OOXML flavours both return undefined and are skipped, exactly as unhandled markup is -- second-order content degrades, it never fails the host read. Undefined follows the same convention as readDrawingImage: an id, relationship, or part that does not line up (including an externally-linked object, whose relationship target is a URI no part key matches) leaves the paragraph with no embedded block, never a partial one. The frame sits at the origin because an inline flow object has no absolute position to record -- ContentEmbeddedObjectBlock's frame is required, and 0/0 is the honest spelling of "positioned by the flow", the same narrowing readDrawingImage makes for wp:anchor.
function readObjectEmbeddedObject(object: XmlElement, ctx: DocxReadContext): ContentEmbeddedObjectBlock | undefined {
  const dxaOrig = attr(object, 'w:dxaOrig');
  const dyaOrig = attr(object, 'w:dyaOrig');
  if (dxaOrig === undefined || dyaOrig === undefined) {
    return undefined;
  }
  const oleObject = elementsWithTag([object], 'o:OLEObject')[0];
  const rId = oleObject === undefined ? undefined : attr(oleObject, 'r:id');
  const rel = rId === undefined ? undefined : ctx.rels.get(rId);
  const payloadPart = rel === undefined ? undefined : ctx.pkg.parts[rel.target];
  if (payloadPart?.kind !== 'binary') {
    return undefined;
  }
  const payload = readEmbeddedOoxmlPayload(base64ToBytes(payloadPart.base64));
  return payload === undefined ? undefined : { kind: 'embeddedObject', objectKind: payload.objectKind, document: payload.document, frame: { xPt: 0, yPt: 0, widthPt: twipsToPt(Number(dxaOrig)), heightPt: twipsToPt(Number(dyaOrig)) } };
}

// Collects every w:drawing and w:object found anywhere inside a paragraph's own content (nested inside w:r, w:hyperlink, w:ins, w:fldSimple), in document order. Deleted subtrees (w:del, w:moveFrom) are excluded unless the caller is carrying deletions -- mirroring readParagraphRuns' own tracked-changes handling, since a deleted drawing's own w:r sits inside w:del alongside w:delText runs, and a drawing lifted out of a deletion the reader is not carrying would appear as live content. A w:object is pushed at its own position and then recursed into, so a w:drawing nested inside it (a modern producer's mc:AlternateContent preview spelling) is still collected as an image in its own right, exactly as it was before embedded-object recovery existed.
function collectLiftedElements(nodes: readonly XmlNode[], carryDeletions: boolean, out: XmlElement[]): void {
  for (const node of nodes) {
    if (node.type !== 'element') {
      continue;
    }
    if (!carryDeletions && (node.tag === 'w:del' || node.tag === 'w:moveFrom')) {
      continue;
    }
    if (node.tag === 'w:drawing' || node.tag === 'w:object') {
      out.push(node);
      if (node.tag === 'w:drawing') {
        continue;
      }
    }
    collectLiftedElements(node.children, carryDeletions, out);
  }
}

// ContentRun has no field to carry an inline image or embedded object (unlike ContentShape's blocks list in pptx) -- media found inside a paragraph's own runs is therefore surfaced as its own sibling block (ContentImageBlock or ContentEmbeddedObjectBlock), appended immediately after that paragraph's block in the order the markup introduced them, rather than nested inside it. This preserves block-level document order (each lifted block still appears right after the paragraph that contained it, and drawings and objects keep their relative order) at the cost of losing each one's exact character-level position within that paragraph's text -- a real, bounded scope narrowing forced by ContentParagraph's own shape, not a silent drop.
function readParagraphLiftedBlocks(paragraph: XmlElement, ctx: DocxReadContext, carryDeletions: boolean): ContentBlock[] {
  const lifted: XmlElement[] = [];
  collectLiftedElements(paragraph.children, carryDeletions, lifted);
  const blocks: ContentBlock[] = [];
  for (const element of lifted) {
    const block = element.tag === 'w:object' ? readObjectEmbeddedObject(element, ctx) : readDrawingImage(element, ctx);
    if (block !== undefined) {
      blocks.push(block);
    }
  }
  return blocks;
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

// Walks a paragraph's own children producing its runs, tracking two things across siblings: complex-field state (w:fldChar begin/separate/end -- only the cached result between separate and end is visible content) and the enclosing hyperlink target (w:hyperlink, resolved via the document's relationships), threaded through w:ins/w:moveTo/w:sdt/w:fldSimple recursion. w:del and w:moveFrom are recursed into only when the caller is carrying deletions -- i.e. when the whole paragraph is itself a tracked deletion or move-from, so that every run it yields is labelled as deleted by the enclosing provenance construct. A mid-paragraph deletion stays excluded, because lifting those runs into the paragraph's own text would render deleted words as live text, which is strictly worse than the existing omission.
function readParagraphRuns(paragraph: XmlElement, ctx: DocxReadContext, carryDeletions: boolean): ContentRun[] {
  const runs: ContentRun[] = [];
  let fieldState: 'none' | 'code' | 'result' = 'none';

  function walk(nodes: readonly XmlNode[], hyperlinkTarget: string | undefined): void {
    for (const node of nodes) {
      if (node.type !== 'element') {
        continue;
      }
      if (node.tag === 'w:r') {
        const type = fieldCharType(node);
        if (type !== undefined) {
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
        const run = readRun(node, paragraph, ctx.styles);
        runs.push(hyperlinkTarget === undefined ? run : { ...run, hyperlink: hyperlinkTarget });
      } else if (node.tag === 'w:fldSimple') {
        walk(node.children, hyperlinkTarget);
      } else if (node.tag === 'w:hyperlink') {
        const rId = attr(node, 'r:id');
        const target = rId === undefined ? undefined : ctx.rels.get(rId)?.target;
        walk(node.children, target ?? hyperlinkTarget);
      } else if (node.tag === 'w:ins' || node.tag === 'w:moveTo') {
        walk(node.children, hyperlinkTarget);
      } else if (node.tag === 'w:del' || node.tag === 'w:moveFrom') {
        if (carryDeletions) {
          walk(node.children, hyperlinkTarget);
        }
      } else if (node.tag === 'w:sdt') {
        // An inline (run-level) structured document tag: its own descriptor has no encoding here, since a construct marker brackets whole blocks and this one wraps a sub-sequence of runs -- but its content is ordinary text, so it is read as runs rather than dropped along with the descriptor.
        const sdtContent = childrenWithTag(node, 'w:sdtContent')[0];
        if (sdtContent !== undefined) {
          walk(sdtContent.children, hyperlinkTarget);
        }
      }
    }
  }

  walk(paragraph.children, undefined);
  return runs;
}

function readParagraph(paragraph: XmlElement, ctx: DocxReadContext, carryDeletions: boolean): ContentParagraph {
  const pPr = childrenWithTag(paragraph, 'w:pPr')[0];
  const pStyleEl = pPr === undefined ? undefined : childrenWithTag(pPr, 'w:pStyle')[0];
  const props = resolveParagraphProperties(paragraph, ctx.styles);
  return {
    kind: 'paragraph',
    runs: readParagraphRuns(paragraph, ctx, carryDeletions),
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
function readRawCell(tc: XmlElement, ctx: DocxReadContext, carryDeletions: boolean): RawCell {
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
    // A cell's own block list is its own construct-marker bracket scope, exactly as document-schema.js's bracket-matching contract requires: a pair opened inside a cell closes inside that cell, and never straddles the list containing the table.
    blocks: readBlockScope(tc.children, ctx, carryDeletions),
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
function readTable(tbl: XmlElement, ctx: DocxReadContext, carryDeletions: boolean): ContentTable {
  const tblGrid = childrenWithTag(tbl, 'w:tblGrid')[0];
  const columnWidthsPt = tblGrid === undefined ? [] : childrenWithTag(tblGrid, 'w:gridCol').map((col) => twipsToPt(Number(attr(col, 'w:w') ?? '0')));

  const trs = childrenWithTag(tbl, 'w:tr');
  const rawRows: RawCell[][] = trs.map((tr) => childrenWithTag(tr, 'w:tc').map((tc) => readRawCell(tc, ctx, carryDeletions)));
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

// --- the block flow walk, and the construct extents it discovers along the way ---------------------------------------

interface SectionBreak {
  readonly index: number;
  readonly sectPr: XmlElement;
}

// A bookmark's two halves are id-paired rather than nested, so neither half can be turned into a marker until both have been seen and both have been shown to sit at a block boundary: `index` is the block position the half sits at, and `qualified` records whether it sat outside every content-bearing child of its paragraph (or at block level, where it always does). See resolveBookmarkExtents for the pairing itself.
interface BookmarkEvent {
  readonly id: string;
  readonly name: string | undefined;
  readonly kind: 'start' | 'end';
  readonly index: number;
  readonly qualified: boolean;
  readonly order: number;
}

// A complex field opened by a w:fldChar begin and still waiting for its matching end, which may be several paragraphs away (a TOC field's begin sits in its first entry's paragraph and its end in a paragraph of its own after the last).
interface OpenField {
  instruction: string;
  inCode: boolean;
  readonly startIndex: number;
  readonly qualifiedStart: boolean;
  readonly order: number;
}

interface FlowState {
  readonly blocks: ContentBlock[];
  readonly extents: ConstructExtent[];
  readonly sectionBreaks: SectionBreak[];
  readonly bookmarkEvents: BookmarkEvent[];
  readonly openFields: OpenField[];
  order: number;
}

function newFlowState(): FlowState {
  return { blocks: [], extents: [], sectionBreaks: [], bookmarkEvents: [], openFields: [], order: 0 };
}

// Pairs the flow's bookmark halves by w:id into extents. A bookmark survives only when it has exactly one start and one end in this block list, both carry a name and sit at a block boundary, and the end does not precede the start. Everything else -- a half whose partner lies in a different block list (inside a table cell, or on the far side of a structured document tag), a duplicate id, a bookmark whose extent is a sub-sequence of one paragraph's runs -- has no block-scoped encoding and is not emitted.
function resolveBookmarkExtents(events: readonly BookmarkEvent[]): ConstructExtent[] {
  const byId = new Map<string, BookmarkEvent[]>();
  for (const event of events) {
    const existing = byId.get(event.id);
    if (existing === undefined) {
      byId.set(event.id, [event]);
    } else {
      existing.push(event);
    }
  }
  const extents: ConstructExtent[] = [];
  for (const halves of byId.values()) {
    const start = halves.filter((half) => half.kind === 'start');
    const end = halves.filter((half) => half.kind === 'end');
    const open = start[0];
    const close = end[0];
    if (start.length !== 1 || end.length !== 1 || open === undefined || close === undefined) {
      continue;
    }
    if (open.name === undefined || !open.qualified || !close.qualified || close.index < open.index) {
      continue;
    }
    extents.push({ startIndex: open.index, endIndex: close.index, order: open.order, descriptor: bookmarkAnchorDescriptor(open.name) });
  }
  return extents;
}

// A paragraph whose every content-bearing child is the same tracked-change element -- Word's own spelling of a wholly inserted, deleted, or moved paragraph, which puts the change inside the paragraph rather than wrapping it. The extent is the whole paragraph, so this is block-scoped; a paragraph mixing tracked and untracked children is a run-level change with no encoding here. Author and date come from the first such element: a paragraph split across several same-tag elements by different authors carries only the first, since the descriptor names one author.
function wholeParagraphTrackedChange(index: ParagraphContentIndex): { element: XmlElement; change: ProvenanceChange } | undefined {
  const content = contentBearingChildren(index);
  const first = content[0];
  if (first === undefined) {
    return undefined;
  }
  const change = PROVENANCE_CHANGE_BY_TAG.get(first.tag);
  if (change === undefined || !content.every((child) => child.tag === first.tag)) {
    return undefined;
  }
  return { element: first, change };
}

// A bookmark half inside a paragraph brackets whole blocks only when it sits outside every content-bearing child: a leading half opens (or closes) at the paragraph itself, a trailing one at the position after the paragraph's last block. A half between content children marks a sub-sequence of runs and is recorded as unqualified so resolveBookmarkExtents drops the whole pair rather than emitting a marker at the wrong place.
function recordParagraphBookmarks(index: ParagraphContentIndex, paragraphIndex: number, endIndex: number, state: FlowState): void {
  index.elements.forEach((element, position) => {
    if (element.tag !== 'w:bookmarkStart' && element.tag !== 'w:bookmarkEnd') {
      return;
    }
    const id = attr(element, 'w:id');
    if (id === undefined) {
      return;
    }
    const leading = index.firstContentIndex === -1 || position < index.firstContentIndex;
    const trailing = index.lastContentIndex === -1 || position > index.lastContentIndex;
    if (element.tag === 'w:bookmarkStart') {
      const name = attr(element, 'w:name');
      state.bookmarkEvents.push({
        id,
        name: name === undefined ? undefined : decodeEntities(name),
        kind: 'start',
        index: leading ? paragraphIndex : endIndex,
        qualified: leading || trailing,
        order: state.order++,
      });
      return;
    }
    state.bookmarkEvents.push({ id, name: undefined, kind: 'end', index: trailing ? endIndex : paragraphIndex, qualified: leading || trailing, order: state.order++ });
  });
}

// A field is block-scoped when its opening w:fldChar begin is the paragraph's first content-bearing child and its closing w:fldChar end is the last content-bearing child of whichever paragraph closes it -- the multi-paragraph TOC shape, and the single-paragraph case where the field is the paragraph's entire content. A w:fldSimple is block-scoped on the same test: it must be its paragraph's only content-bearing child. A field beginning or ending mid-paragraph ("Page 3 of 10", a cross-reference inside a sentence) covers a sub-sequence of runs and has no encoding here; its cached result text still reaches the output as ordinary run text, exactly as before, so only the field-ness and the instruction are lost.
//
// The field's cached result is deliberately never spelled on the descriptor: FieldDescriptor.cachedResult is for a field whose result is a scalar, and a block-scoped field's result is the block content its extent already wraps -- document-schema.js states the two are the block and the scalar case of one fact, never two encodings of the same one.
function scanParagraphFields(index: ParagraphContentIndex, paragraphIndex: number, endIndex: number, state: FlowState): void {
  const content = contentBearingChildren(index);
  content.forEach((child, position) => {
    if (child.tag === 'w:fldSimple') {
      if (content.length === 1) {
        state.extents.push({ startIndex: paragraphIndex, endIndex, order: state.order++, descriptor: { kind: 'field', instruction: decodeEntities(attr(child, 'w:instr') ?? '') } });
      }
      return;
    }
    if (child.tag !== 'w:r') {
      return;
    }
    const type = fieldCharType(child);
    if (type === 'begin') {
      state.openFields.push({ instruction: '', inCode: true, startIndex: paragraphIndex, qualifiedStart: position === 0, order: state.order++ });
      return;
    }
    if (type === 'separate') {
      const open = state.openFields[state.openFields.length - 1];
      if (open !== undefined) {
        open.inCode = false;
      }
      return;
    }
    if (type === 'end') {
      const open = state.openFields.pop();
      if (open !== undefined && open.qualifiedStart && position === content.length - 1) {
        state.extents.push({ startIndex: open.startIndex, endIndex, order: open.order, descriptor: { kind: 'field', instruction: open.instruction } });
      }
      return;
    }
    const open = state.openFields[state.openFields.length - 1];
    if (open?.inCode === true) {
      open.instruction += runInstructionText(child);
    }
  });
}

function collectParagraph(paragraph: XmlElement, ctx: DocxReadContext, state: FlowState, carryDeletions: boolean): void {
  const index = indexParagraphContent(paragraph);
  const tracked = wholeParagraphTrackedChange(index);
  const paragraphDeleted = carryDeletions || (tracked !== undefined && isDeletedChange(tracked.change));

  if (hasPageBreakBefore(paragraph)) {
    state.blocks.push({ kind: 'pageBreak' });
  }
  // The pageBreak block above sits outside every extent recorded here: it is the paragraph's own w:pageBreakBefore rendered as a preceding block, not part of any construct that brackets the paragraph.
  const paragraphIndex = state.blocks.length;
  state.blocks.push(readParagraph(paragraph, ctx, paragraphDeleted));
  state.blocks.push(...readParagraphLiftedBlocks(paragraph, ctx, paragraphDeleted));
  const endIndex = state.blocks.length;

  if (tracked !== undefined) {
    state.extents.push({ startIndex: paragraphIndex, endIndex, order: state.order++, descriptor: readProvenanceDescriptor(tracked.element, tracked.change) });
  }
  recordParagraphBookmarks(index, paragraphIndex, endIndex, state);
  scanParagraphFields(index, paragraphIndex, endIndex, state);

  const pPr = childrenWithTag(paragraph, 'w:pPr')[0];
  const sectPr = pPr === undefined ? undefined : childrenWithTag(pPr, 'w:sectPr')[0];
  if (sectPr !== undefined) {
    state.sectionBreaks.push({ index: state.blocks.length, sectPr });
  }
}

// Walks block-level content (w:p, w:tbl) into one flat block list plus the construct extents bracketing it. A structured document tag (w:sdt), a tracked change (w:ins/w:del/w:moveFrom/w:moveTo), and mc:AlternateContent (Fallback preferred, else the first Choice) all recurse into the SAME list rather than starting a nested one: the first two become construct extents over the blocks they contributed, and alternate content is unwrapped as before, since a taken branch is content rather than a construct. Any w:drawing or w:object found inside a paragraph is surfaced as a sibling ContentImageBlock/ContentEmbeddedObjectBlock immediately following that paragraph's own block -- see readParagraphLiftedBlocks.
function collectFlowNodes(nodes: readonly XmlNode[], ctx: DocxReadContext, state: FlowState, carryDeletions: boolean): void {
  for (const node of nodes) {
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'w:p') {
      collectParagraph(node, ctx, state, carryDeletions);
      continue;
    }
    if (node.tag === 'w:tbl') {
      state.blocks.push(readTable(node, ctx, carryDeletions));
      continue;
    }
    if (node.tag === 'w:sdt') {
      const order = state.order++;
      const startIndex = state.blocks.length;
      const sdtContent = childrenWithTag(node, 'w:sdtContent')[0];
      if (sdtContent !== undefined) {
        collectFlowNodes(sdtContent.children, ctx, state, carryDeletions);
      }
      state.extents.push({ startIndex, endIndex: state.blocks.length, order, descriptor: readContentControlDescriptor(node) });
      continue;
    }
    const change = PROVENANCE_CHANGE_BY_TAG.get(node.tag);
    if (change !== undefined) {
      const order = state.order++;
      const startIndex = state.blocks.length;
      collectFlowNodes(node.children, ctx, state, carryDeletions || isDeletedChange(change));
      state.extents.push({ startIndex, endIndex: state.blocks.length, order, descriptor: readProvenanceDescriptor(node, change) });
      continue;
    }
    if (node.tag === 'mc:AlternateContent') {
      const target = childrenWithTag(node, 'mc:Fallback')[0] ?? childrenWithTag(node, 'mc:Choice')[0];
      if (target !== undefined) {
        collectFlowNodes(target.children, ctx, state, carryDeletions);
      }
      continue;
    }
    if (node.tag === 'w:bookmarkStart') {
      const id = attr(node, 'w:id');
      const name = attr(node, 'w:name');
      if (id !== undefined) {
        state.bookmarkEvents.push({ id, name: name === undefined ? undefined : decodeEntities(name), kind: 'start', index: state.blocks.length, qualified: true, order: state.order++ });
      }
      continue;
    }
    if (node.tag === 'w:bookmarkEnd') {
      const id = attr(node, 'w:id');
      if (id !== undefined) {
        state.bookmarkEvents.push({ id, name: undefined, kind: 'end', index: state.blocks.length, qualified: true, order: state.order++ });
      }
      continue;
    }
    if (node.tag === 'w:sectPr') {
      state.sectionBreaks.push({ index: state.blocks.length, sectPr: node });
    }
  }
}

// One self-contained bracket scope: a table cell's own content, or a header/footer's, walked and closed with its markers spliced in. The document body is not read through this -- see readSections, which splits one walk across several sections.
function readBlockScope(nodes: readonly XmlNode[], ctx: DocxReadContext, carryDeletions: boolean): ContentBlock[] {
  const state = newFlowState();
  collectFlowNodes(nodes, ctx, state, carryDeletions);
  return insertConstructMarkers(state.blocks, [...state.extents, ...resolveBookmarkExtents(state.bookmarkEvents)]);
}

// A mid-document section break is an otherwise-ordinary w:p whose w:pPr carries its own w:sectPr, describing the section that paragraph (and everything since the previous break) belongs to; the body's own trailing w:sectPr (a direct child, not nested in any paragraph) closes the final section. Multi-section support falls out of this directly: the body is walked once, and each break just cuts the resulting block list.
//
// Every section's blocks are their own bracket scope, so an extent straddling a section break is dropped rather than being split into two half-constructs -- the same not-representable case as a run-level extent, and the reason the split happens after the walk rather than during it (a construct's own two ends are only known once both have been seen).
function readSections(body: XmlElement, ctx: DocxReadContext): ContentSection[] {
  const state = newFlowState();
  collectFlowNodes(body.children, ctx, state, false);
  const extents = [...state.extents, ...resolveBookmarkExtents(state.bookmarkEvents)];

  function sliceSection(pageSize: PageSize, margins: Margins, from: number, to: number): ContentSection {
    const contained = extents
      .filter((extent) => extent.startIndex >= from && extent.endIndex <= to)
      .map((extent) => ({ ...extent, startIndex: extent.startIndex - from, endIndex: extent.endIndex - from }));
    return { pageSize, margins, blocks: insertConstructMarkers(state.blocks.slice(from, to), contained) };
  }

  const sections: ContentSection[] = [];
  let from = 0;
  for (const sectionBreak of state.sectionBreaks) {
    sections.push(sliceSection(readPageSize(sectionBreak.sectPr), readMargins(sectionBreak.sectPr), from, sectionBreak.index));
    from = sectionBreak.index;
  }
  if (from < state.blocks.length || sections.length === 0) {
    sections.push(sliceSection(PAGE_SIZE_LETTER, DEFAULT_MARGINS, from, state.blocks.length));
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

// Resolves a generic OOXML Package into DocxDocument: the WordprocessingML style cascade, DrawingML theme resolution (including w:themeColor run-colour references, resolved against the theme's own colour scheme), ordered sections of paragraphs/tables/page-breaks/images (document order preserved, including inside tables, with cell background AND border styling read from w:tcBorders), the block-scoped fidelity constructs (structured document tags, fields, bookmarks, tracked changes) as constructStart/constructEnd marker pairs, plus comments, footnotes, header/footer text, and word/numbering.xml's own abstractNum/num level definitions (numbering.ts's readNumberingDefinitions). An inline (wp:inline) or floating/anchored (wp:anchor) w:drawing is resolved to a real ContentImageBlock via the containing part's own relationships, sniffed from its actual media-part bytes rather than trusted from any extension/content-type -- but a floating image's own wp:anchor position (page/margin/paragraph-relative offset) is never read, since ContentImageBlock has no absolute positioning field to record it in; it lands in the block flow at the point its w:drawing was encountered, same as an inline image. A w:object/o:OLEObject whose payload part is itself a ZIP archive (a modern producer's embedded xlsx/docx/pptx) is decoded through the shared embedded-object helper (typed/embedded.ts) into a sibling ContentEmbeddedObjectBlock sized from w:dxaOrig/w:dyaOrig and lifted through the same convention as an image block; a payload that does not decode as one of the three OOXML flavours degrades to no embedded block rather than failing the read.
//
// Information not modelled here is still dropped: section break types other than plain w:sectPr (ContentSection itself has no field to record w:type's nextPage/continuous/evenPage/oddPage distinction); live PAGE/NUMPAGES field re-evaluation; w:themeShade/w:themeTint refinement of a resolved theme colour; a floating image's own anchored position; any image whose bytes don't sniff as PNG/JPEG; a w:object's VML preview picture (v:imagedata -- no VML reader exists here, and real producers ship WMF/EMF previews anyway); the classic non-ZIP OLE compound-file payload (.bin -- opaque external-application data, left skipped exactly as unhandled markup) and a ZIP payload that does not decode as one of the three OOXML flavours (both degrade to no embedded block, never a failed read); and every run-level construct occurrence -- a field, bookmark, content control, or tracked change covering a sub-sequence of one paragraph's runs rather than whole blocks (see typed/docx/constructs.ts for why, and typed/docx/write.ts for the write side of what does survive).
export function readDocxContent(pkg: Package): DocxDocument {
  const documentRoot = rootElement(pkg.parts[DOCUMENT_PART_PATH]);
  if (documentRoot === undefined) {
    throw new Error(`readDocxContent: package has no ${DOCUMENT_PART_PATH} part`);
  }
  const body = childrenWithTag(documentRoot, 'w:body')[0];
  if (body === undefined) {
    throw new Error(`readDocxContent: ${DOCUMENT_PART_PATH} has no w:body element`);
  }

  const docRels = resolveRelationships(pkg, DOCUMENT_PART_PATH);
  const ctx: DocxReadContext = {
    styles: { stylesRoot: rootElement(pkg.parts[STYLES_PART_PATH]), theme: readDocumentTheme(pkg, docRels) },
    rels: docRels,
    pkg,
  };

  return {
    metadata: readCoreProperties(pkg),
    sections: readSections(body, ctx),
    comments: readComments(pkg),
    footnotes: readFootnotes(pkg),
    headers: readHeaderFooterText(pkg, 'word/header'),
    footers: readHeaderFooterText(pkg, 'word/footer'),
    numbering: readNumberingDefinitions(pkg),
  };
}
