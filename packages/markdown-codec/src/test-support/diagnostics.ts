// A tiny MarkdownDiagnosticSink that records every diagnostic it receives, shared by src/lower/lower.test.ts, src/emit/emit.test.ts, and src/diagnostics/diagnostics.test.ts -- each of those needs to assert "this specific code fired" rather than just "some diagnostic fired", so a real capturing sink is more useful here than NOOP_DIAGNOSTIC_SINK.

import type { MarkdownDiagnostic, MarkdownDiagnosticSink } from '../diagnostics/diagnostics';

export interface DiagnosticCollector {
  readonly sink: MarkdownDiagnosticSink;
  readonly diagnostics: MarkdownDiagnostic[];
  codes(): string[];
  has(code: string): boolean;
}

export function createDiagnosticCollector(): DiagnosticCollector {
  const diagnostics: MarkdownDiagnostic[] = [];
  return {
    sink: (diagnostic) => diagnostics.push(diagnostic),
    diagnostics,
    codes: () => diagnostics.map((diagnostic) => diagnostic.code),
    has: (code) => diagnostics.some((diagnostic) => diagnostic.code === code),
  };
}
