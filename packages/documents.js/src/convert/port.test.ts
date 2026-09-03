import { describe, expect, it } from "vitest";
import { DOCUMENT_FORMATS, DocumentFormatSchema } from "./port";

describe("DocumentFormatSchema / DOCUMENT_FORMATS", () => {
  it("DOCUMENT_FORMATS lists every DocumentFormat member, matching the schema exactly", () => {
    expect(DOCUMENT_FORMATS).toEqual([
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
      "wpd",
      "pdf",
    ]);
    expect(DOCUMENT_FORMATS).toEqual(DocumentFormatSchema.options);
  });

  it("accepts every one of its own listed members", () => {
    for (const format of DOCUMENT_FORMATS) {
      expect(() => DocumentFormatSchema.parse(format)).not.toThrow();
    }
  });

  it("rejects a string that is not a real DocumentFormat", () => {
    expect(() => DocumentFormatSchema.parse("docm")).toThrow();
    expect(() => DocumentFormatSchema.parse("")).toThrow();
  });
});
