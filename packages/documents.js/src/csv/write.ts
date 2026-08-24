import type { ContentDocument, ContentSheet } from "document-schema.js";
import { DEFAULT_CSV_DELIMITER, quoteCsvField } from "./records";

// The csv write half: a spreadsheet ContentDocument -> RFC 4180 text, emitting each cell's displayText (the cell's own printed form, independent of value.kind -- a currency cell writes "£42.50", not its numeric value). The sheet-selection contract mirrors src/odb/csv.ts's own odbToCsv table selection exactly: a named sheet must exist, a multi-sheet document requires a name, and a lone sheet is selected by default -- csv has no representation for a second sheet, so writing one is a caller decision, never a silent truncation.

export class CsvUnsupportedDocumentKindError extends Error {
  readonly kind: ContentDocument["kind"];

  constructor(kind: ContentDocument["kind"]) {
    super(
      `buildCsvText: expected a spreadsheet ContentDocument, got kind '${kind}'`,
    );
    this.name = "CsvUnsupportedDocumentKindError";
    this.kind = kind;
  }
}

export class CsvSheetNotSpecifiedError extends Error {
  readonly availableSheets: readonly string[];

  constructor(availableSheets: readonly string[]) {
    super(
      `buildCsvText: this document has more than one sheet (${availableSheets.join(", ")}) -- pass { sheet: '<name>' } to select one`,
    );
    this.name = "CsvSheetNotSpecifiedError";
    this.availableSheets = availableSheets;
  }
}

export class CsvSheetNotFoundError extends Error {
  readonly sheet: string;
  readonly availableSheets: readonly string[];

  constructor(sheet: string, availableSheets: readonly string[]) {
    super(
      `buildCsvText: sheet "${sheet}" not found -- available sheet(s): ${availableSheets.length === 0 ? "(none)" : availableSheets.join(", ")}`,
    );
    this.name = "CsvSheetNotFoundError";
    this.sheet = sheet;
    this.availableSheets = availableSheets;
  }
}

export interface BuildCsvTextOptions {
  // The single-character field delimiter to write with -- ',' (DEFAULT_CSV_DELIMITER) for csv, '\t' (records.ts's TSV_DELIMITER) for TSV.
  readonly delimiter?: string;
  // Selects which sheet of a multi-sheet document is written. Optional only when the document has exactly one sheet.
  readonly sheet?: string;
}

function selectSheet(
  sheets: readonly ContentSheet[],
  sheetName: string | undefined,
): ContentSheet {
  const availableNames = sheets.map((candidate) => candidate.name);
  if (sheetName !== undefined) {
    const found = sheets.find((candidate) => candidate.name === sheetName);
    if (found === undefined) {
      throw new CsvSheetNotFoundError(sheetName, availableNames);
    }
    return found;
  }
  if (sheets.length === 0) {
    throw new CsvSheetNotFoundError("(unspecified)", availableNames);
  }
  if (sheets.length > 1) {
    throw new CsvSheetNotSpecifiedError(availableNames);
  }
  const only = sheets[0];
  if (only === undefined) {
    throw new CsvSheetNotFoundError("(unspecified)", availableNames);
  }
  return only;
}

export function buildCsvText(
  content: ContentDocument,
  options?: BuildCsvTextOptions,
): string {
  if (content.kind !== "spreadsheet") {
    throw new CsvUnsupportedDocumentKindError(content.kind);
  }
  const sheet = selectSheet(content.sheets, options?.sheet);
  const delimiter = options?.delimiter ?? DEFAULT_CSV_DELIMITER;

  // The sheet model is sparse (cells addressed by row/column); csv text is a dense rectangle. The grid spans every populated cell AND every declared column/row index, whichever is wider/taller, so a declared-but-empty trailing row or column still writes its empty line/fields.
  const fieldsByRow = new Map<number, Map<number, string>>();
  let maxRowIndex = -1;
  let maxColumnIndex = -1;
  for (const cell of sheet.cells) {
    let row = fieldsByRow.get(cell.row);
    if (row === undefined) {
      row = new Map<number, string>();
      fieldsByRow.set(cell.row, row);
    }
    row.set(cell.column, cell.displayText);
    maxRowIndex = Math.max(maxRowIndex, cell.row);
    maxColumnIndex = Math.max(maxColumnIndex, cell.column);
  }
  const rowCount = Math.max(sheet.rows.length, maxRowIndex + 1);
  const columnCount = Math.max(sheet.columns.length, maxColumnIndex + 1);

  const lines: string[] = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const row = fieldsByRow.get(rowIndex);
    const fields: string[] = [];
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
      // An unpopulated grid position is an empty field: the sheet genuinely has no cell there, which is exactly what a bare empty csv field says.
      fields.push(quoteCsvField(row?.get(columnIndex) ?? "", delimiter));
    }
    lines.push(fields.join(delimiter));
  }
  return lines.length === 0 ? "" : `${lines.join("\r\n")}\r\n`;
}
