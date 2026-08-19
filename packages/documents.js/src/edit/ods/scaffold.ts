import type { LayoutMetadata } from 'document-schema.js';
import type { Package, XmlElement, XmlNode } from 'odf.js';
import { ODF_MEDIA_TYPES, setDocumentMediaType, syncManifest, xmlnsAttributes } from 'odf.js';
import { PAGE_SIZE_A4 } from 'document-schema.js';
import { encodeXmlText } from '../../xml/entities';
import { el, txt } from '../../xml/fragment';

// The namespace prefixes ods's own content.xml/styles.xml actually use: office/style/table for the spreadsheet structure and its automatic styles; text for a cell's own text:p/text:span content (identical to odt's, and identical machinery -- see cell.ts's setStyledRuns); fo for style:page-layout-properties' fo:page-width/height/margin-*. No draw/svg/xlink -- this editor writes no images/drawing anchors (ContentSheetImageSchema is a documented, tracked gap, see content.ts's own module doc), unlike odp's identical-looking scaffold, which needs them for slide shapes.
const CONTENT_NS_PREFIXES = ['office', 'style', 'text', 'table', 'fo'] as const;
const STYLES_NS_PREFIXES = ['office', 'style', 'table', 'fo'] as const;
const META_NS_PREFIXES = ['office', 'meta', 'dc'] as const;

// odf.js's own ODF_NAMESPACES (src/ns.ts) does not include an 'of' entry, so this can't go through xmlnsAttributes([...CONTENT_NS_PREFIXES]) above like every other namespace this scaffold declares -- hand-declared here instead, deliberately not fixed upstream in odf.js for a task scoped to documents.js's own ods editor. Its absence is NOT cosmetic: confirmed directly by real-world testing (soffice --headless --convert-to pdf on a document built by an earlier version of this scaffold, missing only this ONE attribute, everything else byte-identical) that LibreOffice's own ODF import filter uses table:formula's leading "of:" token to decide which formula grammar to compile with, by checking whether "of" resolves to a namespace actually declared in scope on that element -- NOT merely accepting "of:" as a fixed string constant the way the OASIS grammar itself treats it. Without this declaration, a perfectly well-formed OpenFormula reference like table:formula="of:=SUM([.B2:.B3])" -- byte-for-byte identical to what real LibreOffice itself writes for the same formula, confirmed against odf.js's own kitchen-sink.ods fixture -- fails to recalculate at all on open (Err:510, "missing variable"), even though the exact same string parses correctly once this one xmlns declaration is present. The URI itself is copied verbatim from that same real fixture's own content.xml.
const OF_NAMESPACE_ATTR = { 'xmlns:of': 'urn:oasis:names:tc:opendocument:xmlns:of:1.2' };

const ODF_VERSION = '1.3';

// style:page-layout/@style:name, style:master-page/@style:name, and the shared table-family style every sheet this editor creates references via table:table/@table:style-name -- exported so editor.ts's own addSheet can mint the identical reference for every sheet it creates after the first (the scaffold's own default sheet, and every later addSheet call, must all point at the SAME style, not one each, mirroring odp/scaffold.ts's own single shared PAGE_LAYOUT_NAME/MASTER_PAGE_NAME pair for exactly the same reason).
export const PAGE_LAYOUT_NAME = 'PM1';
export const MASTER_PAGE_NAME = 'Standard';
export const SHEET_TABLE_STYLE_NAME = 'OdsTable';
export const DEFAULT_SHEET_NAME = 'Sheet1';

// 2cm -- LibreOffice Calc's own real out-of-the-box default page margin (confirmed directly via the UNO API by odf.js's own readOdsContent, see its DEFAULT_MARGIN_PT/DEFAULT_MARGINS comment), reused verbatim here rather than re-deriving it, so a document this scaffold produces round-trips through readOds to the exact same default print-settings a freshly-opened, untouched real Calc document would report.
const DEFAULT_MARGIN = '2cm';

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

// style:page-layout-properties carries the actual page geometry; style:master-page merely names it; table:table's own table:style-name -> style:style[family="table"] -> style:master-page-name is the chain odf.js's own readOdsContent resolves it through (readPrintSettings, typed/ods/read.ts -- confirmed there against real LibreOffice output that the master-page-name lives on the TABLE'S OWN style, not as a direct table:table attribute the way draw:master-page-name sits directly on draw:page). Defaults to PAGE_SIZE_A4 + 2cm margins -- readOds's own confirmed real Calc default -- so a sheet built by this scaffold, if never given its own explicit print settings via a future feature, still resolves to the exact same values a real untouched Calc document would.
function buildPageLayout(): XmlElement {
  return el('style:page-layout', { 'style:name': PAGE_LAYOUT_NAME }, [
    el('style:page-layout-properties', {
      'fo:page-width': `${PAGE_SIZE_A4.widthPt}pt`,
      'fo:page-height': `${PAGE_SIZE_A4.heightPt}pt`,
      'fo:margin-top': DEFAULT_MARGIN,
      'fo:margin-right': DEFAULT_MARGIN,
      'fo:margin-bottom': DEFAULT_MARGIN,
      'fo:margin-left': DEFAULT_MARGIN,
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

// The one automatic style every sheet this editor creates shares, via table:table/@table:style-name -- a bare table-family style whose only property is style:master-page-name, exactly mirroring test-support/ods.ts's own hand-built fixture (which was itself built to match real readOdsContent() expectations) and editor.ts's own ensureSheetTableStyleName, which mints this identical entry for any LATER sheet addSheet creates once this initial one is already present.
function buildSheetTableStyle(): XmlElement {
  return el('style:style', { 'style:name': SHEET_TABLE_STYLE_NAME, 'style:family': 'table', 'style:master-page-name': MASTER_PAGE_NAME });
}

// office:spreadsheet's own table:calculation-settings, ONE per document (not per sheet) -- included for genuine fidelity to a real, untouched Calc document's own defaults (table:automatic-find-labels, null-year, etc.), the same reasoning as this scaffold's own page-layout/margin defaults above, rather than because it was found to fix any specific bug (it was tested in isolation via real-world soffice --headless --convert-to pdf conversion and made no difference either way to formula recalculation -- see OF_NAMESPACE_ATTR above for what the actual Err:510 cause turned out to be). The four attribute values here are copied verbatim from odf.js's own kitchen-sink.ods fixture's content.xml (a genuine LibreOffice 26.2 save), not guessed.
function buildCalculationSettings(): XmlElement {
  return el('table:calculation-settings', {
    'table:automatic-find-labels': 'false',
    'table:use-regular-expressions': 'false',
    'table:use-wildcards': 'true',
    'table:null-year': '1950',
  });
}

// office:spreadsheet starts with its calculation settings (above) and exactly one empty sheet -- OdsEditor.addSheet (editor.ts) appends more table:table elements after it, and buildOdsPackage (content.ts) removes this placeholder first when the source ContentDocument has any sheets of its own, mirroring odp/scaffold.ts's own empty office:presentation (which OdpEditor.addSlide populates one draw:page at a time) except ods always needs at least one real sheet to be a genuinely openable spreadsheet, unlike a presentation, which is perfectly valid with zero slides.
function buildContentXml(): XmlElement {
  const table = el('table:table', { 'table:name': DEFAULT_SHEET_NAME, 'table:style-name': SHEET_TABLE_STYLE_NAME });
  return el('office:document-content', { ...xmlnsAttributes([...CONTENT_NS_PREFIXES]), ...OF_NAMESPACE_ATTR, 'office:version': ODF_VERSION }, [
    el('office:automatic-styles', {}, [buildSheetTableStyle()]),
    el('office:body', {}, [el('office:spreadsheet', {}, [buildCalculationSettings(), table])]),
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

export interface CreateEmptyOdsPackageOptions {
  readonly metadata?: LayoutMetadata;
}

// Builds a minimal but genuinely valid, openable ods package from nothing: the mandatory mimetype part, a content.xml with one empty, named sheet (already referencing the shared print-settings style), a styles.xml with the page-layout -> master-page chain that sheet resolves through, a minimal meta.xml, and a manifest listing every part -- the same shape odt/odp's own createEmpty*Package functions use. A caller passing no options gets byte-for-byte the same package as before office:meta population existed.
export function createEmptyOdsPackage(options?: CreateEmptyOdsPackageOptions): Package {
  const pkg: Package = {
    parts: {
      'content.xml': { kind: 'xml', nodes: [declaration(), buildContentXml()] },
      'styles.xml': { kind: 'xml', nodes: [declaration(), buildStylesXml()] },
      'meta.xml': { kind: 'xml', nodes: [declaration(), buildMetaXml(options?.metadata)] },
    },
  };
  setDocumentMediaType(pkg, ODF_MEDIA_TYPES.ods);
  syncManifest(pkg);
  return pkg;
}
