import type { ContentBlock, ContentParagraph, ContentSection, DocumentPackage, LayoutMetadata, Margins, PageSize } from 'document-schema.js';
import { assemblePackage, PAGE_SIZE_A4 } from 'document-schema.js';
import type { Package } from '../../model/package';
import type { XmlElement, XmlNode } from '../../model/node';
import { rootElement, findChildElement, childrenWithTag, attrValue } from '../../xml/query';
import { mintOdfListNumId, readOdfListParagraphs, type OdfListIdState } from '../shared/list';
import { readOdfParagraph } from '../shared/paragraph';
import { readOdfTable } from '../shared/table';
import { readOdfMetadata } from '../shared/metadata';
import { parsePageSize, parseMargins } from '../shared/geometry';
import { parseOdfLength } from '../shared/units';

// Package -> OdtDocument: the first end-to-end ODF content reader, producing GENUINE ContentSection[] values (document-schema.js's own pivot type, the one documents.js's docx flow/pagination engine already consumes) from a real .odt package. This is the concrete proof of the whole odf.js architectural bet -- that odt and docx can share one pivot and one layout algorithm despite being completely unrelated XML formats -- so every mapping below is deliberately expressed in terms document-schema.js already defines, never a lookalike shape of its own.
//
// This reader is deliberately thin: paragraph/run reading (readOdfParagraph) and table reading (readOdfTable) already live in typed/shared/ -- built for reuse across odt/ods/odp/odg, not odt-specific -- so this module's own job is the odt-SPECIFIC structure those shared readers have no opinion on: walking office:text's actual block sequence (paragraphs interleaved with lists and tables, in document order), mapping text:h's own text:outline-level onto a docx-equivalent styleId alongside document-schema.js's own headingLevel field, and resolving the document's own page geometry from its first master page. readOdfParagraph is tag-agnostic (it never inspects which tag its own caller found it at) and reads text:h exactly as it reads text:p, so this reader calls straight through to it for both, then overrides ONLY the resulting heading identity (styleId plus headingLevel) for a heading -- see readParagraphOrHeading below.
//
// SCOPE, matching ooxml.js's own readDocx's already-established, deliberately narrower gaps (see that module's own top-of-file note for the identical reasoning applied to OOXML): footnotes/endnotes, annotations/comments, header/footer content, inline frames/images (draw:frame inside text flow -- odp/odg's job, not odt's), fields in their entirety (no field branch exists in run collection -- readOdfParagraph drops a field child without even its cached/last-computed text value), change tracking (text:change-*), explicit page breaks (fo:break-before/fo:break-after -- not modelled by styles/properties.ts's StyleProperties, so the cascade this reader relies on can't surface it; a genuinely separate, bounded follow-on), and documents with more than one master page (only the first is read, in document order -- see readFirstMasterPageGeometry below). A text:h or a nested text:list/text:table inside a table cell is also out of scope here, inherited directly from readOdfTable's own cell reading (table:table-cell content there is read as text:p only) -- not a gap introduced by this module. src/typed/formula/read.ts does not exist yet at the time this reader was written, so there is no formula-embedding recursion to account for either. List marker GLYPHS (the exact bullet character or number format string) remain unread -- only the ordered-vs-bullet KIND is resolved (see typed/shared/list.ts's resolveOdfListKind), since that is what downstream consumers need to render <ol> vs <ul>.
//
// LIST HANDLING: the numId minting convention (a monotonically increasing per-encounter counter, never text:style-name), the ordered:/bullet: kind prefix, and the text:list/text:list-item structural nesting walk itself all live in typed/shared/list.ts -- read that module's own top-of-file notes in full for the derivation -- because the odp reader meets the IDENTICAL text:list construct inside slide text frames and shares every line of it. This reader's own remaining list responsibility is the one genuinely odt-specific part: threading a single document-wide OdfListIdState through its office:text walk, so list identities are unique across the whole body exactly as they are across a whole presentation's slides.

export interface OdtDocument {
  metadata: LayoutMetadata;
  sections: ContentSection[];
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

// text:h/text:p -> ContentParagraph, via readOdfParagraph (typed/shared/paragraph.ts) -- tag-agnostic itself, so calling it on a text:h reads its style/run content exactly as it would a text:p. The one thing it can't know is odt's own heading convention: a heading's real @text:style-name (e.g. "Heading_20_1") is a producer-chosen ODF string with no cross-format meaning, so this function overrides ONLY the heading identity for a text:h, synthesising the same "Heading1"/"Heading2" shape docx's own real w:pStyle values already use for its built-in heading styles -- giving downstream consumers (documents.js's layout engine, or anything else keying off styleId) one consistent heading convention across both formats -- while the parsed text:outline-level number itself is kept as headingLevel, document-schema.js's canonical numeric heading field, so numeric consumers never have to parse it back out of the styleId string. List membership is never set here: the shared walker (typed/shared/list.ts's readOdfListParagraphs) attaches it for paragraphs it reads inside a text:list, since ODF list membership is purely structural (which text:list/text:list-item this element is nested inside), never an attribute on the paragraph element itself the way docx's w:numPr is.
function readParagraphOrHeading(element: XmlElement, pkg: Package): ContentParagraph {
  const paragraph = readOdfParagraph(element, pkg);
  if (element.tag === 'text:h') {
    const outlineLevel = readOutlineLevel(element);
    paragraph.styleId = `Heading${outlineLevel}`;
    // The parsed text:outline-level number itself is the schema's canonical headingLevel (schema #13): styleId encodes it for styleId-keyed consumers, headingLevel carries it verbatim for numeric consumers, and both always agree because they derive from this one parse.
    paragraph.headingLevel = outlineLevel;
  }
  return paragraph;
}

// Walks block-level content (text:p, text:h, text:list, table:table) in document order, at ONE nesting level -- office:text's own top-level children. text:section (ODF's generic grouping/columns wrapper) is unwrapped transparently, flattening its content into the caller's own block sequence -- it carries no semantic meaning ContentBlock has any vocabulary for. Anything else (text:sequence-decls, a bookmark, a field, change-tracking markup, an anchored draw:frame, text:soft-page-break, ...) is silently outside this reader's scope, matching the OUT OF SCOPE note at the top of this file. Table CELL content is not walked here at all -- readOdfTable owns that entirely (see this file's own top-of-file note on the scope it inherits from doing so).
function readBlocks(nodes: readonly XmlNode[], pkg: Package, listIdState: OdfListIdState): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const node of nodes) {
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'text:p' || node.tag === 'text:h') {
      blocks.push(readParagraphOrHeading(node, pkg));
    } else if (node.tag === 'text:list') {
      const numId = mintOdfListNumId(pkg, node, listIdState);
      blocks.push(...readOdfListParagraphs(node, { numId, level: 0 }, (element) => readParagraphOrHeading(element, pkg)));
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
export function readOdtContent(pkg: Package): OdtDocument {
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
  const listIdState: OdfListIdState = { next: 1 };
  const blocks = readBlocks(textElement.children, pkg, listIdState);

  return { metadata, sections: [{ pageSize, margins, blocks }] };
}

// Package -> DocumentPackage: this module's PRIMARY entry point, and the one a caller reaching for "read a .odt" should use. readOdtContent above stays exactly what it always was -- the flat, ContentDocument-level reader -- and this function is nothing more than its result spliced into the 'wordprocessing' ContentDocument envelope and handed to document-schema.js's own assemblePackage.
//
// assemblePackage rather than bare decompose, per that function's own doc comment ("the tree-form DocumentPackage every construction site reports"): decompose alone yields the `children` array for a caller composing its own package boundary, whereas a reader IS a construction site and owes its caller the whole package -- envelope spliced on, styles table minted over the result -- exactly as documents.js's own conversion pipeline already does at every package it builds. factorStyles is not called here either: assemblePackage already mints, and re-minting an already-minted package is a no-op by law (iii).
//
// No `pages` argument is passed, and none can be: `pages` carries each RENDERED page's own size, which only a layout pass can report. A reader runs strictly before any layout, so the package it returns is a content-only one -- its nodes carry no `frames` and its root carries no `pages`, which is the honest shape for a document nothing has laid out yet.
export function readOdt(pkg: Package): DocumentPackage {
  const { metadata, sections } = readOdtContent(pkg);
  return assemblePackage({ kind: 'wordprocessing', metadata, sections });
}
