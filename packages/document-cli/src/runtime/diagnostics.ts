import { type Diagnostic, type PdfDiagnostic, type WinAnsiSubstitution } from 'documents.js';

export interface DiagnosticReporter {
  report(diagnostic: Diagnostic): void;
  summarize(result: { readonly output: string; readonly bytes: number; readonly diagnosticCount: number }): void;
}

// Always stderr, never stdout -- stdout is reserved for the converted bytes/payload in every conversion command, so mixing a diagnostic line into it would corrupt piped output.
export function createDiagnosticReporter(options: { readonly json: boolean; readonly quiet: boolean; readonly command: string }): DiagnosticReporter {
  const { json, quiet, command } = options;

  return {
    report(diagnostic) {
      if (quiet) {
        return;
      }
      if (json) {
        process.stderr.write(`${JSON.stringify({ type: 'diagnostic', command, ...diagnostic })}\n`);
        return;
      }
      const pageClause = diagnostic.pageIndex === undefined ? '' : ` (page ${diagnostic.pageIndex})`;
      process.stderr.write(`[${command}] ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}${pageClause}\n`);
    },
    summarize(result) {
      // The result line always prints in JSON mode, --quiet included: a script consuming NDJSON from this reporter needs a definite terminal record to know the stream is complete, whereas --quiet's job for the diagnostic lines above is purely to cut noise a human reader doesn't want. Human mode instead treats --quiet as "no output at all" for the summary, matching how a Unix tool's --quiet conventionally suppresses everything but errors.
      if (json) {
        process.stderr.write(`${JSON.stringify({ type: 'result', ...result })}\n`);
        return;
      }
      if (quiet) {
        return;
      }
      const diagnosticClause = `${result.diagnosticCount} diagnostic${result.diagnosticCount === 1 ? '' : 's'}`;
      process.stderr.write(`[${command}] wrote ${result.bytes} bytes to ${result.output} (${diagnosticClause})\n`);
    },
  };
}

// Adapter for the direct-call commands (odm/odb/pdf-inspect) that bypass the DocumentConverter port and so only ever get pdf-codec's own raw onSubstitution callback shape, not the port's already-normalised Diagnostic.
export function substitutionToDiagnostic(substitution: WinAnsiSubstitution, pageIndex: number): Diagnostic {
  return {
    severity: 'warning',
    code: 'win-ansi-substitution',
    message: `Character '${substitution.from}' has no glyph in the standard font; substituted with '${substitution.to}'`,
    pageIndex,
  };
}

// Adapter for the same direct-call commands' PdfDiagnosticSink callback -- PdfDiagnostic (pdf-codec) and Diagnostic (document-schema.js) happen to share an identical field shape today, but this is written as an explicit field-by-field mapping rather than a bare pass-through so the two stay decoupled if either one's shape ever diverges.
export function pdfDiagnosticToDiagnostic(diagnostic: PdfDiagnostic): Diagnostic {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    pageIndex: diagnostic.pageIndex,
  };
}
