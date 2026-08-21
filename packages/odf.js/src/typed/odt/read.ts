import type { Box, ContentBlock, ContentDocument, ContentParagraph, ContentSection, DefinitionsTable, DocumentPackage, LayoutMetadata, Margins, PageSize, ProvenanceDescriptor } from 'document-schema.js';
import { assemblePackage, PAGE_SIZE_A4 } from 'document-schema.js';
import type { Package } from '../../model/package';
import type { XmlElement, XmlNode } from '../../model/node';
import { rootElement, findChildElement, childrenWithTag, attrValue } from '../../xml/query';
import { mintOdfListNumId, readOdfListParagraphs, type OdfListIdState } from '../shared/list';
import {
  collectOdfDataStyleDefinitions,
  collectOdfFieldMasterDefinitions,
  collectOdfFontFaceDefinitions,
  collectOdfProvenanceRegions,
  insertOdfConstructMarkers,
  isOdfIndexWrapper,
  odfDivisionDescriptor,
  odfIndexControlDescriptor,
  odfMarkerHalfEventIndex,
  resolveOdfMarkerEvents,
  type OdfConstructExtent,
  type OdfDefinitionsSink,
  type OdfMarkerEvent,
  type OdfMarkerHalf,
} from '../shared/constructs';
import { readOdfParagraph, readOdfParagraphPageBreaks } from '../shared/paragraph';
import { readOdfFormControlConstructs } from '../shared/forms';
import { readOdfTable } from '../shared/table';
import { readOdfMetadata } from '../shared/metadata';
import { readOdfMasterPageDefinitions } from '../shared/masterpage';
import { parsePageSize, parseMargins } from '../shared/geometry';
import { parseOdfLength } from '../shared/units';
import { readDrawFrame } from '../draw/shapes';
import { readDrawObjectReference, readOdfChartContent, type EmbeddedDrawObject } from '../draw/embedded';
import { readOdfFormulaContent } from '../formula/read';
import { readOdgContent } from '../odg/read';
import { readOdpContent } from '../odp/read';

// Package -> OdtDocument: the first end-to-end ODF content reader, producing GENUINE ContentSection[] values (document-schema.js's own pivot type, the one documents.js's docx flow/pagination engine already consumes) from a real .odt package. This is the concrete proof of the whole odf.js architectural bet -- that odt and docx can share one pivot and one layout algorithm despite being completely unrelated XML formats -- so every mapping below is deliberately expressed in terms document-schema.js already defines, never a lookalike shape of its own.
//
// This reader is deliberately thin: paragraph/run reading (readOdfParagraph) and table reading (readOdfTable) already live in typed/shared/ -- built for reuse across odt/ods/odp/odg, not odt-specific -- so this module's own job is the odt-SPECIFIC structure those shared readers have no opinion on: walking office:text's actual block sequence (paragraphs interleaved with lists and tables, in document order), mapping text:h's own text:outline-level onto a docx-equivalent styleId alongside document-schema.js's own headingLevel field, and resolving the document's own page geometry from its first master page. readOdfParagraph is tag-agnostic (it never inspects which tag its own caller found it at) and reads text:h exactly as it reads text:p, so this reader calls straight through to it for both, then overrides ONLY the resulting heading identity (styleId plus headingLevel) for a heading -- see readParagraphOrHeading below.
//
// SCOPE -- the fidelity construct rows (ExaDev/documents.js#719) are read: fields as run-level constructs with their cached text, bookmarks and tracked changes at both run and block scope, notes and annotations as anchors with definitions-table bodies, text:section as a division, the index wrappers as index content controls with their cached bodies, office:forms as content controls, and anchored draw:frames lifted from text flow (images, text boxes, and embedded formula/drawing/presentation/chart objects). Still deliberately narrow, matching ooxml.js's own readDocx's established gaps: header/footer content (real block content keyed to master pages, riding the master-page work rather than a construct kind), explicit page breaks (fo:break-before/fo:break-after -- not modelled by styles/properties.ts's StyleProperties, so the cascade this reader relies on can't surface them; a genuinely separate, bounded follow-on), documents with more than one master page (only the first is read, in document order -- see readFirstMasterPageGeometry below), cross-references beyond their bookmark spines (text:reference-mark* and the *-ref display family), and a spreadsheet OLE-embedded in a Writer document (it degrades to the frame's ObjectReplacements preview -- reading it would import ods's reader into this one, the reader cycle typed/draw/embedded.ts's own note refuses to mint). A text:h or a nested text:list/text:table inside a table cell is also out of scope here, inherited directly from readOdfTable's own cell reading (table:table-cell content there is read as text:p only) -- not a gap introduced by this module. List marker GLYPHS (the exact bullet character or number format string) remain unread -- only the ordered-vs-bullet KIND is resolved (see typed/shared/list.ts's resolveOdfListKind), since that is what downstream consumers need to render <ol> vs <ul>.
//
// LIST HANDLING: the numId minting convention (a monotonically increasing per-encounter counter, never text:style-name), the ordered:/bullet: kind prefix, and the text:list/text:list-item structural nesting walk itself all live in typed/shared/list.ts -- read that module's own top-of-file notes in full for the derivation -- because the odp reader meets the IDENTICAL text:list construct inside slide text frames and shares every line of it. This reader's own remaining list responsibility is the one genuinely odt-specific part: threading a single document-wide OdfListIdState through its office:text walk, so list identities are unique across the whole body exactly as they are across a whole presentation's slides.

// Options for both reader levels. `frames` decides who reads an anchored draw:frame in text flow: 'lift' (the default) is this reader's own native reading -- an image frame contributes its image block after its paragraph, an object frame its embedded-object block, a text-box frame its content blocks -- while 'none' contributes nothing for frames at all, for a CONSUMER that runs its own frame-detection passes over the same package and would otherwise read every frame twice. documents.js is that consumer today: its odt adapter's formula/image/vector passes carry the richer placement semantics (a formula-only paragraph consumed rather than followed, deep walks into table cells and nested groups, slide-index placement for odp), built when this reader did not read frames at all; opting out keeps those passes exact rather than forcing this reader to replicate every one of their placements before it can read a single frame.
export interface OdtReadOptions {
  frames?: 'lift' | 'none';
}

export interface OdtDocument {
  metadata: LayoutMetadata;
  sections: ContentSection[];
  // The package-level definitions table this document's content references: field master declarations, note and comment bodies, the styles-side definition tenants. Present only when the document carries at least one entry -- the flat ContentDocument has no root to hold a definitions table, so this field is how the table reaches readOdt's assembled package root without changing the flat exchange shape.
  definitions?: DefinitionsTable;
}

const CONTENT_PART = 'content.xml';
const STYLES_PART = 'styles.xml';
const AUTOMATIC_STYLE_PARTS = [CONTENT_PART, STYLES_PART] as const;

// text:outline-level's ODF schema default when the attribute is absent is 1 (OASIS ODF 1.2 part 1); an unparseable or non-positive value degrades to the same default rather than throwing, matching this reader's general "malformed-but-salvageable input degrades gracefully" posture (readOdtContent itself has no diagnostics channel to report it through).
function readOutlineLevel(headingElement: XmlElement): number {
  const raw = attrValue(headingElement, 'text:outline-level');
  if (raw === undefined) {
    return 1;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

// text:h/text:p -> ContentParagraph identity: the shared reader (typed/shared/paragraph.ts) is tag-agnostic, so it reads a text:h's style/run content exactly as it would a text:p's. The one thing it can't know is odt's own heading convention: a heading's real @text:style-name (e.g. "Heading_20_1") is a producer-chosen ODF string with no cross-format meaning, so this function overrides ONLY the heading identity for a text:h, synthesising the same "Heading1"/"Heading2" shape docx's own real w:pStyle values already use for its built-in heading styles -- giving downstream consumers (documents.js's layout engine, or anything else keying off styleId) one consistent heading convention across both formats -- while the parsed text:outline-level number itself is kept as headingLevel, document-schema.js's canonical numeric heading field, so numeric consumers never have to parse it back out of the styleId string. List membership is never set here: the shared walker (typed/shared/list.ts's readOdfListParagraphs) attaches it for paragraphs it reads inside a text:list, since ODF list membership is purely structural (which text:list/text:list-item this element is nested inside), never an attribute on the paragraph element itself the way docx's w:numPr is.
function readParagraphOrHeading(element: XmlElement, paragraph: ContentParagraph): ContentParagraph {
  if (element.tag === 'text:h') {
    const outlineLevel = readOutlineLevel(element);
    paragraph.styleId = `Heading${outlineLevel}`;
    // The parsed text:outline-level number itself is the schema's canonical headingLevel (schema #13): styleId encodes it for styleId-keyed consumers, headingLevel carries it verbatim for numeric consumers, and both always agree because they derive from this one parse.
    paragraph.headingLevel = outlineLevel;
  }
  return paragraph;
}

// The walk state one document's block flow threads: the list-identity counter, the tracked-change regions its markers resolve against, the wrapper extents (divisions, index controls) discovered so far, the marker events promoted from paragraph-edge halves, and the discovery-order counter that keeps extent resolution deterministic.
interface OdtFlowState {
  readonly listIdState: OdfListIdState;
  readonly provenanceRegions: ReadonlyMap<string, ProvenanceDescriptor>;
  readonly definitions: OdfDefinitionsSink;
  readonly wrapperExtents: OdfConstructExtent[];
  readonly markerEvents: OdfMarkerEvent[];
  readonly liftFrames: boolean;
  order: number;
}

// One read paragraph plus the element it came from and the marker halves its run walk reported -- the triple the block flow needs to place each paragraph's edge-half events at the paragraph's own block index. `lifted` carries the blocks the paragraph's own anchored draw:frames contribute, emitted after the paragraph the way ooxml.js's docx reader lifts a paragraph's w:drawing/w:object media as sibling blocks -- ContentRun has no field for in-flow frames, so block-level document order is preserved at the cost of each frame's exact character position.
// One anchored-frame source's contribution to the blocks lifted after its paragraph: the paragraph's direct child the frames were read from (a draw:frame, or a draw:g group standing in for its frame children) and the blocks that child lifted, kept beside the source element so a trailing marker half's block index can be advanced past exactly the frames that physically precede the half in the paragraph's own child order.
interface LiftedFrameSource {
  readonly child: XmlElement;
  readonly blocks: ContentBlock[];
}

interface ReadParagraph {
  readonly element: XmlElement;
  readonly paragraph: ContentParagraph;
  readonly halves: OdfMarkerHalf[];
  readonly liftedSources: readonly LiftedFrameSource[];
}

// An embedded sub-document referenced from a Writer frame -> the ContentDocument its kind dispatches to. Every kind resolves EXCEPT 'spreadsheet': reading an embedded ods would import ods's reader, which imports this module -- the exact reader cycle typed/draw/embedded.ts's own top-of-file note refuses to mint -- so a Calc sheet OLE-embedded in a Writer document degrades to the frame's ObjectReplacements preview image instead of its live content, and the cycle-free split stays the family's stated architecture.
function readOdtEmbeddedDocument(reference: EmbeddedDrawObject, frame: Box): ContentDocument | undefined {
  switch (reference.objectKind) {
    case 'wordprocessing': {
      const { metadata, sections } = readOdtContent(reference.package);
      return { kind: 'wordprocessing', metadata, sections };
    }
    case 'presentation': {
      const { metadata, slides } = readOdpContent(reference.package);
      return { kind: 'presentation', metadata, slides };
    }
    case 'drawing': {
      const { metadata, pages } = readOdgContent(reference.package);
      return { kind: 'drawing', metadata, pages };
    }
    case 'formula':
      return readOdfFormulaContent(reference.package);
    case 'chart':
      return readOdfChartContent(reference.package, frame, 'odt').document;
    case 'spreadsheet':
      return undefined;
  }
}

// One paragraph's own anchored draw:frame children (flattening any draw:g group exactly as ods's cell-anchored walker does) -> the blocks they contribute after the paragraph, grouped by the direct child they were lifted from. A frame resolving an embedded object becomes a ContentEmbeddedObjectBlock at the frame's own geometry (chart objects additionally quarantine the chart element in residue); any other frame contributes its own content blocks -- a text box's paragraphs, a table frame's table, an image frame's image -- spliced in frame document order, with the frame's own position recorded only where a target node carries geometry (the embedded object's frame and the image block's size); a text box's position is a real, documented narrowing.
function readAnchoredFrameSources(paragraphElement: XmlElement, pkg: Package, state: OdtFlowState): LiftedFrameSource[] {
  if (!state.liftFrames) {
    return [];
  }
  const sources: LiftedFrameSource[] = [];
  const readFrameInto = (blocks: ContentBlock[], frameElement: XmlElement): void => {
    const shape = readDrawFrame(frameElement, [], pkg, state.listIdState, true);
    if (shape === undefined) {
      return;
    }
    const reference = readDrawObjectReference(frameElement, pkg);
    if (reference?.objectKind === 'chart') {
      const { document, residue } = readOdfChartContent(reference.package, shape.frame, 'odt');
      const embeddedBlock: ContentBlock = { kind: 'embeddedObject', objectKind: 'chart', document, frame: shape.frame };
      if (residue !== undefined) {
        embeddedBlock.source = residue;
      }
      blocks.push(embeddedBlock);
      return;
    }
    if (reference !== undefined) {
      const document = readOdtEmbeddedDocument(reference, shape.frame);
      if (document !== undefined) {
        blocks.push({ kind: 'embeddedObject', objectKind: reference.objectKind, document, frame: shape.frame });
        return;
      }
    }
    blocks.push(...shape.blocks);
  };
  for (const child of paragraphElement.children) {
    if (child.type !== 'element') {
      continue;
    }
    if (child.tag === 'draw:frame') {
      const blocks: ContentBlock[] = [];
      readFrameInto(blocks, child);
      if (blocks.length > 0) {
        sources.push({ child, blocks });
      }
    } else if (child.tag === 'draw:g') {
      const blocks: ContentBlock[] = [];
      for (const grandChild of child.children) {
        if (grandChild.type === 'element' && grandChild.tag === 'draw:frame') {
          readFrameInto(blocks, grandChild);
        }
      }
      if (blocks.length > 0) {
        sources.push({ child, blocks });
      }
    }
  }
  return sources;
}

// How many of a paragraph's lifted-frame blocks physically precede a marker half: the blocks a trailing half's block extent must cover (and only those -- a frame anchored AFTER the half sits outside its physical range, even though a draw:frame is not "content" for the paragraph-edge test, so it must stay excluded). Returns 0 for a half that is not a direct child of the paragraph at all (its event index is undefined regardless of the offset).
function liftedBlocksBeforeHalf(read: ReadParagraph, half: XmlElement): number {
  const halfIndex = read.element.children.indexOf(half);
  if (halfIndex === -1) {
    return 0;
  }
  let count = 0;
  for (const source of read.liftedSources) {
    if (read.element.children.indexOf(source.child) < halfIndex) {
      count += source.blocks.length;
    }
  }
  return count;
}

// Walks block-level content (text:p, text:h, text:list, table:table) in document order, at ONE nesting level -- office:text's own top-level children, or a construct wrapper's own children. text:section records a division extent over its own blocks (descriptor: name, protected flag, the column count its own style sets, and the external-chapter link of a text:section-source); the index wrappers (text:table-of-content and its six siblings) record index contentControl extents over their cached text:index-body blocks; text:index-title unwraps transparently -- the title is one of the cached blocks, not a wrapper of its own. Every extent -- wrapper or marker pair -- is spliced into markers by ONE pass at the end of the walk (insertOdfConstructMarkers, in readOdtContent below), so a pair crossing another extent is dropped by that pass rather than emitted as markers that would decode to a nesting the source never had. text:tracked-changes and the text:*-decls containers contribute no blocks: their regions and declarations were collected before the walk and live in the state and the definitions table. Anything else (an office:forms, an anchored draw:frame, text:soft-page-break, ...) is not walked here -- see the scope note at the top of this file for which of those are deliberate gaps. Table CELL content is not walked here at all -- readOdfTable owns that entirely (see this file's own top-of-file note on the scope it inherits from doing so).
function readBlocks(nodes: readonly XmlNode[], pkg: Package, state: OdtFlowState, baseIndex = 0): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  // Paragraph-half events are recorded only once each paragraph's final block index is known -- an index in the ONE flat block list the caller will splice markers into, hence the baseIndex offset every recursive wrapper call threads in (a wrapper's own children build their blocks in this call's local array, but their marker events must name positions in the enclosing list). The same offset applies to the wrapper branches' own extents: a nested wrapper's startIndex/endIndex are recorded against the enclosing flat list (baseIndex + the local array length), never the local array alone, or a wrapper nested after a preceding sibling would bracket blocks that precede it. That is also why every paragraph path funnels through here rather than recording inside the reader callback: the list walker runs all its callbacks before a single block is pushed, so a callback-time index would be the same for every item of the list.
  const emitParagraphs = (reads: readonly ReadParagraph[]): void => {
    let cursor = baseIndex + blocks.length;
    for (const read of reads) {
      const lifted = read.liftedSources.flatMap((source) => source.blocks);
      // The paragraph's own explicit page breaks, resolved from its style chain -- emitted as pageBreak blocks immediately beside the paragraph (before for break-before, after the paragraph AND its lifted frames for break-after, since a break-after means "after this paragraph's content" and the lifted frames are that content). The leading block shifts the paragraph's own index, so the marker-half events below are indexed from the post-break position.
      const breaks = readOdfParagraphPageBreaks(read.element, pkg);
      const paragraphIndex = cursor + (breaks.before ? 1 : 0);
      for (const half of read.halves) {
        const eventIndex = odfMarkerHalfEventIndex(half, read.element, paragraphIndex, liftedBlocksBeforeHalf(read, half.element));
        if (eventIndex !== undefined) {
          state.markerEvents.push({ kind: half.kind, side: half.side, key: half.key, index: eventIndex, qualified: true, order: state.order++, descriptor: half.descriptor, element: half.element });
        }
      }
      if (breaks.before) {
        blocks.push({ kind: 'pageBreak' });
      }
      blocks.push(read.paragraph);
      for (const block of lifted) {
        blocks.push(block);
      }
      if (breaks.after) {
        blocks.push({ kind: 'pageBreak' });
      }
      cursor += (breaks.before ? 1 : 0) + 1 + lifted.length + (breaks.after ? 1 : 0);
    }
  };
  const readOneParagraph = (element: XmlElement): ReadParagraph => {
    const halves: OdfMarkerHalf[] = [];
    const paragraph = readOdfParagraph(element, pkg, { provenanceRegions: state.provenanceRegions, markersOut: halves, definitions: state.definitions, listIdState: state.listIdState, format: 'odt' });
    return { element, paragraph: readParagraphOrHeading(element, paragraph), halves, liftedSources: readAnchoredFrameSources(element, pkg, state) };
  };
  for (const node of nodes) {
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'text:p' || node.tag === 'text:h') {
      emitParagraphs([readOneParagraph(node)]);
    } else if (node.tag === 'text:list') {
      const numId = mintOdfListNumId(pkg, node, state.listIdState);
      const reads: ReadParagraph[] = [];
      readOdfListParagraphs(node, { numId, level: 0 }, (element) => {
        const read = readOneParagraph(element);
        reads.push(read);
        return read.paragraph;
      });
      emitParagraphs(reads);
    } else if (node.tag === 'table:table') {
      blocks.push(readOdfTable(node, pkg));
    } else if (node.tag === 'text:section') {
      const startIndex = baseIndex + blocks.length;
      const order = state.order++;
      blocks.push(...readBlocks(node.children, pkg, state, startIndex));
      state.wrapperExtents.push({ startIndex, endIndex: baseIndex + blocks.length, order, descriptor: odfDivisionDescriptor(node, pkg) });
    } else if (isOdfIndexWrapper(node)) {
      const startIndex = baseIndex + blocks.length;
      const order = state.order++;
      const body = node.children.find((child): child is XmlElement => child.type === 'element' && child.tag === 'text:index-body');
      blocks.push(...(body === undefined ? [] : readBlocks(body.children, pkg, state, startIndex)));
      state.wrapperExtents.push({ startIndex, endIndex: baseIndex + blocks.length, order, descriptor: odfIndexControlDescriptor(node) });
    } else if (node.tag === 'text:index-title') {
      blocks.push(...readBlocks(node.children, pkg, state, baseIndex + blocks.length));
    } else if (node.tag === 'office:forms') {
      // Form controls in an ordinary text document: point contentControl constructs in pre-order, through the same form-tree walker the odb reader uses (typed/shared/forms.ts). ODF form controls have no rendered block extent -- their geometry lives in the drawing layer's draw:control elements, which no reader resolves -- so these are point pairs, safe to emit directly: a marker sequence is transparent to the bracket-matching splice pass, which counts them as blocks at their own indices.
      blocks.push(...readOdfFormControlConstructs(node, 'odt'));
    }
  }
  return blocks;
}

function parseKnownOdfLength(value: string): number {
  const parsed = parseOdfLength(value);
  if (parsed === undefined) {
    throw new Error(`readOdtContent: internal error -- "${value}" is not a valid ODF length literal`);
  }
  return parsed;
}

const DEFAULT_MARGIN_PT = parseKnownOdfLength('2cm');
const DEFAULT_MARGINS: Margins = { topPt: DEFAULT_MARGIN_PT, rightPt: DEFAULT_MARGIN_PT, bottomPt: DEFAULT_MARGIN_PT, leftPt: DEFAULT_MARGIN_PT };

// A style:page-layout can live in either part's own office:automatic-styles (verified against real LibreOffice output) -- mirroring readOdpContent's own findPageLayoutElement (typed/odp/read.ts), which searches both content.xml and styles.xml for the identical reason (and cascade.ts's own collectStyles, which does the same for style:style/style:default-style). Duplicated here in full, deliberately, rather than importing readOdpContent's own private helper: this reader's own "first master page in document order" master-page selection differs enough from readOdpContent's own per-slide draw:master-page-name lookup that sharing just the page-layout half would leave the master-page half split across two modules for no real gain -- and readOdpContent's own findPageLayoutElement was never exported for reuse in the first place.
function findPageLayoutElement(pkg: Package, pageLayoutName: string | undefined): XmlElement | undefined {
  if (pageLayoutName === undefined) {
    return undefined;
  }
  for (const partPath of AUTOMATIC_STYLE_PARTS) {
    const part = pkg.parts[partPath];
    if (part?.kind !== 'xml') {
      continue;
    }
    const root = rootElement(part.nodes);
    const automaticStyles = root === undefined ? undefined : findChildElement(root.children, 'office:automatic-styles');
    if (automaticStyles === undefined) {
      continue;
    }
    const found = childrenWithTag(automaticStyles, 'style:page-layout').find((element) => attrValue(element, 'style:name') === pageLayoutName);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

// Reads the FIRST style:master-page (styles.xml's office:master-styles, in document order) and its associated style:page-layout into PageSize/Margins, via geometry.ts's own parsing helpers. A document with more than one master page (a mid-document page-style change, e.g. switching to a landscape layout partway through) has every master page AFTER the first silently ignored -- a deliberate, tracked scope gap, not an oversight: ODF's own multi-master-page mechanism doesn't correspond to anything ContentSection currently models (one ContentSection carries exactly one pageSize/margins pair for its own blocks), and building that mapping is genuinely separate, larger work from this reader's own current job of proving the single-section, single-page-layout path end to end.
//
// ODF/LibreOffice's own out-of-the-box defaults for a freshly created, unmodified text document -- confirmed directly against a real Writer document's own style:page-layout-properties (21cm x 29.7cm page, 2cm margins on every side) -- used only when a package's styles.xml is missing, malformed, or has no master page/page layout this reader can resolve. Deliberately A4-based rather than reusing document-schema.js's own PAGE_SIZE_LETTER convention (which ooxml.js's docx reader falls back to): Word's real default is genuinely Letter-sized, but ODF/LibreOffice's real default is genuinely A4-sized, so each reader's own fallback should reflect the format it actually reads, not a single cross-format constant -- mirroring readOdpContent's own SLIDE_SIZE_WIDESCREEN fallback choice for the same reason.
function readFirstMasterPageGeometry(pkg: Package): { pageSize: PageSize; margins: Margins } {
  const stylesPart = pkg.parts[STYLES_PART];
  const stylesRoot = stylesPart?.kind === 'xml' ? rootElement(stylesPart.nodes) : undefined;
  const masterStyles = stylesRoot === undefined ? undefined : findChildElement(stylesRoot.children, 'office:master-styles');
  const masterPage = masterStyles === undefined ? undefined : findChildElement(masterStyles.children, 'style:master-page');
  const layoutName = masterPage === undefined ? undefined : attrValue(masterPage, 'style:page-layout-name');
  const layout = findPageLayoutElement(pkg, layoutName);
  const properties = layout === undefined ? undefined : findChildElement(layout.children, 'style:page-layout-properties');

  const pageSize = properties === undefined ? undefined : parsePageSize(properties);
  const margins = properties === undefined ? undefined : parseMargins(properties);

  return {
    pageSize: pageSize ?? PAGE_SIZE_A4,
    margins: margins ?? DEFAULT_MARGINS,
  };
}

// Package -> OdtDocument. Throws only when content.xml itself, or its own office:body/office:text element, is missing -- a genuinely unusable package, mirroring exactly how ooxml.js's own readDocx throws when word/document.xml or its w:body is missing, rather than degrading gracefully the way a merely malformed or absent OPTIONAL part (meta.xml, styles.xml, an individual style reference) does throughout the rest of this reader.
export function readOdtContent(pkg: Package, options: OdtReadOptions = {}): OdtDocument {
  const contentPart = pkg.parts[CONTENT_PART];
  if (contentPart?.kind !== 'xml') {
    throw new Error(`readOdtContent: package has no ${CONTENT_PART} part`);
  }
  const contentRoot = rootElement(contentPart.nodes);
  const body = contentRoot === undefined ? undefined : findChildElement(contentRoot.children, 'office:body');
  const textElement = body === undefined ? undefined : findChildElement(body.children, 'office:text');
  if (textElement === undefined) {
    throw new Error(`readOdtContent: ${CONTENT_PART} has no office:body/office:text element`);
  }

  const metadata = readOdfMetadata(pkg);
  const { pageSize, margins } = readFirstMasterPageGeometry(pkg);

  // The document-level collections the block walk resolves against, gathered first because a marker anywhere in the body may reference a declaration or region stated anywhere else in it: tracked-change regions (id-keyed), the definitions sink note and annotation bodies mint into, and the field master declarations (keys namespaced per family).
  const provenanceRegions = new Map<string, ProvenanceDescriptor>();
  collectOdfProvenanceRegions(textElement.children, provenanceRegions);
  const definitions: OdfDefinitionsSink = { entries: {}, nextNoteOrdinal: 1, nextAnnotationOrdinal: 1 };
  collectOdfFieldMasterDefinitions(textElement.children, definitions.entries);
  // The styles-side definition tenants live in EITHER part: number:* data styles and font declarations are collected across both parts' whole node forests, since office:font-face-decls genuinely appears in each part and data styles are residents of whichever automatic-styles container references them.
  for (const partPath of AUTOMATIC_STYLE_PARTS) {
    const part = pkg.parts[partPath];
    if (part?.kind !== 'xml') {
      continue;
    }
    collectOdfDataStyleDefinitions(part.nodes, definitions.entries);
    collectOdfFontFaceDefinitions(part.nodes, definitions.entries);
  }

  const state: OdtFlowState = { listIdState: { next: 1 }, provenanceRegions, definitions, wrapperExtents: [], markerEvents: [], liftFrames: options.frames !== 'none', order: 0 };
  const walked = readBlocks(textElement.children, pkg, state);
  const { extents: markerExtents, paired } = resolveOdfMarkerEvents(state.markerEvents);
  const extents: OdfConstructExtent[] = [...state.wrapperExtents, ...markerExtents];
  // The block-scope twin of the paragraph reader's unpaired-annotation fallback: an annotation half that reached a paragraph edge but never met its office:annotation-end becomes a point construct at that block position, because the end element is optional and a single-position comment needs none.
  for (const event of state.markerEvents) {
    if (event.kind === 'annotation' && event.side === 'start' && !paired.has(event.element)) {
      const descriptor = event.descriptor();
      if (descriptor !== undefined) {
        extents.push({ startIndex: event.index, endIndex: event.index, order: event.order, descriptor });
      }
    }
  }
  const blocks = insertOdfConstructMarkers(walked, extents);

  // The master-page tenant of the definitions table: every style:master-page with its resolved page geometry and its header/footer slots read as block flow. Collected AFTER the body walk so a header/footer list's minted numIds follow the body's own, keeping every existing numId assignment stable -- master pages are styles-side facts, and the body's identities were already minted by the walk above.
  readOdfMasterPageDefinitions(pkg, definitions.entries, { provenanceRegions, definitions, format: 'odt' }, state.listIdState);

  return {
    metadata,
    sections: [{ pageSize, margins, blocks }],
    ...(Object.keys(definitions.entries).length > 0 ? { definitions: definitions.entries } : {}),
  };
}

// Package -> DocumentPackage: this module's PRIMARY entry point, and the one a caller reaching for "read a .odt" should use. readOdtContent above stays exactly what it always was -- the flat, ContentDocument-level reader -- and this function is nothing more than its result spliced into the 'wordprocessing' ContentDocument envelope and handed to document-schema.js's own assemblePackage.
//
// assemblePackage rather than bare decompose, per that function's own doc comment ("the tree-form DocumentPackage every construction site reports"): decompose alone yields the `children` array for a caller composing its own package boundary, whereas a reader IS a construction site and owes its caller the whole package -- envelope spliced on, styles table minted over the result -- exactly as documents.js's own conversion pipeline already does at every package it builds. factorStyles is not called here either: assemblePackage already mints, and re-minting an already-minted package is a no-op by law (iii).
//
// No `pages` argument is passed, and none can be: `pages` carries each RENDERED page's own size, which only a layout pass can report. A reader runs strictly before any layout, so the package it returns is a content-only one -- its nodes carry no `frames` and its root carries no `pages`, which is the honest shape for a document nothing has laid out yet.
export function readOdt(pkg: Package, options: OdtReadOptions = {}): DocumentPackage {
  const { metadata, sections, definitions } = readOdtContent(pkg, options);
  const assembled = assemblePackage({ kind: 'wordprocessing', metadata, sections });
  // The definitions table has no flat-ContentDocument spelling to ride through assemblePackage's envelope splice (the flat form is the codec-exchange CONTENT shape; package-level tables are tree-only), so it attaches to the freshly assembled root here -- the same route factorStyles' re-entry uses to carry it, and minting never reads it either way.
  if (definitions !== undefined) {
    assembled.definitions = definitions;
  }
  return assembled;
}
