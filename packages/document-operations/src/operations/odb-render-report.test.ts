import { bytesToBase64 } from "documents.js";
import { describe, expect, it } from "vitest";
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
});
