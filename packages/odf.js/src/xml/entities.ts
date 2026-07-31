// odf.js parses and serializes XML with processEntities:false (see src/xml/parse.ts and src/xml/build.ts): it never decodes or encodes entities itself, so text-node and attribute values in its model are stored exactly as they appear in the source XML. This means any new raw string this package wants to store into a text node's value or an attribute's value MUST be encoded here first, or a literal '&', '<', etc. would corrupt the serialized XML.
export function encodeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const XML_ENTITY_PATTERN = /&(?:amp|lt|gt|quot|apos);/g;

const XML_ENTITY_DECODE: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

// The inverse of encodeXmlText above, for the one direction odf.js's lossless model deliberately never performs on its own: a "typed" reader (src/typed/shared/*, and anything built on it) that wants to project raw XML text content into a plain, human-readable string -- a paragraph's decoded text, a meta.xml title -- must undo the five standard XML entities the lossless layer leaves untouched (see this file's own top-of-file note and xml/parse.ts's processEntities:false). Only those five predefined entities are recognised; ODF text content is well-formed XML 1.0, which has no numeric character references or HTML named entities beyond amp/lt/gt/quot/apos, so XML_ENTITY_PATTERN's five alternatives are exhaustive for anything a real ODF file's own text content can contain. The replacer's XML_ENTITY_DECODE[entity]! is safe without a fallback: the regex can only ever match one of that record's five exact keys.
export function decodeXmlText(value: string): string {
  return value.replace(XML_ENTITY_PATTERN, (entity) => XML_ENTITY_DECODE[entity]!);
}
