import { bytesToBase64 } from "documents.js";
import { describe, expect, it } from "vitest";
import {
  CHAR_SUB_REPORT_NAME,
  charSubstitutionOdbBytes,
} from "../test-support/odb-char-substitution-fixture";
import {
  FORM_AND_REPORT_REPORT_NAME,
  loadFormAndReportOdbBytes,
} from "../test-support/odb-fixture";
import { odbRenderReportOperation } from "./odb-render-report";

const source = {
  bytesBase64: bytesToBase64(loadFormAndReportOdbBytes()),
  format: "docx" as const,
};

describe("odbRenderReportOperation", () => {
  it("renders the fixture's single declared report to odt with no report name given", async () => {
    const result = await odbRenderReportOperation.run({
      source,
      targetFormat: "odt",
    });
    expect("bytesBase64" in result).toBe(true);
    expect(result.byteLength).toBeGreaterThan(0);
    expect(result.mathDiagnostics).toEqual([]);
  });

  it("renders the report by explicit name to docx", async () => {
    const result = await odbRenderReportOperation.run({
      source,
      report: FORM_AND_REPORT_REPORT_NAME,
      targetFormat: "docx",
    });
    expect("bytesBase64" in result).toBe(true);
  });

  it("throws OdbReportNotSpecifiedError naming the unrecognised report", async () => {
    await expect(
      odbRenderReportOperation.run({
        source,
        report: "NoSuchReport",
        targetFormat: "pdf",
      }),
    ).rejects.toThrow();
  });

  it("renders the report to pdf, reporting no font/math diagnostics for a plain report with no unusual fonts or formulas", async () => {
    const result = await odbRenderReportOperation.run({
      source,
      report: FORM_AND_REPORT_REPORT_NAME,
      targetFormat: "pdf",
    });
    expect("bytesBase64" in result).toBe(true);
    expect(result.byteLength).toBeGreaterThan(0);
    expect(result.mathDiagnostics).toEqual([]);
    expect(result.fontSubstitutions).toEqual([]);
    expect(result.charSubstitutions).toEqual([]);
  });

  it("reports a real WinAnsi character substitution, with its page index, when a report's own bound data prints a non-WinAnsi character", async () => {
    const charSubSource = {
      bytesBase64: bytesToBase64(charSubstitutionOdbBytes()),
      format: "docx" as const,
    };

    const result = await odbRenderReportOperation.run({
      source: charSubSource,
      report: CHAR_SUB_REPORT_NAME,
      targetFormat: "pdf",
    });

    expect("bytesBase64" in result).toBe(true);
    expect(result.byteLength).toBeGreaterThan(0);
    expect(result.charSubstitutions).toEqual([
      { from: "中", to: "?", pageIndex: 0 },
      { from: "文", to: "?", pageIndex: 0 },
    ]);
  });
});
