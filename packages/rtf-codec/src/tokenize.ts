// The RTF lexer: raw bytes to the flat token stream the destination state machine in src/parse.ts walks.
//
// RTF is tokenised plain text rather than a markup language, so nothing in this family's XML plumbing (ooxml.js, odf.js) applies -- this layer is the RTF equivalent of markdown-codec's src/scan, and like it is deliberately a separate stage from the structural one above it, because the tokenization rules are fully local (they depend on the current byte and at most a two-byte lookahead) while the structural ones depend on an arbitrarily deep group/destination stack.
//
// The rules implemented here are exactly the ones the specification states, in RTF 1.9.1's "Control Word", "Control Symbol", "Group", "Special Characters" and "Conventions of an RTF Reader" sections:
//
// - A control word is a backslash, then ASCII letters (32 at most -- "A control word's name cannot be longer than 32 letters"), then an optional parameter: an ASCII minus sign and/or digits, up to ten digits ("An RTF parser must allow for up to 10 digits optionally preceded by a minus sign"). One space after the word or its parameter is the delimiter and is discarded; any second space is text. Any other non-letter, non-digit terminates the word and is NOT consumed.
// - A control symbol is a backslash and one non-alphabetical character, with no delimiter at all -- "a space following a control symbol is treated as text, not a delimiter".
// - `\'hh` is a hexadecimal byte value in the document's own codepage; it is lexed here as its own token kind rather than as a control symbol, since the two hex digits belong to it and a consumer must not see them as text.
// - A backslash immediately before a CR or LF is a \par ("A carriage return ... is treated as a \par control if the character is preceded by a backslash").
// - A bare CR or LF is ignored ("CRLFs should be ignored by RTF readers except that they can act as control word delimiters").
// - `\binN` is the one control word whose argument changes lexing: exactly N raw bytes follow the delimiter and may contain braces and backslashes, so the lexer -- not the parser -- has to consume them. Emitting them as their own token kind keeps that byte run out of the text stream, where a `{` inside it would otherwise open a phantom group.
//
// Text bytes are emitted in runs rather than one token per byte, for the obvious reason, but a consumer that has to count individual characters -- the \uN skip mechanism, whose count is in characters and where "any RTF control word or symbol is considered a single character" -- can still do so by walking a run's bytes; src/parse.ts's skip logic does exactly that.
//
// The lexer never throws and never validates structure: an unbalanced brace, an unknown control word, and a truncated \binN run are all the parser's or the reader's problem, reported through the diagnostic tiers in src/diagnostics.ts. Its one job is to say what the bytes are.

export type RtfToken =
  | { readonly kind: "groupStart" }
  | { readonly kind: "groupEnd" }
  | {
      readonly kind: "controlWord";
      readonly name: string;
      readonly param?: number;
    }
  | { readonly kind: "controlSymbol"; readonly symbol: string }
  | { readonly kind: "hex"; readonly byte: number }
  | { readonly kind: "text"; readonly bytes: Uint8Array }
  | { readonly kind: "binary"; readonly bytes: Uint8Array };

const MAX_CONTROL_WORD_LETTERS = 32;
const MAX_PARAMETER_DIGITS = 10;

const BACKSLASH = 0x5c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const APOSTROPHE = 0x27;
const MINUS = 0x2d;
const SPACE = 0x20;
const CARRIAGE_RETURN = 0x0d;
const LINE_FEED = 0x0a;

function isAsciiLetter(byte: number): boolean {
  return (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a);
}

function isAsciiDigit(byte: number): boolean {
  return byte >= 0x30 && byte <= 0x39;
}

function hexDigitValue(byte: number): number | undefined {
  if (isAsciiDigit(byte)) return byte - 0x30;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  return undefined;
}

interface ControlWordScan {
  readonly name: string;
  readonly param: number | undefined;
  readonly next: number;
}

// Scans the control word starting one byte after the backslash at `start`, returning where the lexer should resume. Delimiter handling is folded in here rather than left to the caller because it is part of the word's own production: a single trailing space belongs to the word and is discarded, everything else is left in place for the next token.
function scanControlWord(input: Uint8Array, start: number): ControlWordScan {
  let cursor = start;
  let name = "";
  while (
    cursor < input.length &&
    name.length < MAX_CONTROL_WORD_LETTERS &&
    isAsciiLetter(input[cursor] ?? 0)
  ) {
    name += String.fromCharCode(input[cursor] ?? 0);
    cursor += 1;
  }
  // A name that hit the 32-letter cap has its overflow letters left in the stream deliberately: the spec caps the name, and silently swallowing the remainder would hide malformed input that a caller may want to see as text.

  let param: number | undefined;
  let negative = false;
  if (cursor < input.length && input[cursor] === MINUS) {
    negative = true;
    cursor += 1;
  }
  let digits = "";
  while (
    cursor < input.length &&
    digits.length < MAX_PARAMETER_DIGITS &&
    isAsciiDigit(input[cursor] ?? 0)
  ) {
    digits += String.fromCharCode(input[cursor] ?? 0);
    cursor += 1;
  }
  if (digits.length > 0) {
    param = negative ? -Number(digits) : Number(digits);
  } else if (negative) {
    // A minus sign with no digits after it is not a parameter at all; put it back so it lexes as text rather than vanishing.
    cursor -= 1;
  }

  if (cursor < input.length && input[cursor] === SPACE) {
    cursor += 1;
  }
  return { name, param, next: cursor };
}

export function tokenizeRtf(input: Uint8Array): RtfToken[] {
  const tokens: RtfToken[] = [];
  let cursor = 0;
  let textStart = -1;
  // Text runs are collected as byte offsets and materialised only when the run ends, so an ordinary paragraph costs one subarray rather than one allocation per byte. A run has to be split whenever an ignored CR/LF falls inside it, which is why the pending run is flushed rather than extended there.
  let pendingText: number[] = [];

  const flushText = (): void => {
    if (textStart === -1) return;
    tokens.push({ kind: "text", bytes: Uint8Array.from(pendingText) });
    textStart = -1;
    pendingText = [];
  };

  const pushTextByte = (byte: number): void => {
    if (textStart === -1) {
      textStart = cursor;
    }
    pendingText.push(byte);
  };

  while (cursor < input.length) {
    const byte = input[cursor] ?? 0;

    if (byte === OPEN_BRACE) {
      flushText();
      tokens.push({ kind: "groupStart" });
      cursor += 1;
      continue;
    }
    if (byte === CLOSE_BRACE) {
      flushText();
      tokens.push({ kind: "groupEnd" });
      cursor += 1;
      continue;
    }
    if (byte === CARRIAGE_RETURN || byte === LINE_FEED) {
      cursor += 1;
      continue;
    }
    if (byte !== BACKSLASH) {
      pushTextByte(byte);
      cursor += 1;
      continue;
    }

    const after = input[cursor + 1];
    if (after === undefined) {
      // A trailing backslash with nothing after it: not a control word, not a symbol. Treated as text so no byte is silently lost.
      pushTextByte(byte);
      cursor += 1;
      continue;
    }

    if (after === CARRIAGE_RETURN || after === LINE_FEED) {
      flushText();
      tokens.push({ kind: "controlWord", name: "par" });
      cursor += 2;
      // A backslash-CR followed by an LF is one line break, not two, so the LF is consumed with it rather than being seen again as an ignorable byte.
      if (after === CARRIAGE_RETURN && input[cursor] === LINE_FEED) {
        cursor += 1;
      }
      continue;
    }

    if (after === APOSTROPHE) {
      const high = hexDigitValue(input[cursor + 2] ?? 0);
      const low = hexDigitValue(input[cursor + 3] ?? 0);
      if (high !== undefined && low !== undefined) {
        flushText();
        tokens.push({ kind: "hex", byte: high * 16 + low });
        cursor += 4;
        continue;
      }
      // Not followed by two hex digits, so it is not the \'hh production; fall through and lex it as the ordinary control symbol it textually is.
    }

    if (!isAsciiLetter(after)) {
      flushText();
      tokens.push({
        kind: "controlSymbol",
        symbol: String.fromCharCode(after),
      });
      cursor += 2;
      continue;
    }

    const scan = scanControlWord(input, cursor + 1);
    flushText();
    if (scan.name === "bin" && scan.param !== undefined && scan.param > 0) {
      const end = Math.min(scan.next + scan.param, input.length);
      tokens.push({ kind: "binary", bytes: input.slice(scan.next, end) });
      cursor = end;
      continue;
    }
    tokens.push(
      scan.param === undefined
        ? { kind: "controlWord", name: scan.name }
        : { kind: "controlWord", name: scan.name, param: scan.param },
    );
    cursor = scan.next;
  }

  flushText();
  return tokens;
}
