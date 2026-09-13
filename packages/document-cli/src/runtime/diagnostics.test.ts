import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiagnosticReporter,
  createFontSubstitutionReporter,
  fontSubstitutionToDiagnostic,
  pdfDiagnosticToDiagnostic,
  substitutionToDiagnostic,
} from "./diagnostics";

function spyOnStderr(): { calls(): string[]; restore(): void } {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  });
  return {
    calls: () => chunks,
    restore: () => {
      spy.mockRestore();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createDiagnosticReporter", () => {
  it("writes nothing when quiet is true", () => {
    const stderr = spyOnStderr();
    const reporter = createDiagnosticReporter({
      json: false,
      quiet: true,
      command: "docx-to-pdf",
    });
    reporter.report({ severity: "warning", code: "x", message: "m" });
    expect(stderr.calls()).toEqual([]);
  });

  it("writes a human-readable line with severity, code, and message", () => {
    const stderr = spyOnStderr();
    const reporter = createDiagnosticReporter({
      json: false,
      quiet: false,
      command: "docx-to-pdf",
    });
    reporter.report({ severity: "warning", code: "x/y", message: "boom" });
    expect(stderr.calls()).toEqual(["[docx-to-pdf] warning x/y: boom\n"]);
  });

  it("appends the page clause only when a pageIndex is present", () => {
    const stderr = spyOnStderr();
    const reporter = createDiagnosticReporter({
      json: false,
      quiet: false,
      command: "pdf-to-docx",
    });
    reporter.report({
      severity: "info",
      code: "c",
      message: "m",
      pageIndex: 3,
    });
    expect(stderr.calls()).toEqual(["[pdf-to-docx] info c: m (page 3)\n"]);
  });

  it("emits an NDJSON diagnostic record in json mode, tagged with the command", () => {
    const stderr = spyOnStderr();
    const reporter = createDiagnosticReporter({
      json: true,
      quiet: false,
      command: "docx-to-pdf",
    });
    reporter.report({ severity: "warning", code: "x", message: "m" });
    expect(JSON.parse(stderr.calls()[0] ?? "")).toEqual({
      type: "diagnostic",
      command: "docx-to-pdf",
      severity: "warning",
      code: "x",
      message: "m",
    });
  });

  it("quiet suppresses an individual diagnostic even in json mode", () => {
    const stderr = spyOnStderr();
    const reporter = createDiagnosticReporter({
      json: true,
      quiet: true,
      command: "c",
    });
    reporter.report({ severity: "info", code: "x", message: "m" });
    expect(stderr.calls()).toEqual([]);
  });

  it("always writes the result summary in json mode, even when quiet", () => {
    const stderr = spyOnStderr();
    const reporter = createDiagnosticReporter({
      json: true,
      quiet: true,
      command: "c",
    });
    reporter.summarize({ output: "out.pdf", bytes: 10, diagnosticCount: 0 });
    expect(JSON.parse(stderr.calls()[0] ?? "")).toEqual({
      type: "result",
      output: "out.pdf",
      bytes: 10,
      diagnosticCount: 0,
    });
  });

  it("writes nothing for the summary in human mode when quiet", () => {
    const stderr = spyOnStderr();
    const reporter = createDiagnosticReporter({
      json: false,
      quiet: true,
      command: "c",
    });
    reporter.summarize({ output: "out.pdf", bytes: 10, diagnosticCount: 0 });
    expect(stderr.calls()).toEqual([]);
  });

  it("pluralises 'diagnostic' for any count other than exactly one", () => {
    const stderr = spyOnStderr();
    const reporter = createDiagnosticReporter({
      json: false,
      quiet: false,
      command: "c",
    });
    reporter.summarize({ output: "out.pdf", bytes: 5, diagnosticCount: 0 });
    reporter.summarize({ output: "out.pdf", bytes: 5, diagnosticCount: 2 });
    expect(stderr.calls()).toEqual([
      "[c] wrote 5 bytes to out.pdf (0 diagnostics)\n",
      "[c] wrote 5 bytes to out.pdf (2 diagnostics)\n",
    ]);
  });

  it("does not pluralise 'diagnostic' for exactly one", () => {
    const stderr = spyOnStderr();
    const reporter = createDiagnosticReporter({
      json: false,
      quiet: false,
      command: "c",
    });
    reporter.summarize({ output: "out.pdf", bytes: 5, diagnosticCount: 1 });
    expect(stderr.calls()).toEqual([
      "[c] wrote 5 bytes to out.pdf (1 diagnostic)\n",
    ]);
  });
});

describe("createFontSubstitutionReporter", () => {
  it("writes nothing when quiet", () => {
    const stderr = spyOnStderr();
    const report = createFontSubstitutionReporter({
      json: false,
      quiet: true,
      command: "c",
    });
    report({
      requestedFamily: "Calibri",
      requestedBold: false,
      requestedItalic: false,
      resolvedFamily: "Carlito",
      reason: "vendored-substitute",
    });
    expect(stderr.calls()).toEqual([]);
  });

  it("emits an NDJSON font-substitution record in json mode", () => {
    const stderr = spyOnStderr();
    const report = createFontSubstitutionReporter({
      json: true,
      quiet: false,
      command: "c",
    });
    report({
      requestedFamily: "Calibri",
      requestedBold: false,
      requestedItalic: false,
      resolvedFamily: "Carlito",
      reason: "vendored-substitute",
    });
    expect(JSON.parse(stderr.calls()[0] ?? "")).toEqual({
      type: "font-substitution",
      command: "c",
      requestedFamily: "Calibri",
      requestedBold: false,
      requestedItalic: false,
      resolvedFamily: "Carlito",
      reason: "vendored-substitute",
    });
  });

  it("writes a plain family name with no style clause when neither bold nor italic is requested", () => {
    const stderr = spyOnStderr();
    const report = createFontSubstitutionReporter({
      json: false,
      quiet: false,
      command: "docx-to-pdf",
    });
    report({
      requestedFamily: "Calibri",
      requestedBold: false,
      requestedItalic: false,
      resolvedFamily: "Carlito",
      reason: "vendored-substitute",
    });
    expect(stderr.calls()).toEqual([
      '[docx-to-pdf] font substitution: "Calibri" -> "Carlito" (vendored-substitute)\n',
    ]);
  });

  it("appends ' bold' when bold was requested", () => {
    const stderr = spyOnStderr();
    const report = createFontSubstitutionReporter({
      json: false,
      quiet: false,
      command: "c",
    });
    report({
      requestedFamily: "Calibri",
      requestedBold: true,
      requestedItalic: false,
      resolvedFamily: "Carlito",
      reason: "vendored-substitute",
    });
    expect(stderr.calls()[0]).toContain('"Calibri" bold ->');
  });

  it("appends ' italic' when italic was requested", () => {
    const stderr = spyOnStderr();
    const report = createFontSubstitutionReporter({
      json: false,
      quiet: false,
      command: "c",
    });
    report({
      requestedFamily: "Calibri",
      requestedBold: false,
      requestedItalic: true,
      resolvedFamily: "Carlito",
      reason: "vendored-substitute",
    });
    expect(stderr.calls()[0]).toContain('"Calibri" italic ->');
  });

  it("appends both ' bold' and ' italic' in that order when both are requested", () => {
    const stderr = spyOnStderr();
    const report = createFontSubstitutionReporter({
      json: false,
      quiet: false,
      command: "c",
    });
    report({
      requestedFamily: "Calibri",
      requestedBold: true,
      requestedItalic: true,
      resolvedFamily: "Carlito",
      reason: "vendored-substitute",
    });
    expect(stderr.calls()[0]).toContain('"Calibri" bold italic ->');
  });
});

describe("substitutionToDiagnostic", () => {
  it("maps a WinAnsiSubstitution to a warning-severity Diagnostic naming both characters and the page", () => {
    expect(substitutionToDiagnostic({ from: "‘", to: "'" }, 7)).toEqual({
      severity: "warning",
      code: "win-ansi-substitution",
      message:
        "Character '‘' has no glyph in the standard font; substituted with '''",
      pageIndex: 7,
    });
  });
});

describe("fontSubstitutionToDiagnostic", () => {
  it("maps a vendored-substitute reason to a 'substituted the metric-compatible' message", () => {
    const diagnostic = fontSubstitutionToDiagnostic({
      requestedFamily: "Calibri",
      requestedBold: false,
      requestedItalic: false,
      resolvedFamily: "Carlito",
      reason: "vendored-substitute",
    });
    expect(diagnostic).toEqual({
      severity: "info",
      code: "font/substituted",
      message:
        '"Calibri" is not available; substituted the metric-compatible "Carlito"',
    });
  });

  it("maps any other reason to a 'substituted another face of' message", () => {
    const diagnostic = fontSubstitutionToDiagnostic({
      requestedFamily: "Calibri",
      requestedBold: true,
      requestedItalic: true,
      resolvedFamily: "Calibri",
      reason: "missing-face",
    });
    expect(diagnostic.message).toBe(
      '"Calibri bold italic" is not available; substituted another face of "Calibri"',
    );
  });

  it("includes both style clauses in the requested-face description", () => {
    const diagnostic = fontSubstitutionToDiagnostic({
      requestedFamily: "Calibri",
      requestedBold: true,
      requestedItalic: false,
      resolvedFamily: "Carlito",
      reason: "vendored-substitute",
    });
    expect(diagnostic.message).toContain('"Calibri bold" is not available');
  });
});

describe("pdfDiagnosticToDiagnostic", () => {
  it("maps every field across field-by-field", () => {
    expect(
      pdfDiagnosticToDiagnostic({
        severity: "warning",
        code: "pdf/thing",
        message: "m",
        pageIndex: 2,
      }),
    ).toEqual({
      severity: "warning",
      code: "pdf/thing",
      message: "m",
      pageIndex: 2,
    });
  });
});
