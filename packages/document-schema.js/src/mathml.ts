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

// MathMlElement is recursive through its own children -- the interface stays hand-written even though MathMlElementSchema is a real z.object() below, because MathMlNode's own binding needs an explicit z.ZodType<MathMlNode> annotation to escape TypeScript's circular-inference error (see MathMlNodeSchema's own comment), and that annotation has to name a type that already exists rather than one z.infer would derive from the very schema it annotates.
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

// Recursive structural guard, kept as a standalone public type guard alongside the real MathMlNodeSchema below (a caller narrowing an unknown value with no Zod import in hand still has this) -- no longer backing a z.custom() node itself, unlike ContentBlockSchema and ContentEmbeddedObjectSchema (src/content.ts) and MathExpressionSchema (src/math.ts), which still are.
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

// Defined before MathMlNodeSchema, and deliberately left with no z.ZodType<MathMlElement> annotation of its own -- ExaDev/documents.js#937's spike (see the README's "z.custom() vs z.lazy() for recursive schemas" section) found that annotating a discriminated union's own member schemas widens them so z.discriminatedUnion (which needs each member's internal propValues) rejects the union, while dropping every annotation entirely hits TypeScript's circular-inference error. The fix is annotating only the outer union's own binding below, leaving MathMlElementSchema (and every other member) unannotated and fully inferred. children recurses back to MathMlNodeSchema through z.lazy() rather than a direct reference, since MathMlNodeSchema's own binding is not yet initialised at this point in the module.
export const MathMlElementSchema = z.object({
  type: z.literal("element"),
  tag: z.string(),
  attributes: z.array(MathMlAttributeSchema),
  children: z.lazy(() => z.array(MathMlNodeSchema)),
});

// Both z.ZodType type arguments are MathMlNode -- not just the first (Output). Supplying only one, `z.ZodType<MathMlNode>`, leaves the second (Input) at its own default of `unknown`, which is invisible in this file (z.infer<> and every test here reads Output alone) but surfaces downstream: z.codec()'s own encode() callback is typed against a schema's *input*, so a package consuming this schema through z.codec() (markdown-codec's markdownCodec/markdownContentCodec) would see `mathml: unknown[]` in the value it hands to its own encode function, a real type-checking regression a same-package test run cannot catch since it never calls z.codec() over this schema itself. MathMlNodeSchema has no transform, so Input and Output are genuinely identical -- annotating both is correct, not just defensive.
export const MathMlNodeSchema: z.ZodType<MathMlNode, MathMlNode> =
  z.discriminatedUnion("type", [
    MathMlTextSchema,
    MathMlCdataSchema,
    MathMlCommentSchema,
    MathMlDeclarationSchema,
    MathMlPiSchema,
    MathMlElementSchema,
  ]);
