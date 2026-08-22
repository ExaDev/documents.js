import type { XmlElement, XmlNode } from '../../model/node';
import { decodeXmlText } from '../../xml/entities';
import { attrValue } from '../../xml/query';

// ODF paragraph/heading text content is not a plain string the way a docx run's w:t is: real whitespace collapses HTML-style in XML text-node content, so ODF represents a run of N literal space characters as <text:s text:c="N"/> (an ELEMENT, not text), a tab as <text:tab/>, and a hard line break as <text:line-break/> -- all three occupy real character positions in the paragraph's flat content model but carry no text-node value at all. A naive walk that only concatenates XmlText nodes silently drops every one of these, corrupting whitespace on read -- flagged during this package's own design work as the single most likely silent-corruption bug in the whole port.
//
// This module is the single, canonical implementation of "what does one unit of ODF inline text content mean", shared by two different consumers that must never be allowed to drift out of sync with each other: src/styles/span.ts (character-position splitting, to wrap a range in a text:span) and this file's own decodeOdfText (projecting that same content to a plain, human-readable string). Both dispatch on the exact same node shapes below -- text, text:s, text:tab, text:line-break, text:span (recurses into its own children), an inline field (recurses too: a field displays its cached text content, so it occupies exactly its children's width), anything else (zero-width: a bookmark, change-tracking markup, an anchored draw:frame) contributes nothing. typed/shared/paragraph.ts's run walk is a third consumer of the same content model and dispatches identically.

// Every inline field element ODF defines: the everyday simple fields (text:date, text:page-number, text:file-name, ...), the field-master instance families (text:variable-set/-get, text:user-field-get/-input, text:sequence, text:database-*), and the conditional/display family. All are members of ODF's common inline-text content model and every one displays its own text content as its cached result. The master DECLARATION side (text:*-decls) is block-level, never inline, so it is not part of this set. Declared here -- the content-model module -- rather than in typed/shared/constructs.ts because the question it answers ("does this element contribute text") belongs to this module's vocabulary, while constructs.ts (which imports it) answers what the field MEANS.
export const ODF_FIELD_TAGS: ReadonlySet<string> = new Set([
  // date and time
  'text:date',
  'text:time',
  // page geometry
  'text:page-number',
  'text:page-count',
  'text:page-continuation',
  // document facts
  'text:file-name',
  'text:sheet-name',
  'text:title',
  'text:subject',
  'text:keywords',
  'text:description',
  // author and sender
  'text:author-name',
  'text:author-initials',
  'text:sender-firstname',
  'text:sender-lastname',
  'text:sender-initials',
  'text:sender-title',
  'text:sender-position',
  'text:sender-email',
  'text:sender-phone-private',
  'text:sender-phone-work',
  'text:sender-fax',
  'text:sender-company',
  'text:sender-street',
  'text:sender-postal-code',
  'text:sender-city',
  'text:sender-country',
  'text:sender-state-or-province',
  // expressions and measure
  'text:expression',
  'text:measure',
  // input and placeholder shapes
  'text:text-input',
  'text:placeholder',
  'text:drop-down',
  // conditional display
  'text:conditional-text',
  'text:hidden-text',
  'text:execute',
  // variable master instances
  'text:variable-set',
  'text:variable-get',
  'text:variable-input',
  'text:user-field-get',
  'text:user-field-input',
  'text:sequence',
  // cross-reference displays: the *-ref display family (ODF 1.2 part 1, section 7.7). Each names its target by text:ref-name (a bookmark, a text:reference-mark, a note's text:id, a sequence) and states what to display of it through text:reference-format, carrying the last-computed display as its own text content -- grammatically a field. text:sequence-ref is the family's sequence-targeting member.
  'text:sequence-ref',
  'text:bookmark-ref',
  'text:note-ref',
  'text:reference-ref',
  // database field instances
  'text:database-display',
  'text:database-name',
  'text:database-next',
  'text:database-row-select',
  'text:database-value',
]);

export function isOdfFieldElement(element: XmlElement): boolean {
  return ODF_FIELD_TAGS.has(element.tag);
}

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

// The character-position length one XML node contributes to its container's flat text-content model: a text node's own string length, a text:s's text:c count, exactly 1 for text:tab/text:line-break, the recursive sum of a text:span's or an inline field's own children (neither carries length of its own beyond that), and 0 for anything else.
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
  if (node.tag === 'text:span' || isOdfFieldElement(node)) {
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
  if (node.tag === 'text:span' || isOdfFieldElement(node)) {
    return decodeOdfText(node);
  }
  return '';
}

// Decodes a paragraph's (or any other inline-text container's -- text:span, text:h, a table cell's text:p, ...) children into a plain, human-readable string: text nodes contribute their literal entity-decoded content, text:s expands to its text:c space count, text:tab becomes a literal tab, text:line-break becomes a literal newline, and a nested text:span or inline field recurses into its own children first -- exactly the whitespace-as-elements model real ODF paragraph content uses (see this file's own top-of-file note). Any other child (a bookmark, change-tracking markup, an anchored draw:frame) contributes nothing to the decoded string, matching measureOdfNodeLength's own zero-length treatment of the same nodes.
export function decodeOdfText(container: XmlElement): string {
  let text = '';
  for (const child of container.children) {
    text += decodeOdfNode(child);
  }
  return text;
}
