import {} from "archive-codec";
import {} from "document-schema.js";
import { describe, expect, it } from "vitest";

import {
  BOF_TYPE_WORKBOOK,
  BOF_TYPE_WORKSHEET,
  RECORD_BOF,
  RECORD_BOUNDSHEET8,
  RECORD_CF,
  RECORD_CF12,
  RECORD_CONDFMT,
  RECORD_CONDFMT12,
  RECORD_DATE1904,
  RECORD_DV,
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

  it("never materialises a phantom anchor for a degenerate 1x1 MergeCells range", () => {
    // A range whose start and end coincide on both axes is not a real merge at all (rowSpan and colSpan both resolve to exactly 1, ContentSheetCell's own "only when greater than one" contract), so applyMerges must skip it entirely — including never even looking up or materialising an anchor cell at that position, which an undecorated, valueless position would otherwise gain purely as a side effect of the lookup.
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
                ...u16(5), // rowFirst
                ...u16(5), // rowLast — same as rowFirst
                ...u16(5), // colFirst
                ...u16(5), // colLast — same as colFirst
              ]),
            ],
          },
        ],
      }),
    );

    const cells = readXlsContent(bytes).sheets[0]?.cells ?? [];

    expect(cells).toHaveLength(1);
    expect(cells.find((c) => c.row === 5 && c.column === 5)).toBeUndefined();
  });

  it("anchors a merge to the cell at its own start row AND column, not just a same-row or same-column neighbour", () => {
    // Two other real cells sit at the same row and the same column as the merge's own start position, but neither one IS that position — only the cell at exactly (2,2) may be treated as this merge's anchor.
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [
          {
            name: "Sheet1",
            records: [
              record(RECORD_NUMBER, [...cell(2, 0), ...f64(10)]), // same row, different column
              record(RECORD_NUMBER, [...cell(0, 2), ...f64(20)]), // same column, different row
              record(RECORD_MERGECELLS, [
                ...u16(1),
                ...u16(2), // rowFirst
                ...u16(3), // rowLast
                ...u16(2), // colFirst
                ...u16(3), // colLast
              ]),
            ],
          },
        ],
      }),
    );

    const cells = readXlsContent(bytes).sheets[0]?.cells ?? [];
    const rowNeighbour = cells.find((c) => c.row === 2 && c.column === 0);
    const columnNeighbour = cells.find((c) => c.row === 0 && c.column === 2);
    const anchor = cells.find((c) => c.row === 2 && c.column === 2);

    expect(rowNeighbour?.rowSpan).toBeUndefined();
    expect(rowNeighbour?.colSpan).toBeUndefined();
    expect(columnNeighbour?.rowSpan).toBeUndefined();
    expect(columnNeighbour?.colSpan).toBeUndefined();
    expect(anchor).toMatchObject({ rowSpan: 2, colSpan: 2 });
  });

  it("reads a Dv record into ContentSheet.dataValidations (ExaDev/documents.js#1098) — workbook/data-validation.test.ts covers the [MS-XLS] field mapping in full; this is the end-to-end proof from real bytes to ContentSheet", () => {
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [
          {
            name: "Sheet1",
            records: [
              record(RECORD_DV, [
                ...u32(0x400002), // valType 2 (decimal), typOperator 4 (greaterThan)
                ...xlUnicodeString(""),
                ...xlUnicodeString(""),
                ...xlUnicodeString(""),
                ...xlUnicodeString(""),
                ...u16(3),
                ...u16(0),
                0x1e,
                ...u16(0),
                ...u16(0), // formula2 cce: 0, no second bound
                ...u16(0), // formula2's own unused field — DVParsedFormula always carries it, even when cce is 0
                ...u16(1),
                ...u16(0),
                ...u16(0),
                ...u16(0),
                ...u16(0),
              ]),
            ],
          },
        ],
      }),
    );

    expect(readXlsContent(bytes).sheets[0]?.dataValidations).toStrictEqual([
      {
        type: "decimal",
        operator: "greaterThan",
        formula1: "0",
        ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
      },
    ]);
  });

  it("leaves formula1 entirely absent for a valType-0 Dv record, ECMA-376's own 'no criteria stated' shape", () => {
    // valType 0 is unmapped by VALUE_TYPE_BY_VAL_TYPE, so this degrades to type 'custom' with a genuinely zero-length formula1 (cce 0) — own-property check, not a value check, since a bug materialising the key with an explicit undefined value would pass a plain .toBeUndefined() assertion just as easily as a genuinely absent key would.
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [
          {
            name: "Sheet1",
            records: [
              record(RECORD_DV, [
                ...u32(0), // flags: valType 0, every other bit clear
                ...xlUnicodeString(""),
                ...xlUnicodeString(""),
                ...xlUnicodeString(""),
                ...xlUnicodeString(""),
                ...u16(0), // formula1 cce: 0
                ...u16(0), // formula1's own unused field
                ...u16(0), // formula2 cce: 0
                ...u16(0), // formula2's own unused field
                ...u16(1),
                ...u16(0),
                ...u16(0),
                ...u16(0),
                ...u16(0),
              ]),
            ],
          },
        ],
      }),
    );

    const validations = readXlsContent(bytes).sheets[0]?.dataValidations;

    expect(validations).toStrictEqual([
      {
        type: "custom",
        ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
      },
    ]);
    expect(Object.hasOwn(validations?.[0] ?? {}, "formula1")).toBe(false);
  });

  it("reads a CondFmt/CF group into ContentSheet.conditionalFormats, resolving its own dxf font colour through the icv fixed table (ExaDev/documents.js#1102) — workbook/conditional-format.test.ts covers the [MS-XLS] field mapping in full; this is the end-to-end proof from real bytes to ContentSheet", () => {
    // DXFN ([MS-XLS] 2.4.97): the 6-byte flags header (ibitAtrFnt at bit 26) then a 122-byte DXFFntD whose icvFore sits at byte offset 80 — every other byte is zero, since only the font colour is under test here.
    const fontBlock = new Array<number>(122).fill(0);
    const icvForeBytes = new Uint8Array(4);
    new DataView(icvForeBytes.buffer).setInt32(0, 0x02, true); // icv 2, Red — a fixed-table colour, no Palette record needed
    fontBlock.splice(80, 4, ...icvForeBytes);
    const dxf = [
      ...u32(1 << 26), // flags1: ibitAtrFnt only
      ...u16(0), // flags2: fIfmtUser unset
      ...fontBlock,
    ];

    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [
          {
            name: "Sheet1",
            records: [
              record(RECORD_CONDFMT, [
                ...u16(1), // ccf — one CF record follows
                ...u16(0), // fToughRecalc + nID, unused
                ...u16(0),
                ...u16(0),
                ...u16(0),
                ...u16(0), // refBound (Ref8U), unused
                ...u16(1), // one range
                ...u16(0),
                ...u16(0),
                ...u16(0),
                ...u16(0),
              ]),
              record(RECORD_CF, [
                0x01, // ct: comparison
                0x05, // cp: greaterThan
                ...u16(3), // cce1
                ...u16(0), // cce2
                ...dxf,
                0x1e,
                ...u16(10), // PtgInt 10
              ]),
            ],
          },
        ],
      }),
    );

    expect(readXlsContent(bytes).sheets[0]?.conditionalFormats).toStrictEqual([
      {
        type: "cellIs",
        operator: "greaterThan",
        formula1: "10",
        ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
        style: { textColor: { r: 1, g: 0, b: 0 } },
      },
    ]);
  });

  it("resolves to no style at all when a dxf's own fill pattern is FLSNULL, rather than a style object with nothing in it", () => {
    // DXFPat's own fls of 0 (FLSNULL) is a real, present fill block — ibitAtrPat is set, so raw.fill is a genuine object, not undefined — but resolveFillBackground has no pattern type for it and returns undefined, exactly like the "no font colour block at all" half of this style. Both halves resolving to undefined must still collapse the WHOLE style to undefined, not an empty {} object the schema has no field for.
    const dxf = [
      ...u32(1 << 29), // flags1: ibitAtrPat only
      ...u16(0), // flags2
      ...u32(0), // DXFPat: fls(FLSNULL)=0, both icvs irrelevant — the pattern lookup fails before either is read
    ];
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [
          {
            name: "Sheet1",
            records: [
              record(RECORD_CONDFMT, [
                ...u16(1),
                ...u16(0),
                ...u16(0),
                ...u16(0),
                ...u16(0),
                ...u16(0),
                ...u16(1),
                ...u16(0),
                ...u16(0),
                ...u16(0),
                ...u16(0),
              ]),
              record(RECORD_CF, [
                0x01,
                0x05,
                ...u16(3),
                ...u16(0),
                ...dxf,
                0x1e,
                ...u16(10),
              ]),
            ],
          },
        ],
      }),
    );

    expect(readXlsContent(bytes).sheets[0]?.conditionalFormats).toStrictEqual([
      {
        type: "cellIs",
        operator: "greaterThan",
        formula1: "10",
        ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
      },
    ]);
  });

  it("reads a CondFmt12/CF12 colour-scale rule into ContentSheet.conditionalFormats, resolving its own indexed colours through the icv fixed table (ExaDev/documents.js#1104) — workbook/conditional-format-12.test.ts covers the [MS-XLS] field mapping in full; this is the end-to-end proof from real bytes to ContentSheet", () => {
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [
          {
            name: "Sheet1",
            records: [
              record(RECORD_CONDFMT12, [
                ...new Array<number>(12).fill(0), // frtRefHeaderU
                ...u16(1), // ccf — one CF12 record follows
                ...u16(0), // fToughRecalc + nID, unused
                ...u16(0),
                ...u16(0),
                ...u16(0),
                ...u16(0), // refBound (Ref8U), unused
                ...u16(1), // one range
                ...u16(0),
                ...u16(0),
                ...u16(0),
                ...u16(0),
              ]),
              record(RECORD_CF12, [
                ...new Array<number>(12).fill(0), // frtRefHeader
                0x03, // ct: colour scale
                0x00, // cp
                ...u16(0), // cce1
                ...u16(0), // cce2
                ...u32(0), // cbDxf — MUST be zero for a colour scale rule
                ...u16(0), // fmlaActive cce
                0x00, // flags
                ...u16(0), // ipriority
                ...u16(0), // icfTemplate
                16, // cbTemplateParm
                ...new Array<number>(16).fill(0), // rgbTemplateParms
                // CFGradient: two stops, min (icv 2, Red) -> max (icv 3, Green)
                ...u16(0), // unused
                0x00, // reserved1
                2, // cInterpCurve
                2, // cGradientCurve
                0x03, // fClamp + fBackground
                0x02,
                ...u16(0),
                ...f64(0), // cfvo(min) + numDomain
                0x03,
                ...u16(0),
                ...f64(0), // cfvo(max) + numDomain
                ...f64(0),
                ...u32(0x00000001),
                ...u32(2),
                ...f64(0.5), // numGrange + CFColor(icv 2, Red, tint 0.5)
                ...f64(0),
                ...u32(0x00000001),
                ...u32(3),
                ...f64(0), // numGrange + CFColor(icv 3, Green, no tint)
              ]),
            ],
          },
        ],
      }),
    );

    expect(readXlsContent(bytes).sheets[0]?.conditionalFormats).toStrictEqual([
      {
        type: "colorScale",
        ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
        stops: [
          // A tint of 0.5 on the base Red lightens it toward white: Lum' = Lum*(1-tint)+tint.
          { value: { type: "min" }, color: { r: 1, g: 0.5, b: 0.5 } },
          { value: { type: "max" }, color: { r: 0, g: 1, b: 0 } },
        ],
        priority: 0,
      },
    ]);
  });

  it("reads a CondFmt12/CF12 top10 rule into ContentSheet.conditionalFormats (ExaDev/documents.js#1106) — workbook/conditional-format-12.test.ts covers the [MS-XLS] field mapping in full; this is the end-to-end proof from real bytes to ContentSheet", () => {
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [
          {
            name: "Sheet1",
            records: [
              record(RECORD_CONDFMT12, [
                ...new Array<number>(12).fill(0), // frtRefHeaderU
                ...u16(1), // ccf — one CF12 record follows
                ...u16(0), // fToughRecalc + nID, unused
                ...u16(0),
                ...u16(0),
                ...u16(0),
                ...u16(0), // refBound (Ref8U), unused
                ...u16(1), // one range
                ...u16(0),
                ...u16(0),
                ...u16(0),
                ...u16(0),
              ]),
              record(RECORD_CF12, [
                ...new Array<number>(12).fill(0), // frtRefHeader
                0x05, // ct: filter
                0x00, // cp
                ...u16(0), // cce1
                ...u16(0), // cce2
                ...u32(0), // cbDxf — MUST be zero for a filter rule
                ...u16(0), // fmlaActive cce
                0x00, // flags
                ...u16(0), // ipriority
                ...u16(0x0005), // icfTemplate: Filter (top10)
                16, // cbTemplateParm
                // CFExFilterParams: fTop=1, fPercent=0, iParam=5
                0x01,
                ...u16(5),
                ...new Array<number>(13).fill(0),
                // CFFilter (unread beyond its own declared length)
                ...u16(4),
                0,
                0,
                0,
                0,
              ]),
            ],
          },
        ],
      }),
    );

    expect(readXlsContent(bytes).sheets[0]?.conditionalFormats).toStrictEqual([
      {
        type: "top10",
        ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
        rank: 5,
        priority: 0,
      },
    ]);
  });

  it("materialises an empty anchor for a merged range whose top-left cell has no value", () => {
    // Merging in Excel keeps only the top-left value, so a range merged over empty cells has no value anywhere; dropping the anchor would lose the merge entirely.
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [
          {
            name: "Sheet1",
            records: [
              record(RECORD_MERGECELLS, [
                ...u16(1),
                ...u16(2),
                ...u16(3),
                ...u16(1),
                ...u16(1),
              ]),
            ],
          },
        ],
      }),
    );

    expect(readXlsContent(bytes).sheets[0]?.cells).toStrictEqual([
      {
        row: 2,
        column: 1,
        value: { kind: "empty" },
        displayText: "",
        rowSpan: 2,
      },
    ]);
  });

  it("skips a chart sheet, which carries no cell table for a ContentSheet to hold", () => {
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [
          { name: "Data", records: [] },
          { name: "Chart1", records: [], sheetType: 0x02 },
          { name: "Macro1", records: [], sheetType: 0x01 },
        ],
      }),
    );

    expect(
      readXlsContent(bytes).sheets.map((sheet) => sheet.name),
    ).toStrictEqual(["Data"]);
  });

  it("emits print settings the schema requires even though the file's own are not read", () => {
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [{ name: "Sheet1", records: [] }],
      }),
    );

    const settings = readXlsContent(bytes).sheets[0]?.printSettings;

    expect(settings?.pageOrder).toBe("downThenOver");
    expect(settings?.margins.topPt).toBeCloseTo(54);
  });
});
