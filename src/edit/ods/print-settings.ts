import type { Package, XmlElement } from 'odf.js';
import { findStyleElement, formatOdfLength, parseMargins, parsePageSize, resolvePageLayoutProperties } from 'odf.js';
import { attr } from 'ooxml.js';
import type { ContentSheetPrintSettings } from 'document-content-model';
import type { Margins } from '../../model/geometry';
import { PAGE_SIZE_A4 } from '../../model/geometry';
import { setAttr } from '../../xml/edit';
import { el } from '../../xml/fragment';
import { nextStyleName } from '../odt/automatic-styles';

const STYLES_PART_PATH = 'styles.xml';
const CONTENT_PART_PATH = 'content.xml';

function findRoot(pkg: Package, partPath: string): XmlElement {
  const part = pkg.parts[partPath];
  const root = part?.kind === 'xml' ? part.nodes.find((n): n is XmlElement => n.type === 'element') : undefined;
  if (root === undefined) {
    throw new Error(`package has no root element at ${partPath}`);
  }
  return root;
}

function directChild(parent: XmlElement, tag: string): XmlElement | undefined {
  for (const child of parent.children) {
    if (child.type === 'element' && child.tag === tag) {
      return child;
    }
  }
  return undefined;
}

// styles.xml's own office:automatic-styles/office:master-styles and content.xml's own office:automatic-styles are guaranteed to already exist on any package this editor's own createEmptyOdsPackage scaffolded (scaffold.ts's buildStylesXml/buildContentXml both create them unconditionally) -- so, unlike odt/automatic-styles.ts's own ensureAutomaticStyles (which DOES need create-if-missing logic, since a docx-derived package's own content.xml has no such guarantee), a plain find-or-throw is enough here.
function findStylesAutomaticStyles(pkg: Package): XmlElement {
  const found = directChild(findRoot(pkg, STYLES_PART_PATH), 'office:automatic-styles');
  if (found === undefined) {
    throw new Error(`${STYLES_PART_PATH} has no office:automatic-styles element`);
  }
  return found;
}

function findMasterStyles(pkg: Package): XmlElement {
  const found = directChild(findRoot(pkg, STYLES_PART_PATH), 'office:master-styles');
  if (found === undefined) {
    throw new Error(`${STYLES_PART_PATH} has no office:master-styles element`);
  }
  return found;
}

function findContentAutomaticStyles(pkg: Package): XmlElement {
  const found = directChild(findRoot(pkg, CONTENT_PART_PATH), 'office:automatic-styles');
  if (found === undefined) {
    throw new Error(`${CONTENT_PART_PATH} has no office:automatic-styles element`);
  }
  return found;
}

// 2cm in points -- LibreOffice Calc's own real out-of-the-box default page margin, matching scaffold.ts's own DEFAULT_MARGIN and its identical justification there. Used only as readSheetPrintSettings' own fallback for the pathological case of a table:table whose own style chain fails to resolve a page-layout at all -- never true for a package this editor itself built, since addSheet/writeSheetPrintSettings always mint one.
const DEFAULT_MARGIN_PT = 56.69291338582677;
const DEFAULT_MARGINS: Margins = { topPt: DEFAULT_MARGIN_PT, rightPt: DEFAULT_MARGIN_PT, bottomPt: DEFAULT_MARGIN_PT, leftPt: DEFAULT_MARGIN_PT };

// Mirrors odf.js's own private readPrintSettings (typed/ods/read.ts) for the five fields ContentSheetPrintSettingsSchema always carries (pageSize/margins/gridlines/headers/pageOrder) -- reusing odf.js's own exported findStyleElement/resolvePageLayoutProperties/parsePageSize/parseMargins rather than re-walking the table:style-name -> style:style[family="table"] -> style:master-page-name -> style:master-page -> style:page-layout -> style:page-layout-properties chain a second time. printRange/scale/fitToPages/repeatRows/repeatColumns/manualBreaks are deliberately NOT read here: resolving them needs the SAME table-wide repeated-column/row cursor tracking odf.js's own readTable already does before ever calling readPrintSettings (repeatColumns/repeatRows/manualBreakRows/manualBreakColumns, none of which a single table:table element carries any trace of on its own) -- a genuinely separate, larger undertaking than this getter's own scope, and writeSheetPrintSettings below never writes them either. A documented, bounded gap, not a silent one.
export function readSheetPrintSettings(pkg: Package, tableElement: XmlElement): ContentSheetPrintSettings {
  const tableStyleName = attr(tableElement, 'table:style-name');
  const tableStyleElement = tableStyleName === undefined ? undefined : findStyleElement(tableStyleName, 'table', pkg);
  const masterPageName = tableStyleElement === undefined ? undefined : attr(tableStyleElement, 'style:master-page-name');
  const layoutProperties = resolvePageLayoutProperties(pkg, masterPageName);
  const pageSize = layoutProperties === undefined ? undefined : parsePageSize(layoutProperties);
  const margins = layoutProperties === undefined ? undefined : parseMargins(layoutProperties);
  const printTokens = new Set((layoutProperties === undefined ? undefined : attr(layoutProperties, 'style:print'))?.split(' ').filter((token) => token.length > 0) ?? []);
  const pageOrder = (layoutProperties === undefined ? undefined : attr(layoutProperties, 'style:print-page-order')) === 'ltr' ? ('overThenDown' as const) : ('downThenOver' as const);
  return {
    pageSize: pageSize ?? PAGE_SIZE_A4,
    margins: margins ?? DEFAULT_MARGINS,
    gridlines: printTokens.has('grid'),
    headers: printTokens.has('headers'),
    pageOrder,
  };
}

// Mints a fresh, uniquely-named style:page-layout (styles.xml/office:automatic-styles) carrying pageSize/margins/gridlines/headers/pageOrder, a fresh style:master-page (styles.xml/office:master-styles) referencing it, and a fresh style:style[family="table"] (content.xml/office:automatic-styles) referencing THAT -- then repoints tableElement's own table:style-name to the new table-style. Always mints fresh names rather than searching for a reusable match: the same append-only "a setter always mints a fresh style:style and repoints, never mutates an existing entry" convention src/edit/odg/style.ts's own top-of-file note already documents and every other StyleRegistry-backed setter in this package shares -- a later call for a DIFFERENT sheet with different settings can never accidentally perturb an earlier sheet's own already-written style chain.
export function writeSheetPrintSettings(pkg: Package, tableElement: XmlElement, settings: ContentSheetPrintSettings): void {
  const stylesAutomaticStyles = findStylesAutomaticStyles(pkg);
  const masterStyles = findMasterStyles(pkg);
  const contentAutomaticStyles = findContentAutomaticStyles(pkg);

  const printTokens = [settings.gridlines ? 'grid' : undefined, settings.headers ? 'headers' : undefined].filter((token): token is string => token !== undefined);

  const pageLayoutName = nextStyleName(stylesAutomaticStyles, 'style:page-layout', 'OdsPageLayout');
  stylesAutomaticStyles.children.push(
    el('style:page-layout', { 'style:name': pageLayoutName }, [
      el('style:page-layout-properties', {
        'fo:page-width': formatOdfLength(settings.pageSize.widthPt),
        'fo:page-height': formatOdfLength(settings.pageSize.heightPt),
        'fo:margin-top': formatOdfLength(settings.margins.topPt),
        'fo:margin-right': formatOdfLength(settings.margins.rightPt),
        'fo:margin-bottom': formatOdfLength(settings.margins.bottomPt),
        'fo:margin-left': formatOdfLength(settings.margins.leftPt),
        ...(printTokens.length > 0 ? { 'style:print': printTokens.join(' ') } : {}),
        'style:print-page-order': settings.pageOrder === 'overThenDown' ? 'ltr' : 'ttb',
      }),
    ]),
  );

  const masterPageName = nextStyleName(masterStyles, 'style:master-page', 'OdsMasterPage');
  masterStyles.children.push(el('style:master-page', { 'style:name': masterPageName, 'style:page-layout-name': pageLayoutName }));

  const tableStyleName = nextStyleName(contentAutomaticStyles, 'style:style', 'OdsSheetPrint');
  contentAutomaticStyles.children.push(el('style:style', { 'style:name': tableStyleName, 'style:family': 'table', 'style:master-page-name': masterPageName }));

  setAttr(tableElement, 'table:style-name', tableStyleName);
}
