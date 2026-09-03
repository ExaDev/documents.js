import { describe, expect, it } from "vitest";
import {
  formatToExtension,
  inferFormatFromExtension,
  isDocumentFormat,
} from "./format";

describe("isDocumentFormat", () => {
  it("accepts every recognised format string", () => {
    for (const format of [
      "docx",
      "pptx",
      "xlsx",
      "odt",
      "odp",
      "ods",
      "odg",
      "svg",
      "odf",
      "csv",
      "markdown",
      "rtf",
      "pdf",
    ]) {
      expect(isDocumentFormat(format)).toBe(true);
    }
  });

  it("rejects an unrecognised format string", () => {
    expect(isDocumentFormat("odm")).toBe(false);
    expect(isDocumentFormat("odb")).toBe(false);
    expect(isDocumentFormat("")).toBe(false);
  });
});

describe("inferFormatFromExtension", () => {
  it("infers a format from a plain filename", () => {
    expect(inferFormatFromExtension("report.docx")).toBe("docx");
  });

  it("infers a format from a path with multiple directory segments", () => {
    expect(inferFormatFromExtension("a/b/report.pdf")).toBe("pdf");
  });

  it("is case-insensitive on the extension", () => {
    expect(inferFormatFromExtension("REPORT.DOCX")).toBe("docx");
  });

  it("returns undefined for the stdin/stdout marker", () => {
    expect(inferFormatFromExtension("-")).toBeUndefined();
  });

  it("returns undefined for a path with no extension", () => {
    expect(inferFormatFromExtension("README")).toBeUndefined();
  });

  it("returns undefined for a dotfile with no further extension", () => {
    expect(inferFormatFromExtension(".gitignore")).toBeUndefined();
  });

  it("returns undefined for an unrecognised extension", () => {
    expect(inferFormatFromExtension("archive.zip")).toBeUndefined();
  });

  it("returns undefined for the .odm and .odb extensions this module deliberately does not classify", () => {
    expect(inferFormatFromExtension("book.odm")).toBeUndefined();
    expect(inferFormatFromExtension("database.odb")).toBeUndefined();
  });

  it("infers markdown from both its recognised extensions", () => {
    expect(inferFormatFromExtension("notes.md")).toBe("markdown");
    expect(inferFormatFromExtension("notes.markdown")).toBe("markdown");
  });

  it("infers each ODF template extension as its base format", () => {
    expect(inferFormatFromExtension("letter.ott")).toBe("odt");
    expect(inferFormatFromExtension("budget.ots")).toBe("ods");
    expect(inferFormatFromExtension("deck.otp")).toBe("odp");
    expect(inferFormatFromExtension("drawing.otg")).toBe("odg");
    expect(inferFormatFromExtension("formula.otf")).toBe("odf");
  });

  it("infers each OOXML template and macro-enabled extension as its base format", () => {
    expect(inferFormatFromExtension("template.dotx")).toBe("docx");
    expect(inferFormatFromExtension("deck.potx")).toBe("pptx");
    expect(inferFormatFromExtension("book.xltx")).toBe("xlsx");
    expect(inferFormatFromExtension("macro.docm")).toBe("docx");
    expect(inferFormatFromExtension("macro.xlsm")).toBe("xlsx");
    expect(inferFormatFromExtension("macro.pptm")).toBe("pptx");
  });

  it("infers the csv and svg text formats from their own extensions", () => {
    expect(inferFormatFromExtension("table.csv")).toBe("csv");
    expect(inferFormatFromExtension("drawing.svg")).toBe("svg");
  });

  it("infers rtf from its own extension", () => {
    expect(inferFormatFromExtension("letter.rtf")).toBe("rtf");
  });
});

describe("formatToExtension", () => {
  // Not `formatToExtension(format) === format` any more: markdown breaks that identity (two extensions read as 'markdown', but only one -- 'md' -- is written), so this is an explicit lookup table instead, matching FORMAT_TO_EXTENSION's own canonical choice one entry at a time rather than asserting a shortcut that no longer holds for every format. A typed tuple array, not `Object.entries` over a Record, so each format literal narrows on its own -- no type assertion needed to hand it back to formatToExtension.
  it("maps every recognised format to its own canonical extension", () => {
    const cases: readonly (readonly [
      Parameters<typeof formatToExtension>[0],
      string,
    ])[] = [
      ["docx", "docx"],
      ["pptx", "pptx"],
      ["xlsx", "xlsx"],
      ["odt", "odt"],
      ["odp", "odp"],
      ["ods", "ods"],
      ["odg", "odg"],
      ["odf", "odf"],
      ["svg", "svg"],
      ["csv", "csv"],
      ["markdown", "md"],
      ["rtf", "rtf"],
      ["pdf", "pdf"],
    ];
    for (const [format, extension] of cases) {
      expect(formatToExtension(format)).toBe(extension);
    }
  });
});
