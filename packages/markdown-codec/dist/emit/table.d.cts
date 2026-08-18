import { i as MarkdownDiagnosticSink } from "../diagnostics-BuO5-SW1.cjs";
import { InlineEmitContext } from "./inline.cjs";
import { ContentTable } from "document-schema.js";
//#region src/emit/table.d.ts
interface TableEmitContext extends InlineEmitContext {
  readonly sink: MarkdownDiagnosticSink;
}
declare function emitTable(table: ContentTable, context: TableEmitContext): string;
//#endregion
export { TableEmitContext, emitTable };