// The cell-decoration, cell-fonts, defined-names and metadata suites split from content.test.ts, restating its harness verbatim.

import {
  readCompoundFile,
  writeCompoundFile,
  writeSummaryInformationStream,
} from "archive-codec";
import {} from "document-schema.js";
import { describe, expect, it } from "vitest";

import {
  BOF_TYPE_WORKBOOK,
  BOF_TYPE_WORKSHEET,
  RECORD_BLANK,
  RECORD_BOF,
  RECORD_FONT,
  RECORD_BOUNDSHEET8,
  RECORD_EOF,
  RECORD_EXTERNSHEET,
  RECORD_LBL,
  RECORD_NUMBER,
  RECORD_PALETTE,
  RECORD_SUPBOOK,
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
  shortXlUnicodeString,
  u16,
  u32,
  type XfTestDecoration,
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

/** As xfTable, but the single cell XF this builds carries the given decoration rather than an undecorated payload — for a test exercising background/borders. */
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

/** A Font record ([MS-XLS] 2.4.122) with an uncompressed fontName — the record's own "fontName.fHighByte MUST equal 1" rule — for a test driving the per-cell font reader. Every field left absent carries the spec's own default shape (Arial at 10pt/200 twips, no flags, Automatic colour, normal weight, no underline). */
function fontRecord(
  options: Readonly<{
    name?: string;
    heightTwips?: number;
    bold?: boolean;
    italic?: boolean;
    strikeout?: boolean;
    underline?: boolean;
    colorIcv?: number;
  }>,
): Uint8Array<ArrayBuffer> {
  const name = options.name ?? "Arial";
  const nameBytes: number[] = [name.length, 0x01];
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index);
    nameBytes.push(code & 0xff, code >> 8);
  }
  return record(RECORD_FONT, [
    ...u16(options.heightTwips ?? 200),
    ...u16(
      (options.italic === true ? 0x0002 : 0) |
        (options.strikeout === true ? 0x0008 : 0),
    ),
    ...u16(options.colorIcv ?? 0x7fff),
    ...u16(options.bold === true ? 700 : 400),
    ...u16(0), // sss: normal script
    options.underline === true ? 0x01 : 0x00,
    0x02, // bFamily: Swiss, Arial's own classification
    0x00, // bCharSet: ANSI
    0, // unused3
    ...nameBytes,
  ]);
}

/** As xfTable, but the single cell XF this builds references the given font index rather than font 0 — for a test exercising per-cell fonts. */
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

describe("cell decoration", () => {
  /** A single populated cell (icv 10, the default palette's own duplicate of Red — [MS-XLS] "Icv"'s own default-red/green/blue table) so a decoration test only needs to build the globals substream's own XF table, not a whole worksheet's cell records. */
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
    // The case a producer writes a Blank record FOR: the cell holds no value, and its fill and borders are the only thing it has to say — so dropping it as "shows nothing" discards exactly what the record was written to carry. Two XFs here so the decorated one is not also the sheet's default: index 15 undecorated, index 16 carrying the fill and a thin top border.
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
    expect(cells[0]?.background).toStrictEqual({
      kind: "solid",
      color: { r: 1, g: 0, b: 0 },
    });
    expect(cells[0]?.borders).toStrictEqual({
      top: { color: { r: 0, g: 0, b: 1 }, widthPt: 0.75 },
    });
  });

  it("still drops a Blank cell whose XF resolves to no decoration this reader can express", () => {
    // 0x13 is a reserved FillPattern value past FLSGRAY0625 (0x12), the last one [MS-XLS]/[MS-XLSB]'s own enumeration names — it resolves to no background at all (see the test below), and no side carries a border, so this Blank has nothing to show after resolution and stays dropped, exactly as an undecorated one does.
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
    // icv 10: the default table's own duplicate of Red (rgColor[2], [MS-XLS] "Icv") — resolvable with no Palette record present at all.
    const bytes = decoratedCellDocument({
      fillPattern: 1,
      fillForegroundIcv: 10,
    });
    expect(readXlsContent(bytes).sheets[0]?.cells[0]?.background).toStrictEqual(
      {
        kind: "solid",
        color: { r: 1, g: 0, b: 0 },
      },
    );
  });

  it("maps a genuine two-colour pattern fill instead of dropping it (ExaDev/documents.js#951)", () => {
    // fls=2 is FLSMEDGRAY, 50% gray ([MS-XLS]/[MS-XLSB] FillPattern) — ContentCellPatternType's own 'mediumGray'.
    const bytes = decoratedCellDocument({
      fillPattern: 2,
      fillForegroundIcv: 10, // default Red
      fillBackgroundIcv: 11, // default Green
    });
    expect(readXlsContent(bytes).sheets[0]?.cells[0]?.background).toStrictEqual(
      {
        kind: "pattern",
        patternType: "mediumGray",
        foregroundColor: { r: 1, g: 0, b: 0 },
        backgroundColor: { r: 0, g: 1, b: 0 },
      },
    );
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
    // style 1 = THIN (solid, thin weight); style 3 = DASHED (dashed pattern, thin weight) — [MS-XLS] BorderStyle.
    const bytes = decoratedCellDocument({
      left: { style: 1, icv: 12 }, // icv 12: default Blue
      top: { style: 3, icv: 11 }, // icv 11: default Green
    });
    expect(readXlsContent(bytes).sheets[0]?.cells[0]?.borders).toStrictEqual({
      left: { color: { r: 0, g: 0, b: 1 }, widthPt: 0.75 },
      top: { color: { r: 0, g: 1, b: 0 }, widthPt: 0.75, style: "dashed" },
    });
  });

  it("leaves borders undefined for a cell with no border on any side", () => {
    const bytes = decoratedCellDocument({
      fillPattern: 1,
      fillForegroundIcv: 10,
    });
    expect(readXlsContent(bytes).sheets[0]?.cells[0]?.borders).toBeUndefined();
  });

  it("resolves a fill/border colour through a real Palette record when one is present", () => {
    // A custom colour at icv 8 (rgColor[0]) that does NOT match the default table's own entry there (black) — proving this reads the file's own Palette rather than falling back to the default.
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
    expect(readXlsContent(bytes).sheets[0]?.cells[0]?.background).toStrictEqual(
      {
        kind: "solid",
        color: { r: 1, g: 128 / 255, b: 0 },
      },
    );
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

    expect(readXlsContent(bytes).sheets[0]?.cells[0]?.font).toStrictEqual({
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
    // BIFF8 gives a cell no way to say "no font", only an index into the font table — a cell naming entry 0, the Normal style's font, is stating the default, which the schema models as the field being absent rather than a restated copy of it.
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
    // The cell font's icv (Automatic, 0x7FFF) differs from the default's (icv 10), but Automatic has no fixed RGB triple to resolve to, so the diff yields an empty font — equivalent to no font at all, the same way a reserved FillPattern value resolves to no background. With no other formatting, the Blank has nothing left to show and stays dropped.
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
    area: Readonly<{
      rowFirst: number;
      rowLast: number;
      columnFirst: number;
      columnLast: number;
    }>,
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

    expect(readXlsContent(bytes).names).toStrictEqual([
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

    expect(readXlsContent(bytes).names).toStrictEqual([
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

    expect(readXlsContent(bytes).names).toStrictEqual([
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
          builtinLblRecord(0x06, 1, area), // Print_Area — print-names.ts owns this one
        ],
        sheets: [{ name: "Sheet1", records: [] }],
      }),
    );

    const content = readXlsContent(bytes);
    expect(content.names).toStrictEqual([
      {
        name: "_xlnm._FilterDatabase",
        refersTo: "Sheet1!$A$1:$C$1",
        scopeSheetIndex: 0,
      },
    ]);
    // The print area the built-in carried is not lost — it lives where the schema models it.
    expect(content.sheets[0]?.printSettings.printRange).toStrictEqual({
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
    // .toEqual, not .toStrictEqual: archive-codec's own summaryInformationToLayoutMetadata (shared with doc-codec/ppt-codec) states every LayoutMetadata field explicitly, as undefined rather than omitted, for whichever of subject/keywords/modifiedIso the stream did not carry — a real, if minor, contract inconsistency against LayoutMetadataSchema's own "optional means absent" convention, but one belonging to that shared package rather than this one.
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
    expect(readXlsContent(bytes).metadata).toStrictEqual({});
  });
});
