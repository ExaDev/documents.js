import type { DefinitionEntry, PageSize } from 'document-schema.js';
import type { XmlElement } from '../../model/node';
import type { Package } from '../../model/package';
import { attrValue, childrenWithTag, findChildElement, rootElement } from '../../xml/query';
import { parseMargins, parsePageSize } from './geometry';
import type { OdfListIdState } from './list';
import { readOdfConstructBodyBlocks, type OdfParagraphContext } from './paragraph';

// The master-page -> page-layout resolution chain shared by every ODF format that references a style:master-page by NAME: style:master-page -> style:page-layout-name -> style:page-layout -> style:page-layout-properties. draw:page's own page-size resolution (draw:master-page-name -> ...) was verified structurally identical between office:presentation and office:drawing draw:page content against the OASIS ODF schema (draw:page's own attribute/content-model definition is a single, format-agnostic schema fragment reused by both office:body children, not two separate definitions): a drawing's own draw:page carries draw:master-page-name exactly like a presentation's does, resolving through the SAME style:master-page/style:page-layout machinery in styles.xml. resolveDrawPageSize below is now a thin wrapper over resolvePageLayoutProperties -- the master-page-name -> page-layout-properties HALF of the chain -- because a spreadsheet's own print-settings resolution (typed/ods/read.ts) needs the identical remaining chain but starts from a genuinely different attribute (style:master-page-name on the table:table's own style:style[family="table"], not draw:master-page-name on a draw:page) and needs more than just PageSize out of the resolved properties (scale, page order, print token list, ...). Sharing the master-page-name -> properties half here, while leaving "how do we get the master-page name in the first place" to each caller, is the correct cut: that first step is genuinely format-specific, the rest is byte-for-byte identical machinery.

const STYLES_PART = 'styles.xml';
const CONTENT_PART = 'content.xml';
const AUTOMATIC_STYLE_PARTS = [CONTENT_PART, STYLES_PART] as const;

function findMasterPageElement(pkg: Package, masterPageName: string | undefined): XmlElement | undefined {
  if (masterPageName === undefined) {
    return undefined;
  }
  const stylesPart = pkg.parts[STYLES_PART];
  if (stylesPart?.kind !== 'xml') {
    return undefined;
  }
  const root = rootElement(stylesPart.nodes);
  const masterStyles = root === undefined ? undefined : findChildElement(root.children, 'office:master-styles');
  if (masterStyles === undefined) {
    return undefined;
  }
  return childrenWithTag(masterStyles, 'style:master-page').find((element) => attrValue(element, 'style:name') === masterPageName);
}

// A style:page-layout can live in either part's own office:automatic-styles (verified against real LibreOffice output: a presentation's/drawing's own page-layouts sit in styles.xml, but the ODF schema does not pin this to one specific part) -- mirroring cascade.ts's own collectStyles, which searches both content.xml and styles.xml for exactly this reason.
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

// Resolves a style:master-page NAME through the full chain (style:master-page -> style:page-layout-name -> style:page-layout -> style:page-layout-properties) to that page-layout's own style:page-layout-properties element, or undefined if any link doesn't resolve (no name given, no such master page, no page-layout-name, no such page-layout, or a page-layout with no style:page-layout-properties child at all -- real LibreOffice output omits it entirely for an untouched default page style, confirmed against a freshly-created, unmodified Calc document's own Default/Mpm1 page-layout). Exported so any typed reader whose OWN format resolves a master-page-name from a different starting attribute (draw:master-page-name below; a spreadsheet's table:table -> style:style[family="table"] -> style:master-page-name, in typed/ods/read.ts) can reuse this exact remaining chain rather than re-walking it.
export function resolvePageLayoutProperties(pkg: Package, masterPageName: string | undefined): XmlElement | undefined {
  const masterPage = findMasterPageElement(pkg, masterPageName);
  const pageLayoutName = masterPage === undefined ? undefined : attrValue(masterPage, 'style:page-layout-name');
  const pageLayout = findPageLayoutElement(pkg, pageLayoutName);
  return pageLayout === undefined ? undefined : childrenWithTag(pageLayout, 'style:page-layout-properties')[0];
}

// Resolves one draw:page's own size through the full chain, or undefined if any link doesn't resolve -- the caller supplies its own format-appropriate fallback (a presentation and a drawing document have genuinely different real-world defaults; see readOdpContent/readOdgContent's own DEFAULT_PAGE_SIZE constants) rather than this shared function baking one in.
export function resolveDrawPageSize(page: XmlElement, pkg: Package): PageSize | undefined {
  const masterPageName = attrValue(page, 'draw:master-page-name');
  const properties = resolvePageLayoutProperties(pkg, masterPageName);
  return properties === undefined ? undefined : parsePageSize(properties);
}

// --- master pages as definitions entries (ExaDev/documents.js#769) -----------------------------------------------------------------

// The six header/footer slots a style:master-page may carry, keyed as the definitions entry spells them. The keys deliberately mirror ODF's own element names (header/header-left/header-right) rather than translating them into an even/odd vocabulary: which slot a producer fills with which parity is a page-layout policy this reader does not model, and the entry's job is restorable fidelity, not interpretation.
const MASTER_PAGE_SLOTS: ReadonlyMap<string, string> = new Map([
  ['style:header', 'header'],
  ['style:header-left', 'headerLeft'],
  ['style:header-right', 'headerRight'],
  ['style:footer', 'footer'],
  ['style:footer-left', 'footerLeft'],
  ['style:footer-right', 'footerRight'],
]);

// Reads EVERY style:master-page in styles.xml's office:master-styles (document order) into the definitions table as `masterPage:<name>` entries: the page geometry each one's own style:page-layout resolves to, plus its header/footer slots read as real block flow through the same paragraph walk the body uses (so a header's fields, bookmarks, and formatting survive exactly as body content does). This is the landing spot for the two master-page rows #769 carried over from the #764 report: master pages AFTER the first no longer vanish -- every one becomes an entry -- and style:header/style:footer content is read rather than dropped. What deliberately does NOT happen here: mapping a mid-document master-page change onto a new ContentSection. ODF spells that as a paragraph style carrying style:master-page-name, and one ContentSection's own single pageSize/margins pair cannot host a page-style sequence -- the inventory's own 'future multi-section mapping' scope line. The odt reader's section geometry still comes from the first master page in document order; the entry table is where every later one lives.
export function readOdfMasterPageDefinitions(pkg: Package, out: Record<string, DefinitionEntry>, context: OdfParagraphContext, listIdState: OdfListIdState): void {
  const stylesPart = pkg.parts[STYLES_PART];
  const stylesRoot = stylesPart?.kind === 'xml' ? rootElement(stylesPart.nodes) : undefined;
  const masterStyles = stylesRoot === undefined ? undefined : findChildElement(stylesRoot.children, 'office:master-styles');
  if (masterStyles === undefined) {
    return;
  }
  for (const masterPage of childrenWithTag(masterStyles, 'style:master-page')) {
    const name = attrValue(masterPage, 'style:name');
    if (name === undefined) {
      continue;
    }
    const entry: DefinitionEntry = { kind: 'masterPage', name };
    // The master-page element is already in hand, so the page-layout resolves directly by its own style:page-layout-name -- the same chain resolvePageLayoutProperties walks for a caller holding only the master page's NAME, minus the redundant name -> element re-lookup.
    const pageLayout = findPageLayoutElement(pkg, attrValue(masterPage, 'style:page-layout-name'));
    const properties = pageLayout === undefined ? undefined : childrenWithTag(pageLayout, 'style:page-layout-properties')[0];
    if (properties !== undefined) {
      const pageSize = parsePageSize(properties);
      const margins = parseMargins(properties);
      if (pageSize !== undefined) {
        entry.pageSize = pageSize;
      }
      if (margins !== undefined) {
        entry.margins = margins;
      }
    }
    for (const [slotTag, slotKey] of MASTER_PAGE_SLOTS) {
      const slot = childrenWithTag(masterPage, slotTag)[0];
      if (slot !== undefined) {
        entry[slotKey] = readOdfConstructBodyBlocks(slot, pkg, context, listIdState);
      }
    }
    out[`masterPage:${name}`] = entry;
  }
}
