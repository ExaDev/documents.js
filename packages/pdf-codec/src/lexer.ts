import { isAsciiWhitespace } from "./bytes/reader";
import type { ByteReader } from "./bytes/reader";

// A byte-level tokenizer over PDF's own lexical syntax (ISO 32000-1 7.2), shared between object parsing (src/pdf/parse.ts) and content-stream interpretation (src/pdf/content-read.ts) — both are sequences of the identical token vocabulary (numbers, names, strings, delimiters, keywords/operators), just assembled into different higher-level structures by their respective callers. This module produces exactly one token per call and never backtracks itself; the one genuinely ambiguous case in the whole grammar — "N G R" (a reference) vs "N G obj" (an indirect object header), both starting with two integers — is resolved by parse.ts using the shared ByteReader's own mark()/reset(), not by anything in here.

export type Token =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "name"; readonly value: string }
  | { readonly kind: "literalString"; readonly value: Uint8Array<ArrayBuffer> }
  | { readonly kind: "hexString"; readonly value: Uint8Array<ArrayBuffer> }
  | { readonly kind: "arrayStart" }
  | { readonly kind: "arrayEnd" }
  | { readonly kind: "dictStart" }
  | { readonly kind: "dictEnd" }
  | { readonly kind: "keyword"; readonly value: string };

// PDF's own delimiter and syntax bytes (ISO 32000-1 7.2.2/7.3.4), named once per distinct ASCII character and reused wherever this lexer checks for it: several of these characters are tested in more than one context (a delimiter, an escape trigger, a hex-digit bound) but are still the exact same byte each time.
const LEFT_PAREN = 0x28; // '('
const RIGHT_PAREN = 0x29; // ')'
const LESS_THAN = 0x3c; // '<'
const GREATER_THAN = 0x3e; // '>'
const LEFT_BRACKET = 0x5b; // '['
const RIGHT_BRACKET = 0x5d; // ']'
const LEFT_BRACE = 0x7b; // '{'
const RIGHT_BRACE = 0x7d; // '}'
const SOLIDUS = 0x2f; // '/'
const PERCENT_SIGN = 0x25; // '%'
const REVERSE_SOLIDUS = 0x5c; // backslash, ISO 32000-1's own name for it
const NUMBER_SIGN = 0x23; // '#'
const PLUS_SIGN = 0x2b; // '+'
const MINUS_SIGN = 0x2d; // '-'
const FULL_STOP = 0x2e; // '.'
const LINE_FEED = 0x0a; // LF
const CARRIAGE_RETURN = 0x0d; // CR
const HORIZONTAL_TAB = 0x09; // \t
const BACKSPACE = 0x08; // \b
const FORM_FEED = 0x0c; // \f
const DIGIT_ZERO = 0x30; // '0'
const DIGIT_SEVEN = 0x37; // '7': the highest digit a PDF octal escape (\ddd) permits
const DIGIT_NINE = 0x39; // '9'
const UPPER_A = 0x41; // 'A'
const UPPER_F = 0x46; // 'F'
const LOWER_A = 0x61; // 'a'
const LOWER_B = 0x62; // 'b'
const LOWER_F = 0x66; // 'f'
const LOWER_N = 0x6e; // 'n'
const LOWER_R = 0x72; // 'r'
const LOWER_T = 0x74; // 't'
const HEX_DIGIT_ALPHA_OFFSET = 10; // 'A'/'a' is hex digit value 10, per hexDigitValue below
const HEX_RADIX = 16;
const OCTAL_RADIX = 8;
const BYTE_MASK = 0xff;

// PDF's own delimiter characters (7.2.2): ( ) < > [ ] { } / % — everything else that isn't whitespace is a "regular" character, the alphabet keywords and names are built from.
const DELIMITER_BYTES = new Set([
  LEFT_PAREN,
  RIGHT_PAREN,
  LESS_THAN,
  GREATER_THAN,
  LEFT_BRACKET,
  RIGHT_BRACKET,
  LEFT_BRACE,
  RIGHT_BRACE,
  SOLIDUS,
  PERCENT_SIGN,
]);

function isRegularByte(byte: number): boolean {
  return !isAsciiWhitespace(byte) && !DELIMITER_BYTES.has(byte);
}

function isDigit(byte: number | undefined): boolean {
  return byte !== undefined && byte >= DIGIT_ZERO && byte <= DIGIT_NINE;
}

function isHexDigit(byte: number | undefined): boolean {
  return (
    byte !== undefined &&
    ((byte >= DIGIT_ZERO && byte <= DIGIT_NINE) ||
      (byte >= UPPER_A && byte <= UPPER_F) ||
      (byte >= LOWER_A && byte <= LOWER_F))
  );
}

function hexDigitValue(byte: number): number {
  if (byte >= DIGIT_ZERO && byte <= DIGIT_NINE) {
    return byte - DIGIT_ZERO;
  }
  if (byte >= UPPER_A && byte <= UPPER_F) {
    return byte - UPPER_A + HEX_DIGIT_ALPHA_OFFSET;
  }
  return byte - LOWER_A + HEX_DIGIT_ALPHA_OFFSET;
}

// Comments (% to end of line) are lexically equivalent to whitespace — they may appear between any two tokens and must never be mistaken for content.
function skipWhitespaceAndComments(reader: ByteReader): void {
  for (;;) {
    reader.skipWhitespace();
    if (reader.peek() !== PERCENT_SIGN) {
      return;
    }
    while (
      !reader.atEnd() &&
      reader.peek() !== LINE_FEED &&
      reader.peek() !== CARRIAGE_RETURN
    ) {
      reader.next();
    }
  }
}

function readNumberToken(reader: ByteReader): Token {
  const start = reader.offset;
  if (reader.peek() === PLUS_SIGN || reader.peek() === MINUS_SIGN) {
    reader.next();
  }
  while (isDigit(reader.peek())) {
    reader.next();
  }
  if (reader.peek() === FULL_STOP) {
    reader.next();
    while (isDigit(reader.peek())) {
      reader.next();
    }
  }
  const text = new TextDecoder("latin1").decode(
    reader.slice(start, reader.offset),
  );
  return { kind: "number", value: Number(text) };
}

// A name's #XX hex escapes (7.3.5) are decoded here, so every other module works with the name's real characters directly rather than needing to know about the escape convention.
function readNameToken(reader: ByteReader): Token {
  reader.next(); // consume '/'
  const bytes: number[] = [];
  for (;;) {
    const byte = reader.peek();
    if (byte === undefined || !isRegularByte(byte)) {
      break;
    }
    if (
      byte === NUMBER_SIGN &&
      isHexDigit(reader.peek(1)) &&
      isHexDigit(reader.peek(2))
    ) {
      reader.next();
      const hi = hexDigitValue(reader.next()!);
      const lo = hexDigitValue(reader.next()!);
      bytes.push(hi * HEX_RADIX + lo);
    } else {
      bytes.push(reader.next()!);
    }
  }
  return {
    kind: "name",
    value: new TextDecoder("latin1").decode(new Uint8Array(bytes)),
  };
}

// Balanced-parenthesis nesting, backslash escapes (named escapes, 1-3 digit octal, and line-continuation escapes that produce no byte at all), and unescaped CR/CRLF end-of-line markers normalised to a single LF — all per 7.3.4.2's own literal-string rules.
function readLiteralStringToken(reader: ByteReader): Token {
  reader.next(); // consume '('
  const bytes: number[] = [];
  let depth = 1;
  for (;;) {
    const byte = reader.next();
    if (byte === undefined) {
      break; // truncated input — return what was read so far; the caller (parse.ts) is responsible for deciding whether that's fatal
    }
    if (byte === REVERSE_SOLIDUS) {
      const esc = reader.next();
      if (esc === undefined) {
        break;
      }
      if (esc === LOWER_N) {
        bytes.push(LINE_FEED); // \n
      } else if (esc === LOWER_R) {
        bytes.push(CARRIAGE_RETURN); // \r
      } else if (esc === LOWER_T) {
        bytes.push(HORIZONTAL_TAB); // \t
      } else if (esc === LOWER_B) {
        bytes.push(BACKSPACE); // \b
      } else if (esc === LOWER_F) {
        bytes.push(FORM_FEED); // \f
      } else if (
        esc === LEFT_PAREN ||
        esc === RIGHT_PAREN ||
        esc === REVERSE_SOLIDUS
      ) {
        bytes.push(esc); // \( \) \\
      } else if (esc === CARRIAGE_RETURN) {
        if (reader.peek() === LINE_FEED) {
          reader.next();
        }
        // line-continuation escape (\<CR> or \<CRLF>) — produces no byte
      } else if (esc === LINE_FEED) {
        // line-continuation escape (\<LF>) — produces no byte
      } else if (esc >= DIGIT_ZERO && esc <= DIGIT_SEVEN) {
        let value = esc - DIGIT_ZERO;
        for (
          let i = 0;
          i < 2 &&
          reader.peek() !== undefined &&
          reader.peek()! >= DIGIT_ZERO &&
          reader.peek()! <= DIGIT_SEVEN;
          i++
        ) {
          value = value * OCTAL_RADIX + (reader.next()! - DIGIT_ZERO);
        }
        bytes.push(value & BYTE_MASK);
      } else {
        // "if the character following the REVERSE SOLIDUS is not one of those shown... the REVERSE SOLIDUS shall be ignored" (7.3.4.2) — the escaped character is emitted literally.
        bytes.push(esc);
      }
      continue;
    }
    if (byte === LEFT_PAREN) {
      depth++;
      bytes.push(byte);
      continue;
    }
    if (byte === RIGHT_PAREN) {
      depth--;
      if (depth === 0) {
        break;
      }
      bytes.push(byte);
      continue;
    }
    if (byte === CARRIAGE_RETURN) {
      if (reader.peek() === LINE_FEED) {
        reader.next();
      }
      bytes.push(LINE_FEED);
      continue;
    }
    bytes.push(byte);
  }
  return { kind: "literalString", value: new Uint8Array(bytes) };
}

// Whitespace inside a hex string is ignored entirely; an odd trailing digit is zero-padded (7.3.4.3).
function readHexStringToken(reader: ByteReader): Token {
  reader.next(); // consume '<'
  const digits: number[] = [];
  for (;;) {
    const byte = reader.next();
    if (byte === undefined || byte === GREATER_THAN) {
      break;
    }
    if (isHexDigit(byte)) {
      digits.push(hexDigitValue(byte));
    }
  }
  if (digits.length % 2 === 1) {
    digits.push(0);
  }
  const bytes = new Uint8Array(digits.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = digits[i * 2]! * HEX_RADIX + digits[i * 2 + 1]!;
  }
  return { kind: "hexString", value: bytes };
}

// A keyword is simply the maximal run of regular bytes that isn't a number or a name — this covers every PDF structural keyword (obj/endobj/stream/xref/trailer/true/false/null/R/...) and every content-stream operator (BT/Tf/Tj/re/cm/Do/...) with the same code, since the lexer has no notion of which keywords are "valid" in a given context; that's entirely parse.ts's and content-read.ts's own concern.
function readKeywordToken(reader: ByteReader): Token {
  const start = reader.offset;
  while (reader.peek() !== undefined && isRegularByte(reader.peek()!)) {
    reader.next();
  }
  const text = new TextDecoder("latin1").decode(
    reader.slice(start, reader.offset),
  );
  return { kind: "keyword", value: text };
}

// Reads and returns the next token, or undefined at end of input. `{`/`}` (PostScript calculator function syntax, rare and not modelled) are silently skipped rather than treated as an error, since skipping them and continuing costs nothing and a Type 4 PostScript function is already out of this parser's scope regardless.
export function nextToken(reader: ByteReader): Token | undefined {
  skipWhitespaceAndComments(reader);
  const byte = reader.peek();
  if (byte === undefined) {
    return undefined;
  }
  if (byte === SOLIDUS) {
    return readNameToken(reader);
  }
  if (byte === LEFT_PAREN) {
    return readLiteralStringToken(reader);
  }
  if (byte === LESS_THAN) {
    if (reader.peek(1) === LESS_THAN) {
      reader.next();
      reader.next();
      return { kind: "dictStart" };
    }
    return readHexStringToken(reader);
  }
  if (byte === GREATER_THAN) {
    if (reader.peek(1) === GREATER_THAN) {
      reader.next();
      reader.next();
      return { kind: "dictEnd" };
    }
    reader.next(); // a lone '>' is lexically invalid; skip it and continue rather than treating one stray byte as fatal
    return nextToken(reader);
  }
  if (byte === LEFT_BRACKET) {
    reader.next();
    return { kind: "arrayStart" };
  }
  if (byte === RIGHT_BRACKET) {
    reader.next();
    return { kind: "arrayEnd" };
  }
  if (byte === LEFT_BRACE || byte === RIGHT_BRACE) {
    reader.next();
    return nextToken(reader);
  }
  if (
    byte === PLUS_SIGN ||
    byte === MINUS_SIGN ||
    byte === FULL_STOP ||
    isDigit(byte)
  ) {
    return readNumberToken(reader);
  }
  return readKeywordToken(reader);
}
