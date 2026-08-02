// A DELIBERATELY TRIVIAL block parser, existing only to feed the inline phase (src/inline/) something to parse until the real block phase (src/block/) is written. It recognises exactly two things: paragraphs (runs of non-blank lines separated by blank lines) and link reference definitions at the start of one. Everything else CommonMark defines as block structure -- headings, code blocks, block quotes, lists, thematic breaks, HTML blocks, tables -- is NOT recognised and is read as ordinary paragraph text.
//
// This lives in src/test-support/ (excluded from the published bundle by tsdown.config.ts) rather than in src/block/ precisely so it cannot be mistaken for the real thing or accidentally shipped. When src/block/ lands, this file goes away and the conformance suite points at it instead.
//
// Two things it does model faithfully, because the inline phase's own correctness depends on them:
//
//  - A paragraph continuation line's leading whitespace is stripped (spec 0.31.2's own paragraph rules), so `foo\` followed by an indented `bar` is a hard break followed by `bar`, not by `     bar`. Trailing whitespace is stripped only at the very END of the paragraph, never per line -- two trailing spaces mid-paragraph are a hard line break and must survive.
//  - Link reference definitions are collected across the WHOLE document before any block's inlines are parsed, and handed to every block as one shared map. That is not a convenience: definitions are forward-visible, so `[foo]` in the first paragraph resolves against a `[foo]: /url` on the last line. The real block phase must preserve this same two-pass shape.

import type { MarkdownDocumentNode, MarkdownParagraphNode } from '../ast/ast';
import type { InlineParseOptions } from '../inline/inline';
import { parseInlines } from '../inline/inline';
import type { LinkReferenceDefinition, LinkReferenceMap } from '../inline/link';
import { isBlankRemainderOfLine, matchLinkLabel, normalizeLinkLabel, parseLinkDestination, parseLinkTitle, skipInlineWhitespace } from '../inline/link';

// A definition needs a label with at least one non-whitespace character between its brackets, so the shortest possible match is `[x]` -- three characters.
const MIN_DEFINITION_LABEL_LENGTH = 3;

interface ParsedDefinition {
  readonly label: string;
  readonly definition: LinkReferenceDefinition;
  readonly end: number;
}

// spec 0.31.2, "Insecure characters": U+0000 must be replaced with U+FFFD. Line endings are normalised to a bare line feed first, so nothing downstream has to know about CRLF.
function normalizeSource(source: string): string {
  return source.replace(/\r\n|\r/g, '\n').replace(/\0/g, '�');
}

// spec 0.31.2, "Link reference definitions": a label, a colon, optional whitespace (including up to one line ending), a destination, then optionally more whitespace and a title -- with nothing but whitespace left on the line afterwards. A title that fails that last check is not part of this definition at all, and the definition still stands without it.
function parseDefinition(content: string, start: number): ParsedDefinition | undefined {
  const labelLength = matchLinkLabel(content, start);
  if (labelLength < MIN_DEFINITION_LABEL_LENGTH) {
    return undefined;
  }
  const rawLabel = content.slice(start, start + labelLength);
  const label = normalizeLinkLabel(rawLabel);
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

// Consumes every definition at the front of a paragraph's raw content, returning what is left to parse as inlines. spec 0.31.2: "If there are multiple matching reference link definitions, the one that comes first in the document is used" -- so a later duplicate never overwrites an earlier one.
function extractDefinitions(content: string, references: Map<string, LinkReferenceDefinition>): string {
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

function splitIntoParagraphs(source: string): string[] {
  const groups: string[][] = [];
  let current: string[] = [];
  for (const line of normalizeSource(source).split('\n')) {
    if (line.trim().length === 0) {
      if (current.length > 0) {
        groups.push(current);
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups.map((lines) => lines.map((line) => line.replace(/^[ \t]+/, '')).join('\n').replace(/[ \t]+$/, ''));
}

export interface ParsedMarkdown {
  readonly document: MarkdownDocumentNode;
  readonly references: LinkReferenceMap;
}

export function parseMarkdown(source: string, options: InlineParseOptions = {}): ParsedMarkdown {
  const references = new Map<string, LinkReferenceDefinition>();
  const contents = splitIntoParagraphs(source).map((content) => extractDefinitions(content, references));
  const children: MarkdownParagraphNode[] = contents
    .filter((content) => content.length > 0)
    .map((content) => ({ type: 'paragraph', children: parseInlines(content, references, options) }));
  return { document: { type: 'document', children }, references };
}
