import { describe, expect, it } from "vitest";

import { readRecords } from "../biff/records";
import {
  RECORD_EXTERNSHEET,
  RECORD_SST,
  RECORD_STYLE,
} from "../biff/record-types";
import type { WorkbookGlobalsPlan } from "./globals-writer";
import { buildWorkbookGlobals } from "./globals-writer";

// buildWorkbookGlobals's own [MS-XLS] 2.1.7.20.3 FORMATTING production writes several records a real Excel-compatible file wants but this package's own reader (globals.ts) never looks for at all, or writes only conditionally: neither is observable through any writeXlsContent round trip, so these tests call the writer directly and inspect the raw records it produced.

const BASE_PLAN: WorkbookGlobalsPlan = {
  sheetNames: ["Sheet1"],
  fonts: [],
  customFormats: [],
  cellXfEntries: [],
  sharedStrings: [],
  sharedStringTotalCount: 0,
  printNames: [],
  definedNames: [],
};

function recordsOf(plan: WorkbookGlobalsPlan) {
  return readRecords(buildWorkbookGlobals(plan).bytes);
}

describe("buildWorkbookGlobals", () => {
  it("writes exactly fifteen STYLE records -- the fixed built-in style table, unconditionally", () => {
    const styleRecords = recordsOf(BASE_PLAN).filter(
      (record) => record.type === RECORD_STYLE,
    );
    expect(styleRecords).toHaveLength(15);
  });

  it("writes no SST record when the workbook carries no shared strings", () => {
    const records = recordsOf(BASE_PLAN);
    expect(records.some((record) => record.type === RECORD_SST)).toBe(false);
  });

  it("writes an SST record when the workbook carries shared strings", () => {
    const records = recordsOf({
      ...BASE_PLAN,
      sharedStrings: ["hello"],
      sharedStringTotalCount: 1,
    });
    expect(records.some((record) => record.type === RECORD_SST)).toBe(true);
  });

  it("writes an ExternSheet naming exactly one XTI per sheet, not one more", () => {
    const plan: WorkbookGlobalsPlan = {
      ...BASE_PLAN,
      sheetNames: ["Sheet1", "Sheet2", "Sheet3"],
      definedNames: [
        {
          name: "MyRange",
          builtinName: undefined,
          sheetIndex: undefined,
          rgce: new Uint8Array(0),
        },
      ],
    };
    const externSheet = recordsOf(plan).find(
      (record) => record.type === RECORD_EXTERNSHEET,
    );
    if (externSheet === undefined) {
      throw new Error("no ExternSheet record was written");
    }
    // cXTI (2 bytes) then 6 bytes per XTI structure, one per sheet.
    expect(externSheet.data.length).toBe(2 + 6 * plan.sheetNames.length);
    const cXTI = new DataView(
      externSheet.data.buffer,
      externSheet.data.byteOffset,
      externSheet.data.byteLength,
    ).getUint16(0, true);
    expect(cXTI).toBe(plan.sheetNames.length);
  });
});
