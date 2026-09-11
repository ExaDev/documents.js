import { describe, expect, it } from "vitest";
import { fixedClock } from "../../ports/clock";
import { createXls, openXls } from "./editor";

const FIXED_ISO = "2026-01-01T00:00:00.000Z";

describe("createXls", () => {
  it("builds a one-sheet workbook with real metadata timestamps", () => {
    const editor = createXls({
      clock: fixedClock(new Date(FIXED_ISO)),
    });
    expect(editor.sheets()).toHaveLength(1);
    expect(editor.sheets()[0]!.name).toBe("Sheet1");
    expect(editor.metadata.createdIso).toBe(FIXED_ISO);
  });

  it("round-trips an empty workbook through toBytes and openXls", () => {
    const editor = createXls();
    const reread = openXls(editor.toBytes());
    expect(reread.sheets()).toHaveLength(1);
    expect(reread.sheets()[0]!.name).toBe("Sheet1");
    expect(reread.sheets()[0]!.cells()).toHaveLength(0);
  });
});

describe("XlsEditor cell values", () => {
  it("round-trips a value of every kind the writer encodes", () => {
    const editor = createXls();
    const sheet = editor.sheets()[0]!;
    sheet.cell(0, 0).value = { kind: "string", value: "label" };
    sheet.cell(0, 1).value = { kind: "number", value: 42.5 };
    sheet.cell(1, 0).value = { kind: "boolean", value: true };
    sheet.cell(1, 1).value = { kind: "percentage", value: 0.25 };
    sheet.cell(2, 0).value = {
      kind: "currency",
      value: 7.99,
      currency: "USD",
    };
    sheet.cell(2, 1).value = { kind: "date", value: "2026-01-01" };

    const reread = openXls(editor.toBytes()).sheets()[0]!;
    expect(reread.cell(0, 0).value).toEqual({ kind: "string", value: "label" });
    expect(reread.cell(0, 1).value).toEqual({ kind: "number", value: 42.5 });
    expect(reread.cell(1, 0).value).toEqual({ kind: "boolean", value: true });
    expect(reread.cell(1, 1).value).toEqual({
      kind: "percentage",
      value: 0.25,
    });
    // A currency cell's ISO code survives the round trip through the writer's [$USD]-shaped bracket format -- the one carrier the reader can re-classify the code back out of, the identical encoding ooxml.js's xlsx writer states for the same schema field.
    expect(reread.cell(2, 0).value).toEqual({
      kind: "currency",
      value: 7.99,
      currency: "USD",
    });
    expect(reread.cell(2, 1).value).toEqual({
      kind: "date",
      value: "2026-01-01",
    });
  });

  it("derives displayText from the value, and keeps an explicit override", () => {
    const editor = createXls();
    const sheet = editor.sheets()[0]!;
    const cell = sheet.cell(0, 0);
    cell.value = { kind: "number", value: 1200 };
    expect(cell.displayText).toBe("1200");
    cell.displayText = "1,200.00";
    expect(cell.displayText).toBe("1,200.00");

    const reread = openXls(editor.toBytes()).sheets()[0]!;
    // The mechanical rendering is what survives the round trip: xls-codec's writer writes the typed value and the reader re-derives its own rendered string, so a caller's locale-specific displayText is the one thing a re-read does not promise back.
    expect(reread.cell(0, 0).value).toEqual({ kind: "number", value: 1200 });
    expect(reread.cell(0, 0).displayText).toBe("1200");
  });

  it("creates a far-from-origin cell as one sparse entry, not a materialised grid", () => {
    const editor = createXls();
    const sheet = editor.sheets()[0]!;
    sheet.cell(500, 50).value = { kind: "boolean", value: true };
    expect(sheet.cells()).toHaveLength(1);
    const reread = openXls(editor.toBytes()).sheets()[0]!;
    expect(reread.cell(500, 50).value).toEqual({
      kind: "boolean",
      value: true,
    });
  });

  it("refuses coordinates outside BIFF8's grid", () => {
    const sheet = createXls().sheets()[0]!;
    expect(() => sheet.cell(65536, 0)).toThrow(/row 65536/);
    expect(() => sheet.cell(0, 256)).toThrow(/column 256/);
  });
});

describe("XlsEditor merges and decoration", () => {
  it("round-trips a merged cell region's anchor span", () => {
    const editor = createXls();
    const cell = editor.sheets()[0]!.cell(0, 0);
    cell.value = { kind: "string", value: "merged" };
    cell.colSpan = 2;
    cell.rowSpan = 2;

    const reread = openXls(editor.toBytes()).sheets()[0]!;
    const anchor = reread.cell(0, 0);
    expect(anchor.value).toEqual({ kind: "string", value: "merged" });
    expect(anchor.colSpan).toBe(2);
    expect(anchor.rowSpan).toBe(2);
  });

  it("round-trips a cell's number format code", () => {
    const editor = createXls();
    const cell = editor.sheets()[0]!.cell(0, 0);
    cell.value = { kind: "number", value: 0.42 };
    cell.numberFormatCode = "0.00%";

    const reread = openXls(editor.toBytes()).sheets()[0]!;
    expect(reread.cell(0, 0).numberFormatCode).toBe("0.00%");
  });

  it("round-trips a solid background fill and alignment", () => {
    const editor = createXls();
    const cell = editor.sheets()[0]!.cell(1, 2);
    cell.value = { kind: "string", value: "painted" };
    cell.background = { kind: "solid", color: { r: 1, g: 0.5, b: 0 } };
    cell.alignment = "center";

    const reread = openXls(editor.toBytes()).sheets()[0]!;
    // BIFF8 states a fill through its 8-bit palette, so the colour quantises: 0.5 lands on palette byte 128 and reads back as 128/255.
    expect(reread.cell(1, 2).background).toEqual({
      kind: "solid",
      color: { r: 1, g: 128 / 255, b: 0 },
    });
    expect(reread.cell(1, 2).alignment).toBe("center");
  });
});

describe("XlsEditor sheet geometry", () => {
  it("round-trips a column width, row height, and hidden flags", () => {
    const editor = createXls();
    const sheet = editor.sheets()[0]!;
    sheet.setColumnWidth(0, 72);
    sheet.setColumnHidden(1, true);
    sheet.setRowHeight(0, 24);
    sheet.setRowHidden(2, true);

    const reread = openXls(editor.toBytes()).sheets()[0]!;
    const width = reread.columns().find((c) => c.index === 0)?.widthPt;
    expect(width).toBeCloseTo(72, 0);
    expect(reread.columns().find((c) => c.index === 1)?.hidden).toBe(true);
    const height = reread.rows().find((r) => r.index === 0)?.heightPt;
    expect(height).toBeCloseTo(24, 0);
    expect(reread.rows().find((r) => r.index === 2)?.hidden).toBe(true);
  });

  it("round-trips a sheet's print settings", () => {
    const editor = createXls();
    const sheet = editor.sheets()[0]!;
    sheet.printSettings = {
      ...sheet.printSettings,
      gridlines: false,
      headers: false,
    };

    const reread = openXls(editor.toBytes()).sheets()[0]!;
    expect(reread.printSettings.gridlines).toBe(false);
    expect(reread.printSettings.headers).toBe(false);
  });
});

describe("XlsEditor workbook shape", () => {
  it("adds, renames, and removes sheets", () => {
    const editor = createXls();
    const second = editor.addSheet("Data");
    second.cell(0, 0).value = { kind: "number", value: 1 };
    expect(editor.sheets()).toHaveLength(2);

    const reread = openXls(editor.toBytes());
    expect(reread.sheets().map((s) => s.name)).toEqual(["Sheet1", "Data"]);
    reread.sheets()[1]!.name = "Renamed";
    expect(openXls(reread.toBytes()).sheets()[1]!.name).toBe("Renamed");

    reread.removeSheetAt(0);
    expect(reread.sheets().map((s) => s.name)).toEqual(["Renamed"]);
  });

  it("refuses to remove the last sheet", () => {
    const editor = createXls();
    expect(() => {
      editor.sheets()[0]!.remove();
    }).toThrow(/at least one sheet/);
    expect(() => {
      editor.removeSheetAt(0);
    }).toThrow(/at least one sheet/);
  });

  it("round-trips workbook metadata through the summary stream", () => {
    const editor = createXls();
    editor.metadata = { ...editor.metadata, title: "Quarterly numbers" };
    const reread = openXls(editor.toBytes());
    expect(reread.metadata.title).toBe("Quarterly numbers");
  });

  it("finds a sheet by name and answers undefined for an unknown one", () => {
    const editor = createXls();
    expect(editor.sheet("Sheet1")).toBeDefined();
    expect(editor.sheet("nope")).toBeUndefined();
  });
});

describe("XlsEditor live-view contract", () => {
  it("mutating through a removed handle throws", () => {
    const sheet = createXls().sheets()[0]!;
    const cell = sheet.cell(0, 0);
    cell.remove();
    expect(() => {
      cell.value = { kind: "number", value: 1 };
    }).toThrow(/removed/);
  });

  it("cells() re-reads the sparse array on every call", () => {
    const sheet = createXls().sheets()[0]!;
    const before = sheet.cells();
    expect(before).toHaveLength(0);
    sheet.cell(0, 0).value = { kind: "number", value: 1 };
    expect(sheet.cells()).toHaveLength(1);
    expect(before).toHaveLength(0);
  });
});
