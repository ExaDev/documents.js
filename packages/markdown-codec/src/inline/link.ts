// Link-syntax primitives shared by three callers that must agree exactly or reference resolution silently breaks: the inline phase's own inline-link parsing (`[text](dest "title")`), its reference-link resolution (`[text][label]`, `[text][]`, `[text]`), and the block phase's link-reference-definition scanning (`[label]: dest "title"`, not yet written -- see LinkReferenceMap below). A link label written by the block phase and a label read by the inline phase must normalise identically, so normalisation lives here once rather than being restated on each side.

import { isAsciiControl, isMarkdownSpace } from './chars';
import { unescapeString } from './entity';

export interface LinkReferenceDefinition {
  readonly destination: string;
  readonly title?: string;
}

// The document-global link-reference-definition table, keyed by NORMALISED label (normalizeLinkLabel below). Handed to the inline phase as an input rather than built by it: a definition is visible to every reference in the document regardless of order, so `[foo]` in the first paragraph resolves against a `[foo]: /url` on the last line. That forward visibility is exactly why this cannot be discovered per-block during inline parsing -- the block phase must have finished scanning the WHOLE document before any block's inlines are parsed.
export type LinkReferenceMap = ReadonlyMap<string, LinkReferenceDefinition>;

// spec 0.31.2: "A link label can have at most 999 characters inside the square brackets."
const MAX_LINK_LABEL_LENGTH = 999;

// spec 0.31.2: "To normalize a label, strip off the opening and closing brackets, perform the Unicode case fold, strip leading and trailing spaces, tabs, and line endings, and collapse consecutive internal spaces, tabs, and line endings to a single space."
//
// `toLowerCase().toUpperCase()` is the standard approximation of a full Unicode case fold using only the primitives ECMAScript exposes: lowercasing first collapses the case-mapping variants (Turkish dotted I, final sigma, and the like) onto a common form, and uppercasing that then folds the remaining pairs that differ only in case. A single toLowerCase() is NOT sufficient -- it leaves e.g. `ẞ` and `ß` distinct, which the spec's own case-folding requirement treats as the same label.
export function normalizeLinkLabel(labelWithBrackets: string): string {
  return labelWithBrackets
    .slice(1, labelWithBrackets.length - 1)
    .replace(/^[ \t\r\n]+/, '')
    .replace(/[ \t\r\n]+$/, '')
    .replace(/[ \t\r\n]+/g, ' ')
    .toLowerCase()
    .toUpperCase();
}

// Matches a link label starting at `start` (which must be the `[`), returning the length INCLUDING both brackets, or 0 when what follows is not a valid label. spec 0.31.2: a label "begins with a left bracket and ends with the first right bracket that is not backslash-escaped"; unescaped square brackets are not allowed between them. A zero-length or all-whitespace label is still matched here (length 2 for `[]`) -- distinguishing an empty label (a COLLAPSED reference) from a real one is the caller's job, and the two need different handling.
export function matchLinkLabel(text: string, start: number): number {
  if (text.charAt(start) !== '[') {
    return 0;
  }
  let index = start + 1;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === '[') {
      return 0;
    }
    if (char === ']') {
      const length = index + 1 - start;
      return length - 2 > MAX_LINK_LABEL_LENGTH ? 0 : length;
    }
    index += 1;
  }
  return 0;
}

export interface ParsedSpan {
  readonly value: string;
  readonly end: number;
}

// spec 0.31.2: a link destination is either "a sequence of zero or more characters between an opening `<` and a closing `>` that contains no line endings or unescaped `<` or `>` characters", or "a nonempty sequence of characters that does not start with `<`, does not include ASCII control characters or space, and includes parentheses only if (a) they are backslash-escaped or (b) they are part of a balanced pair of unescaped parentheses". Returns the UNESCAPED destination (backslash escapes and character references resolved) -- percent-encoding for an HTML `href` is a rendering concern, not a parse-time one, so the value here stays the author's own text and writeMarkdown can emit it back unchanged.
export function parseLinkDestination(text: string, start: number): ParsedSpan | undefined {
  if (text.charAt(start) === '<') {
    let index = start + 1;
    while (index < text.length) {
      const char = text.charAt(index);
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === '\n' || char === '<') {
        return undefined;
      }
      if (char === '>') {
        return { value: unescapeString(text.slice(start + 1, index)), end: index + 1 };
      }
      index += 1;
    }
    return undefined;
  }

  let index = start;
  let openParens = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === '\\' && text.length > index + 1) {
      index += 2;
      continue;
    }
    if (char === '(') {
      openParens += 1;
      index += 1;
      continue;
    }
    if (char === ')') {
      if (openParens === 0) {
        break;
      }
      openParens -= 1;
      index += 1;
      continue;
    }
    if (char === ' ' || isAsciiControl(char)) {
      break;
    }
    index += 1;
  }
  if (openParens !== 0) {
    return undefined;
  }
  // An empty destination is legal only in the `<>` form handled above; a bare empty run means there was no destination here at all. The one exception is an immediately-following `)`, which is an inline link with an omitted destination (`[link]()`).
  if (index === start && text.charAt(index) !== ')') {
    return undefined;
  }
  return { value: unescapeString(text.slice(start, index)), end: index };
}

const TITLE_DELIMITERS: ReadonlyMap<string, string> = new Map([
  ['"', '"'],
  ["'", "'"],
  ['(', ')'],
]);

// spec 0.31.2: a link title is a run between matching `"`, `'`, or `(`/`)`, with the delimiter itself permitted inside only when backslash-escaped. The parenthesised form additionally forbids an unescaped `(` as well as an unescaped `)`, since an unbalanced open paren inside would be ambiguous with the enclosing inline link's own parentheses.
export function parseLinkTitle(text: string, start: number): ParsedSpan | undefined {
  const opener = text.charAt(start);
  const closer = TITLE_DELIMITERS.get(opener);
  if (closer === undefined) {
    return undefined;
  }
  let index = start + 1;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === closer) {
      return { value: unescapeString(text.slice(start + 1, index)), end: index + 1 };
    }
    if (opener === '(' && char === '(') {
      return undefined;
    }
    index += 1;
  }
  return undefined;
}

// Skips spaces, tabs, and AT MOST ONE line ending -- the whitespace an inline link's own components may be separated by (spec 0.31.2: "These four components may be separated by spaces, tabs, and up to one line ending"). Two line endings would be a blank line, which ends the containing block entirely and therefore can never appear inside one link.
export function skipInlineWhitespace(text: string, start: number): number {
  let index = start;
  let seenLineEnding = false;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === '\n') {
      if (seenLineEnding) {
        break;
      }
      seenLineEnding = true;
      index += 1;
      continue;
    }
    if (char !== ' ' && char !== '\t') {
      break;
    }
    index += 1;
  }
  return index;
}

export function isBlankRemainderOfLine(text: string, start: number): boolean {
  let index = start;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === '\n') {
      return true;
    }
    if (!isMarkdownSpace(char)) {
      return false;
    }
    index += 1;
  }
  return true;
}
