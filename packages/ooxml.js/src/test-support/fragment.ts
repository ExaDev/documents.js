import type { Attribute, XmlElement, XmlNode, XmlText } from '../model/node';

// Typed node-construction factories for tests -- never imported by src/index.ts and never reaches dist/. New XML fragments are built this way, as XmlNode object literals directly, rather than by parsing a hand-written XML string, which would require a round trip through this package's own parseXml just to produce a value the model already represents natively. Ported from documents.js's src/xml/fragment.ts (there also used by production edit/* code; here it is test-only).

// Attribute values must already be XML-encoded -- el() does not encode them, since this package's own model stores every string raw (processEntities:false) and never encodes on write.
export function el(tag: string, attrs: Record<string, string> = {}, children: XmlNode[] = []): XmlElement {
  const attributes: Attribute[] = Object.entries(attrs).map(([name, value]) => ({ name, value }));
  return { type: 'element', tag, attributes, children };
}

// value must already be XML-encoded -- see the note on el() above.
export function txt(value: string): XmlText {
  return { type: 'text', value };
}
