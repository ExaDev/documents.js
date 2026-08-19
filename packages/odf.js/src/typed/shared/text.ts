import type { XmlElement, XmlNode } from '../../model/node';
import { decodeXmlText } from '../../xml/entities';
import { attrValue } from '../../xml/query';

// ODF paragraph/heading text content is not a plain string the way a docx run's w:t is: real whitespace collapses HTML-style in XML text-node content, so ODF represents a run of N literal space characters as <text:s text:c="N"/> (an ELEMENT, not text), a tab as <text:tab/>, and a hard line break as <text:line-break/> -- all three occupy real character positions in the paragraph's flat content model but carry no text-node value at all. A naive walk that only concatenates XmlText nodes silently drops every one of these, corrupting whitespace on read -- flagged during this package's own design work as the single most likely silent-corruption bug in the whole port.
//
// This module is the single, canonical implementation of "what does one unit of ODF inline text content mean", shared by two different consumers that must never be allowed to drift out of sync with each other: src/styles/span.ts (character-position splitting, to wrap a range in a text:span) and this file's own decodeOdfText (projecting that same content to a plain, human-readable string). Both dispatch on the exact same node shapes below -- text, text:s, text:tab, text:line-break, text:span (recurses into its own children), anything else (zero-width: a bookmark, a field, change-tracking markup, an anchored draw:frame) contributes nothing.

// text:s's own text:c attribute: the number of literal space characters this ONE element represents (default 1 when absent, per the ODF schema). Shared, not reimplemented per caller, so span.ts's splitting and this file's own measuring/decoding can never disagree about how many characters a text:s occupies.
export function getOdfSpaceCount(element: XmlElement): number {
  const raw = attrValue(element, 'text:c');
  if (raw === undefined) {
    return 1;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== raw) {
    throw new Error(`getOdfSpaceCount: text:s has a malformed text:c attribute: "${raw}"`);
  }
  return parsed;
}

// The character-position length one XML node contributes to its container's flat text-content model: a text node's own string length, a text:s's text:c count, exactly 1 for text:tab/text:line-break, the recursive sum of a text:span's own children (a text:span carries no length of its own beyond that), and 0 for anything else.
export function measureOdfNodeLength(node: XmlNode): number {
  if (node.type === 'text') {
    return node.value.length;
  }
  if (node.type !== 'element') {
    return 0;
  }
  if (node.tag === 'text:s') {
    return getOdfSpaceCount(node);
  }
  if (node.tag === 'text:tab' || node.tag === 'text:line-break') {
    return 1;
  }
  if (node.tag === 'text:span') {
    return sumOdfNodeLength(node.children);
  }
  return 0;
}

export function sumOdfNodeLength(nodes: readonly XmlNode[]): number {
  let total = 0;
  for (const node of nodes) {
    total += measureOdfNodeLength(node);
  }
  return total;
}

// Projects one node's ODF inline text content to its plain-text equivalent, dispatching on the identical node shapes measureOdfNodeLength uses above -- see this file's own top-of-file note on why the two must never diverge. A text node's raw value is entity-decoded (see xml/entities.ts's decodeXmlText) since odf.js's lossless model keeps entities raw for round-trip fidelity (processEntities:false -- see xml/parse.ts), and a plain-text projection is exactly the boundary where that raw encoding needs to be undone.
function decodeOdfNode(node: XmlNode): string {
  if (node.type === 'text') {
    return decodeXmlText(node.value);
  }
  if (node.type !== 'element') {
    return '';
  }
  if (node.tag === 'text:s') {
    return ' '.repeat(getOdfSpaceCount(node));
  }
  if (node.tag === 'text:tab') {
    return '\t';
  }
  if (node.tag === 'text:line-break') {
    return '\n';
  }
  if (node.tag === 'text:span') {
    return decodeOdfText(node);
  }
  return '';
}

// Decodes a paragraph's (or any other inline-text container's -- text:span, text:h, a table cell's text:p, ...) children into a plain, human-readable string: text nodes contribute their literal entity-decoded content, text:s expands to its text:c space count, text:tab becomes a literal tab, text:line-break becomes a literal newline, and a nested text:span recurses into its own children first -- exactly the whitespace-as-elements model real ODF paragraph content uses (see this file's own top-of-file note). Any other child (a bookmark, a field, change-tracking markup, an anchored draw:frame) contributes nothing to the decoded string, matching measureOdfNodeLength's own zero-length treatment of the same nodes.
export function decodeOdfText(container: XmlElement): string {
  let text = '';
  for (const child of container.children) {
    text += decodeOdfNode(child);
  }
  return text;
}
