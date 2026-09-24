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

// Reached only if XmlNode ever gains a variant a switch over its own `type` field does not match: every current member is covered wherever this is called, so `value` narrows to `never` at each real call site, and adding an uncovered type makes that narrowing fail and those calls stop compiling. That is the real safety net. Shared between compact.ts's encodeNode and xml/build.ts's toOrderedNode, both of which switch over this identical XmlNode union, rather than each keeping a byte-identical copy. Exported so node.test.ts can exercise the throw directly with a forced-invalid cast: it is otherwise unreachable, since every real XmlNode type is already handled in both switches.
export function assertNeverXmlNodeType(value: never): never {
  throw new Error(`XmlNode: unhandled type ${JSON.stringify(value)}`);
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
