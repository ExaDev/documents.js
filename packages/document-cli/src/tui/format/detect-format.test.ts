import { describe, expect, it } from "vitest";
import { detectFormat } from "./detect-format";

describe("detectFormat", () => {
  it("infers a format from a recognised extension", () => {
    expect(detectFormat("report.docx")).toBe("docx");
  });

  it("returns undefined for an unrecognised extension", () => {
    expect(detectFormat("archive.zip")).toBeUndefined();
  });
});
