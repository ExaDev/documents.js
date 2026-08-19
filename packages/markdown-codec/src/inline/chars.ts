// The character classes CommonMark's own inline grammar is defined in terms of (spec 0.31.2, "Characters and lines" / "Insecure characters"), kept in one module because three separate parts of the inline phase depend on the *same* definitions and would silently diverge if each restated them: backslash escapes (src/inline/inline.ts) need the ASCII punctuation set, delimiter-run flanking (src/inline/delimiter.ts) needs the Unicode whitespace/punctuation predicates, and link destination scanning (src/inline/link.ts) needs both plus the ASCII-control set.
//
// The two Unicode predicates are regex `\p{...}` property escapes rather than hand-transcribed codepoint ranges, for the same "generate from the real Unicode data, never transcribe by hand" reason documents.js's own MathML mathvariant table is generated from UnicodeData.txt: the engine's own tables are the authority and stay correct across Unicode revisions without this package tracking them. Note spec 0.31.2 widened "Unicode punctuation character" to the `P` **and `S`** general categories (it was `P`-only through 0.30) -- getting this wrong changes emphasis flanking for every symbol character, so it is stated here once rather than at each of the three call sites.

// spec 0.31.2: "An ASCII punctuation character is `!`, `"`, `#`, `$`, `%`, `&`, `'`, `(`, `)`, `*`, `+`, `,`, `-`, `.`, `/` (U+0021-2F), `:`, `;`, `<`, `=`, `>`, `?`, `@` (U+003A-0040), `[`, `\`, `]`, `^`, `_`, `` ` `` (U+005B-0060), `{`, `|`, `}`, or `~` (U+007B-007E)." This is exactly the set a backslash may escape.
const ASCII_PUNCTUATION_CHARS = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

const ASCII_PUNCTUATION: ReadonlySet<string> = new Set(ASCII_PUNCTUATION_CHARS.split(''));

export function isAsciiPunctuation(char: string): boolean {
  return ASCII_PUNCTUATION.has(char);
}

// spec 0.31.2: "A Unicode whitespace character is a character in the Unicode `Zs` general category, or a tab (U+0009), line feed (U+000A), form feed (U+000C), or carriage return (U+000D)." Note U+000B (vertical tab) is deliberately absent -- it is neither `Zs` nor one of the four named characters.
const UNICODE_WHITESPACE_PATTERN = /^[\p{Zs}\t\n\f\r]$/u;

export function isUnicodeWhitespace(char: string): boolean {
  return UNICODE_WHITESPACE_PATTERN.test(char);
}

// spec 0.31.2: "A Unicode punctuation character is a character in the Unicode `P` (puncuation) or `S` (symbol) general categories." The `S` half is new in 0.31.2 and is load-bearing for emphasis flanking around symbols such as `+`, `=`, `~`, `$`, and every emoji.
const UNICODE_PUNCTUATION_PATTERN = /^[\p{P}\p{S}]$/u;

export function isUnicodePunctuation(char: string): boolean {
  return UNICODE_PUNCTUATION_PATTERN.test(char);
}

// spec 0.31.2: "An ASCII control character is a character between U+0000-1F (both including) or U+007F."
export function isAsciiControl(char: string): boolean {
  const code = char.codePointAt(0);
  if (code === undefined) {
    return false;
  }
  return code <= 0x1f || code === 0x7f;
}

// Whether any ASCII control character or space appears in `text` -- the exclusion an absolute URI inside an autolink is defined by (spec 0.31.2: "zero or more characters other than ASCII control characters, space, `<`, and `>`"). Written as a scan rather than a regex character range deliberately: a `[\x00-\x20]` class is a literal control character embedded in a pattern, which is both unreadable and exactly what eslint's own no-control-regex rule exists to catch.
export function containsAsciiControlOrSpace(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (isAsciiControl(text.charAt(index)) || text.charAt(index) === ' ') {
      return true;
    }
  }
  return false;
}

// Spaces, tabs, and line endings -- the whitespace vocabulary CommonMark's own *syntactic* rules use (link label normalisation, the whitespace permitted between an inline link's components), as opposed to the full Unicode whitespace class the flanking rules use. Kept distinct deliberately: collapsing the two would make a non-breaking space count as a label separator, which the spec does not allow.
export function isMarkdownSpace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

// The full code point ending at `index` (exclusive), as a string -- surrogate-pair aware, so an astral punctuation or symbol character adjacent to a delimiter run is classified as the single character it really is rather than as its lone low surrogate (which is in neither `\p{P}` nor `\p{S}` and would silently flip a flanking decision). Returns '\n' at the start of the string, per the flanking rules' own "the beginning and the end of the line count as Unicode whitespace".
export function codePointBefore(text: string, index: number): string {
  if (index <= 0) {
    return '\n';
  }
  const low = text.charCodeAt(index - 1);
  if (index >= 2 && low >= 0xdc00 && low <= 0xdfff) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) {
      return text.slice(index - 2, index);
    }
  }
  return text.slice(index - 1, index);
}

// The full code point starting at `index`, as a string -- the forward counterpart to codePointBefore, returning '\n' past the end of the string for the same reason.
export function codePointAt(text: string, index: number): string {
  if (index >= text.length) {
    return '\n';
  }
  const code = text.codePointAt(index);
  if (code === undefined) {
    return '\n';
  }
  return String.fromCodePoint(code);
}
