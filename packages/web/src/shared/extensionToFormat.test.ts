import { describe, expect, it } from "vitest";

import { inferFormatFromFilename } from "./extensionToFormat";

describe("inferFormatFromFilename", () => {
  it("maps a plain extension to its format", () => {
    expect(inferFormatFromFilename("report.pdf")).toBe("pdf");
  });

  it("maps every template/macro-enabled OOXML variant to its base format", () => {
    expect(inferFormatFromFilename("a.docx")).toBe("docx");
    expect(inferFormatFromFilename("a.dotx")).toBe("docx");
    expect(inferFormatFromFilename("a.docm")).toBe("docx");
    expect(inferFormatFromFilename("a.pptx")).toBe("pptx");
    expect(inferFormatFromFilename("a.potx")).toBe("pptx");
    expect(inferFormatFromFilename("a.pptm")).toBe("pptx");
    expect(inferFormatFromFilename("a.xlsx")).toBe("xlsx");
    expect(inferFormatFromFilename("a.xltx")).toBe("xlsx");
    expect(inferFormatFromFilename("a.xlsm")).toBe("xlsx");
  });

  it("maps every OpenDocument variant, including the template spellings, to its base format", () => {
    expect(inferFormatFromFilename("a.odt")).toBe("odt");
    expect(inferFormatFromFilename("a.ott")).toBe("odt");
    expect(inferFormatFromFilename("a.odp")).toBe("odp");
    expect(inferFormatFromFilename("a.otp")).toBe("odp");
    expect(inferFormatFromFilename("a.ods")).toBe("ods");
    expect(inferFormatFromFilename("a.ots")).toBe("ods");
    expect(inferFormatFromFilename("a.odg")).toBe("odg");
    expect(inferFormatFromFilename("a.otg")).toBe("odg");
    expect(inferFormatFromFilename("a.odf")).toBe("odf");
    expect(inferFormatFromFilename("a.otf")).toBe("odf");
  });

  it("maps the remaining single-spelling formats", () => {
    expect(inferFormatFromFilename("a.csv")).toBe("csv");
    expect(inferFormatFromFilename("a.svg")).toBe("svg");
    expect(inferFormatFromFilename("a.rtf")).toBe("rtf");
    expect(inferFormatFromFilename("a.doc")).toBe("doc");
    expect(inferFormatFromFilename("a.xls")).toBe("xls");
    expect(inferFormatFromFilename("a.ppt")).toBe("ppt");
    expect(inferFormatFromFilename("a.epub")).toBe("epub");
  });

  it("maps both the 'markdown' and 'md' spellings to the same format", () => {
    expect(inferFormatFromFilename("a.markdown")).toBe("markdown");
    expect(inferFormatFromFilename("a.md")).toBe("markdown");
  });

  it("lowercases the extension before matching", () => {
    expect(inferFormatFromFilename("REPORT.PDF")).toBe("pdf");
    expect(inferFormatFromFilename("Report.Docx")).toBe("docx");
  });

  it("returns undefined for an unrecognised extension", () => {
    expect(inferFormatFromFilename("archive.zip")).toBeUndefined();
  });

  it("returns undefined for a filename with no extension at all", () => {
    expect(inferFormatFromFilename("README")).toBeUndefined();
  });

  it("returns undefined for a dotfile whose only dot is a leading one, not an extension separator", () => {
    expect(inferFormatFromFilename(".gitignore")).toBeUndefined();
  });

  it("resolves the extension from the final path segment, ignoring directory names that themselves contain a dot", () => {
    expect(inferFormatFromFilename("a.b.dir/report.pdf")).toBe("pdf");
  });

  it("resolves the final path segment across a backslash separator too", () => {
    expect(inferFormatFromFilename("C:\\Users\\me\\report.docx")).toBe("docx");
  });

  it("uses the last dot in the final segment when a filename itself contains more than one", () => {
    expect(inferFormatFromFilename("archive.tar.pdf")).toBe("pdf");
  });

  it("returns undefined for a path whose directory segment has a dot but whose final segment has none", () => {
    expect(inferFormatFromFilename("a.dir/README")).toBeUndefined();
  });
});
