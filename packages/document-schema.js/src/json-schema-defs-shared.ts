// The constants and the JSON Schema type alias every defs part shares, split from content-json-schema-defs.ts so each part module imports them from a leaf rather than from the assembler that merges the parts (which would be a module cycle).
import { type z } from "zod";
import { schemaUriFor } from "./schema-io";

export type JsonSchema = z.core.JSONSchema.JSONSchema;
export const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
export const EMBEDDED_OBJECT_KINDS = [
  "formula",
  "wordprocessing",
  "presentation",
  "spreadsheet",
  "drawing",
  "chart",
];
// The genuine cycle back to a whole ContentDocument: ContentEmbeddedObject(Block)'s own `document` field. Resolved once here since both the ContentEmbeddedObjectBlock fragment below and scripts/generate-json-schemas.mjs's own override() branch for the standalone ContentEmbeddedObjectSchema need the identical URI.
export const CONTENT_DOCUMENT_URI = schemaUriFor("ContentDocument");

export // The two binder variants (MathSum/MathProd) differ only in their kind discriminant — one builder rather than two copies of the same twelve-line fragment, so a binder-field change lands in both or fails the hand re-verification visibly in the diff.
function mathBinderDef(kind: "sum" | "prod"): JsonSchema {
  return {
    type: "object",
    properties: {
      kind: { type: "string", const: kind },
      binder: { type: "string" },
      lower: { $ref: "#/$defs/MathExpression" },
      upper: { $ref: "#/$defs/MathExpression" },
      body: { $ref: "#/$defs/MathExpression" },
    },
    required: ["kind", "binder", "lower", "upper", "body"],
    additionalProperties: false,
  };
}
