// Link reference definitions (spec 0.31.2, "Link reference definitions"): a label, a colon, optional whitespace including up to one line ending, a destination, then optionally more whitespace and a title -- with nothing but whitespace left on the line afterwards.
//
// A definition is not a block. It is recognised only at the FRONT of a paragraph's accumulated content, when that paragraph closes, and it consumes the text it matched; a paragraph that turns out to be nothing but definitions leaves no block behind at all. That is why this lives beside the block phase rather than inside the inline phase: the destination/title grammar is inline (imported from src/inline/link.ts, the only thing the block phase asks the inline phase for), but WHEN a definition is recognised is a block-structure question.
//
// The resulting table is document-global and forward-visible -- `[foo]` in the first paragraph resolves against a `[foo]: /url` on the last line, including one nested inside a block quote or a list item -- so it must be complete before any block's inlines are parsed. src/block/block.ts guarantees that structurally by parsing every block first and every inline second, rather than by ordering the two carefully.

import type { MarkdownDiagnosticSink } from "../diagnostics/diagnostics";
import {
  MarkdownDiagnosticCodes,
  NOOP_MARKDOWN_DIAGNOSTIC_SINK,
} from "../diagnostics/diagnostics";
import type { LinkReferenceDefinition } from "../inline/link";
import {
  isBlankRemainderOfLine,
  matchLinkLabel,
  normalizeLinkLabel,
  parseLinkDestination,
  parseLinkTitle,
  skipInlineWhitespace,
} from "../inline/link";

interface ParsedDefinition {
  readonly label: string;
  readonly definition: LinkReferenceDefinition;
  readonly end: number;
}

function parseDefinition(
  content: string,
  start: number,
): ParsedDefinition | undefined {
  // No separate "is the label at least [x] long" length guard: matchLinkLabel returns 0 (no bracket at all) or a real bracket-pair length of 2 or more, and a length-2 match ("[]") slices to an empty inner label just as a length-0 match's own empty slice does -- both already fall out of the label.length === 0 check below, so a dedicated minimum-length rejection could never see a case the empty-label check doesn't already reject.
  const labelLength = matchLinkLabel(content, start);
  const label = normalizeLinkLabel(content.slice(start, start + labelLength));
  if (label.length === 0) {
    return undefined;
  }
  let cursor = start + labelLength;
  if (content.charAt(cursor) !== ":") {
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
    if (
      parsedTitle !== undefined &&
      isBlankRemainderOfLine(content, parsedTitle.end)
    ) {
      title = parsedTitle.value;
      cursor = parsedTitle.end;
    }
  }

  if (!isBlankRemainderOfLine(content, cursor)) {
    return undefined;
  }
  const lineEnd = content.indexOf("\n", cursor);
  return {
    label,
    definition:
      title === undefined
        ? { destination: destination.value }
        : { destination: destination.value, title },
    end: lineEnd === -1 ? content.length : lineEnd + 1,
  };
}

// Consumes every definition at the front of `content`, recording each in `references`, and returns what is left to parse as inline content. spec 0.31.2: "If there are multiple matching reference link definitions, the one that comes first in the document is used" -- so a later duplicate never overwrites an earlier one, and the sink is told about the one that lost, as a recover-tier diagnostic (this is spec-legal markdown, not a parse error).
export function extractDefinitions(
  content: string,
  references: Map<string, LinkReferenceDefinition>,
  sink: MarkdownDiagnosticSink = NOOP_MARKDOWN_DIAGNOSTIC_SINK,
  startLine = 0,
): string {
  let cursor = 0;
  for (;;) {
    const parsed = parseDefinition(content, cursor);
    if (parsed === undefined) {
      return content.slice(cursor);
    }
    if (references.has(parsed.label)) {
      sink({
        code: MarkdownDiagnosticCodes.DUPLICATE_LINK_REFERENCE,
        severity: "warning",
        message: `link reference definition "${parsed.label}" was already defined earlier in the document; this later definition is ignored`,
        line: startLine + countNewlines(content, cursor),
      });
    } else {
      references.set(parsed.label, parsed.definition);
    }
    cursor = parsed.end;
  }
}

function countNewlines(content: string, upTo: number): number {
  return content.slice(0, upTo).split("\n").length - 1;
}
