import type { LayoutMetadata } from 'document-schema.js';
import type { Package, XmlElement, XmlNode } from 'odf.js';
import { ODF_MEDIA_TYPES, setDocumentMediaType, syncManifest, xmlnsAttributes } from 'odf.js';
import { PAGE_SIZE_LETTER } from 'document-schema.js';
import { encodeXmlText } from '../../xml/entities';
import { el, txt } from '../../xml/fragment';

// The namespace prefixes every part below actually uses: office/style/text/table for the document structure and styles themselves, draw/svg/xlink for the frame geometry a future image writer would need (kept declared at the root now rather than re-declared piecemeal later, matching how docx's own scaffold declares w: once), fo for every length/formatting attribute odf.js's own StylePropertiesSchema and page-layout properties read and write (fo:font-weight, fo:page-width, fo:margin-top, ...).
const CONTENT_NS_PREFIXES = ['office', 'style', 'text', 'table', 'draw', 'fo', 'svg', 'xlink'] as const;
const STYLES_NS_PREFIXES = ['office', 'style', 'text', 'table', 'draw', 'fo', 'svg', 'xlink'] as const;
const META_NS_PREFIXES = ['office', 'meta', 'dc'] as const;

const ODF_VERSION = '1.3';
const PAGE_LAYOUT_NAME = 'PM1';
const MASTER_PAGE_NAME = 'Standard';

// 72pt (1in), matching createEmptyDocxPackage's own default section margins (1440 twips = 1in) -- see src/edit/docx/scaffold.ts.
const DEFAULT_MARGIN_PT = 72;

function declaration(): XmlNode {
  return {
    type: 'declaration',
    attributes: [
      { name: 'version', value: '1.0' },
      { name: 'encoding', value: 'UTF-8' },
      { name: 'standalone', value: 'yes' },
    ],
  };
}

// style:page-layout (in styles.xml's own office:automatic-styles) carries the actual page geometry; style:master-page (in office:master-styles) merely names it -- this is the exact chain odf.js's own readOdtContent reads back via readFirstMasterPageGeometry (src/typed/odt/read.ts), so a document built by this scaffold round-trips its own default page size/margins through this package's own reader too.
function buildPageLayout(): XmlElement {
  return el('style:page-layout', { 'style:name': PAGE_LAYOUT_NAME }, [
    el('style:page-layout-properties', {
      'fo:page-width': `${PAGE_SIZE_LETTER.widthPt}pt`,
      'fo:page-height': `${PAGE_SIZE_LETTER.heightPt}pt`,
      'fo:margin-top': `${DEFAULT_MARGIN_PT}pt`,
      'fo:margin-right': `${DEFAULT_MARGIN_PT}pt`,
      'fo:margin-bottom': `${DEFAULT_MARGIN_PT}pt`,
      'fo:margin-left': `${DEFAULT_MARGIN_PT}pt`,
    }),
  ]);
}

function buildStylesXml(): XmlElement {
  return el('office:document-styles', { ...xmlnsAttributes([...STYLES_NS_PREFIXES]), 'office:version': ODF_VERSION }, [
    el('office:styles'),
    el('office:automatic-styles', {}, [buildPageLayout()]),
    el('office:master-styles', {}, [el('style:master-page', { 'style:name': MASTER_PAGE_NAME, 'style:page-layout-name': PAGE_LAYOUT_NAME })]),
  ]);
}

function buildContentXml(): XmlElement {
  return el('office:document-content', { ...xmlnsAttributes([...CONTENT_NS_PREFIXES]), 'office:version': ODF_VERSION }, [
    el('office:automatic-styles'),
    el('office:body', {}, [el('office:text')]),
  ]);
}

// The office:meta children a LayoutMetadata value maps onto: dc:title, meta:initial-creator (the human AUTHOR -- NOT dc:creator, which in ODF means "last modified by", a concept LayoutMetadata has no field for), dc:subject, one meta:keyword element PER keyword (not comma-joined, unlike OOXML's own cp:keywords -- see src/opc/core-properties.ts), meta:generator (the originating application, LayoutMetadata's own `creator` field), meta:creation-date, and dc:date (last-modified). Element order is not significant (confirmed against real LibreOffice output); each child is pushed only when the corresponding field is present. Duplicated identically across odt/odp/ods/odg scaffold.ts, matching this directory's own existing convention of each format scaffold declaring its own small XML-building helpers rather than sharing them through an extra module.
function buildOfficeMeta(metadata: LayoutMetadata | undefined): XmlElement[] {
  if (metadata === undefined) {
    return [];
  }
  const children: XmlElement[] = [];
  if (metadata.title !== undefined) {
    children.push(el('dc:title', {}, [txt(encodeXmlText(metadata.title))]));
  }
  if (metadata.author !== undefined) {
    children.push(el('meta:initial-creator', {}, [txt(encodeXmlText(metadata.author))]));
  }
  if (metadata.subject !== undefined) {
    children.push(el('dc:subject', {}, [txt(encodeXmlText(metadata.subject))]));
  }
  for (const keyword of metadata.keywords ?? []) {
    children.push(el('meta:keyword', {}, [txt(encodeXmlText(keyword))]));
  }
  if (metadata.creator !== undefined) {
    children.push(el('meta:generator', {}, [txt(encodeXmlText(metadata.creator))]));
  }
  if (metadata.createdIso !== undefined) {
    children.push(el('meta:creation-date', {}, [txt(encodeXmlText(metadata.createdIso))]));
  }
  if (metadata.modifiedIso !== undefined) {
    children.push(el('dc:date', {}, [txt(encodeXmlText(metadata.modifiedIso))]));
  }
  return children;
}

function buildMetaXml(metadata?: LayoutMetadata): XmlElement {
  return el('office:document-meta', { ...xmlnsAttributes([...META_NS_PREFIXES]), 'office:version': ODF_VERSION }, [
    el('office:meta', {}, buildOfficeMeta(metadata)),
  ]);
}

export interface CreateEmptyOdtPackageOptions {
  readonly metadata?: LayoutMetadata;
}

// Builds a minimal but genuinely valid, openable odt package from nothing: the mandatory mimetype part (via setDocumentMediaType), a content.xml with an empty office:automatic-styles and an empty office:body/office:text, a styles.xml with the page-layout -> master-page chain readOdt itself resolves for page geometry, a minimal meta.xml, and a manifest listing every part (via syncManifest) -- the same four-part shape (mimetype, content.xml, styles.xml, META-INF/manifest.xml, plus meta.xml) odf.js's own round-trip fixtures use. A caller passing no options gets byte-for-byte the same package as before office:meta population existed -- options.metadata is purely additive.
export function createEmptyOdtPackage(options?: CreateEmptyOdtPackageOptions): Package {
  const pkg: Package = {
    parts: {
      'content.xml': { kind: 'xml', nodes: [declaration(), buildContentXml()] },
      'styles.xml': { kind: 'xml', nodes: [declaration(), buildStylesXml()] },
      'meta.xml': { kind: 'xml', nodes: [declaration(), buildMetaXml(options?.metadata)] },
    },
  };
  setDocumentMediaType(pkg, ODF_MEDIA_TYPES.odt);
  syncManifest(pkg);
  return pkg;
}
