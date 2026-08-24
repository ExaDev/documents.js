// ooxml.js parses and serializes XML with processEntities:false (confirmed directly in its src/xml/parse.ts and src/xml/build.ts): it never decodes or encodes entities itself, so both text- node values and attribute values in its model are stored exactly as they appeared in the source XML. Its own decodeEntities (src/typed/util.ts, exported from the package root) is a read-only, lossy-view convenience -- the lossless layer keeps entities raw for fidelity.
//
// This means: any new raw string documents.js wants to store into a text node's value or an attribute's value MUST be encoded here first, or a literal '&', '<', etc. would corrupt the serialized XML. encodeXmlText is the exact inverse of ooxml.js's decodeEntities.
export function encodeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const LEADING_OR_TRAILING_WHITESPACE = /^\s|\s$/;

// True whenever `text` has leading or trailing whitespace that an XML processor would otherwise collapse -- w:t (and a:t) must then carry xml:space="preserve", or Word/PowerPoint silently trims it.
export function needsSpacePreserve(text: string): boolean {
  return LEADING_OR_TRAILING_WHITESPACE.test(text);
}
