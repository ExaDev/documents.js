// Link reference definitions (spec 0.31.2, "Link reference definitions"): a label, a colon, optional whitespace including up to one line ending, a destination, then optionally more whitespace and a title -- with nothing but whitespace left on the line afterwards.
//
// A definition is not a block. It is recognised only at the FRONT of a paragraph's accumulated content, when that paragraph closes, and it consumes the text it matched; a paragraph that turns out to be nothing but definitions leaves no block behind at all. That is why this lives beside the block phase rather than inside the inline phase: the destination/title grammar is inline (imported from src/inline/link.ts, the only thing the block phase asks the inline phase for), but WHEN a definition is recognised is a block-structure question.
//
// The resulting table is document-global and forward-visible -- `[foo]` in the first paragraph resolves against a `[foo]: /url` on the last line, including one nested inside a block quote or a list item -- so it must be complete before any block's inlines are parsed. src/block/block.ts guarantees that structurally by parsing every block first and every inline second, rather than by ordering the two carefully.

import type { LinkReferenceDefinition } from '../inline/link';
import { isBlankRemainderOfLine, matchLinkLabel, normalizeLinkLabel, parseLinkDestination, parseLinkTitle, skipInlineWhitespace } from '../inline/link';

// A definition needs a label with at least one non-whitespace character between its brackets, so the shortest possible match is `[x]` -- three characters.
const MIN_DEFINITION_LABEL_LENGTH = 3;

interface ParsedDefinition {
  readonly label: string;
  readonly definition: LinkReferenceDefinition;
  readonly end: number;
}

function parseDefinition(content: string, start: number): ParsedDefinition | undefined {
  const labelLength = matchLinkLabel(content, start);
  if (labelLength < MIN_DEFINITION_LABEL_LENGTH) {
    return undefined;
  }
  const label = normalizeLinkLabel(content.slice(start, start + labelLength));
  if (label.length === 0) {
    return undefined;
  }
  let cursor = start + labelLength;
  if (content.charAt(cursor) !== ':') {
    return undefined;
  }
  cursor = skipInlineWhitespace(content, cursor + 1);

  const destination = parseLinkDestination(content, cursor);
  if (destination === undefined) {
    return undefined;
  }
  const afterDestination = destination.end;

  // A title that does not end the line is not part of this definition at all -- and the definition still stands without it, with the would-be title left as the start of the following paragraph.
  let title: string | undefined;
  cursor = afterDestination;
  const beforeTitle = skipInlineWhitespace(content, afterDestination);
  if (beforeTitle > afterDestination) {
    const parsedTitle = parseLinkTitle(content, beforeTitle);
    if (parsedTitle !== undefined && isBlankRemainderOfLine(content, parsedTitle.end)) {
      title = parsedTitle.value;
      cursor = parsedTitle.end;
    }
  }

  if (!isBlankRemainderOfLine(content, cursor)) {
    return undefined;
  }
  const lineEnd = content.indexOf('\n', cursor);
  return {
    label,
    definition: title === undefined ? { destination: destination.value } : { destination: destination.value, title },
    end: lineEnd === -1 ? content.length : lineEnd + 1,
  };
}

// Consumes every definition at the front of `content`, recording each in `references`, and returns what is left to parse as inline content. spec 0.31.2: "If there are multiple matching reference link definitions, the one that comes first in the document is used" -- so a later duplicate never overwrites an earlier one.
export function extractDefinitions(content: string, references: Map<string, LinkReferenceDefinition>): string {
  let cursor = 0;
  for (;;) {
    const parsed = parseDefinition(content, cursor);
    if (parsed === undefined) {
      return content.slice(cursor);
    }
    if (!references.has(parsed.label)) {
      references.set(parsed.label, parsed.definition);
    }
    cursor = parsed.end;
  }
}
