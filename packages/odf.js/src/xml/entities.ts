// odf.js parses and serializes XML with processEntities:false (see src/xml/parse.ts and src/xml/build.ts): it never decodes or encodes entities itself, so text-node and attribute values in its model are stored exactly as they appear in the source XML. This means any new raw string this package wants to store into a text node's value or an attribute's value MUST be encoded here first, or a literal '&', '<', etc. would corrupt the serialized XML.
export function encodeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
