import { decode, EntityLevel } from "entities";
import type { XmlCdata, XmlText } from "./node";

// The lossless xml/parse.ts layer keeps entity encoding raw (processEntities: false); this decodes entities in the one place text actually becomes ContentRun/heading/attribute text -- mirroring ooxml.js's own typed/util.ts decodeEntities, which draws the identical line between the lossless XML layer and its lossy typed projection. EntityLevel.HTML rather than XML: EPUB 3.3 content documents are well-formed XHTML, but real-world producers routinely emit HTML named character references (&nbsp;, &mdash;, &copy;, ...) and numeric references (&#160;, &#x2014;, ...) that plain XML has no built-in knowledge of at all -- HTML is a strict superset of the five XML entities, so this loses nothing for content that only ever uses those five (ExaDev/documents.js#1010). `entities` is already a transitive dependency of fast-xml-parser (the parser xml/parse.ts already depends on) and is the standard, actively-maintained library the wider HTML-tooling ecosystem (cheerio, htmlparser2, marked) uses for exactly this, rather than a hand-rolled named-entity table this package would then have to maintain itself.
export function decodeEntities(value: string): string {
  return decode(value, EntityLevel.HTML);
}

// The literal character-data content of a text-like node (xml/node.ts's own isTextLikeNode): decodes a text node's raw entity-encoded value, or returns a CDATA node's raw value untouched. The two are NOT interchangeable here even though every reader treats them as the same kind of content otherwise: a CDATA section's content is never subject to XML entity resolution in the first place -- a literal "&amp;" written inside `<![CDATA[ ]]>` means those five literal characters, not "&" -- so running a CDATA value back through decodeEntities would corrupt exactly the unescaped content CDATA exists to carry.
export function decodeTextLikeNode(node: XmlText | XmlCdata): string {
  return node.type === "cdata" ? node.value : decodeEntities(node.value);
}

// The inverse: escapes the five standard XML entities for text this package writes back out -- attribute values and text-node content alike. Ampersand first, so an already-escaped "&amp;" is never re-escaped into "&amp;amp;".
export function encodeEntities(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
