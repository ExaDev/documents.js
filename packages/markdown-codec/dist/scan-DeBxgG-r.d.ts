//#region src/scan/scan.d.ts
declare const MARKDOWN_TAB_STOP_WIDTH = 4;
interface ScanPosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}
interface MarkdownScanMark {
  readonly rawOffset: number;
  readonly lineNumber: number;
  readonly columnNumber: number;
  readonly pendingTabColumns: number;
}
declare class MarkdownScanCursor {
  private readonly source;
  private rawOffset;
  private lineNumber;
  private columnNumber;
  private pendingTabColumns;
  constructor(source: string);
  get position(): ScanPosition;
  atEnd(): boolean;
  peek(): string | undefined;
  peekRaw(count: number): string;
  next(): string | undefined;
  mark(): MarkdownScanMark;
  reset(mark: MarkdownScanMark): void;
}
//#endregion
export { ScanPosition as i, MarkdownScanCursor as n, MarkdownScanMark as r, MARKDOWN_TAB_STOP_WIDTH as t };