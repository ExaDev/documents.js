import type { XmlCdata, XmlText } from "./node";

// The lossless xml/parse.ts layer keeps entity encoding raw (processEntities: false); this decodes the five standard XML entities in the one place text actually becomes ContentRun/heading/attribute text -- mirroring ooxml.js's own typed/util.ts decodeEntities, which draws the identical line between the lossless XML layer and its lossy typed projection.
export function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => {
    switch (entity) {
      case "&amp;":
        return "&";
      case "&lt;":
        return "<";
      case "&gt;":
        return ">";
      case "&quot;":
        return '"';
      case "&apos;":
        return "'";
      default:
        return entity;
    }
  });
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
