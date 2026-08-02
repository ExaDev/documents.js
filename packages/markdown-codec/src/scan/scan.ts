// The hand-written CommonMark line/character scanner: a column-aware character cursor over the raw source string, feeding src/block's block-structure parser. In the same spirit as pdf-codec's own hand-written ByteReader (src/bytes/reader.ts) -- forward-only, with mark()/reset() for the backtracking a block-structure trial parse needs (e.g. trying a list-item start that turns out not to match).
//
// Tabs are NOT pre-expanded to spaces up front. Per the CommonMark spec's own "Tabs" section (assets/commonmark/spec.txt): "Tabs in lines are not expanded to spaces. However, in contexts where spaces help to define block structure, tabs behave as if they were replaced by spaces with a tab stop of 4 characters." Concretely, a tab's own expansion can be PARTIALLY consumed: a block-quote marker `>` followed by a tab treats the tab as expanding to enough spaces to reach the next 4-column tab stop, one of which is the delimiter's own optional space, with the remainder passed through as literal indentation. This cursor models that directly: next() advances by exactly one COLUMN at a time, and a multi-column tab is consumed one column per call, tracked in `pendingTabColumns` between calls, only actually advancing past the tab character in the source once every one of its columns has been consumed. peek() reflects the same in-progress state, returning a synthetic ' ' while a tab's expansion is only partially consumed.

export const MARKDOWN_TAB_STOP_WIDTH = 4;

export interface ScanPosition {
  // Raw index into the source string -- NOT tab-expanded, so it always matches string.slice/string.length arithmetic on the original source.
  readonly offset: number;
  // 1-based line number.
  readonly line: number;
  // 0-based, tab-expanded column -- the position a human editor would show, not a raw character count.
  readonly column: number;
}

// A resumption point for MarkdownScanCursor.reset() -- captures the cursor's full state, including any in-progress tab-column consumption, so backtracking restores exactly rather than merely rewinding the raw offset.
export interface MarkdownScanMark {
  readonly rawOffset: number;
  readonly lineNumber: number;
  readonly columnNumber: number;
  readonly pendingTabColumns: number;
}

export class MarkdownScanCursor {
  private readonly source: string;
  private rawOffset = 0;
  private lineNumber = 1;
  private columnNumber = 0;
  // Columns of the tab sitting at rawOffset not yet consumed -- 0 whenever the cursor sits between two ordinary characters, never mid-tab.
  private pendingTabColumns = 0;

  constructor(source: string) {
    this.source = source;
  }

  get position(): ScanPosition {
    return { offset: this.rawOffset, line: this.lineNumber, column: this.columnNumber };
  }

  atEnd(): boolean {
    return this.pendingTabColumns === 0 && this.rawOffset >= this.source.length;
  }

  // The next effective character without consuming it: a real source character, or a synthetic single space while a tab's own expansion is only partially consumed. Never returns '\t' or '\r' -- a tab's columns come back as ' ' one at a time, and a line ending (LF, CRLF, or lone CR) comes back as a single '\n', matching next()'s own normalisation.
  peek(): string | undefined {
    if (this.pendingTabColumns > 0) {
      return ' ';
    }
    if (this.rawOffset >= this.source.length) {
      return undefined;
    }
    const char = this.source[this.rawOffset];
    if (char === '\t') {
      return ' ';
    }
    if (char === '\r') {
      return '\n';
    }
    return char;
  }

  // Peeks `count` raw source characters starting at the current raw offset, ignoring any pending tab-expansion state entirely -- for literal pattern matching (fence markers, ATX '#' runs, an HTML block's own start condition) that only ever needs to match against real source text, never mid-tab-expansion synthetic spaces.
  peekRaw(count: number): string {
    return this.source.slice(this.rawOffset, this.rawOffset + count);
  }

  // Consumes exactly one effective column, returning the character consumed (matching peek()'s own normalisation: a tab's columns come back as ' ', any line ending comes back as '\n'). Returns undefined at end of input without advancing.
  next(): string | undefined {
    if (this.pendingTabColumns > 0) {
      this.pendingTabColumns -= 1;
      this.columnNumber += 1;
      if (this.pendingTabColumns === 0) {
        this.rawOffset += 1;
      }
      return ' ';
    }
    if (this.rawOffset >= this.source.length) {
      return undefined;
    }
    const char = this.source[this.rawOffset];
    if (char === '\t') {
      const width = MARKDOWN_TAB_STOP_WIDTH - (this.columnNumber % MARKDOWN_TAB_STOP_WIDTH);
      this.columnNumber += 1;
      if (width > 1) {
        this.pendingTabColumns = width - 1;
      } else {
        this.rawOffset += 1;
      }
      return ' ';
    }
    if (char === '\r') {
      this.rawOffset += this.source[this.rawOffset + 1] === '\n' ? 2 : 1;
      this.lineNumber += 1;
      this.columnNumber = 0;
      return '\n';
    }
    this.rawOffset += 1;
    if (char === '\n') {
      this.lineNumber += 1;
      this.columnNumber = 0;
    } else {
      this.columnNumber += 1;
    }
    return char;
  }

  mark(): MarkdownScanMark {
    return {
      rawOffset: this.rawOffset,
      lineNumber: this.lineNumber,
      columnNumber: this.columnNumber,
      pendingTabColumns: this.pendingTabColumns,
    };
  }

  reset(mark: MarkdownScanMark): void {
    this.rawOffset = mark.rawOffset;
    this.lineNumber = mark.lineNumber;
    this.columnNumber = mark.columnNumber;
    this.pendingTabColumns = mark.pendingTabColumns;
  }
}
