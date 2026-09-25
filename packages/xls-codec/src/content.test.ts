import {} from "archive-codec";
import {} from "document-schema.js";
import { describe, expect, it } from "vitest";

import {
  BOF_TYPE_WORKBOOK,
  BOF_TYPE_WORKSHEET,
  RECORD_BOF,
  RECORD_BOUNDSHEET8,
  RECORD_DATE1904,
  RECORD_EOF,
  RECORD_FORMAT,
  RECORD_LABELSST,
  RECORD_MERGECELLS,
  RECORD_NUMBER,
  RECORD_SST,
  RECORD_XF,
} from "./biff/record-types";
import {} from "./biff/records";
import {} from "./container";
import { readXlsContent } from "./content";
import {
  bofData,
  cell,
  cellXfTrailer,
  concat,
  f64,
  record,
  richExtendedString,
  shortXlUnicodeString,
  u16,
  u32,
  xlUnicodeString,
} from "./test-support/biff";
import { compoundFile } from "./test-support/cfb";
import {} from "./test-support/escher";

// End-to-end: a genuine [MS-CFB] compound file holding a hand-built BIFF8 record stream, read the whole way through to a ContentDocument. Every byte sequence is assembled from the field layouts [MS-XLS] specifies, so a failure here points at this package's reading of the specification rather than at a captured file's quirks.

/** Assembles a workbook stream: the globals substream, then one worksheet substream per sheet, and reports where each sheet's BOF landed so BoundSheet8 can name it. */
function workbookStream(options: {
  globals: readonly Uint8Array<ArrayBuffer>[];
  sheets: readonly {
    name: string;
    records: readonly Uint8Array<ArrayBuffer>[];
    /** BoundSheet8's own dt field; 0x00 (a worksheet) unless a test needs otherwise. */
    sheetType?: number;
  }[];
}): Uint8Array<ArrayBuffer> {
  // Built in two passes, because BoundSheet8's lbPlyPos has to name a byte offset that only exists once the globals substream's own length is known — and that length depends on the BoundSheet8 records themselves. The first pass measures with placeholder offsets, the second writes the real ones; both produce identically sized records, so the measurement holds.
  const build = (offsets: readonly number[]): Uint8Array<ArrayBuffer> => {
    const boundSheets = options.sheets.map((sheet, index) =>
      record(RECORD_BOUNDSHEET8, [
        ...u32(offsets[index] ?? 0),
        0x00,
        sheet.sheetType ?? 0x00,
        ...shortXlUnicodeString(sheet.name),
      ]),
    );
    const globals = concat(
      record(RECORD_BOF, bofData(BOF_TYPE_WORKBOOK)),
      ...options.globals,
      ...boundSheets,
      record(RECORD_EOF, []),
    );
    const sheetStreams = options.sheets.map((sheet) =>
      concat(
        record(RECORD_BOF, bofData(BOF_TYPE_WORKSHEET)),
        ...sheet.records,
        record(RECORD_EOF, []),
      ),
    );
    return concat(globals, ...sheetStreams);
  };

  const measured = build(options.sheets.map(() => 0));
  const globalsLength =
    measured.length -
    options.sheets.reduce((sum, sheet) => {
      const stream = concat(
        record(RECORD_BOF, bofData(BOF_TYPE_WORKSHEET)),
        ...sheet.records,
        record(RECORD_EOF, []),
      );
      return sum + stream.length;
    }, 0);

  let offset = globalsLength;
  const offsets: number[] = [];
  for (const sheet of options.sheets) {
    offsets.push(offset);
    offset += concat(
      record(RECORD_BOF, bofData(BOF_TYPE_WORKSHEET)),
      ...sheet.records,
      record(RECORD_EOF, []),
    ).length;
  }
  return build(offsets);
}

/** Wraps a workbook stream in the compound-file container a real .xls carries it in. */
function xlsFile(stream: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  return compoundFile([{ path: "Workbook", bytes: stream }]);
}

/** Adds a real `"\x05SummaryInformation"` stream beside an .xls file's existing streams — composed with archive-codec's own writeSummaryInformationStream/writeCompoundFile rather than by extending xlsFile, which stays a pure BIFF8-only fixture builder. */

/** The fifteen style XFs a real file writes before its first cell XF, so a cell's own ixfe of 15 lands on the first cell format — which is what [MS-XLS] 2.5.168 requires of an ixfe. Every cell XF here carries an undecorated trailing payload; xfTableWithDecoration below is the sibling a decoration test builds its own cell XF through instead. */
function xfTable(...cellFormats: readonly number[]): Uint8Array<ArrayBuffer>[] {
  const styles = Array.from({ length: 15 }, () =>
    record(RECORD_XF, [
      ...u16(0),
      ...u16(0),
      ...u16(0x0004),
      ...cellXfTrailer(),
    ]),
  );
  const cells = cellFormats.map((formatId) =>
    record(RECORD_XF, [
      ...u16(0),
      ...u16(formatId),
      ...u16(0),
      ...cellXfTrailer(),
    ]),
  );
  return [...styles, ...cells];
}

/** A Font record ([MS-XLS] 2.4.122) with an uncompressed fontName — the record's own "fontName.fHighByte MUST equal 1" rule — for a test driving the per-cell font reader. Every field left absent carries the spec's own default shape (Arial at 10pt/200 twips, no flags, Automatic colour, normal weight, no underline). */

/** As xfTable, but the single cell XF this builds references the given font index rather than font 0 — for a test exercising per-cell fonts. */

describe("readXlsContent", () => {
  it("reads a workbook's sheets in tab order with their names", () => {
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [
          { name: "First", records: [] },
          { name: "Second", records: [] },
        ],
      }),
    );

    const content = readXlsContent(bytes);

    expect(content.kind).toBe("spreadsheet");
    expect(content.sheets.map((sheet) => sheet.name)).toStrictEqual([
      "First",
      "Second",
    ]);
  });

  it("matches each sheet to its own substream by the offset BoundSheet8 names", () => {
    // Not by position: the order sheets appear in the workbook is not required to match the order their substreams were written in.
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [
          {
            name: "First",
            records: [record(RECORD_NUMBER, [...cell(0, 0), ...f64(11)])],
          },
          {
            name: "Second",
            records: [record(RECORD_NUMBER, [...cell(0, 0), ...f64(22)])],
          },
        ],
      }),
    );

    const content = readXlsContent(bytes);

    expect(content.sheets[0]?.cells[0]?.value).toStrictEqual({
      kind: "number",
      value: 11,
    });
    expect(content.sheets[1]?.cells[0]?.value).toStrictEqual({
      kind: "number",
      value: 22,
    });
  });

  it("reads a string cell through the shared string table", () => {
    const bytes = xlsFile(
      workbookStream({
        globals: [
          ...xfTable(0),
          record(RECORD_SST, [
            ...u32(1),
            ...u32(1),
            ...richExtendedString("Hello"),
          ]),
        ],
        sheets: [
          {
            name: "Sheet1",
            records: [record(RECORD_LABELSST, [...cell(0, 0), ...u32(0)])],
          },
        ],
      }),
    );

    expect(readXlsContent(bytes).sheets[0]?.cells[0]).toStrictEqual({
      row: 0,
      column: 0,
      value: { kind: "string", value: "Hello" },
      displayText: "Hello",
      numberFormatCode: "General",
    });
  });

  it("classifies a numeric cell as a date through its own number format", () => {
    // The whole reason number-format classification exists: BIFF8 has no date cell type, so without it this cell reads back as 45292.
    const bytes = xlsFile(
      workbookStream({
        globals: [
          record(RECORD_FORMAT, [
            ...u16(164),
            ...xlUnicodeString("yyyy-mm-dd"),
          ]),
          ...xfTable(164),
        ],
        sheets: [
          {
            name: "Sheet1",
            records: [record(RECORD_NUMBER, [...cell(0, 0), ...f64(45292)])],
          },
        ],
      }),
    );

    expect(readXlsContent(bytes).sheets[0]?.cells[0]).toMatchObject({
      value: { kind: "date", value: "2024-01-01" },
      displayText: "2024-01-01",
      numberFormatCode: "yyyy-mm-dd",
    });
  });

  it("shifts a date by the 1904 epoch when the workbook declares it", () => {
    const bytes = xlsFile(
      workbookStream({
        globals: [
          record(RECORD_DATE1904, u16(1)),
          record(RECORD_FORMAT, [
            ...u16(164),
            ...xlUnicodeString("yyyy-mm-dd"),
          ]),
          ...xfTable(164),
        ],
        sheets: [
          {
            name: "Sheet1",
            records: [
              record(RECORD_NUMBER, [...cell(0, 0), ...f64(45292 - 1462)]),
            ],
          },
        ],
      }),
    );

    expect(readXlsContent(bytes).sheets[0]?.cells[0]?.value).toStrictEqual({
      kind: "date",
      value: "2024-01-01",
    });
  });

  it("classifies a numeric cell as a percentage, keeping the stored fraction", () => {
    // ContentCellValue's percentage variant carries the underlying fraction; the multiplication by a hundred lives in the rendering.
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(10),
        sheets: [
          {
            name: "Sheet1",
            records: [record(RECORD_NUMBER, [...cell(0, 0), ...f64(0.4256)])],
          },
        ],
      }),
    );

    expect(readXlsContent(bytes).sheets[0]?.cells[0]?.value).toStrictEqual({
      kind: "percentage",
      value: 0.4256,
    });
  });

  it("classifies a numeric cell as currency with its ISO code", () => {
    const bytes = xlsFile(
      workbookStream({
        globals: [
          record(RECORD_FORMAT, [
            ...u16(164),
            ...xlUnicodeString("[$GBP-809]#,##0.00"),
          ]),
          ...xfTable(164),
        ],
        sheets: [
          {
            name: "Sheet1",
            records: [record(RECORD_NUMBER, [...cell(0, 0), ...f64(12.5)])],
          },
        ],
      }),
    );

    expect(readXlsContent(bytes).sheets[0]?.cells[0]?.value).toStrictEqual({
      kind: "currency",
      value: 12.5,
      currency: "GBP",
    });
  });

  it("degrades a date format over a serial naming no real day to a plain number", () => {
    // Serial 60 is the 1900 system's phantom leap day. Emitting an ISO date for it would put an impossible day in the document.
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(14),
        sheets: [
          {
            name: "Sheet1",
            records: [record(RECORD_NUMBER, [...cell(0, 0), ...f64(60)])],
          },
        ],
      }),
    );

    expect(readXlsContent(bytes).sheets[0]?.cells[0]?.value).toStrictEqual({
      kind: "number",
      value: 60,
    });
  });

  it("keeps the cell array sparse, dropping a blank cell that shows nothing", () => {
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [
          {
            name: "Sheet1",
            records: [
              record(0x0201, cell(0, 0)),
              record(RECORD_NUMBER, [...cell(5, 5), ...f64(1)]),
            ],
          },
        ],
      }),
    );

    const cells = readXlsContent(bytes).sheets[0]?.cells ?? [];

    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ row: 5, column: 5 });
  });

  it("stamps a merged range's span onto its anchor cell only", () => {
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [
          {
            name: "Sheet1",
            records: [
              record(RECORD_NUMBER, [...cell(0, 0), ...f64(1)]),
              record(RECORD_MERGECELLS, [
                ...u16(1),
                ...u16(0),
                ...u16(1),
                ...u16(0),
                ...u16(2),
              ]),
            ],
          },
        ],
      }),
    );

    expect(readXlsContent(bytes).sheets[0]?.cells[0]).toMatchObject({
      row: 0,
      column: 0,
      rowSpan: 2,
      colSpan: 3,
    });
  });
});
