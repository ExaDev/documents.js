import { isAsciiWhitespace } from './bytes/reader';
import type { ByteReader } from './bytes/reader';

// A byte-level tokenizer over PDF's own lexical syntax (ISO 32000-1 7.2), shared between object parsing (src/pdf/parse.ts) and content-stream interpretation (src/pdf/content-read.ts) -- both are sequences of the identical token vocabulary (numbers, names, strings, delimiters, keywords/operators), just assembled into different higher-level structures by their respective callers. This module produces exactly one token per call and never backtracks itself; the one genuinely ambiguous case in the whole grammar -- "N G R" (a reference) vs "N G obj" (an indirect object header), both starting with two integers -- is resolved by parse.ts using the shared ByteReader's own mark()/reset(), not by anything in here.

export type Token =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'name'; readonly value: string }
  | { readonly kind: 'literalString'; readonly value: Uint8Array<ArrayBuffer> }
  | { readonly kind: 'hexString'; readonly value: Uint8Array<ArrayBuffer> }
  | { readonly kind: 'arrayStart' }
  | { readonly kind: 'arrayEnd' }
  | { readonly kind: 'dictStart' }
  | { readonly kind: 'dictEnd' }
  | { readonly kind: 'keyword'; readonly value: string };

// PDF's own delimiter characters (7.2.2): ( ) < > [ ] { } / % -- everything else that isn't whitespace is a "regular" character, the alphabet keywords and names are built from.
const DELIMITER_BYTES = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

function isRegularByte(byte: number): boolean {
  return !isAsciiWhitespace(byte) && !DELIMITER_BYTES.has(byte);
}

function isDigit(byte: number | undefined): boolean {
  return byte !== undefined && byte >= 0x30 && byte <= 0x39;
}

function isHexDigit(byte: number | undefined): boolean {
  return byte !== undefined && ((byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x46) || (byte >= 0x61 && byte <= 0x66));
}

function hexDigitValue(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) {
    return byte - 0x30;
  }
  if (byte >= 0x41 && byte <= 0x46) {
    return byte - 0x41 + 10;
  }
  return byte - 0x61 + 10;
}

// Comments (% to end of line) are lexically equivalent to whitespace -- they may appear between any two tokens and must never be mistaken for content.
function skipWhitespaceAndComments(reader: ByteReader): void {
  for (;;) {
    reader.skipWhitespace();
    if (reader.peek() !== 0x25) {
      return;
    }
    while (!reader.atEnd() && reader.peek() !== 0x0a && reader.peek() !== 0x0d) {
      reader.next();
    }
  }
}

function readNumberToken(reader: ByteReader): Token {
  const start = reader.offset;
  if (reader.peek() === 0x2b || reader.peek() === 0x2d) {
    reader.next();
  }
  while (isDigit(reader.peek())) {
    reader.next();
  }
  if (reader.peek() === 0x2e) {
    reader.next();
    while (isDigit(reader.peek())) {
      reader.next();
    }
  }
  const text = new TextDecoder('latin1').decode(reader.slice(start, reader.offset));
  return { kind: 'number', value: Number(text) };
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
    if (byte === 0x23 && isHexDigit(reader.peek(1)) && isHexDigit(reader.peek(2))) {
      reader.next();
      const hi = hexDigitValue(reader.next()!);
      const lo = hexDigitValue(reader.next()!);
      bytes.push(hi * 16 + lo);
    } else {
      bytes.push(reader.next()!);
    }
  }
  return { kind: 'name', value: new TextDecoder('latin1').decode(new Uint8Array(bytes)) };
}

// Balanced-parenthesis nesting, backslash escapes (named escapes, 1-3 digit octal, and line-continuation escapes that produce no byte at all), and unescaped CR/CRLF end-of-line markers normalised to a single LF -- all per 7.3.4.2's own literal-string rules.
function readLiteralStringToken(reader: ByteReader): Token {
  reader.next(); // consume '('
  const bytes: number[] = [];
  let depth = 1;
  for (;;) {
    const byte = reader.next();
    if (byte === undefined) {
      break; // truncated input -- return what was read so far; the caller (parse.ts) is responsible for deciding whether that's fatal
    }
    if (byte === 0x5c) {
      const esc = reader.next();
      if (esc === undefined) {
        break;
      }
      if (esc === 0x6e) {
        bytes.push(0x0a); // \n
      } else if (esc === 0x72) {
        bytes.push(0x0d); // \r
      } else if (esc === 0x74) {
        bytes.push(0x09); // \t
      } else if (esc === 0x62) {
        bytes.push(0x08); // \b
      } else if (esc === 0x66) {
        bytes.push(0x0c); // \f
      } else if (esc === 0x28 || esc === 0x29 || esc === 0x5c) {
        bytes.push(esc); // \( \) \\
      } else if (esc === 0x0d) {
        if (reader.peek() === 0x0a) {
          reader.next();
        }
        // line-continuation escape (\<CR> or \<CRLF>) -- produces no byte
      } else if (esc === 0x0a) {
        // line-continuation escape (\<LF>) -- produces no byte
      } else if (esc >= 0x30 && esc <= 0x37) {
        let value = esc - 0x30;
        for (let i = 0; i < 2 && reader.peek() !== undefined && reader.peek()! >= 0x30 && reader.peek()! <= 0x37; i++) {
          value = value * 8 + (reader.next()! - 0x30);
        }
        bytes.push(value & 0xff);
      } else {
        // "if the character following the REVERSE SOLIDUS is not one of those shown... the REVERSE SOLIDUS shall be ignored" (7.3.4.2) -- the escaped character is emitted literally.
        bytes.push(esc);
      }
      continue;
    }
    if (byte === 0x28) {
      depth++;
      bytes.push(byte);
      continue;
    }
    if (byte === 0x29) {
      depth--;
      if (depth === 0) {
        break;
      }
      bytes.push(byte);
      continue;
    }
    if (byte === 0x0d) {
      if (reader.peek() === 0x0a) {
        reader.next();
      }
      bytes.push(0x0a);
      continue;
    }
    bytes.push(byte);
  }
  return { kind: 'literalString', value: new Uint8Array(bytes) };
}

// Whitespace inside a hex string is ignored entirely; an odd trailing digit is zero-padded (7.3.4.3).
function readHexStringToken(reader: ByteReader): Token {
  reader.next(); // consume '<'
  const digits: number[] = [];
  for (;;) {
    const byte = reader.next();
    if (byte === undefined || byte === 0x3e) {
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
    bytes[i] = digits[i * 2]! * 16 + digits[i * 2 + 1]!;
  }
  return { kind: 'hexString', value: bytes };
}

// A keyword is simply the maximal run of regular bytes that isn't a number or a name -- this covers every PDF structural keyword (obj/endobj/stream/xref/trailer/true/false/null/R/...) and every content-stream operator (BT/Tf/Tj/re/cm/Do/...) with the same code, since the lexer has no notion of which keywords are "valid" in a given context; that's entirely parse.ts's and content-read.ts's own concern.
function readKeywordToken(reader: ByteReader): Token {
  const start = reader.offset;
  while (reader.peek() !== undefined && isRegularByte(reader.peek()!)) {
    reader.next();
  }
  const text = new TextDecoder('latin1').decode(reader.slice(start, reader.offset));
  return { kind: 'keyword', value: text };
}

// Reads and returns the next token, or undefined at end of input. `{`/`}` (PostScript calculator function syntax, rare and not modelled) are silently skipped rather than treated as an error, since skipping them and continuing costs nothing and a Type 4 PostScript function is already out of this parser's scope regardless.
export function nextToken(reader: ByteReader): Token | undefined {
  skipWhitespaceAndComments(reader);
  const byte = reader.peek();
  if (byte === undefined) {
    return undefined;
  }
  if (byte === 0x2f) {
    return readNameToken(reader);
  }
  if (byte === 0x28) {
    return readLiteralStringToken(reader);
  }
  if (byte === 0x3c) {
    if (reader.peek(1) === 0x3c) {
      reader.next();
      reader.next();
      return { kind: 'dictStart' };
    }
    return readHexStringToken(reader);
  }
  if (byte === 0x3e) {
    if (reader.peek(1) === 0x3e) {
      reader.next();
      reader.next();
      return { kind: 'dictEnd' };
    }
    reader.next(); // a lone '>' is lexically invalid; skip it and continue rather than treating one stray byte as fatal
    return nextToken(reader);
  }
  if (byte === 0x5b) {
    reader.next();
    return { kind: 'arrayStart' };
  }
  if (byte === 0x5d) {
    reader.next();
    return { kind: 'arrayEnd' };
  }
  if (byte === 0x7b || byte === 0x7d) {
    reader.next();
    return nextToken(reader);
  }
  if (byte === 0x2b || byte === 0x2d || byte === 0x2e || isDigit(byte)) {
    return readNumberToken(reader);
  }
  return readKeywordToken(reader);
}
