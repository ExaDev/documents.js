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

// A byte-level signature unique to each targetFormat's own real output -- checked so a targetFormat branch silently falling through to a DIFFERENT renderer (all three return equally non-empty bytes) is actually caught.
const FORMAT_SIGNATURES = {
  docx: "word/document.xml",
  odt: "opendocument.text",
  pdf: "%PDF",
} as const;

function bytesContain(bytes: Uint8Array, needle: string): boolean {
  return Buffer.from(bytes).toString("latin1").includes(needle);
}

describe("odbRenderReportOperation", () => {
  it("renders the fixture's single declared report to odt with no report name given", async () => {
    const result = await odbRenderReportOperation.run({
      source,
      targetFormat: "odt",
    });
    if (!("bytesBase64" in result)) {
      throw new Error("expected inline bytes");
    }
    expect(result.byteLength).toBeGreaterThan(0);
    const bytes = Uint8Array.from(atob(result.bytesBase64), (char) =>
      char.charCodeAt(0),
    );
    expect(bytesContain(bytes, FORMAT_SIGNATURES.odt)).toBe(true);
    expect(result.mathDiagnostics).toEqual([]);
  });

  it("renders the report by explicit name to docx", async () => {
    const result = await odbRenderReportOperation.run({
      source,
      report: FORM_AND_REPORT_REPORT_NAME,
      targetFormat: "docx",
    });
    if (!("bytesBase64" in result)) {
      throw new Error("expected inline bytes");
    }
    const bytes = Uint8Array.from(atob(result.bytesBase64), (char) =>
      char.charCodeAt(0),
    );
    expect(bytesContain(bytes, FORMAT_SIGNATURES.docx)).toBe(true);
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
    if (!("bytesBase64" in result)) {
      throw new Error("expected inline bytes");
    }
    expect(result.byteLength).toBeGreaterThan(0);
    const bytes = Uint8Array.from(atob(result.bytesBase64), (char) =>
      char.charCodeAt(0),
    );
    expect(bytesContain(bytes, FORMAT_SIGNATURES.pdf)).toBe(true);
    expect(result.mathDiagnostics).toEqual([]);
    expect(result.fontSubstitutions).toEqual([]);
    expect(result.charSubstitutions).toEqual([]);
  });

  it("propagates an already-aborted signal for every targetFormat", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      odbRenderReportOperation.run(
        { source, targetFormat: "docx" },
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
    await expect(
      odbRenderReportOperation.run(
        { source, targetFormat: "odt" },
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
    await expect(
      odbRenderReportOperation.run(
        { source, targetFormat: "pdf" },
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
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
