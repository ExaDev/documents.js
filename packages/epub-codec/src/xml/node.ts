import { z } from "zod";

// The lossless XML node model this package's OCF/OPF/nav/XHTML parsing all share, mirroring ooxml.js's and odf.js's own model/node.ts exactly (an ordered forest matching XML mixed content -- text/cdata/comment/declaration/pi/element). Unlike those two siblings, this package has no separate byte-fidelity "Package" layer sitting above it: an EPUB's XML parts are read straight into ContentDocument, so this model exists purely as the shared parse/build/query intermediate for src/opf, src/nav, and src/xhtml, not as a published lossless round-trip artefact in its own right.

export const AttributeSchema = z.object({
  name: z.string(),
  value: z.string(),
});
export type Attribute = z.infer<typeof AttributeSchema>;

export const XmlTextSchema = z.object({
  type: z.literal("text"),
  value: z.string(),
});
export type XmlText = z.infer<typeof XmlTextSchema>;

export const XmlCdataSchema = z.object({
  type: z.literal("cdata"),
  value: z.string(),
});
export type XmlCdata = z.infer<typeof XmlCdataSchema>;

export const XmlCommentSchema = z.object({
  type: z.literal("comment"),
  value: z.string(),
});
export type XmlComment = z.infer<typeof XmlCommentSchema>;

export const XmlDeclarationSchema = z.object({
  type: z.literal("declaration"),
  attributes: z.array(AttributeSchema),
});
export type XmlDeclaration = z.infer<typeof XmlDeclarationSchema>;

export const XmlPiSchema = z.object({
  type: z.literal("pi"),
  target: z.string(),
  content: z.string(),
});
export type XmlPi = z.infer<typeof XmlPiSchema>;

export interface XmlElement {
  type: "element";
  tag: string;
  attributes: Attribute[];
  children: XmlNode[];
}

export type XmlNode =
  XmlText | XmlCdata | XmlComment | XmlDeclaration | XmlPi | XmlElement;

// A text-bearing leaf node: an ordinary text node or a CDATA section, both literal character data as far as every reader in this package is concerned -- a CDATA section is simply the alternate XML spelling a producer reaches for when its own literal text would otherwise need escaping (a code sample or other content containing a raw `<`/`&`), never a distinct kind of content. Every reader that dispatches on node type to decide what counts as real, extractable text must treat the two identically or it silently drops whichever real-world documents happen to use CDATA -- see xml/entities.ts's decodeTextLikeNode for the one respect in which they are NOT interchangeable (entity encoding), which a caller folding the two together must still honour.
export function isTextLikeNode(node: XmlNode): node is XmlText | XmlCdata {
  return node.type === "text" || node.type === "cdata";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAttribute(value: unknown): value is Attribute {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.value === "string"
  );
}

// Recursive structural guard. Used via z.custom so element children validate without a recursive Zod schema (which collapses to `unknown` under z.lazy in this pinned Zod version) -- the same pattern ooxml.js's and odf.js's own XmlNode carry.
export function isXmlNode(value: unknown): value is XmlNode {
  if (!isRecord(value)) {
    return false;
  }
  const t = value.type;
  if (t === "text" || t === "cdata" || t === "comment") {
    return typeof value.value === "string";
  }
  if (t === "declaration") {
    return (
      Array.isArray(value.attributes) && value.attributes.every(isAttribute)
    );
  }
  if (t === "pi") {
    return (
      typeof value.target === "string" && typeof value.content === "string"
    );
  }
  if (t === "element") {
    return (
      typeof value.tag === "string" &&
      Array.isArray(value.attributes) &&
      value.attributes.every(isAttribute) &&
      Array.isArray(value.children) &&
      value.children.every(isXmlNode)
    );
  }
  return false;
}

export const XmlElementSchema = z.object({
  type: z.literal("element"),
  tag: z.string(),
  attributes: z.array(AttributeSchema),
  children: z.array(z.custom<XmlNode>(isXmlNode)),
});

export const XmlNodeSchema = z.discriminatedUnion("type", [
  XmlTextSchema,
  XmlCdataSchema,
  XmlCommentSchema,
  XmlDeclarationSchema,
  XmlPiSchema,
  XmlElementSchema,
]);
