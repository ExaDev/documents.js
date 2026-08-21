import type { Box, ContentDocument, ContentEmbeddedObjectKind, SourceResidue } from 'document-schema.js';
import type { XmlElement, XmlNode } from '../../model/node';
import type { Package } from '../../model/package';
import { attrValue, childrenWithTag, elementsWithTag, findChildElement, rootElement } from '../../xml/query';
import { findMathRoot, readOdfFormulaContent } from '../formula/read';
import { subDocumentPackage } from '../odb/subdocument';
import { readOdfTable } from '../shared/table';
import { odfResidue, type OdfResidueFormat } from '../shared/constructs';
import { readOdgContent } from '../odg/read';
import { readOdpContent } from '../odp/read';
import { readOdsContent } from '../ods/read';
import { readOdtContent } from '../odt/read';

// A draw:frame's own EMBEDDED OBJECT reference (draw:object) resolved into the sub-Package it points at, plus the ContentEmbeddedObjectKind that sub-document actually is -- the draw: counterpart to shapes.ts's readDrawImageBlock (draw:image), kept in its own module because the two answer genuinely different questions: an image resolves to a binary part this package decodes itself, while an object resolves to a whole nested ODF DOCUMENT only a typed reader (readOdtContent/readOdsContent/readOdpContent/readOdgContent) can turn into content.
//
// WHY THE READER DISPATCH LIVES HERE, NOT IN EACH FORMAT READER: this module originally left the kind -> reader call to its callers, because dispatching from odt's reader would have imported ods's reader, which imports odt's right back -- a genuine reader cycle. That split only stood while odf's embedding edges all pointed one way (ods dispatched to embedded sub-documents and odt did not); odt's own anchored-frame reading made embedding symmetric -- a Writer document embeds a Calc sheet exactly as a Calc sheet embeds a Writer document (ExaDev/documents.js#761) -- and per-reader dispatch then re-creates the cycle whichever direction is refused. So the dispatch is inverted into this module: every format reader hands its embedded references to readEmbeddedObjectDocument below, and THIS module imports the readers. The resulting module cycles (odt/read -> here -> ods/read -> here) are safe under one discipline, the same one ooxml.js's own typed/embedded.ts states for its identical symmetric-embedding dispatch: every cross-use is call-time only, both sides export hoisted function declarations, and nothing at module-evaluation time may read a cycle partner's bindings (a top-level const whose initialiser touched a partner would TDZ, because ESM initialises a cycle's modules in an order the import graph does not pin). Reference resolution (which sub-package, which kind) stays reader-free exactly as before, so nothing above the dispatch grows a cycle edge.
//
// CONFIRMED against real, unmodified LibreOffice 26.2 output (src/typed/ods/fixtures/sheet-anchors.ods -- a real Calc sheet built through the same UNO calls the Calc UI itself uses, with a LibreOffice Draw document inserted as an OLE object anchored to a cell, then saved and unzipped directly):
// - The reference is `<draw:object xlink:href="./Object 1" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>`, a direct child of draw:frame -- a package-relative DIRECTORY path with a "./" prefix and NO trailing "/content.xml", so the href is exactly the prefix subDocumentPackage (typed/odb/subdocument.ts) already re-keys a sub-document's parts against, once that "./" is stripped.
// - The sub-document is a complete, ordinary ODF document: "Object 1/content.xml", "Object 1/styles.xml", "Object 1/settings.xml", with the outer package's own META-INF/manifest.xml declaring "Object 1/" as manifest:media-type="application/vnd.oasis.opendocument.graphics".
// - The SAME draw:frame ALSO carries a sibling `<draw:image xlink:href="./ObjectReplacements/Object 1"/>` -- a GDI-metafile preview LibreOffice writes for consumers that cannot render the real object. A caller must therefore check for draw:object BEFORE falling back to a frame's draw:image, exactly as readDrawFrameContent already checks table:table before draw:image for the identical "a real table frame also ships a preview image" reason.
//
// KIND is resolved from the sub-document's OWN content.xml, NOT from the manifest's declared media type for the directory, even though the manifest genuinely declares one. One signal, not two: the caller must pick a typed reader anyway, and deriving both the reported kind and the reader that produced the content from the same element makes them consistent by construction -- where a manifest entry can be absent (a sub-package that ships no manifest of its own is still perfectly readable) or disagree with what content.xml actually holds, in which case the manifest would be describing a document nobody read. There are two structurally different shapes to resolve it from, and content.xml itself says which applies: an ordinary embedded document has an office:body whose single content child names the kind (office:text/office:spreadsheet/office:presentation/office:drawing), while an embedded FORMULA has no office:body at all -- its content.xml root IS the MathML root, per typed/formula/read.ts's own confirmed-against-real-LibreOffice finding. The math-root check is therefore reached only when the office:body path finds nothing to read, and it reuses formula/read.ts's own findMathRoot rather than restating which tags count as a MathML root (bare "math" is what real LibreOffice writes; "math:math" is that reader's own defensive prefixed alternative).
//
// SCOPE: a formula sub-document (a real, common embedded object -- LibreOffice Math) IS resolvable here, as of document-schema.js 2.2.0: ContentDocument's own discriminated union has a genuine 'formula' variant carrying MathML, so ContentEmbeddedObject.document has something real to hold and the kind ContentEmbeddedObjectKind already listed is no longer a member nothing could be put in. A CHART is resolvable too, since document-schema.js's chart member landed: office:chart resolves to kind 'chart', and readOdfChartContent below states the document it carries -- the chart's own local data cache on a frame-sized drawing page, with the chart element quarantined whole in the object's residue. A LINKED (as opposed to embedded) object -- xlink:href pointing outside the package, at a separate file or a URL -- likewise resolves to undefined: its content genuinely is not in this package to read.

// Every ContentEmbeddedObjectKind an embedded sub-document can actually resolve to. Every member of the schema's own union is genuinely reachable -- the four office:body kinds below, 'formula' from a bare MathML root, and 'chart' from an office:chart body child -- so this is a straight alias rather than an Extract narrowing, kept as its own exported name because callers dispatch a typed reader on it. Anything the schema does not name (an office:database sub-document) still resolves to undefined; see this module's own SCOPE note.
export type EmbeddedDocumentKind = ContentEmbeddedObjectKind;

export interface EmbeddedDrawObject {
  // What the sub-document actually is, resolved from its own office:body content child -- or, for a formula, from its content.xml root being a MathML root with no office:body at all.
  objectKind: EmbeddedDocumentKind;
  // The sub-document's own parts, re-keyed relative to its directory -- a genuine Package every typed reader in this package accepts unmodified.
  package: Package;
  // The sub-document's own directory path inside the OUTER package, normalised (no "./" prefix, no trailing slash) -- e.g. "Object 1".
  href: string;
}

const CONTENT_PART = 'content.xml';

// office:body's single content child identifies the document kind, exactly as it does for a top-level package (readOdtContent looks for office:text, readOdsContent for office:spreadsheet, and so on) -- a switch rather than a lookup table so each mapping narrows to its own literal type with no assertion. 'formula' is genuinely reachable through this function's own return type but never returned BY it: an embedded formula has no office:body element to have a content child at all, so it is resolved from the MathML root instead (see subDocumentKind below).
function embeddedKindFor(bodyChildTag: string): EmbeddedDocumentKind | undefined {
  switch (bodyChildTag) {
    case 'office:text':
      return 'wordprocessing';
    case 'office:spreadsheet':
      return 'spreadsheet';
    case 'office:presentation':
      return 'presentation';
    case 'office:drawing':
      return 'drawing';
    case 'office:chart':
      return 'chart';
    default:
      // office:database is a .odb front-end (readOdbInventory's job, not a ContentDocument at all) and stays unrepresentable -- see this module's own SCOPE note. office:chart resolves since document-schema.js's chart member landed: readOdfChartContent below states what its document carries.
      return undefined;
  }
}

// An office:chart sub-document -> the ContentDocument its ContentEmbeddedObject carries, plus the chart-specific serialisation quarantined as the object's residue. A chart has no ContentDocument variant of its own (the schema states 'chart' as the one kind whose payload is not a same-named document), so the projection mirrors the family's pptx precedent -- "a chart reaches consumers as the series/category data it carries": the chart's own local table:table cache (the data block ODF charts embed inside chart:plot-area) reads through the ordinary shared table reader, and it rides a ONE-PAGE drawing document whose page is the anchor frame's own real size and whose single shape spans that page -- geometry the format genuinely stated, never invented page metrics. The chart's presentation specifics (chart:class, series layout, axes) have no cross-format home and quarantine whole in residue for a same-format restorer.
export function readOdfChartContent(chartPackage: Package, frame: Box, format: OdfResidueFormat): { document: ContentDocument; residue: SourceResidue | undefined } {
  const contentPart = chartPackage.parts[CONTENT_PART];
  const contentRoot = contentPart?.kind === 'xml' ? rootElement(contentPart.nodes) : undefined;
  const chartElement = contentRoot === undefined ? undefined : elementsWithTag(contentRoot.children, 'chart:chart')[0];
  const localTable = chartElement === undefined ? undefined : elementsWithTag(chartElement.children, 'table:table')[0];
  const blocks = localTable === undefined ? [] : [readOdfTable(localTable, chartPackage)];
  const document: ContentDocument = {
    kind: 'drawing',
    metadata: {},
    pages: [
      {
        size: { widthPt: frame.widthPt, heightPt: frame.heightPt },
        shapes: [
          {
            frame: { xPt: 0, yPt: 0, widthPt: frame.widthPt, heightPt: frame.heightPt },
            insetLeftPt: 0,
            insetTopPt: 0,
            insetRightPt: 0,
            insetBottomPt: 0,
            blocks,
          },
        ],
        vectors: [],
      },
    ],
  };
  // No residue when the package resolves no chart:chart element at all (the reference resolved on the office:chart body child, so a missing inner element is malformed-missing): the object still reads with its empty content rather than quarantining a fabricated element the source never had.
  return { document, residue: chartElement === undefined ? undefined : odfResidue(format, chartElement) };
}

// What dispatching one embedded sub-document to its own typed reader yields: the ContentDocument variant that reader produces, plus the residue the one kind with format-specific presentation specifics (a chart, quarantining its whole chart:chart element) attaches -- undefined for every other kind, so a caller shaping the result into its own block/object encoding treats both arms uniformly.
export interface EmbeddedDocumentRead {
  readonly document: ContentDocument;
  readonly residue: SourceResidue | undefined;
}

// An embedded sub-document reference -> the ContentDocument its own typed reader produces, plus any residue that reader quarantines. This is the ONE kind -> reader dispatch table for the whole package (see this module's own top-of-file note for why it lives here rather than in each format reader): both frame-reading formats (odt's text-flow lift, ods's cell/page anchoring) hand every reference they resolve to this function, so a spreadsheet embedded in a Writer document and a Writer document embedded in a spreadsheet traverse the same table, and no format reader ever imports a sibling reader. A spreadsheet embedded inside a spreadsheet is plain self-recursion through the table's own 'spreadsheet' arm. `format` names the EMBEDDING format (the reader whose frame walk made the call), because the one arm that cares -- chart residue, so a same-format restorer knows whose serialisation it is reading -- is a property of where the object was found, not of what the object is. Every EmbeddedDocumentKind resolves: the reference itself already refused the unrepresentable shapes (a linked object, a .odb front-end), so a caller never needs an undefined arm to handle.
export function readEmbeddedObjectDocument(reference: EmbeddedDrawObject, frame: Box, format: OdfResidueFormat): EmbeddedDocumentRead {
  switch (reference.objectKind) {
    case 'wordprocessing': {
      const { metadata, sections } = readOdtContent(reference.package);
      return { document: { kind: 'wordprocessing', metadata, sections }, residue: undefined };
    }
    case 'presentation': {
      const { metadata, slides } = readOdpContent(reference.package);
      return { document: { kind: 'presentation', metadata, slides }, residue: undefined };
    }
    case 'drawing': {
      const { metadata, pages } = readOdgContent(reference.package);
      return { document: { kind: 'drawing', metadata, pages }, residue: undefined };
    }
    case 'spreadsheet': {
      const { metadata, sheets } = readOdsContent(reference.package);
      return { document: { kind: 'spreadsheet', metadata, sheets }, residue: undefined };
    }
    case 'formula':
      // The one embedded kind whose own reader already returns a finished ContentDocument (readOdfFormulaContent), because a formula document has no per-format {metadata, sections/slides/pages/sheets} shape to re-wrap -- its whole content IS the MathML.
      return { document: readOdfFormulaContent(reference.package), residue: undefined };
    case 'chart':
      // A chart's document is the frame-sized drawing page carrying the chart's local data cache (see readOdfChartContent's own note above), and the chart element quarantines into the residue this return carries alongside it.
      return readOdfChartContent(reference.package, frame, format);
  }
}

// A sub-document's own content.xml -> the kind it is, across BOTH structural shapes: office:body's content child for an ordinary embedded document, and a bare MathML root for an embedded formula. The office:body path is tried first and the math-root path only when it yields nothing, so a document that genuinely has an office:body is never re-examined as a formula.
function subDocumentKind(nodes: readonly XmlNode[]): EmbeddedDocumentKind | undefined {
  const root = rootElement(nodes);
  const body = root === undefined ? undefined : findChildElement(root.children, 'office:body');
  // office:body's own first element child IS the content element -- rootElement is tag-agnostic "first element in this forest", which is exactly that question asked one level down, so it is reused here rather than growing a second first-element-child helper.
  const bodyChild = body === undefined ? undefined : rootElement(body.children);
  const bodyKind = bodyChild === undefined ? undefined : embeddedKindFor(bodyChild.tag);
  if (bodyKind !== undefined) {
    return bodyKind;
  }
  return findMathRoot(nodes) === undefined ? undefined : 'formula';
}

// The normalised directory prefix a draw:object's own xlink:href names, or undefined when the href is absent, empty, or points outside the package (a LINKED object: an absolute URL, or a path escaping the package root).
function normaliseObjectHref(raw: string): string | undefined {
  const withoutPrefix = raw.startsWith('./') ? raw.slice(2) : raw;
  const trimmed = withoutPrefix.endsWith('/') ? withoutPrefix.slice(0, -1) : withoutPrefix;
  if (trimmed.length === 0 || trimmed.startsWith('..') || trimmed.startsWith('/') || trimmed.includes('://')) {
    return undefined;
  }
  return trimmed;
}

// Resolves a draw:frame's own draw:object child into the embedded sub-document it references. Returns undefined for a frame with no draw:object at all, for a linked (not embedded) reference, for a sub-document directory holding no content.xml, and for an embedded document of a kind ContentEmbeddedObjectKind does not name (a chart, a .odb front-end) -- see this module's own SCOPE note for why each of those is a real, bounded case rather than a failure worth throwing over.
export function readDrawObjectReference(frame: XmlElement, pkg: Package): EmbeddedDrawObject | undefined {
  const object = childrenWithTag(frame, 'draw:object')[0];
  if (object === undefined) {
    return undefined;
  }
  const rawHref = attrValue(object, 'xlink:href');
  const href = rawHref === undefined ? undefined : normaliseObjectHref(rawHref);
  if (href === undefined) {
    return undefined;
  }

  const subPackage = subDocumentPackage(pkg, href, { allowMissingContent: true });
  const contentPart = subPackage.parts[CONTENT_PART];
  if (contentPart?.kind !== 'xml') {
    return undefined;
  }
  const objectKind = subDocumentKind(contentPart.nodes);
  if (objectKind === undefined) {
    return undefined;
  }
  return { objectKind, package: subPackage, href };
}
