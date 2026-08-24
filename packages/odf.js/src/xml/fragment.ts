import type { Attribute, XmlElement, XmlNode, XmlText } from "../model/node";

// Typed node-construction factories. New XML fragments (manifest.xml, and any caller hand-constructing content.xml/styles.xml/meta.xml/settings.xml) are always built this way -- as XmlNode object literals directly -- never by parsing a hand-written XML string, which would require a round trip through parseXml just to produce a value the model already represents natively. Unlike ooxml.js (a read-only package, where the equivalent factory lives only under src/test-support/ since nothing in that package ever writes new XML), odf.js writes manifest.xml itself, so this is production code, not test-only -- see manifest.ts's own note on why odf.js owns manifest writing.

// Attribute values must already be XML-encoded (see entities.ts's encodeXmlText) -- el() does not encode them, since this package's own model stores every string raw (processEntities:false) and never encodes on write.
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
