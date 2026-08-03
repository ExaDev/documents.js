import { type Diagnostic, type FontSubstitution, type PdfDiagnostic, type WinAnsiSubstitution } from 'documents.js';

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

// What --report-font-substitutions writes, once per face that resolved to something other than what the document asked for, at the moment documents.js's own onFontSubstitution callback fires rather than after the conversion has finished. The local converter ALREADY records every one of these as a `font/substituted` Diagnostic the reporter above prints afterwards -- this is deliberately the other channel: the structured FontSubstitution value (which family was asked for, at which weight/slope, what it resolved to, and why), emitted live, which is what a caller diagnosing "why does this PDF not look like my document" actually needs and what a rendered diagnostic message has already flattened away.
//
// Stderr and the json/quiet conventions are the diagnostic reporter's above, verbatim: stdout belongs to the converted bytes, and a substitution report is diagnostic output like any other, so --quiet suppresses it and --json makes it one more NDJSON record on the same stream.
export function createFontSubstitutionReporter(options: { readonly json: boolean; readonly quiet: boolean; readonly command: string }): (substitution: FontSubstitution) => void {
  const { json, quiet, command } = options;

  return (substitution) => {
    if (quiet) {
      return;
    }
    if (json) {
      process.stderr.write(`${JSON.stringify({ type: 'font-substitution', command, ...substitution })}\n`);
      return;
    }
    const styleClause = `${substitution.requestedBold ? ' bold' : ''}${substitution.requestedItalic ? ' italic' : ''}`;
    process.stderr.write(`[${command}] font substitution: "${substitution.requestedFamily}"${styleClause} -> "${substitution.resolvedFamily}" (${substitution.reason})\n`);
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

// The same adapter for a font-face fallback, so odm-to-pdf reports one exactly as the DocumentConverter port already does for every other <format>-to-pdf conversion. Deliberately mirrors documents.js's own local.ts wording and `font/substituted` code rather than inventing a second phrasing for the identical event: a caller cannot tell from the output which of the two paths produced it, which is the point.
export function fontSubstitutionToDiagnostic(substitution: FontSubstitution): Diagnostic {
  const requested = `${substitution.requestedFamily}${substitution.requestedBold ? ' bold' : ''}${substitution.requestedItalic ? ' italic' : ''}`;
  const detail = substitution.reason === 'vendored-substitute' ? `substituted the metric-compatible "${substitution.resolvedFamily}"` : `substituted another face of "${substitution.resolvedFamily}"`;
  return { severity: 'info', code: 'font/substituted', message: `"${requested}" is not available; ${detail}` };
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
