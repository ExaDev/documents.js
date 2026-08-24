import { z } from 'zod';
import type { Package } from '../../model/package';
import type { XmlElement, XmlNode } from '../../model/node';
import type { AnchorDescriptor, Color, ConstructDescriptor, ContentBlock, ContentBorder, ContentCellBorders, ContentControlDescriptor, ContentEmbeddedObjectBlock, ContentImageBlock, ContentListMembership, ContentParagraph, ContentRun, ContentSection, ContentStrokeStyle, ContentTable, ContentTableCell, Margins, PageSize, ProvenanceChange, RunConstructExtent } from 'document-schema.js';
import { COLOR_BLACK, ContentBlockSchema, ContentSectionSchema, PAGE_SIZE_LETTER, clampHeadingLevel, rgbHexToColor } from 'document-schema.js';
import { DocumentMetadataSchema, readCoreProperties } from '../shared/metadata';
import { readEmbeddedPayloadPart } from '../embedded';
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
import type { ConstructExtent, ParagraphContentIndex, ParagraphRangeMarkerHalf, RangeMarkerFamily } from './constructs';
import {
  PROVENANCE_CHANGE_BY_TAG,
  bookmarkAnchorDescriptor,
  contentBearingChildren,
  fieldCharType,
  indexParagraphContent,
  insertConstructMarkers,
  isDeletedChange,
  readContentControlDescriptor,
  readFormControlDescriptor,
  readProvenanceDescriptor,
  runInstructionText,
  runRangeMarkerExtents,
} from './constructs';

// Package -> DocxDocument. Walks word/document.xml directly, resolving the full style cascade (docDefaults -> named-style basedOn chains -> paragraph-mark run properties -> character styles -> direct formatting) and DrawingML theme references for each run, so document order, styling, and geometry are all preserved -- unlike a naive reader that flattens paragraphs/tables into separate arrays with no shared ordering. Headers/footers are read as the structural model alone: headerFooterParts carries each word/header*/word/footer* part as block flow walked by the same machinery as the body (referenced or not), and sectionHeaderFooters names which section references which part at which of the default/first/even slots. Live PAGE/NUMPAGES field substitution is not implemented -- fields resolve to their cached result text (Word already computed it), which is correct for every field except one whose value would change under a different pagination this reader doesn't perform. Ported from documents.js's src/ooxml/docx/read.ts (the section/style-cascade walk) merged with this package's own prior comment/footnote/header/footer reading.
//
// This is the flat, content-level half of the docx read pair: readDocx (typed/document-tree.ts) wraps it into a tree-form DocumentTree, which is the primary name and the shape a caller holding a whole document wants. Reach for this one when you need what the tree has no spelling for -- the comments, footnotes, header/footer parts, and numbering definitions DocxDocument carries outside `sections` -- or when driving a pipeline that already works in flat ContentSection[].
//
// Block-scoped fidelity constructs (structured document tags, complex and simple fields, bookmarks, tracked insertions/deletions/moves) are read into document-schema.js's constructStart/constructEnd marker pairs bracketing the blocks they span, and a construct covering a sub-sequence of one paragraph's runs is read onto that paragraph's own run-level constructs field (ContentParagraph.constructs): a mid-paragraph bookmark or comment extent (id-paired halves), a mid-paragraph complex or simple field (whose cached result still reaches the output as ordinary run text, exactly as before -- only the field-ness used to be lost), an internal @w:anchor hyperlink, and a footnote/endnote/comment reference mark. A legacy w:ffData form field reads as a contentControl at whichever scope its field sits at, with the whole w:ffData element quarantined verbatim in the descriptor's residue. See typed/docx/constructs.ts for the descriptor shapes and the scope rules that decide which real-world occurrences are representable and which are not.

export const CommentSchema = z.object({
  id: z.string().optional(), // w:comment/@w:id -- the key a comment extent's own name joins this body back through (see the run-level anchor extents)
  author: z.string().optional(),
  text: z.string(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const FootnoteSchema = z.object({
  id: z.string().optional(), // w:footnote/@w:id (or w:endnote/@w:id) -- the key a note reference's own name joins this body back through
  type: z.string().optional(),
  text: z.string(),
});
export type Footnote = z.infer<typeof FootnoteSchema>;

// One header/footer part read as content rather than as concatenated text: the part's own body walked by the same block machinery as the document body (its own construct-marker bracket scope, its own relationships for images), plus the part's own path -- the identity a section reference names.
export const HeaderFooterPartSchema = z.object({
  path: z.string(),
  kind: z.enum(['header', 'footer']),
  blocks: z.array(ContentBlockSchema),
});
export type HeaderFooterPart = z.infer<typeof HeaderFooterPartSchema>;

// The reference slots a w:sectPr spells: which header/footer part each of the default, first-page, and even-page slots uses, named by part path. Word's own inheritance rule -- a section with no reference for a slot reuses the previous section's -- is a consumer concern, recorded here exactly as spelled; the evenAndOddHeaders setting in word/settings.xml that gates whether Word renders the even slot at all is not read.
export const SectionHeaderFooterReferencesSchema = z.object({
  header: z.partialRecord(z.enum(['default', 'first', 'even']), z.string()).optional(),
  footer: z.partialRecord(z.enum(['default', 'first', 'even']), z.string()).optional(),
});
export type SectionHeaderFooterReferences = z.infer<typeof SectionHeaderFooterReferencesSchema>;

export const DocxDocumentSchema = z.object({
  metadata: DocumentMetadataSchema,
  sections: z.array(ContentSectionSchema),
  comments: z.array(CommentSchema),
  footnotes: z.array(FootnoteSchema),
  endnotes: z.array(FootnoteSchema),
  // The structural view of the header/footer layer: each part as block flow (referenced or not), and per-section references (positional, one entry per `sections` entry) naming those parts by path.
  headerFooterParts: z.array(HeaderFooterPartSchema),
  sectionHeaderFooters: z.array(SectionHeaderFooterReferencesSchema),
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

// w:sectPr/w:type names how the section it closes BEGINS relative to the one before it. An absent or unrecognised @w:val leaves the field absent rather than storing WordprocessingML's own default (nextPage): the default is what every consumer already assumes, so only a spelled break kind carries information worth recording.
function readSectionBreakType(sectPr: XmlElement): ContentSection['breakType'] {
  const type = childrenWithTag(sectPr, 'w:type')[0];
  const val = type === undefined ? undefined : attr(type, 'w:val');
  return val === 'nextPage' || val === 'continuous' || val === 'evenPage' || val === 'oddPage' ? val : undefined;
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
  const widthPt = emuToPt(Number(cx));
  const heightPt = emuToPt(Number(cy));
  // Malformed geometry (a non-numeric EMU value) degrades to no image, the same tier readObjectEmbeddedObject applies below and every other numeric attribute reader here degrades on: a NaN widthPt would emit a block no geometry schema accepts, poisoning the whole section for downstream validators.
  if (!Number.isFinite(widthPt) || !Number.isFinite(heightPt)) {
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
  const image: ContentImageBlock = { kind: 'image', format, base64: mediaPart.base64, widthPt, heightPt };
  if (altText !== undefined) {
    image.altText = decodeEntities(altText);
  }
  return image;
}

// Resolves a w:object's OLE payload (o:OLEObject/@r:id -> document relationship -> embeddings part) through readEmbeddedPayloadPart: a ZIP payload (a modern producer's embedded xlsx/docx/pptx) and a classic compound-file .bin payload whose Package stream carries a ZIP both become the recovered sub-document's ContentEmbeddedObjectBlock, sized from w:object's own w:dxaOrig/w:dyaOrig (twips), while a compound file holding native legacy streams (no Package stream, or a packaged file that is not a ZIP) and a ZIP that does not decode as one of the three OOXML flavours both return undefined and are skipped, exactly as unhandled markup is -- second-order content degrades, it never fails the host read. Undefined follows the same convention as readDrawingImage: an id, relationship, or part that does not line up (including an externally-linked object, whose relationship target is a URI no part key matches) leaves the paragraph with no embedded block, never a partial one. The frame sits at the origin because an inline flow object has no absolute position to record -- ContentEmbeddedObjectBlock's frame is required, and 0/0 is the honest spelling of "positioned by the flow", the same narrowing readDrawingImage makes for wp:anchor.
function readObjectEmbeddedObject(object: XmlElement, ctx: DocxReadContext): ContentEmbeddedObjectBlock | undefined {
  const dxaOrig = attr(object, 'w:dxaOrig');
  const dyaOrig = attr(object, 'w:dyaOrig');
  if (dxaOrig === undefined || dyaOrig === undefined) {
    return undefined;
  }
  const widthPt = twipsToPt(Number(dxaOrig));
  const heightPt = twipsToPt(Number(dyaOrig));
  // Malformed geometry (a non-numeric ST_TwipsMeasure) degrades to no block, the same tier readDrawingImage above applies and readOutlineLevel's malformed @lvl is the family's own example of: a NaN widthPt would emit a block no geometry schema accepts, poisoning the whole section for downstream validators. Checked before any relationship resolution, so a doomed object never decodes its payload.
  if (!Number.isFinite(widthPt) || !Number.isFinite(heightPt)) {
    return undefined;
  }
  const oleObject = elementsWithTag([object], 'o:OLEObject')[0];
  const rId = oleObject === undefined ? undefined : attr(oleObject, 'r:id');
  const rel = rId === undefined ? undefined : ctx.rels.get(rId);
  const payloadPart = rel === undefined ? undefined : ctx.pkg.parts[rel.target];
  if (payloadPart?.kind !== 'binary') {
    return undefined;
  }
  const payload = readEmbeddedPayloadPart(payloadPart);
  return payload === undefined ? undefined : { kind: 'embeddedObject', objectKind: payload.objectKind, document: payload.document, frame: { xPt: 0, yPt: 0, widthPt, heightPt } };
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

// One complex field opened by a w:fldChar begin inside THIS paragraph's run walk and closed by an end the same walk reaches -- the mid-paragraph field shape. `beginElement`/`endElement` are kept so the extent assembly can ask the paragraph's content index whether the pair sits at block scope (the whole-paragraph shape the marker path already encodes, which must never gain a second encoding here). `formControl` holds the legacy w:ffData verdict when the begin run carries one -- a form field is a contentControl, not a field.
interface RunFieldEvent {
  readonly descriptor: ConstructDescriptor;
  readonly startRun: number;
  readonly endRun: number;
  readonly beginElement: XmlElement;
  readonly endElement: XmlElement;
}

// A w:fldSimple encountered mid-walk: the same shape as RunFieldEvent with one element playing both boundary roles.
interface RunSimpleFieldEvent {
  readonly descriptor: ConstructDescriptor;
  readonly startRun: number;
  readonly endRun: number;
  readonly element: XmlElement;
}

// A point anchor at one run boundary -- a footnote, endnote, or comment reference mark, whose body lives in a definitions part (word/footnotes.xml, word/endnotes.xml, word/comments.xml) the flat model carries beside its sections.
interface RunPointAnchorEvent {
  readonly descriptor: AnchorDescriptor;
  readonly runPosition: number;
}

// A link over a sub-sequence of this paragraph's runs whose target is a name inside this document (w:hyperlink/@w:anchor), which a flat run field cannot express.
interface RunLinkEvent {
  readonly anchor: string;
  readonly startRun: number;
  readonly endRun: number;
}

// Everything one paragraph's run walk collects beside its runs, assembled into ContentParagraph.constructs by assembleRunConstructs once the walk (and the paragraph's content index) exists.
interface ParagraphRunEvents {
  halves: ParagraphRangeMarkerHalf[];
  fields: RunFieldEvent[];
  simpleFields: RunSimpleFieldEvent[];
  pointAnchors: RunPointAnchorEvent[];
  links: RunLinkEvent[];
}

function newParagraphRunEvents(): ParagraphRunEvents {
  return { halves: [], fields: [], simpleFields: [], pointAnchors: [], links: [] };
}

// Walks a paragraph's own children producing its runs, tracking two things across siblings: complex-field state (w:fldChar begin/separate/end -- only the cached result between separate and end is visible content) and the enclosing hyperlink target (w:hyperlink, resolved via the document's relationships), threaded through w:ins/w:moveTo/w:sdt/w:fldSimple recursion. w:del and w:moveFrom are recursed into only when the caller is carrying deletions -- i.e. when the whole paragraph is itself a tracked deletion or move-from, so that every run it yields is labelled as deleted by the enclosing provenance construct. A mid-paragraph deletion stays excluded, because lifting those runs into the paragraph's own text would render deleted words as live text, which is strictly worse than the existing omission. Range-marker halves (bookmarks, comment extents) are recorded into `events.halves` at the run position the walk had reached -- the run-level counterpart of the block-index events recordParagraphRangeMarkers collects, paired into run-level construct extents by runRangeMarkerExtents (typed/docx/constructs.ts). A complex field or w:fldSimple whose extent is a sub-sequence of this paragraph's runs, an internal @w:anchor hyperlink, and a footnote/endnote/comment reference run each record their own event for the same assembly.
function readParagraphRuns(paragraph: XmlElement, ctx: DocxReadContext, carryDeletions: boolean, events: ParagraphRunEvents): ContentRun[] {
  const runs: ContentRun[] = [];
  let fieldState: 'none' | 'code' | 'result' = 'none';
  const openFields: { startRun: number; instruction: string; beginElement: XmlElement; formControl: ContentControlDescriptor | undefined }[] = [];

  const recordRangeMarkerHalf = (node: XmlElement, family: RangeMarkerFamily, start: boolean): void => {
    const id = attr(node, 'w:id');
    if (id === undefined) {
      return;
    }
    const name = attr(node, 'w:name');
    events.halves.push({
      element: node,
      family,
      id,
      name: start && family === 'bookmark' && name !== undefined ? decodeEntities(name) : undefined,
      kind: start ? 'start' : 'end',
      runPosition: runs.length,
    });
  };

  // A reference-mark run (footnote/endnote/comment) renders nothing itself, so the point anchor sits at the boundary before that run -- exactly where the mark renders.
  const recordReferenceAnchor = (run: XmlElement): void => {
    for (const child of run.children) {
      if (child.type !== 'element') {
        continue;
      }
      const anchorType = child.tag === 'w:footnoteReference' ? 'footnote' : child.tag === 'w:endnoteReference' ? 'endnote' : child.tag === 'w:commentReference' ? 'comment' : undefined;
      const id = anchorType === undefined ? undefined : attr(child, 'w:id');
      if (anchorType !== undefined && id !== undefined) {
        events.pointAnchors.push({ descriptor: { kind: 'anchor', anchorType, name: id }, runPosition: runs.length - 1 });
      }
    }
  };

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
            openFields.push({ startRun: runs.length, instruction: '', beginElement: node, formControl: readFormControlDescriptor(node) });
          } else if (type === 'separate') {
            fieldState = 'result';
          } else if (type === 'end') {
            fieldState = 'none';
            const open = openFields.pop();
            if (open !== undefined) {
              events.fields.push({
                descriptor: open.formControl ?? { kind: 'field', instruction: open.instruction },
                startRun: open.startRun,
                endRun: runs.length,
                beginElement: open.beginElement,
                endElement: node,
              });
            }
          }
          continue;
        }
        if (fieldState === 'code') {
          // The code runs belong to the field the walk is inside -- the innermost begin still open, exactly the field whose instruction this run spells.
          const open = openFields[openFields.length - 1];
          if (open !== undefined) {
            open.instruction += runInstructionText(node);
          }
          continue;
        }
        const run = readRun(node, paragraph, ctx.styles);
        runs.push(hyperlinkTarget === undefined ? run : { ...run, hyperlink: hyperlinkTarget });
        recordReferenceAnchor(node);
      } else if (node.tag === 'w:fldSimple') {
        const startRun = runs.length;
        walk(node.children, hyperlinkTarget);
        events.simpleFields.push({ descriptor: { kind: 'field', instruction: decodeEntities(attr(node, 'w:instr') ?? '') }, startRun, endRun: runs.length, element: node });
      } else if (node.tag === 'w:hyperlink') {
        const rId = attr(node, 'r:id');
        const target = rId === undefined ? undefined : ctx.rels.get(rId)?.target;
        if (target === undefined) {
          // No resolvable external target: an @w:anchor names a target inside this document, which is a link run extent rather than a run field. An r:id that resolves wins over an @w:anchor spelled beside it -- one link, one encoding, the resolved external target's.
          const anchor = attr(node, 'w:anchor');
          const startRun = runs.length;
          walk(node.children, hyperlinkTarget);
          if (anchor !== undefined && runs.length > startRun) {
            events.links.push({ anchor: decodeEntities(anchor), startRun, endRun: runs.length });
          }
          continue;
        }
        walk(node.children, target);
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
      } else if (node.tag === 'w:bookmarkStart' || node.tag === 'w:bookmarkEnd') {
        recordRangeMarkerHalf(node, 'bookmark', node.tag === 'w:bookmarkStart');
      } else if (node.tag === 'w:commentRangeStart' || node.tag === 'w:commentRangeEnd') {
        recordRangeMarkerHalf(node, 'comment', node.tag === 'w:commentRangeStart');
      }
    }
  }

  walk(paragraph.children, undefined);
  return runs;
}

// A complex field is block-scoped exactly when its begin run is the paragraph's first content-bearing child and its end run the last -- the whole-paragraph shape scanParagraphFields brackets as a marker pair, which this assembly must therefore not also encode as a run extent. A begin or end nested inside a container (w:hyperlink, w:ins) is never a direct child, so it cannot be block-scoped -- and scanParagraphFields, which walks only direct children, never saw it either: the two paths partition the occurrences between them by construction.
function isBlockScopedField(event: RunFieldEvent, index: ParagraphContentIndex): boolean {
  const begin = index.elements.indexOf(event.beginElement);
  const end = index.elements.indexOf(event.endElement);
  return begin !== -1 && end !== -1 && begin === index.firstContentIndex && end === index.lastContentIndex;
}

// A w:fldSimple is block-scoped when it is its paragraph's only content-bearing child -- scanParagraphFields' own test for the simple spelling.
function isBlockScopedSimpleField(event: RunSimpleFieldEvent, index: ParagraphContentIndex): boolean {
  const position = index.elements.indexOf(event.element);
  return position !== -1 && index.firstContentIndex === position && index.lastContentIndex === position;
}

// Assembles the run walk's collected events into the paragraph's constructs field: paired range markers (bookmarks, comment extents) first in discovery order, then the walk-order events (closed fields, simple fields, internal links, point anchors). Deterministic in the markup's own order, with the two families concatenated rather than interleaved -- ranges are data on the paragraph, never brackets, so no ordering between families is load-bearing.
function assembleRunConstructs(events: ParagraphRunEvents, index: ParagraphContentIndex): RunConstructExtent[] {
  const extents: RunConstructExtent[] = runRangeMarkerExtents(events.halves, index);
  for (const field of events.fields) {
    if (!isBlockScopedField(field, index)) {
      extents.push({ descriptor: field.descriptor, startRun: field.startRun, endRun: field.endRun });
    }
  }
  for (const simple of events.simpleFields) {
    if (!isBlockScopedSimpleField(simple, index)) {
      extents.push({ descriptor: simple.descriptor, startRun: simple.startRun, endRun: simple.endRun });
    }
  }
  for (const link of events.links) {
    extents.push({ descriptor: { kind: 'link', target: { kind: 'internal', anchor: link.anchor } }, startRun: link.startRun, endRun: link.endRun });
  }
  for (const anchor of events.pointAnchors) {
    extents.push({ descriptor: anchor.descriptor, startRun: anchor.runPosition, endRun: anchor.runPosition });
  }
  return extents;
}

function readParagraph(paragraph: XmlElement, ctx: DocxReadContext, carryDeletions: boolean): ContentParagraph {
  const pPr = childrenWithTag(paragraph, 'w:pPr')[0];
  const pStyleEl = pPr === undefined ? undefined : childrenWithTag(pPr, 'w:pStyle')[0];
  const props = resolveParagraphProperties(paragraph, ctx.styles);
  // The paragraph's own run-level construct extents: the run walk's events, paired and scope-filtered against the content index so a block-scoped occurrence stays on the marker path. Absent rather than empty when the paragraph carries none -- the common case costs nothing.
  const events = newParagraphRunEvents();
  const runs = readParagraphRuns(paragraph, ctx, carryDeletions, events);
  const constructs = assembleRunConstructs(events, indexParagraphContent(paragraph));
  return {
    kind: 'paragraph',
    runs,
    ...(constructs.length > 0 ? { constructs } : {}),
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

// A range marker's two halves (a bookmark's, a comment extent's) are id-paired rather than nested, so neither half can be turned into a marker until both have been seen and both have been shown to sit at a block boundary: `index` is the block position the half sits at, and `qualified` records whether it sat outside every content-bearing child of its paragraph (or at block level, where it always does). See resolveRangeMarkerExtents for the pairing itself.
interface RangeMarkerEvent {
  readonly family: RangeMarkerFamily;
  readonly id: string;
  readonly name: string | undefined;
  readonly kind: 'start' | 'end';
  readonly index: number;
  readonly qualified: boolean;
  readonly order: number;
}

// A complex field opened by a w:fldChar begin and still waiting for its matching end, which may be several paragraphs away (a TOC field's begin sits in its first entry's paragraph and its end in a paragraph of its own after the last). `formControl` holds the legacy w:ffData verdict when the begin run carries one: a form field is ONE construct (a contentControl), so its block extent takes the control descriptor rather than a field descriptor beside it.
interface OpenField {
  instruction: string;
  inCode: boolean;
  readonly startIndex: number;
  readonly qualifiedStart: boolean;
  readonly order: number;
  readonly formControl: ContentControlDescriptor | undefined;
}

interface FlowState {
  readonly blocks: ContentBlock[];
  readonly extents: ConstructExtent[];
  readonly sectionBreaks: SectionBreak[];
  readonly rangeMarkerEvents: RangeMarkerEvent[];
  readonly openFields: OpenField[];
  order: number;
}

function newFlowState(): FlowState {
  return { blocks: [], extents: [], sectionBreaks: [], rangeMarkerEvents: [], openFields: [], order: 0 };
}

// Pairs the flow's range-marker halves (bookmarks, comment extents) by family+w:id into extents. A pair survives only when it has exactly one start and one end in this block list, both sit at a block boundary (and, for a bookmark, the start carries a name), and the end does not precede the start. Everything else -- a half whose partner lies in a different block list (inside a table cell, or on the far side of a structured document tag), a duplicate id, a pair whose extent is a sub-sequence of one paragraph's runs -- has no block-scoped encoding and is not emitted as a marker pair; the run-level case lands on the paragraph's own constructs field instead (runRangeMarkerExtents, called from readParagraph), and the rest stay dropped.
function resolveRangeMarkerExtents(events: readonly RangeMarkerEvent[]): ConstructExtent[] {
  const byId = new Map<string, RangeMarkerEvent[]>();
  for (const event of events) {
    const key = `${event.family}:${event.id}`;
    const existing = byId.get(key);
    if (existing === undefined) {
      byId.set(key, [event]);
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
    const descriptor: AnchorDescriptor | undefined =
      open.family === 'comment'
        ? { kind: 'anchor', anchorType: 'comment', name: open.id }
        : open.name === undefined
          ? undefined
          : bookmarkAnchorDescriptor(open.name);
    if (descriptor === undefined || !open.qualified || !close.qualified || close.index < open.index) {
      continue;
    }
    extents.push({ startIndex: open.index, endIndex: close.index, order: open.order, descriptor });
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

// A range-marker half inside a paragraph brackets whole blocks only when it sits outside every content-bearing child: a leading half opens (or closes) at the paragraph itself, a trailing one at the position after the paragraph's last block. A half between content children marks a sub-sequence of runs and is recorded as unqualified so resolveRangeMarkerExtents drops the whole pair rather than emitting a marker at the wrong place -- dropping it from the BLOCK stream is not losing it when both halves sit in one paragraph, because runRangeMarkerExtents picks the pair up onto that paragraph's constructs field.
function recordParagraphRangeMarkers(index: ParagraphContentIndex, paragraphIndex: number, endIndex: number, state: FlowState): void {
  index.elements.forEach((element, position) => {
    if (element.tag !== 'w:bookmarkStart' && element.tag !== 'w:bookmarkEnd' && element.tag !== 'w:commentRangeStart' && element.tag !== 'w:commentRangeEnd') {
      return;
    }
    const id = attr(element, 'w:id');
    if (id === undefined) {
      return;
    }
    const family: RangeMarkerFamily = element.tag === 'w:bookmarkStart' || element.tag === 'w:bookmarkEnd' ? 'bookmark' : 'comment';
    const start = element.tag === 'w:bookmarkStart' || element.tag === 'w:commentRangeStart';
    const leading = index.firstContentIndex === -1 || position < index.firstContentIndex;
    const trailing = index.lastContentIndex === -1 || position > index.lastContentIndex;
    if (start) {
      const name = attr(element, 'w:name');
      state.rangeMarkerEvents.push({
        family,
        id,
        name: family === 'bookmark' && name !== undefined ? decodeEntities(name) : undefined,
        kind: 'start',
        index: leading ? paragraphIndex : endIndex,
        qualified: leading || trailing,
        order: state.order++,
      });
      return;
    }
    state.rangeMarkerEvents.push({ family, id, name: undefined, kind: 'end', index: trailing ? endIndex : paragraphIndex, qualified: leading || trailing, order: state.order++ });
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
      state.openFields.push({ instruction: '', inCode: true, startIndex: paragraphIndex, qualifiedStart: position === 0, order: state.order++, formControl: readFormControlDescriptor(child) });
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
        state.extents.push({ startIndex: open.startIndex, endIndex, order: open.order, descriptor: open.formControl ?? { kind: 'field', instruction: open.instruction } });
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
  recordParagraphRangeMarkers(index, paragraphIndex, endIndex, state);
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
    if (node.tag === 'w:bookmarkStart' || node.tag === 'w:commentRangeStart') {
      const id = attr(node, 'w:id');
      const name = attr(node, 'w:name');
      if (id !== undefined) {
        state.rangeMarkerEvents.push({
          family: node.tag === 'w:bookmarkStart' ? 'bookmark' : 'comment',
          id,
          name: node.tag === 'w:bookmarkStart' && name !== undefined ? decodeEntities(name) : undefined,
          kind: 'start',
          index: state.blocks.length,
          qualified: true,
          order: state.order++,
        });
      }
      continue;
    }
    if (node.tag === 'w:bookmarkEnd' || node.tag === 'w:commentRangeEnd') {
      const id = attr(node, 'w:id');
      if (id !== undefined) {
        state.rangeMarkerEvents.push({ family: node.tag === 'w:bookmarkEnd' ? 'bookmark' : 'comment', id, name: undefined, kind: 'end', index: state.blocks.length, qualified: true, order: state.order++ });
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
  return insertConstructMarkers(state.blocks, [...state.extents, ...resolveRangeMarkerExtents(state.rangeMarkerEvents)]);
}

// A mid-document section break is an otherwise-ordinary w:p whose w:pPr carries its own w:sectPr, describing the section that paragraph (and everything since the previous break) belongs to; the body's own trailing w:sectPr (a direct child, not nested in any paragraph) closes the final section. Multi-section support falls out of this directly: the body is walked once, and each break just cuts the resulting block list.
//
// Every section's blocks are their own bracket scope, so an extent straddling a section break is dropped rather than being split into two half-constructs -- one of the not-representable cases document-schema.js's extent-scope note ratifies (cross-list pairing is ids, and the marker contract refuses ids), and the reason the split happens after the walk rather than during it (a construct's own two ends are only known once both have been seen).
// One section's own header/footer references, read from its w:sectPr exactly as spelled: each w:headerReference/w:footerReference names a part through the document's own relationships and a slot (default/first/even). A reference whose r:id resolves to no relationship is left out rather than recorded against a target that does not exist.
function readSectionHeaderFooters(sectPr: XmlElement, ctx: DocxReadContext): SectionHeaderFooterReferences {
  const references: SectionHeaderFooterReferences = {};
  for (const tag of ['w:headerReference', 'w:footerReference'] as const) {
    const slot: Partial<Record<'default' | 'first' | 'even', string>> = {};
    for (const reference of childrenWithTag(sectPr, tag)) {
      const type = attr(reference, 'w:type');
      const rId = attr(reference, 'r:id');
      const target = rId === undefined ? undefined : ctx.rels.get(rId)?.target;
      if ((type === 'default' || type === 'first' || type === 'even') && target !== undefined) {
        slot[type] = target;
      }
    }
    if (Object.keys(slot).length > 0) {
      references[tag === 'w:headerReference' ? 'header' : 'footer'] = slot;
    }
  }
  return references;
}

// Each header/footer part as block flow: the part's own body walked by the same collectFlowNodes machinery the document body uses, against the part's OWN relationships (an image inside a header resolves through the header part's rels, not the document's) while sharing the document's style/theme cascade. Every part matching the word/header*/word/footer* path shape is walked, referenced or not -- sectionHeaderFooters carries the reference side, so an orphaned part still surfaces here rather than nowhere. Parts are listed in sorted package-key order, one entry per part.
function readHeaderFooterParts(pkg: Package, ctx: DocxReadContext): HeaderFooterPart[] {
  const parts: HeaderFooterPart[] = [];
  const paths = Object.keys(pkg.parts)
    .filter((path) => (path.startsWith('word/header') || path.startsWith('word/footer')) && path.endsWith('.xml'))
    .sort();
  for (const path of paths) {
    const root = rootElement(pkg.parts[path]);
    if (root === undefined) {
      continue;
    }
    const kind = root.tag === 'w:ftr' ? 'footer' : 'header';
    const partCtx: DocxReadContext = { styles: ctx.styles, rels: resolveRelationships(pkg, path), pkg };
    parts.push({ path, kind, blocks: readBlockScope(root.children, partCtx, false) });
  }
  return parts;
}

function readSections(body: XmlElement, ctx: DocxReadContext): { sections: ContentSection[]; headerFooters: SectionHeaderFooterReferences[] } {
  const state = newFlowState();
  collectFlowNodes(body.children, ctx, state, false);
  const extents = [...state.extents, ...resolveRangeMarkerExtents(state.rangeMarkerEvents)];

  function sliceSection(pageSize: PageSize, margins: Margins, breakType: ContentSection['breakType'], from: number, to: number): ContentSection {
    const contained = extents
      .filter((extent) => extent.startIndex >= from && extent.endIndex <= to)
      .map((extent) => ({ ...extent, startIndex: extent.startIndex - from, endIndex: extent.endIndex - from }));
    return { pageSize, margins, ...(breakType === undefined ? {} : { breakType }), blocks: insertConstructMarkers(state.blocks.slice(from, to), contained) };
  }

  const sections: ContentSection[] = [];
  const headerFooters: SectionHeaderFooterReferences[] = [];
  let from = 0;
  for (const sectionBreak of state.sectionBreaks) {
    sections.push(sliceSection(readPageSize(sectionBreak.sectPr), readMargins(sectionBreak.sectPr), readSectionBreakType(sectionBreak.sectPr), from, sectionBreak.index));
    headerFooters.push(readSectionHeaderFooters(sectionBreak.sectPr, ctx));
    from = sectionBreak.index;
  }
  if (from < state.blocks.length || sections.length === 0) {
    sections.push(sliceSection(PAGE_SIZE_LETTER, DEFAULT_MARGINS, undefined, from, state.blocks.length));
    headerFooters.push({});
  }
  sections.forEach((section, sectionIndex) => { assignSourcePaths(section.blocks, `sections[${sectionIndex}]`); });
  return { sections, headerFooters };
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
  const id = attr(comment, 'w:id');
  const author = attr(comment, 'w:author');
  const text = elementsWithTag(comment.children, 'w:t').map(textContent).join('');
  const result: Comment = { text };
  if (id !== undefined) {
    result.id = id;
  }
  if (author !== undefined) {
    result.author = author;
  }
  return result;
}

function readFootnote(footnote: XmlElement): Footnote {
  const id = attr(footnote, 'w:id');
  const type = attr(footnote, 'w:type');
  const text = elementsWithTag(footnote.children, 'w:t').map(textContent).join('');
  const result: Footnote = { text };
  if (id !== undefined) {
    result.id = id;
  }
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

// One walk for both note flavours: word/footnotes.xml and word/endnotes.xml share the identical shape (a container of w:footnote/w:endnote elements, each with its own w:id and the separator/continuationSeparator machinery types skipped), so endnotes are the same read against their own part.
function readNotesPart(pkg: Package, path: string, noteTag: 'w:footnote' | 'w:endnote'): Footnote[] {
  const root = rootElement(pkg.parts[path]);
  if (root === undefined) {
    return [];
  }
  const out: Footnote[] = [];
  for (const note of childrenWithTag(root, noteTag)) {
    const type = attr(note, 'w:type');
    if (type === 'separator' || type === 'continuationSeparator') {
      continue;
    }
    out.push(readFootnote(note));
  }
  return out;
}

// Resolves a generic OOXML Package into DocxDocument: the WordprocessingML style cascade, DrawingML theme resolution (including w:themeColor run-colour references, resolved against the theme's own colour scheme), ordered sections of paragraphs/tables/page-breaks/images (document order preserved, including inside tables, with cell background AND border styling read from w:tcBorders), the block-scoped fidelity constructs (structured document tags, fields, bookmarks, tracked changes) as constructStart/constructEnd marker pairs, plus comments, footnotes, header/footer parts, and word/numbering.xml's own abstractNum/num level definitions (numbering.ts's readNumberingDefinitions). An inline (wp:inline) or floating/anchored (wp:anchor) w:drawing is resolved to a real ContentImageBlock via the containing part's own relationships, sniffed from its actual media-part bytes rather than trusted from any extension/content-type -- but a floating image's own wp:anchor position (page/margin/paragraph-relative offset) is never read, since ContentImageBlock has no absolute positioning field to record it in; it lands in the block flow at the point its w:drawing was encountered, same as an inline image. A w:object/o:OLEObject whose payload part is itself a ZIP archive (a modern producer's embedded xlsx/docx/pptx) is decoded through the shared embedded-object helper (typed/embedded.ts) into a sibling ContentEmbeddedObjectBlock sized from w:dxaOrig/w:dyaOrig and lifted through the same convention as an image block; a payload that does not decode as one of the three OOXML flavours degrades to no embedded block rather than failing the read.
//
// Information not modelled here is still dropped: live PAGE/NUMPAGES field re-evaluation; w:themeShade/w:themeTint refinement of a resolved theme colour; a floating image's own anchored position; any image whose bytes don't sniff as PNG/JPEG; a w:object's VML preview picture (v:imagedata -- no VML reader exists here, and real producers ship WMF/EMF previews anyway); a w:object sitting inside a footnote (footnotes ride DocxDocument.footnotes as text, so there is no block flow to lift an object into -- a header/footer's own objects DO recover now, since those parts are walked as block flow); the evenAndOddHeaders setting in word/settings.xml that gates whether a section's even-page slot renders (the references themselves are recorded as spelled); Word's header/footer slot-inheritance rule (a section reusing the previous section's part when it spells no reference of its own -- a consumer concern, since this records exactly what the file spells); the classic non-ZIP OLE compound-file payload (.bin -- opaque external-application data, left skipped exactly as unhandled markup) and a ZIP payload that does not decode as one of the three OOXML flavours (both degrade to no embedded block, never a failed read); and the run-level construct occurrences still without an encoding here -- an inline SDT or partial tracked change, and a bookmark whose two halves sit in different paragraphs (a same-paragraph bookmark pair, crossing included, lands on ContentParagraph.constructs; see typed/docx/constructs.ts for the scope rules, and typed/docx/write.ts for the write side of what does survive).
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

  const { sections, headerFooters } = readSections(body, ctx);
  return {
    metadata: readCoreProperties(pkg),
    sections,
    comments: readComments(pkg),
    footnotes: readNotesPart(pkg, 'word/footnotes.xml', 'w:footnote'),
    endnotes: readNotesPart(pkg, 'word/endnotes.xml', 'w:endnote'),
    headerFooterParts: readHeaderFooterParts(pkg, ctx),
    sectionHeaderFooters: headerFooters,
    numbering: readNumberingDefinitions(pkg),
  };
}
