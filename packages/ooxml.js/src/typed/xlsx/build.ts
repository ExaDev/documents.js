import type { ContentCellValue, ContentDocument, ContentSheet, ContentSheetCell, ContentSheetColumn, ContentSheetPrintSettings, ContentSheetRow, LayoutMetadata } from 'document-schema.js';
import type { Package, XmlPart } from '../../model/package';
import type { XmlElement, XmlNode } from '../../model/node';
import { el, txt } from '../../xml/fragment';
import { encodeXmlText } from '../../xml/entities';
import { POINTS_PER_INCH } from '../shared/units';
import { cellReference, rangeReference } from './a1';
import { buildPrintAreaValue, buildPrintTitlesValue, XLNM_PRINT_AREA, XLNM_PRINT_TITLES } from './defined-names';
import { DEFAULT_HEADER_FOOTER_MARGIN_PT } from './print-settings';
import { SharedStringTable } from './shared-strings';
import { ptToColumnWidthChars } from './units';
import { pageSizeToPaperSizeCode, ptToUniversalMeasure, writeXmlBool } from './util';

// ContentDocument (kind: 'spreadsheet') -> Package: the first genuinely NEW xlsx package this ecosystem writes from scratch, rather than decoding/re-encoding an existing one -- every part below (down to xl/styles.xml's own minimal-but-real style table) is constructed directly via xml/fragment.ts's el/txt, matching typed/xlsx/content.ts's own readXlsxContent as its read-side inverse: writing everything that reader reads, honestly re-approximating the two lossy conversions (column-width characters, and the "no number-format engine" cell-value scope) it already documents on the way in. See typed/xlsx/content.test.ts and typed/xlsx/build.test.ts for the real-LibreOffice round-trip verification this pairing is built and tested against.

const SML_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const CORE_PROPS_NS = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
const DC_NS = 'http://purl.org/dc/elements/1.1/';
const DCTERMS_NS = 'http://purl.org/dc/terms/';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
const EXTENDED_PROPS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties';

const CT_WORKBOOK = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const CT_STYLES = 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml';
const CT_SHARED_STRINGS = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml';
const CT_WORKSHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
const CT_CORE_PROPS = 'application/vnd.openxmlformats-package.core-properties+xml';
const CT_EXTENDED_PROPS = 'application/vnd.openxmlformats-officedocument.extended-properties+xml';

const REL_OFFICE_DOCUMENT = `${REL_NS}/officeDocument`;
const REL_CORE_PROPS = `${PKG_RELS_NS}/metadata/core-properties`;
const REL_EXTENDED_PROPS = `${REL_NS}/extended-properties`;
const REL_WORKSHEET = `${REL_NS}/worksheet`;
const REL_STYLES = `${REL_NS}/styles`;
const REL_SHARED_STRINGS = `${REL_NS}/sharedStrings`;

// 0-based indices of the last column (XFD, the 16384th) and the last row (the 1,048,576th) -- the current OOXML worksheet size limits, used as rowBreaks/colBreaks' own <brk max="..."> extent (the full width/height of the sheet the break spans), per ECMA-376 Part 1 SS18.3.1.2's own min/max attribute semantics documented in print-settings.ts's readManualBreaks.
const MAX_COLUMN_INDEX = 16383;
const MAX_ROW_INDEX = 1048575;

function xmlDeclaration(): XmlNode {
  return { type: 'declaration', attributes: [{ name: 'version', value: '1.0' }, { name: 'encoding', value: 'UTF-8' }, { name: 'standalone', value: 'yes' }] };
}

function xmlPart(root: XmlElement): XmlPart {
  return { kind: 'xml', nodes: [xmlDeclaration(), root] };
}

// --- [Content_Types].xml -----------------------------------------------------------------------------------------

function buildContentTypesPart(sheetCount: number): XmlPart {
  const overrides: XmlElement[] = [
    el('Override', { PartName: '/xl/workbook.xml', ContentType: CT_WORKBOOK }),
    el('Override', { PartName: '/xl/styles.xml', ContentType: CT_STYLES }),
    el('Override', { PartName: '/xl/sharedStrings.xml', ContentType: CT_SHARED_STRINGS }),
  ];
  for (let index = 0; index < sheetCount; index++) {
    overrides.push(el('Override', { PartName: `/xl/worksheets/sheet${index + 1}.xml`, ContentType: CT_WORKSHEET }));
  }
  overrides.push(el('Override', { PartName: '/docProps/core.xml', ContentType: CT_CORE_PROPS }));
  overrides.push(el('Override', { PartName: '/docProps/app.xml', ContentType: CT_EXTENDED_PROPS }));
  const root = el('Types', { xmlns: CONTENT_TYPES_NS }, [
    el('Default', { Extension: 'rels', ContentType: 'application/vnd.openxmlformats-package.relationships+xml' }),
    el('Default', { Extension: 'xml', ContentType: 'application/xml' }),
    ...overrides,
  ]);
  return xmlPart(root);
}

// --- _rels/.rels and xl/_rels/workbook.xml.rels -------------------------------------------------------------------

function buildPackageRelsPart(): XmlPart {
  const root = el('Relationships', { xmlns: PKG_RELS_NS }, [
    el('Relationship', { Id: 'rId1', Type: REL_OFFICE_DOCUMENT, Target: 'xl/workbook.xml' }),
    el('Relationship', { Id: 'rId2', Type: REL_CORE_PROPS, Target: 'docProps/core.xml' }),
    el('Relationship', { Id: 'rId3', Type: REL_EXTENDED_PROPS, Target: 'docProps/app.xml' }),
  ]);
  return xmlPart(root);
}

function worksheetRelId(sheetIndex: number): string {
  return `rId${sheetIndex + 1}`;
}

function buildWorkbookRelsPart(sheetCount: number): XmlPart {
  const relationships: XmlElement[] = [];
  for (let index = 0; index < sheetCount; index++) {
    relationships.push(el('Relationship', { Id: worksheetRelId(index), Type: REL_WORKSHEET, Target: `worksheets/sheet${index + 1}.xml` }));
  }
  relationships.push(el('Relationship', { Id: `rId${sheetCount + 1}`, Type: REL_STYLES, Target: 'styles.xml' }));
  relationships.push(el('Relationship', { Id: `rId${sheetCount + 2}`, Type: REL_SHARED_STRINGS, Target: 'sharedStrings.xml' }));
  const root = el('Relationships', { xmlns: PKG_RELS_NS }, relationships);
  return xmlPart(root);
}

// --- xl/workbook.xml (sheets list + sheet-scoped Print_Area/Print_Titles defined names) --------------------------

function buildDefinedNameElements(sheets: readonly ContentSheet[]): XmlElement[] {
  const elements: XmlElement[] = [];
  sheets.forEach((sheet, sheetIndex) => {
    const { printRange, repeatRows, repeatColumns } = sheet.printSettings;
    if (printRange !== undefined) {
      const value = buildPrintAreaValue(sheet.name, printRange);
      elements.push(el('definedName', { name: XLNM_PRINT_AREA, localSheetId: String(sheetIndex) }, [txt(encodeXmlText(value))]));
    }
    if (repeatRows !== undefined || repeatColumns !== undefined) {
      const value = buildPrintTitlesValue(sheet.name, repeatRows, repeatColumns);
      if (value !== undefined) {
        elements.push(el('definedName', { name: XLNM_PRINT_TITLES, localSheetId: String(sheetIndex) }, [txt(encodeXmlText(value))]));
      }
    }
  });
  return elements;
}

function buildWorkbookPart(sheets: readonly ContentSheet[]): XmlPart {
  const sheetElements = sheets.map((sheet, index) => el('sheet', { name: encodeXmlText(sheet.name), sheetId: String(index + 1), 'r:id': worksheetRelId(index) }));
  const children: XmlElement[] = [el('sheets', {}, sheetElements)];
  const definedNameElements = buildDefinedNameElements(sheets);
  if (definedNameElements.length > 0) {
    children.push(el('definedNames', {}, definedNameElements));
  }
  const root = el('workbook', { xmlns: SML_NS, 'xmlns:r': REL_NS }, children);
  return xmlPart(root);
}

// --- xl/sharedStrings.xml -------------------------------------------------------------------------------------

function buildSharedStringsPart(sharedStrings: SharedStringTable): XmlPart {
  const entries = sharedStrings.entries();
  const siElements = entries.map((value) =>
    // xml:space="preserve" unconditionally -- confirmed as real producers' own convention (typed/xlsx/content.test.ts's own kitchen-sink fixture writes it on every single <t>, regardless of whether that particular string actually has significant leading/trailing whitespace), simpler and always-safe to match rather than conditionally detecting it per string.
    el('si', {}, [el('t', { 'xml:space': 'preserve' }, [txt(encodeXmlText(value))])]),
  );
  const root = el('sst', { xmlns: SML_NS, count: String(entries.length), uniqueCount: String(entries.length) }, siElements);
  return xmlPart(root);
}

// --- xl/styles.xml: genuinely minimal, the one styles part real Excel/LibreOffice both require to open a file at all ---

// Confirmed against multiple independent references (the fills[0]="none"/fills[1]="gray125" reserved-index convention, and cellStyleXfs/cellXfs each needing at least one real <xf> entry, are widely documented as the source of Excel's "we found a problem with some content" repair prompt when a hand-rolled writer omits them) rather than assumed: one font, the two reserved fills, one border, and one cellStyleXfs/cellXfs/cellStyles entry each -- every cell this writer produces references cellXfs index 0 (style attribute s="0"), the sole default format.
function buildStylesPart(): XmlPart {
  const root = el('styleSheet', { xmlns: SML_NS }, [
    el('fonts', { count: '1' }, [el('font', {}, [el('sz', { val: '11' }), el('name', { val: 'Calibri' })])]),
    el('fills', { count: '2' }, [el('fill', {}, [el('patternFill', { patternType: 'none' })]), el('fill', {}, [el('patternFill', { patternType: 'gray125' })])]),
    el('borders', { count: '1' }, [el('border', {}, [el('left'), el('right'), el('top'), el('bottom'), el('diagonal')])]),
    el('cellStyleXfs', { count: '1' }, [el('xf', { numFmtId: '0', fontId: '0', fillId: '0', borderId: '0' })]),
    el('cellXfs', { count: '1' }, [el('xf', { numFmtId: '0', fontId: '0', fillId: '0', borderId: '0', xfId: '0' })]),
    el('cellStyles', { count: '1' }, [el('cellStyle', { name: 'Normal', xfId: '0', builtinId: '0' })]),
  ]);
  return xmlPart(root);
}

// --- docProps/core.xml and docProps/app.xml -------------------------------------------------------------------

function buildCorePropertiesPart(metadata: LayoutMetadata): XmlPart {
  const children: XmlElement[] = [];
  if (metadata.title !== undefined) {
    children.push(el('dc:title', {}, [txt(encodeXmlText(metadata.title))]));
  }
  if (metadata.author !== undefined) {
    children.push(el('dc:creator', {}, [txt(encodeXmlText(metadata.author))]));
  }
  if (metadata.subject !== undefined) {
    children.push(el('dc:subject', {}, [txt(encodeXmlText(metadata.subject))]));
  }
  if (metadata.keywords !== undefined && metadata.keywords.length > 0) {
    children.push(el('cp:keywords', {}, [txt(encodeXmlText(metadata.keywords.join(', ')))]));
  }
  if (metadata.createdIso !== undefined) {
    children.push(el('dcterms:created', { 'xsi:type': 'dcterms:W3CDTF' }, [txt(encodeXmlText(metadata.createdIso))]));
  }
  if (metadata.modifiedIso !== undefined) {
    children.push(el('dcterms:modified', { 'xsi:type': 'dcterms:W3CDTF' }, [txt(encodeXmlText(metadata.modifiedIso))]));
  }
  const root = el('cp:coreProperties', { 'xmlns:cp': CORE_PROPS_NS, 'xmlns:dc': DC_NS, 'xmlns:dcterms': DCTERMS_NS, 'xmlns:xsi': XSI_NS }, children);
  return xmlPart(root);
}

function buildAppPropertiesPart(metadata: LayoutMetadata): XmlPart {
  const children: XmlElement[] = [];
  if (metadata.creator !== undefined) {
    children.push(el('Application', {}, [txt(encodeXmlText(metadata.creator))]));
  }
  const root = el('Properties', { xmlns: EXTENDED_PROPS_NS }, children);
  return xmlPart(root);
}

// --- xl/worksheets/sheetN.xml ------------------------------------------------------------------------------------

function computeDimension(sheet: ContentSheet): string {
  let maxRow = 0;
  let maxColumn = 0;
  let hasAny = false;
  for (const cell of sheet.cells) {
    hasAny = true;
    maxRow = Math.max(maxRow, cell.row);
    maxColumn = Math.max(maxColumn, cell.column);
  }
  for (const column of sheet.columns) {
    hasAny = true;
    maxColumn = Math.max(maxColumn, column.index);
  }
  for (const row of sheet.rows) {
    hasAny = true;
    maxRow = Math.max(maxRow, row.index);
  }
  return hasAny ? rangeReference({ startRow: 0, startColumn: 0, endRow: maxRow, endColumn: maxColumn }) : 'A1';
}

function buildColsElement(columns: readonly ContentSheetColumn[]): XmlElement | undefined {
  if (columns.length === 0) {
    return undefined;
  }
  // One <col min max> range per ContentSheetColumn, min=max=that single column -- the honest inverse of readColumns' own "one entry per <col> element, never per repeated position" policy: this writer never attempts to re-merge adjacent same-width columns back into a wider range, which would be a real optimization but isn't needed for a correct, valid file.
  const colElements = columns.map((column) => {
    const attrs: Record<string, string> = {
      min: String(column.index + 1),
      max: String(column.index + 1),
      width: ptToColumnWidthChars(column.widthPt).toFixed(2),
      customWidth: 'true',
    };
    if (column.hidden === true) {
      attrs.hidden = 'true';
    }
    return el('col', attrs);
  });
  return el('cols', {}, colElements);
}

interface RenderedCellValue {
  type?: string;
  content: string;
}

// xlsx has no distinct value-type for percentage/currency (see typed/xlsx/content.ts's own top-of-file scope note) -- both write as a plain numeric cell, carrying the raw numeric value through losslessly while the percentage/currency SEMANTIC (which would normally live in a numFmt style) is dropped, matching this writer's own genuinely-minimal xl/styles.xml (no custom number formats at all).
function renderCellValue(value: ContentCellValue, isFormulaResult: boolean, sharedStrings: SharedStringTable): RenderedCellValue | undefined {
  switch (value.kind) {
    case 'string':
      if (isFormulaResult) {
        // A formula's own cached string result is written literally (t="str"), never shared-string indexed -- shared strings are ECMA-376's own convention for literal, non-formula text cells only; a formula's cached text result is written inline instead, mirroring exactly how typed/xlsx/content.ts's readCellValue reads the two cases apart.
        return { type: 'str', content: encodeXmlText(value.value) };
      }
      return { type: 's', content: String(sharedStrings.intern(value.value)) };
    case 'number':
    case 'percentage':
    case 'currency':
      return { content: String(value.value) };
    case 'boolean':
      return { type: 'b', content: value.value ? '1' : '0' };
    case 'date':
    case 'time':
      // ST_CellType's rare "d" variant -- the ISO-8601 string carried verbatim, never shared-string indexed, matching how content.ts's reader treats it symmetrically.
      return { type: 'd', content: encodeXmlText(value.value) };
    case 'error':
      return { type: 'e', content: encodeXmlText(value.value) };
    case 'empty':
      return undefined;
  }
}

function buildCellElement(cell: ContentSheetCell, sharedStrings: SharedStringTable): XmlElement {
  const attrs: Record<string, string> = { r: cellReference(cell.row, cell.column), s: '0' };
  const children: XmlNode[] = [];
  if (cell.formula !== undefined) {
    children.push(el('f', {}, [txt(encodeXmlText(cell.formula))]));
  }
  const rendered = renderCellValue(cell.value, cell.formula !== undefined, sharedStrings);
  if (rendered !== undefined) {
    if (rendered.type !== undefined) {
      attrs.t = rendered.type;
    }
    children.push(el('v', {}, [txt(rendered.content)]));
  }
  return el('c', attrs, children);
}

function buildSheetDataElement(sheet: ContentSheet, sharedStrings: SharedStringTable): XmlElement {
  const cellsByRow = new Map<number, ContentSheetCell[]>();
  for (const cell of sheet.cells) {
    const existing = cellsByRow.get(cell.row);
    if (existing === undefined) {
      cellsByRow.set(cell.row, [cell]);
    } else {
      existing.push(cell);
    }
  }
  const rowInfoByIndex = new Map<number, ContentSheetRow>();
  for (const row of sheet.rows) {
    rowInfoByIndex.set(row.index, row);
  }
  const rowIndices = Array.from(new Set<number>([...cellsByRow.keys(), ...rowInfoByIndex.keys()])).sort((a, b) => a - b);

  const rowElements = rowIndices.map((rowIndex) => {
    const cells = (cellsByRow.get(rowIndex) ?? []).slice().sort((a, b) => a.column - b.column);
    const rowInfo = rowInfoByIndex.get(rowIndex);
    const attrs: Record<string, string> = { r: String(rowIndex + 1) };
    if (rowInfo !== undefined) {
      attrs.ht = String(rowInfo.heightPt);
      attrs.customHeight = 'true';
      if (rowInfo.hidden === true) {
        attrs.hidden = 'true';
      }
    }
    return el('row', attrs, cells.map((cell) => buildCellElement(cell, sharedStrings)));
  });
  return el('sheetData', {}, rowElements);
}

function buildMergeCellsElement(cells: readonly ContentSheetCell[]): XmlElement | undefined {
  const merges = cells.filter((cell) => (cell.colSpan ?? 1) > 1 || (cell.rowSpan ?? 1) > 1);
  if (merges.length === 0) {
    return undefined;
  }
  const mergeCellElements = merges.map((cell) => {
    const endRow = cell.row + (cell.rowSpan ?? 1) - 1;
    const endColumn = cell.column + (cell.colSpan ?? 1) - 1;
    return el('mergeCell', { ref: rangeReference({ startRow: cell.row, startColumn: cell.column, endRow, endColumn }) });
  });
  return el('mergeCells', { count: String(mergeCellElements.length) }, mergeCellElements);
}

function buildSheetPrElement(settings: ContentSheetPrintSettings): XmlElement {
  return el('sheetPr', {}, [el('pageSetUpPr', { fitToPage: writeXmlBool(settings.fitToPages !== undefined) })]);
}

function buildPrintOptionsElement(settings: ContentSheetPrintSettings): XmlElement {
  return el('printOptions', { gridLines: writeXmlBool(settings.gridlines), headings: writeXmlBool(settings.headers) });
}

function ptToInches(pt: number): string {
  return String(pt / POINTS_PER_INCH);
}

function buildPageMarginsElement(settings: ContentSheetPrintSettings): XmlElement {
  const margins = settings.margins;
  return el('pageMargins', {
    left: ptToInches(margins.leftPt),
    right: ptToInches(margins.rightPt),
    top: ptToInches(margins.topPt),
    bottom: ptToInches(margins.bottomPt),
    header: ptToInches(DEFAULT_HEADER_FOOTER_MARGIN_PT),
    footer: ptToInches(DEFAULT_HEADER_FOOTER_MARGIN_PT),
  });
}

function buildPageSetupElement(settings: ContentSheetPrintSettings): XmlElement {
  const attrs: Record<string, string> = {};
  const paperCode = pageSizeToPaperSizeCode(settings.pageSize);
  if (paperCode !== undefined) {
    attrs.paperSize = paperCode;
  } else {
    attrs.paperWidth = ptToUniversalMeasure(settings.pageSize.widthPt);
    attrs.paperHeight = ptToUniversalMeasure(settings.pageSize.heightPt);
  }
  // scale/fitToWidth/fitToHeight are written together regardless of which mode sheetPr/pageSetUpPr@fitToPage actually selects -- matching real producer output (see this directory's own kitchen-sink fixture, where LibreOffice writes all three unconditionally, only one pair of them ever meaningfully honoured).
  attrs.scale = String(settings.scale ?? 100);
  attrs.fitToWidth = String(settings.fitToPages?.width ?? 1);
  attrs.fitToHeight = String(settings.fitToPages?.height ?? 1);
  attrs.pageOrder = settings.pageOrder;
  // ContentSheetPrintSettings carries no explicit print-orientation field of its own -- PageSize's own width-vs-height already encodes it (a landscape page style's own recorded width exceeds its height), the same relationship typed/xlsx/print-settings.ts's own readPageSize swaps back on the way in when pageSetup@orientation="landscape" is present, so this is a real, non-fabricated derivation, not an assumption.
  attrs.orientation = settings.pageSize.widthPt > settings.pageSize.heightPt ? 'landscape' : 'portrait';
  return el('pageSetup', attrs);
}

function buildBreaksElements(settings: ContentSheetPrintSettings): { rowBreaks?: XmlElement; colBreaks?: XmlElement } {
  const manualBreaks = settings.manualBreaks;
  if (manualBreaks === undefined) {
    return {};
  }
  const result: { rowBreaks?: XmlElement; colBreaks?: XmlElement } = {};
  if (manualBreaks.rows.length > 0) {
    const breaks = manualBreaks.rows.map((id) => el('brk', { id: String(id), min: '0', max: String(MAX_COLUMN_INDEX), man: '1' }));
    result.rowBreaks = el('rowBreaks', { count: String(breaks.length), manualBreakCount: String(breaks.length) }, breaks);
  }
  if (manualBreaks.columns.length > 0) {
    const breaks = manualBreaks.columns.map((id) => el('brk', { id: String(id), min: '0', max: String(MAX_ROW_INDEX), man: '1' }));
    result.colBreaks = el('colBreaks', { count: String(breaks.length), manualBreakCount: String(breaks.length) }, breaks);
  }
  return result;
}

// CT_Worksheet's own required child element ORDER (ECMA-376 Part 1 SS18.3.1.99): sheetPr?, dimension?, sheetViews?, sheetFormatPr?, cols*, sheetData, ..., mergeCells?, ..., printOptions?, pageMargins?, pageSetup?, headerFooter?, rowBreaks?, colBreaks?, ... -- every element this writer emits follows that relative order (sheetViews and headerFooter are both skipped entirely: pure UI/print-preview state this package's own content model carries no data for).
function buildWorksheetPart(sheet: ContentSheet, sharedStrings: SharedStringTable): XmlPart {
  const children: XmlElement[] = [buildSheetPrElement(sheet.printSettings), el('dimension', { ref: computeDimension(sheet) })];

  const colsElement = buildColsElement(sheet.columns);
  if (colsElement !== undefined) {
    children.push(colsElement);
  }

  children.push(buildSheetDataElement(sheet, sharedStrings));

  const mergeCellsElement = buildMergeCellsElement(sheet.cells);
  if (mergeCellsElement !== undefined) {
    children.push(mergeCellsElement);
  }

  children.push(buildPrintOptionsElement(sheet.printSettings), buildPageMarginsElement(sheet.printSettings), buildPageSetupElement(sheet.printSettings));

  const { rowBreaks, colBreaks } = buildBreaksElements(sheet.printSettings);
  if (rowBreaks !== undefined) {
    children.push(rowBreaks);
  }
  if (colBreaks !== undefined) {
    children.push(colBreaks);
  }

  const root = el('worksheet', { xmlns: SML_NS, 'xmlns:r': REL_NS }, children);
  return xmlPart(root);
}

// --- entry point -----------------------------------------------------------------------------------------------

export function buildXlsxPackage(document: ContentDocument): Package {
  if (document.kind !== 'spreadsheet') {
    throw new Error(`buildXlsxPackage: expected a ContentDocument of kind "spreadsheet", got "${document.kind}"`);
  }

  const sheets = document.sheets;
  const sharedStrings = new SharedStringTable();
  // Building every worksheet part first, before touching xl/sharedStrings.xml, is load-bearing: buildCellElement interns every literal string value into `sharedStrings` as a side effect while it walks each sheet's cells, and buildSharedStringsPart below must see the FULLY populated table.
  const worksheetParts = sheets.map((sheet) => buildWorksheetPart(sheet, sharedStrings));

  const parts: Package['parts'] = {
    '[Content_Types].xml': buildContentTypesPart(sheets.length),
    '_rels/.rels': buildPackageRelsPart(),
    'xl/workbook.xml': buildWorkbookPart(sheets),
    'xl/_rels/workbook.xml.rels': buildWorkbookRelsPart(sheets.length),
    'xl/styles.xml': buildStylesPart(),
    'xl/sharedStrings.xml': buildSharedStringsPart(sharedStrings),
    'docProps/core.xml': buildCorePropertiesPart(document.metadata),
    'docProps/app.xml': buildAppPropertiesPart(document.metadata),
  };
  worksheetParts.forEach((part, index) => {
    parts[`xl/worksheets/sheet${index + 1}.xml`] = part;
  });

  return { parts };
}
