import {
  readCompoundFile,
  writeCompoundFile,
  writeSummaryInformationStream,
} from "archive-codec";
import { ContentDocumentSchema, DocumentTreeSchema } from "document-schema.js";
import { describe, expect, it } from "vitest";

import {
  BOF_TYPE_WORKBOOK,
  BOF_TYPE_WORKSHEET,
  RECORD_BLANK,
  RECORD_BOF,
  RECORD_BOOLERR,
  RECORD_BOUNDSHEET8,
  RECORD_DATE1904,
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
  record,
  richExtendedString,
  shortXlUnicodeString,
  u16,
  u32,
  xlUnicodeString,
  type XfTestDecoration,
} from "./test-support/biff";
import { compoundFile } from "./test-support/cfb";

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

  it("refuses an encrypted workbook rather than reading ciphertext", () => {
    // [MS-XLS] 2.4.117: every record after a FilePass is encrypted, so reading on would produce confident nonsense.
    const bytes = xlsFile(
      workbookStream({
        globals: [record(RECORD_FILEPASS, u16(1)), ...xfTable(0)],
        sheets: [{ name: "Sheet1", records: [] }],
      }),
    );

    expect(() => readXlsContent(bytes)).toThrow(BiffFormatError);
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
