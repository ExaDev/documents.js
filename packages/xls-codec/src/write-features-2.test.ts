// The write suites split from write.test.ts by family (write-b), restating its imports verbatim.

import type {
  ContentSheet,
  ContentSheetCell,
  ContentSheetConditionalFormat,
  ContentSheetPrintSettings,
} from "document-schema.js";
import { PAGE_SIZE_LETTER } from "document-schema.js";
import {} from "archive-codec";
import { describe, expect, it } from "vitest";

import { RECORD_CONDFMT, RECORD_CONDFMT12 } from "./biff/record-types";
import { readRecords } from "./biff/records";
import {} from "./biff/xf-colors";
import {} from "./biff/write-errors";
import type { XlsContentDocument } from "./content";
import { readXlsContent } from "./content";
import {} from "./container";
import { writeXlsContent } from "./write";
import {
  validateRuleCount,
  writeSheetConditionalFormats,
} from "./workbook/conditional-format-write";
import {} from "./workbook/data-validation-write";
import {} from "./workbook/sheet-writer";
import {} from "./workbook/globals-writer";

// Genuine .xls bytes — a real [MS-CFB] compound file holding a real BIFF8 Workbook stream — built by this package's own writer and read back through its own reader, the "primary verification method" this session's writers use throughout (the CFB writer, rtf-codec, wpd-codec). Every test here is a round trip: build a ContentDocument, write it, read it back, and check the read result reflects what was written — exercising the writer against a reader whose own correctness is independently pinned by content.test.ts's hand-built byte sequences.

const POINTS_PER_INCH = 72;
/** Excel's own "Normal" preset, which is what a sheet with nothing else to say about printing carries — and, since the reader falls back to exactly these values for a file stating none of the print records, what a round trip through this pair reproduces either way. The print-settings round trips at the end of this file are the ones that exercise real, non-default values. */
const PRINT_SETTINGS: ContentSheetPrintSettings = {
  pageSize: PAGE_SIZE_LETTER,
  margins: {
    topPt: 0.75 * POINTS_PER_INCH,
    rightPt: 0.7 * POINTS_PER_INCH,
    bottomPt: 0.75 * POINTS_PER_INCH,
    leftPt: 0.7 * POINTS_PER_INCH,
  },
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver",
};

function sheet(
  name: string,
  cells: readonly ContentSheetCell[],
  overrides: Partial<Omit<ContentSheet, "name" | "cells">> = {},
): ContentSheet {
  return {
    name,
    cells: [...cells],
    columns: [],
    rows: [],
    images: [],
    printSettings: PRINT_SETTINGS,
    ...overrides,
  };
}

/** Mirrors content.ts's own private displayTextOf exactly, so a test fixture's displayText is what a real reader would also produce for the same value — required because ContentSheetCellSchema documents displayText as always present. */

function document(sheets: readonly ContentSheet[]): XlsContentDocument {
  return { kind: "spreadsheet", metadata: {}, sheets: [...sheets] };
}

describe("writeXlsContent: conditional formats written (#971)", () => {
  it("round-trips a cellIs rule with its style colours", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "cellIs",
      ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
      operator: "greaterThan",
      formula1: "5",
      style: {
        textColor: { r: 1, g: 0, b: 0 },
        background: { r: 1, g: 1, b: 0.8 },
      },
    };
    const reread = readXlsContent(
      writeXlsContent(
        document([sheet("S", [], { conditionalFormats: [rule] })]),
      ),
    );
    expect(reread.sheets[0]?.conditionalFormats).toStrictEqual([rule]);
  });

  it("round-trips a style-less notBetween rule's two formulas", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "cellIs",
      ranges: [{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 }],
      operator: "notBetween",
      formula1: "2",
      formula2: "8",
    };
    const reread = readXlsContent(
      writeXlsContent(
        document([sheet("S", [], { conditionalFormats: [rule] })]),
      ),
    );
    expect(reread.sheets[0]?.conditionalFormats).toStrictEqual([rule]);
  });

  it("round-trips a cellIs rule under each of the remaining single-operand operators cpOf's own switch names — between/notBetween/equal/greaterThan already exercised above", () => {
    const operators = [
      "between",
      "notEqual",
      "lessThan",
      "greaterThanOrEqual",
    ] as const;
    for (const operator of operators) {
      const rule: ContentSheetConditionalFormat = {
        type: "cellIs",
        ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
        operator,
        formula1: "5",
      };
      const reread = readXlsContent(
        writeXlsContent(
          document([sheet("S", [], { conditionalFormats: [rule] })]),
        ),
      );
      expect(reread.sheets[0]?.conditionalFormats).toStrictEqual([rule]);
    }
  });

  it("refuses a rule variant with no BIFF8 spelling rather than dropping it", () => {
    // A colour scale carrying fewer than the schema's own two-stop minimum is malformed input, so the honest refusal fixture is a variant the FORMAT cannot spell: a year-scoped time period, an ODF extension value no icfTemplate names.
    expect(() =>
      writeXlsContent(
        document([
          sheet("S", [], {
            conditionalFormats: [
              {
                type: "timePeriod",
                ranges: [
                  { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
                ],
                timePeriod: "thisYear",
              },
            ],
          }),
        ]),
      ),
    ).toThrow(/no BIFF8 rule names it/);
  });

  it("refuses a conditional-format rule carrying no range", () => {
    expect(() =>
      writeXlsContent(
        document([
          sheet("S", [], {
            conditionalFormats: [{ type: "uniqueValues", ranges: [] }],
          }),
        ]),
      ),
    ).toThrow(
      "a conditional-format rule carrying no range states nothing; the schema requires at least one",
    );
  });

  it("refuses a conditional-format range outside BIFF8's own grid, at each of its four edges, naming the exact rows/columns", () => {
    const base = { type: "uniqueValues" as const };
    const edges = [
      { startRow: 0x10000, endRow: 0, startColumn: 0, endColumn: 0 },
      { startRow: 0, endRow: 0x10000, startColumn: 0, endColumn: 0 },
      { startRow: 0, endRow: 0, startColumn: 0x100, endColumn: 0 },
      { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0x100 },
    ];
    for (const range of edges) {
      expect(() =>
        writeXlsContent(
          document([
            sheet("S", [], {
              conditionalFormats: [{ ...base, ranges: [range] }],
            }),
          ]),
        ),
      ).toThrow(
        `a conditional-format range (rows ${range.startRow}-${range.endRow}, columns ${range.startColumn}-${range.endColumn}) is outside BIFF8's own grid; a .xls workbook cannot address it`,
      );
    }
  });

  it("accepts a conditional-format range sitting exactly at each of BIFF8's own four grid edges, not one past it", () => {
    const base = { type: "uniqueValues" as const };
    const edges = [
      { startRow: 0xffff, endRow: 0, startColumn: 0, endColumn: 0 },
      { startRow: 0, endRow: 0xffff, startColumn: 0, endColumn: 0 },
      { startRow: 0, endRow: 0, startColumn: 0xff, endColumn: 0 },
      { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0xff },
    ];
    for (const range of edges) {
      expect(() =>
        writeXlsContent(
          document([
            sheet("S", [], {
              conditionalFormats: [{ ...base, ranges: [range] }],
            }),
          ]),
        ),
      ).not.toThrow();
    }
  });

  it("writes no CondFmt/CondFmt12 records at all for a sheet stating an empty conditionalFormats array", () => {
    expect(
      writeSheetConditionalFormats(
        sheet("S", [], { conditionalFormats: [] }),
        () => 0,
      ),
    ).toStrictEqual([]);
  });

  it("refuses a rule count exceeding CondFmt's own 15-bit nID field, naming the exact count", () => {
    expect(() => {
      validateRuleCount(0x8000);
    }).toThrow(
      "this sheet's 32768 conditional-format rules exceed CondFmt's own 15-bit nID field",
    );
  });

  it("accepts a rule count sitting exactly at CondFmt's own 15-bit nID field boundary", () => {
    expect(() => {
      validateRuleCount(0x7fff);
    }).not.toThrow();
  });

  it("refuses 32768 conditional-format rules before writing a single record, rather than silently accepting more than CondFmt's own 15-bit nID field allows", () => {
    const range = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
    const rules: ContentSheetConditionalFormat[] = Array.from(
      { length: 0x8000 },
      () => ({ type: "uniqueValues", ranges: [range] }),
    );
    expect(() =>
      writeSheetConditionalFormats(
        sheet("S", [], { conditionalFormats: rules }),
        () => 0,
      ),
    ).toThrow(
      "this sheet's 32768 conditional-format rules exceed CondFmt's own 15-bit nID field",
    );
  });

  it("assigns each rule its own 1-based nID in declaration order across three rules, not just the two a smaller fixture cannot distinguish from an off-by-one", () => {
    const range = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
    const rules: ContentSheetConditionalFormat[] = [
      { type: "containsText", ranges: [range], text: "a" },
      { type: "containsText", ranges: [range], text: "b" },
      { type: "containsText", ranges: [range], text: "c" },
    ];
    const reread = readXlsContent(
      writeXlsContent(
        document([sheet("S", [], { conditionalFormats: rules })]),
      ),
    );
    expect(
      reread.sheets[0]?.conditionalFormats?.map((rule) =>
        rule.type === "containsText" ? rule.text : undefined,
      ),
    ).toStrictEqual(["a", "b", "c"]);
  });

  // nID only matters to a real consumer resolving a later CFEx record's own cross-reference (this package's own reader never emits or needs one on a self-written file, and explicitly skips CondFmt12's copy of the field as unused) — so its correctness is invisible to every round-trip test above and has to be read directly out of the raw CondFmt/CondFmt12 bytes instead.
  it("writes each base CondFmt group's own nID as its 1-based position among the sheet's rules, not the position minus one", () => {
    const range = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
    const rules: ContentSheetConditionalFormat[] = [
      { type: "cellIs", ranges: [range], operator: "equal", formula1: "1" },
      { type: "cellIs", ranges: [range], operator: "equal", formula1: "2" },
      { type: "cellIs", ranges: [range], operator: "equal", formula1: "3" },
    ];
    const pieces = writeSheetConditionalFormats(
      sheet("S", [], { conditionalFormats: rules }),
      () => 0,
    );
    const stream = new Uint8Array(
      pieces.reduce((total, piece) => total + piece.length, 0),
    );
    let offset = 0;
    for (const piece of pieces) {
      stream.set(piece, offset);
      offset += piece.length;
    }
    const nIDs = readRecords(stream)
      .filter((record) => record.type === RECORD_CONDFMT)
      .map((record) => {
        const view = new DataView(
          record.data.buffer,
          record.data.byteOffset,
          record.data.byteLength,
        );
        return (view.getUint16(2, true) >>> 1) & 0x7fff;
      });
    expect(nIDs).toStrictEqual([1, 2, 3]);
  });

  it("writes each CF12 group's own nID as its 1-based position among the sheet's rules, not the position minus one", () => {
    const range = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
    const rules: ContentSheetConditionalFormat[] = [
      { type: "uniqueValues", ranges: [range] },
      { type: "duplicateValues", ranges: [range] },
      { type: "containsBlanks", ranges: [range] },
    ];
    const pieces = writeSheetConditionalFormats(
      sheet("S", [], { conditionalFormats: rules }),
      () => 0,
    );
    const stream = new Uint8Array(
      pieces.reduce((total, piece) => total + piece.length, 0),
    );
    let offset = 0;
    for (const piece of pieces) {
      stream.set(piece, offset);
      offset += piece.length;
    }
    const nIDs = readRecords(stream)
      .filter((record) => record.type === RECORD_CONDFMT12)
      .map((record) => {
        const view = new DataView(
          record.data.buffer,
          record.data.byteOffset,
          record.data.byteLength,
        );
        // rt(2) + grbitFrt(2) + refBound's four u16s(8) + ccf(2) = 14 bytes before the fToughRecalc+nID word.
        return (view.getUint16(14, true) >>> 1) & 0x7fff;
      });
    expect(nIDs).toStrictEqual([1, 2, 3]);
  });
});
