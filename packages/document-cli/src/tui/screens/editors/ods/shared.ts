import { readOdsContent, type ContentCellValue, type ContentSheet, type ContentSheetCell, type OdsEditor } from 'documents.js';
import type { AppState, OdsOpenDocument } from '../../../state/types.js';

// Every ods screen in this group needs the open document narrowed to `OdsOpenDocument` before touching `.editor`. The reducer's own `rootScreenForFormat`/`OPEN_FILE_SUCCESS`/`CREATE_DOCUMENT` guarantee that whichever of these screens is on top of the stack, the open document really is ods -- a mismatch here can only mean a routing bug elsewhere in the app, worth a loud failure rather than a silent fallback, matching the same "was rendered while the current screen was not X" throw already used by the sibling screens in ../../.
export function odsDocument(state: AppState): OdsOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== 'ods') {
    throw new Error('An ods screen was rendered while the open document was not ods; the app only ever reaches these screens from the ods root screen.');
  }
  return doc;
}

// `OdsSheet` itself has no range/dimension enumerator at all, and `OdsSheet.cell(row, column)` materialises a real `table:table-column`/`table:table-row` element for whatever position it is called with -- see documents.js's own README gotcha on `src/edit/ods/address.ts`. Calling `cell()` merely to DISPLAY the grid would therefore silently mutate the document every time the viewport scrolls. `readOdsContent`'s own resolved `rows`/`columns`/`cells` arrays are the only read path that never writes anything back, which is why every display-only concern in this screen group goes through here instead of the live `OdsSheet`; writes still go through `OdsSheet.cell(...).value = ...` (wired to `SET_CELL_VALUE` in the reducer), never through this function.
export function resolveSheet(editor: OdsEditor, sheetIndex: number): ContentSheet | undefined {
  const content = readOdsContent(editor.toPackage());
  if (content.kind !== 'spreadsheet') {
    throw new Error('readOdsContent always resolves an ods package to the spreadsheet ContentDocument variant.');
  }
  return content.sheets[sheetIndex];
}

const MIN_GRID_EXTENT = 1;

// "What's actually populated?" resolved from the same readOdsContent walk `resolveSheet` already did -- the sheet's real extent is the furthest cell/column/row index it declares, floored at 1x1 so a freshly-added, entirely empty sheet still offers a navigable A1 to start typing into. Extent grows on its own as further cells are written, since `OdsSheet.cell()` materialises a real column/row element at whatever position it is next called with.
export function sheetExtent(sheet: ContentSheet | undefined): { readonly rowCount: number; readonly columnCount: number } {
  if (sheet === undefined) {
    return { rowCount: MIN_GRID_EXTENT, columnCount: MIN_GRID_EXTENT };
  }
  const maxOf = (values: readonly number[]): number => values.reduce((max, value) => Math.max(max, value), MIN_GRID_EXTENT - 1);
  const rowCount = Math.max(maxOf(sheet.cells.map((cell) => cell.row)), maxOf(sheet.rows.map((row) => row.index))) + 1;
  const columnCount = Math.max(maxOf(sheet.cells.map((cell) => cell.column)), maxOf(sheet.columns.map((column) => column.index))) + 1;
  return { rowCount, columnCount };
}

export function cellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

export function cellLookup(sheet: ContentSheet | undefined): ReadonlyMap<string, ContentSheetCell> {
  const map = new Map<string, ContentSheetCell>();
  if (sheet === undefined) {
    return map;
  }
  for (const cell of sheet.cells) {
    map.set(cellKey(cell.row, cell.column), cell);
  }
  return map;
}

// Single-character, plain-ASCII badges so the grid stays legible in any terminal -- no emoji, no box-drawing glyphs that might be missing from a given font.
export const KIND_BADGE: Readonly<Record<ContentCellValue['kind'], string>> = {
  string: 'S',
  number: 'N',
  percentage: '%',
  currency: 'C',
  boolean: 'B',
  date: 'D',
  time: 'T',
  dateTime: '@',
  error: 'E',
  empty: '.',
};

// Every kind a cell can genuinely be cycled to while editing, in display order -- 'empty' is reached by clearing the text instead of cycling to it (see cell-detail.tsx's own comment), so it is deliberately not a member of this list.
export const CELL_VALUE_KINDS: readonly ContentCellValue['kind'][] = ['string', 'number', 'percentage', 'currency', 'boolean', 'date', 'time', 'dateTime', 'error'];

// The text an existing cell's own value round-trips through the editor as, when Enter opens it for editing with no seed keystroke -- the *raw* value (`String(42.5)`), never the rendered `displayText` (which for a percentage/currency/date cell is formatted for reading, not for re-parsing back into the same kind).
export function rawEditableText(value: ContentCellValue): string {
  switch (value.kind) {
    case 'empty':
      return '';
    case 'string':
    case 'date':
    case 'time':
    case 'dateTime':
    case 'error':
      return value.value;
    case 'boolean':
      return value.value ? 'TRUE' : 'FALSE';
    case 'number':
    case 'percentage':
    case 'currency':
      return String(value.value);
  }
}

// The kind a fresh type-to-edit seed keystroke implies, per the brief: a leading digit means number, TRUE/FALSE means boolean, anything else means string. This runs once, at the moment editing begins -- see cell-detail.tsx's own comment for why the kind does not keep re-inferring itself as the user keeps typing.
export function inferKind(seed: string): ContentCellValue['kind'] {
  const trimmed = seed.trim();
  if (trimmed.length === 0) {
    return 'empty';
  }
  if (/^(true|false)$/i.test(trimmed)) {
    return 'boolean';
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return 'number';
  }
  return 'string';
}

function parseFiniteNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// The typed `ContentCellValue` a kind + the editor's current text buffer commit to, or `undefined` when the text does not actually fit the chosen kind (an unparsable number, neither "true" nor "false" for a boolean) -- the caller is expected to refuse the commit and keep editing rather than silently coercing to a fallback value.
export function buildCellValue(kind: ContentCellValue['kind'], text: string): ContentCellValue | undefined {
  switch (kind) {
    case 'empty':
      return { kind: 'empty' };
    case 'string':
      return { kind: 'string', value: text };
    case 'boolean': {
      const normalized = text.trim().toLowerCase();
      if (normalized !== 'true' && normalized !== 'false') {
        return undefined;
      }
      return { kind: 'boolean', value: normalized === 'true' };
    }
    case 'number': {
      const value = parseFiniteNumber(text);
      return value === undefined ? undefined : { kind: 'number', value };
    }
    case 'percentage': {
      const value = parseFiniteNumber(text.replace('%', ''));
      return value === undefined ? undefined : { kind: 'percentage', value };
    }
    case 'currency': {
      const value = parseFiniteNumber(text.replace(/[^0-9.-]/g, ''));
      return value === undefined ? undefined : { kind: 'currency', value };
    }
    case 'date': {
      const trimmed = text.trim();
      return trimmed.length === 0 ? undefined : { kind: 'date', value: trimmed };
    }
    case 'time': {
      const trimmed = text.trim();
      return trimmed.length === 0 ? undefined : { kind: 'time', value: trimmed };
    }
    case 'dateTime': {
      const trimmed = text.trim();
      return trimmed.length === 0 ? undefined : { kind: 'dateTime', value: trimmed };
    }
    case 'error': {
      const trimmed = text.trim();
      return trimmed.length === 0 ? undefined : { kind: 'error', value: trimmed };
    }
  }
}
