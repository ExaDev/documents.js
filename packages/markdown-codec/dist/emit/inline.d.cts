import { i as MarkdownDiagnosticSink } from "../diagnostics-BuO5-SW1.cjs";
import { ContentRun } from "document-schema.js";
//#region src/emit/inline.d.ts
interface InlineEmitContext {
  readonly sink: MarkdownDiagnosticSink;
  readonly emphasisMarker: string;
}
declare function escapeMarkdownText(text: string): string;
declare function emitRuns(runs: readonly ContentRun[], context: InlineEmitContext): string;
declare function emitRunsSingleLine(runs: readonly ContentRun[], context: InlineEmitContext): string;
//#endregion
export { InlineEmitContext, emitRuns, emitRunsSingleLine, escapeMarkdownText };