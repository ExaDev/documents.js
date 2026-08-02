import { r as MarkdownScanMark } from "../scan-DeBxgG-r.cjs";
//#region src/block/line.d.ts
declare const CODE_INDENT_COLUMNS = 4;
declare class LineCursor {
  readonly text: string;
  private readonly cursor;
  private nextNonspaceMark;
  private nextNonspaceColumn;
  private lineIsBlank;
  constructor(text: string);
  get column(): number;
  get indent(): number;
  get indented(): boolean;
  get blank(): boolean;
  get atEnd(): boolean;
  peek(): string | undefined;
  peekNextNonspace(): string | undefined;
  findNextNonspace(): void;
  advanceToNextNonspace(): void;
  advance(columns: number): void;
  advanceToEndOfLine(): void;
  rest(): string;
  restFromNextNonspace(): string;
  mark(): MarkdownScanMark;
  reset(mark: MarkdownScanMark): void;
}
//#endregion
export { CODE_INDENT_COLUMNS, LineCursor };