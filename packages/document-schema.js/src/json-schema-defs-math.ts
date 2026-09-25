// Hand-transcribed JSON Schema fragments for the $defs map, split from content-json-schema-defs.ts (see that module for the transcription discipline and the live-comparison regression suite). Merged into CONTENT_DEFS by property descriptor so this part occupies its exact place in the key order.
import { SI_BASE_DIMENSIONS } from "./math";
import {
  type JsonSchema,
  MAX_SAFE_INTEGER,
  mathBinderDef,
} from "./json-schema-defs-shared";

export const DEFS_MATH: Record<string, JsonSchema> = {
  //
  // — The math value schemas (src/math.ts) --
  //
  // ContentFormula itself (src/content.ts): a real z.object() whose every field is a real, non-custom schema now — `mathml` reaching MathMlNodeSchema since ExaDev/documents.js#937, `content` reaching the now-real, self-recursive MathExpressionSchema since #1009 — so the generator's override() replacing every occurrence with a $ref to this fragment is for the SAME "named reference instead of duplicated inlining" reason SymbolTableSchema gets that treatment, not because any field still resolves to an opaque node. Transcribed by hand regardless, alongside MathExpression and its own recursive variants below, per this file's own top comment; presentation/provenance/starMath are transcribed alongside rather than left to inline, so the whole fragment tree under `formula` lives here where content-json-schema-defs.test.ts's own live comparison can see the leaves.
  ContentFormula: {
    type: "object",
    properties: {
      mathml: { type: "array", items: { $ref: "#/$defs/MathMlNode" } },
      starMath: { type: "string" },
      presentation: { $ref: "#/$defs/MathPresentation" },
      content: { $ref: "#/$defs/MathExpression" },
      provenance: { $ref: "#/$defs/MathProvenance" },
      source: { $ref: "#/$defs/SourceResidue" },
      origin: { $ref: "#/$defs/ContentOrigin" },
      interpretation: { $ref: "#/$defs/ContentInterpretation" },
    },
    required: ["mathml"],
    additionalProperties: false,
  },
  // An exact rational's two halves as canonical decimal-integer strings (src/math.ts's CANONICAL_SIGNED_INTEGER/CANONICAL_POSITIVE_INTEGER — the patterns ARE the canonicalisation: no leading zeros, no '-0', denominator strictly positive).
  ExactRational: {
    type: "object",
    properties: {
      numerator: { type: "string", pattern: "^(0|-?[1-9]\\d*)$" },
      denominator: { type: "string", pattern: "^[1-9]\\d*$" },
    },
    required: ["numerator", "denominator"],
    additionalProperties: false,
  },
  // A dimension as exponents over the SI bases (DimensionVectorSchema = z.partialRecord(z.enum(SI_BASE_DIMENSIONS), z.number().int())) — the enum below is spread from that same const so the two cannot drift.
  DimensionVector: {
    type: "object",
    propertyNames: { type: "string", enum: [...SI_BASE_DIMENSIONS] },
    additionalProperties: {
      type: "integer",
      minimum: -MAX_SAFE_INTEGER,
      maximum: MAX_SAFE_INTEGER,
    },
  },
  MathPresentation: {
    type: "object",
    properties: {
      latex: { type: "string" },
    },
    required: ["latex"],
    additionalProperties: false,
  },
  MathProvenance: {
    type: "object",
    properties: {
      source: { type: "string" },
      pageRef: { type: "string" },
      editTrail: { type: "array", items: { type: "string" } },
    },
    required: ["source", "editTrail"],
    additionalProperties: false,
  },
  MathUncertainty: {
    type: "object",
    properties: {
      magnitude: { $ref: "#/$defs/ExactRational" },
      unit: { type: "string" },
      coverageFactor: { type: "number", exclusiveMinimum: 0 },
    },
    required: ["magnitude"],
    additionalProperties: false,
  },
  MathSymbolEntry: {
    type: "object",
    properties: {
      glyph: { type: "string" },
      scope: { type: "string" },
      id: { type: "string" },
      quantityKind: { type: "string" },
      preferredUnit: { type: "string" },
      definitionSource: { type: "string" },
    },
    required: ["glyph", "scope", "id"],
    additionalProperties: false,
  },
  MathUnit: {
    type: "object",
    properties: {
      id: { type: "string" },
      symbol: { type: "string" },
      name: { type: "string" },
      dimension: { $ref: "#/$defs/DimensionVector" },
      factorToSi: { $ref: "#/$defs/ExactRational" },
      offsetToSi: { $ref: "#/$defs/ExactRational" },
      context: { type: "string" },
    },
    required: ["id", "symbol", "dimension", "factorToSi"],
    additionalProperties: false,
  },
  // The bases array's entry object is inlined rather than given its own $def — MathMlNode's five non-element variants set the precedent for inlining definitions nothing else references.
  MathNormalisationContext: {
    type: "object",
    properties: {
      id: { type: "string" },
      bases: {
        type: "array",
        items: {
          type: "object",
          properties: {
            unit: { type: "string" },
            value: { $ref: "#/$defs/ExactRational" },
          },
          required: ["unit", "value"],
          additionalProperties: false,
        },
      },
    },
    required: ["id", "bases"],
    additionalProperties: false,
  },
  // One embedded font face of the package arms' fonts field (src/package.ts's TreeEmbeddedFontSchema, the tree-side spelling of src/font-port.ts's ProvidedFont). Transcribed here for the identical five-copies reason SymbolTable below states.
  TreeEmbeddedFont: {
    type: "object",
    properties: {
      family: { type: "string" },
      bold: { type: "boolean" },
      italic: { type: "boolean" },
      base64: { type: "string" },
    },
    required: ["family", "bold", "italic", "base64"],
    additionalProperties: false,
  },
  // SymbolTableSchema is a real z.object with no custom node anywhere under it, so z.toJSONSchema() could convert it inline — it is transcribed here (and the generator $refs to it) so each ContentDocument arm's symbolTable field stays one named reference instead of five duplicated copies of this whole subtree.
  SymbolTable: {
    type: "object",
    properties: {
      symbols: { type: "array", items: { $ref: "#/$defs/MathSymbolEntry" } },
      units: { type: "array", items: { $ref: "#/$defs/MathUnit" } },
      contexts: {
        type: "array",
        items: { $ref: "#/$defs/MathNormalisationContext" },
      },
    },
    required: ["symbols", "units"],
    additionalProperties: false,
  },
  // MathExpression and the recursive variants below it (src/math.ts) are all real, exported Zod schemas now, MathExpressionSchema included (ExaDev/documents.js#1009) — transcribed by hand regardless, since MathApp/MathSum/MathProd/MathMatrix's own args/lower/upper/body/rows fields reach MathExpression, one of this file's own hand-transcribed fragments below, and content-json-schema-defs.test.ts's own REGISTERED_SCHEMAS registry holds all five (plus MathNum/MathQty/MathSym/MathUnparsed above, already covered before #1009) to a live z.toJSONSchema() comparison, catching drift the same way every other hand-transcribed fragment in this file already does.
  MathNum: {
    type: "object",
    properties: {
      kind: { type: "string", const: "num" },
      numerator: { type: "string", pattern: "^(0|-?[1-9]\\d*)$" },
      denominator: { type: "string", pattern: "^[1-9]\\d*$" },
    },
    required: ["kind", "numerator", "denominator"],
    additionalProperties: false,
  },
  MathQty: {
    type: "object",
    properties: {
      kind: { type: "string", const: "qty" },
      value: { $ref: "#/$defs/ExactRational" },
      unit: { type: "string" },
      uncertainty: { $ref: "#/$defs/MathUncertainty" },
    },
    required: ["kind", "value", "unit"],
    additionalProperties: false,
  },
  MathSym: {
    type: "object",
    properties: {
      kind: { type: "string", const: "sym" },
      id: { type: "string" },
    },
    required: ["kind", "id"],
    additionalProperties: false,
  },
  MathApp: {
    type: "object",
    properties: {
      kind: { type: "string", const: "app" },
      operator: { type: "string" },
      args: { type: "array", items: { $ref: "#/$defs/MathExpression" } },
    },
    required: ["kind", "operator", "args"],
    additionalProperties: false,
  },
  MathSum: mathBinderDef("sum"),
  MathProd: mathBinderDef("prod"),
  MathMatrix: {
    type: "object",
    properties: {
      kind: { type: "string", const: "matrix" },
      rows: {
        type: "array",
        items: { type: "array", items: { $ref: "#/$defs/MathExpression" } },
      },
    },
    required: ["kind", "rows"],
    additionalProperties: false,
  },
  MathUnparsed: {
    type: "object",
    properties: {
      kind: { type: "string", const: "unparsed" },
      latex: { type: "string" },
    },
    required: ["kind", "latex"],
    additionalProperties: false,
  },
  // MathExpression itself (src/math.ts): `MathNum | MathQty | MathSym | MathApp | MathSum | MathProd | MathMatrix | MathUnparsed`, in that exact declared order.
  MathExpression: {
    oneOf: [
      { $ref: "#/$defs/MathNum" },
      { $ref: "#/$defs/MathQty" },
      { $ref: "#/$defs/MathSym" },
      { $ref: "#/$defs/MathApp" },
      { $ref: "#/$defs/MathSum" },
      { $ref: "#/$defs/MathProd" },
      { $ref: "#/$defs/MathMatrix" },
      { $ref: "#/$defs/MathUnparsed" },
    ],
  },
};
