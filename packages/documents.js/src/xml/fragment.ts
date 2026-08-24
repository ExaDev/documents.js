import type { Attribute, XmlElement, XmlNode, XmlText } from "ooxml.js";

// Typed node-construction factories. New XML fragments are always built this way -- as XmlNode object literals directly -- never by parsing a hand-written XML string, which would require a round trip through ooxml.js's parseXml just to produce a value the model already represents natively.

// Attribute values must already be XML-encoded (see src/xml/entities.ts's encodeXmlText) -- el() does not encode them, since ooxml.js's own model stores every string raw (processEntities:false) and never encodes on write.
export function el(
  tag: string,
  attrs: Record<string, string> = {},
  children: XmlNode[] = [],
): XmlElement {
  const attributes: Attribute[] = Object.entries(attrs).map(
    ([name, value]) => ({ name, value }),
  );
  return { type: "element", tag, attributes, children };
}

// value must already be XML-encoded -- see the note on el() above.
export function txt(value: string): XmlText {
  return { type: "text", value };
}
