import type { LayoutMetadata } from 'document-schema.js';
import type { Package, XmlElement, XmlNode } from 'odf.js';
import { ODF_MEDIA_TYPES, setDocumentMediaType, syncManifest, xmlnsAttributes } from 'odf.js';
import { PAGE_SIZE_A4 } from 'document-schema.js';
import { encodeXmlText } from '../../xml/entities';
import { el, txt } from '../../xml/fragment';

// The namespace prefixes odg's own content.xml/styles.xml actually use: office/style/text/table for the document structure odt's own scaffold already needed (a draw:text-box's content model is odt's own text:p, see edit/odp/shape.ts's identical reasoning), draw/svg/xlink for draw:page/draw:rect/draw:ellipse/draw:line/draw:path/draw:frame geometry and draw:image's own xlink:href, fo for style:page-layout-properties' fo:page-width/height. Unlike odp/scaffold.ts, there is no `presentation` prefix here at all -- odg has no presentation:notes concept (see odf.js's own typed/odg/read.ts top-of-file note on what genuinely differs between the two formats).
const CONTENT_NS_PREFIXES = ['office', 'style', 'text', 'table', 'draw', 'fo', 'svg', 'xlink'] as const;
const STYLES_NS_PREFIXES = ['office', 'style', 'text', 'table', 'draw', 'fo', 'svg', 'xlink'] as const;
const META_NS_PREFIXES = ['office', 'meta', 'dc'] as const;

const ODF_VERSION = '1.3';

// style:page-layout/@style:name and style:master-page/@style:name for the one shared page geometry every page this editor creates references via draw:page/@draw:master-page-name -- mirroring odp/scaffold.ts's own identical PAGE_LAYOUT_NAME/MASTER_PAGE_NAME pair and reasoning (OdgEditor.pageSize, editor.ts, needs this exact style:page-layout back by name to update it; OdgEditor.addPage needs this exact master-page name to reference on every new draw:page).
export const PAGE_LAYOUT_NAME = 'PM1';
export const MASTER_PAGE_NAME = 'Standard';

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

// style:page-layout-properties carries the actual page geometry; style:master-page merely names it -- the exact chain odf.js's own resolveDrawPageSize (src/typed/shared/masterpage.ts) reads back via draw:page/@draw:master-page-name -> style:master-page -> style:page-layout-name -> style:page-layout -> style:page-layout-properties, shared verbatim with odp (see that reader's own top-of-file note). Defaults to A4 -- LibreOffice Draw's own real out-of-the-box default page size (confirmed against a real, unmodified Draw document; see readOdgContent's own DEFAULT_PAGE_SIZE comment), not Impress's widescreen default odp/scaffold.ts uses, since a drawing and a presentation have genuinely different real-world defaults.
function buildPageLayout(): XmlElement {
  return el('style:page-layout', { 'style:name': PAGE_LAYOUT_NAME }, [
    el('style:page-layout-properties', { 'fo:page-width': `${PAGE_SIZE_A4.widthPt}pt`, 'fo:page-height': `${PAGE_SIZE_A4.heightPt}pt` }),
  ]);
}

function buildStylesXml(): XmlElement {
  return el('office:document-styles', { ...xmlnsAttributes([...STYLES_NS_PREFIXES]), 'office:version': ODF_VERSION }, [
    el('office:styles'),
    el('office:automatic-styles', {}, [buildPageLayout()]),
    el('office:master-styles', {}, [el('style:master-page', { 'style:name': MASTER_PAGE_NAME, 'style:page-layout-name': PAGE_LAYOUT_NAME })]),
  ]);
}

// office:drawing starts empty -- OdgEditor.addPage (editor.ts) appends draw:page elements into it one at a time, mirroring odp/scaffold.ts's own empty office:presentation.
function buildContentXml(): XmlElement {
  return el('office:document-content', { ...xmlnsAttributes([...CONTENT_NS_PREFIXES]), 'office:version': ODF_VERSION }, [
    el('office:automatic-styles'),
    el('office:body', {}, [el('office:drawing')]),
  ]);
}

// The office:meta children a LayoutMetadata value maps onto -- identical mapping to odt/scaffold.ts's own buildOfficeMeta (see that file's top-of-function comment for the full field-by-field rationale); duplicated here rather than shared, matching this directory's own existing convention of each format scaffold declaring its own small XML-building helpers.
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

export interface CreateEmptyOdgPackageOptions {
  readonly metadata?: LayoutMetadata;
}

// Builds a minimal but genuinely valid, openable odg package from nothing: the mandatory mimetype part (via setDocumentMediaType), a content.xml with an empty office:automatic-styles and an empty office:body/office:drawing, a styles.xml with the page-layout -> master-page chain resolveDrawPageSize itself resolves for page geometry, a minimal meta.xml, and a manifest listing every part (via syncManifest) -- the same shape odp/scaffold.ts's own createEmptyOdpPackage uses, with office:drawing/office:presentation and the A4/widescreen default page size as the only differences. A caller passing no options gets byte-for-byte the same package as before office:meta population existed.
export function createEmptyOdgPackage(options?: CreateEmptyOdgPackageOptions): Package {
  const pkg: Package = {
    parts: {
      'content.xml': { kind: 'xml', nodes: [declaration(), buildContentXml()] },
      'styles.xml': { kind: 'xml', nodes: [declaration(), buildStylesXml()] },
      'meta.xml': { kind: 'xml', nodes: [declaration(), buildMetaXml(options?.metadata)] },
    },
  };
  setDocumentMediaType(pkg, ODF_MEDIA_TYPES.odg);
  syncManifest(pkg);
  return pkg;
}
