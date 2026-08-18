import type { Alignment, ConstructDescriptor, ContentBlock, ContentCellBorders, ContentControlDescriptor, ContentImageBlock, ContentParagraph, ContentRun, ContentSection, ContentTable, ContentTableCell, ProvenanceChange } from 'document-schema.js';
import { colorToRgbHex, findConstructMarkerImbalance } from 'document-schema.js';
import type { Package, XmlPart } from '../../model/package';
import type { XmlElement, XmlNode } from '../../model/node';
import { el, txt } from '../../xml/fragment';
import { encodeXmlText } from '../../xml/entities';
import type { DocumentMetadata } from '../shared/metadata';
import { ptToEighthPoints, ptToEmu, ptToHalfPoints, ptToTwips } from '../shared/units';
import { TABLE_OF_CONTENTS_GALLERY, isDeletedChange } from './constructs';

// ContentSection[] -> Package: the write side of readDocx, and this package's second writer of genuinely new content after typed/xlsx/build.ts's buildXlsxPackage (whose part-scaffolding conventions this follows). It builds a complete, fresh docx package -- content types, package and document relationships, media parts, core/extended properties, and word/document.xml -- rather than editing a decoded one, so a ContentDocument that never came from a docx writes out just as well as one that did.
//
// It is readDocx's honest inverse over ContentSection: page geometry, paragraphs with their fully-resolved direct formatting, runs (including external hyperlinks), lists, headings, tables (grids, spans, shading, borders, row heights), page breaks, images, and the block-scoped construct markers all survive a round trip through the pair. What does NOT survive, stated rather than implied:
// - No styles.xml, numbering.xml, comments, footnotes, headers, or footers are written. readDocx reads all of those into DocxDocument fields outside `sections`, and each needs machinery of its own; a paragraph's styleId is still written as a w:pStyle reference, resolving to nothing without the style part, since every property that style would have contributed is already spelled as direct formatting by then.
// - A run whose boolean properties are absent but which carries some other property (a colour, a size) reads back with those booleans false rather than absent, because the w:rPr the other property forces is itself what the read-side cascade turns an absent w:b into. A run with no properties at all writes no w:rPr and round-trips exactly.
// - Four construct shapes are written as their content with no wrapper, because WordprocessingML has no block-level element for them: a `link` (its own hyperlink is run-level, so a block-scoped link has no element to be), a `division` (no block container answers to one), a `provenance` whose change is `formatChange` (w:pPrChange is a child of w:pPr describing one paragraph's old properties, not a wrapper over a block flow), and an `anchor` whose type is a footnote, endnote, or comment reference (each of those is a run-level reference into a part this writer does not emit). readDocx produces none of them, so this only bounds what a foreign ContentDocument can carry through here.
// - A field construct whose extent contains no paragraph at all, and a section whose last block is not a paragraph, each gain one empty paragraph on the way out (the field characters and the section break both need a paragraph to live in). Everything readDocx itself produces already has one.

const WML_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const CORE_PROPS_NS = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
const DC_NS = 'http://purl.org/dc/elements/1.1/';
const DCTERMS_NS = 'http://purl.org/dc/terms/';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
const EXTENDED_PROPS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties';
const DRAWINGML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const DRAWING_WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const DRAWING_PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const MARKUP_COMPAT_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const W14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15_NS = 'http://schemas.microsoft.com/office/word/2012/wordml';

const CT_DOCUMENT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const CT_CORE_PROPS = 'application/vnd.openxmlformats-package.core-properties+xml';
const CT_EXTENDED_PROPS = 'application/vnd.openxmlformats-officedocument.extended-properties+xml';

const REL_OFFICE_DOCUMENT = `${REL_NS}/officeDocument`;
const REL_CORE_PROPS = `${PKG_RELS_NS}/metadata/core-properties`;
const REL_EXTENDED_PROPS = `${REL_NS}/extended-properties`;
const REL_HYPERLINK = `${REL_NS}/hyperlink`;
const REL_IMAGE = `${REL_NS}/image`;

const DOCUMENT_PART_PATH = 'word/document.xml';

// The input readDocx's own output satisfies directly (a DocxDocument is assignable to it), narrowed to the two fields this writer can express: everything else DocxDocument carries -- comments, footnotes, headers, footers, numbering definitions -- lives in parts this writer does not emit.
export interface DocxContent {
  readonly metadata?: DocumentMetadata;
  readonly sections: readonly ContentSection[];
}

interface WriteRelationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly external: boolean;
}

interface WriteState {
  readonly relationships: WriteRelationship[];
  readonly hyperlinkIds: Map<string, string>;
  readonly mediaIds: Map<string, string>;
  readonly mediaParts: Map<string, { format: 'png' | 'jpeg'; base64: string }>;
  nextDrawingId: number;
  nextMarkerId: number;
}

function newWriteState(): WriteState {
  return { relationships: [], hyperlinkIds: new Map(), mediaIds: new Map(), mediaParts: new Map(), nextDrawingId: 1, nextMarkerId: 1 };
}

function addRelationship(state: WriteState, type: string, target: string, external: boolean): string {
  const id = `rId${state.relationships.length + 1}`;
  state.relationships.push({ id, type, target, external });
  return id;
}

// One relationship per distinct external target and one media part per distinct image payload: a hyperlink or logo repeated through a document is one relationship and one part, not one per occurrence.
function hyperlinkRelationshipId(state: WriteState, uri: string): string {
  const existing = state.hyperlinkIds.get(uri);
  if (existing !== undefined) {
    return existing;
  }
  const id = addRelationship(state, REL_HYPERLINK, encodeXmlText(uri), true);
  state.hyperlinkIds.set(uri, id);
  return id;
}

function imageRelationshipId(state: WriteState, image: ContentImageBlock): string {
  const key = `${image.format}:${image.base64}`;
  const existing = state.mediaIds.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const name = `image${state.mediaParts.size + 1}.${image.format === 'png' ? 'png' : 'jpeg'}`;
  state.mediaParts.set(name, { format: image.format, base64: image.base64 });
  const id = addRelationship(state, REL_IMAGE, `media/${name}`, false);
  state.mediaIds.set(key, id);
  return id;
}

function xmlDeclaration(): XmlNode {
  return { type: 'declaration', attributes: [{ name: 'version', value: '1.0' }, { name: 'encoding', value: 'UTF-8' }, { name: 'standalone', value: 'yes' }] };
}

function xmlPart(root: XmlElement): XmlPart {
  return { kind: 'xml', nodes: [xmlDeclaration(), root] };
}

// --- runs -----------------------------------------------------------------------------------------------------------

// ST_OnOff spelled explicitly in both directions: an absent w:b is "inherit" to the read-side cascade, not "off", so a run whose bold is false must say so rather than omitting the element.
function toggleElement(tag: string, value: boolean): XmlElement {
  return el(tag, { 'w:val': value ? '1' : '0' });
}

function buildRunProperties(run: ContentRun): XmlElement | undefined {
  const children: XmlElement[] = [];
  if (run.fontFamily !== undefined) {
    const font = encodeXmlText(run.fontFamily);
    children.push(el('w:rFonts', { 'w:ascii': font, 'w:hAnsi': font }));
  }
  if (run.bold !== undefined) {
    children.push(toggleElement('w:b', run.bold));
  }
  if (run.italic !== undefined) {
    children.push(toggleElement('w:i', run.italic));
  }
  if (run.strike !== undefined) {
    children.push(toggleElement('w:strike', run.strike));
  }
  if (run.color !== undefined) {
    children.push(el('w:color', { 'w:val': colorToRgbHex(run.color) }));
  }
  if (run.sizePt !== undefined) {
    children.push(el('w:sz', { 'w:val': String(ptToHalfPoints(run.sizePt)) }));
  }
  if (run.underline !== undefined) {
    children.push(el('w:u', { 'w:val': run.underline ? 'single' : 'none' }));
  }
  return children.length === 0 ? undefined : el('w:rPr', {}, children);
}

// readRunText's inverse: a tab is its own w:tab element and a newline its own w:br, so the text either side of them stays in w:t elements that round-trip character for character. xml:space="preserve" keeps leading and trailing spaces, which Word otherwise collapses.
function buildRunContent(text: string, deleted: boolean): XmlElement[] {
  const textTag = deleted ? 'w:delText' : 'w:t';
  const children: XmlElement[] = [];
  for (const piece of text.split(/(\t|\n)/)) {
    if (piece === '\t') {
      children.push(el('w:tab'));
    } else if (piece === '\n') {
      children.push(el('w:br'));
    } else if (piece.length > 0) {
      children.push(el(textTag, { 'xml:space': 'preserve' }, [txt(encodeXmlText(piece))]));
    }
  }
  if (children.length === 0) {
    children.push(el(textTag, { 'xml:space': 'preserve' }));
  }
  return children;
}

function buildRun(run: ContentRun, state: WriteState, deleted: boolean): XmlElement {
  const rPr = buildRunProperties(run);
  const runElement = el('w:r', {}, [...(rPr === undefined ? [] : [rPr]), ...buildRunContent(run.text, deleted)]);
  if (run.hyperlink === undefined) {
    return runElement;
  }
  return el('w:hyperlink', { 'r:id': hyperlinkRelationshipId(state, run.hyperlink) }, [runElement]);
}

// --- paragraphs -------------------------------------------------------------------------------------------------------

const JUSTIFICATION_BY_ALIGNMENT: Readonly<Record<Alignment, string>> = { left: 'left', center: 'center', right: 'right', justify: 'both' };

// CT_PPr's own child sequence, which Word enforces: pStyle, pageBreakBefore, numPr, spacing, ind, jc, outlineLvl. An indentFirstLinePt is w:firstLine when positive and w:hanging (the signed inverse) when negative, matching the convention readParagraphPropertiesLayer reads it back through.
function buildParagraphProperties(paragraph: ContentParagraph, pageBreakBefore: boolean): XmlElement | undefined {
  const children: XmlElement[] = [];
  if (paragraph.styleId !== undefined) {
    children.push(el('w:pStyle', { 'w:val': encodeXmlText(paragraph.styleId) }));
  }
  if (pageBreakBefore) {
    children.push(el('w:pageBreakBefore'));
  }
  if (paragraph.list !== undefined) {
    const numPrChildren: XmlElement[] = [el('w:ilvl', { 'w:val': String(paragraph.list.level) })];
    if (paragraph.list.numId !== undefined) {
      numPrChildren.push(el('w:numId', { 'w:val': encodeXmlText(paragraph.list.numId) }));
    }
    children.push(el('w:numPr', {}, numPrChildren));
  }
  const spacing: Record<string, string> = {};
  if (paragraph.spacingBeforePt !== undefined) {
    spacing['w:before'] = String(ptToTwips(paragraph.spacingBeforePt));
  }
  if (paragraph.spacingAfterPt !== undefined) {
    spacing['w:after'] = String(ptToTwips(paragraph.spacingAfterPt));
  }
  if (paragraph.lineSpacing !== undefined) {
    spacing['w:line'] = String(Math.round(paragraph.lineSpacing * LINE_UNITS_PER_LINE));
    spacing['w:lineRule'] = 'auto';
  }
  if (Object.keys(spacing).length > 0) {
    children.push(el('w:spacing', spacing));
  }
  const indent: Record<string, string> = {};
  if (paragraph.indentLeftPt !== undefined) {
    indent['w:left'] = String(ptToTwips(paragraph.indentLeftPt));
  }
  if (paragraph.indentFirstLinePt !== undefined) {
    if (paragraph.indentFirstLinePt < 0) {
      indent['w:hanging'] = String(ptToTwips(-paragraph.indentFirstLinePt));
    } else {
      indent['w:firstLine'] = String(ptToTwips(paragraph.indentFirstLinePt));
    }
  }
  if (Object.keys(indent).length > 0) {
    children.push(el('w:ind', indent));
  }
  if (paragraph.alignment !== undefined) {
    children.push(el('w:jc', { 'w:val': JUSTIFICATION_BY_ALIGNMENT[paragraph.alignment] }));
  }
  if (paragraph.headingLevel !== undefined) {
    children.push(el('w:outlineLvl', { 'w:val': String(paragraph.headingLevel - 1) }));
  }
  return children.length === 0 ? undefined : el('w:pPr', {}, children);
}

// w:spacing/@w:line's own 240ths-of-a-line unit, the write-side counterpart of shared/units.ts's lineUnitsToMultiplier -- kept local rather than exported from there because nothing else writes it.
const LINE_UNITS_PER_LINE = 240;

// A tracked change carrying whole paragraphs still has to mark each paragraph's own mark as changed (w:pPr/w:rPr/w:ins and kin), or Word shows the change as covering the text but not the paragraph break that ends it. CT_PPr puts that w:rPr after every property element and before w:sectPr, which is exactly where appending it lands.
function buildParagraph(paragraph: ContentParagraph, state: WriteState, pageBreakBefore: boolean, deleted: boolean, change: ProvenanceChange | undefined): XmlElement {
  const properties = buildParagraphProperties(paragraph, pageBreakBefore);
  const changeTag = change === undefined ? undefined : TRACKED_CHANGE_TAG_BY_CHANGE[change];
  const pPr = properties === undefined && changeTag !== undefined ? el('w:pPr', {}, []) : properties;
  if (pPr !== undefined && changeTag !== undefined) {
    pPr.children.push(el('w:rPr', {}, [el(changeTag, { 'w:id': String(state.nextMarkerId++) })]));
  }
  const runs = paragraph.runs.map((run) => buildRun(run, state, deleted));
  return el('w:p', {}, [...(pPr === undefined ? [] : [pPr]), ...runs]);
}

// readDocx lifts a paragraph's own images out into sibling blocks after it, so the inverse puts each one back into the run it came out of: the paragraph's trailing empty-text runs, in order, are exactly the runs a drawing-only run reads back as. An image with no such run left takes a fresh one.
function trailingEmptyRunElements(paragraph: ContentParagraph, element: XmlElement): XmlElement[] {
  const runElements: XmlElement[] = [];
  for (const child of element.children) {
    if (child.type === 'element' && (child.tag === 'w:r' || child.tag === 'w:hyperlink')) {
      runElements.push(child);
    }
  }
  const trailing: XmlElement[] = [];
  for (let index = paragraph.runs.length - 1; index >= 0; index--) {
    const run = paragraph.runs[index];
    const runElement = runElements[index];
    if (run === undefined || runElement === undefined || run.text !== '' || run.hyperlink !== undefined || runElement.tag !== 'w:r') {
      break;
    }
    trailing.unshift(runElement);
  }
  return trailing;
}

// --- tables -------------------------------------------------------------------------------------------------------

function buildCellBorders(borders: ContentCellBorders): XmlElement {
  const edges: XmlElement[] = [];
  const edge = (tag: string, border: ContentCellBorders['top']): void => {
    if (border === undefined) {
      return;
    }
    // ContentBorder.style is optional and document-schema.js defines its absence as meaning solid, so an absent style writes the solid keyword rather than no w:val -- w:val is what makes a w:tcBorders edge a border at all.
    const style = border.style ?? 'solid';
    edges.push(el(tag, { 'w:val': STROKE_STYLE_KEYWORD[style], 'w:sz': String(ptToEighthPoints(border.widthPt)), 'w:color': colorToRgbHex(border.color) }));
  };
  edge('w:top', borders.top);
  edge('w:left', borders.left);
  edge('w:bottom', borders.bottom);
  edge('w:right', borders.right);
  return el('w:tcBorders', {}, edges);
}

// The four ContentStrokeStyle members' own ST_Border keywords. 'solid' writes as 'single', the plain one-line border readCellBorderEdge maps straight back to solid; the other three are their own keywords.
const STROKE_STYLE_KEYWORD: Readonly<Record<'solid' | 'dashed' | 'dotted' | 'double', string>> = { solid: 'single', dashed: 'dashed', dotted: 'dotted', double: 'double' };

interface VerticalMerge {
  remaining: number;
  readonly span: number;
}

function buildCell(cell: ContentTableCell, state: WriteState, deleted: boolean, gridSpan: number, vMerge: 'restart' | 'continue' | undefined): XmlElement {
  const tcPrChildren: XmlElement[] = [];
  if (gridSpan > 1) {
    tcPrChildren.push(el('w:gridSpan', { 'w:val': String(gridSpan) }));
  }
  if (vMerge === 'restart') {
    tcPrChildren.push(el('w:vMerge', { 'w:val': 'restart' }));
  } else if (vMerge === 'continue') {
    tcPrChildren.push(el('w:vMerge'));
  }
  if (cell.background !== undefined) {
    tcPrChildren.push(el('w:shd', { 'w:val': 'clear', 'w:color': 'auto', 'w:fill': colorToRgbHex(cell.background) }));
  }
  if (cell.borders !== undefined) {
    tcPrChildren.push(buildCellBorders(cell.borders));
  }
  const content = buildBlockFlow(cell.blocks, state, deleted);
  // ECMA-376 requires a cell to end with a block-level element, so an empty cell (a vertical-merge continuation, or a genuinely blank one) still gets an empty paragraph.
  const body = content.length === 0 ? [el('w:p')] : content;
  return el('w:tc', {}, [...(tcPrChildren.length === 0 ? [] : [el('w:tcPr', {}, tcPrChildren)]), ...body]);
}

// Vertical merges are written back the way ECMA-376 spells them -- a w:vMerge restart on the anchor and a bare w:vMerge on every covered cell below it -- derived from the anchors' own rowSpan, which is exactly what readTable derived that rowSpan from.
function buildTable(table: ContentTable, state: WriteState, deleted: boolean): XmlElement {
  const grid = el('w:tblGrid', {}, table.columnWidthsPt.map((widthPt) => el('w:gridCol', { 'w:w': String(ptToTwips(widthPt)) })));
  const active = new Map<number, VerticalMerge>();
  const rows = table.rows.map((row) => {
    const cells: XmlElement[] = [];
    let column = 0;
    for (const cell of row.cells) {
      const covered = active.get(column);
      if (covered !== undefined && covered.remaining > 0) {
        covered.remaining--;
        cells.push(buildCell(cell, state, deleted, covered.span, 'continue'));
        column += covered.span;
        continue;
      }
      const gridSpan = cell.colSpan ?? 1;
      const rowSpan = cell.rowSpan ?? 1;
      cells.push(buildCell(cell, state, deleted, gridSpan, rowSpan > 1 ? 'restart' : undefined));
      if (rowSpan > 1) {
        active.set(column, { remaining: rowSpan - 1, span: gridSpan });
      }
      column += gridSpan;
    }
    const trPr = row.heightPt === undefined ? undefined : el('w:trPr', {}, [el('w:trHeight', { 'w:val': String(ptToTwips(row.heightPt)) })]);
    return el('w:tr', {}, [...(trPr === undefined ? [] : [trPr]), ...cells]);
  });
  const tblPr = el('w:tblPr', {}, [el('w:tblW', { 'w:w': '0', 'w:type': 'auto' })]);
  return el('w:tbl', {}, [tblPr, grid, ...rows]);
}

// --- images -----------------------------------------------------------------------------------------------------------

function buildDrawing(image: ContentImageBlock, state: WriteState): XmlElement {
  const relId = imageRelationshipId(state, image);
  const drawingId = state.nextDrawingId++;
  const cx = String(ptToEmu(image.widthPt));
  const cy = String(ptToEmu(image.heightPt));
  const docPrAttrs: Record<string, string> = { id: String(drawingId), name: `Picture ${String(drawingId)}` };
  if (image.altText !== undefined) {
    docPrAttrs.descr = encodeXmlText(image.altText);
  }
  const picture = el('pic:pic', { 'xmlns:pic': DRAWING_PIC_NS }, [
    el('pic:nvPicPr', {}, [el('pic:cNvPr', { id: String(drawingId), name: `Picture ${String(drawingId)}` }), el('pic:cNvPicPr')]),
    el('pic:blipFill', {}, [el('a:blip', { 'r:embed': relId }), el('a:stretch', {}, [el('a:fillRect')])]),
    el('pic:spPr', {}, [
      el('a:xfrm', {}, [el('a:off', { x: '0', y: '0' }), el('a:ext', { cx, cy })]),
      el('a:prstGeom', { prst: 'rect' }, [el('a:avLst')]),
    ]),
  ]);
  return el('w:drawing', {}, [
    el('wp:inline', { distT: '0', distB: '0', distL: '0', distR: '0' }, [
      el('wp:extent', { cx, cy }),
      el('wp:docPr', docPrAttrs),
      el('a:graphic', { 'xmlns:a': DRAWINGML_NS }, [el('a:graphicData', { uri: DRAWING_PIC_NS }, [picture])]),
    ]),
  ]);
}

// --- construct markers ------------------------------------------------------------------------------------------------

// The four tracked-change elements that wrap a block flow. formatChange has no entry: w:pPrChange is a child of w:pPr recording one paragraph's superseded properties, not a wrapper over blocks, so a formatChange construct writes its content unwrapped rather than as an element that would not parse where it sits.
const TRACKED_CHANGE_TAG_BY_CHANGE: Readonly<Record<ProvenanceChange, string | undefined>> = {
  insertion: 'w:ins',
  deletion: 'w:del',
  moveFrom: 'w:moveFrom',
  moveTo: 'w:moveTo',
  formatChange: undefined,
};

const SDT_TYPE_ELEMENT: Readonly<Record<ContentControlDescriptor['controlType'], string | undefined>> = {
  richText: 'w:richText',
  plainText: 'w:text',
  checkbox: 'w14:checkbox',
  dropDown: 'w:dropDownList',
  comboBox: 'w:comboBox',
  date: 'w:date',
  picture: 'w:picture',
  repeatingSection: 'w15:repeatingSection',
  group: 'w:group',
  // A push button has no WordprocessingML control of its own (it comes from the PDF and ODF form vocabularies), and an index is a docPartObj gallery rather than a control type -- both are written below rather than through this table.
  button: undefined,
  index: undefined,
};

const SDT_LOCK_VALUE: Readonly<Record<'content' | 'container' | 'both', string>> = { content: 'contentLocked', container: 'sdtLocked', both: 'sdtContentLocked' };

function buildSdtProperties(descriptor: ContentControlDescriptor): XmlElement {
  const children: XmlElement[] = [];
  if (descriptor.alias !== undefined) {
    children.push(el('w:alias', { 'w:val': encodeXmlText(descriptor.alias) }));
  }
  if (descriptor.tag !== undefined) {
    children.push(el('w:tag', { 'w:val': encodeXmlText(descriptor.tag) }));
  }
  if (descriptor.lock !== undefined) {
    children.push(el('w:lock', { 'w:val': SDT_LOCK_VALUE[descriptor.lock] }));
  }
  if (descriptor.controlType === 'index') {
    children.push(el('w:docPartObj', {}, [el('w:docPartGallery', { 'w:val': TABLE_OF_CONTENTS_GALLERY }), el('w:docPartUnique')]));
    return el('w:sdtPr', {}, children);
  }
  const options = descriptor.options ?? [];
  if (descriptor.controlType === 'dropDown' || descriptor.controlType === 'comboBox') {
    const items = options.map((option) => el('w:listItem', { 'w:displayText': encodeXmlText(option), 'w:value': encodeXmlText(option) }));
    children.push(el(descriptor.controlType === 'dropDown' ? 'w:dropDownList' : 'w:comboBox', {}, items));
    return el('w:sdtPr', {}, children);
  }
  if (descriptor.controlType === 'checkbox') {
    children.push(el('w14:checkbox', {}, [el('w14:checked', { 'w14:val': descriptor.checked === true ? '1' : '0' })]));
    return el('w:sdtPr', {}, children);
  }
  if (descriptor.controlType === 'date') {
    children.push(el('w:date', descriptor.value === undefined ? {} : { 'w:fullDate': encodeXmlText(descriptor.value) }));
    return el('w:sdtPr', {}, children);
  }
  const typeTag = SDT_TYPE_ELEMENT[descriptor.controlType];
  children.push(el(typeTag ?? 'w:richText'));
  return el('w:sdtPr', {}, children);
}

// The reader turns a matched marker pair back into a construct by bracket position, so the writer works from the same shape: the flat list is parsed into the nesting its brackets already describe, and each construct then chooses whether it is an element wrapping its extent (w:sdt, w:ins) or a pair of sibling markers around it (w:bookmarkStart/End) or characters injected into the extent's own paragraphs (a field).
type FlowItem = { readonly kind: 'block'; readonly block: ContentBlock } | { readonly kind: 'construct'; readonly descriptor: ConstructDescriptor; readonly children: FlowItem[] };

function parseFlow(blocks: readonly ContentBlock[]): FlowItem[] {
  const imbalance = findConstructMarkerImbalance(blocks);
  if (imbalance !== undefined) {
    throw new Error(`buildDocxPackage: construct markers do not balance (${imbalance.kind} at block ${String(imbalance.index)})`);
  }
  const roots: FlowItem[] = [];
  const stack: FlowItem[][] = [roots];
  for (const block of blocks) {
    const current = stack[stack.length - 1]!;
    if (block.kind === 'constructStart') {
      const item: FlowItem = { kind: 'construct', descriptor: block.descriptor, children: [] };
      current.push(item);
      stack.push(item.children);
      continue;
    }
    if (block.kind === 'constructEnd') {
      stack.pop();
      continue;
    }
    current.push({ kind: 'block', block });
  }
  return roots;
}

// A field's own w:fldChar characters have to sit inside the extent's paragraphs rather than beside them, since that is exactly where the reader's block-scope test looks for them: the begin/instruction/separate group at the head of the first paragraph, the end at the tail of the last. These two walk the freshly-built nodes for those paragraphs, descending through whatever wrapper elements (w:ins, w:sdt) the extent's own nested constructs put in the way.
function findParagraph(nodes: readonly XmlNode[], last: boolean): XmlElement | undefined {
  const ordered = last ? [...nodes].reverse() : nodes;
  for (const node of ordered) {
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'w:p') {
      return node;
    }
    if (node.tag === 'w:tbl') {
      continue;
    }
    const nested = findParagraph(node.children, last);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

function fieldCharRun(type: string): XmlElement {
  return el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': type })]);
}

function fieldOpeningRuns(instruction: string): XmlElement[] {
  return [fieldCharRun('begin'), el('w:r', {}, [el('w:instrText', { 'xml:space': 'preserve' }, [txt(encodeXmlText(instruction))])]), fieldCharRun('separate')];
}

function insertAfterProperties(paragraph: XmlElement, runs: readonly XmlElement[]): void {
  const first = paragraph.children[0];
  const offset = first?.type === 'element' && first.tag === 'w:pPr' ? 1 : 0;
  paragraph.children.splice(offset, 0, ...runs);
}

function buildFieldNodes(instruction: string, content: XmlNode[]): XmlNode[] {
  const first = findParagraph(content, false);
  const last = findParagraph(content, true);
  if (first === undefined || last === undefined) {
    return [el('w:p', {}, fieldOpeningRuns(instruction)), ...content, el('w:p', {}, [fieldCharRun('end')])];
  }
  insertAfterProperties(first, fieldOpeningRuns(instruction));
  last.children.push(fieldCharRun('end'));
  return content;
}

function buildConstructNodes(descriptor: ConstructDescriptor, children: FlowItem[], state: WriteState, deleted: boolean): XmlNode[] {
  if (descriptor.kind === 'contentControl') {
    return [el('w:sdt', {}, [buildSdtProperties(descriptor), el('w:sdtContent', {}, buildFlowItems(children, state, deleted, undefined))])];
  }
  if (descriptor.kind === 'provenance') {
    const tag = TRACKED_CHANGE_TAG_BY_CHANGE[descriptor.change];
    if (tag !== undefined) {
      const attrs: Record<string, string> = { 'w:id': String(state.nextMarkerId++) };
      if (descriptor.author !== undefined) {
        attrs['w:author'] = encodeXmlText(descriptor.author);
      }
      if (descriptor.dateIso !== undefined) {
        attrs['w:date'] = encodeXmlText(descriptor.dateIso);
      }
      return [el(tag, attrs, buildFlowItems(children, state, deleted || isDeletedChange(descriptor.change), descriptor.change))];
    }
  }
  if (descriptor.kind === 'anchor' && descriptor.anchorType === 'bookmark') {
    const id = String(state.nextMarkerId++);
    return [
      el('w:bookmarkStart', { 'w:id': id, 'w:name': encodeXmlText(descriptor.name) }),
      ...buildFlowItems(children, state, deleted, undefined),
      el('w:bookmarkEnd', { 'w:id': id }),
    ];
  }
  if (descriptor.kind === 'field') {
    return buildFieldNodes(descriptor.instruction, buildFlowItems(children, state, deleted, undefined));
  }
  return buildFlowItems(children, state, deleted, undefined);
}

// `change` propagates a tracked change down to the paragraphs it wraps so each paragraph's own mark carries the same change; it stops at the first nested construct, since a construct inside a tracked change carries its own paragraphs' marks through its own wrapper.
function buildFlowItems(items: readonly FlowItem[], state: WriteState, deleted: boolean, change: ProvenanceChange | undefined): XmlNode[] {
  const nodes: XmlNode[] = [];
  let pendingPageBreak = false;
  let lastParagraph: XmlElement | undefined;
  let availableImageRuns: XmlElement[] = [];
  for (const item of items) {
    if (item.kind === 'construct') {
      nodes.push(...buildConstructNodes(item.descriptor, item.children, state, deleted));
      lastParagraph = undefined;
      availableImageRuns = [];
      continue;
    }
    const block = item.block;
    if (block.kind === 'pageBreak') {
      pendingPageBreak = true;
      continue;
    }
    if (block.kind === 'paragraph') {
      const paragraph = buildParagraph(block, state, pendingPageBreak, deleted, change);
      pendingPageBreak = false;
      lastParagraph = paragraph;
      availableImageRuns = trailingEmptyRunElements(block, paragraph);
      nodes.push(paragraph);
      continue;
    }
    if (block.kind === 'image') {
      const drawing = buildDrawing(block, state);
      const reusable = availableImageRuns.shift();
      if (reusable !== undefined) {
        reusable.children.push(drawing);
      } else if (lastParagraph !== undefined) {
        lastParagraph.children.push(el('w:r', {}, [drawing]));
      } else {
        const paragraph = el('w:p', {}, [el('w:r', {}, [drawing])]);
        lastParagraph = paragraph;
        nodes.push(paragraph);
      }
      continue;
    }
    if (block.kind === 'table') {
      nodes.push(buildTable(block, state, deleted));
      lastParagraph = undefined;
      availableImageRuns = [];
      continue;
    }
    // An embedded object has no WordprocessingML block element this writer can produce (readDocx never reads one either), so it contributes nothing rather than a placeholder that would read back as content it is not.
    lastParagraph = undefined;
    availableImageRuns = [];
  }
  if (pendingPageBreak) {
    nodes.push(el('w:p', {}, [el('w:pPr', {}, [el('w:pageBreakBefore')])]));
  }
  return nodes;
}

function buildBlockFlow(blocks: readonly ContentBlock[], state: WriteState, deleted: boolean): XmlNode[] {
  return buildFlowItems(parseFlow(blocks), state, deleted, undefined);
}

// --- sections and the document part ---------------------------------------------------------------------------------

function buildSectionProperties(section: ContentSection): XmlElement {
  return el('w:sectPr', {}, [
    el('w:pgSz', { 'w:w': String(ptToTwips(section.pageSize.widthPt)), 'w:h': String(ptToTwips(section.pageSize.heightPt)) }),
    el('w:pgMar', {
      'w:top': String(ptToTwips(section.margins.topPt)),
      'w:right': String(ptToTwips(section.margins.rightPt)),
      'w:bottom': String(ptToTwips(section.margins.bottomPt)),
      'w:left': String(ptToTwips(section.margins.leftPt)),
    }),
  ]);
}

// A mid-document section break rides on the last paragraph of the section it closes -- the shape readSections reads it back from, which keeps that paragraph as content rather than adding one. Only the final section's w:sectPr is a direct child of w:body; a section whose last node is not a paragraph gets an empty one to carry the break.
function attachSectionBreak(nodes: XmlNode[], section: ContentSection): void {
  const last = nodes[nodes.length - 1];
  const target = last?.type === 'element' && last.tag === 'w:p' ? last : undefined;
  if (target === undefined) {
    nodes.push(el('w:p', {}, [el('w:pPr', {}, [buildSectionProperties(section)])]));
    return;
  }
  const first = target.children[0];
  if (first?.type === 'element' && first.tag === 'w:pPr') {
    first.children.push(buildSectionProperties(section));
    return;
  }
  target.children.unshift(el('w:pPr', {}, [buildSectionProperties(section)]));
}

function buildDocumentPart(sections: readonly ContentSection[], state: WriteState): XmlPart {
  const bodyChildren: XmlNode[] = [];
  sections.forEach((section, index) => {
    const nodes = buildBlockFlow(section.blocks, state, false);
    if (index === sections.length - 1) {
      bodyChildren.push(...nodes, buildSectionProperties(section));
      return;
    }
    attachSectionBreak(nodes, section);
    bodyChildren.push(...nodes);
  });
  const root = el(
    'w:document',
    {
      'xmlns:w': WML_NS,
      'xmlns:r': REL_NS,
      'xmlns:a': DRAWINGML_NS,
      'xmlns:wp': DRAWING_WP_NS,
      'xmlns:pic': DRAWING_PIC_NS,
      'xmlns:mc': MARKUP_COMPAT_NS,
      'xmlns:w14': W14_NS,
      'xmlns:w15': W15_NS,
      'mc:Ignorable': 'w14 w15',
    },
    [el('w:body', {}, bodyChildren)],
  );
  return xmlPart(root);
}

// --- package scaffolding ----------------------------------------------------------------------------------------------

function buildContentTypesPart(mediaFormats: ReadonlySet<'png' | 'jpeg'>): XmlPart {
  const defaults: XmlElement[] = [
    el('Default', { Extension: 'rels', ContentType: 'application/vnd.openxmlformats-package.relationships+xml' }),
    el('Default', { Extension: 'xml', ContentType: 'application/xml' }),
  ];
  if (mediaFormats.has('png')) {
    defaults.push(el('Default', { Extension: 'png', ContentType: 'image/png' }));
  }
  if (mediaFormats.has('jpeg')) {
    defaults.push(el('Default', { Extension: 'jpeg', ContentType: 'image/jpeg' }));
  }
  const root = el('Types', { xmlns: CONTENT_TYPES_NS }, [
    ...defaults,
    el('Override', { PartName: `/${DOCUMENT_PART_PATH}`, ContentType: CT_DOCUMENT }),
    el('Override', { PartName: '/docProps/core.xml', ContentType: CT_CORE_PROPS }),
    el('Override', { PartName: '/docProps/app.xml', ContentType: CT_EXTENDED_PROPS }),
  ]);
  return xmlPart(root);
}

function buildPackageRelsPart(): XmlPart {
  const root = el('Relationships', { xmlns: PKG_RELS_NS }, [
    el('Relationship', { Id: 'rId1', Type: REL_OFFICE_DOCUMENT, Target: DOCUMENT_PART_PATH }),
    el('Relationship', { Id: 'rId2', Type: REL_CORE_PROPS, Target: 'docProps/core.xml' }),
    el('Relationship', { Id: 'rId3', Type: REL_EXTENDED_PROPS, Target: 'docProps/app.xml' }),
  ]);
  return xmlPart(root);
}

function buildDocumentRelsPart(state: WriteState): XmlPart {
  const relationships = state.relationships.map((rel) =>
    el('Relationship', rel.external ? { Id: rel.id, Type: rel.type, Target: rel.target, TargetMode: 'External' } : { Id: rel.id, Type: rel.type, Target: rel.target }),
  );
  return xmlPart(el('Relationships', { xmlns: PKG_RELS_NS }, relationships));
}

function buildCorePropertiesPart(metadata: DocumentMetadata): XmlPart {
  const children: XmlElement[] = [];
  if (metadata.title !== undefined) {
    children.push(el('dc:title', {}, [txt(encodeXmlText(metadata.title))]));
  }
  if (metadata.author !== undefined) {
    children.push(el('dc:creator', {}, [txt(encodeXmlText(metadata.author))]));
  }
  if (metadata.subject !== undefined) {
    children.push(el('dc:subject', {}, [txt(encodeXmlText(metadata.subject))]));
  }
  if (metadata.keywords !== undefined && metadata.keywords.length > 0) {
    children.push(el('cp:keywords', {}, [txt(encodeXmlText(metadata.keywords.join(', ')))]));
  }
  if (metadata.createdIso !== undefined) {
    children.push(el('dcterms:created', { 'xsi:type': 'dcterms:W3CDTF' }, [txt(encodeXmlText(metadata.createdIso))]));
  }
  if (metadata.modifiedIso !== undefined) {
    children.push(el('dcterms:modified', { 'xsi:type': 'dcterms:W3CDTF' }, [txt(encodeXmlText(metadata.modifiedIso))]));
  }
  return xmlPart(el('cp:coreProperties', { 'xmlns:cp': CORE_PROPS_NS, 'xmlns:dc': DC_NS, 'xmlns:dcterms': DCTERMS_NS, 'xmlns:xsi': XSI_NS }, children));
}

function buildExtendedPropertiesPart(metadata: DocumentMetadata): XmlPart {
  const children: XmlElement[] = [];
  if (metadata.creator !== undefined) {
    children.push(el('Application', {}, [txt(encodeXmlText(metadata.creator))]));
  }
  return xmlPart(el('Properties', { xmlns: EXTENDED_PROPS_NS }, children));
}

// ContentSection[] (plus optional document metadata) -> a complete docx Package, built part by part rather than edited into an existing one. The read-side inverse is readDocx; see this module's own header for exactly what survives the pair and what does not.
export function buildDocxPackage(content: DocxContent): Package {
  const state = newWriteState();
  const sections = content.sections.length === 0 ? [{ pageSize: { widthPt: 612, heightPt: 792 }, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 }, blocks: [] }] : content.sections;
  // The document part is built first so every hyperlink and image relationship it needs already exists by the time the relationship and content-type parts are written.
  const documentPart = buildDocumentPart(sections, state);
  const metadata = content.metadata ?? {};
  const parts: Package['parts'] = {
    '[Content_Types].xml': buildContentTypesPart(new Set([...state.mediaParts.values()].map((media) => media.format))),
    '_rels/.rels': buildPackageRelsPart(),
    [DOCUMENT_PART_PATH]: documentPart,
    'word/_rels/document.xml.rels': buildDocumentRelsPart(state),
    'docProps/core.xml': buildCorePropertiesPart(metadata),
    'docProps/app.xml': buildExtendedPropertiesPart(metadata),
  };
  for (const [name, media] of state.mediaParts) {
    parts[`word/media/${name}`] = { kind: 'binary', base64: media.base64 };
  }
  return { parts };
}
