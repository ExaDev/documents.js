import {
  createXorObfuscationArray,
  createXorObfuscationKey,
  createXorObfuscationPasswordVerifier,
  decryptOfficeRc4,
  decryptXorObfuscationMethod1,
  deriveOfficeRc4BaseHash,
  md5,
  readCompoundFile,
  writeCompoundFile,
  writeSummaryInformationStream,
  XOR_OBFUSCATION_ARRAY_LENGTH,
  XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD1,
} from "archive-codec";
import { ContentDocumentSchema, DocumentTreeSchema } from "document-schema.js";
import { describe, expect, it } from "vitest";

import {
  BOF_TYPE_WORKBOOK,
  BOF_TYPE_WORKSHEET,
  RECORD_BLANK,
  RECORD_BOF,
  RECORD_FONT,
  RECORD_BOOLERR,
  RECORD_BOUNDSHEET8,
  RECORD_CF,
  RECORD_CF12,
  RECORD_CONDFMT,
  RECORD_CONDFMT12,
  RECORD_DATE1904,
  RECORD_DV,
  RECORD_EOF,
  RECORD_EXTERNSHEET,
  RECORD_FILEPASS,
  RECORD_FORMAT,
  RECORD_FORMULA,
  RECORD_COLINFO,
  RECORD_HORIZONTALPAGEBREAKS,
  RECORD_LABELSST,
  RECORD_LBL,
  RECORD_LEFTMARGIN,
  RECORD_MERGECELLS,
  RECORD_MSODRAWING,
  RECORD_MSODRAWINGGROUP,
  RECORD_NUMBER,
  RECORD_PALETTE,
  RECORD_PRINTGRID,
  RECORD_PRINTROWCOL,
  RECORD_ROW,
  RECORD_SETUP,
  RECORD_SST,
  RECORD_SUPBOOK,
  RECORD_VERTICALPAGEBREAKS,
  RECORD_WSBOOL,
  RECORD_XF,
} from "./biff/record-types";
import { BiffFormatError } from "./biff/records";
import { isXlsFile } from "./container";
import { readXls, readXlsContent } from "./content";
import {
  bofData,
  cell,
  cellXfTrailer,
  concat,
  f64,
  noteObjRecord,
  noteRecord,
  noteTxoRecords,
  otherObjRecord,
  record,
  richExtendedString,
  shortXlUnicodeString,
  u16,
  u32,
  xlUnicodeString,
  type XfTestDecoration,
} from "./test-support/biff";
import { compoundFile } from "./test-support/cfb";
import {
  bseEntry,
  clientAnchorSheet,
  embeddedBlip,
  escherAtom,
  escherContainer,
  foptEntry,
  optAtom,
  spAtom,
} from "./test-support/escher";

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
  // Built in two passes, because BoundSheet8's lbPlyPos has to name a byte offset that only exists once the globals substream's own length is known -- and that length depends on the BoundSheet8 records themselves. The first pass measures with placeholder offsets, the second writes the real ones; both produce identically sized records, so the measurement holds.
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

/** Adds a real "\x05SummaryInformation" stream beside an .xls file's existing streams -- composed with archive-codec's own writeSummaryInformationStream/writeCompoundFile rather than by extending xlsFile, which stays a pure BIFF8-only fixture builder. */
function withSummaryInformation(
  xls: Uint8Array<ArrayBuffer>,
  metadata: Parameters<typeof writeSummaryInformationStream>[0],
): Uint8Array<ArrayBuffer> {
  return writeCompoundFile([
    ...readCompoundFile(xls),
    {
      path: "\x05SummaryInformation",
      bytes: writeSummaryInformationStream(metadata),
    },
  ]);
}

/** The fifteen style XFs a real file writes before its first cell XF, so a cell's own ixfe of 15 lands on the first cell format -- which is what [MS-XLS] 2.5.168 requires of an ixfe. Every cell XF here carries an undecorated trailing payload; xfTableWithDecoration below is the sibling a decoration test builds its own cell XF through instead. */
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

/** As xfTable, but the single cell XF this builds carries the given decoration rather than an undecorated payload -- for a test exercising background/borders. */
function xfTableWithDecoration(
  formatId: number,
  decoration: XfTestDecoration,
): Uint8Array<ArrayBuffer>[] {
  const styles = Array.from({ length: 15 }, () =>
    record(RECORD_XF, [
      ...u16(0),
      ...u16(0),
      ...u16(0x0004),
      ...cellXfTrailer(),
    ]),
  );
  return [
    ...styles,
    record(RECORD_XF, [
      ...u16(0),
      ...u16(formatId),
      ...u16(0),
      ...cellXfTrailer(decoration),
    ]),
  ];
}

/** A Font record ([MS-XLS] 2.4.122) with an uncompressed fontName -- the record's own "fontName.fHighByte MUST equal 1" rule -- for a test driving the per-cell font reader. Every field left absent carries the spec's own default shape (Arial at 10pt/200 twips, no flags, Automatic colour, normal weight, no underline). */
function fontRecord(options: {
  name?: string;
  heightTwips?: number;
  bold?: boolean;
  italic?: boolean;
  strikeout?: boolean;
  underline?: boolean;
  colorIcv?: number;
}): Uint8Array<ArrayBuffer> {
  const name = options.name ?? "Arial";
  const nameBytes: number[] = [name.length, 0x01];
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index);
    nameBytes.push(code & 0xff, code >> 8);
  }
  return record(RECORD_FONT, [
    ...u16(options.heightTwips ?? 200),
    ...u16((options.italic ? 0x0002 : 0) | (options.strikeout ? 0x0008 : 0)),
    ...u16(options.colorIcv ?? 0x7fff),
    ...u16(options.bold ? 700 : 400),
    ...u16(0), // sss: normal script
    options.underline ? 0x01 : 0x00,
    0x02, // bFamily: Swiss, Arial's own classification
    0x00, // bCharSet: ANSI
    0, // unused3
    ...nameBytes,
  ]);
}

/** As xfTable, but the single cell XF this builds references the given font index rather than font 0 -- for a test exercising per-cell fonts. */
function xfTableWithFont(
  fontIndex: number,
  formatId: number,
): Uint8Array<ArrayBuffer>[] {
  const styles = Array.from({ length: 15 }, () =>
    record(RECORD_XF, [
      ...u16(0),
      ...u16(0),
      ...u16(0x0004),
      ...cellXfTrailer(),
    ]),
  );
  return [
    ...styles,
    record(RECORD_XF, [
      ...u16(fontIndex),
      ...u16(formatId),
      ...u16(0),
      ...cellXfTrailer(),
    ]),
  ];
}

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
    expect(content.sheets.map((sheet) => sheet.name)).toEqual([
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

    expect(content.sheets[0]?.cells[0]?.value).toEqual({
      kind: "number",
      value: 11,
    });
    expect(content.sheets[1]?.cells[0]?.value).toEqual({
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

    expect(readXlsContent(bytes).sheets[0]?.cells[0]).toEqual({
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

    expect(readXlsContent(bytes).sheets[0]?.cells[0]?.value).toEqual({
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

    expect(readXlsContent(bytes).sheets[0]?.cells[0]?.value).toEqual({
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

    expect(readXlsContent(bytes).sheets[0]?.cells[0]?.value).toEqual({
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

    expect(readXlsContent(bytes).sheets[0]?.cells[0]?.value).toEqual({
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

  it("reads a Dv record into ContentSheet.dataValidations (ExaDev/documents.js#1098) -- workbook/data-validation.test.ts covers the [MS-XLS] field mapping in full; this is the end-to-end proof from real bytes to ContentSheet", () => {
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
                ...u16(0), // formula2's own unused field -- DVParsedFormula always carries it, even when cce is 0
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

    expect(readXlsContent(bytes).sheets[0]?.dataValidations).toEqual([
      {
        type: "decimal",
        operator: "greaterThan",
        formula1: "0",
        ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
      },
    ]);
  });

  it("reads a CondFmt/CF group into ContentSheet.conditionalFormats, resolving its own dxf font colour through the icv fixed table (ExaDev/documents.js#1102) -- workbook/conditional-format.test.ts covers the [MS-XLS] field mapping in full; this is the end-to-end proof from real bytes to ContentSheet", () => {
    // DXFN ([MS-XLS] 2.4.97): the 6-byte flags header (ibitAtrFnt at bit 26) then a 122-byte DXFFntD whose icvFore sits at byte offset 80 -- every other byte is zero, since only the font colour is under test here.
    const fontBlock = new Array<number>(122).fill(0);
    const icvForeBytes = new Uint8Array(4);
    new DataView(icvForeBytes.buffer).setInt32(0, 0x02, true); // icv 2, Red -- a fixed-table colour, no Palette record needed
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
                ...u16(1), // ccf -- one CF record follows
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

    expect(readXlsContent(bytes).sheets[0]?.conditionalFormats).toEqual([
      {
        type: "cellIs",
        operator: "greaterThan",
        formula1: "10",
        ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
        style: { textColor: { r: 1, g: 0, b: 0 } },
      },
    ]);
  });

  it("reads a CondFmt12/CF12 colour-scale rule into ContentSheet.conditionalFormats, resolving its own indexed colours through the icv fixed table (ExaDev/documents.js#1104) -- workbook/conditional-format-12.test.ts covers the [MS-XLS] field mapping in full; this is the end-to-end proof from real bytes to ContentSheet", () => {
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [
          {
            name: "Sheet1",
            records: [
              record(RECORD_CONDFMT12, [
                ...new Array<number>(12).fill(0), // frtRefHeaderU
                ...u16(1), // ccf -- one CF12 record follows
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
                ...u32(0), // cbDxf -- MUST be zero for a colour scale rule
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

    expect(readXlsContent(bytes).sheets[0]?.conditionalFormats).toEqual([
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

  it("reads a CondFmt12/CF12 top10 rule into ContentSheet.conditionalFormats (ExaDev/documents.js#1106) -- workbook/conditional-format-12.test.ts covers the [MS-XLS] field mapping in full; this is the end-to-end proof from real bytes to ContentSheet", () => {
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [
          {
            name: "Sheet1",
            records: [
              record(RECORD_CONDFMT12, [
                ...new Array<number>(12).fill(0), // frtRefHeaderU
                ...u16(1), // ccf -- one CF12 record follows
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
                ...u32(0), // cbDxf -- MUST be zero for a filter rule
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

    expect(readXlsContent(bytes).sheets[0]?.conditionalFormats).toEqual([
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

    expect(readXlsContent(bytes).sheets[0]?.cells).toEqual([
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

    expect(readXlsContent(bytes).sheets.map((sheet) => sheet.name)).toEqual([
      "Data",
    ]);
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

  describe("RC4-encrypted workbooks", () => {
    const PASSWORD = "correct horse";
    const SALT = new Uint8Array(16).map((_, index) => index * 7 + 1);
    const FILEPASS_HEADER_LENGTH = 2 + 2 + 2 + 16 + 16 + 16;

    // [MS-XLS] 2.2.10's own excluded-record set and the BoundSheet8 lbPlyPos exception, re-derived here independently of workbook/encryption.ts rather than imported from it -- so a round trip through readXlsContent actually exercises that module's own understanding of the spec, rather than a test built from its own exclusion list vacuously agreeing with itself.
    const NEVER_ENCRYPTED_TYPES = new Set([
      RECORD_BOF,
      RECORD_FILEPASS,
      0x0194, // UsrExcl
      0x0195, // FileLock
      0x00e1, // InterfaceHdr
      0x0196, // RRDInfo
      0x0138, // RRDHead
    ]);

    /** Parses a stream's own records with their absolute offsets, independently of biff/records.ts, for the same reason above. */
    function parseForEncryption(stream: Uint8Array<ArrayBuffer>): {
      type: number;
      offset: number;
      data: Uint8Array<ArrayBuffer>;
    }[] {
      const view = new DataView(
        stream.buffer,
        stream.byteOffset,
        stream.byteLength,
      );
      const records = [];
      let offset = 0;
      while (offset < stream.length) {
        const type = view.getUint16(offset, true);
        const size = view.getUint16(offset + 2, true);
        const dataStart = offset + 4;
        records.push({
          type,
          offset,
          data: stream.slice(dataStart, dataStart + size),
        });
        offset = dataStart + size;
      }
      return records;
    }

    /**
     * Takes a plaintext workbook stream already carrying a same-length FilePass placeholder record (so every BoundSheet8 lbPlyPos workbookStream computed already accounts for its real size) and turns it into a genuinely RC4-encrypted one: real FilePass header fields in place of the placeholder, and every other record's data encrypted per [MS-XLS] 2.2.10's own rules. RC4's XOR symmetry makes "encrypt" and "decrypt" literally the same operation, so this reuses decryptOfficeRc4 -- the same primitive readXlsContent decrypts with -- rather than a separate encryption routine; the two directions cancelling out is exactly what makes RC4 what it is, not a shortcut that only looks like a round trip.
     */
    function encryptWorkbookStream(
      plainStreamWithPlaceholder: Uint8Array<ArrayBuffer>,
      password: string,
      salt: Uint8Array<ArrayBuffer>,
    ): Uint8Array<ArrayBuffer> {
      const baseHash = deriveOfficeRc4BaseHash(password, salt);
      const verifier = new Uint8Array(16).map((_, index) => index * 3 + 11);
      const verifierHash = md5(verifier);
      const encryptedVerifier = decryptOfficeRc4(baseHash, 0, verifier);
      const encryptedVerifierHash = decryptOfficeRc4(
        baseHash,
        16,
        verifierHash,
      );
      const filePassData = new Uint8Array(FILEPASS_HEADER_LENGTH);
      const filePassView = new DataView(filePassData.buffer);
      filePassView.setUint16(0, 0x0001, true); // wEncryptionType: RC4
      filePassView.setUint16(2, 1, true); // vMajor
      filePassView.setUint16(4, 1, true); // vMinor
      filePassData.set(salt, 6);
      filePassData.set(encryptedVerifier, 22);
      filePassData.set(encryptedVerifierHash, 38);

      const parts: Uint8Array<ArrayBuffer>[] = [];
      for (const rec of parseForEncryption(plainStreamWithPlaceholder)) {
        let data: Uint8Array<ArrayBuffer>;
        if (rec.type === RECORD_FILEPASS) {
          data = filePassData;
        } else if (NEVER_ENCRYPTED_TYPES.has(rec.type)) {
          data = rec.data;
        } else if (rec.type === RECORD_BOUNDSHEET8) {
          const lbPlyPos = rec.data.subarray(0, 4);
          const rest = decryptOfficeRc4(
            baseHash,
            rec.offset + 4 + 4,
            rec.data.subarray(4),
          );
          data = new Uint8Array(rec.data.length);
          data.set(lbPlyPos, 0);
          data.set(rest, 4);
        } else {
          data = decryptOfficeRc4(baseHash, rec.offset + 4, rec.data);
        }
        parts.push(record(rec.type, [...data]));
      }
      return concat(...parts);
    }

    function encryptedXlsFile(
      globals: readonly Uint8Array<ArrayBuffer>[],
      sheets: Parameters<typeof workbookStream>[0]["sheets"],
      password = PASSWORD,
      salt = SALT,
    ): Uint8Array<ArrayBuffer> {
      const placeholder = record(
        RECORD_FILEPASS,
        new Array<number>(FILEPASS_HEADER_LENGTH).fill(0),
      );
      const plain = workbookStream({
        globals: [placeholder, ...globals],
        sheets,
      });
      return xlsFile(encryptWorkbookStream(plain, password, salt));
    }

    it("refuses an encrypted workbook when no password is given", () => {
      const bytes = encryptedXlsFile(xfTable(0), [
        { name: "Sheet1", records: [] },
      ]);

      expect(() => readXlsContent(bytes)).toThrow(BiffFormatError);
    });

    it("refuses an encrypted workbook given the wrong password", () => {
      const bytes = encryptedXlsFile(xfTable(0), [
        { name: "Sheet1", records: [] },
      ]);

      expect(() => readXlsContent(bytes, "the wrong password")).toThrow(
        BiffFormatError,
      );
    });

    it("decrypts an encrypted workbook given the correct password", () => {
      const bytes = encryptedXlsFile(xfTable(0), [
        {
          name: "Sheet1",
          records: [record(RECORD_NUMBER, [...cell(0, 0), ...f64(42)])],
        },
      ]);

      const content = readXlsContent(bytes, PASSWORD);

      expect(content.sheets[0]?.name).toBe("Sheet1");
      expect(content.sheets[0]?.cells[0]).toMatchObject({
        row: 0,
        column: 0,
        value: { kind: "number", value: 42 },
      });
    });

    it("decrypts correctly across a 1024-byte RC4 block boundary", () => {
      // A run of NUMBER records padding the sheet substream well past the first 1024-byte block, so the sheet's later cells only decrypt correctly if decryptOfficeRc4's per-block re-keying is wired up right, not just its first block.
      const paddingCells = Array.from({ length: 80 }, (_, index) =>
        record(RECORD_NUMBER, [...cell(index, 0), ...f64(index)]),
      );
      const bytes = encryptedXlsFile(xfTable(0), [
        {
          name: "Sheet1",
          records: [
            ...paddingCells,
            record(RECORD_NUMBER, [...cell(80, 0), ...f64(999)]),
          ],
        },
      ]);

      const content = readXlsContent(bytes, PASSWORD);

      expect(content.sheets[0]?.cells[0]).toMatchObject({
        value: { kind: "number", value: 0 },
      });
      expect(content.sheets[0]?.cells[80]).toMatchObject({
        value: { kind: "number", value: 999 },
      });
    });
  });

  describe("XOR-obfuscated workbooks", () => {
    const PASSWORD = "123456789012345";
    const FILEPASS_HEADER_LENGTH = 2 + 2 + 2;

    // Re-derived independently of workbook/encryption.ts, same rationale as the RC4 suite above.
    const NEVER_ENCRYPTED_TYPES = new Set([
      RECORD_BOF,
      RECORD_FILEPASS,
      0x0194, // UsrExcl
      0x0195, // FileLock
      0x00e1, // InterfaceHdr
      0x0196, // RRDInfo
      0x0138, // RRDHead
    ]);

    /** Parses a stream's own records with their absolute offsets, independently of biff/records.ts -- shares the RC4 suite's own approach above, but duplicated locally since that one is scoped inside the sibling describe block. */
    function parseForEncryption(stream: Uint8Array<ArrayBuffer>): {
      type: number;
      offset: number;
      data: Uint8Array<ArrayBuffer>;
    }[] {
      const view = new DataView(
        stream.buffer,
        stream.byteOffset,
        stream.byteLength,
      );
      const records = [];
      let offset = 0;
      while (offset < stream.length) {
        const type = view.getUint16(offset, true);
        const size = view.getUint16(offset + 2, true);
        const dataStart = offset + 4;
        records.push({
          type,
          offset,
          data: stream.slice(dataStart, dataStart + size),
        });
        offset = dataStart + size;
      }
      return records;
    }

    /** [MS-XLS] 2.2.10's own XorArrayIndex rule, matching workbook/encryption.ts's own xorArrayIndexFor -- re-derived here rather than imported, same rationale as the RC4 suite's own encryptWorkbookStream. */
    function xorArrayIndexFor(
      spanOffset: number,
      recordDataLength: number,
    ): number {
      return (spanOffset + recordDataLength) % XOR_OBFUSCATION_ARRAY_LENGTH;
    }

    /**
     * Method 1's own encrypt direction: the inverse of decryptXorObfuscationMethod1's rotate-then-XOR (XOR first, then rotate right 3) -- independently derived and confirmed (in a scratch script, not against this package's own code) to reproduce a genuine Excel-generated XOR-obfuscated fixture's exact ciphertext byte for byte (nolze/msoffcrypto-tool's own tests/inputs/xor_password_123456789012345.xls; see archive-codec's own crypto/xor-obfuscation.test.ts, whose "decrypts a real Excel-generated BoundSheet8 span" vector is lifted from that same file). Method 1's transform is not self-inverse the way Method 2's is, so unlike the RC4 suite's own encryptWorkbookStream (which reuses the decrypt primitive directly), this needs its own, separate direction -- kept local to this test file rather than exported from archive-codec, which implements no encrypt direction at all (see xor-obfuscation.ts's own top comment).
     */
    function encryptXorObfuscationMethod1(
      array: Uint8Array<ArrayBuffer>,
      data: Uint8Array<ArrayBuffer>,
      initialIndex: number,
    ): Uint8Array<ArrayBuffer> {
      const out = new Uint8Array(data.length);
      const dataView = new DataView(
        data.buffer,
        data.byteOffset,
        data.byteLength,
      );
      const arrayView = new DataView(
        array.buffer,
        array.byteOffset,
        array.byteLength,
      );
      let index = initialIndex % XOR_OBFUSCATION_ARRAY_LENGTH;
      for (let i = 0; i < data.length; i += 1) {
        const withKey = dataView.getUint8(i) ^ arrayView.getUint8(index);
        out[i] = ((withKey >>> 3) | (withKey << 5)) & 0xff;
        index = (index + 1) % XOR_OBFUSCATION_ARRAY_LENGTH;
      }
      return out;
    }

    /** Takes a plaintext workbook stream already carrying a same-length FilePass placeholder record and turns it into a genuinely XOR-obfuscated one: real FilePass header fields (key/verificationBytes) in place of the placeholder, and every other record's data obfuscated per [MS-XLS] 2.2.10's own rules. */
    function obfuscateWorkbookStream(
      plainStreamWithPlaceholder: Uint8Array<ArrayBuffer>,
      password: string,
    ): Uint8Array<ArrayBuffer> {
      const array = createXorObfuscationArray(
        password,
        XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD1,
      );
      const filePassData = new Uint8Array(FILEPASS_HEADER_LENGTH);
      const filePassView = new DataView(filePassData.buffer);
      filePassView.setUint16(0, 0x0000, true); // wEncryptionType: XOR obfuscation
      filePassView.setUint16(2, createXorObfuscationKey(password), true);
      filePassView.setUint16(
        4,
        createXorObfuscationPasswordVerifier(password),
        true,
      );

      const parts: Uint8Array<ArrayBuffer>[] = [];
      for (const rec of parseForEncryption(plainStreamWithPlaceholder)) {
        let data: Uint8Array<ArrayBuffer>;
        if (rec.type === RECORD_FILEPASS) {
          data = filePassData;
        } else if (NEVER_ENCRYPTED_TYPES.has(rec.type)) {
          data = rec.data;
        } else if (rec.type === RECORD_BOUNDSHEET8) {
          const lbPlyPos = rec.data.subarray(0, 4);
          const spanOffset = rec.offset + 4 + 4;
          const rest = encryptXorObfuscationMethod1(
            array,
            rec.data.subarray(4),
            xorArrayIndexFor(spanOffset, rec.data.length),
          );
          data = new Uint8Array(rec.data.length);
          data.set(lbPlyPos, 0);
          data.set(rest, 4);
        } else {
          const spanOffset = rec.offset + 4;
          data = encryptXorObfuscationMethod1(
            array,
            rec.data,
            xorArrayIndexFor(spanOffset, rec.data.length),
          );
        }
        parts.push(record(rec.type, [...data]));
      }
      return concat(...parts);
    }

    function obfuscatedXlsFile(
      globals: readonly Uint8Array<ArrayBuffer>[],
      sheets: Parameters<typeof workbookStream>[0]["sheets"],
      password = PASSWORD,
    ): Uint8Array<ArrayBuffer> {
      const placeholder = record(
        RECORD_FILEPASS,
        new Array<number>(FILEPASS_HEADER_LENGTH).fill(0),
      );
      const plain = workbookStream({
        globals: [placeholder, ...globals],
        sheets,
      });
      return xlsFile(obfuscateWorkbookStream(plain, password));
    }

    it("refuses an obfuscated workbook when no password is given", () => {
      const bytes = obfuscatedXlsFile(xfTable(0), [
        { name: "Sheet1", records: [] },
      ]);

      expect(() => readXlsContent(bytes)).toThrow(BiffFormatError);
    });

    it("refuses an obfuscated workbook given the wrong password", () => {
      const bytes = obfuscatedXlsFile(xfTable(0), [
        { name: "Sheet1", records: [] },
      ]);

      expect(() => readXlsContent(bytes, "the wrong password")).toThrow(
        BiffFormatError,
      );
    });

    it("decrypts an obfuscated workbook given the correct password", () => {
      const bytes = obfuscatedXlsFile(xfTable(0), [
        {
          name: "Sheet1",
          records: [record(RECORD_NUMBER, [...cell(0, 0), ...f64(42)])],
        },
      ]);

      const content = readXlsContent(bytes, PASSWORD);

      expect(content.sheets[0]?.name).toBe("Sheet1");
      expect(content.sheets[0]?.cells[0]).toMatchObject({
        row: 0,
        column: 0,
        value: { kind: "number", value: 42 },
      });
    });

    it("decrypts correctly across the 16-byte XorArrayIndex period, across several records", () => {
      // A run of NUMBER records long enough to cycle the 16-byte obfuscation array several times over, so a later cell only decrypts correctly if the per-record XorArrayIndex ((streamOffset + recordDataLength) % 16) is recomputed for every record rather than assumed constant.
      const paddingCells = Array.from({ length: 40 }, (_, index) =>
        record(RECORD_NUMBER, [...cell(index, 0), ...f64(index)]),
      );
      const bytes = obfuscatedXlsFile(xfTable(0), [
        {
          name: "Sheet1",
          records: [
            ...paddingCells,
            record(RECORD_NUMBER, [...cell(40, 0), ...f64(999)]),
          ],
        },
      ]);

      const content = readXlsContent(bytes, PASSWORD);

      expect(content.sheets[0]?.cells[0]).toMatchObject({
        value: { kind: "number", value: 0 },
      });
      expect(content.sheets[0]?.cells[40]).toMatchObject({
        value: { kind: "number", value: 999 },
      });
    });

    it("decrypts a real Excel-generated XOR-obfuscated BoundSheet8 span using the shared archive-codec primitive directly", () => {
      // The same real ciphertext vector archive-codec's own crypto/xor-obfuscation.test.ts verifies -- exercised again here to confirm xls-codec's own re-export/import wiring reaches the identical, real-file-validated result, not just archive-codec's own internal test.
      const array = createXorObfuscationArray(
        "123456789012345",
        XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD1,
      );
      const ciphertext = Uint8Array.from(Buffer.from("5b28fc2ade6d5d", "hex"));
      const plaintext = decryptXorObfuscationMethod1(array, ciphertext, 13);
      expect(new TextDecoder().decode(plaintext.subarray(4))).toBe("420");
    });
  });

  it("refuses a compound file holding no Workbook stream", () => {
    const bytes = compoundFile([
      { path: "WordDocument", bytes: new Uint8Array([1, 2, 3]) },
    ]);

    expect(() => readXlsContent(bytes)).toThrow(BiffFormatError);
  });

  it("refuses bytes that are not a compound file at all", () => {
    expect(() =>
      readXlsContent(new Uint8Array([0x50, 0x4b, 0x03, 0x04])),
    ).toThrow(BiffFormatError);
  });

  describe("cell decoration", () => {
    /** A single populated cell (icv 10, the default palette's own duplicate of Red -- [MS-XLS] "Icv"'s own default-red/green/blue table) so a decoration test only needs to build the globals substream's own XF table, not a whole worksheet's cell records. */
    function decoratedCellDocument(
      decoration: XfTestDecoration,
      globalsExtra: readonly Uint8Array<ArrayBuffer>[] = [],
    ): Uint8Array<ArrayBuffer> {
      return xlsFile(
        workbookStream({
          globals: [...xfTableWithDecoration(0, decoration), ...globalsExtra],
          sheets: [
            {
              name: "Sheet1",
              records: [record(RECORD_NUMBER, [...cell(0, 0, 15), ...f64(1)])],
            },
          ],
        }),
      );
    }

    it("keeps a Blank cell whose own XF carries real decoration", () => {
      // The case a producer writes a Blank record FOR: the cell holds no value, and its fill and borders are the only thing it has to say -- so dropping it as "shows nothing" discards exactly what the record was written to carry. Two XFs here so the decorated one is not also the sheet's default: index 15 undecorated, index 16 carrying the fill and a thin top border.
      const bytes = xlsFile(
        workbookStream({
          globals: [
            ...xfTable(0),
            record(RECORD_XF, [
              ...u16(0),
              ...u16(0),
              ...u16(0),
              ...cellXfTrailer({
                fillPattern: 1,
                fillForegroundIcv: 10,
                top: { style: 1, icv: 12 },
              }),
            ]),
          ],
          sheets: [
            {
              name: "Sheet1",
              records: [record(RECORD_BLANK, cell(3, 4, 16))],
            },
          ],
        }),
      );

      const cells = readXlsContent(bytes).sheets[0]?.cells ?? [];

      expect(cells).toHaveLength(1);
      expect(cells[0]).toMatchObject({
        row: 3,
        column: 4,
        value: { kind: "empty" },
        displayText: "",
      });
      // icv 10 is the default table's own Red, icv 12 its own Blue.
      expect(cells[0]?.background).toEqual({
        kind: "solid",
        color: { r: 1, g: 0, b: 0 },
      });
      expect(cells[0]?.borders).toEqual({
        top: { color: { r: 0, g: 0, b: 1 }, widthPt: 0.75 },
      });
    });

    it("still drops a Blank cell whose XF resolves to no decoration this reader can express", () => {
      // 0x13 is a reserved FillPattern value past FLSGRAY0625 (0x12), the last one [MS-XLS]/[MS-XLSB]'s own enumeration names -- it resolves to no background at all (see the test below), and no side carries a border, so this Blank has nothing to show after resolution and stays dropped, exactly as an undecorated one does.
      const RESERVED_FILL_PATTERN = 0x13;
      const bytes = xlsFile(
        workbookStream({
          globals: xfTableWithDecoration(0, {
            fillPattern: RESERVED_FILL_PATTERN,
            fillForegroundIcv: 10,
          }),
          sheets: [
            {
              name: "Sheet1",
              records: [record(RECORD_BLANK, cell(3, 4))],
            },
          ],
        }),
      );

      expect(readXlsContent(bytes).sheets[0]?.cells).toHaveLength(0);
    });

    it("reads a solid fill's own foreground colour as a solid background, through the default palette", () => {
      // icv 10: the default table's own duplicate of Red (rgColor[2], [MS-XLS] "Icv") -- resolvable with no Palette record present at all.
      const bytes = decoratedCellDocument({
        fillPattern: 1,
        fillForegroundIcv: 10,
      });
      expect(readXlsContent(bytes).sheets[0]?.cells[0]?.background).toEqual({
        kind: "solid",
        color: { r: 1, g: 0, b: 0 },
      });
    });

    it("maps a genuine two-colour pattern fill instead of dropping it (ExaDev/documents.js#951)", () => {
      // fls=2 is FLSMEDGRAY, 50% gray ([MS-XLS]/[MS-XLSB] FillPattern) -- ContentCellPatternType's own 'mediumGray'.
      const bytes = decoratedCellDocument({
        fillPattern: 2,
        fillForegroundIcv: 10, // default Red
        fillBackgroundIcv: 11, // default Green
      });
      expect(readXlsContent(bytes).sheets[0]?.cells[0]?.background).toEqual({
        kind: "pattern",
        patternType: "mediumGray",
        foregroundColor: { r: 1, g: 0, b: 0 },
        backgroundColor: { r: 0, g: 1, b: 0 },
      });
    });

    it("does not map a background for a reserved FillPattern value past FLSGRAY0625", () => {
      const RESERVED_FILL_PATTERN = 0x13;
      const bytes = decoratedCellDocument({
        fillPattern: RESERVED_FILL_PATTERN,
        fillForegroundIcv: 10,
      });
      expect(
        readXlsContent(bytes).sheets[0]?.cells[0]?.background,
      ).toBeUndefined();
    });

    it("reads per-side border style and colour from the CellXF payload", () => {
      // style 1 = THIN (solid, thin weight); style 3 = DASHED (dashed pattern, thin weight) -- [MS-XLS] BorderStyle.
      const bytes = decoratedCellDocument({
        left: { style: 1, icv: 12 }, // icv 12: default Blue
        top: { style: 3, icv: 11 }, // icv 11: default Green
      });
      expect(readXlsContent(bytes).sheets[0]?.cells[0]?.borders).toEqual({
        left: { color: { r: 0, g: 0, b: 1 }, widthPt: 0.75 },
        top: { color: { r: 0, g: 1, b: 0 }, widthPt: 0.75, style: "dashed" },
      });
    });

    it("leaves borders undefined for a cell with no border on any side", () => {
      const bytes = decoratedCellDocument({
        fillPattern: 1,
        fillForegroundIcv: 10,
      });
      expect(
        readXlsContent(bytes).sheets[0]?.cells[0]?.borders,
      ).toBeUndefined();
    });

    it("resolves a fill/border colour through a real Palette record when one is present", () => {
      // A custom colour at icv 8 (rgColor[0]) that does NOT match the default table's own entry there (black) -- proving this reads the file's own Palette rather than falling back to the default.
      const customOrange = [0xff, 0x80, 0x00, 0x00];
      const paletteEntries = [
        customOrange,
        ...Array.from({ length: 55 }, () => [0x00, 0x00, 0x00, 0x00]),
      ];
      const bytes = decoratedCellDocument(
        { fillPattern: 1, fillForegroundIcv: 8 },
        [
          record(RECORD_PALETTE, [
            ...u16(paletteEntries.length),
            ...paletteEntries.flat(),
          ]),
        ],
      );
      expect(readXlsContent(bytes).sheets[0]?.cells[0]?.background).toEqual({
        kind: "solid",
        color: { r: 1, g: 128 / 255, b: 0 },
      });
    });
  });

  describe("cell fonts", () => {
    it("reads a cell's own font as the properties that differ from the workbook's default font", () => {
      // Font 0 is the workbook's Normal font (Arial, 10pt, no flags, Automatic colour); font 1 differs from it in every property ContentSheetCell.font carries, so the cell resolves to one ContentFont naming each difference and restating nothing the default already settles.
      const bytes = xlsFile(
        workbookStream({
          globals: [
            fontRecord({}),
            fontRecord({
              name: "Courier New",
              heightTwips: 240,
              bold: true,
              italic: true,
              strikeout: true,
              underline: true,
              colorIcv: 10,
            }),
            ...xfTableWithFont(1, 0),
          ],
          sheets: [
            {
              name: "Sheet1",
              records: [record(RECORD_NUMBER, [...cell(0, 0, 15), ...f64(1)])],
            },
          ],
        }),
      );

      expect(readXlsContent(bytes).sheets[0]?.cells[0]?.font).toEqual({
        bold: true,
        italic: true,
        underline: true,
        strike: true,
        fontFamily: "Courier New",
        sizePt: 12,
        // icv 10 is the default palette's own duplicate of Red, exactly as the fill tests resolve it.
        color: { r: 1, g: 0, b: 0 },
      });
    });

    it("states no font for a cell whose XF resolves to the workbook's own default font", () => {
      // BIFF8 gives a cell no way to say "no font", only an index into the font table -- a cell naming entry 0, the Normal style's font, is stating the default, which the schema models as the field being absent rather than a restated copy of it.
      const bytes = xlsFile(
        workbookStream({
          globals: [fontRecord({}), ...xfTableWithFont(0, 0)],
          sheets: [
            {
              name: "Sheet1",
              records: [record(RECORD_NUMBER, [...cell(0, 0, 15), ...f64(1)])],
            },
          ],
        }),
      );

      expect(readXlsContent(bytes).sheets[0]?.cells[0]?.font).toBeUndefined();
    });

    it("keeps a Blank cell whose only formatting is a font that differs from the default", () => {
      const bytes = xlsFile(
        workbookStream({
          globals: [
            fontRecord({}),
            fontRecord({ bold: true }),
            ...xfTableWithFont(1, 0),
          ],
          sheets: [
            {
              name: "Sheet1",
              records: [record(RECORD_BLANK, cell(3, 4, 15))],
            },
          ],
        }),
      );

      const cells = readXlsContent(bytes).sheets[0]?.cells ?? [];
      expect(cells).toHaveLength(1);
      expect(cells[0]).toMatchObject({
        row: 3,
        column: 4,
        value: { kind: "empty" },
        font: { bold: true },
      });
    });

    it("still drops a Blank cell whose font differs from the default only in a colour this reader cannot resolve", () => {
      // The cell font's icv (Automatic, 0x7FFF) differs from the default's (icv 10), but Automatic has no fixed RGB triple to resolve to, so the diff yields an empty font -- equivalent to no font at all, the same way a reserved FillPattern value resolves to no background. With no other formatting, the Blank has nothing left to show and stays dropped.
      const bytes = xlsFile(
        workbookStream({
          globals: [
            fontRecord({ colorIcv: 10 }),
            fontRecord({}),
            ...xfTableWithFont(1, 0),
          ],
          sheets: [
            {
              name: "Sheet1",
              records: [record(RECORD_BLANK, cell(3, 4, 15))],
            },
          ],
        }),
      );

      expect(readXlsContent(bytes).sheets[0]?.cells).toHaveLength(0);
    });
  });

  describe("defined names", () => {
    /** A self-referencing SupBook plus a one-XTI-per-sheet ExternSheet, so a defined name's own PtgArea3d resolves its sheet prefix the way a real workbook's would. */
    function supportingLinks(sheetCount: number): Uint8Array<ArrayBuffer>[] {
      return [
        // SupBook ([MS-XLS] 2.4.271): ctab then cch 0x0401, the self-referencing marker.
        record(RECORD_SUPBOOK, [...u16(sheetCount), ...u16(0x0401)]),
        record(RECORD_EXTERNSHEET, [
          ...u16(sheetCount),
          ...Array.from({ length: sheetCount }, (_unused, index) => [
            ...u16(0),
            ...u16(index),
            ...u16(index),
          ]).flat(),
        ]),
      ];
    }

    /** The low bytes of an ASCII string, as a compressed (fHighByte = 0) XLUnicodeStringNoCch holds them. */
    function asciiBytes(text: string): number[] {
      const out: number[] = [];
      for (let index = 0; index < text.length; index += 1) {
        out.push(text.charCodeAt(index));
      }
      return out;
    }

    /** A user-defined Lbl ([MS-XLS] 2.4.150): fBuiltin clear, the name as a compressed XLUnicodeStringNoCch, and the given rgce. */
    function userLblRecord(
      name: string,
      itab: number,
      rgce: readonly number[],
    ): Uint8Array<ArrayBuffer> {
      return record(RECORD_LBL, [
        ...u16(0x0000), // grbit: a user-defined name, not hidden
        0x00, // chKey: no macro shortcut key
        name.length,
        ...u16(rgce.length),
        ...u16(0), // reserved3
        ...u16(itab),
        ...u32(0), // reserved4 through reserved7
        0x00, // the Name's own XLUnicodeStringNoCch flags byte: compressed
        ...asciiBytes(name),
        ...rgce,
      ]);
    }

    /** A built-in Lbl: the single-character Name whose code unit IS the built-in index. */
    function builtinLblRecord(
      builtinIndex: number,
      itab: number,
      rgce: readonly number[],
    ): Uint8Array<ArrayBuffer> {
      return record(RECORD_LBL, [
        ...u16(0x0020), // fBuiltin
        0x00,
        0x01,
        ...u16(rgce.length),
        ...u16(0),
        ...u16(itab),
        ...u32(0),
        0x00,
        builtinIndex,
        ...rgce,
      ]);
    }

    /** PtgArea3d reference class ([MS-XLS] 2.5.198.28): opcode 0x3b, the ixti, then an absolute RgceArea. */
    function ptgArea3d(
      ixti: number,
      area: {
        rowFirst: number;
        rowLast: number;
        columnFirst: number;
        columnLast: number;
      },
    ): number[] {
      return [
        0x3b,
        ...u16(ixti),
        ...u16(area.rowFirst),
        ...u16(area.rowLast),
        ...u16(area.columnFirst),
        ...u16(area.columnLast),
      ];
    }

    it("reads a workbook-scoped user-defined name with its formula text", () => {
      const bytes = xlsFile(
        workbookStream({
          globals: [
            ...xfTable(0),
            ...supportingLinks(1),
            userLblRecord(
              "SalesData",
              0,
              ptgArea3d(0, {
                rowFirst: 0,
                rowLast: 1,
                columnFirst: 0,
                columnLast: 1,
              }),
            ),
          ],
          sheets: [{ name: "Sheet1", records: [] }],
        }),
      );

      expect(readXlsContent(bytes).names).toEqual([
        { name: "SalesData", refersTo: "Sheet1!$A$1:$B$2" },
      ]);
    });

    it("reads a sheet-scoped name as scopeSheetIndex against the document's own sheets", () => {
      const bytes = xlsFile(
        workbookStream({
          globals: [
            ...xfTable(0),
            ...supportingLinks(2),
            // itab is one-based against the FULL BoundSheet8 collection: 2 names the second sheet, whose position among the document's own sheets is also 1 here.
            userLblRecord(
              "LocalRange",
              2,
              ptgArea3d(1, {
                rowFirst: 2,
                rowLast: 4,
                columnFirst: 0,
                columnLast: 0,
              }),
            ),
          ],
          sheets: [
            { name: "Sheet1", records: [] },
            { name: "Sheet2", records: [] },
          ],
        }),
      );

      expect(readXlsContent(bytes).names).toEqual([
        {
          name: "LocalRange",
          refersTo: "Sheet2!$A$3:$A$5",
          scopeSheetIndex: 1,
        },
      ]);
    });

    it("translates the scope through the worksheet-only filter, dropping a name scoped to a sheet the document does not carry", () => {
      const bytes = xlsFile(
        workbookStream({
          globals: [
            ...xfTable(0),
            ...supportingLinks(3),
            // Scoped to BoundSheet8 position 1, which is a chart sheet the document's own sheets array drops, so the name has no scope the schema can express and is dropped whole.
            userLblRecord(
              "ChartName",
              2,
              ptgArea3d(1, {
                rowFirst: 0,
                rowLast: 0,
                columnFirst: 0,
                columnLast: 0,
              }),
            ),
            // Scoped to BoundSheet8 position 2, the second WORKSHEET, which the filter keeps at document position 1.
            userLblRecord(
              "SecondSheet",
              3,
              ptgArea3d(2, {
                rowFirst: 0,
                rowLast: 0,
                columnFirst: 0,
                columnLast: 0,
              }),
            ),
          ],
          sheets: [
            { name: "Sheet1", records: [] },
            { name: "Chart1", records: [], sheetType: 0x02 },
            { name: "Sheet2", records: [] },
          ],
        }),
      );

      expect(readXlsContent(bytes).names).toEqual([
        {
          name: "SecondSheet",
          refersTo: "Sheet2!$A$1:$A$1",
          scopeSheetIndex: 1,
        },
      ]);
    });

    it("surfaces a non-print built-in under its _xlnm spelling, and leaves the two print built-ins to print settings alone", () => {
      const area = ptgArea3d(0, {
        rowFirst: 0,
        rowLast: 0,
        columnFirst: 0,
        columnLast: 2,
      });
      const bytes = xlsFile(
        workbookStream({
          globals: [
            ...xfTable(0),
            ...supportingLinks(1),
            builtinLblRecord(0x0d, 1, area), // _FilterDatabase
            builtinLblRecord(0x06, 1, area), // Print_Area -- print-names.ts owns this one
          ],
          sheets: [{ name: "Sheet1", records: [] }],
        }),
      );

      const content = readXlsContent(bytes);
      expect(content.names).toEqual([
        {
          name: "_xlnm._FilterDatabase",
          refersTo: "Sheet1!$A$1:$C$1",
          scopeSheetIndex: 0,
        },
      ]);
      // The print area the built-in carried is not lost -- it lives where the schema models it.
      expect(content.sheets[0]?.printSettings.printRange).toEqual({
        startRow: 0,
        startColumn: 0,
        endRow: 0,
        endColumn: 2,
      });
    });

    it("states no names field at all for a workbook declaring none", () => {
      const bytes = xlsFile(
        workbookStream({
          globals: xfTable(0),
          sheets: [{ name: "Sheet1", records: [] }],
        }),
      );

      expect("names" in readXlsContent(bytes)).toBe(false);
    });

    it("skips a name whose rgce resolves to no formula text", () => {
      // PtgName ([MS-XLS] 2.5.198.80, opcode 0x1a + a name index) is one of the constructs ptg.ts deliberately does not resolve, so a name referring to another name has no refersTo this reader could state honestly.
      const bytes = xlsFile(
        workbookStream({
          globals: [
            ...xfTable(0),
            ...supportingLinks(1),
            userLblRecord("Alias", 0, [0x1a, ...u16(3)]),
          ],
          sheets: [{ name: "Sheet1", records: [] }],
        }),
      );

      expect(readXlsContent(bytes).names).toBeUndefined();
    });
  });

  describe("metadata", () => {
    it('reads title/author/dates from a real "\\x05SummaryInformation" stream', () => {
      const bytes = withSummaryInformation(
        xlsFile(
          workbookStream({
            globals: xfTable(0),
            sheets: [{ name: "Sheet1", records: [] }],
          }),
        ),
        {
          title: "Budget",
          author: "Cornelius",
          createdIso: "2024-05-01T00:00:00.000Z",
        },
      );
      const content = readXlsContent(bytes);
      expect(content.metadata).toEqual({
        title: "Budget",
        author: "Cornelius",
        createdIso: "2024-05-01T00:00:00.000Z",
      });
    });

    it('reads {} when the container carries no "\\x05SummaryInformation" stream', () => {
      const bytes = xlsFile(
        workbookStream({
          globals: xfTable(0),
          sheets: [{ name: "Sheet1", records: [] }],
        }),
      );
      expect(readXlsContent(bytes).metadata).toEqual({});
    });
  });
});

describe("readXlsContent formula recovery", () => {
  // A cell reference's own RgceLoc column field ([MS-XLS] 2.5.51 ColRelU), fully relative -- the shape a bare `A1` (as opposed to `$A$1`) carries, both colRelative and rowRelative bits set.
  const relativeColumn = (column: number) => u16(0xc000 | column);
  /** PtgRef (value class, [MS-XLS] 2.5.198.84): a Formula's own operand for a single-cell reference. */
  const ptgRef = (row: number, column: number) => [
    0x44,
    ...u16(row),
    ...relativeColumn(column),
  ];
  /** The Formula record's own trailing fields after its FormulaValue ([MS-XLS] 2.4.127): flags, the calculation cache, then a CellParsedFormula's cce and rgce. */
  const formulaTail = (rgce: readonly number[]) => [
    ...u16(0),
    ...u32(0),
    ...u16(rgce.length),
    ...rgce,
  ];

  it("recovers a formula's own text alongside its cached value", () => {
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [
          {
            name: "Sheet1",
            records: [
              record(RECORD_NUMBER, [...cell(0, 0), ...f64(1)]),
              record(RECORD_NUMBER, [...cell(0, 1), ...f64(2)]),
              record(RECORD_FORMULA, [
                ...cell(0, 2),
                ...f64(3),
                ...formulaTail([...ptgRef(0, 0), ...ptgRef(0, 1), 0x03]),
              ]),
            ],
          },
        ],
      }),
    );

    const cellC1 = readXlsContent(bytes).sheets[0]?.cells.find(
      (entry) => entry.column === 2,
    );

    expect(cellC1?.formula).toBe("A1+B1");
    expect(cellC1?.value).toEqual({ kind: "number", value: 3 });
  });

  it("resolves a cross-sheet 3D reference through EXTERNSHEET and a self-referencing SupBook", () => {
    // PtgArea3d (ref class, [MS-XLS] 2.5.198.28): opcode 0x3B, an ixti, then rwFirst/rwLast and each corner's own relative column field.
    const ptgArea3d = (ixti: number) => [
      0x3b,
      ...u16(ixti),
      ...u16(0),
      ...u16(1),
      ...relativeColumn(0),
      ...relativeColumn(1),
    ];
    const bytes = xlsFile(
      workbookStream({
        globals: [
          ...xfTable(0),
          // SupBook ([MS-XLS] 2.4.271): ctab (ignored for a self-referencing link) then cch 0x0401, the self-referencing marker.
          record(RECORD_SUPBOOK, [...u16(2), ...u16(0x0401)]),
          // ExternSheet ([MS-XLS] 2.4.106): one XTI naming sheet index 1 ("Data") on both ends.
          record(RECORD_EXTERNSHEET, [
            ...u16(1),
            ...u16(0),
            ...u16(1),
            ...u16(1),
          ]),
        ],
        sheets: [
          {
            name: "Sheet1",
            records: [
              record(RECORD_FORMULA, [
                ...cell(0, 0),
                ...f64(10),
                ...formulaTail([
                  ...ptgArea3d(0),
                  0x19,
                  0x10,
                  ...u16(0), // PtgAttrSum
                ]),
              ]),
            ],
          },
          {
            name: "Data",
            records: [
              record(RECORD_NUMBER, [...cell(0, 0), ...f64(1)]),
              record(RECORD_NUMBER, [...cell(0, 1), ...f64(2)]),
              record(RECORD_NUMBER, [...cell(1, 0), ...f64(3)]),
              record(RECORD_NUMBER, [...cell(1, 1), ...f64(4)]),
            ],
          },
        ],
      }),
    );

    const cellA1 = readXlsContent(bytes).sheets[0]?.cells[0];

    expect(cellA1?.formula).toBe("SUM(Data!A1:B2)");
  });

  it("leaves formula absent for a shared-formula member's own PtgExp", () => {
    // PtgExp ([MS-XLS] 2.5.198.58): opcode 0x01, then the shared formula's own base cell -- a formula this reader deliberately does not resolve (see biff/ptg.ts), so the cached value stays correct and formula stays absent rather than reading past the token into something invented.
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [
          {
            name: "Sheet1",
            records: [
              record(RECORD_FORMULA, [
                ...cell(0, 0),
                ...f64(4),
                ...formulaTail([0x01, ...u16(0), ...u16(0)]),
              ]),
            ],
          },
        ],
      }),
    );

    const cellA1 = readXlsContent(bytes).sheets[0]?.cells[0];

    expect(cellA1?.formula).toBeUndefined();
    expect(cellA1?.value).toEqual({ kind: "number", value: 4 });
  });
});

describe("readXlsContent schema conformance", () => {
  // The strongest single check in this suite: the reader's output is parsed by document-schema.js's OWN validator rather than compared against hand-written expectations. A field this package populates with a shape the schema does not accept -- a zero widthPt where the schema requires a positive number, a cell value kind spelled BIFF8's way rather than the schema's, a required print-settings field left off -- fails here even when every value-level assertion above passes.
  const bytes = xlsFile(
    workbookStream({
      globals: [
        record(RECORD_DATE1904, u16(0)),
        record(RECORD_FORMAT, [...u16(164), ...xlUnicodeString("yyyy-mm-dd")]),
        ...xfTable(164, 10, 0),
        record(RECORD_SST, [
          ...u32(1),
          ...u32(1),
          ...richExtendedString("Text"),
        ]),
      ],
      sheets: [
        {
          name: "Sheet1",
          records: [
            record(RECORD_NUMBER, [...cell(0, 0, 15), ...f64(45292)]),
            record(RECORD_NUMBER, [...cell(1, 0, 16), ...f64(0.5)]),
            record(RECORD_LABELSST, [...cell(2, 0, 17), ...u32(0)]),
            record(RECORD_BOOLERR, [...cell(3, 0, 17), 0x01, 0x00]),
            record(RECORD_BOOLERR, [...cell(4, 0, 17), 0x07, 0x01]),
            record(RECORD_ROW, [
              ...u16(0),
              ...u16(0),
              ...u16(1),
              ...u16(300),
              ...u16(0),
              ...u16(0),
              0x40,
              0x01,
              ...u16(0),
            ]),
            record(RECORD_COLINFO, [
              ...u16(0),
              ...u16(1),
              ...u16(2560),
              ...u16(15),
              ...u16(0),
              ...u16(0),
            ]),
            record(RECORD_MERGECELLS, [
              ...u16(1),
              ...u16(6),
              ...u16(7),
              ...u16(0),
              ...u16(1),
            ]),
          ],
        },
      ],
    }),
  );

  it("produces a document the schema's own validator accepts", () => {
    expect(() =>
      ContentDocumentSchema.parse(readXlsContent(bytes)),
    ).not.toThrow();
  });

  it("produces a tree the schema's own validator accepts", () => {
    expect(() => DocumentTreeSchema.parse(readXls(bytes))).not.toThrow();
  });

  it("covers every value kind the reader can emit in that document", () => {
    // Guards the check above from silently narrowing: if a future edit stops this fixture exercising a kind, this fails rather than the conformance test quietly proving less.
    const kinds = new Set(
      (readXlsContent(bytes).sheets[0]?.cells ?? []).map(
        (entry) => entry.value.kind,
      ),
    );

    expect(kinds).toEqual(
      new Set(["date", "percentage", "string", "boolean", "error", "empty"]),
    );
  });
});

describe("readXls", () => {
  it("returns the same read decomposed into a document tree", () => {
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [
          {
            name: "Sheet1",
            records: [record(RECORD_NUMBER, [...cell(0, 0), ...f64(7)])],
          },
        ],
      }),
    );

    const tree = readXls(bytes);

    expect(tree.kind).toBe("spreadsheet");
    expect(tree.children).toHaveLength(1);
  });
});

describe("isXlsFile", () => {
  it("accepts a compound file holding a Workbook stream", () => {
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [{ name: "Sheet1", records: [] }],
      }),
    );

    expect(isXlsFile(bytes)).toBe(true);
  });

  it("accepts a Microsoft Works .xlr, which carries the same Workbook stream", () => {
    // Works 9 writes the identical BIFF8 Workbook stream and adds its own WksSSWorkBook stream beside it, so selecting the stream by name reads an .xlr with no special-casing at all.
    const stream = workbookStream({
      globals: xfTable(0),
      sheets: [
        {
          name: "Sheet1",
          records: [record(RECORD_NUMBER, [...cell(0, 0), ...f64(3)])],
        },
      ],
    });
    const xlr = compoundFile([
      { path: "Workbook", bytes: stream },
      { path: "WksSSWorkBook", bytes: new Uint8Array([0xff, 0x00]) },
    ]);

    expect(isXlsFile(xlr)).toBe(true);
    expect(readXlsContent(xlr).sheets[0]?.cells[0]?.value).toEqual({
      kind: "number",
      value: 3,
    });
  });

  it("rejects a compound file that is a Word document rather than a workbook", () => {
    // The container magic alone would claim every .doc and .ppt is a spreadsheet.
    const bytes = compoundFile([
      { path: "WordDocument", bytes: new Uint8Array([1, 2, 3]) },
    ]);

    expect(isXlsFile(bytes)).toBe(false);
  });

  it("rejects a ZIP archive, which is what a .xlsx is", () => {
    expect(isXlsFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false);
  });

  it("rejects bytes too short to carry a container header", () => {
    expect(isXlsFile(new Uint8Array([0xd0]))).toBe(false);
  });
});

describe("readXlsContent print settings", () => {
  /** A Setup record ([MS-XLS] 2.4.257) with iPageStart, iRes, iVRes, numHdr, numFtr, and iCopies at values a real producer writes -- none of which this reader acts on. */
  function setupRecord(fields: {
    paperCode: number;
    scalePercent: number;
    fitWidth: number;
    fitHeight: number;
    grbit: number;
  }): Uint8Array<ArrayBuffer> {
    return record(RECORD_SETUP, [
      ...u16(fields.paperCode),
      ...u16(fields.scalePercent),
      ...u16(0),
      ...u16(fields.fitWidth),
      ...u16(fields.fitHeight),
      ...u16(fields.grbit),
      ...u16(300),
      ...u16(300),
      ...f64(0.3),
      ...f64(0.3),
      ...u16(1),
    ]);
  }

  /** The built-in Print_Area Lbl ([MS-XLS] 2.4.150) for one sheet: fBuiltin, cch 1, the one-based itab, name character 0x06, then a PtgArea3d naming the range. */
  function printAreaRecord(
    itab: number,
    area: {
      rowFirst: number;
      rowLast: number;
      colFirst: number;
      colLast: number;
    },
  ): Uint8Array<ArrayBuffer> {
    const rgce = [
      0x3b,
      ...u16(0),
      ...u16(area.rowFirst),
      ...u16(area.rowLast),
      ...u16(area.colFirst),
      ...u16(area.colLast),
    ];
    return record(RECORD_LBL, [
      ...u16(0x0020),
      0x00,
      0x01,
      ...u16(rgce.length),
      ...u16(0),
      ...u16(itab),
      ...u32(0),
      0x00,
      0x06,
      ...rgce,
    ]);
  }

  function printSettingsOf(
    sheetRecords: readonly Uint8Array<ArrayBuffer>[],
    globals: readonly Uint8Array<ArrayBuffer>[] = [],
  ) {
    const bytes = xlsFile(
      workbookStream({
        globals: [...xfTable(0), ...globals],
        sheets: [{ name: "Sheet1", records: [...sheetRecords] }],
      }),
    );
    return readXlsContent(bytes).sheets[0]?.printSettings;
  }

  it("falls back to Excel's own Normal preset for a sheet stating nothing", () => {
    // Every record behind these is optional in [MS-XLS] 2.1.7.20.6's own PAGESETUP production, and a sheet nobody has set a page setup on carries none of them.
    expect(printSettingsOf([])).toEqual({
      pageSize: { widthPt: 612, heightPt: 792 },
      margins: { topPt: 54, rightPt: 50.4, bottomPt: 54, leftPt: 50.4 },
      gridlines: false,
      headers: false,
      pageOrder: "downThenOver",
    });
  });

  it("falls back per field, keeping the one margin a sheet does state", () => {
    expect(
      printSettingsOf([record(RECORD_LEFTMARGIN, f64(1))])?.margins,
    ).toEqual({ topPt: 54, rightPt: 50.4, bottomPt: 54, leftPt: 72 });
  });

  it("resolves the page size, scale, gridlines, headers, and page order a sheet does state", () => {
    expect(
      printSettingsOf([
        setupRecord({
          paperCode: 9,
          scalePercent: 80,
          fitWidth: 1,
          fitHeight: 1,
          grbit: 0x0001, // fLeftToRight set, fPortrait clear
        }),
        record(RECORD_PRINTGRID, u16(1)),
        record(RECORD_PRINTROWCOL, u16(1)),
      ]),
    ).toMatchObject({
      pageSize: { widthPt: 841.89, heightPt: 595.28 },
      gridlines: true,
      headers: true,
      pageOrder: "overThenDown",
      scalePercent: 80,
    });
  });

  it("reads no paper size and no scale from a Setup record that disowns both", () => {
    // [MS-XLS] 2.4.257's own fNoPls: "whether the iPaperSize, iScale, iRes, iVRes, iCopies, fNoOrient, and fPortrait data are undefined and ignored".
    const settings = printSettingsOf([
      setupRecord({
        paperCode: 9,
        scalePercent: 80,
        fitWidth: 1,
        fitHeight: 1,
        grbit: 0x0004, // fNoPls
      }),
    ]);

    expect(settings?.pageSize).toEqual({ widthPt: 612, heightPt: 792 });
    expect(settings?.scalePercent).toBeUndefined();
  });

  it("takes the fit-to-page counts, not the scale, when WsBool says fit-to-page", () => {
    // A real producer writes both regardless of which is live, so reading both would report a scale and a page count that contradict each other.
    const settings = printSettingsOf([
      record(RECORD_WSBOOL, u16(0x0100)),
      setupRecord({
        paperCode: 1,
        scalePercent: 80,
        fitWidth: 2,
        fitHeight: 3,
        grbit: 0x0002,
      }),
    ]);

    expect(settings?.fitToPages).toEqual({ width: 2, height: 3 });
    expect(settings?.scalePercent).toBeUndefined();
  });

  it("reports no fit-to-page at all when either count is the spec's own auto value", () => {
    // [MS-XLS] 2.4.257: "The value 0 means use as many pages as necessary" -- an auto setting ContentSheetPrintSettings cannot express, both its counts being required and positive. A fabricated 1 would claim the sheet is pinned to one page along an axis the file left free.
    const settings = printSettingsOf([
      record(RECORD_WSBOOL, u16(0x0100)),
      setupRecord({
        paperCode: 1,
        scalePercent: 100,
        fitWidth: 1,
        fitHeight: 0,
        grbit: 0x0002,
      }),
    ]);

    expect(settings?.fitToPages).toBeUndefined();
    expect(settings?.scalePercent).toBeUndefined();
  });

  it("reads both page-break records into manualBreaks", () => {
    expect(
      printSettingsOf([
        record(RECORD_HORIZONTALPAGEBREAKS, [
          ...u16(1),
          ...u16(12),
          ...u16(0),
          ...u16(0xff),
        ]),
        record(RECORD_VERTICALPAGEBREAKS, [
          ...u16(1),
          ...u16(5),
          ...u16(0),
          ...u16(0xffff),
        ]),
      ])?.manualBreaks,
    ).toEqual({ rows: [12], columns: [5] });
  });

  it("reads the print range from the globals substream's own built-in defined name", () => {
    expect(
      printSettingsOf(
        [],
        [
          printAreaRecord(1, {
            rowFirst: 1,
            rowLast: 5,
            colFirst: 1,
            colLast: 3,
          }),
        ],
      )?.printRange,
    ).toEqual({ startRow: 1, startColumn: 1, endRow: 5, endColumn: 3 });
  });

  it("scopes a print name by its own BoundSheet8 position, not by position among the worksheets", () => {
    // A print name's itab counts every sheet, including the chart sheets readXlsContent filters out before mapping.
    const bytes = xlsFile(
      workbookStream({
        globals: [
          ...xfTable(0),
          printAreaRecord(2, {
            rowFirst: 3,
            rowLast: 4,
            colFirst: 0,
            colLast: 1,
          }),
        ],
        sheets: [
          { name: "Chart", records: [], sheetType: 0x02 },
          { name: "Data", records: [] },
        ],
      }),
    );

    const document = readXlsContent(bytes);
    expect(document.sheets).toHaveLength(1);
    expect(document.sheets[0]?.printSettings.printRange).toEqual({
      startRow: 3,
      startColumn: 0,
      endRow: 4,
      endColumn: 1,
    });
  });
});

describe("readXlsContent: cell comments (ExaDev/documents.js#949)", () => {
  it("attaches a comment to an existing cell, alongside its own value", () => {
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [
          {
            name: "Sheet1",
            records: [
              record(RECORD_NUMBER, [...cell(0, 0), ...f64(42)]),
              noteObjRecord(1),
              ...noteTxoRecords("A real note"),
              noteRecord(0, 0, 1, "Alice"),
            ],
          },
        ],
      }),
    );

    expect(readXlsContent(bytes).sheets[0]?.cells[0]).toEqual({
      row: 0,
      column: 0,
      value: { kind: "number", value: 42 },
      displayText: "42",
      numberFormatCode: "General",
      comment: { text: "A real note", author: "Alice" },
    });
  });

  it("materialises an empty cell for a comment anchored to a position no cell record ever occupied", () => {
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [
          {
            name: "Sheet1",
            records: [
              noteObjRecord(1),
              ...noteTxoRecords("Floating note"),
              noteRecord(5, 2, 1),
            ],
          },
        ],
      }),
    );

    expect(readXlsContent(bytes).sheets[0]?.cells).toEqual([
      {
        row: 5,
        column: 2,
        value: { kind: "empty" },
        displayText: "",
        comment: { text: "Floating note" },
      },
    ]);
  });
});

describe("readXlsContent: charts, drawings and images (ExaDev/documents.js#924)", () => {
  // A minimal but genuinely valid 1x1 PNG (a real signature, IHDR, IDAT, IEND chain), so this reads as a real end-to-end round trip rather than an opaque byte blob standing in for one.
  const PNG_BYTES = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ];

  const SHAPE_TYPE_RECTANGLE = 0x01;
  const SHAPE_TYPE_PICTURE_FRAME = 0x4b;
  const OBJECT_TYPE_PICTURE = 0x08;
  const OBJECT_TYPE_OFFICE_ART = 0x1e;

  /** The workbook-wide MsoDrawingGroup stream, carrying a Blip Store with a single PNG entry at index 1. */
  function drawingGroupRecord(): Uint8Array<ArrayBuffer> {
    const blip = embeddedBlip(0xf01e, 0x6e0, PNG_BYTES);
    return record(
      RECORD_MSODRAWINGGROUP,
      escherContainer(0xf000, 0, [
        escherContainer(0xf001, 0, [escherAtom(0xf007, 0, bseEntry(blip))]),
      ]),
    );
  }

  /** One sheet's own MsoDrawing stream: the patriarch group plus every real shape it carries. */
  function msoDrawingRecord(
    shapeContainers: readonly (readonly number[])[],
  ): Uint8Array<ArrayBuffer> {
    const patriarch = spAtom(SHAPE_TYPE_RECTANGLE, 1024, 0);
    return record(
      RECORD_MSODRAWING,
      escherContainer(0xf002, 0, [
        escherContainer(0xf003, 0, [
          escherContainer(0xf004, 0, [patriarch]),
          ...shapeContainers,
        ]),
      ]),
    );
  }

  it("reads an embedded picture as a cell-anchored ContentSheetImage", () => {
    const anchor = clientAnchorSheet(0, 0, 0, 0, 1, 0, 1, 0);
    const picture = escherContainer(0xf004, 0, [
      spAtom(SHAPE_TYPE_PICTURE_FRAME, 10, 0),
      optAtom([foptEntry(0x0104, 1)]),
      anchor,
    ]);
    const bytes = xlsFile(
      workbookStream({
        globals: [...xfTable(0), drawingGroupRecord()],
        sheets: [
          {
            name: "Sheet1",
            records: [
              msoDrawingRecord([picture]),
              otherObjRecord(OBJECT_TYPE_PICTURE, 1),
            ],
          },
        ],
      }),
    );

    const images = readXlsContent(bytes).sheets[0]?.images;

    expect(images).toHaveLength(1);
    expect(images?.[0]?.format).toBe("png");
    expect(images?.[0]?.anchorRow).toBe(0);
    expect(images?.[0]?.anchorColumn).toBe(0);
    expect(images?.[0]?.widthPt).toBeGreaterThan(0);
    expect(images?.[0]?.heightPt).toBeGreaterThan(0);
  });

  it("reads a non-picture drawing shape as a 'drawing' embedded object", () => {
    const anchor = clientAnchorSheet(0, 0, 0, 0, 1, 0, 1, 0);
    const rectangle = escherContainer(0xf004, 0, [
      spAtom(SHAPE_TYPE_RECTANGLE, 11, 0),
      anchor,
    ]);
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [
          {
            name: "Sheet1",
            records: [
              msoDrawingRecord([rectangle]),
              otherObjRecord(OBJECT_TYPE_OFFICE_ART, 1),
            ],
          },
        ],
      }),
    );

    const sheet = readXlsContent(bytes).sheets[0];

    expect(sheet?.images).toEqual([]);
    expect(sheet?.embeddedObjects).toHaveLength(1);
    expect(sheet?.embeddedObjects?.[0]?.objectKind).toBe("drawing");
  });

  it("reports no images or embedded objects for a sheet with no drawing records", () => {
    const bytes = xlsFile(
      workbookStream({
        globals: xfTable(0),
        sheets: [{ name: "Sheet1", records: [] }],
      }),
    );

    const sheet = readXlsContent(bytes).sheets[0];

    expect(sheet?.images).toEqual([]);
    expect(sheet?.embeddedObjects).toBeUndefined();
  });
});
