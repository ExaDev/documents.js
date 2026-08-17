import { i as MarkdownDiagnosticSink } from "../diagnostics-B72W0P_E.cjs";
import { InlineEmitContext } from "./inline.cjs";
import { ContentTable } from "document-schema.js";
//#region src/emit/table.d.ts
interface TableEmitContext extends InlineEmitContext {
  readonly sink: MarkdownDiagnosticSink;
}
declare function emitTable(table: ContentTable, context: TableEmitContext): string;
//#endregion
export { TableEmitContext, emitTable };