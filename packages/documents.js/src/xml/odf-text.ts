import type { XmlElement, XmlNode } from 'ooxml.js';
import { decodeOdfText as decodeOdfContainerText } from 'odf.js';
import { el, txt } from './fragment';
import { encodeXmlText } from './entities';

// *** READ THIS BEFORE TOUCHING ODF TEXT CONTENT ANYWHERE IN THIS CODEBASE ***
//
// ODF paragraph/heading text content is NOT a plain string the way a docx run's w:t is. Real whitespace collapses HTML-style when an ODF consumer renders XML text-node content, so the format represents a run of N>=2 literal space characters as <text:s text:c="N"/> (an ELEMENT, not text), a tab as <text:tab/>, and a hard line break as <text:line-break/> -- all three occupy real character positions in a paragraph's flat content model but carry no text-node value at all.
//
// Every ODF text getter in this codebase's editor layer MUST call decodeOdfText below -- NEVER ooxml.js's own textContent() helper, which is a plain text-node concatenation with no idea text:s/text:tab/text:line-break exist. textContent() would silently DROP every one of them: the file still parses as valid XML, so this bug produces no error, no warning, nothing -- just silently wrong, silently shorter text. This is the single most likely silent-corruption bug in the entire ODF port, flagged explicitly during this package's own design work. Repeat this warning at the top of every editor module (src/edit/odt/*, src/edit/odp/*, ...) that exposes a text getter, not just here.
//
// This module owns the encode direction (plain string -> ODF element sequence) locally, since odf.js is a read+manifest package with no write-side text builder of its own. The decode direction below delegates entirely to odf.js's own decodeOdfText (src/typed/shared/text.ts) rather than re-walking the same node shapes a second time -- see that function's own comment for why.

// The ODF convention this function encodes: a literal run of N>=2 consecutive spaces becomes one <text:s text:c="N"/> element (never emitted for N===1, where a real ODF renderer already preserves a single space without collapsing it -- odf.js's own getOdfSpaceCount/decodeOdfText treat text:c as optional, defaulting to 1, which is the read-side mirror of this same convention).
const MIN_SPACE_RUN_FOR_TEXT_S = 2;

// Plain string -> the ODF element sequence real ODF producers (LibreOffice) use for it: a run of two or more consecutive spaces becomes <text:s text:c="N"/>, a single space stays a literal text-node character, a tab becomes <text:tab/>, a newline becomes <text:line-break/>, and every other character is literal text-node content. Adjacent literal characters are coalesced into as few text nodes as practical -- one string buffer flushed only when a text:s/text:tab/text:line-break interrupts it, never one node per character. The inverse of decodeOdfText below; encodeOdfText(decodeOdfText(encodeOdfText(s))) round-trips to encodeOdfText(s) for any s (though not necessarily to the identical node sequence a different producer might have written for the same string, since e.g. a pre-existing <text:s text:c="1"/> decodes to the same single space this function would instead emit as a literal character).
export function encodeOdfText(text: string): XmlNode[] {
  const nodes: XmlNode[] = [];
  let literal = '';

  const flushLiteral = (): void => {
    if (literal.length > 0) {
      nodes.push(txt(encodeXmlText(literal)));
      literal = '';
    }
  };

  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch === ' ') {
      let runLength = 1;
      while (i + runLength < text.length && text[i + runLength] === ' ') {
        runLength += 1;
      }
      if (runLength >= MIN_SPACE_RUN_FOR_TEXT_S) {
        flushLiteral();
        nodes.push(el('text:s', { 'text:c': String(runLength) }));
      } else {
        literal += ' ';
      }
      i += runLength;
      continue;
    }
    if (ch === '\t') {
      flushLiteral();
      nodes.push(el('text:tab'));
      i += 1;
      continue;
    }
    if (ch === '\n') {
      flushLiteral();
      nodes.push(el('text:line-break'));
      i += 1;
      continue;
    }
    literal += ch;
    i += 1;
  }
  flushLiteral();

  return nodes;
}

// The exact inverse of encodeOdfText, and the ONLY correct way to read ODF inline text content back to a plain string anywhere in this codebase -- see this file's own top-of-file warning. odf.js's own decodeOdfText (src/typed/shared/text.ts, re-exported from odf.js's package root) already implements the entire node-type dispatch this needs (text / text:s / text:tab / text:line-break / text:span, entity-decoding raw text-node values along the way) -- but it is scoped one step more broadly than this function's own bare XmlNode[] signature, operating on a whole container XmlElement's .children rather than a standalone node array (it is designed to run directly against an already-decoded text:p/text:h element, not a fragment a caller assembled by hand). Rather than re-walk those same node shapes a second time in this package, this wraps `nodes` in a throwaway synthetic element and delegates the real work entirely to odf.js's implementation.
export function decodeOdfText(nodes: readonly XmlNode[]): string {
  const wrapper: XmlElement = el('_odf-text-container', {}, [...nodes]);
  return decodeOdfContainerText(wrapper);
}
