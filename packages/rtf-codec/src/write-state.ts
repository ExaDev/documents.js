// The mutable state threaded through every write-*.ts helper module: the
// accumulated RTF byte-stream text, the stack of open block-scoped construct
// bookmarks, the three-pass tables write.ts's own collectTables mints ahead
// of time, the diagnostic sink, and the requested line ending. Passed
// explicitly as each function's first parameter rather than held on a class,
// so the writer's own method groups (header, body, table, image) can each
// live in their own file without needing every cross-group call to go
// through a shared base class or a mixin.
import type { DocumentTables } from "./write-tables";
import type { RtfDiagnosticSink } from "./diagnostics";

export interface Writer {
  out: string;
  // One entry per open block-scoped construct, holding the bookmark name whose {\*\bkmkend ...} the matching close must write, or undefined for a construct with no RTF spelling. Tracked even for the undefined case so the two halves of a marker pair stay in step.
  readonly openConstructs: (string | undefined)[];
  readonly tables: DocumentTables;
  readonly sink: RtfDiagnosticSink;
  readonly lineEnding: string;
}

export function raw(writer: Writer, text: string): void {
  writer.out += text;
}

export function line(writer: Writer, text: string): void {
  writer.out += text + writer.lineEnding;
}
