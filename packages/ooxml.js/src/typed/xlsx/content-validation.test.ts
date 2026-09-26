import { describe, expect, it } from "vitest";
import { PAGE_SIZE_LETTER } from "document-schema.js";
import type {
  ContentDocument,
  ContentSheet,
  ContentSheetConditionalFormat,
  ContentSheetDataValidation,
} from "document-schema.js";
import type { Package } from "../../model/package";
import { el, txt } from "../../xml/fragment";
import { buildXlsxPackageFromContent } from "./build";
import {
  assertNeverNonEmptyContentCellValueKind,
  assertNeverNumberFormatClassKind,
  readXlsxContent,
} from "./content";
function worksheetOnlyPackage(worksheet: ReturnType<typeof el>): Package {
  const workbook = el("workbook", {}, [
    el("sheets", {}, [
      el("sheet", { name: "Data", sheetId: "1", "r:id": "rIdSheet" }),
    ]),
  ]);
  const relsRoot = el("Relationships", {}, [
    el("Relationship", {
      Id: "rIdSheet",
      Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
      Target: "worksheets/sheet1.xml",
    }),
  ]);
  return {
    parts: {
      "xl/workbook.xml": { kind: "xml", nodes: [workbook] },
      "xl/_rels/workbook.xml.rels": { kind: "xml", nodes: [relsRoot] },
      "xl/worksheets/sheet1.xml": { kind: "xml", nodes: [worksheet] },
    },
  };
}

const ROUND_TRIP_PRINT_SETTINGS: ContentSheet["printSettings"] = {
  pageSize: PAGE_SIZE_LETTER,
  margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver",
};

function roundTripSheet(
  sheet: Partial<ContentSheet> & Pick<ContentSheet, "name">,
): ContentSheet {
  const document: ContentDocument = {
    kind: "spreadsheet",
    metadata: {},
    sheets: [
      {
        cells: [],
        columns: [],
        rows: [],
        images: [],
        printSettings: ROUND_TRIP_PRINT_SETTINGS,
        ...sheet,
      },
    ],
  };
  const read = readXlsxContent(buildXlsxPackageFromContent(document));
  if (read.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  const roundTripped = read.sheets[0];
  if (roundTripped === undefined) {
    throw new Error("expected one sheet");
  }
  return roundTripped;
}

describe("readXlsxContent: dataValidation and conditionalFormatting — what is NOT promoted still lands as anchor-cell residue (synthetic packages)", () => {
  function readFirstCellOf(worksheet: ReturnType<typeof el>) {
    const read = readXlsxContent(worksheetOnlyPackage(worksheet));
    if (read.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    return read.sheets[0]?.cells ?? [];
  }

  it("still quarantines an 'expression' cfRule verbatim on its anchor cell — the one deliberate ECMA-376 member this union does not promote", () => {
    const cells = readFirstCellOf(
      el("worksheet", {}, [
        el("sheetData", {}, [
          el("row", { r: "1" }, [
            el("c", { r: "A1" }, [el("v", {}, [txt("5")])]),
          ]),
        ]),
        el("conditionalFormatting", { sqref: "A1:A2" }, [
          el("cfRule", { type: "expression", dxfId: "0", priority: "1" }, [
            el("formula", {}, [txt("1")]),
          ]),
        ]),
      ]),
    );
    const anchor = cells.find((cell) => cell.row === 0 && cell.column === 0);
    expect(anchor?.source).toEqual({
      format: "xlsx",
      xml: '<conditionalFormatting sqref="A1:A2"><cfRule type="expression" dxfId="0" priority="1"><formula>1</formula></cfRule></conditionalFormatting>',
    });
  });

  it("still quarantines a dataValidation whose type this package's schema does not name (ECMA-376's own 'none') verbatim on its anchor cell, materialising an empty cell to host it when none exists", () => {
    const cells = readFirstCellOf(
      el("worksheet", {}, [
        el("sheetData", {}, []),
        el("dataValidations", { count: "1" }, [
          el("dataValidation", { type: "none", sqref: "B2:D4" }),
        ]),
      ]),
    );
    const anchor = cells.find((cell) => cell.row === 1 && cell.column === 1);
    expect(anchor?.source).toEqual({
      format: "xlsx",
      xml: '<dataValidation type="none" sqref="B2:D4"></dataValidation>',
    });
    // The covered-but-not-anchor cells stay untouched: the sqref inside the residue names the whole range, so one copy reconstructs it.
    expect(
      cells.find((cell) => cell.row === 1 && cell.column === 2)?.source,
    ).toBeUndefined();
  });

  it("leaves a rule whose sqref is the empty string unattached, the same as one that does not parse at all", () => {
    const cells = readFirstCellOf(
      el("worksheet", {}, [
        el("sheetData", {}, []),
        el("dataValidations", { count: "1" }, [
          el("dataValidation", { type: "none", sqref: "" }),
        ]),
      ]),
    );
    expect(cells).toEqual([]);
  });

  it("materialises a residue-only anchor cell as kind empty with an empty displayText, not a placeholder marker string", () => {
    const cells = readFirstCellOf(
      el("worksheet", {}, [
        el("sheetData", {}, []),
        el("dataValidations", { count: "1" }, [
          el("dataValidation", { type: "none", sqref: "F6" }),
        ]),
      ]),
    );
    // F6 in A1 notation, 0-based: column F is index 5, row 6 is index 5.
    const RESIDUE_ANCHOR_ROW = 5;
    const RESIDUE_ANCHOR_COLUMN = 5;
    const anchor = cells.find(
      (cell) =>
        cell.row === RESIDUE_ANCHOR_ROW &&
        cell.column === RESIDUE_ANCHOR_COLUMN,
    );
    expect(anchor).toMatchObject({ value: { kind: "empty" }, displayText: "" });
  });

  it("keeps the first residue-eligible rule when two anchor at the same cell — one residue slot per cell — and leaves a rule whose sqref does not parse unattached", () => {
    const cells = readFirstCellOf(
      el("worksheet", {}, [
        el("sheetData", {}, []),
        el("dataValidations", { count: "2" }, [
          el("dataValidation", { type: "none", sqref: "C3" }, [
            el("formula1", {}, [txt("a,b,c")]),
          ]),
          el("dataValidation", { type: "none", sqref: "C3:E5" }, [
            el("formula1", {}, [txt("x,y,z")]),
          ]),
        ]),
        el("dataValidations", { count: "1" }, [
          el("dataValidation", { type: "none", sqref: "not a ref" }),
        ]),
      ]),
    );
    const anchor = cells.find((cell) => cell.row === 2 && cell.column === 2);
    expect(anchor?.source?.xml).toContain("a,b,c");
    expect(cells.filter((cell) => cell.source !== undefined)).toHaveLength(1);
  });
});

// --- round-trip coverage for every rule type the real fixtures above do not happen to carry ------------------------

describe("buildXlsxPackageFromContent + readXlsxContent: dataValidation round trip, every type the real fixtures don't cover", () => {
  it("whole, operator between", () => {
    const validation: ContentSheetDataValidation = {
      ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      type: "whole",
      operator: "between",
      formula1: "1",
      formula2: "10",
      allowBlank: true,
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      dataValidations: [validation],
    });
    expect(sheet.dataValidations).toEqual([validation]);
  });

  it("decimal, operator greaterThan, with error message fields", () => {
    const validation: ContentSheetDataValidation = {
      ranges: [{ startRow: 1, startColumn: 1, endRow: 1, endColumn: 1 }],
      type: "decimal",
      operator: "greaterThan",
      formula1: "0.5",
      showErrorMessage: true,
      errorTitle: "Bad value",
      error: "Enter a number greater than 0.5",
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      dataValidations: [validation],
    });
    expect(sheet.dataValidations).toEqual([validation]);
  });

  it("date, operator greaterThanOrEqual, with input message fields", () => {
    const validation: ContentSheetDataValidation = {
      ranges: [{ startRow: 2, startColumn: 0, endRow: 2, endColumn: 0 }],
      type: "date",
      operator: "greaterThanOrEqual",
      formula1: "45000",
      showInputMessage: true,
      promptTitle: "Date",
      prompt: "Enter a date on or after 2023-03-15",
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      dataValidations: [validation],
    });
    expect(sheet.dataValidations).toEqual([validation]);
  });

  it("time, operator lessThan, errorStyle warning", () => {
    const validation: ContentSheetDataValidation = {
      ranges: [{ startRow: 3, startColumn: 0, endRow: 3, endColumn: 0 }],
      type: "time",
      operator: "lessThan",
      formula1: "0.5",
      errorStyle: "warning",
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      dataValidations: [validation],
    });
    expect(sheet.dataValidations).toEqual([validation]);
  });

  it("textLength, operator lessThanOrEqual, errorStyle information", () => {
    const validation: ContentSheetDataValidation = {
      ranges: [{ startRow: 4, startColumn: 0, endRow: 4, endColumn: 0 }],
      type: "textLength",
      operator: "lessThanOrEqual",
      formula1: "50",
      errorStyle: "information",
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      dataValidations: [validation],
    });
    expect(sheet.dataValidations).toEqual([validation]);
  });

  it("custom, no operator, arbitrary formula", () => {
    const validation: ContentSheetDataValidation = {
      ranges: [{ startRow: 5, startColumn: 0, endRow: 5, endColumn: 0 }],
      type: "custom",
      formula1: "ISNUMBER(A6)",
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      dataValidations: [validation],
    });
    expect(sheet.dataValidations).toEqual([validation]);
  });
});

describe("buildXlsxPackageFromContent + readXlsxContent: conditionalFormat round trip, every rule family the real fixtures don't cover", () => {
  it("containsText, with a dxf-resolved textColor style", () => {
    const format: ContentSheetConditionalFormat = {
      type: "containsText",
      ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      priority: 1,
      text: "foo",
      style: { textColor: { r: 1, g: 0, b: 0 } },
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      conditionalFormats: [format],
    });
    expect(sheet.conditionalFormats).toEqual([format]);
  });

  it("uniqueValues, the operand-free family, with stopIfTrue", () => {
    const format: ContentSheetConditionalFormat = {
      type: "uniqueValues",
      ranges: [{ startRow: 1, startColumn: 1, endRow: 2, endColumn: 1 }],
      priority: 2,
      stopIfTrue: true,
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      conditionalFormats: [format],
    });
    expect(sheet.conditionalFormats).toEqual([format]);
  });

  it("top10, with percent and a dxf-resolved background style", () => {
    const format: ContentSheetConditionalFormat = {
      type: "top10",
      ranges: [{ startRow: 0, startColumn: 3, endRow: 5, endColumn: 3 }],
      priority: 5,
      rank: 3,
      percent: true,
      style: { background: { r: 0, g: 1, b: 0 } },
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      conditionalFormats: [format],
    });
    expect(sheet.conditionalFormats).toEqual([format]);
  });

  it("aboveAverage, explicit false with equalAverage and stdDev", () => {
    const format: ContentSheetConditionalFormat = {
      type: "aboveAverage",
      ranges: [{ startRow: 0, startColumn: 4, endRow: 3, endColumn: 4 }],
      priority: 6,
      aboveAverage: false,
      equalAverage: true,
      stdDev: 2,
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      conditionalFormats: [format],
    });
    expect(sheet.conditionalFormats).toEqual([format]);
  });

  it("timePeriod, with a dxf-resolved textColor style", () => {
    const format: ContentSheetConditionalFormat = {
      type: "timePeriod",
      ranges: [{ startRow: 0, startColumn: 5, endRow: 0, endColumn: 5 }],
      priority: 7,
      timePeriod: "thisWeek",
      style: { textColor: { r: 0, g: 0, b: 1 } },
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      conditionalFormats: [format],
    });
    expect(sheet.conditionalFormats).toEqual([format]);
  });

  it("dataBar, min/max cfvo and an explicit showValue false", () => {
    const format: ContentSheetConditionalFormat = {
      type: "dataBar",
      ranges: [{ startRow: 0, startColumn: 6, endRow: 4, endColumn: 6 }],
      priority: 8,
      min: { type: "min" },
      max: { type: "max" },
      color: { r: 0, g: 1, b: 0 },
      showValue: false,
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      conditionalFormats: [format],
    });
    expect(sheet.conditionalFormats).toEqual([format]);
  });

  it("iconSet, a non-default iconSetType with reverse and showValue false", () => {
    const format: ContentSheetConditionalFormat = {
      type: "iconSet",
      ranges: [{ startRow: 0, startColumn: 7, endRow: 6, endColumn: 7 }],
      priority: 9,
      iconSetType: "3Arrows",
      thresholds: [
        { type: "percent", value: "0" },
        { type: "percent", value: "33" },
        { type: "percent", value: "67" },
      ],
      reverse: true,
      showValue: false,
    };
    const sheet = roundTripSheet({
      name: "Sheet1",
      conditionalFormats: [format],
    });
    expect(sheet.conditionalFormats).toEqual([format]);
  });
});

describe("assertNeverNonEmptyContentCellValueKind", () => {
  it("throws naming the unhandled kind, proving deriveDisplayText's own exhaustiveness guard actually fires at runtime", () => {
    let caught: unknown;
    try {
      assertNeverNonEmptyContentCellValueKind({ kind: "bogus" } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'deriveDisplayText: unhandled ContentCellValue kind {"kind":"bogus"}',
    );
  });
});

describe("assertNeverNumberFormatClassKind", () => {
  it("throws naming the unhandled kind, proving resolveNumericValue's own exhaustiveness guard actually fires at runtime", () => {
    let caught: unknown;
    try {
      assertNeverNumberFormatClassKind({ kind: "bogus" } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'resolveNumericValue: unhandled NumberFormatClass kind {"kind":"bogus"}',
    );
  });
});
