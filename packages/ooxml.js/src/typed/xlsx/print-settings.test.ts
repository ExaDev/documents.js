import { describe, expect, it } from "vitest";
import { PAGE_SIZE_A4, PAGE_SIZE_LETTER } from "document-schema.js";
import { el } from "../../xml/fragment";
import type { SheetDefinedNames } from "./defined-names";
import {
  DEFAULT_HEADER_FOOTER_MARGIN_PT,
  readPrintSettings,
} from "./print-settings";

describe("readPrintSettings: page size resolution", () => {
  it("falls back to Letter when the worksheet has no <pageSetup> at all", () => {
    const worksheet = el("worksheet", {}, []);
    const settings = readPrintSettings(worksheet, 0, new Map());
    expect(settings.pageSize).toEqual(PAGE_SIZE_LETTER);
  });

  it('swaps width/height for a known paper code when orientation="landscape"', () => {
    const worksheet = el("worksheet", {}, [
      el("pageSetup", {
        paperSize: "9",
        orientation: "landscape",
        pageOrder: "downThenOver",
      }),
    ]);
    const settings = readPrintSettings(worksheet, 0, new Map());
    expect(settings.pageSize).toEqual({
      widthPt: PAGE_SIZE_A4.heightPt,
      heightPt: PAGE_SIZE_A4.widthPt,
    });
  });

  it('does not swap for an explicit orientation="portrait" or an absent orientation attribute', () => {
    const worksheet = el("worksheet", {}, [
      el("pageSetup", { paperSize: "9", orientation: "portrait" }),
    ]);
    expect(readPrintSettings(worksheet, 0, new Map()).pageSize).toEqual(
      PAGE_SIZE_A4,
    );
    const worksheetNoOrientation = el("worksheet", {}, [
      el("pageSetup", { paperSize: "9" }),
    ]);
    expect(
      readPrintSettings(worksheetNoOrientation, 0, new Map()).pageSize,
    ).toEqual(PAGE_SIZE_A4);
  });

  it("falls back to explicit paperWidth/paperHeight when paperSize is a code this module does not map", () => {
    const worksheet = el("worksheet", {}, [
      el("pageSetup", {
        paperSize: "5",
        paperWidth: "21cm",
        paperHeight: "29.7cm",
      }),
    ]);
    const settings = readPrintSettings(worksheet, 0, new Map());
    expect(settings.pageSize.widthPt).toBeCloseTo(PAGE_SIZE_A4.widthPt, 1);
    expect(settings.pageSize.heightPt).toBeCloseTo(PAGE_SIZE_A4.heightPt, 1);
  });

  it("falls back to Letter when neither paperSize nor a parseable paperWidth/paperHeight is present", () => {
    const worksheet = el("worksheet", {}, [el("pageSetup", {})]);
    expect(readPrintSettings(worksheet, 0, new Map()).pageSize).toEqual(
      PAGE_SIZE_LETTER,
    );
  });
});

describe("DEFAULT_HEADER_FOOTER_MARGIN_PT", () => {
  it("is Excel's Normal-preset 0.3in, exported for typed/xlsx/build.ts to reuse", () => {
    expect(DEFAULT_HEADER_FOOTER_MARGIN_PT).toBeCloseTo(21.6, 5);
  });
});

describe("readPrintSettings: margins", () => {
  it("falls back to the Normal preset when there is no <pageMargins> at all", () => {
    const settings = readPrintSettings(el("worksheet"), 0, new Map());
    expect(settings.margins).toEqual({
      topPt: 54,
      rightPt: 50.4,
      bottomPt: 54,
      leftPt: 50.4,
    });
  });

  it("reads each of top/right/bottom/left independently, falling back per-side when only some are present", () => {
    const worksheet = el("worksheet", {}, [
      el("pageMargins", { top: "1", left: "0.5" }),
    ]);
    const settings = readPrintSettings(worksheet, 0, new Map());
    expect(settings.margins).toEqual({
      topPt: 72,
      rightPt: 50.4,
      bottomPt: 54,
      leftPt: 36,
    });
  });
});

describe("readPrintSettings: pageOrder", () => {
  it("defaults to downThenOver when pageSetup is absent", () => {
    expect(readPrintSettings(el("worksheet"), 0, new Map()).pageOrder).toBe(
      "downThenOver",
    );
  });

  it("defaults to downThenOver for any value other than the literal overThenDown", () => {
    const worksheet = el("worksheet", {}, [
      el("pageSetup", { pageOrder: "bogus" }),
    ]);
    expect(readPrintSettings(worksheet, 0, new Map()).pageOrder).toBe(
      "downThenOver",
    );
  });

  it("reads overThenDown when explicitly stated", () => {
    const worksheet = el("worksheet", {}, [
      el("pageSetup", { pageOrder: "overThenDown" }),
    ]);
    expect(readPrintSettings(worksheet, 0, new Map()).pageOrder).toBe(
      "overThenDown",
    );
  });
});

describe("readPrintSettings: gridlines/headers", () => {
  it("defaults gridlines and headers to false with no <printOptions> at all", () => {
    const settings = readPrintSettings(el("worksheet"), 0, new Map());
    expect(settings.gridlines).toBe(false);
    expect(settings.headers).toBe(false);
  });

  it("reads gridLines/headings independently as true", () => {
    const worksheet = el("worksheet", {}, [
      el("printOptions", { gridLines: "1", headings: "true" }),
    ]);
    const settings = readPrintSettings(worksheet, 0, new Map());
    expect(settings.gridlines).toBe(true);
    expect(settings.headers).toBe(true);
  });
});

describe("readPrintSettings: manual breaks", () => {
  it("omits manualBreaks entirely when neither rowBreaks nor colBreaks is present", () => {
    const settings = readPrintSettings(el("worksheet"), 0, new Map());
    expect(Object.hasOwn(settings, "manualBreaks")).toBe(false);
  });

  it("omits manualBreaks when the containers are present but empty", () => {
    const worksheet = el("worksheet", {}, [
      el("rowBreaks", {}, []),
      el("colBreaks", {}, []),
    ]);
    expect(
      Object.hasOwn(readPrintSettings(worksheet, 0, new Map()), "manualBreaks"),
    ).toBe(false);
  });

  it("reads row and column break indices independently", () => {
    const worksheet = el("worksheet", {}, [
      el("rowBreaks", {}, [el("brk", { id: "3" }), el("brk", { id: "7" })]),
      el("colBreaks", {}, [el("brk", { id: "1" })]),
    ]);
    const settings = readPrintSettings(worksheet, 0, new Map());
    expect(settings.manualBreaks).toEqual({ rows: [3, 7], columns: [1] });
  });

  it("skips a <brk> whose id does not parse as a non-negative integer", () => {
    const worksheet = el("worksheet", {}, [
      el("rowBreaks", {}, [
        el("brk", { id: "abc" }),
        el("brk", { id: "-1" }),
        el("brk", { id: "2" }),
      ]),
    ]);
    const settings = readPrintSettings(worksheet, 0, new Map());
    expect(settings.manualBreaks).toEqual({ rows: [2], columns: [] });
  });
});

describe("readPrintSettings: fit-to-page vs scale", () => {
  it("reads an explicit scalePercent when fitToPage is not set", () => {
    const worksheet = el("worksheet", {}, [el("pageSetup", { scale: "75" })]);
    const settings = readPrintSettings(worksheet, 0, new Map());
    expect(settings.scalePercent).toBe(75);
    expect(Object.hasOwn(settings, "fitToPages")).toBe(false);
  });

  it("omits scalePercent when scale is absent or non-numeric", () => {
    const worksheet = el("worksheet", {}, [
      el("pageSetup", { scale: "not-a-number" }),
    ]);
    const settings = readPrintSettings(worksheet, 0, new Map());
    expect(Object.hasOwn(settings, "scalePercent")).toBe(false);
  });

  it("reads fitToPages width/height when sheetPr/pageSetUpPr@fitToPage is set, ignoring scale", () => {
    const worksheet = el("worksheet", {}, [
      el("sheetPr", {}, [el("pageSetUpPr", { fitToPage: "1" })]),
      el("pageSetup", { scale: "50", fitToWidth: "2", fitToHeight: "3" }),
    ]);
    const settings = readPrintSettings(worksheet, 0, new Map());
    expect(settings.fitToPages).toEqual({ width: 2, height: 3 });
    expect(Object.hasOwn(settings, "scalePercent")).toBe(false);
  });

  it("defaults fitToPages width/height to 1 when fitToPage is set but the attributes are absent", () => {
    const worksheet = el("worksheet", {}, [
      el("sheetPr", {}, [el("pageSetUpPr", { fitToPage: "true" })]),
    ]);
    const settings = readPrintSettings(worksheet, 0, new Map());
    expect(settings.fitToPages).toEqual({ width: 1, height: 1 });
  });
});

describe("readPrintSettings: print area/titles integration", () => {
  it("carries no printRange/repeatRows/repeatColumns when the sheet has no defined names", () => {
    const settings = readPrintSettings(el("worksheet"), 0, new Map());
    expect(Object.hasOwn(settings, "printRange")).toBe(false);
    expect(Object.hasOwn(settings, "repeatRows")).toBe(false);
    expect(Object.hasOwn(settings, "repeatColumns")).toBe(false);
  });

  it("promotes a parseable printArea into printRange, keyed by this sheet's own index", () => {
    const definedNames = new Map<number, SheetDefinedNames>([
      [1, { printArea: "Data!$A$1:$B$2" }],
    ]);
    const settings = readPrintSettings(el("worksheet"), 1, definedNames);
    expect(settings.printRange).toEqual({
      startRow: 0,
      startColumn: 0,
      endRow: 1,
      endColumn: 1,
    });
  });

  it("does not promote a printArea belonging to a DIFFERENT sheet index", () => {
    const definedNames = new Map<number, SheetDefinedNames>([
      [1, { printArea: "Data!$A$1:$B$2" }],
    ]);
    const settings = readPrintSettings(el("worksheet"), 0, definedNames);
    expect(Object.hasOwn(settings, "printRange")).toBe(false);
  });

  it("omits printRange when printArea fails to parse into a range", () => {
    const definedNames = new Map<number, SheetDefinedNames>([
      [0, { printArea: "garbage" }],
    ]);
    const settings = readPrintSettings(el("worksheet"), 0, definedNames);
    expect(Object.hasOwn(settings, "printRange")).toBe(false);
  });

  it("promotes printTitles' repeatRows and repeatColumns independently", () => {
    const definedNames = new Map<number, SheetDefinedNames>([
      [0, { printTitles: "Data!$A:$B,Data!$1:$2" }],
    ]);
    const settings = readPrintSettings(el("worksheet"), 0, definedNames);
    expect(settings.repeatColumns).toEqual({ start: 0, end: 1 });
    expect(settings.repeatRows).toEqual({ start: 0, end: 1 });
  });

  it("omits repeatRows/repeatColumns when printTitles carries neither band", () => {
    const definedNames = new Map<number, SheetDefinedNames>([
      [0, { printTitles: "garbage" }],
    ]);
    const settings = readPrintSettings(el("worksheet"), 0, definedNames);
    expect(Object.hasOwn(settings, "repeatRows")).toBe(false);
    expect(Object.hasOwn(settings, "repeatColumns")).toBe(false);
  });
});
