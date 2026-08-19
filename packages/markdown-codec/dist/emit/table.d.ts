import { i as MarkdownDiagnosticSink } from "../diagnostics-BWK1iGy7.js";
import { InlineEmitContext } from "./inline.js";
import { ContentTable } from "document-schema.js";
//#region src/emit/table.d.ts
interface TableEmitContext extends InlineEmitContext {
  readonly sink: MarkdownDiagnosticSink;
}
declare function emitTable(table: ContentTable, context: TableEmitContext): string;
//#endregion
export { TableEmitContext, emitTable };