import type { Box, ContentDocument, ContentEmbeddedObjectKind, SourceResidue } from 'document-schema.js';
import type { XmlElement, XmlNode } from '../../model/node';
import type { Package } from '../../model/package';
import { attrValue, childrenWithTag, elementsWithTag, findChildElement, rootElement } from '../../xml/query';
import { findMathRoot } from '../formula/read';
import { subDocumentPackage } from '../odb/subdocument';
import { readOdfTable } from '../shared/table';
import { odfResidue, type OdfResidueFormat } from '../shared/constructs';

// A draw:frame's own EMBEDDED OBJECT reference (draw:object) resolved into the sub-Package it points at, plus the ContentEmbeddedObjectKind that sub-document actually is -- the draw: counterpart to shapes.ts's readDrawImageBlock (draw:image), kept in its own module because the two answer genuinely different questions: an image resolves to a binary part this package decodes itself, while an object resolves to a whole nested ODF DOCUMENT only a typed reader (readOdtContent/readOdsContent/readOdpContent/readOdgContent) can turn into content.
//
// WHY THIS MODULE DELIBERATELY DOES NOT CALL THOSE READERS ITSELF: it would have to import readOdsContent, which imports this module -- a genuine import cycle, and one that would grow a new edge every time another format learns to read embedded objects. Resolving the reference (which sub-package, which kind) needs no reader at all, so the split falls exactly where the dependency does: this module answers "what is embedded and where are its parts", and the calling format reader dispatches its own kind -> readX call from that.
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
