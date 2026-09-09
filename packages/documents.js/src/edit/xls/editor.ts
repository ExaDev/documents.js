import {
  PAGE_SIZE_LETTER,
  type ContentDocument,
  type LayoutMetadata,
} from "document-schema.js";
import { readXlsContent, writeXlsContent } from "xls-codec";
import { resolveMetadataTimestamps } from "../../model/metadata";
import type { ClockPort } from "../../ports/clock";
import { systemClock } from "../../ports/clock";
import { XlsSheet } from "./sheet";

// The spreadsheet member of the ContentDocument union, narrowed once so the editor's field keeps the constructor guard's shape for every later use.
type SpreadsheetDocument = Extract<ContentDocument, { kind: "spreadsheet" }>;

// The print settings a fresh sheet starts with: Letter portrait with 1in margins (the same page geometry createDoc gives a fresh wordprocessing document), gridlines and heading chrome on, the common page order -- the defaults a fresh spreadsheet application itself prints with.
const DEFAULT_PRINT_SETTINGS = {
  pageSize: PAGE_SIZE_LETTER,
  margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
  gridlines: true,
  headers: true,
  pageOrder: "downThenOver",
} as const;

export interface CreateXlsOptions {
  readonly clock?: ClockPort;
}

// A genuine live-view editor over a mutable in-memory spreadsheet ContentDocument -- the xls sibling of DocEditor/MarkdownEditor (xls-codec's reader and writer both operate on the plain ContentDocument directly, with no XmlElement tree to hold a reference into). Every XlsSheet/XlsCell it produces holds a direct reference into document.sheets (or the sheet's own sparse cells array); toBytes() re-serialises the whole workbook through writeXlsContent.
export class XlsEditor {
  private readonly document: SpreadsheetDocument;

  constructor(document: ContentDocument) {
    if (document.kind !== "spreadsheet") {
      throw new Error(
        `XlsEditor requires a spreadsheet ContentDocument, got "${document.kind}"`,
      );
    }
    if (document.sheets.length === 0) {
      throw new Error("an xls workbook must carry at least one sheet");
    }
    this.document = document;
  }

  get metadata(): LayoutMetadata {
    return this.document.metadata;
  }

  set metadata(value: LayoutMetadata) {
    this.document.metadata = value;
  }

  sheets(): XlsSheet[] {
    return this.document.sheets.map(
      (sheet) => new XlsSheet(this.document.sheets, sheet),
    );
  }

  sheet(name: string): XlsSheet | undefined {
    const found = this.document.sheets.find((sheet) => sheet.name === name);
    return found === undefined
      ? undefined
      : new XlsSheet(this.document.sheets, found);
  }

  addSheet(name: string): XlsSheet {
    const node = {
      name,
      cells: [],
      columns: [],
      rows: [],
      images: [],
      printSettings: structuredClone(DEFAULT_PRINT_SETTINGS),
    };
    this.document.sheets.push(node);
    return new XlsSheet(this.document.sheets, node);
  }

  removeSheetAt(index: number): void {
    if (this.document.sheets.length === 1) {
      throw new Error(
        "an xls workbook must carry at least one sheet; the last one cannot be removed",
      );
    }
    this.document.sheets.splice(index, 1);
  }

  toBytes(): Uint8Array<ArrayBuffer> {
    return writeXlsContent(this.document);
  }
}

export function openXls(
  bytes: Uint8Array<ArrayBuffer>,
  password?: string,
): XlsEditor {
  return new XlsEditor(readXlsContent(bytes, password));
}

// Creates a fresh one-sheet workbook with real metadata timestamps -- mirrors createDoc/createMarkdownEditor's default-on clock behaviour. The first sheet is named the way a fresh spreadsheet application names its own ("Sheet1"), since a sheet with no name is not a shape the model allows.
export function createXls(options: CreateXlsOptions = {}): XlsEditor {
  const clock = options.clock ?? systemClock;
  const document: ContentDocument = {
    kind: "spreadsheet",
    metadata: resolveMetadataTimestamps({}, clock),
    sheets: [
      {
        name: "Sheet1",
        cells: [],
        columns: [],
        rows: [],
        images: [],
        printSettings: structuredClone(DEFAULT_PRINT_SETTINGS),
      },
    ],
  };
  return new XlsEditor(document);
}
