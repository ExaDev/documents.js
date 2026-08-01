import type { ContentCellValue, ContentDocument, ContentSheet, ContentSheetCell, ContentSheetColumn, ContentSheetRow } from 'document-schema.js';
import { CONTENT_FORMAT_VERSION } from 'document-schema.js';
import type { Package } from '../../model/package';
import type { XmlElement } from '../../model/node';
import { attr, childrenWithTag, elementsWithTag, resolveRelationships, rootElement, textContent } from '../util';
import { readCoreProperties } from '../shared/metadata';
import { parseCellReference, parseRangeReference } from './a1';
import type { SheetDefinedNames } from './defined-names';
import { readDefinedNamesBySheet } from './defined-names';
import { readPrintSettings } from './print-settings';
import { loadSharedStrings } from './shared-strings';
import { columnWidthCharsToPt, DEFAULT_ROW_HEIGHT_PT } from './units';
import { readXmlBool } from './util';

// Package -> ContentDocument (kind: 'spreadsheet'): a SpreadsheetML reader built geometry- and print-settings-rich, matching readOds's own established bar in the sibling odf.js package (real column widths, row heights, hidden rows/columns, merged ranges, every cell value kind this format actually distinguishes, and a genuinely populated ContentSheetPrintSettings), rather than the lossy cell-values-only projection typed/xlsx.ts's own readXlsx provides. Unlike readOds, this returns a full ContentDocument envelope directly (kind/formatVersion/metadata/sheets) rather than a bare {metadata, sheets} shape -- readXlsxContent and typed/xlsx/build.ts's buildXlsxPackage are designed as a matched read/write pair around ContentDocument specifically, so a caller can round-trip readXlsxContent(buildXlsxPackage(x)) without an extra wrapping/unwrapping step, and documents.js's own future ods<->xlsx bridge (bypassing PDF, the same way its existing odt<->docx/odp<->pptx bridges do) can treat this reader's own output as an already-correctly-shaped pivot value.
//
// SCOPE, stated up front rather than only at each individual site below: (1) xlsx's own cell-type vocabulary (t="n"/absent, "s", "str", "inlineStr", "b", "e") has no percentage/currency/date variant the way ODF's office:value-type does -- those are all just numeric cells with a number-format style applied, and distinguishing them would require this package to inspect and interpret xl/styles.xml's own numFmt codes, i.e. build a real number-format engine, which this package deliberately does not do (the same "no number-format engine" boundary readOds's own displayText design already established). Every numeric xlsx cell therefore reads as ContentCellValue's 'number' kind, never 'percentage'/'currency'/'date' -- a real, documented scope narrowing, not a bug. (2) displayText has no native xlsx equivalent to read verbatim the way ODF's text:p content or a cached string gives readOds for free -- see deriveDisplayText below for exactly how this reader constructs one instead. (3) ContentSheetCellSchema's own `runs` field (genuinely mixed inline formatting within one cell) is never populated -- xlsx rich-text runs (<is>/<si>'s own nested <r><rPr>...) use a distinct font-property vocabulary from docx/pptx's own run styling, and resolving it would duplicate a meaningful slice of that machinery for a rarely-used feature not in this reader's own required field list; only the concatenated plain text (via deriveDisplayText) is read.

const WORKBOOK_PATH = 'xl/workbook.xml';

interface SheetEntry {
  name: string;
  path: string;
}

// Sheet order and part paths come from xl/workbook.xml's own <sheets> list, resolved through xl/_rels/workbook.xml.rels -- the same "never trust filename order" precedent readPptx already established for p:sldIdLst (worksheets, like slides, carry no ordering guarantee in their own part names).
function resolveSheetEntries(pkg: Package): SheetEntry[] {
  const workbook = rootElement(pkg.parts[WORKBOOK_PATH]);
  if (workbook === undefined) {
    return [];
  }
  const sheetsEl = childrenWithTag(workbook, 'sheets')[0];
  if (sheetsEl === undefined) {
    return [];
  }
  const rels = resolveRelationships(pkg, WORKBOOK_PATH);
  const entries: SheetEntry[] = [];
  for (const sheet of childrenWithTag(sheetsEl, 'sheet')) {
    const name = attr(sheet, 'name');
    const rId = attr(sheet, 'r:id');
    const rel = rId === undefined ? undefined : rels.get(rId);
    if (name !== undefined && rel !== undefined) {
      entries.push({ name, path: rel.target });
    }
  }
  return entries;
}

function sheetFormatDefaultRowHeightPt(worksheet: XmlElement): number {
  const sheetFormatPr = childrenWithTag(worksheet, 'sheetFormatPr')[0];
  const raw = sheetFormatPr === undefined ? undefined : attr(sheetFormatPr, 'defaultRowHeight');
  if (raw === undefined) {
    return DEFAULT_ROW_HEIGHT_PT;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_ROW_HEIGHT_PT;
}

// One ContentSheetColumn per <col> XML element, at that element's own starting index (min-1, 0-based) -- NEVER one per position in [min,max] -- mirroring readOds's own established "repeat hazard" policy for table:table-column/table:number-columns-repeated (typed/ods/read.ts's own top-of-file note): a real producer's own trailing <col min="10" max="16384" .../> covering "the rest of the sheet" must not be materialized into over sixteen thousand entries.
function readColumns(worksheet: XmlElement): ContentSheetColumn[] {
  const colsEl = childrenWithTag(worksheet, 'cols')[0];
  if (colsEl === undefined) {
    return [];
  }
  const columns: ContentSheetColumn[] = [];
  for (const col of childrenWithTag(colsEl, 'col')) {
    const minRaw = attr(col, 'min');
    const min = minRaw === undefined ? undefined : Number.parseInt(minRaw, 10);
    if (min === undefined || !Number.isInteger(min) || min < 1) {
      continue;
    }
    const widthRaw = attr(col, 'width');
    const widthPt = widthRaw === undefined ? 0 : columnWidthCharsToPt(Number(widthRaw));
    const column: ContentSheetColumn = { index: min - 1, widthPt: Number.isFinite(widthPt) ? widthPt : 0 };
    if (readXmlBool(attr(col, 'hidden'))) {
      column.hidden = true;
    }
    columns.push(column);
  }
  return columns;
}

// One ContentSheetRow per real <row> XML element -- xlsx has no repeat-compression mechanism for rows the way ODF's table:number-rows-repeated does (a real producer simply omits <row> entirely for a genuinely blank row), so there is no equivalent repeat hazard to guard against here.
function readRows(worksheet: XmlElement): ContentSheetRow[] {
  const sheetData = childrenWithTag(worksheet, 'sheetData')[0];
  if (sheetData === undefined) {
    return [];
  }
  const fallbackHeightPt = sheetFormatDefaultRowHeightPt(worksheet);
  const rows: ContentSheetRow[] = [];
  for (const row of childrenWithTag(sheetData, 'row')) {
    const rRaw = attr(row, 'r');
    const rowNumber = rRaw === undefined ? undefined : Number.parseInt(rRaw, 10);
    if (rowNumber === undefined || !Number.isInteger(rowNumber) || rowNumber < 1) {
      continue;
    }
    const htRaw = attr(row, 'ht');
    const heightPt = htRaw === undefined ? fallbackHeightPt : Number(htRaw);
    const contentRow: ContentSheetRow = { index: rowNumber - 1, heightPt: Number.isFinite(heightPt) ? heightPt : fallbackHeightPt };
    if (readXmlBool(attr(row, 'hidden'))) {
      contentRow.hidden = true;
    }
    rows.push(contentRow);
  }
  return rows;
}

// <is> (an inline string cell's own content) and a shared-string <si> entry share the identical shape: one or more <t> runs, optionally wrapped in <r> (rich-text run) elements. elementsWithTag's own recursive descendant search collects every <t> regardless of <r> nesting depth, in document order, which is exactly the concatenation both shapes need.
function readInlineOrSharedStringText(container: XmlElement): string {
  let value = '';
  for (const t of elementsWithTag(container.children, 't')) {
    value += textContent(t);
  }
  return value;
}

interface ResolvedCellValue {
  value: ContentCellValue;
  displayText: string;
}

// Derives displayText -- xlsx has no cached "producer-rendered string" field the way ODF's own text:p content (or, for a genuinely numeric cell, its office:value-type-adjacent convention) gives readOds for free; a numeric cell's <v> is always the bare, unformatted number, with any currency symbol/date format/percentage sign living purely in xl/styles.xml's own numFmt code that this reader deliberately does not interpret (see this module's own top-of-file scope note). This reader's own honest, documented choice: displayText is a plain string representation of the typed value, NOT accounting for the cell's actual number format -- String(value) for a number, 'TRUE'/'FALSE' for a boolean (matching Excel's own default, unformatted boolean display), the string/error text verbatim for the string/error kinds, and the raw ISO date/time string verbatim for the rare t="d" kind.
function deriveDisplayText(value: ContentCellValue): string {
  switch (value.kind) {
    case 'number':
      return String(value.value);
    case 'boolean':
      return value.value ? 'TRUE' : 'FALSE';
    case 'string':
    case 'error':
    case 'date':
    case 'time':
      return value.value;
    case 'percentage':
    case 'currency':
      // Never produced by this reader (see the top-of-file scope note) -- included only so this switch stays exhaustive against ContentCellValue's own discriminated union.
      return String(value.value);
    case 'empty':
      return '';
  }
}

// Maps a <c>'s own t attribute (ECMA-376 ST_CellType) plus its <v>/<is> content to ContentCellValue. t="n" and an absent t attribute are the identical case (ECMA-376's own schema default for CT_Cell/@t is "n"). A cell with no <v>, no <is>, and no <f> at all is genuinely empty (styling-only, or a covered/merged-away position LibreOffice itself still writes a bare styled <c> for -- see this package's own kitchen-sink fixture) and returns undefined, matching typed/xlsx.ts's own readXlsx precedent of dropping such cells rather than fabricating content for them.
function readCellValue(cell: XmlElement, sharedStrings: readonly string[]): ResolvedCellValue | undefined {
  const type = attr(cell, 't');
  if (type === 'inlineStr') {
    const is = childrenWithTag(cell, 'is')[0];
    const text = is === undefined ? undefined : readInlineOrSharedStringText(is);
    return text === undefined ? undefined : { value: { kind: 'string', value: text }, displayText: text };
  }
  const valueEl = childrenWithTag(cell, 'v')[0];
  const raw = valueEl === undefined ? undefined : textContent(valueEl);
  if (raw === undefined) {
    return undefined;
  }
  if (type === 's') {
    const index = Number.parseInt(raw, 10);
    const text = Number.isInteger(index) ? sharedStrings[index] : undefined;
    return text === undefined ? undefined : { value: { kind: 'string', value: text }, displayText: text };
  }
  if (type === 'str') {
    return { value: { kind: 'string', value: raw }, displayText: raw };
  }
  if (type === 'b') {
    const value: ContentCellValue = { kind: 'boolean', value: raw === '1' || raw.toLowerCase() === 'true' };
    return { value, displayText: deriveDisplayText(value) };
  }
  if (type === 'e') {
    return { value: { kind: 'error', value: raw }, displayText: raw };
  }
  if (type === 'd') {
    // ST_CellType's rare ISO-8601 date variant -- carried verbatim, unparsed, matching readOds's own established convention for office:date-value/office:time-value.
    return { value: { kind: 'date', value: raw }, displayText: raw };
  }
  const num = Number(raw);
  if (Number.isNaN(num)) {
    return undefined;
  }
  const value: ContentCellValue = { kind: 'number', value: num };
  return { value, displayText: deriveDisplayText(value) };
}

function readCell(cell: XmlElement, sharedStrings: readonly string[]): ContentSheetCell | undefined {
  const reference = attr(cell, 'r');
  const position = reference === undefined ? undefined : parseCellReference(reference);
  if (position === undefined) {
    return undefined;
  }
  const formulaEl = childrenWithTag(cell, 'f')[0];
  const formula = formulaEl === undefined ? undefined : textContent(formulaEl);
  const resolved = readCellValue(cell, sharedStrings);
  if (resolved === undefined) {
    if (formula === undefined) {
      return undefined;
    }
    // A formula cell with no cached <v> at all (never recalculated by its producer) still carries real content worth keeping -- the formula itself -- even with no result to show yet.
    return { row: position.row, column: position.column, value: { kind: 'empty' }, formula, displayText: '' };
  }
  const cellEntry: ContentSheetCell = { row: position.row, column: position.column, value: resolved.value, displayText: resolved.displayText };
  if (formula !== undefined) {
    cellEntry.formula = formula;
  }
  return cellEntry;
}

// Merged ranges (<mergeCells><mergeCell ref="A1:B2"/></mergeCells>) map onto colSpan/rowSpan on the ANCHOR cell (the range's own top-left position) -- the same anchor/covered-cell convention readOds/readOdt already use for their own merged ranges. Unlike ODF's table:covered-table-cell (a distinct element the reader can skip outright), xlsx writes an ordinary, genuinely empty <c> for each covered position (confirmed via this package's own kitchen-sink fixture: B6/A7/B7 for a merged A6:B7 range each exist as bare, valueless <c s="..."/> elements) -- readCell's own existing "no v/is/f at all -> drop" rule already handles those without any merge-specific logic.
function applyMergedRanges(worksheet: XmlElement, cells: readonly ContentSheetCell[]): void {
  const mergeCellsEl = childrenWithTag(worksheet, 'mergeCells')[0];
  if (mergeCellsEl === undefined) {
    return;
  }
  const byPosition = new Map<string, ContentSheetCell>();
  for (const cell of cells) {
    byPosition.set(`${cell.row}:${cell.column}`, cell);
  }
  for (const mergeCell of childrenWithTag(mergeCellsEl, 'mergeCell')) {
    const ref = attr(mergeCell, 'ref');
    const range = ref === undefined ? undefined : parseRangeReference(ref);
    if (range === undefined) {
      continue;
    }
    const anchor = byPosition.get(`${range.startRow}:${range.startColumn}`);
    if (anchor === undefined) {
      // A merge whose anchor cell carries no content at all (no cell entry exists to attach colSpan/rowSpan to) has nothing left to represent -- ContentSheetCellSchema has no "empty merge placeholder" concept, matching readCell's own established "genuinely empty -> not materialized" policy.
      continue;
    }
    const colSpan = range.endColumn - range.startColumn + 1;
    const rowSpan = range.endRow - range.startRow + 1;
    if (colSpan > 1) {
      anchor.colSpan = colSpan;
    }
    if (rowSpan > 1) {
      anchor.rowSpan = rowSpan;
    }
  }
}

function readCells(worksheet: XmlElement, sharedStrings: readonly string[]): ContentSheetCell[] {
  const sheetData = childrenWithTag(worksheet, 'sheetData')[0];
  if (sheetData === undefined) {
    return [];
  }
  const cells: ContentSheetCell[] = [];
  for (const row of childrenWithTag(sheetData, 'row')) {
    for (const cell of childrenWithTag(row, 'c')) {
      const read = readCell(cell, sharedStrings);
      if (read !== undefined) {
        cells.push(read);
      }
    }
  }
  applyMergedRanges(worksheet, cells);
  return cells;
}

function readSheet(pkg: Package, entry: SheetEntry, sheetIndex: number, sharedStrings: readonly string[], definedNamesBySheet: ReadonlyMap<number, SheetDefinedNames>): ContentSheet {
  const worksheet = rootElement(pkg.parts[entry.path]);
  if (worksheet === undefined) {
    return { name: entry.name, cells: [], columns: [], rows: [], images: [], printSettings: readPrintSettings(fallbackEmptyWorksheet(), sheetIndex, definedNamesBySheet) };
  }
  return {
    name: entry.name,
    cells: readCells(worksheet, sharedStrings),
    columns: readColumns(worksheet),
    rows: readRows(worksheet),
    images: [],
    printSettings: readPrintSettings(worksheet, sheetIndex, definedNamesBySheet),
  };
}

// A minimal, childless <worksheet> element, used only as readPrintSettings' own input when a <sheet> in xl/workbook.xml points at a part the package doesn't actually have (a malformed package) -- gives the same all-defaults ContentSheetPrintSettings a genuinely empty worksheet would produce, without readPrintSettings itself needing an `undefined`-worksheet branch.
function fallbackEmptyWorksheet(): XmlElement {
  return { type: 'element', tag: 'worksheet', attributes: [], children: [] };
}

export function readXlsxContent(pkg: Package): ContentDocument {
  const sharedStrings = loadSharedStrings(pkg);
  const definedNamesBySheet = readDefinedNamesBySheet(pkg);
  const entries = resolveSheetEntries(pkg);
  const sheets = entries.map((entry, sheetIndex) => readSheet(pkg, entry, sheetIndex, sharedStrings, definedNamesBySheet));
  return {
    kind: 'spreadsheet',
    formatVersion: CONTENT_FORMAT_VERSION,
    metadata: readCoreProperties(pkg),
    sheets,
  };
}
