import type { ContentBlock, ContentListMembership, ContentParagraph, ContentSection, LayoutMetadata, Margins, PageSize } from 'document-schema.js';
import { PAGE_SIZE_A4 } from 'document-schema.js';
import type { Package } from '../../model/package';
import type { XmlElement, XmlNode } from '../../model/node';
import { rootElement, findChildElement, childrenWithTag, attrValue } from '../../xml/query';
import { readOdfParagraph } from '../shared/paragraph';
import { readOdfTable } from '../shared/table';
import { readOdfMetadata } from '../shared/metadata';
import { parsePageSize, parseMargins } from '../shared/geometry';
import { parseOdfLength } from '../shared/units';

// Package -> OdtDocument: the first end-to-end ODF content reader, producing GENUINE ContentSection[] values (document-schema.js's own pivot type, the one documents.js's docx flow/pagination engine already consumes) from a real .odt package. This is the concrete proof of the whole odf.js architectural bet -- that odt and docx can share one pivot and one layout algorithm despite being completely unrelated XML formats -- so every mapping below is deliberately expressed in terms document-schema.js already defines, never a lookalike shape of its own.
//
// This reader is deliberately thin: paragraph/run reading (readOdfParagraph) and table reading (readOdfTable) already live in typed/shared/ -- built for reuse across odt/ods/odp/odg, not odt-specific -- so this module's own job is the odt-SPECIFIC structure those shared readers have no opinion on: walking office:text's actual block sequence (paragraphs interleaved with lists and tables, in document order), turning a text:list's purely structural nesting into ContentParagraph.list (numId/level), mapping text:h's own text:outline-level onto a docx-equivalent styleId alongside document-schema.js's own headingLevel field, and resolving the document's own page geometry from its first master page. readOdfParagraph is tag-agnostic (it never inspects which tag its own caller found it at) and reads text:h exactly as it reads text:p, so this reader calls straight through to it for both, then overrides ONLY the resulting heading identity (styleId plus headingLevel) for a heading -- see readParagraphOrHeading below.
//
// SCOPE, matching ooxml.js's own readDocx's already-established, deliberately narrower gaps (see that module's own top-of-file note for the identical reasoning applied to OOXML): footnotes/endnotes, annotations/comments, header/footer content, inline frames/images (draw:frame inside text flow -- odp/odg's job, not odt's), fields beyond their cached/last-computed text value, change tracking (text:change-*), cell borders, explicit page breaks (fo:break-before/fo:break-after -- not modelled by styles/properties.ts's StyleProperties, so the cascade this reader relies on can't surface it; a genuinely separate, bounded follow-on), and documents with more than one master page (only the first is read, in document order -- see readFirstMasterPageGeometry below). A text:h or a nested text:list/text:table inside a table cell is also out of scope here, inherited directly from readOdfTable's own cell reading (table:table-cell content there is read as text:p only) -- not a gap introduced by this module. src/typed/formula/read.ts does not exist yet at the time this reader was written, so there is no formula-embedding recursion to account for either. List marker GLYPHS (the exact bullet character or number format string) remain unread -- only the ordered-vs-bullet KIND is resolved (see resolveListKind below), since that is what downstream consumers need to render <ol> vs <ul>.
//
// LIST numId DERIVATION: ODF has no docx-style shared numId at all -- a docx w:numId identifies one entry in numbering.xml that many, textually unrelated w:p elements can reference by attribute; an ODF text:list is instead a purely STRUCTURAL container (its own list items are its own XML children), so "which list does this paragraph belong to" is answered by tree position, not by an attribute lookup. To give downstream consumers (document-schema.js's ContentListMembership, mirroring docx's numId/level pair) an equivalent stable identity, this reader mints numId as a monotonically increasing counter ("list1", "list2", ...), ONE PER TOP-LEVEL text:list ELEMENT ENCOUNTERED IN DOCUMENT ORDER -- never per text:style-name. A text:list's own text:style-name was deliberately rejected as the numId source: it names a REUSABLE list-style DEFINITION (the marker/numbering format), and real documents routinely apply the identical list-style to two unrelated, non-adjacent text:list elements (e.g. two independent bullet lists both created from the same "List 1" paragraph style) -- collapsing those into one numId would violate the one hard requirement this reader must satisfy ("different text:list elements get different [numIds]"). A monotonic per-encounter counter satisfies that requirement unconditionally, is stable/deterministic for a given document (same input -> same output, useful for tests), and needs no cross-referencing at all. Nesting is layered on top of this identity, not a separate list: a NESTED text:list (one found while walking a text:list-item's own children, per the OASIS content model for list nesting) keeps its ENCLOSING list's numId unchanged and only increments level -- exactly mirroring how a docx numId spans every nesting depth of one multi-level list, with w:ilvl (level here) distinguishing depth. Nesting depth itself is never separately counted or inferred from indentation: it is read directly off the actual XML nesting depth of text:list inside text:list-item inside text:list ..., per this reader's own explicit design brief.
//
// LIST KIND PREFIX: the minted numId is prefixed with "ordered:" or "bullet:" when the text:list's text:style-name resolves to a text:list-style whose level-1 child is text:list-level-style-number (ordered) or text:list-level-style-bullet/-image (bullet) -- see resolveListKind below. This encodes the ordered-vs-bullet kind into the opaque numId string (the same convention markdown-codec and documents.js's router-side docx normalization already use), so downstream consumers (the web app's buildListForest/renderer) can render <ol> vs <ul> without needing a separate field on ContentListMembership. An unresolved style-name leaves the numId unprefixed, and the consumer renders with a neutral marker.

// A monotonically increasing counter for minting fresh top-level list numIds, threaded by reference through the whole document walk -- see this module's own top-of-file note on why a per-encounter counter, not text:style-name, is the numId source.
interface ListIdState {
  next: number;
}

export interface OdtDocument {
  metadata: LayoutMetadata;
  sections: ContentSection[];
}

const CONTENT_PART = 'content.xml';
const STYLES_PART = 'styles.xml';
const AUTOMATIC_STYLE_PARTS = [CONTENT_PART, STYLES_PART] as const;

// text:outline-level's ODF schema default when the attribute is absent is 1 (OASIS ODF 1.2 part 1); an unparseable or non-positive value degrades to the same default rather than throwing, matching this reader's general "malformed-but-salvageable input degrades gracefully" posture (readOdt itself has no diagnostics channel to report it through).
function readOutlineLevel(headingElement: XmlElement): number {
  const raw = attrValue(headingElement, 'text:outline-level');
  if (raw === undefined) {
    return 1;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

// text:h/text:p -> ContentParagraph, via readOdfParagraph (typed/shared/paragraph.ts) -- tag-agnostic itself, so calling it on a text:h reads its style/run content exactly as it would a text:p. The one thing it can't know is odt's own heading convention: a heading's real @text:style-name (e.g. "Heading_20_1") is a producer-chosen ODF string with no cross-format meaning, so this function overrides ONLY the heading identity for a text:h, synthesising the same "Heading1"/"Heading2" shape docx's own real w:pStyle values already use for its built-in heading styles -- giving downstream consumers (documents.js's layout engine, or anything else keying off styleId) one consistent heading convention across both formats -- while the parsed text:outline-level number itself is kept as headingLevel, document-schema.js's canonical numeric heading field, so numeric consumers never have to parse it back out of the styleId string. `list` is threaded in by the caller (readBlocks/readListItems) rather than derived here, since ODF list membership is purely structural (which text:list/text:list-item this element is nested inside), never an attribute on the paragraph element itself the way docx's w:numPr is.
function readParagraphOrHeading(element: XmlElement, pkg: Package, list: ContentListMembership | undefined): ContentParagraph {
  const paragraph = readOdfParagraph(element, pkg);
  if (element.tag === 'text:h') {
    const outlineLevel = readOutlineLevel(element);
    paragraph.styleId = `Heading${outlineLevel}`;
    // The parsed text:outline-level number itself is the schema's canonical headingLevel (schema #13): styleId encodes it for styleId-keyed consumers, headingLevel carries it verbatim for numeric consumers, and both always agree because they derive from this one parse.
    paragraph.headingLevel = outlineLevel;
  }
  if (list !== undefined) {
    paragraph.list = list;
  }
  return paragraph;
}

// Walks a text:list's direct text:list-item children, pushing each item's own text:p/text:h content into `blocks` (in document order, alongside everything else at the CALLER's own level -- a list's items are not wrapped in any block of their own, matching ContentBlock's flat discriminated-union shape) and recursing into a nested text:list (found inside a text:list-item, per the OASIS nesting content model) at level + 1 under the SAME numId -- see this module's own top-of-file note on why nesting never mints a new numId.
function readListItems(listElement: XmlElement, context: ContentListMembership, pkg: Package, blocks: ContentBlock[]): void {
  for (const item of listElement.children) {
    if (item.type !== 'element' || item.tag !== 'text:list-item') {
      continue;
    }
    for (const itemChild of item.children) {
      if (itemChild.type !== 'element') {
        continue;
      }
      if (itemChild.tag === 'text:p' || itemChild.tag === 'text:h') {
        blocks.push(readParagraphOrHeading(itemChild, pkg, context));
      } else if (itemChild.tag === 'text:list') {
        readListItems(itemChild, { numId: context.numId, level: context.level + 1 }, pkg, blocks);
      }
      // A list item containing a table or further block content beyond a nested list is legal ODF but vanishingly rare and outside this reader's scope, matching the task's own explicit list-membership-only mandate.
    }
  }
}

// Walks block-level content (text:p, text:h, text:list, table:table) in document order, at ONE nesting level -- office:text's own top-level children. text:section (ODF's generic grouping/columns wrapper) is unwrapped transparently, flattening its content into the caller's own block sequence -- it carries no semantic meaning ContentBlock has any vocabulary for. Anything else (text:sequence-decls, a bookmark, a field, change-tracking markup, an anchored draw:frame, text:soft-page-break, ...) is silently outside this reader's scope, matching the OUT OF SCOPE note at the top of this file. Table CELL content is not walked here at all -- readOdfTable owns that entirely (see this file's own top-of-file note on the scope it inherits from doing so).
// Resolves a text:list's text:style-name to its ordered-vs-bullet kind by finding the corresponding text:list-style definition and inspecting its level-1 child tag. Searches both content.xml and styles.xml, in both office:automatic-styles and office:styles -- mirroring findPageLayoutElement's and cascade.ts's own both-parts-both-containers pattern. Returns undefined when the style-name is absent or unresolvable, so the caller leaves the numId unprefixed and the downstream consumer falls back to a neutral marker.
function resolveListKind(pkg: Package, styleName: string | undefined): 'ordered' | 'bullet' | undefined {
  if (styleName === undefined) return undefined;
  for (const partPath of AUTOMATIC_STYLE_PARTS) {
    const part = pkg.parts[partPath];
    if (part?.kind !== 'xml') continue;
    const root = rootElement(part.nodes);
    if (root === undefined) continue;
    for (const containerTag of ['office:automatic-styles', 'office:styles'] as const) {
      const container = findChildElement(root.children, containerTag);
      if (container === undefined) continue;
      const listStyle = childrenWithTag(container, 'text:list-style').find((el) => attrValue(el, 'style:name') === styleName);
      if (listStyle === undefined) continue;
      // Real list-styles are homogeneous across levels; checking level 1 is sufficient.
      if (childrenWithTag(listStyle, 'text:list-level-style-number').some((el) => attrValue(el, 'text:level') === '1')) return 'ordered';
      if (childrenWithTag(listStyle, 'text:list-level-style-bullet').some((el) => attrValue(el, 'text:level') === '1')) return 'bullet';
      if (childrenWithTag(listStyle, 'text:list-level-style-image').some((el) => attrValue(el, 'text:level') === '1')) return 'bullet';
      return undefined;
    }
  }
  return undefined;
}

function readBlocks(nodes: readonly XmlNode[], pkg: Package, listIdState: ListIdState): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const node of nodes) {
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'text:p' || node.tag === 'text:h') {
      blocks.push(readParagraphOrHeading(node, pkg, undefined));
    } else if (node.tag === 'text:list') {
      const kind = resolveListKind(pkg, attrValue(node, 'text:style-name'));
      const numId = kind !== undefined ? `${kind}:list${listIdState.next}` : `list${listIdState.next}`;
      listIdState.next += 1;
      readListItems(node, { numId, level: 0 }, pkg, blocks);
    } else if (node.tag === 'table:table') {
      blocks.push(readOdfTable(node, pkg));
    } else if (node.tag === 'text:section') {
      blocks.push(...readBlocks(node.children, pkg, listIdState));
    }
  }
  return blocks;
}

function parseKnownOdfLength(value: string): number {
  const parsed = parseOdfLength(value);
  if (parsed === undefined) {
    throw new Error(`readOdt: internal error -- "${value}" is not a valid ODF length literal`);
  }
  return parsed;
}

const DEFAULT_MARGIN_PT = parseKnownOdfLength('2cm');
const DEFAULT_MARGINS: Margins = { topPt: DEFAULT_MARGIN_PT, rightPt: DEFAULT_MARGIN_PT, bottomPt: DEFAULT_MARGIN_PT, leftPt: DEFAULT_MARGIN_PT };

// A style:page-layout can live in either part's own office:automatic-styles (verified against real LibreOffice output) -- mirroring readOdp's own findPageLayoutElement (typed/odp/read.ts), which searches both content.xml and styles.xml for the identical reason (and cascade.ts's own collectStyles, which does the same for style:style/style:default-style). Duplicated here in full, deliberately, rather than importing readOdp's own private helper: this reader's own "first master page in document order" master-page selection differs enough from readOdp's own per-slide draw:master-page-name lookup that sharing just the page-layout half would leave the master-page half split across two modules for no real gain -- and readOdp's own findPageLayoutElement was never exported for reuse in the first place.
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
// ODF/LibreOffice's own out-of-the-box defaults for a freshly created, unmodified text document -- confirmed directly against a real Writer document's own style:page-layout-properties (21cm x 29.7cm page, 2cm margins on every side) -- used only when a package's styles.xml is missing, malformed, or has no master page/page layout this reader can resolve. Deliberately A4-based rather than reusing document-schema.js's own PAGE_SIZE_LETTER convention (which ooxml.js's docx reader falls back to): Word's real default is genuinely Letter-sized, but ODF/LibreOffice's real default is genuinely A4-sized, so each reader's own fallback should reflect the format it actually reads, not a single cross-format constant -- mirroring readOdp's own SLIDE_SIZE_WIDESCREEN fallback choice for the same reason.
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
export function readOdt(pkg: Package): OdtDocument {
  const contentPart = pkg.parts[CONTENT_PART];
  if (contentPart?.kind !== 'xml') {
    throw new Error(`readOdt: package has no ${CONTENT_PART} part`);
  }
  const contentRoot = rootElement(contentPart.nodes);
  const body = contentRoot === undefined ? undefined : findChildElement(contentRoot.children, 'office:body');
  const textElement = body === undefined ? undefined : findChildElement(body.children, 'office:text');
  if (textElement === undefined) {
    throw new Error(`readOdt: ${CONTENT_PART} has no office:body/office:text element`);
  }

  const metadata = readOdfMetadata(pkg);
  const { pageSize, margins } = readFirstMasterPageGeometry(pkg);
  const listIdState: ListIdState = { next: 1 };
  const blocks = readBlocks(textElement.children, pkg, listIdState);

  return { metadata, sections: [{ pageSize, margins, blocks }] };
}
