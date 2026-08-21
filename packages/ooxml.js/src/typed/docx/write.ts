import type { Alignment, AnchorDescriptor, ConstructDescriptor, ContentBlock, ContentCellBorders, ContentControlDescriptor, ContentDocument, ContentEmbeddedObjectBlock, ContentImageBlock, ContentParagraph, ContentRun, ContentSection, ContentTable, ContentTableCell, FieldDescriptor, LinkDescriptor, ProvenanceChange, ProvenanceDescriptor } from 'document-schema.js';
import { colorToRgbHex, findConstructMarkerImbalance, findRunConstructFault } from 'document-schema.js';
import type { Package, XmlPart } from '../../model/package';
import type { XmlElement, XmlNode } from '../../model/node';
import { el, txt } from '../../xml/fragment';
import { encodeXmlText } from '../../xml/entities';
import { parseXml } from '../../xml/parse';
import { encodePackage } from '../../codec';
import { bytesToBase64 } from '../../util/base64';
import type { DocumentMetadata } from '../shared/metadata';
import { ptToEighthPoints, ptToEmu, ptToHalfPoints, ptToTwips } from '../shared/units';
import { buildXlsxPackageFromContent } from '../xlsx/build';
import { TABLE_OF_CONTENTS_GALLERY, isDeletedChange } from './constructs';

// ContentSection[] -> Package: the write side of readDocxContent, and this package's second writer of genuinely new content after typed/xlsx/build.ts's buildXlsxPackageFromContent (whose part-scaffolding conventions this follows). It builds a complete, fresh docx package -- content types, package and document relationships, media parts, core/extended properties, and word/document.xml -- rather than editing a decoded one, so a ContentDocument that never came from a docx writes out just as well as one that did.
//
// This is the flat, content-level half of the docx write pair: buildDocxPackage (typed/document-package.ts) is the primary name, flattening a tree-form DocumentPackage (styles-table refs materialised away) and handing the result straight to this function.
//
// It is readDocxContent's honest inverse over ContentSection: page geometry, paragraphs with their fully-resolved direct formatting, runs (including external hyperlinks), lists, headings, tables (grids, spans, shading, borders, row heights), page breaks, images, embedded objects, and the block-scoped construct markers all survive a round trip through the pair -- a degraded gallery's w:docPartObj included, restored from the descriptor's residue (restoreGalleryElement below). What does NOT survive, stated rather than implied:
// - No styles.xml, numbering.xml, comments, footnotes, headers, or footers are written. readDocxContent reads all of those into DocxDocument fields outside `sections`, and each needs machinery of its own; a paragraph's styleId is still written as a w:pStyle reference, resolving to nothing without the style part, since every property that style would have contributed is already spelled as direct formatting by then.
// - An embedded object's VML preview picture is not regenerated: the reader never read one into the model (no VML reader exists, and real producers ship WMF/EMF previews this ecosystem has no writer for), so the written w:object carries only its o:OLEObject payload reference and Word shows a blank until activated. An embedded presentation serialises through the injected port (options.serialiseEmbeddedPresentation -- BuildDocxContentOptions's own comment states why it is a port); without one injected, and for a nested document of any other kind this package cannot serialise (drawing/formula -- ODF/MathML spellings), the block is refused with a thrown error rather than silently dropped, inverting the reader's degrade-tier rule at the write boundary where the caller has explicitly asked for a document.
// - A run whose boolean properties are absent but which carries some other property (a colour, a size) reads back with those booleans false rather than absent, because the w:rPr the other property forces is itself what the read-side cascade turns an absent w:b into. A run with no properties at all writes no w:rPr and round-trips exactly.
// - Four construct shapes are written as their content with no wrapper, because WordprocessingML has no block-level element for them: a `link` (its own hyperlink is run-level, so a block-scoped link has no element to be), a `division` (no block container answers to one), a `provenance` whose change is `formatChange` (w:pPrChange is a child of w:pPr describing one paragraph's old properties, not a wrapper over a block flow), and an `anchor` whose type is a footnote, endnote, or comment (each of those is a run-level reference or range into parts this writer does not emit -- a comment extent or note reference written without its word/comments.xml, word/footnotes.xml, or word/endnotes.xml body would point at nothing). readDocxContent produces the last of those, so this bounds what its own output carries through here.
// - Of a paragraph's run-level construct extents (ContentParagraph.constructs), bookmark anchors write back as their w:bookmarkStart/End halves between the runs the range names, fields as their w:fldChar begin/instruction/separate/end characters between the same runs, and internal links as one w:hyperlink/@w:anchor wrapping exactly the runs they cover (interleaveRunConstructExtents below). A run extent of any other kind -- a contentControl from a legacy w:ffData form field, a comment extent, a note reference -- writes its paragraph's content untouched and loses only the descriptor (rebuilding the ffData control payload, or emitting a reference into a part this writer never writes, is out of scope), and an extent whose range does not name real runs is refused with a thrown error rather than written at a made-up position.
// - A field construct whose extent contains no paragraph at all, and a section whose last block is not a paragraph, each gain one empty paragraph on the way out (the field characters and the section break both need a paragraph to live in). Everything readDocxContent itself produces already has one.
// - A page break immediately before a table or an image -- w:pageBreakBefore is a paragraph property, so neither can carry it directly -- becomes its own empty paragraph carrying the break, immediately before that content rather than displaced to the end of the flow.

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
const VML_OFFICE_NS = 'urn:schemas-microsoft-com:office:office';

const CT_DOCUMENT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const CT_CORE_PROPS = 'application/vnd.openxmlformats-package.core-properties+xml';
const CT_EXTENDED_PROPS = 'application/vnd.openxmlformats-officedocument.extended-properties+xml';
const CT_EMBEDDED_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const CT_EMBEDDED_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CT_EMBEDDED_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

// The content type an embeddings part is declared with, by the extension the payload serialised into -- each names the format of the nested document the part holds, so an Override can declare exactly that part without claiming anything about other files sharing the extension elsewhere.
const EMBEDDED_PART_CONTENT_TYPES: Readonly<Record<'docx' | 'xlsx' | 'pptx', string>> = { docx: CT_EMBEDDED_DOCX, xlsx: CT_EMBEDDED_XLSX, pptx: CT_EMBEDDED_PPTX };

const REL_OFFICE_DOCUMENT = `${REL_NS}/officeDocument`;
const REL_CORE_PROPS = `${PKG_RELS_NS}/metadata/core-properties`;
const REL_EXTENDED_PROPS = `${REL_NS}/extended-properties`;
const REL_HYPERLINK = `${REL_NS}/hyperlink`;
const REL_IMAGE = `${REL_NS}/image`;
const REL_OLE_OBJECT = `${REL_NS}/oleObject`;

const DOCUMENT_PART_PATH = 'word/document.xml';

// The input readDocxContent's own output satisfies directly (a DocxDocument is assignable to it), narrowed to the two fields this writer can express: everything else DocxDocument carries -- comments, footnotes, headers, footers, numbering definitions -- lives in parts this writer does not emit.
export interface DocxContent {
  readonly metadata?: DocumentMetadata;
  readonly sections: readonly ContentSection[];
}

// The port that lets a docx carrying an embedded presentation round-trip (#742): presentation ContentDocument -> whole pptx file bytes. This package has no PresentationML writer of its own (pptx is read-only here), and the one pptx writer in the ecosystem -- documents.js's editor scaffold -- lives one layer up, where this package cannot reach it without inverting the family's dependency direction. The port resolves that without the inversion: a caller holding a pptx serialiser injects it, and the writer serialises the embedded presentation into a genuine word/embeddings/oleObjectN.pptx payload exactly as an embedded workbook serialises through buildXlsxPackageFromContent. The returned bytes are the OLE payload verbatim -- the reader detects the payload by ZIP magic and decodes its flavour from the nested package's own entry part, never by extension or content type, so any conforming pptx byte stream round-trips. An embedded presentation with no serialiser injected is still refused with a thrown error: a silent drop would re-create exactly the read-once-never-written loss the embedded emitter exists to close.
export type EmbeddedPresentationSerialiser = (document: Extract<ContentDocument, { kind: 'presentation' }>) => Uint8Array<ArrayBuffer>;

export interface BuildDocxContentOptions {
  readonly serialiseEmbeddedPresentation?: EmbeddedPresentationSerialiser;
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
  readonly embeddingIds: Map<string, string>;
  readonly embeddingParts: Map<string, EmbeddedPayload>;
  readonly serialiseEmbeddedPresentation: EmbeddedPresentationSerialiser | undefined;
  nextDrawingId: number;
  nextMarkerId: number;
}

function newWriteState(options: BuildDocxContentOptions | undefined): WriteState {
  return { relationships: [], hyperlinkIds: new Map(), mediaIds: new Map(), mediaParts: new Map(), embeddingIds: new Map(), embeddingParts: new Map(), serialiseEmbeddedPresentation: options?.serialiseEmbeddedPresentation, nextDrawingId: 1, nextMarkerId: 1 };
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

// A tracked change carrying a whole paragraph still has to mark the paragraph's own mark as changed (w:pPr/w:rPr/w:ins and kin), or Word shows the change as covering the text but not the paragraph break that ends it -- CT_PPr puts that w:rPr after every property element and before w:sectPr, which is exactly where appending it lands. The change element itself wraps the paragraph's RUNS, never the w:p: CT_RunTrackChange (reached through EG_RunLevelElts) has no w:p in its content model, so a change wrapping whole paragraphs is not valid WordprocessingML even though the reader tolerates it as input. A paragraph carrying no runs at all still gets an empty change element (rather than none), since that empty element is exactly what marks the paragraph as wholly changed to a reader walking its content-bearing children.
function buildParagraph(paragraph: ContentParagraph, state: WriteState, pageBreakBefore: boolean, deleted: boolean, provenance: ProvenanceDescriptor | undefined): XmlElement {
  const properties = buildParagraphProperties(paragraph, pageBreakBefore);
  const changeTag = provenance === undefined ? undefined : TRACKED_CHANGE_TAG_BY_CHANGE[provenance.change];
  const pPr = properties === undefined && changeTag !== undefined ? el('w:pPr', {}, []) : properties;
  if (pPr !== undefined && changeTag !== undefined && provenance !== undefined) {
    pPr.children.push(el('w:rPr', {}, [el(changeTag, trackChangeAttrs(state, provenance))]));
  }
  const runs = interleaveRunConstructExtents(paragraph.runs.map((run) => buildRun(run, state, deleted)), paragraph, state);
  const content = changeTag === undefined || provenance === undefined ? runs : [el(changeTag, trackChangeAttrs(state, provenance), runs)];
  return el('w:p', {}, [...(pPr === undefined ? [] : [pPr]), ...content]);
}

// The write side of a run-level construct extent (document-schema.js's ContentParagraph.constructs): a bookmark's two halves and a field's fldChar characters go back between the runs their ranges name -- the exact inverse of the reader's run-position walk, so each reads back at the positions it was written from. Of the vocabulary's kinds, bookmark anchors and fields are the two with a run-level spelling here (WordprocessingML's w:bookmarkStart/End pair, and the w:fldChar begin/separate/end characters whose between-runs placement is what the reader's own block-scope test looks for); an internal link wraps its runs in one w:hyperlink/@w:anchor element (wrapInternalLinks below); everything else -- a run-scoped content control, a comment extent, a note reference -- writes its paragraph's content untouched and loses only the descriptor, the same content-preserving policy the block-level foreign constructs follow. At a shared boundary the halves go out in three groups -- closes of extents that opened earlier, then opens, then point extents (startRun === endRun) as one adjacent group each -- a convention the reader is indifferent to (both halves land on the same run position either way) but one the written XML needs: WordprocessingML pairs the halves by w:id with start-before-end ordering, so a point's end emitted among the boundary's closes would precede its own start, and pairing point halves keeps two points at one position from interleaving by id, which is the shape Word itself writes for adjacent point bookmarks.
function interleaveRunConstructExtents(runElements: readonly XmlElement[], paragraph: ContentParagraph, state: WriteState): XmlElement[] {
  if (paragraph.constructs === undefined) {
    return [...runElements];
  }
  const fault = findRunConstructFault(paragraph);
  if (fault !== undefined) {
    throw new Error(`buildDocxPackageFromContent: run-level construct extent at index ${String(fault.index)} of a paragraph does not name real runs (${fault.kind})`);
  }
  const bookmarks = paragraph.constructs.filter(
    (extent): extent is { descriptor: AnchorDescriptor; startRun: number; endRun: number } =>
      extent.descriptor.kind === 'anchor' && extent.descriptor.anchorType === 'bookmark',
  );
  const fields = paragraph.constructs.filter(
    (extent): extent is { descriptor: FieldDescriptor; startRun: number; endRun: number } => extent.descriptor.kind === 'field',
  );
  const links: InternalLinkExtent[] = [];
  for (const extent of paragraph.constructs) {
    if (extent.descriptor.kind === 'link' && extent.descriptor.target.kind === 'internal') {
      links.push({ descriptor: extent.descriptor, startRun: extent.startRun, endRun: extent.endRun, anchor: extent.descriptor.target.anchor });
    }
  }
  if (bookmarks.length === 0 && fields.length === 0) {
    return wrapInternalLinks([...runElements], new RunPositions(runElements), links);
  }
  const closingAt = new Map<number, XmlElement[]>();
  const openingAt = new Map<number, XmlElement[]>();
  const pointAt = new Map<number, XmlElement[]>();
  const push = (map: Map<number, XmlElement[]>, position: number, element: XmlElement): void => {
    const existing = map.get(position);
    if (existing === undefined) {
      map.set(position, [element]);
    } else {
      existing.push(element);
    }
  };
  for (const bookmark of bookmarks) {
    const id = String(state.nextMarkerId++);
    const open = el('w:bookmarkStart', { 'w:id': id, 'w:name': encodeXmlText(bookmark.descriptor.name) });
    const close = el('w:bookmarkEnd', { 'w:id': id });
    if (bookmark.startRun === bookmark.endRun) {
      // A point extent's halves are emitted as one adjacent pair, never split across the close/open groups: its end among the closes would precede its own start, and its start among the opens would let a second point at the same position interleave with it by id.
      push(pointAt, bookmark.startRun, open);
      push(pointAt, bookmark.startRun, close);
    } else {
      push(openingAt, bookmark.startRun, open);
      push(closingAt, bookmark.endRun, close);
    }
  }
  // A field's own characters spell begin + instruction + separate as one group at the extent's opening boundary (the instruction rides its own w:instrText run, exactly where the reader's code-run walk collects it from), and the end character at the closing boundary.
  for (const field of fields) {
    const opening = [fieldCharRun('begin'), el('w:r', {}, [el('w:instrText', { 'xml:space': 'preserve' }, [txt(encodeXmlText(field.descriptor.instruction))])]), fieldCharRun('separate')];
    if (field.startRun === field.endRun) {
      for (const run of opening) {
        push(pointAt, field.startRun, run);
      }
      push(pointAt, field.startRun, fieldCharRun('end'));
    } else {
      for (const run of opening) {
        push(openingAt, field.startRun, run);
      }
      push(closingAt, field.endRun, fieldCharRun('end'));
    }
  }
  const out: XmlElement[] = [];
  const positions = new RunPositions(runElements);
  for (let position = 0; position <= runElements.length; position++) {
    for (const close of closingAt.get(position) ?? []) {
      out.push(close);
    }
    for (const open of openingAt.get(position) ?? []) {
      out.push(open);
    }
    for (const half of pointAt.get(position) ?? []) {
      out.push(half);
    }
    const run = runElements[position];
    if (run !== undefined) {
      out.push(run);
    }
  }
  return wrapInternalLinks(out, positions, links);
}

// The run-element identities of an interleaved paragraph content list, keyed by their positions in the runs the paragraph carries -- what wrapInternalLinks locates a link's slice by, since the markers and field characters interleaved between runs shift raw array indices.
class RunPositions {
  private readonly indexOfElement = new Map<XmlElement, number>();

  constructor(runElements: readonly XmlElement[]) {
    runElements.forEach((element, index) => {
      this.indexOfElement.set(element, index);
    });
  }

  positionOf(element: XmlElement): number | undefined {
    return this.indexOfElement.get(element);
  }
}

// One internal-target link extent, the only link shape with a run-level spelling here: an external target rides ContentRun.hyperlink on each covered run instead.
interface InternalLinkExtent {
  readonly descriptor: LinkDescriptor;
  readonly startRun: number;
  readonly endRun: number;
  readonly anchor: string;
}

// Wraps each internal link extent's runs in one w:hyperlink/@w:anchor element -- the inverse of the reader's internal-hyperlink walk. A link whose slice cannot be wrapped -- it crosses another link's (WordprocessingML has no nested w:hyperlink, and Word itself cannot produce the shape), or it covers a run carrying an external hyperlink of its own (already a w:hyperlink) -- writes its runs plain and loses only the descriptor, the content-preserving policy every unwritable construct kind here follows.
function wrapInternalLinks(elements: XmlElement[], positions: RunPositions, links: readonly InternalLinkExtent[]): XmlElement[] {
  if (links.length === 0) {
    return elements;
  }
  let out = elements;
  const wrapped: { first: number; last: number }[] = [];
  for (const link of [...links].sort((a, b) => a.startRun - b.startRun || b.endRun - a.endRun)) {
    let first = -1;
    let last = -1;
    out.forEach((element, index) => {
      const position = positions.positionOf(element);
      if (position === link.startRun) {
        first = index;
      }
      if (position === link.endRun - 1) {
        last = index;
      }
    });
    if (first === -1 || last === -1 || last < first) {
      continue;
    }
    const slice = out.slice(first, last + 1);
    // No nesting a hyperlink inside a hyperlink -- neither another internal link's wrap (tracked in `wrapped`) nor a run's own external-target wrapper element.
    const overlapsWrapped = wrapped.some((range) => first <= range.last && range.first <= last);
    const carriesHyperlink = slice.some((element) => element.tag === 'w:hyperlink');
    if (overlapsWrapped || carriesHyperlink) {
      continue;
    }
    wrapped.push({ first, last });
    out = [...out.slice(0, first), el('w:hyperlink', { 'w:anchor': encodeXmlText(link.anchor) }, slice), ...out.slice(last + 1)];
  }
  return out;
}

// readDocxContent lifts a paragraph's own images out into sibling blocks after it, so the inverse puts each one back into the run it came out of: the paragraph's trailing empty-text runs, in order, are exactly the runs a drawing-only run reads back as. An image with no such run left takes a fresh one.
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

// --- embedded objects -------------------------------------------------------------------------------------------------

// The OLE payload part this writer produces for one embedded object: the nested document re-serialised through its own format's builder and zipped -- the direct-ZIP spelling, not a classic OLE compound-file wrapper, matching what readEmbeddedOoxmlPayload accepts at any embeddings path (the payload is detected by ZIP magic and entry part, never by extension or content type).
interface EmbeddedPayload {
  readonly extension: 'docx' | 'xlsx' | 'pptx';
  readonly progId: string;
  readonly base64: string;
}

// Serialises an embedded object's nested document into its OLE payload bytes, dispatching on the document's own kind rather than the block's objectKind label: the payload's bytes, part extension, and ProgID are all properties of the document being serialised, and while schema treats the objectKind/document.kind pairing as a producer convention rather than a constraint, the only coherent rule for a writer is one source of truth -- the document itself. The ProgIDs are the canonical OLE names of the OOXML-era Office applications (what a real producer's o:OLEObject carries and what Word launches to activate the embed); the schema carries no progId field, so the writer synthesises one per kind.
//
// A presentation document serialises through the injected port (state.serialiseEmbeddedPresentation, BuildDocxContentOptions's own comment states why it is a port), and a document kind with no serialiser at all is refused loudly rather than silently dropped: readDocxContent recovers embedded wordprocessing, presentation, and spreadsheet documents alike, so silently skipping any of them would re-create exactly the read-once-never-written loss this emitter exists to close. Drawing/formula are ODF/MathML spellings no OOXML OLE payload corresponds to -- the reader's degrade-tier rule (second-order content never fails the host read) inverts at the write boundary, where the caller is explicitly asking for a document and a writer that cannot produce one faithfully says so.
function embeddedPayloadOf(document: ContentEmbeddedObjectBlock['document'], state: WriteState): EmbeddedPayload {
  switch (document.kind) {
    case 'wordprocessing':
      return { extension: 'docx', progId: 'Word.Document.12', base64: bytesToBase64(encodePackage(buildDocxPackageFromContent(document))) };
    case 'spreadsheet':
      return { extension: 'xlsx', progId: 'Excel.Sheet.12', base64: bytesToBase64(encodePackage(buildXlsxPackageFromContent(document))) };
    case 'presentation': {
      const serialise = state.serialiseEmbeddedPresentation;
      if (serialise === undefined) {
        throw new Error(
          'buildDocxPackageFromContent: an embedded object carrying a presentation document has no serialiser (this package has no PresentationML writer; pass options.serialiseEmbeddedPresentation -- documents.js wires one from its own pptx builder)',
        );
      }
      return { extension: 'pptx', progId: 'PowerPoint.Show.12', base64: bytesToBase64(serialise(document)) };
    }
    default:
      throw new Error(
        `buildDocxPackageFromContent: an embedded object carrying a ${document.kind} document has no OOXML OLE payload this writer can produce (embedded wordprocessing and spreadsheet documents serialise through their own builders, a presentation through options.serialiseEmbeddedPresentation, and drawing/formula are ODF/MathML spellings)`,
      );
  }
}

// One embeddings part and one relationship per distinct payload, mirroring imageRelationshipId: copy-pasted objects (the common case -- the reader decodes one shared part and hands both blocks the same nested document) serialise to identical bytes and therefore re-share one part, never one duplicate part per occurrence.
function embeddedObjectRelationshipId(state: WriteState, payload: EmbeddedPayload): string {
  const existing = state.embeddingIds.get(payload.base64);
  if (existing !== undefined) {
    return existing;
  }
  const name = `oleObject${state.embeddingParts.size + 1}.${payload.extension}`;
  state.embeddingParts.set(name, payload);
  const id = addRelationship(state, REL_OLE_OBJECT, `embeddings/${name}`, false);
  state.embeddingIds.set(payload.base64, id);
  return id;
}

// readObjectEmbeddedObject's inverse: w:dxaOrig/w:dyaOrig carry the block frame's size in twips (the reader skips a w:object missing either attribute, so both are always written -- position is not written, since an inline flow object has none and the reader's own frame sits at the origin), and o:OLEObject names the payload part through its relationship. No VML preview picture (v:shape/v:imagedata) is emitted: the reader never read one into the model (no VML reader exists, and real producers ship WMF/EMF previews this ecosystem has no writer for), so there are no preview bytes to carry and regenerating one is out of scope -- Word shows the object as blank until activated. ProgID and DrawAspect are Word's own activation vocabulary; this package's reader reads only r:id.
function buildObjectElement(block: ContentEmbeddedObjectBlock, state: WriteState): XmlElement {
  const payload = embeddedPayloadOf(block.document, state);
  const relId = embeddedObjectRelationshipId(state, payload);
  return el('w:object', { 'w:dxaOrig': String(ptToTwips(block.frame.widthPt)), 'w:dyaOrig': String(ptToTwips(block.frame.heightPt)) }, [
    el('o:OLEObject', { Type: 'Embed', ProgID: payload.progId, DrawAspect: 'Content', 'r:id': relId }),
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

// CT_TrackChange's own w:id and w:author are both required attributes (ECMA-376's schema, not merely convention); w:date is optional. ProvenanceDescriptor.author is optional -- not every ContentDocument source records one -- so an absent author falls back to this rather than the writer omitting a required attribute. Each call mints its own w:id, since every tracked-change element (a paragraph mark's rPr/w:ins and the run wrapper around its content alike) needs a unique one, not one id shared across a whole multi-paragraph extent.
const UNKNOWN_PROVENANCE_AUTHOR = 'Unknown';

function trackChangeAttrs(state: WriteState, descriptor: ProvenanceDescriptor): Record<string, string> {
  const attrs: Record<string, string> = { 'w:id': String(state.nextMarkerId++), 'w:author': encodeXmlText(descriptor.author ?? UNKNOWN_PROVENANCE_AUTHOR) };
  if (descriptor.dateIso !== undefined) {
    attrs['w:date'] = encodeXmlText(descriptor.dateIso);
  }
  return attrs;
}

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
  const restored = restoreGalleryElement(descriptor);
  if (restored !== undefined) {
    children.push(restored);
    return el('w:sdtPr', {}, children);
  }
  const typeTag = SDT_TYPE_ELEMENT[descriptor.controlType];
  children.push(el(typeTag ?? 'w:richText'));
  return el('w:sdtPr', {}, children);
}

// The restorable tier's first consumer: a richText control that degraded from a docx gallery (constructs.ts) carries its w:docPartObj/w:docPartList element verbatim in descriptor.source, and this re-emits that element in place of the default w:richText type element -- the same-format pair loses the gallery name no longer. Re-serialising opaque residue text is re-emission, not interpretation (the channel's own contract), and the parse here is the honest inverse of the buildXml that minted the text -- a deserialisation of a value this package's own reader produced, not the hand-written-XML-string pattern src/xml/fragment.ts's convention exists to discourage. The gate is the mint condition exactly -- controlType 'richText', the only verdict constructs.ts ever attaches this residue to -- not residue shape alone, so a hand-built descriptor of any other controlType keeps its own semantic type element and the residue stays quarantined. One restoration site, one residue shape: docx residue of any other shape has no sdtPr spelling, and docx residue that does not parse as XML at all is malformed producer data (this package's own reader never mints unparseable text) and fails loudly rather than writing a control that silently pretends it carried none.
function restoreGalleryElement(descriptor: ContentControlDescriptor): XmlElement | undefined {
  if (descriptor.controlType !== 'richText') {
    return undefined;
  }
  const source = descriptor.source;
  if (source?.format !== 'docx') {
    return undefined;
  }
  let nodes: XmlNode[];
  try {
    nodes = parseXml(source.xml);
  } catch (error) {
    throw new Error(`buildDocxPackageFromContent: a content control carries docx residue that does not parse as XML: ${source.xml}`, { cause: error });
  }
  const first = nodes[0];
  if (nodes.length !== 1 || first?.type !== 'element' || (first.tag !== 'w:docPartObj' && first.tag !== 'w:docPartList')) {
    return undefined;
  }
  return first;
}

// The reader turns a matched marker pair back into a construct by bracket position, so the writer works from the same shape: the flat list is parsed into the nesting its brackets already describe, and each construct then chooses whether it is an element wrapping its extent (w:sdt, w:ins) or a pair of sibling markers around it (w:bookmarkStart/End) or characters injected into the extent's own paragraphs (a field).
type FlowItem = { readonly kind: 'block'; readonly block: ContentBlock } | { readonly kind: 'construct'; readonly descriptor: ConstructDescriptor; readonly children: FlowItem[] };

function parseFlow(blocks: readonly ContentBlock[]): FlowItem[] {
  const imbalance = findConstructMarkerImbalance(blocks);
  if (imbalance !== undefined) {
    throw new Error(`buildDocxPackageFromContent: construct markers do not balance (${imbalance.kind} at block ${String(imbalance.index)})`);
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

// `provenance` is the ambient tracked change, if any, this construct sits inside -- a bookmark, content control, or field nested inside a tracked-change range does not interrupt that change, since it wraps at a different level (block-sibling markers, or an element around the extent) that coexists with the change wrapping the paragraphs' own marks and runs underneath. Every branch but the provenance one itself threads the ambient value straight through to whatever paragraphs its own content eventually reaches; the provenance branch replaces it with its own descriptor for its own extent, the ordinary nesting rule for two constructs of the same kind.
function buildConstructNodes(descriptor: ConstructDescriptor, children: FlowItem[], state: WriteState, deleted: boolean, provenance: ProvenanceDescriptor | undefined): XmlNode[] {
  if (descriptor.kind === 'contentControl') {
    return [el('w:sdt', {}, [buildSdtProperties(descriptor), el('w:sdtContent', {}, buildFlowItems(children, state, deleted, provenance))])];
  }
  if (descriptor.kind === 'provenance') {
    const tag = TRACKED_CHANGE_TAG_BY_CHANGE[descriptor.change];
    if (tag !== undefined) {
      // No block-level element here: buildParagraph wraps each paragraph's own runs in `tag` instead, threading this descriptor through so every paragraph in the extent -- one or many -- carries the same change on both its runs and its own paragraph mark.
      return buildFlowItems(children, state, deleted || isDeletedChange(descriptor.change), descriptor);
    }
  }
  if (descriptor.kind === 'anchor' && descriptor.anchorType === 'bookmark') {
    const id = String(state.nextMarkerId++);
    return [
      el('w:bookmarkStart', { 'w:id': id, 'w:name': encodeXmlText(descriptor.name) }),
      ...buildFlowItems(children, state, deleted, provenance),
      el('w:bookmarkEnd', { 'w:id': id }),
    ];
  }
  if (descriptor.kind === 'field') {
    return buildFieldNodes(descriptor.instruction, buildFlowItems(children, state, deleted, provenance));
  }
  return buildFlowItems(children, state, deleted, provenance);
}

// `provenance` propagates a tracked change down to the paragraphs it wraps so each paragraph's own mark -- and its own runs -- carry the same change; it flows straight through a nested non-provenance construct (buildConstructNodes threads it on), since a bookmark or content control nested inside a tracked-change range does not interrupt the change, and only stops where a nested provenance construct replaces it with its own descriptor for its own extent.
//
// `pendingPageBreak` carries a still-unattached w:pageBreakBefore forward across sibling items in `items`, since the paragraph that break belongs to may not be the very next item: it can be inside a nested construct (a page-break-before paragraph that also opens a bookmark or tracked change), or there may be no paragraph at all before the next table or image. The construct branch below re-delegates a pending break into that construct's own children (as a synthetic leading pageBreak block) so the same paragraph-attachment logic finds it however deep it is nested; the table and image branches, which cannot carry w:pageBreakBefore themselves, materialise it as their own leading empty paragraph instead.
function buildFlowItems(items: readonly FlowItem[], state: WriteState, deleted: boolean, provenance: ProvenanceDescriptor | undefined): XmlNode[] {
  const nodes: XmlNode[] = [];
  let pendingPageBreak = false;
  let lastParagraph: XmlElement | undefined;
  let availableImageRuns: XmlElement[] = [];
  for (const item of items) {
    if (item.kind === 'construct') {
      const pageBreakItem: FlowItem = { kind: 'block', block: { kind: 'pageBreak' } };
      const constructChildren = pendingPageBreak ? [pageBreakItem, ...item.children] : item.children;
      nodes.push(...buildConstructNodes(item.descriptor, constructChildren, state, deleted, provenance));
      pendingPageBreak = false;
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
      const paragraph = buildParagraph(block, state, pendingPageBreak, deleted, provenance);
      pendingPageBreak = false;
      lastParagraph = paragraph;
      availableImageRuns = trailingEmptyRunElements(block, paragraph);
      nodes.push(paragraph);
      continue;
    }
    if (block.kind === 'image') {
      if (pendingPageBreak) {
        const breakParagraph = el('w:p', {}, [el('w:pPr', {}, [el('w:pageBreakBefore')])]);
        nodes.push(breakParagraph);
        lastParagraph = breakParagraph;
        availableImageRuns = [];
        pendingPageBreak = false;
      }
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
      if (pendingPageBreak) {
        nodes.push(el('w:p', {}, [el('w:pPr', {}, [el('w:pageBreakBefore')])]));
        pendingPageBreak = false;
      }
      nodes.push(buildTable(block, state, deleted));
      lastParagraph = undefined;
      availableImageRuns = [];
      continue;
    }
    // The embedded-object inverse of readParagraphLiftedBlocks: the reader lifted the w:object out of the paragraph that contained it as a sibling block, so the writer puts it back into that paragraph's trailing empty run (the run an object-only w:r reads back as), falling back to a fresh run on the last paragraph or a paragraph of its own -- the same placement ladder an image follows, since both were lifted by the same convention. A pending page break is materialised first because a w:object cannot carry w:pageBreakBefore itself, exactly as for an image.
    if (block.kind === 'embeddedObject') {
      if (pendingPageBreak) {
        const breakParagraph = el('w:p', {}, [el('w:pPr', {}, [el('w:pageBreakBefore')])]);
        nodes.push(breakParagraph);
        lastParagraph = breakParagraph;
        availableImageRuns = [];
        pendingPageBreak = false;
      }
      const object = buildObjectElement(block, state);
      const reusable = availableImageRuns.shift();
      if (reusable !== undefined) {
        reusable.children.push(object);
      } else if (lastParagraph !== undefined) {
        lastParagraph.children.push(el('w:r', {}, [object]));
      } else {
        const paragraph = el('w:p', {}, [el('w:r', {}, [object])]);
        lastParagraph = paragraph;
        nodes.push(paragraph);
      }
      continue;
    }
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
  // CT_SectPr's own child sequence puts w:type before w:pgSz, so an emitted break kind lands ahead of the geometry it qualifies. An absent breakType writes no w:type at all: that absence IS WordprocessingML's own nextPage default, and spelling it would turn "no break kind declared" into "break kind declared as the default" on the way back in.
  const type = section.breakType === undefined ? [] : [el('w:type', { 'w:val': section.breakType })];
  return el('w:sectPr', {}, [
    ...type,
    el('w:pgSz', { 'w:w': String(ptToTwips(section.pageSize.widthPt)), 'w:h': String(ptToTwips(section.pageSize.heightPt)) }),
    el('w:pgMar', {
      'w:top': String(ptToTwips(section.margins.topPt)),
      'w:right': String(ptToTwips(section.margins.rightPt)),
      'w:bottom': String(ptToTwips(section.margins.bottomPt)),
      'w:left': String(ptToTwips(section.margins.leftPt)),
    }),
  ]);
}

// A mid-document section break rides on the last paragraph of the section it closes -- the shape readSections reads it back from, which keeps that paragraph as content rather than adding one. That paragraph is not necessarily nodes' own last element: a bookmark closing the section trails a childless w:bookmarkEnd marker, and a content control closing it wraps its content in w:sdt, so findParagraph (searching from the end, the same way buildFieldNodes locates a field's own paragraphs) descends through whatever construct wrapper sits last to find the real one. Only the final section's w:sectPr is a direct child of w:body; a section with no paragraph anywhere in its flow gets an empty one to carry the break.
function attachSectionBreak(nodes: XmlNode[], section: ContentSection): void {
  const target = findParagraph(nodes, true);
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
      'xmlns:o': VML_OFFICE_NS,
      'xmlns:w14': W14_NS,
      'xmlns:w15': W15_NS,
      'mc:Ignorable': 'w14 w15',
    },
    [el('w:body', {}, bodyChildren)],
  );
  return xmlPart(root);
}

// --- package scaffolding ----------------------------------------------------------------------------------------------

// The embeddings parts are declared per part (Override) rather than per extension (Default): each carries the content type of the format the nested document serialised into, and an Override names exactly the part written without making any claim about other files sharing its extension elsewhere in someone else's package.
function buildContentTypesPart(state: WriteState): XmlPart {
  const mediaFormats = new Set([...state.mediaParts.values()].map((media) => media.format));
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
  const embeddingOverrides = [...state.embeddingParts].map(([name, payload]) =>
    el('Override', { PartName: `/word/embeddings/${name}`, ContentType: EMBEDDED_PART_CONTENT_TYPES[payload.extension] }),
  );
  const root = el('Types', { xmlns: CONTENT_TYPES_NS }, [
    ...defaults,
    el('Override', { PartName: `/${DOCUMENT_PART_PATH}`, ContentType: CT_DOCUMENT }),
    el('Override', { PartName: '/docProps/core.xml', ContentType: CT_CORE_PROPS }),
    el('Override', { PartName: '/docProps/app.xml', ContentType: CT_EXTENDED_PROPS }),
    ...embeddingOverrides,
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

// ContentSection[] (plus optional document metadata) -> a complete docx Package, built part by part rather than edited into an existing one. The read-side inverse is readDocxContent; see this module's own header for exactly what survives the pair and what does not.
export function buildDocxPackageFromContent(content: DocxContent, options?: BuildDocxContentOptions): Package {
  const state = newWriteState(options);
  const sections = content.sections.length === 0 ? [{ pageSize: { widthPt: 612, heightPt: 792 }, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 }, blocks: [] }] : content.sections;
  // The document part is built first so every hyperlink and image relationship it needs already exists by the time the relationship and content-type parts are written.
  const documentPart = buildDocumentPart(sections, state);
  const metadata = content.metadata ?? {};
  const parts: Package['parts'] = {
    '[Content_Types].xml': buildContentTypesPart(state),
    '_rels/.rels': buildPackageRelsPart(),
    [DOCUMENT_PART_PATH]: documentPart,
    'word/_rels/document.xml.rels': buildDocumentRelsPart(state),
    'docProps/core.xml': buildCorePropertiesPart(metadata),
    'docProps/app.xml': buildExtendedPropertiesPart(metadata),
  };
  for (const [name, media] of state.mediaParts) {
    parts[`word/media/${name}`] = { kind: 'binary', base64: media.base64 };
  }
  for (const [name, payload] of state.embeddingParts) {
    parts[`word/embeddings/${name}`] = { kind: 'binary', base64: payload.base64 };
  }
  return { parts };
}
