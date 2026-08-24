import { z } from "zod";

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

// Recursive structural guard. Used via z.custom so element children validate without a recursive Zod schema (which collapses to `unknown` under z.lazy in this zod version).
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
