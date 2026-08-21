import type { ContentCellValue, ContentDocument, ContentSheet, ContentSheetCell, ContentSheetColumn, ContentSheetRow } from 'document-schema.js';
import type { Package } from '../../model/package';
import type { XmlElement } from '../../model/node';
import { buildXml } from '../../xml/build';
import { attr, childrenWithTag, elementsWithTag, resolveRelationships, rootElement, textContent } from '../util';
import { readCoreProperties } from '../shared/metadata';
import { parseCellReference, parseRangeReference } from 'document-schema.js';
import type { SheetDefinedNames } from './defined-names';
import { readDefinedNamesBySheet } from './defined-names';
import type { NumberFormatClass } from './number-format';
import { classifyNumberFormat } from './number-format';
import { readSheetDrawing } from './drawings';
import { readPrintSettings } from './print-settings';
import { readDate1904, serialToIsoDate, serialToIsoDateTime, serialToIsoTime } from './serial';
import { loadSharedStrings } from './shared-strings';
import type { CellStyleEntry } from './styles';
import { readCellStyles } from './styles';
import type { SheetCellComment } from './comments';
import { readSheetCellComments } from './comments';
import { columnWidthCharsToPt, DEFAULT_ROW_HEIGHT_PT } from './units';
import { readXmlBool } from './util';

// Package -> ContentDocument (kind: 'spreadsheet'): a SpreadsheetML reader built geometry- and print-settings-rich, matching readOds's own established bar in the sibling odf.js package (real column widths, row heights, hidden rows/columns, merged ranges, every cell value kind this format actually distinguishes, and a genuinely populated ContentSheetPrintSettings), rather than the lossy cell-values-only projection typed/xlsx.ts's own readXlsxWorkbook provides. Unlike readOds, this returns a full ContentDocument envelope directly (kind/metadata/sheets) rather than a bare {metadata, sheets} shape -- readXlsxContent and typed/xlsx/build.ts's buildXlsxPackageFromContent are designed as a matched read/write pair around ContentDocument specifically, so a caller can round-trip readXlsxContent(buildXlsxPackageFromContent(x)) without an extra wrapping/unwrapping step, and documents.js's own ods<->xlsx bridge (bypassing PDF, the same way its odt<->docx/odp<->pptx bridges do) can treat this reader's own output as an already-correctly-shaped pivot value.
//
// This is the flat, content-level half of the xlsx read pair: readXlsx (typed/document-package.ts) wraps it into a tree-form DocumentPackage, which is the primary name. Nothing is lost either way -- a spreadsheet's tree is one sheet group per sheet -- so which one to call is purely which shape the caller works in.
//
// SCOPE, stated up front rather than only at each individual site below: (1) xlsx's own cell-type vocabulary (t="n"/absent, "s", "str", "inlineStr", "b", "e") has no percentage/currency/date variant the way ODF's office:value-type does -- those are all just numeric cells with a number-format style applied, so recovering them means resolving the cell's own style index through xl/styles.xml to a numFmt code and classifying that code. This reader does exactly that (typed/xlsx/styles.ts resolves, typed/xlsx/number-format.ts classifies, typed/xlsx/serial.ts converts a date/time serial to ISO), so a numeric cell reads as ContentCellValue's 'percentage'/'currency'/'date'/'time'/'dateTime' kind whenever its format genuinely says so, and 'number' otherwise. What that classifier is NOT is a FORMATTER: nothing here renders a value through a format code, which is why (2) below still holds. Only genuinely numeric cells are ever reclassified -- an s/str/inlineStr/b/e/d cell already carries its own type in the file and is never second-guessed by a style. (2) displayText has no native xlsx equivalent to read verbatim the way ODF's text:p content or a cached string gives readOds for free -- see deriveDisplayText below for exactly how this reader constructs one instead. (3) ContentSheetCellSchema's own `runs` field (genuinely mixed inline formatting within one cell) is never populated -- xlsx rich-text runs (<is>/<si>'s own nested <r><rPr>...) use a distinct font-property vocabulary from docx/pptx's own run styling, and resolving it would duplicate a meaningful slice of that machinery for a rarely-used feature not in this reader's own required field list; only the concatenated plain text (via deriveDisplayText) is read. (4) The cell DECORATION fields (background/borders/alignment/verticalAlignment) ARE read now, resolved from the same cellXfs index the number format comes from: typed/xlsx/styles.ts's readCellStyles resolves each entry's fill bg colour, per-edge borders, and inline <alignment> straight off the <cellXfs><xf> the cell's own s attribute indexes, and readCell below copies whichever of them are present onto the ContentSheetCell -- mirroring how odf.js's readOds populates the same fields from a table:table-cell's style chain. Two genuine scope limits on that resolution live in styles.ts: a fill/border colour carried only as theme/indexed/tint/auto (not rgb) is left unread, and the dash-family border tokens (dashDot/dashDotDot/...) collapse to ContentStrokeStyle 'dashed' since the schema has no dash-dot member. (5) The cell COMMENT field IS read, from both mechanisms xlsx has ever used for comments -- legacy VML-anchored notes (xl/comments{N}.xml) and the Office-365 threaded-comments extension -- resolved through the worksheet part's own relationships into typed/xlsx/comments.ts, whose own header states the full shape decisions. Comments are read-only: buildXlsxPackageFromContent never writes a comment part, so a ContentDocument round-tripped through that pair keeps its cells and drops their annotations.

const WORKBOOK_PATH = 'xl/workbook.xml';

interface SheetEntry {
  name: string;
  path: string;
}

// Sheet order and part paths come from xl/workbook.xml's own <sheets> list, resolved through xl/_rels/workbook.xml.rels -- the same "never trust filename order" precedent readPptxContent already established for p:sldIdLst (worksheets, like slides, carry no ordering guarantee in their own part names). Exported for typed/xlsx/definitions.ts, which needs the same order to resolve a table part's owning sheet name.
export function resolveSheetEntries(pkg: Package): SheetEntry[] {
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
    const column: ContentSheetColumn = { index: min - 1 };
    const widthRaw = attr(col, 'width');
    if (widthRaw !== undefined) {
      const widthPt = columnWidthCharsToPt(Number(widthRaw));
      // widthPt is optional -- absent means "no declared width, use the application default" (document-schema.js's own ContentSheetColumn doc comment), not a fabricated 0; a <col> element with no width attribute at all (e.g. one that exists purely to declare `hidden`) must not report a zero-width column.
      if (Number.isFinite(widthPt)) {
        column.widthPt = widthPt;
      }
    }
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

// Derives displayText -- xlsx has no cached "producer-rendered string" field the way ODF's own text:p content (or, for a genuinely numeric cell, its office:value-type-adjacent convention) gives readOds for free; a numeric cell's <v> is always the bare, unformatted number, with the thousands separators, currency symbol, date pattern, and percent sign living purely in xl/styles.xml's own numFmt code. This reader CLASSIFIES that code (see the top-of-file scope note) but does not render through it, so displayText remains a plain string representation of the typed value, NOT the producer's own rendering: String(value) for a number/percentage/currency (0.4256, not "42.56%"; 99.99, not "£99.99"), 'TRUE'/'FALSE' for a boolean (matching Excel's own default, unformatted boolean display), the string/error text verbatim for the string/error kinds, and the ISO spelling for the three temporal kinds -- which, for a date/time cell, is a real improvement over the bare serial this reader used to show, even though it is still not what the sheet itself prints.
function deriveDisplayText(value: ContentCellValue): string {
  switch (value.kind) {
    case 'number':
    case 'percentage':
    case 'currency':
      return String(value.value);
    case 'boolean':
      return value.value ? 'TRUE' : 'FALSE';
    case 'string':
    case 'error':
    case 'date':
    case 'time':
    case 'dateTime':
      return value.value;
    case 'empty':
      return '';
  }
}

// Everything needed to turn a bare numeric <v> into its real value kind, AND to recover a cell's decoration (background/borders/alignment/verticalAlignment), resolved ONCE per package rather than per cell: one entry per cellXfs index (the array index is the value of a cell's own s attribute), and the workbook's own date epoch. A sheet of 50,000 numeric cells therefore classifies a handful of format codes, not 50,000, and looks up decoration by the same index it already reads for the number format.
interface CellFormatContext {
  entries: readonly CellStyleEntry[];
  date1904: boolean;
}

// CT_Cell/@s's own schema default: a cell with no s attribute at all uses cell format 0.
const DEFAULT_CELL_STYLE_INDEX = 0;

const PLAIN_NUMBER: NumberFormatClass = { kind: 'number' };

function readCellFormatContext(pkg: Package): CellFormatContext {
  return {
    entries: readCellStyles(pkg),
    date1904: readDate1904(pkg),
  };
}

function entryOf(cell: XmlElement, context: CellFormatContext): CellStyleEntry | undefined {
  const raw = attr(cell, 's');
  const index = raw === undefined ? DEFAULT_CELL_STYLE_INDEX : Number.parseInt(raw, 10);
  return Number.isInteger(index) ? context.entries[index] : undefined;
}

function numberFormatOf(cell: XmlElement, context: CellFormatContext): NumberFormatClass {
  const entry = entryOf(cell, context);
  if (entry?.numberFormatCode === undefined) {
    // An out-of-range or unresolvable style index, or one whose numFmtId resolves to no code anywhere, carries no formatting information -- a plain number, the same outcome as a cell genuinely formatted General, reached without pretending the index resolved.
    return PLAIN_NUMBER;
  }
  return classifyNumberFormat(entry.numberFormatCode);
}

// A percentage keeps its RAW stored fraction (0.4256, the number the file holds, displayed by Excel as 42.56%) -- ContentCellValue's own 'percentage' variant is documented as carrying the underlying value, not the scaled-up display number. A currency carries an ISO 4217 code only when the format genuinely named one ([$GBP-809]); a format identifying money by SYMBOL alone ([$£-809], or a quoted "$") leaves `currency` absent rather than guessing, which is the honest statement "this is money and we do not know which" -- '$' alone is USD, CAD, AUD and a dozen others. A date/time serial that names no real date (a negative serial, or the 1900 system's phantom 1900-02-29) degrades to the plain number it literally is rather than emitting an invalid ISO string.
function resolveNumericValue(num: number, cell: XmlElement, context: CellFormatContext): ContentCellValue {
  const format = numberFormatOf(cell, context);
  switch (format.kind) {
    case 'percentage':
      return { kind: 'percentage', value: num };
    case 'currency':
      return format.code === undefined ? { kind: 'currency', value: num } : { kind: 'currency', value: num, currency: format.code };
    case 'date': {
      const iso = serialToIsoDate(num, context.date1904);
      return iso === undefined ? { kind: 'number', value: num } : { kind: 'date', value: iso };
    }
    case 'time': {
      const iso = serialToIsoTime(num);
      return iso === undefined ? { kind: 'number', value: num } : { kind: 'time', value: iso };
    }
    case 'dateTime': {
      const iso = serialToIsoDateTime(num, context.date1904);
      return iso === undefined ? { kind: 'number', value: num } : { kind: 'dateTime', value: iso };
    }
    case 'elapsedTime':
      // An elapsed-time format ([h]:mm:ss) is a DURATION, which may legitimately exceed 24 hours -- ContentCellValue's own 'time' variant is explicitly a wall-clock time of day and has no duration sibling to carry this instead, so the raw day-fraction number is kept rather than folded into a wrong-kind time.
      return { kind: 'number', value: num };
    case 'text':
    case 'number':
      return { kind: 'number', value: num };
  }
}

// Maps a <c>'s own t attribute (ECMA-376 ST_CellType) plus its <v>/<is> content to ContentCellValue. t="n" and an absent t attribute are the identical case (ECMA-376's own schema default for CT_Cell/@t is "n"). A cell with no <v>, no <is>, and no <f> at all is genuinely empty (styling-only, or a covered/merged-away position LibreOffice itself still writes a bare styled <c> for -- see this package's own kitchen-sink fixture) and returns undefined, matching typed/xlsx.ts's own readXlsxWorkbook precedent of dropping such cells rather than fabricating content for them.
function readCellValue(cell: XmlElement, sharedStrings: readonly string[], numericFormats: CellFormatContext): ResolvedCellValue | undefined {
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
    // ST_CellType's rare ISO-8601 variant is xlsx's ONE combined date-and-time cell type (no separate date-only/time-only kind the way ODF's office:date-value/office:time-value distinguishes) -- reads as ContentCellValue's own 'dateTime' kind for exactly this reason, carried verbatim and unparsed.
    return { value: { kind: 'dateTime', value: raw }, displayText: raw };
  }
  const num = Number(raw);
  if (Number.isNaN(num)) {
    return undefined;
  }
  // The one branch a number format is allowed to reinterpret -- an absent t and t="n" are the identical "this cell holds a number" case, and the number format is the only thing in the file that says WHAT number.
  const value = resolveNumericValue(num, cell, numericFormats);
  return { value, displayText: deriveDisplayText(value) };
}

function readCell(cell: XmlElement, sharedStrings: readonly string[], context: CellFormatContext): ContentSheetCell | undefined {
  const reference = attr(cell, 'r');
  const position = reference === undefined ? undefined : parseCellReference(reference);
  if (position === undefined) {
    return undefined;
  }
  const formulaEl = childrenWithTag(cell, 'f')[0];
  const formula = formulaEl === undefined ? undefined : textContent(formulaEl);
  const resolved = readCellValue(cell, sharedStrings, context);
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
  // The cell's own decoration (background/borders/alignment/verticalAlignment) resolves through the SAME cellXfs index the number format above resolved through -- the entry's four optional fields mirror ContentSheetCellSchema's own four, and each is copied through only when present, so a cell whose xf declares none of them stays field-free rather than inheriting fabricated defaults. This is the xlsx-side counterpart to odf.js readOds's own table:style-name -> table-cell cascade resolution of the same four fields, resolved through xlsx's own <cellXfs> table instead of an ODF style chain.
  const entry = entryOf(cell, context);
  if (entry !== undefined) {
    if (entry.background !== undefined) {
      cellEntry.background = entry.background;
    }
    if (entry.borders !== undefined) {
      cellEntry.borders = entry.borders;
    }
    if (entry.alignment !== undefined) {
      cellEntry.alignment = entry.alignment;
    }
    if (entry.verticalAlignment !== undefined) {
      cellEntry.verticalAlignment = entry.verticalAlignment;
    }
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

function readCells(worksheet: XmlElement, sharedStrings: readonly string[], context: CellFormatContext): ContentSheetCell[] {
  const sheetData = childrenWithTag(worksheet, 'sheetData')[0];
  if (sheetData === undefined) {
    return [];
  }
  const cells: ContentSheetCell[] = [];
  for (const row of childrenWithTag(sheetData, 'row')) {
    for (const cell of childrenWithTag(row, 'c')) {
      const read = readCell(cell, sharedStrings, context);
      if (read !== undefined) {
        cells.push(read);
      }
    }
  }
  applyMergedRanges(worksheet, cells);
  return cells;
}

// Cell comments live in their own parts, reached through the sheet's own relationships (see comments.ts), so they attach after the cells themselves are read. A comment anchored to a position no <c> ever occupied (a note on a genuinely empty cell is ordinary) still carries real content worth keeping -- the same policy that keeps an <f>-only formula cell, materialised the same way: an empty value with the annotation attached.
function applyCellComments(comments: ReadonlyMap<string, SheetCellComment>, cells: ContentSheetCell[]): void {
  if (comments.size === 0) {
    return;
  }
  const byPosition = new Map<string, ContentSheetCell>();
  for (const cell of cells) {
    byPosition.set(`${cell.row}:${cell.column}`, cell);
  }
  for (const [key, { row, column, comment }] of comments) {
    const existing = byPosition.get(key);
    if (existing !== undefined) {
      existing.comment = comment;
      continue;
    }
    const materialised: ContentSheetCell = { row, column, value: { kind: 'empty' }, displayText: '', comment };
    cells.push(materialised);
    byPosition.set(key, materialised);
  }
}

// The two worksheet rule families with no harmonised vocabulary yet -- dataValidation (a range's input constraint) and conditionalFormatting (a range's conditional display rule). The construct inventory's own corpus gate defers freezing a semantic shape for them until a real producer file is verified against one, so until then each governing element is quarantined VERBATIM on its range's anchor cell through the residue channel: carried, restorable by a same-format writer, never interpreted here. The anchor is the first range's top-left position -- the same anchoring convention merges and cell comments use -- and a cell carries one residue slot, so a second rule anchoring at the same cell is skipped (the sqref inside each residue names its full range, so one copy reconstructs it). A rule whose sqref parses to nothing is left unattached rather than parked on a made-up position.
function applyCellResidueRules(worksheet: XmlElement, cells: ContentSheetCell[]): void {
  const rules: XmlElement[] = [];
  for (const container of childrenWithTag(worksheet, 'dataValidations')) {
    rules.push(...childrenWithTag(container, 'dataValidation'));
  }
  rules.push(...childrenWithTag(worksheet, 'conditionalFormatting'));
  if (rules.length === 0) {
    return;
  }
  const byPosition = new Map<string, ContentSheetCell>();
  for (const cell of cells) {
    byPosition.set(`${cell.row}:${cell.column}`, cell);
  }
  for (const rule of rules) {
    const sqref = attr(rule, 'sqref');
    const firstToken = sqref === undefined ? undefined : sqref.split(/\s+/)[0];
    const range = firstToken === undefined || firstToken === '' ? undefined : parseRangeReference(firstToken);
    if (range === undefined) {
      continue;
    }
    const key = `${range.startRow}:${range.startColumn}`;
    const existing = byPosition.get(key);
    if (existing === undefined) {
      const materialised: ContentSheetCell = { row: range.startRow, column: range.startColumn, value: { kind: 'empty' }, displayText: '', source: { format: 'xlsx', xml: buildXml([rule]) } };
      cells.push(materialised);
      byPosition.set(key, materialised);
      continue;
    }
    existing.source ??= { format: 'xlsx', xml: buildXml([rule]) };
  }
}

function readSheet(
  pkg: Package,
  entry: SheetEntry,
  sheetIndex: number,
  sharedStrings: readonly string[],
  definedNamesBySheet: ReadonlyMap<number, SheetDefinedNames>,
  context: CellFormatContext,
): ContentSheet {
  const worksheet = rootElement(pkg.parts[entry.path]);
  if (worksheet === undefined) {
    return { name: entry.name, cells: [], columns: [], rows: [], images: [], printSettings: readPrintSettings(fallbackEmptyWorksheet(), sheetIndex, definedNamesBySheet) };
  }
  const cells = readCells(worksheet, sharedStrings, context);
  applyCellComments(readSheetCellComments(pkg, entry.path), cells);
  applyCellResidueRules(worksheet, cells);
  // The drawing layer's pictures and chart graphic frames (typed/xlsx/drawings.ts) -- absent when the sheet references no drawing, which is the common case; a drawing-less sheet has no images and keeps its embeddedObjects field absent.
  const drawing = readSheetDrawing(pkg, entry.path, worksheet);
  return {
    name: entry.name,
    cells,
    columns: readColumns(worksheet),
    rows: readRows(worksheet),
    images: drawing?.images ?? [],
    ...(drawing !== undefined && drawing.embeddedObjects.length > 0 ? { embeddedObjects: drawing.embeddedObjects } : {}),
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
  const context = readCellFormatContext(pkg);
  const entries = resolveSheetEntries(pkg);
  const sheets = entries.map((entry, sheetIndex) => readSheet(pkg, entry, sheetIndex, sharedStrings, definedNamesBySheet, context));
  return {
    kind: 'spreadsheet',
    metadata: readCoreProperties(pkg),
    sheets,
  };
}
