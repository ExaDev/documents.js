import { z } from "zod";

// A raw MathML presentation-layer node tree, carried verbatim as parsed XML rather than remodelled into a MathML-specific element vocabulary (mi/mn/mo/mfrac/msqrt/...). This is deliberate: a formula's own meaning lives in its element tree, and every producer in this family already has that tree in hand as generic XML nodes -- odf.js's readOdfFormula returns exactly this shape from an ODF formula sub-document, and documents.js's own MathML typesetting engine consumes exactly this shape. Modelling each MathML element as its own Zod variant here would force every producer to translate into (and every consumer to translate back out of) a second vocabulary, for no validation the typesetting engine doesn't already have to do itself against the MathML specification.
//
// The shape below is transcribed field-for-field from odf.js's own src/model/node.ts (XmlText/XmlCdata/XmlComment/XmlDeclaration/XmlPi/XmlElement plus Attribute), so odf.js's readOdfFormula output assigns to MathMlNode with zero cast or wrapper -- the same structural-mirror trick documents.js already uses between ooxml.js's and odf.js's own container types. Every variant keeps its real payload (an element's tag/attributes/children, a text/cdata/comment's value, a declaration's attributes, a processing instruction's target/content): narrowing any of them away here would break that assignability and silently drop content on the way through.

export const MathMlAttributeSchema = z.object({
  name: z.string(),
  value: z.string(),
});
export type MathMlAttribute = z.infer<typeof MathMlAttributeSchema>;

export const MathMlTextSchema = z.object({
  type: z.literal("text"),
  value: z.string(),
});
export type MathMlText = z.infer<typeof MathMlTextSchema>;

export const MathMlCdataSchema = z.object({
  type: z.literal("cdata"),
  value: z.string(),
});
export type MathMlCdata = z.infer<typeof MathMlCdataSchema>;

export const MathMlCommentSchema = z.object({
  type: z.literal("comment"),
  value: z.string(),
});
export type MathMlComment = z.infer<typeof MathMlCommentSchema>;

export const MathMlDeclarationSchema = z.object({
  type: z.literal("declaration"),
  attributes: z.array(MathMlAttributeSchema),
});
export type MathMlDeclaration = z.infer<typeof MathMlDeclarationSchema>;

export const MathMlPiSchema = z.object({
  type: z.literal("pi"),
  target: z.string(),
  content: z.string(),
});
export type MathMlPi = z.infer<typeof MathMlPiSchema>;

// MathMlElement is recursive through its own children -- hand-written, mirroring ContentBlock's and odf.js's XmlElement's identical treatment, since z.lazy() collapses to `unknown` for recursive element children in the pinned Zod version.
export interface MathMlElement {
  type: "element";
  tag: string;
  attributes: MathMlAttribute[];
  children: MathMlNode[];
}

export type MathMlNode =
  | MathMlText
  | MathMlCdata
  | MathMlComment
  | MathMlDeclaration
  | MathMlPi
  | MathMlElement;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMathMlAttribute(value: unknown): value is MathMlAttribute {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.value === "string"
  );
}

// Recursive structural guard. Used via z.custom so element children validate without a recursive Zod schema (which collapses to `unknown` under z.lazy in this Zod version) -- one of this package's z.custom() recursion nodes, alongside ContentBlockSchema and ContentEmbeddedObjectSchema (src/content.ts) and MathExpressionSchema (src/math.ts).
export function isMathMlNode(value: unknown): value is MathMlNode {
  if (!isRecord(value)) {
    return false;
  }
  const type = value.type;
  if (type === "text" || type === "cdata" || type === "comment") {
    return typeof value.value === "string";
  }
  if (type === "declaration") {
    return (
      Array.isArray(value.attributes) &&
      value.attributes.every(isMathMlAttribute)
    );
  }
  if (type === "pi") {
    return (
      typeof value.target === "string" && typeof value.content === "string"
    );
  }
  if (type === "element") {
    return (
      typeof value.tag === "string" &&
      Array.isArray(value.attributes) &&
      value.attributes.every(isMathMlAttribute) &&
      Array.isArray(value.children) &&
      value.children.every(isMathMlNode)
    );
  }
  return false;
}

export const MathMlNodeSchema = z.custom<MathMlNode>(isMathMlNode);

// The element variant on its own, matching the sibling per-variant schemas above even though MathMlNodeSchema itself validates every variant, element included, through the single custom guard above.
export const MathMlElementSchema = z.object({
  type: z.literal("element"),
  tag: z.string(),
  attributes: z.array(MathMlAttributeSchema),
  children: z.array(MathMlNodeSchema),
});
