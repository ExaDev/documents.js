// HTML entity and numeric character reference decoding, per CommonMark 0.31.2's "Entity and numeric character references" section. Reads src/scan/entity-table.ts's generated WHATWG named-character-reference table (semicolon-terminated names only, which is the only form CommonMark recognises -- HTML5's own legacy unterminated forms such as `&amp` are deliberately NOT valid CommonMark entities).
//
// Kept separate from src/inline/inline.ts because the same decoding runs in two structurally different places: as an inline construct in its own right (producing a MarkdownEntityNode, which keeps the source text alongside the decoded value so writeMarkdown can emit the original spelling back), and as part of unescapeString below, which flattens escapes and entities inside a link destination or title -- where there is no node to attach a `raw` field to and only the decoded string survives.

import { HTML_ENTITY_TABLE } from '../scan/entity-table';
import { isAsciiPunctuation } from './chars';

// The Unicode replacement character every invalid or disallowed numeric reference decodes to. spec 0.31.2: "the character U+0000 must be replaced with the REPLACEMENT CHARACTER (U+FFFD)"; cmark applies the same substitution to out-of-range and surrogate codepoints, since neither can be represented as a real character in the output.
const REPLACEMENT_CHARACTER = '�';

const MAX_CODEPOINT = 0x10ffff;
const SURROGATE_FIRST = 0xd800;
const SURROGATE_LAST = 0xdfff;

// spec 0.31.2 grammar: a named reference is `&` + an entity name from the WHATWG list + `;`; a decimal reference is `&#` + 1-7 digits + `;`; a hexadecimal reference is `&#X`/`&#x` + 1-6 hex digits + `;`. The 31-character name bound and the digit-count bounds are the spec's own, not this package's invention -- they exist so a long run of text after a stray `&` cannot be scanned indefinitely.
const ENTITY_PATTERN = /^&(?:#[Xx]([0-9A-Fa-f]{1,6})|#([0-9]{1,7})|([A-Za-z][A-Za-z0-9]{1,31}));/;

export interface EntityMatch {
  // The literal source text consumed, including the leading `&` and trailing `;`.
  readonly raw: string;
  // The character(s) the reference decodes to -- more than one code point for the handful of WHATWG names that map to a sequence (e.g. `&NotEqualTilde;`).
  readonly value: string;
}

function codepointToString(codepoint: number): string {
  if (codepoint === 0 || codepoint > MAX_CODEPOINT || (codepoint >= SURROGATE_FIRST && codepoint <= SURROGATE_LAST)) {
    return REPLACEMENT_CHARACTER;
  }
  return String.fromCodePoint(codepoint);
}

// Matches an entity or numeric character reference starting at `start` (which must be the `&`). Returns undefined when what follows is not a valid reference at all -- a bare `&` is ordinary text, never an error.
export function matchEntity(text: string, start: number): EntityMatch | undefined {
  if (text.charAt(start) !== '&') {
    return undefined;
  }
  const match = ENTITY_PATTERN.exec(text.slice(start));
  if (match === null) {
    return undefined;
  }
  const [raw, hex, decimal, name] = match;
  if (hex !== undefined) {
    return { raw, value: codepointToString(Number.parseInt(hex, 16)) };
  }
  if (decimal !== undefined) {
    return { raw, value: codepointToString(Number.parseInt(decimal, 10)) };
  }
  if (name === undefined) {
    return undefined;
  }
  const resolved = HTML_ENTITY_TABLE[name];
  // An unrecognised name is not an entity at all -- `&MissingGlyph;` stays literal text, rather than degrading to a replacement character the way an out-of-range numeric reference does.
  if (resolved === undefined) {
    return undefined;
  }
  return { raw, value: resolved };
}

// Resolves backslash escapes and character references inside a string that is NOT itself parsed as inline content -- a link destination or a link title. spec 0.31.2: "backslash escapes and entity and numeric character references are recognized" in both. This is a flattening operation with no node structure of its own, which is exactly why it lives here rather than being expressed in terms of the inline parser's own dispatch loop.
export function unescapeString(text: string): string {
  if (!text.includes('\\') && !text.includes('&')) {
    return text;
  }
  let result = '';
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === '\\') {
      const next = text.charAt(index + 1);
      if (isAsciiPunctuation(next)) {
        result += next;
        index += 2;
        continue;
      }
      result += char;
      index += 1;
      continue;
    }
    if (char === '&') {
      const entity = matchEntity(text, index);
      if (entity !== undefined) {
        result += entity.value;
        index += entity.raw.length;
        continue;
      }
    }
    result += char;
    index += 1;
  }
  return result;
}
