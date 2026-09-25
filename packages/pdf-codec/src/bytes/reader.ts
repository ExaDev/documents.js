// The six ASCII whitespace byte values PDF's own tokenizing grammar recognizes as whitespace (ISO 32000-1 Table 1): NUL, HORIZONTAL TAB, LINE FEED, FORM FEED, CARRIAGE RETURN, and SPACE.
const WHITESPACE_NUL = 0x00;
const WHITESPACE_TAB = 0x09;
const WHITESPACE_LF = 0x0a;
const WHITESPACE_FF = 0x0c;
const WHITESPACE_CR = 0x0d;
const WHITESPACE_SPACE = 0x20;
const ASCII_WHITESPACE_BYTES = new Set([
  WHITESPACE_NUL,
  WHITESPACE_TAB,
  WHITESPACE_LF,
  WHITESPACE_FF,
  WHITESPACE_CR,
  WHITESPACE_SPACE,
]);

export function isAsciiWhitespace(byte: number | undefined): boolean {
  return byte !== undefined && ASCII_WHITESPACE_BYTES.has(byte);
}

// A forward-only cursor over a byte buffer, with explicit mark()/reset() for the backtracking a tokenizer needs — e.g. the PDF lexer's `N G R` (a reference) vs `N G obj` (an indirect object header) ambiguity, resolved only by trying to read two integers and a keyword, then rewinding if it doesn't match.
export class ByteReader {
  private readonly bytes: Uint8Array<ArrayBuffer>;
  private position = 0;

  constructor(bytes: Uint8Array<ArrayBuffer>) {
    this.bytes = bytes;
  }

  get offset(): number {
    return this.position;
  }

  get length(): number {
    return this.bytes.length;
  }

  atEnd(): boolean {
    return this.position >= this.bytes.length;
  }

  peek(aheadBy = 0): number | undefined {
    return this.bytes[this.position + aheadBy];
  }

  next(): number | undefined {
    const byte = this.bytes[this.position];
    if (byte !== undefined) {
      this.position++;
    }
    return byte;
  }

  // Returns a resumption point for reset(); does not itself change position.
  mark(): number {
    return this.position;
  }

  reset(mark: number): void {
    this.position = mark;
  }

  seek(offset: number): void {
    this.position = offset;
  }

  slice(start: number, end: number): Uint8Array<ArrayBuffer> {
    return this.bytes.subarray(start, end);
  }

  skipWhitespace(): void {
    while (isAsciiWhitespace(this.peek())) {
      this.position++;
    }
  }

  // Consumes `keyword` as a literal ASCII sequence at the current position, advancing past it, and returns true; otherwise leaves the position unchanged and returns false.
  matchKeyword(keyword: string): boolean {
    for (let i = 0; i < keyword.length; i++) {
      if (this.peek(i) !== keyword.charCodeAt(i)) {
        return false;
      }
    }
    this.position += keyword.length;
    return true;
  }
}
