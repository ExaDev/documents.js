// The formula-recovery, schema-conformance, readXls, isXlsFile and print-settings suites split from content.test.ts, restating its harness verbatim.

import {} from "archive-codec";
import { ContentDocumentSchema, DocumentTreeSchema } from "document-schema.js";
import { describe, expect, it } from "vitest";

import {
  BOF_TYPE_WORKBOOK,
  BOF_TYPE_WORKSHEET,
  RECORD_BOF,
  RECORD_BOOLERR,
  RECORD_BOUNDSHEET8,
  RECORD_DATE1904,
  RECORD_EOF,
  RECORD_EXTERNSHEET,
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
import {} from "./biff/records";
import { isXlsFile } from "./container";
import {
  assertNeverContentCellValueKind,
  readXls,
  readXlsContent,
} from "./content";
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

/** As xfTable, but the single cell XF this builds carries the given decoration rather than an undecorated payload — for a test exercising background/borders. */

/** A Font record ([MS-XLS] 2.4.122) with an uncompressed fontName — the record's own "fontName.fHighByte MUST equal 1" rule — for a test driving the per-cell font reader. Every field left absent carries the spec's own default shape (Arial at 10pt/200 twips, no flags, Automatic colour, normal weight, no underline). */

/** As xfTable, but the single cell XF this builds references the given font index rather than font 0 — for a test exercising per-cell fonts. */

describe("readXlsContent formula recovery", () => {
  // A cell reference's own RgceLoc column field ([MS-XLS] 2.5.51 ColRelU), fully relative — the shape a bare `A1` (as opposed to `$A$1`) carries, both colRelative and rowRelative bits set.
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
    expect(cellC1?.value).toStrictEqual({ kind: "number", value: 3 });
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
    // PtgExp ([MS-XLS] 2.5.198.58): opcode 0x01, then the shared formula's own base cell — a formula this reader deliberately does not resolve (see biff/ptg.ts), so the cached value stays correct and formula stays absent rather than reading past the token into something invented.
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
    expect(cellA1?.value).toStrictEqual({ kind: "number", value: 4 });
  });
});

describe("readXlsContent schema conformance", () => {
  // The strongest single check in this suite: the reader's output is parsed by document-schema.js's OWN validator rather than compared against hand-written expectations. A field this package populates with a shape the schema does not accept — a zero widthPt where the schema requires a positive number, a cell value kind spelled BIFF8's way rather than the schema's, a required print-settings field left off — fails here even when every value-level assertion above passes.
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

    expect(kinds).toStrictEqual(
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
    expect(readXlsContent(xlr).sheets[0]?.cells[0]?.value).toStrictEqual({
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
  /** A Setup record ([MS-XLS] 2.4.257) with iPageStart, iRes, iVRes, numHdr, numFtr, and iCopies at values a real producer writes — none of which this reader acts on. */
  function setupRecord(
    fields: Readonly<{
      paperCode: number;
      scalePercent: number;
      fitWidth: number;
      fitHeight: number;
      grbit: number;
    }>,
  ): Uint8Array<ArrayBuffer> {
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
    area: Readonly<{
      rowFirst: number;
      rowLast: number;
      colFirst: number;
      colLast: number;
    }>,
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
    expect(printSettingsOf([])).toStrictEqual({
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
    ).toStrictEqual({ topPt: 54, rightPt: 50.4, bottomPt: 54, leftPt: 72 });
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

    expect(settings?.pageSize).toStrictEqual({ widthPt: 612, heightPt: 792 });
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

    expect(settings?.fitToPages).toStrictEqual({ width: 2, height: 3 });
    expect(settings?.scalePercent).toBeUndefined();
  });

  it("reports no fit-to-page at all when either count is the spec's own auto value", () => {
    // [MS-XLS] 2.4.257: "The value 0 means use as many pages as necessary" — an auto setting ContentSheetPrintSettings cannot express, both its counts being required and positive. A fabricated 1 would claim the sheet is pinned to one page along an axis the file left free.
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

  it("reports no fit-to-page at all when the WIDTH count alone is the spec's own auto value", () => {
    // The mirror image of the fitHeight-is-auto case above: fitWidth 0 with a real, positive fitHeight — both axes must be positive independently, neither one alone is enough.
    const settings = printSettingsOf([
      record(RECORD_WSBOOL, u16(0x0100)),
      setupRecord({
        paperCode: 1,
        scalePercent: 100,
        fitWidth: 0,
        fitHeight: 3,
        grbit: 0x0002,
      }),
    ]);

    expect(settings?.fitToPages).toBeUndefined();
  });

  it("reports no scale when a non-fit-to-page sheet's own scalePercent is the spec's own auto value", () => {
    // [MS-XLS] 2.4.257's own iScale: a real producer never writes 0, but a reader that treated 0 as a genuine 0% scale would report an unusable setting rather than degrading to no stated scale at all.
    const settings = printSettingsOf([
      setupRecord({
        paperCode: 1,
        scalePercent: 0,
        fitWidth: 1,
        fitHeight: 1,
        grbit: 0x0002,
      }),
    ]);

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
    ).toStrictEqual({ rows: [12], columns: [5] });
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
    ).toStrictEqual({ startRow: 1, startColumn: 1, endRow: 5, endColumn: 3 });
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
    expect(document.sheets[0]?.printSettings.printRange).toStrictEqual({
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

    expect(readXlsContent(bytes).sheets[0]?.cells[0]).toStrictEqual({
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

    expect(readXlsContent(bytes).sheets[0]?.cells).toStrictEqual([
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

    expect(sheet?.images).toStrictEqual([]);
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

    expect(sheet?.images).toStrictEqual([]);
    expect(sheet?.embeddedObjects).toBeUndefined();
  });
});

describe("assertNeverContentCellValueKind", () => {
  it("throws naming the unhandled kind, proving displayTextOf's own exhaustiveness guard actually fires at runtime", () => {
    let caught: unknown;
    try {
      assertNeverContentCellValueKind({ kind: "bogus" } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'displayTextOf: unhandled ContentCellValue kind {"kind":"bogus"}',
    );
  });
});
