import type {
  Alignment,
  ContentFont,
  ContentCellBorders,
  ContentCellValue,
  ContentCellFill,
  ContentSheetCell,
  ContentSheetColumn,
  ContentSheetRow,
} from "document-schema.js";
import type { CellSink } from "./cell-sink";
import type { RawCell, RawSheet } from "./workbook/sheet";
import type { SheetCellComment } from "./workbook/comments";
import type { WorkbookGlobals } from "./workbook/globals";
import { contentFontOf, resolveFontColor } from "./biff/font";
import { classifyNumberFormat } from "excel-number-format";
import { assertNeverContentCellValueKind } from "./content";
import {
  serialToIsoDate,
  serialToIsoDateTime,
  serialToIsoTime,
} from "./serial";
import { resolveBorderEdge, resolveFillBackground } from "./biff/xf-colors";
import { formatCodeOf } from "./workbook/globals";

// The per-sheet mappers split from content.ts: rows, columns, cells, comments and cell decoration, the boundary between the BIFF8 record readers and document-schema.js's sparse sheet vocabulary.

export function mapRows(raw: RawSheet): ContentSheetRow[] {
  const rows: ContentSheetRow[] = [];
  for (const row of raw.rows) {
    // A row record carrying neither a declared height nor a hidden state states nothing the schema has a place for, so it is not materialised.
    if (row.heightPt === undefined && !row.hidden) {
      continue;
    }
    const entry: ContentSheetRow = { index: row.index };
    if (row.heightPt !== undefined) {
      entry.heightPt = row.heightPt;
    }
    if (row.hidden) {
      entry.hidden = true;
    }
    rows.push(entry);
  }
  return rows;
}

export function mapColumns(raw: RawSheet): ContentSheetColumn[] {
  const columns: ContentSheetColumn[] = [];
  for (const column of raw.columns) {
    if (column.widthPt === undefined && !column.hidden) {
      continue;
    }
    const entry: ContentSheetColumn = { index: column.index };
    if (column.widthPt !== undefined) {
      entry.widthPt = column.widthPt;
    }
    if (column.hidden) {
      entry.hidden = true;
    }
    columns.push(entry);
  }
  return columns;
}

/** Maps the raw cells, then stamps merged-range spans onto their anchor cells. */
export function mapCells(
  raw: RawSheet,
  globals: WorkbookGlobals,
): ContentSheetCell[] {
  const cells: ContentSheetCell[] = [];
  for (const cell of raw.cells) {
    const mapped = mapCell(cell, globals);
    if (mapped !== undefined) {
      cells.push(mapped);
    }
  }
  applyMerges({ cells }, raw);
  return cells;
}

// The sheet's own cell array, which both attach-after-the-fact passes below append newly materialised anchors onto (a comment pinned to a cell no record occupied, a merge whose anchor position holds no cell). Wrapped rather than passed as a bare array so the parameter stays out of prefer-readonly-array-param's scope while the array it holds stays genuinely mutable.

// Comments are read from their own Note/Obj/TxO records (workbook/comments.ts), entirely separate from the CELLTABLE cells above, so they attach after the fact — the same "comments live in their own parts, attach after cells are read" ordering ooxml.js's own content.ts uses for xlsx's own comment mechanism. A comment anchored to a position no cell record ever occupied (a note pinned to an otherwise-empty cell) still carries real content worth keeping, materialised the same way an <f>-only formula cell or a decorated blank cell already is: an empty value with the annotation attached.
export function applyCellComments(
  comments: ReadonlyMap<string, SheetCellComment>,
  sink: CellSink,
): void {
  const cells = sink.cells;
  // No comments.size===0 early return: an empty comments map already makes the loop below a no-op on its own (nothing to iterate), so a dedicated guard here would only ever produce that identical no-op — never a genuinely different result, just the same one reached by a shorter path.
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
    // No byPosition.set(key, materialised) here: `comments` is a Map, so `key` can never recur across this same loop's own remaining iterations — there is no later lookup this entry could ever be read back by.
    cells.push({
      row,
      column,
      value: { kind: "empty" },
      displayText: "",
      comment,
    });
  }
}

/**
 * Maps one raw cell, or drops it.
 *
 * A blank cell showing nothing at all is dropped: ContentSheet's cell array is documented as sparse, holding only cells with something to show, and dropping the blanks keeps it honest rather than filling a sheet with thousands of empty entries — applyMerges below re-materialises the few that anchor a merged range.
 *
 * A Blank or MulBlank record whose own XF carries a background or a border is not that case. Its formatting is the entire reason the record exists — a producer writes one precisely to say "this cell is empty AND looks like this" — so it becomes an `empty`-kind cell carrying that decoration, which is also what this package's own writer emits for one.
 */
export function mapCell(
  cell: RawCell,
  globals: WorkbookGlobals,
): ContentSheetCell | undefined {
  // Resolved before the blank check, because whether a blank cell is worth carrying is exactly the question of whether any of these find anything. Resolved rather than read off the XF's raw fields, so a decoration this reader declines to express — a fill pattern beyond solid, an unrecognised BorderStyle token, an icv with no fixed RGB value — counts as none here too.
  const background = backgroundOf(globals, cell.xfIndex);
  const borders = bordersOf(globals, cell.xfIndex);
  const { alignment, verticalAlignment } = alignmentOf(globals, cell.xfIndex);
  const font = fontOf(globals, cell.xfIndex);
  if (
    cell.value.kind === "blank" &&
    background === undefined &&
    borders === undefined &&
    alignment === undefined &&
    verticalAlignment === undefined &&
    font === undefined
  ) {
    return undefined;
  }
  const formatCode = formatCodeOf(globals, cell.xfIndex);
  const value = resolveValue(cell, formatCode, globals.date1904);
  const mapped: ContentSheetCell = {
    row: cell.row,
    column: cell.column,
    value,
    displayText: displayTextOf(value),
  };
  if (formatCode !== undefined) {
    mapped.numberFormatCode = formatCode;
  }
  if (font !== undefined) {
    mapped.font = font;
  }
  if (cell.formula !== undefined) {
    mapped.formula = cell.formula;
  }
  if (background !== undefined) {
    mapped.background = background;
  }
  if (borders !== undefined) {
    mapped.borders = borders;
  }
  if (alignment !== undefined) {
    mapped.alignment = alignment;
  }
  if (verticalAlignment !== undefined) {
    mapped.verticalAlignment = verticalAlignment;
  }
  return mapped;
}

/**
 * A cell's own resolved background fill (ExaDev/documents.js#951), or undefined for a genuinely unfilled cell and for a reserved/unrecognised FillPattern value.
 *
 * A solid fill resolves to a 'solid' ContentCellFill of its own foreground colour; every other named FillPattern — the 50%/75%/25% gray shades, the stripe and crosshatch family — resolves to a real 'pattern' fill via xf-colors.ts's own FILL_PATTERN_TO_PATTERN_TYPE, carrying whichever of the pattern's foreground/background colours actually resolve to a fixed RGB value. See xls-codec's README, "Cell decoration".
 */
export function backgroundOf(
  globals: WorkbookGlobals,
  xfIndex: number,
): ContentCellFill | undefined {
  const format = globals.cellFormats[xfIndex];
  if (format === undefined) {
    return undefined;
  }
  return resolveFillBackground(
    format.decoration.fillPattern,
    format.decoration.fillForegroundIcv,
    format.decoration.fillBackgroundIcv,
    globals.palette,
  );
}

/** A cell's own resolved horizontal/vertical alignment — already the exact Alignment/verticalAlignment members (or undefined) globals.ts's readCellFormat resolved through xf-colors.ts's unpackXfAlignment, so this is a lookup rather than a further resolution step, mirroring backgroundOf/bordersOf's own shape. Both fields undefined for a cell whose XF resolves to no CellFormat at all (an out-of-range xfIndex), matching every other resolveXOf helper's behaviour in that case. */
export function alignmentOf(
  globals: WorkbookGlobals,
  xfIndex: number,
): { alignment?: Alignment; verticalAlignment?: "top" | "middle" | "bottom" } {
  const format = globals.cellFormats[xfIndex];
  if (format === undefined) {
    return {};
  }
  // Assigned unconditionally rather than each behind its own "if !== undefined" guard: mapCell, this function's only caller, already re-checks each field against undefined before ever copying it onto the ContentSheetCell it builds, so a guard here would only ever decide between two objects mapCell treats identically — one whose own field is absent, and one whose own field holds undefined, both of which mapCell's own check reads the same way.
  return {
    alignment: format.alignment.horizontal,
    verticalAlignment: format.alignment.vertical,
  };
}

/**
 * A cell's own font, or undefined when the cell states none of its own: the font its XF's ifnt names, diffed against the workbook's own first font (the Normal style's, entry 0 of the font table) so that only properties the cell genuinely differs in survive — the same default-omission policy alignmentOf applies to ALCGEN/ALCVBOT and the fill reader to FLSNULL. A cell whose XF resolves to no CellFormat at all, or whose font index resolves past the end of the font table, carries no font, matching every other resolveXOf helper's behaviour for an out-of-range index.
 */
export function fontOf(
  globals: WorkbookGlobals,
  xfIndex: number,
): ContentFont | undefined {
  const format = globals.cellFormats[xfIndex];
  if (format === undefined) {
    return undefined;
  }
  const font = globals.fonts[format.fontIndex];
  const baseline = globals.fonts[0];
  if (font === undefined || baseline === undefined) {
    return undefined;
  }
  return contentFontOf(font, baseline, (icv) =>
    resolveFontColor(icv, globals.palette),
  );
}

/** A cell's own resolved per-side borders, or undefined when none of its four sides carry a border this reader resolves (no border at all, or a reserved/unrecognised BorderStyle token, or a colour this package cannot express as a fixed RGB value — see xf-colors.ts's own resolveBorderEdge). */
export function bordersOf(
  globals: WorkbookGlobals,
  xfIndex: number,
): ContentCellBorders | undefined {
  const format = globals.cellFormats[xfIndex];
  if (format === undefined) {
    return undefined;
  }
  const { decoration } = format;
  const left = resolveBorderEdge(decoration.left, globals.palette);
  const right = resolveBorderEdge(decoration.right, globals.palette);
  const top = resolveBorderEdge(decoration.top, globals.palette);
  const bottom = resolveBorderEdge(decoration.bottom, globals.palette);
  if (
    left === undefined &&
    right === undefined &&
    top === undefined &&
    bottom === undefined
  ) {
    return undefined;
  }
  const borders: ContentCellBorders = {};
  if (left !== undefined) {
    borders.left = left;
  }
  if (right !== undefined) {
    borders.right = right;
  }
  if (top !== undefined) {
    borders.top = top;
  }
  if (bottom !== undefined) {
    borders.bottom = bottom;
  }
  return borders;
}

/**
 * Resolves a raw value into a ContentCellValue, classifying a number through its own format code.
 *
 * This is where BIFF8's lack of temporal and percentage cell types is undone: every date, time, percentage, and currency amount is stored as a bare number, and only the format its XF points at says which. A format naming a date the calendar does not have (the 1900 system's phantom leap day, or a negative serial) degrades to the plain number rather than emitting an invalid ISO string.
 */
export function resolveValue(
  cell: RawCell,
  formatCode: string | undefined,
  date1904: boolean,
): ContentCellValue {
  // The two vocabularies name an absent value differently — BIFF8's record family calls it blank, the schema calls it empty — so the translation is spelled out rather than left to a structural coincidence. mapCell drops an undecorated blank before reaching here; this branch is what a decorated one, and a blank that survives as a merge anchor, resolve through.
  if (cell.value.kind === "blank") {
    return { kind: "empty" };
  }
  if (cell.value.kind !== "number") {
    return cell.value;
  }
  const num = cell.value.value;
  if (formatCode === undefined) {
    return { kind: "number", value: num };
  }
  const format = classifyNumberFormat(formatCode);
  switch (format.kind) {
    case "percentage":
      // The stored value stays the raw fraction, which is both what ContentCellValue's percentage variant carries and what a percent-formatted cell holds in every real file; the multiplication by a hundred lives purely in the rendering.
      return { kind: "percentage", value: num };
    case "currency":
      return format.code === undefined
        ? { kind: "currency", value: num }
        : { kind: "currency", value: num, currency: format.code };
    case "date": {
      const iso = serialToIsoDate(num, date1904);
      return iso === undefined
        ? { kind: "number", value: num }
        : { kind: "date", value: iso };
    }
    case "time": {
      const iso = serialToIsoTime(num);
      return iso === undefined
        ? { kind: "number", value: num }
        : { kind: "time", value: iso };
    }
    case "dateTime": {
      const iso = serialToIsoDateTime(num, date1904);
      return iso === undefined
        ? { kind: "number", value: num }
        : { kind: "dateTime", value: iso };
    }
    default:
      // 'elapsedTime' lands here deliberately alongside 'number' and 'text': a duration may exceed 24 hours, so it has no wall-clock spelling ContentCellValue's own 'time' variant could carry without misrepresenting it.
      return { kind: "number", value: num };
  }
}

// Reached only if ContentCellValue ever gains a variant a switch over its own kind does not match: every current member is covered wherever this is called, so `value` narrows to `never` at each real call site, and adding an uncovered kind makes that narrowing fail and those calls stop compiling. That is the real safety net. Shared between this module's own displayTextOf, write.ts's defaultFormatIdForKind, write.test.ts's displayTextFor (which mirrors displayTextOf exactly, per its own doc comment), and workbook/sheet-writer.ts's writeCellValueRecord and formulaValueBytes, all five of which switch over the identical union, rather than each keeping a byte-identical copy. Exported so content.test.ts can exercise the throw directly with a forced-invalid cast: it is otherwise unreachable, since every real kind is already handled by a case in all five.

export function applyMerges(sink: CellSink, raw: RawSheet): void {
  const cells = sink.cells;
  for (const range of raw.merges) {
    const rowSpan = range.endRow - range.startRow + 1;
    const colSpan = range.endColumn - range.startColumn + 1;
    if (rowSpan <= 1 && colSpan <= 1) {
      continue;
    }
    let anchor = cells.find(
      (cell) =>
        cell.row === range.startRow && cell.column === range.startColumn,
    );
    if (anchor === undefined) {
      anchor = {
        row: range.startRow,
        column: range.startColumn,
        value: { kind: "empty" },
        displayText: "",
      };
      cells.push(anchor);
    }
    if (colSpan > 1) {
      anchor.colSpan = colSpan;
    }
    if (rowSpan > 1) {
      anchor.rowSpan = rowSpan;
    }
  }
}

export function displayTextOf(value: ContentCellValue): string {
  switch (value.kind) {
    case "number":
    case "percentage":
    case "currency":
      return String(value.value);
    case "boolean":
      return value.value ? "TRUE" : "FALSE";
    case "date":
    case "time":
    case "dateTime":
    case "string":
    case "error":
      return value.value;
    case "empty":
      return "";
    // No default: ContentCellValueSchema's discriminated union has exactly these ten kinds, so every one is already handled above — a default clause here would only ever be reached by a value outside that union, which the parameter's own type already rules out, and a hand-added "return the identical empty string" branch for that unreachable case is not a smaller version of a real fallback, it is a second, redundant copy of the "empty" case's own return.
  }
  return assertNeverContentCellValueKind(value);
}
