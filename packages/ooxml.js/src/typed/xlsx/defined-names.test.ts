import { describe, expect, it } from "vitest";
import { el } from "../../xml/fragment";
import type { Package } from "../../model/package";
import {
  XLNM_PRINT_AREA,
  XLNM_PRINT_TITLES,
  buildPrintAreaValue,
  buildPrintTitlesValue,
  parsePrintAreaValue,
  parsePrintTitlesValue,
  quoteSheetNameIfNeeded,
  readDefinedNamesBySheet,
  readWorkbookNames,
} from "./defined-names";

function packageOf(workbook: ReturnType<typeof el> | undefined): Package {
  return {
    parts:
      workbook === undefined
        ? {}
        : {
            "xl/workbook.xml": { kind: "xml", nodes: [workbook] },
          },
  };
}

function workbookWithDefinedNames(
  ...definedNames: ReturnType<typeof el>[]
): ReturnType<typeof el> {
  return el("workbook", {}, [el("definedNames", {}, definedNames)]);
}

describe("readDefinedNamesBySheet", () => {
  it("returns an empty map when xl/workbook.xml is absent entirely", () => {
    expect(readDefinedNamesBySheet(packageOf(undefined))).toEqual(new Map());
  });

  it("returns an empty map when the workbook has no <definedNames> container", () => {
    const pkg = packageOf(el("workbook", {}, []));
    expect(readDefinedNamesBySheet(pkg)).toEqual(new Map());
  });

  it("returns an empty map when <definedNames> has no children", () => {
    const pkg = packageOf(el("workbook", {}, [el("definedNames", {}, [])]));
    expect(readDefinedNamesBySheet(pkg)).toEqual(new Map());
  });

  it("skips a definedName with no name attribute", () => {
    const pkg = packageOf(
      workbookWithDefinedNames(
        el("definedName", { localSheetId: "0" }, [
          { type: "text", value: "A1" },
        ]),
      ),
    );
    expect(readDefinedNamesBySheet(pkg)).toEqual(new Map());
  });

  it("skips a definedName with no localSheetId attribute", () => {
    const pkg = packageOf(
      workbookWithDefinedNames(
        el("definedName", { name: XLNM_PRINT_AREA }, [
          { type: "text", value: "A1" },
        ]),
      ),
    );
    expect(readDefinedNamesBySheet(pkg)).toEqual(new Map());
  });

  it("skips a definedName whose name is neither the print-area nor print-titles reserved name", () => {
    const pkg = packageOf(
      workbookWithDefinedNames(
        el("definedName", { name: "MyRange", localSheetId: "0" }, [
          { type: "text", value: "A1" },
        ]),
      ),
    );
    expect(readDefinedNamesBySheet(pkg)).toEqual(new Map());
  });

  it("skips a definedName whose localSheetId does not parse as an integer", () => {
    const pkg = packageOf(
      workbookWithDefinedNames(
        el("definedName", { name: XLNM_PRINT_AREA, localSheetId: "abc" }, [
          { type: "text", value: "A1" },
        ]),
      ),
    );
    expect(readDefinedNamesBySheet(pkg)).toEqual(new Map());
  });

  it("skips a definedName whose localSheetId is negative", () => {
    const pkg = packageOf(
      workbookWithDefinedNames(
        el("definedName", { name: XLNM_PRINT_AREA, localSheetId: "-1" }, [
          { type: "text", value: "A1" },
        ]),
      ),
    );
    expect(readDefinedNamesBySheet(pkg)).toEqual(new Map());
  });

  it("reads a print-area defined name into printArea for its own sheet index", () => {
    const pkg = packageOf(
      workbookWithDefinedNames(
        el("definedName", { name: XLNM_PRINT_AREA, localSheetId: "2" }, [
          { type: "text", value: "Data!$A$1:$I$20" },
        ]),
      ),
    );
    expect(readDefinedNamesBySheet(pkg)).toEqual(
      new Map([[2, { printArea: "Data!$A$1:$I$20" }]]),
    );
  });

  it("reads a print-titles defined name into printTitles for its own sheet index", () => {
    const pkg = packageOf(
      workbookWithDefinedNames(
        el("definedName", { name: XLNM_PRINT_TITLES, localSheetId: "0" }, [
          { type: "text", value: "Data!$A:$A" },
        ]),
      ),
    );
    expect(readDefinedNamesBySheet(pkg)).toEqual(
      new Map([[0, { printTitles: "Data!$A:$A" }]]),
    );
  });

  it("merges a print-area and a print-titles entry for the same sheet index into one record", () => {
    const pkg = packageOf(
      workbookWithDefinedNames(
        el("definedName", { name: XLNM_PRINT_AREA, localSheetId: "0" }, [
          { type: "text", value: "Data!$A$1:$I$20" },
        ]),
        el("definedName", { name: XLNM_PRINT_TITLES, localSheetId: "0" }, [
          { type: "text", value: "Data!$A:$A" },
        ]),
      ),
    );
    expect(readDefinedNamesBySheet(pkg)).toEqual(
      new Map([
        [0, { printArea: "Data!$A$1:$I$20", printTitles: "Data!$A:$A" }],
      ]),
    );
  });

  it("keeps separate sheets' entries distinct", () => {
    const pkg = packageOf(
      workbookWithDefinedNames(
        el("definedName", { name: XLNM_PRINT_AREA, localSheetId: "0" }, [
          { type: "text", value: "A1:B2" },
        ]),
        el("definedName", { name: XLNM_PRINT_AREA, localSheetId: "1" }, [
          { type: "text", value: "C1:D2" },
        ]),
      ),
    );
    expect(readDefinedNamesBySheet(pkg)).toEqual(
      new Map([
        [0, { printArea: "A1:B2" }],
        [1, { printArea: "C1:D2" }],
      ]),
    );
  });
});

describe("readWorkbookNames", () => {
  it("returns an empty array when xl/workbook.xml is absent entirely", () => {
    expect(readWorkbookNames(packageOf(undefined))).toEqual([]);
  });

  it("returns an empty array when the workbook has no <definedNames> container", () => {
    expect(readWorkbookNames(packageOf(el("workbook", {}, [])))).toEqual([]);
  });

  it("skips a definedName with no name attribute", () => {
    const pkg = packageOf(
      workbookWithDefinedNames(
        el("definedName", {}, [{ type: "text", value: "A1" }]),
      ),
    );
    expect(readWorkbookNames(pkg)).toEqual([]);
  });

  it("reads a workbook-scoped name (no localSheetId) with no scopeSheetIndex key at all", () => {
    const pkg = packageOf(
      workbookWithDefinedNames(
        el("definedName", { name: "MyRange" }, [
          { type: "text", value: "Sheet1!$A$1" },
        ]),
      ),
    );
    const names = readWorkbookNames(pkg);
    expect(names).toEqual([{ name: "MyRange", refersTo: "Sheet1!$A$1" }]);
    expect(Object.hasOwn(names[0] ?? {}, "scopeSheetIndex")).toBe(false);
  });

  it("reads a sheet-scoped name's localSheetId into scopeSheetIndex", () => {
    const pkg = packageOf(
      workbookWithDefinedNames(
        el("definedName", { name: "MyRange", localSheetId: "3" }, [
          { type: "text", value: "A1" },
        ]),
      ),
    );
    expect(readWorkbookNames(pkg)).toEqual([
      { name: "MyRange", refersTo: "A1", scopeSheetIndex: 3 },
    ]);
  });

  it("omits scopeSheetIndex, rather than a garbage value, when localSheetId does not parse as an integer", () => {
    const pkg = packageOf(
      workbookWithDefinedNames(
        el("definedName", { name: "MyRange", localSheetId: "xyz" }, [
          { type: "text", value: "A1" },
        ]),
      ),
    );
    const names = readWorkbookNames(pkg);
    expect(names).toEqual([{ name: "MyRange", refersTo: "A1" }]);
    expect(Object.hasOwn(names[0] ?? {}, "scopeSheetIndex")).toBe(false);
  });

  it("omits scopeSheetIndex when localSheetId is negative", () => {
    const pkg = packageOf(
      workbookWithDefinedNames(
        el("definedName", { name: "MyRange", localSheetId: "-2" }, [
          { type: "text", value: "A1" },
        ]),
      ),
    );
    const names = readWorkbookNames(pkg);
    expect(names).toEqual([{ name: "MyRange", refersTo: "A1" }]);
    expect(Object.hasOwn(names[0] ?? {}, "scopeSheetIndex")).toBe(false);
  });

  it("includes the reserved _xlnm.Print_Area/Print_Titles names like any other defined name", () => {
    const pkg = packageOf(
      workbookWithDefinedNames(
        el("definedName", { name: XLNM_PRINT_AREA, localSheetId: "0" }, [
          { type: "text", value: "Data!$A$1:$I$20" },
        ]),
      ),
    );
    expect(readWorkbookNames(pkg)).toEqual([
      {
        name: XLNM_PRINT_AREA,
        refersTo: "Data!$A$1:$I$20",
        scopeSheetIndex: 0,
      },
    ]);
  });

  it("preserves the file's own document order across multiple names", () => {
    const pkg = packageOf(
      workbookWithDefinedNames(
        el("definedName", { name: "Second" }, [{ type: "text", value: "B1" }]),
        el("definedName", { name: "First" }, [{ type: "text", value: "A1" }]),
      ),
    );
    expect(readWorkbookNames(pkg).map((n) => n.name)).toEqual([
      "Second",
      "First",
    ]);
  });
});

describe("parsePrintAreaValue", () => {
  it("parses a single unquoted, undollared range", () => {
    expect(parsePrintAreaValue("A1:B2")).toEqual({
      startRow: 0,
      startColumn: 0,
      endRow: 1,
      endColumn: 1,
    });
  });

  it("strips a sheet-name prefix before parsing", () => {
    expect(parsePrintAreaValue("Data!$A$1:$I$20")).toEqual({
      startRow: 0,
      startColumn: 0,
      endRow: 19,
      endColumn: 8,
    });
  });

  it("strips a quoted sheet-name prefix containing a space", () => {
    expect(parsePrintAreaValue("'My Sheet'!$A$1:$B$2")).toEqual({
      startRow: 0,
      startColumn: 0,
      endRow: 1,
      endColumn: 1,
    });
  });

  it("uses only the FIRST of several comma-separated ranges", () => {
    expect(parsePrintAreaValue("A1:B2,D1:E2")).toEqual({
      startRow: 0,
      startColumn: 0,
      endRow: 1,
      endColumn: 1,
    });
  });

  it("trims surrounding whitespace around the first segment", () => {
    expect(parsePrintAreaValue("  A1:B2  ,D1:E2")).toEqual({
      startRow: 0,
      startColumn: 0,
      endRow: 1,
      endColumn: 1,
    });
  });

  it("returns undefined for an empty string", () => {
    expect(parsePrintAreaValue("")).toBeUndefined();
  });

  it("returns undefined for a whitespace-only string", () => {
    expect(parsePrintAreaValue("   ")).toBeUndefined();
  });

  it("returns undefined for a value that does not parse as a range", () => {
    expect(parsePrintAreaValue("not a range")).toBeUndefined();
  });
});

describe("parsePrintTitlesValue", () => {
  it("reads a full-column band into repeatColumns, leaving repeatRows unset", () => {
    const result = parsePrintTitlesValue("Data!$A:$C");
    expect(result).toEqual({ repeatColumns: { start: 0, end: 2 } });
    expect(Object.hasOwn(result, "repeatRows")).toBe(false);
  });

  it("reads a full-row band into repeatRows, leaving repeatColumns unset", () => {
    const result = parsePrintTitlesValue("Data!$1:$3");
    expect(result).toEqual({ repeatRows: { start: 0, end: 2 } });
    expect(Object.hasOwn(result, "repeatColumns")).toBe(false);
  });

  it("reads both bands from a comma-separated value", () => {
    expect(parsePrintTitlesValue("Data!$A:$C,Data!$1:$3")).toEqual({
      repeatColumns: { start: 0, end: 2 },
      repeatRows: { start: 0, end: 2 },
    });
  });

  it("trims whitespace directly touching a comma-separated segment before parsing it", () => {
    expect(parsePrintTitlesValue(" Data!$A:$C , Data!$1:$3 ")).toEqual({
      repeatColumns: { start: 0, end: 2 },
      repeatRows: { start: 0, end: 2 },
    });
  });

  it("reads a genuine multi-digit row band, not just a single digit", () => {
    expect(parsePrintTitlesValue("10:25")).toEqual({
      repeatRows: { start: 9, end: 24 },
    });
  });

  it("rejects a row segment with a non-digit character before the digits", () => {
    expect(parsePrintTitlesValue("x3:5")).toEqual({});
  });

  it("rejects a row segment with a non-digit character after the digits", () => {
    expect(parsePrintTitlesValue("3x:5")).toEqual({});
  });

  it("rejects a row segment whose end spec has a non-digit character before its digits", () => {
    expect(parsePrintTitlesValue("3:x5")).toEqual({});
  });

  it("rejects a row segment whose end spec has a non-digit character after its digits", () => {
    expect(parsePrintTitlesValue("3:5x")).toEqual({});
  });

  it("rejects a mixed digit/letter segment as neither a column nor a row band", () => {
    expect(parsePrintTitlesValue("1:A")).toEqual({});
  });

  it("normalises a reversed column band (end before start) to ascending order", () => {
    expect(parsePrintTitlesValue("$C:$A")).toEqual({
      repeatColumns: { start: 0, end: 2 },
    });
  });

  it("normalises a reversed row band (end before start) to ascending order", () => {
    expect(parsePrintTitlesValue("$3:$1")).toEqual({
      repeatRows: { start: 0, end: 2 },
    });
  });

  it("skips a segment with no ':' separator at all", () => {
    expect(parsePrintTitlesValue("garbage")).toEqual({});
  });

  it("skips a segment shaped as a genuine cell-to-cell range, matching neither band shape", () => {
    expect(parsePrintTitlesValue("A1:B2")).toEqual({});
  });

  it("returns an empty object for an empty string", () => {
    expect(parsePrintTitlesValue("")).toEqual({});
  });
});

describe("quoteSheetNameIfNeeded", () => {
  it("leaves a plain identifier-shaped name unquoted", () => {
    expect(quoteSheetNameIfNeeded("Sheet1")).toBe("Sheet1");
  });

  it("leaves an underscore-led name unquoted", () => {
    expect(quoteSheetNameIfNeeded("_Hidden")).toBe("_Hidden");
  });

  it("quotes a name containing a space", () => {
    expect(quoteSheetNameIfNeeded("My Sheet")).toBe("'My Sheet'");
  });

  it("quotes a name starting with a digit", () => {
    expect(quoteSheetNameIfNeeded("1stQuarter")).toBe("'1stQuarter'");
  });

  it("quotes a name and doubles an embedded single quote", () => {
    expect(quoteSheetNameIfNeeded("Joe's Sheet")).toBe("'Joe''s Sheet'");
  });
});

describe("buildPrintAreaValue", () => {
  it("builds a dollared, sheet-qualified reference for a plain sheet name", () => {
    expect(
      buildPrintAreaValue("Data", {
        startRow: 0,
        startColumn: 0,
        endRow: 19,
        endColumn: 8,
      }),
    ).toBe("Data!$A$1:$I$20");
  });

  it("quotes the sheet name when it needs it", () => {
    expect(
      buildPrintAreaValue("My Sheet", {
        startRow: 0,
        startColumn: 0,
        endRow: 1,
        endColumn: 1,
      }),
    ).toBe("'My Sheet'!$A$1:$B$2");
  });

  it("round-trips through parsePrintAreaValue", () => {
    const range = { startRow: 2, startColumn: 1, endRow: 5, endColumn: 4 };
    const built = buildPrintAreaValue("Sheet1", range);
    expect(parsePrintAreaValue(built)).toEqual(range);
  });

  it("writes a genuine multi-letter column reference beyond Z", () => {
    // Column index 26 is "AA" -- a single-letter column would not distinguish a regex/loop that stops after one character.
    expect(
      buildPrintAreaValue("Sheet1", {
        startRow: 0,
        startColumn: 26,
        endRow: 0,
        endColumn: 26,
      }),
    ).toBe("Sheet1!$AA$1:$AA$1");
  });
});

describe("buildPrintTitlesValue", () => {
  it("returns undefined when neither band is present", () => {
    expect(
      buildPrintTitlesValue("Sheet1", undefined, undefined),
    ).toBeUndefined();
  });

  it("builds only the rows segment when only repeatRows is present", () => {
    expect(
      buildPrintTitlesValue("Sheet1", { start: 0, end: 2 }, undefined),
    ).toBe("Sheet1!$1:$3");
  });

  it("builds only the columns segment when only repeatColumns is present", () => {
    expect(
      buildPrintTitlesValue("Sheet1", undefined, { start: 0, end: 2 }),
    ).toBe("Sheet1!$A:$C");
  });

  it("orders the columns segment before the rows segment when both are present", () => {
    expect(
      buildPrintTitlesValue(
        "Sheet1",
        { start: 0, end: 2 },
        { start: 0, end: 1 },
      ),
    ).toBe("Sheet1!$A:$B,Sheet1!$1:$3");
  });

  it("round-trips through parsePrintTitlesValue", () => {
    const built = buildPrintTitlesValue(
      "Data",
      { start: 3, end: 5 },
      { start: 0, end: 1 },
    );
    expect(built).toBeDefined();
    expect(parsePrintTitlesValue(built ?? "")).toEqual({
      repeatRows: { start: 3, end: 5 },
      repeatColumns: { start: 0, end: 1 },
    });
  });
});
