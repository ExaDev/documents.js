// The block phase's per-line cursor: a thin, block-algorithm-shaped view over src/scan's own MarkdownScanCursor, constructed fresh for each source line.
//
// Why per line rather than one cursor over the whole document: CommonMark's tab rule is defined in terms of tab STOPS measured from the start of the line ("tabs behave as if they were replaced by spaces with a tab stop of 4 characters"), and the block algorithm consumes a line in column terms -- strip a blockquote's `>` and one following column, strip a list item's content indent, strip four columns for indented code -- with each strip able to land in the MIDDLE of a tab's own expansion. MarkdownScanCursor models exactly that (it advances one column at a time and only passes the tab character once every one of its columns is consumed), so a cursor per line, starting at column 0, is both the correct tab-stop origin and the correct unit of work.
//
// What this adds on top of the scanner: the three derived quantities every continuation rule and block start is written against -- where the line's next non-space character is, how many columns of indentation precede it, and whether the line is blank -- plus `rest()`, the "what is left of this line, with a partially consumed tab's remaining columns materialised as real spaces" operation that turns a cursor position back into the text a leaf block stores.

import type { MarkdownScanMark } from '../scan/scan';
import { MarkdownScanCursor } from '../scan/scan';

// The indentation at which a line becomes indented code rather than whatever it would otherwise be (spec 0.31.2: "An indented code block is composed of one or more indented chunks... preceded by four or more spaces of indentation").
export const CODE_INDENT_COLUMNS = 4;

export class LineCursor {
  // The line's own source text, with no line ending.
  readonly text: string;
  private readonly cursor: MarkdownScanCursor;
  private nextNonspaceMark: MarkdownScanMark;
  private nextNonspaceColumn = 0;
  private lineIsBlank = false;

  constructor(text: string) {
    this.text = text;
    this.cursor = new MarkdownScanCursor(text);
    this.nextNonspaceMark = this.cursor.mark();
    this.findNextNonspace();
  }

  get column(): number {
    return this.cursor.position.column;
  }

  // Columns of whitespace between the cursor's current position and the line's next non-space character. The quantity every "is this indented code?" and "does this list item continue?" test is written against.
  get indent(): number {
    return this.nextNonspaceColumn - this.cursor.position.column;
  }

  get indented(): boolean {
    return this.indent >= CODE_INDENT_COLUMNS;
  }

  get blank(): boolean {
    return this.lineIsBlank;
  }

  get atEnd(): boolean {
    return this.cursor.atEnd();
  }

  // The character at the cursor, or undefined at end of line. A tab reads as a single space, one column at a time, exactly as MarkdownScanCursor defines it.
  peek(): string | undefined {
    return this.cursor.peek();
  }

  // The character at the line's next non-space position, or undefined when the line has none.
  peekNextNonspace(): string | undefined {
    const saved = this.cursor.mark();
    this.cursor.reset(this.nextNonspaceMark);
    const char = this.cursor.peek();
    this.cursor.reset(saved);
    return char;
  }

  // Recomputes where the next non-space character is, from the cursor's current position. Called once per open block as the continuation walk descends, since stripping a container's own prefix changes the answer.
  findNextNonspace(): void {
    const saved = this.cursor.mark();
    while (this.cursor.peek() === ' ') {
      this.cursor.next();
    }
    this.nextNonspaceMark = this.cursor.mark();
    this.nextNonspaceColumn = this.cursor.position.column;
    this.lineIsBlank = this.cursor.peek() === undefined;
    this.cursor.reset(saved);
  }

  advanceToNextNonspace(): void {
    this.cursor.reset(this.nextNonspaceMark);
  }

  // Advances up to `columns` columns, stopping at end of line. A tab straddling the target is consumed only as far as needed, leaving its remaining columns for rest() to materialise -- which is exactly how `>\tfoo` puts three columns of indentation, not a whole tab, into the block quote's content.
  advance(columns: number): void {
    for (let remaining = columns; remaining > 0; remaining -= 1) {
      if (this.cursor.next() === undefined) {
        return;
      }
    }
  }

  // Consumes the whole remainder of the line -- what a block start that owns its entire line (an ATX heading, a thematic break, a setext underline) does once it has taken what it needs.
  advanceToEndOfLine(): void {
    while (this.cursor.next() !== undefined) {
      // Every column of the line is structure the block start has already accounted for; nothing here is content.
    }
  }

  // Everything from the cursor to the end of the line. A tab whose expansion is only partly consumed contributes its remaining columns as literal spaces, since the block phase's whole point at this position is that those columns are CONTENT rather than structure.
  rest(): string {
    const mark = this.cursor.mark();
    if (mark.pendingTabColumns > 0) {
      return ' '.repeat(mark.pendingTabColumns) + this.text.slice(mark.rawOffset + 1);
    }
    return this.text.slice(mark.rawOffset);
  }

  // Everything from the line's next non-space character to the end of the line -- what every block-start matcher pattern-matches against.
  restFromNextNonspace(): string {
    return this.text.slice(this.nextNonspaceMark.rawOffset);
  }

  mark(): MarkdownScanMark {
    return this.cursor.mark();
  }

  reset(mark: MarkdownScanMark): void {
    this.cursor.reset(mark);
  }
}
