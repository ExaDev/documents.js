import type {
  ContentCellValue,
  DefinitionEntry,
  DefinitionsTable,
  ContentEmbeddedObject,
  ContentRun,
  ContentSheet,
  ContentSheetCell,
  ContentSheetColumn,
  ContentSheetImage,
  ContentSheetPrintRange,
  ContentSheetPrintSettings,
  ContentSheetRepeatRange,
  ContentSheetRow,
  DocumentPackage,
  LayoutMetadata,
  Margins,
} from 'document-schema.js';
import { assemblePackage, PAGE_SIZE_A4 } from 'document-schema.js';
import type { XmlElement, XmlNode } from '../../model/node';
import type { Package } from '../../model/package';
import { attrValue, childrenWithTag, findChildElement, rootElement } from '../../xml/query';
import { TableCursor, parseCellReference } from '../shared/a1';
import { findStyleElement, resolveStyleElementChain } from '../shared/cascade';
import { readOdfMetadata } from '../shared/metadata';
import { resolvePageLayoutProperties } from '../shared/masterpage';
import { parseMargins, parsePageSize } from '../shared/geometry';
import { parseOdfLength } from '../shared/units';
import { readOdfParagraph } from '../shared/paragraph';
import { readCellStyleDecoration } from '../shared/table';
import type { OdfTransformFunction } from '../shared/transform';
import { parseOdfTransform } from '../shared/transform';
import { readDrawFrame } from '../draw/shapes';
import { readDrawObjectReference, readEmbeddedObjectDocument } from '../draw/embedded';
import { collectOdfNamedExpressions } from '../shared/constructs';

// Package -> OdsDocument: a spreadsheet reader deliberately built GEOMETRY- and PRINT-SETTINGS-rich rather than a minimal cell-values-only reader (a real requirement from this reader's own design brief, not optional polish) -- real column widths/row heights, hidden rows/columns, merged ranges, every office:value-type variant with its own OpenFormula string carried verbatim, and a genuinely populated ContentSheetPrintSettings (page geometry, print range, scale/fit-to-page, repeat rows/columns, gridlines/headers, page order, manual breaks). Every ODF attribute name and structural shape below was confirmed against real LibreOffice 26.2 output (a headless UNO Basic macro building a real .ods with every one of these features actually configured through the same UNO calls the Calc UI itself uses -- Format > Columns > Width, Format > Rows > Height, Format > Print Areas, Format > Page Style's Sheet tab, a real merged range, a real cross-sheet SUM formula, every value-type including a GBP currency cell and a genuine #DIV/0! formula error -- then the resulting content.xml/styles.xml inspected directly), not assumed from memory or from xlsx's own different mechanisms. See this module's own inline notes at each surprising point (table:table-header-rows/columns as the REAL repeat-row/column mechanism, NOT a named range; style:master-page-name living on the table:table's own style:style[family="table"], NOT on table:table itself; the UNO API's own PageScale-vs-ScaleToPagesX/Y mutual-exclusivity quirk that shaped nothing in the READER but is worth knowing when re-deriving a fixture) for the exact evidence.
//
// THE TWO REPEAT-COUNT HAZARDS this reader is built around (see typed/shared/a1.ts's own top-of-file note for why they matter): table:number-columns-repeated/table:number-rows-repeated routinely reach into the hundreds of thousands on a real spreadsheet's trailing empty area, so this reader NEVER materializes one array entry per repeated position -- for cells, a purely-empty repeated run contributes nothing at all to `cells`; for table:table-column/table:table-row elements, `columns`/`rows` get exactly ONE ContentSheetColumn/ContentSheetRow per XML element (at that element's OWN starting index), never one per repeated index, mirroring exactly how a real ODS file itself already compresses a run of identically-formatted columns/rows (confirmed even in a perfectly ordinary two-column sheet: LibreOffice wrote ONE table:table-column with table:number-columns-repeated="2" for two identically-styled columns, not a repeat hazard specific to huge trailing empty runs at all). Column/row/cell indices are ALWAYS computed from a running cursor position (typed/shared/a1.ts's TableCursor for cells; a plain incrementing counter for the separate table:table-column walk) -- never read from an XML attribute, because ODF cells/columns/rows carry no address attribute of their own at all (unlike xlsx's own r="B7").
//
// ANCHORED DRAWINGS (ContentSheet.images / ContentSheet.embeddedObjects) are read here, through the SAME typed/draw/shapes.ts primitives odt/odp/odg already use -- readDrawFrame for the frame itself (geometry, group-transform composition, style-resolved insets, and draw:image -> ContentImageBlock resolution), typed/draw/embedded.ts's readDrawObjectReference for a draw:object's own embedded sub-document. Nothing about frame reading is reimplemented here; what IS spreadsheet-specific is where a frame LIVES and what its coordinates mean, and ODF has exactly two conventions for that, BOTH confirmed against real, unmodified LibreOffice 26.2 output (src/typed/ods/fixtures/sheet-anchors.ods, built via a Java UNO client driving the same calls the Calc UI itself uses -- Insert > Image with Anchor > To Cell, Insert > OLE Object, Anchor > To Page -- then unzipped and read directly):
//
// 1. ANCHORED TO A CELL: the draw:frame is a DIRECT CHILD OF THE table:table-cell it is anchored to, and its svg:x/svg:y are offsets from THAT CELL'S own top-left corner (verified numerically: a shape positioned 0.5cm/0.3cm beyond its anchor cell's origin serialises as svg:x="0.5cm" svg:y="0.3cm", regardless of where that cell sits on the sheet). The anchor cell reference is therefore not read from any attribute at all -- ODF cells carry no address attribute (see the repeat-count note below) -- it IS the running TableCursor position this reader already computes for every cell, exactly the same way ContentSheetCell.row/column are resolved.
// 2. ANCHORED TO THE PAGE: the draw:frame sits inside a table:shapes element, a child of table:table itself appearing BEFORE its column definitions, and its svg:x/svg:y are absolute from the sheet's own origin. ContentSheetImage has no "page-anchored" variant, so such an image is reported at anchorRow/anchorColumn 0 with its absolute offsets carried through unchanged -- not an approximation: cell (0,0)'s own top-left IS the sheet origin, so the two coordinate systems coincide exactly there.
//
// A draw:g group is walked through (its own draw:transform composed onto each child via readDrawFrame's existing groupFunctions parameter, exactly as walkDrawShapes does for a slide), so a grouped anchored image is still found. What a sheet CANNOT carry is anything ContentSheetSchema has nowhere to put: a floating text box or a table frame (ContentSheet has no `shapes` array at all, unlike ContentSlide/ContentDrawPage) and a bare vector primitive (no `vectors` array either -- the same scope boundary walkDrawShapes already documents for presentations). Each is skipped rather than mapped onto an approximation of a different kind. An embedded FORMULA object -- a real LibreOffice Math OLE object anchored to a cell -- is not in that skipped list: document-schema.js 2.2.0's ContentDocument union carries a genuine 'formula' variant, so readDrawObjectReference resolves one and the shared dispatch (typed/draw/embedded.ts's readEmbeddedObjectDocument) hands it to readOdfFormulaContent like any other embedded kind. An embedded CHART object is not either: ContentEmbeddedObjectKind's 'chart' member names it, and the same dispatch hands it to readOdfChartContent (typed/draw/embedded.ts's own SCOPE note states the document it carries).
//
// SCOPE: table:print-ranges is a space-separated list of cell-range-address strings per the OASIS spec, but ContentSheetPrintSettingsSchema's own `printRange` models only ONE range -- a document defining more than one non-contiguous print range has every range after the first silently ignored (a documented, narrow scope boundary, not a silent one).

const CONTENT_PART = 'content.xml';

function parseKnownOdfLength(value: string): number {
  const parsed = parseOdfLength(value);
  if (parsed === undefined) {
    throw new Error(`readOdsContent: internal error -- "${value}" is not a valid ODF length literal`);
  }
  return parsed;
}

// LibreOffice Calc's own real out-of-the-box default page geometry for an untouched page style (confirmed directly via the UNO API's own PageStyle.Width/Height/*Margin properties on a freshly created, unmodified Calc document -- 21.001cm x 29.7cm, 2cm margins on every side -- even though a truly untouched style:page-layout-properties element omits fo:page-width/height/margin-* from the SAVED XML entirely, per real LibreOffice output). Numerically identical to readOdtContent's own default page size/margins choice (PAGE_SIZE_A4 + 2cm), which is not a coincidence: Calc and Writer share the same locale-driven default page geometry, and both readers' own fallback should reflect the real, confirmed default rather than an assumed one.
const DEFAULT_MARGIN_PT = parseKnownOdfLength('2cm');
const DEFAULT_MARGINS: Margins = { topPt: DEFAULT_MARGIN_PT, rightPt: DEFAULT_MARGIN_PT, bottomPt: DEFAULT_MARGIN_PT, leftPt: DEFAULT_MARGIN_PT };

export interface OdsDocument {
  metadata: LayoutMetadata;
  sheets: ContentSheet[];
  // The package-level definitions table this workbook's content references: named-range and named-expression declarations. Present only when the workbook declares at least one -- the flat ContentDocument has no root to hold a definitions table, so this field is how the table reaches readOds's assembled package root.
  definitions?: DefinitionsTable;
}

function readRepeatCount(element: XmlElement, attrName: string): number {
  const raw = attrValue(element, attrName);
  if (raw === undefined) {
    return 1;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function isHidden(element: XmlElement): boolean {
  return attrValue(element, 'table:visibility') === 'collapse';
}

// Default dimensions for an unstyled column/row -- the real LibreOffice defaults, matching documents.js's own DEFAULT_COLUMN_WIDTH_PT/DEFAULT_ROW_HEIGHT_PT (src/layout/sheets.ts, src/edit/ods/column-row.ts). An unstyled column/row previously read as 0pt, which violated ContentSheet{Column,Row}Schema's own .positive() widthPt/heightPt constraint and produced a ContentDocument that failed its own schema; defaulting to the real positive dimensions closes that at the reader (the source), mirroring the editor's own setColumnWidth/setRowHeight default-stamping convention.
const DEFAULT_COLUMN_WIDTH_PT = 64;
const DEFAULT_ROW_HEIGHT_PT = 15;

// A column's own width/manual-break, resolved through its table:style-name -> style:style[family="table-column"] -> style:table-column-properties -- the SAME single-level (no parent-chain) lookup table.ts's own resolveColumnWidthPt uses for odt/odp tables, reused here as "the same pattern" (typed/shared/table.ts's own helpers are private and width-only; this reader also needs fo:break-before from the identical style element, so it resolves the style ONCE and reads both from it rather than looking the style up twice). Column width missing/unresolvable defaults to DEFAULT_COLUMN_WIDTH_PT rather than 0pt, so the resulting ContentSheetColumn never violates its schema's .positive() widthPt constraint.
function readColumnLayout(columnElement: XmlElement, pkg: Package): { widthPt: number; manualBreak: boolean } {
  const styleName = attrValue(columnElement, 'table:style-name');
  const styleElement = styleName === undefined ? undefined : findStyleElement(styleName, 'table-column', pkg);
  const properties = styleElement === undefined ? undefined : childrenWithTag(styleElement, 'style:table-column-properties')[0];
  const widthValue = properties === undefined ? undefined : attrValue(properties, 'style:column-width');
  const widthPt = widthValue === undefined ? DEFAULT_COLUMN_WIDTH_PT : (parseOdfLength(widthValue) ?? DEFAULT_COLUMN_WIDTH_PT);
  const manualBreak = (properties === undefined ? undefined : attrValue(properties, 'fo:break-before')) === 'page';
  return { widthPt, manualBreak };
}

// A row's own height/manual-break, the row-properties mirror of readColumnLayout above. Unlike table.ts's own row-height treatment (optional, since ContentTableRow.heightPt is optional), ContentSheetRowSchema.heightPt is REQUIRED and .positive(), so an unresolvable height defaults to DEFAULT_ROW_HEIGHT_PT (not 0pt, which would violate the schema) -- the same positive-default convention readColumnLayout now applies to width.
function readRowLayout(rowElement: XmlElement, pkg: Package): { heightPt: number; manualBreak: boolean } {
  const styleName = attrValue(rowElement, 'table:style-name');
  const styleElement = styleName === undefined ? undefined : findStyleElement(styleName, 'table-row', pkg);
  const properties = styleElement === undefined ? undefined : childrenWithTag(styleElement, 'style:table-row-properties')[0];
  const heightValue = properties === undefined ? undefined : attrValue(properties, 'style:row-height');
  const heightPt = heightValue === undefined ? DEFAULT_ROW_HEIGHT_PT : (parseOdfLength(heightValue) ?? DEFAULT_ROW_HEIGHT_PT);
  const manualBreak = (properties === undefined ? undefined : attrValue(properties, 'fo:break-before')) === 'page';
  return { heightPt, manualBreak };
}

// A cell's own rendered text, read via paragraph.ts's existing run-reading logic (readOdfParagraph) rather than a bare text-node walk, so bold/italic/colour/etc. on the cell's own text:span runs survive into ContentSheetCell.runs -- and displayText is derived from those SAME runs, never computed separately, so the two can never disagree. Multiple text:p children (a manually line-broken cell, Alt+Enter in Calc) are joined with a synthetic newline run between them, mirroring how readOdpContent's own readSlideNotes joins multiple text:p lines with '\n'.
function readCellText(cellElement: XmlElement, pkg: Package): { runs: ContentRun[]; displayText: string } {
  const paragraphs = childrenWithTag(cellElement, 'text:p');
  const runs: ContentRun[] = [];
  paragraphs.forEach((paragraph, index) => {
    if (index > 0) {
      runs.push({ text: '\n' });
    }
    runs.push(...readOdfParagraph(paragraph, pkg).runs);
  });
  const displayText = runs.map((run) => run.text).join('');
  return { runs, displayText };
}

// Maps a table:table-cell's own office:value-type (and its corresponding office:value/office:boolean-value/office:date-value/office:time-value/office:currency attribute) to document-schema.js's ContentCellValue. Confirmed against real LibreOffice 26.2 output: the wire value-type string for a plain number is "float", NOT "number" -- ContentCellValueSchema's own kind enum uses "number" (a cross-format canonical name), so this function TRANSLATES "float" -> kind:'number' rather than copying the wire string through; every other kind name matches its own wire value-type string directly. A "string" cell carries office:string-value only when its value differs from its own rendered text (confirmed: an ordinary text cell's office:value-type="string" has NO office:string-value attribute at all, only its text:p content) -- per the OASIS spec, the cell's own text content IS the value when office:string-value is absent, so this falls back to displayText, exactly mirroring how office:date-value/office:time-value being absent (a malformed producer) falls back to the same displayText rather than a fabricated empty string. A numeric/percentage/currency value-type whose own required office:value is missing or unparseable degrades to kind:'string' (value: displayText) rather than fabricating a 0 -- an honest "we don't have a genuine number" rather than a silently wrong one. ODF itself has no "error" value-type in its own enumeration at all (confirmed: a genuine #DIV/0! formula cell serializes as office:value-type="string" office:string-value="" -- LibreOffice's own calcext:value-type="error" extension is the only place "error" appears, and this reader deliberately does not chase private vendor extensions, matching table.ts's own established fo:background-color-over-loext: precedent) -- ContentCellValueSchema's own 'error' kind therefore never gets produced by this reader; the formula's own cached #DIV/0! text still survives, verbatim, as displayText.
function readCellValue(cellElement: XmlElement, displayText: string): ContentCellValue {
  const valueType = attrValue(cellElement, 'office:value-type');
  const stringFallback: ContentCellValue = { kind: 'string', value: displayText };

  switch (valueType) {
    case 'float': {
      const value = parseRequiredNumber(attrValue(cellElement, 'office:value'));
      return value === undefined ? stringFallback : { kind: 'number', value };
    }
    case 'percentage': {
      const value = parseRequiredNumber(attrValue(cellElement, 'office:value'));
      return value === undefined ? stringFallback : { kind: 'percentage', value };
    }
    case 'currency': {
      const value = parseRequiredNumber(attrValue(cellElement, 'office:value'));
      if (value === undefined) {
        return stringFallback;
      }
      const currency = attrValue(cellElement, 'office:currency');
      return currency === undefined ? { kind: 'currency', value } : { kind: 'currency', value, currency };
    }
    case 'boolean': {
      const raw = attrValue(cellElement, 'office:boolean-value');
      return raw === undefined ? stringFallback : { kind: 'boolean', value: raw === 'true' };
    }
    case 'date':
      return { kind: 'date', value: attrValue(cellElement, 'office:date-value') ?? displayText };
    case 'time':
      return { kind: 'time', value: attrValue(cellElement, 'office:time-value') ?? displayText };
    case 'string':
      return { kind: 'string', value: attrValue(cellElement, 'office:string-value') ?? displayText };
    default:
      return { kind: 'empty' };
  }
}

function parseRequiredNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isNaN(value) ? undefined : value;
}

// table:print-ranges is a space-separated list of ODF cell-range-address strings, each shaped "SheetName.StartCell:SheetName.EndCell" -- confirmed against real LibreOffice output (table:print-ranges="Data.A1:Data.I20"): BOTH the start and end cell carry their own sheet-name prefix, unlike a same-sheet table:formula reference's own "[.A1:.A3]" shorthand. Only the FIRST range is parsed -- see this module's own top-of-file scope note on why.
function parsePrintRanges(value: string): ContentSheetPrintRange | undefined {
  const first = value.split(' ').find((part) => part.length > 0);
  if (first === undefined) {
    return undefined;
  }
  const separatorIndex = first.indexOf(':');
  if (separatorIndex === -1) {
    return undefined;
  }
  const start = parseA1WithOptionalSheetPrefix(first.slice(0, separatorIndex));
  const end = parseA1WithOptionalSheetPrefix(first.slice(separatorIndex + 1));
  if (start === undefined || end === undefined) {
    return undefined;
  }
  return { startRow: start.row, startColumn: start.column, endRow: end.row, endColumn: end.column };
}

function parseA1WithOptionalSheetPrefix(cellPart: string): { column: number; row: number } | undefined {
  const dotIndex = cellPart.lastIndexOf('.');
  const bareReference = dotIndex === -1 ? cellPart : cellPart.slice(dotIndex + 1);
  return parseCellReference(bareReference);
}

// style:scale-to is a percentage-suffixed ODF length-like value ("150%") -- confirmed against real LibreOffice output. Returns the bare numeric part, or undefined if the string doesn't match.
function parseScalePercentage(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)%$/.exec(value);
  if (match === null) {
    return undefined;
  }
  const numeric = match[1];
  return numeric === undefined ? undefined : Number(numeric);
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

interface TableWalkResult {
  columns: ContentSheetColumn[];
  rows: ContentSheetRow[];
  cells: ContentSheetCell[];
  images: ContentSheetImage[];
  embeddedObjects: ContentEmbeddedObject[];
  repeatColumns: ContentSheetRepeatRange | undefined;
  repeatRows: ContentSheetRepeatRange | undefined;
  manualBreakRows: number[];
  manualBreakColumns: number[];
}

// One anchored draw:frame -> whichever of `images`/`embeddedObjects` it belongs in, at the anchor position the caller resolved for it (the enclosing cell's own cursor row/column, or 0/0 for a page-anchored frame -- see this module's own top-of-file note on the two anchoring conventions). The frame itself is read by shapes.ts's readDrawFrame, so its resolved box already carries the group-composed offsets and the frame-sized ContentImageBlock this function only has to re-shape into a ContentSheetImage. An embedded sub-document dispatches through typed/draw/embedded.ts's own readEmbeddedObjectDocument -- the one shared kind -> reader table every frame-reading format hands its references to, so this module imports no sibling format reader (see that module's top-of-file note for why the dispatch is inverted into it).
//
// draw:object is checked BEFORE the frame's own image blocks, because a real embedded-object frame ALSO carries a draw:image preview of the object (an ObjectReplacements/ GDI metafile) that must not be mistaken for anchored picture content -- the same ordering, for the same reason, that readDrawFrameContent already applies to a table frame's own preview image.
function collectAnchoredFrame(
  frameElement: XmlElement,
  groupFunctions: readonly OdfTransformFunction[],
  pkg: Package,
  anchorRow: number,
  anchorColumn: number,
  images: ContentSheetImage[],
  embeddedObjects: ContentEmbeddedObject[],
): void {
  const shape = readDrawFrame(frameElement, groupFunctions, pkg);
  if (shape === undefined) {
    return;
  }

  const reference = readDrawObjectReference(frameElement, pkg);
  if (reference !== undefined) {
    // Anchor fields are set exactly as they are for an anchored image just below -- document-schema.js 2.2.0 gave ContentEmbeddedObject the same anchorRow/anchorColumn/offsetXPt/offsetYPt quartet ContentSheetImage already carried, so an embedded object's own anchor cell is now genuinely representable rather than lost. `frame` keeps the coordinates the format itself stated (cell-relative for a cell-anchored object, sheet-absolute for a page-anchored one) and the offsets restate that frame's own origin against the named anchor cell, mirroring ContentSheetImage's own convention rather than inventing a second one. A chart's residue (its whole chart:chart element, quarantined for a same-format restorer) rides the same return the document does.
    const { document, residue } = readEmbeddedObjectDocument(reference, shape.frame, 'ods');
    const object: ContentEmbeddedObject = {
      objectKind: reference.objectKind,
      document,
      frame: shape.frame,
      anchorRow,
      anchorColumn,
      offsetXPt: shape.frame.xPt,
      offsetYPt: shape.frame.yPt,
    };
    if (residue !== undefined) {
      object.source = residue;
    }
    embeddedObjects.push(object);
    return;
  }

  for (const block of shape.blocks) {
    if (block.kind === 'image') {
      images.push({ ...block, anchorRow, anchorColumn, offsetXPt: shape.frame.xPt, offsetYPt: shape.frame.yPt });
    }
  }
}

// Walks a shape container's own children (a table:table-cell's, a table:shapes', or a nested draw:g's), flattening draw:g groups exactly as walkDrawShapes does for a slide -- an enclosing group's own draw:transform is accumulated INNERMOST FIRST so composeOdfGroupTransform applies the list in the right order at the leaf. Every other element kind (a bare draw:rect/draw:custom-shape vector primitive, a draw:control, the cell's own text:p content) is skipped: see this module's own top-of-file note on what a ContentSheet has nowhere to carry.
function collectAnchoredFrames(
  children: readonly XmlNode[],
  groupFunctions: readonly OdfTransformFunction[],
  pkg: Package,
  anchorRow: number,
  anchorColumn: number,
  images: ContentSheetImage[],
  embeddedObjects: ContentEmbeddedObject[],
): void {
  for (const child of children) {
    if (child.type !== 'element') {
      continue;
    }
    if (child.tag === 'draw:frame') {
      collectAnchoredFrame(child, groupFunctions, pkg, anchorRow, anchorColumn, images, embeddedObjects);
    } else if (child.tag === 'draw:g') {
      const ownValue = attrValue(child, 'draw:transform');
      const ownFunctions = ownValue === undefined ? [] : parseOdfTransform(ownValue);
      const nested = ownFunctions.length === 0 ? groupFunctions : [...ownFunctions, ...groupFunctions];
      collectAnchoredFrames(child.children, nested, pkg, anchorRow, anchorColumn, images, embeddedObjects);
    }
  }
}

// Walks one table:table's own direct children in document order, unwrapping table:table-header-columns/table:table-header-rows transparently into the SAME columns/rows/cells this function already builds -- confirmed against real LibreOffice output as the REAL repeat-row/repeat-column mechanism ("rows/columns to repeat on every printed page", Format > Print Areas > Edit in the Calc UI): a wrapped table:table-column/table:table-row is a genuinely real column/row (contributing to `columns`/`rows`/`cells` exactly as if unwrapped, in the SAME document-order position), while the wrapper itself additionally marks that its covered index range is the print engine's own title-row/title-column range. This is NOT a named-range mechanism the way it might be guessed to be from xlsx's own different Print_Titles convention -- ODF has no named range involved here at all.
function readTable(tableElement: XmlElement, pkg: Package): TableWalkResult {
  const columns: ContentSheetColumn[] = [];
  const rows: ContentSheetRow[] = [];
  const cells: ContentSheetCell[] = [];
  const images: ContentSheetImage[] = [];
  const embeddedObjects: ContentEmbeddedObject[] = [];
  const manualBreakRows: number[] = [];
  const manualBreakColumns: number[] = [];
  let repeatColumns: ContentSheetRepeatRange | undefined;
  let repeatRows: ContentSheetRepeatRange | undefined;

  let columnCursor = 0;
  const cursor = new TableCursor();

  function processColumn(columnElement: XmlElement): void {
    const { widthPt, manualBreak } = readColumnLayout(columnElement, pkg);
    columns.push({ index: columnCursor, widthPt, hidden: isHidden(columnElement) ? true : undefined });
    if (manualBreak) {
      manualBreakColumns.push(columnCursor);
    }
    columnCursor += readRepeatCount(columnElement, 'table:number-columns-repeated');
  }

  function processRowCells(rowElement: XmlElement): void {
    for (const child of rowElement.children) {
      if (child.type !== 'element') {
        continue;
      }
      if (child.tag === 'table:covered-table-cell') {
        // A merged-away continuation cell -- the anchor cell's own colSpan/rowSpan already communicates the merge; nothing to emit, matching table.ts's own established treatment of the identical table:covered-table-cell convention.
        cursor.nextCell(readRepeatCount(child, 'table:number-columns-repeated'));
      } else if (child.tag === 'table:table-cell') {
        const columnIndex = cursor.columnIndex;
        const rowIndex = cursor.rowIndex;
        cursor.nextCell(readRepeatCount(child, 'table:number-columns-repeated'));

        // Anchored drawings are collected BEFORE the empty-cell skip below: a cell whose only content is an anchored image or embedded object carries no value, formula or text at all, so it is (correctly) never materialized as a ContentSheetCell -- but its frame is real content that would be lost by skipping the cell entirely. See this module's own top-of-file note on why the anchor position is this cursor's own row/column rather than any attribute.
        collectAnchoredFrames(child.children, [], pkg, rowIndex, columnIndex, images, embeddedObjects);

        const formula = attrValue(child, 'table:formula');
        const { runs, displayText } = readCellText(child, pkg);
        const hasValueType = attrValue(child, 'office:value-type') !== undefined;
        if (!hasValueType && formula === undefined && displayText.length === 0) {
          // A genuinely empty cell (the common case for a huge trailing repeat block) -- skip entirely, never materialized.
          continue;
        }

        const value = readCellValue(child, displayText);
        const colSpan = parseNonNegativeInteger(attrValue(child, 'table:number-columns-spanned'));
        const rowSpan = parseNonNegativeInteger(attrValue(child, 'table:number-rows-spanned'));
        const cell: ContentSheetCell = { row: rowIndex, column: columnIndex, value, displayText };
        if (formula !== undefined) {
          cell.formula = formula;
        }
        if (runs.length > 0) {
          cell.runs = runs;
        }
        if (colSpan !== undefined) {
          cell.colSpan = colSpan;
        }
        if (rowSpan !== undefined) {
          cell.rowSpan = rowSpan;
        }

        // background/borders/alignment/verticalAlignment resolve through the SAME table:style-name -> table-cell family cascade readColumnLayout/readRowLayout resolve their own dimensional properties through -- but via resolveStyleElementChain's full root-to-target chain (family default-style, then each style:parent-style-name ancestor, then the cell's own referenced style last), not findStyleElement's single-level lookup: real-world spreadsheet cell styles routinely DO chain via style:parent-style-name (confirmed against this package's own kitchen-sink.ods fixture -- every table-cell style there sets style:parent-style-name="Default", and styles.xml's own style:default-style style:family="table-cell" carries a real style:paragraph-properties child), unlike the "standalone in practice" convention typed/shared/table.ts documents for odt/odp table-cell styles. readCellStyleDecoration (typed/shared/table.ts) does the actual fold; see that module's own top-of-file note for the loext:/vertical-align/fo:text-align caveats -- the loext: cell-fill quirk documented there is specific to presentation tables, not spreadsheets, and was NOT observed in this reader's own real fixture.
        const cellStyleName = attrValue(child, 'table:style-name');
        const { elements: cellStyleChain } = resolveStyleElementChain(cellStyleName, 'table-cell', pkg);
        const decoration = readCellStyleDecoration(cellStyleChain);
        if (decoration.background !== undefined) {
          cell.background = decoration.background;
        }
        if (decoration.borders !== undefined) {
          cell.borders = decoration.borders;
        }
        if (decoration.alignment !== undefined) {
          cell.alignment = decoration.alignment;
        }
        if (decoration.verticalAlignment !== undefined) {
          cell.verticalAlignment = decoration.verticalAlignment;
        }

        cells.push(cell);
      }
    }
  }

  function processRow(rowElement: XmlElement): void {
    const startIndex = cursor.rowIndex;
    processRowCells(rowElement);
    const { heightPt, manualBreak } = readRowLayout(rowElement, pkg);
    rows.push({ index: startIndex, heightPt, hidden: isHidden(rowElement) ? true : undefined });
    if (manualBreak) {
      manualBreakRows.push(startIndex);
    }
    cursor.nextRow(readRepeatCount(rowElement, 'table:number-rows-repeated'));
  }

  for (const child of tableElement.children) {
    if (child.type !== 'element') {
      continue;
    }
    if (child.tag === 'table:shapes') {
      // Page-anchored drawings: absolute sheet coordinates, reported against cell (0, 0) whose own top-left IS the sheet origin -- see this module's own top-of-file note (convention 2).
      collectAnchoredFrames(child.children, [], pkg, 0, 0, images, embeddedObjects);
    } else if (child.tag === 'table:table-column') {
      processColumn(child);
    } else if (child.tag === 'table:table-header-columns') {
      const startIndex = columnCursor;
      for (const headerChild of child.children) {
        if (headerChild.type === 'element' && headerChild.tag === 'table:table-column') {
          processColumn(headerChild);
        }
      }
      if (columnCursor > startIndex) {
        repeatColumns = { start: startIndex, end: columnCursor - 1 };
      }
    } else if (child.tag === 'table:table-row') {
      processRow(child);
    } else if (child.tag === 'table:table-header-rows') {
      const startIndex = cursor.rowIndex;
      for (const headerChild of child.children) {
        if (headerChild.type === 'element' && headerChild.tag === 'table:table-row') {
          processRow(headerChild);
        }
      }
      if (cursor.rowIndex > startIndex) {
        repeatRows = { start: startIndex, end: cursor.rowIndex - 1 };
      }
    }
  }

  return { columns, rows, cells, images, embeddedObjects, repeatColumns, repeatRows, manualBreakRows, manualBreakColumns };
}

// A sheet's own print settings resolve through table:table -> table:style-name -> style:style[family="table"] -> style:master-page-name -> style:master-page -> style:page-layout-name -> style:page-layout -> style:page-layout-properties -- confirmed against real LibreOffice output that style:master-page-name lives on the TABLE'S OWN style (family="table"), not as a direct attribute of table:table itself the way draw:master-page-name sits directly on a draw:page. The remaining master-page-name -> page-layout-properties chain is shared verbatim with odp/odg via masterpage.ts's own resolvePageLayoutProperties. Gridlines/headers/page-order/scale all live on that SAME style:page-layout-properties element: style:print is a space-separated TOKEN LIST ("charts drawings grid headers objects zero-values") whose "grid"/"headers" membership is this reader's own gridlines/headers booleans (confirmed: a page style with both explicitly turned off omits both tokens entirely, never emits e.g. grid="false"); style:print-page-order is "ltr" (over then down) or "ttb" (down then over, ODF's own default when the attribute is absent entirely); style:scale-to is a percentage-suffixed value; style:scale-to-X/style:scale-to-Y are the fit-to-N-pages-wide/tall pair -- confirmed mutually exclusive in the UNO API itself (setting ScaleToPagesX/Y, even to their own already-zero default, silently resets PageScale back to 100 -- a real LibreOffice UNO quirk that shaped how the FIXTURE was built, not this reader's own parsing, which simply reads whichever of the two attribute pairs the producer actually wrote).
function readPrintSettings(
  tableElement: XmlElement,
  pkg: Package,
  repeatColumns: ContentSheetRepeatRange | undefined,
  repeatRows: ContentSheetRepeatRange | undefined,
  manualBreakRows: number[],
  manualBreakColumns: number[],
): ContentSheetPrintSettings {
  const tableStyleName = attrValue(tableElement, 'table:style-name');
  const tableStyleElement = tableStyleName === undefined ? undefined : findStyleElement(tableStyleName, 'table', pkg);
  const masterPageName = tableStyleElement === undefined ? undefined : attrValue(tableStyleElement, 'style:master-page-name');
  const layoutProperties = resolvePageLayoutProperties(pkg, masterPageName);

  const pageSize = layoutProperties === undefined ? undefined : parsePageSize(layoutProperties);
  const margins = layoutProperties === undefined ? undefined : parseMargins(layoutProperties);

  const printTokens = new Set((layoutProperties === undefined ? undefined : attrValue(layoutProperties, 'style:print'))?.split(' ').filter((token) => token.length > 0));

  const pageOrderRaw = layoutProperties === undefined ? undefined : attrValue(layoutProperties, 'style:print-page-order');
  const pageOrder: ContentSheetPrintSettings['pageOrder'] = pageOrderRaw === 'ltr' ? 'overThenDown' : 'downThenOver';

  const scaleToRaw = layoutProperties === undefined ? undefined : attrValue(layoutProperties, 'style:scale-to');
  const scale = scaleToRaw === undefined ? undefined : parseScalePercentage(scaleToRaw);

  const scaleToXRaw = layoutProperties === undefined ? undefined : attrValue(layoutProperties, 'style:scale-to-X');
  const scaleToYRaw = layoutProperties === undefined ? undefined : attrValue(layoutProperties, 'style:scale-to-Y');
  const fitWidth = parseNonNegativeInteger(scaleToXRaw);
  const fitHeight = parseNonNegativeInteger(scaleToYRaw);
  const fitToPages = fitWidth === undefined || fitHeight === undefined ? undefined : { width: fitWidth, height: fitHeight };

  const printRangesRaw = attrValue(tableElement, 'table:print-ranges');
  const printRange = printRangesRaw === undefined ? undefined : parsePrintRanges(printRangesRaw);

  const manualBreaks = manualBreakRows.length > 0 || manualBreakColumns.length > 0 ? { rows: manualBreakRows, columns: manualBreakColumns } : undefined;

  const settings: ContentSheetPrintSettings = {
    pageSize: pageSize ?? PAGE_SIZE_A4,
    margins: margins ?? DEFAULT_MARGINS,
    gridlines: printTokens.has('grid'),
    headers: printTokens.has('headers'),
    pageOrder,
  };
  if (printRange !== undefined) {
    settings.printRange = printRange;
  }
  if (scale !== undefined) {
    settings.scalePercent = scale;
  }
  if (fitToPages !== undefined) {
    settings.fitToPages = fitToPages;
  }
  if (repeatRows !== undefined) {
    settings.repeatRows = repeatRows;
  }
  if (repeatColumns !== undefined) {
    settings.repeatColumns = repeatColumns;
  }
  if (manualBreaks !== undefined) {
    settings.manualBreaks = manualBreaks;
  }
  return settings;
}

function readSheet(tableElement: XmlElement, pkg: Package): ContentSheet | undefined {
  const name = attrValue(tableElement, 'table:name');
  if (name === undefined) {
    return undefined;
  }
  const { columns, rows, cells, images, embeddedObjects, repeatColumns, repeatRows, manualBreakRows, manualBreakColumns } = readTable(tableElement, pkg);
  const printSettings = readPrintSettings(tableElement, pkg, repeatColumns, repeatRows, manualBreakRows, manualBreakColumns);
  const sheet: ContentSheet = { name, cells, columns, rows, images, printSettings };
  if (embeddedObjects.length > 0) {
    // Optional in ContentSheetSchema, so it is set only when the sheet genuinely has one -- matching how every other optional field in this reader is omitted rather than written as an empty value.
    sheet.embeddedObjects = embeddedObjects;
  }
  return sheet;
}

export function readOdsContent(pkg: Package): OdsDocument {
  const contentPart = pkg.parts[CONTENT_PART];
  const root = contentPart?.kind === 'xml' ? rootElement(contentPart.nodes) : undefined;
  const body = root === undefined ? undefined : findChildElement(root.children, 'office:body');
  const spreadsheet = body === undefined ? undefined : findChildElement(body.children, 'office:spreadsheet');
  const tables = spreadsheet === undefined ? [] : childrenWithTag(spreadsheet, 'table:table');

  const sheets: ContentSheet[] = [];
  for (const table of tables) {
    const sheet = readSheet(table, pkg);
    if (sheet !== undefined) {
      sheets.push(sheet);
    }
  }

  const definitions: Record<string, DefinitionEntry> = {};
  if (spreadsheet !== undefined) {
    collectOdfNamedExpressions(spreadsheet.children, definitions);
  }

  return { metadata: readOdfMetadata(pkg), sheets, ...(Object.keys(definitions).length > 0 ? { definitions } : {}) };
}

// Package -> DocumentPackage: this module's PRIMARY entry point, the spreadsheet mirror of readOdtContent/readOdt (see src/typed/odt/read.ts's own note on why assemblePackage rather than bare decompose, and why no `pages` argument). readOdsContent above is unchanged and remains the flat, ContentDocument-level reader.
export function readOds(pkg: Package): DocumentPackage {
  const { metadata, sheets, definitions } = readOdsContent(pkg);
  const assembled = assemblePackage({ kind: 'spreadsheet', metadata, sheets });
  // Tree-only table, attached to the assembled root for the same reason readOdt attaches its own (the flat exchange shape has no root to carry it through assemblePackage's envelope splice).
  if (definitions !== undefined) {
    assembled.definitions = definitions;
  }
  return assembled;
}
