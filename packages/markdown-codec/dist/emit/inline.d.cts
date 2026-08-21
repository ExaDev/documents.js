import { i as MarkdownDiagnosticSink } from "../diagnostics-CwpvDXtH.cjs";
import { ContentRun, RunConstructExtent } from "document-schema.js";
//#region src/emit/inline.d.ts
interface InlineEmitContext {
  readonly sink: MarkdownDiagnosticSink;
  readonly emphasisMarker: string;
}
declare function escapeMarkdownText(text: string): string;
declare function escapeLinkDestination(destination: string): string;
declare function renderLinkTitle(title: string): string;
declare function emitRuns(runs: readonly ContentRun[], context: InlineEmitContext, constructs?: readonly RunConstructExtent[] | undefined): string;
declare function emitRunsSingleLine(runs: readonly ContentRun[], context: InlineEmitContext, constructs?: readonly RunConstructExtent[] | undefined): string;
//#endregion
export { InlineEmitContext, emitRuns, emitRunsSingleLine, escapeLinkDestination, escapeMarkdownText, renderLinkTitle };