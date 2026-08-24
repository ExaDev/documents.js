import type { Attribute, XmlElement, XmlNode, XmlText } from "../model/node";

// Typed node-construction factories. Genuinely new XML fragments (currently: typed/xlsx/build.ts's buildXlsxPackageFromContent, the first part of this package that ever WRITES a fresh part rather than only decoding/re-encoding an existing one) are built this way -- as XmlNode object literals directly -- never by parsing a hand-written XML string, which would require a round trip through parseXml just to produce a value the model already represents natively. Mirrors odf.js's own src/xml/fragment.ts, which solved the identical problem when that package first needed to write manifest.xml.

// Attribute values must already be XML-encoded (see entities.ts's encodeXmlText) -- el() does not encode them, since this package's own model stores every string raw (processEntities:false, see xml/parse.ts and xml/build.ts) and never encodes on write.
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
