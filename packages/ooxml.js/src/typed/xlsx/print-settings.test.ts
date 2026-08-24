import { describe, expect, it } from "vitest";
import { PAGE_SIZE_A4, PAGE_SIZE_LETTER } from "document-schema.js";
import { el } from "../../xml/fragment";
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
