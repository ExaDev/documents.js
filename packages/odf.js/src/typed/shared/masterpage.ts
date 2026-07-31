import type { PageSize } from 'document-content-model';
import type { XmlElement } from '../../model/node';
import type { Package } from '../../model/package';
import { attrValue, childrenWithTag, findChildElement, rootElement } from '../../xml/query';
import { parsePageSize } from './geometry';

// draw:page's own page-size resolution chain -- draw:master-page-name -> style:master-page -> style:page-layout-name -> style:page-layout-properties -- verified structurally identical between office:presentation and office:drawing draw:page content against the OASIS ODF schema (draw:page's own attribute/content-model definition is a single, format-agnostic schema fragment reused by both office:body children, not two separate definitions): a drawing's own draw:page carries draw:master-page-name exactly like a presentation's does, resolving through the SAME style:master-page/style:page-layout machinery in styles.xml. Shared here (rather than duplicated the way odt/read.ts's OWN findPageLayoutElement deliberately is -- see that module's own top-of-file note on why ITS case differs) because odp and odg's own resolution is not merely similar but IDENTICAL: no format-specific divergence to keep separate.

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

// Resolves one draw:page's own size through the full chain, or undefined if any link doesn't resolve -- the caller supplies its own format-appropriate fallback (a presentation and a drawing document have genuinely different real-world defaults; see readOdp/readOdg's own DEFAULT_PAGE_SIZE constants) rather than this shared function baking one in.
export function resolveDrawPageSize(page: XmlElement, pkg: Package): PageSize | undefined {
  const masterPageName = attrValue(page, 'draw:master-page-name');
  const masterPage = findMasterPageElement(pkg, masterPageName);
  const pageLayoutName = masterPage === undefined ? undefined : attrValue(masterPage, 'style:page-layout-name');
  const pageLayout = findPageLayoutElement(pkg, pageLayoutName);
  const properties = pageLayout === undefined ? undefined : childrenWithTag(pageLayout, 'style:page-layout-properties')[0];
  return properties === undefined ? undefined : parsePageSize(properties);
}
