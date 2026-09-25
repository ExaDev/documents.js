import { z } from "zod";
import { type JsonSchema } from "./json-schema-defs-shared";
import {
  MathMlAttributeSchema,
  MathMlElementSchema,
  MathMlNodeSchema,
} from "./mathml";
import { DEFS_BLOCKS } from "./json-schema-defs-blocks";
import { DEFS_SHEET } from "./json-schema-defs-sheet";
import { DEFS_VECTOR } from "./json-schema-defs-vector";
import { DEFS_TREE } from "./json-schema-defs-tree";
import { DEFS_MATH } from "./json-schema-defs-math";

// The hand-authored JSON Schema $defs fragments spliced into content-document.schema.json's `override()` callback (scripts/generate-json-schemas.mjs), lifted out into their own src module rather than staying inline in that script. The reason is single-sourcing, not tidiness: this exact object needs to be reachable from two places that cannot share an import graph --
//
//   1. scripts/generate-json-schemas.mjs itself, which only ever runs against the freshly-built ../dist/ (it imports every other schema it needs the same way), so it imports CONTENT_DEFS from '../dist/content-json-schema-defs.js', the file tsdown emits for this module (entry: 'src/**/*.ts', one dist file per src file — see tsdown.config.ts).
//   2. content-json-schema-defs.test.ts (src/, run directly by vitest's "unit" project against source, never against dist), which imports this exact same CONTENT_DEFS value straight from here and asserts it stays byte-for-byte in step with a live z.toJSONSchema() call over each fragment's real exported Zod schema counterpart — every fragment in this file except the nine package-tree group wrappers (src/package-node.ts, still z.custom over recursive tree-of-groups guards, out of ExaDev/documents.js#1009's own scope) now has one, ContentBlock/ContentTableCell/ContentTableRow/ContentTable/ContentEmbeddedObject(Block)/ContentFormula/MathExpression/MathApp/MathSum/MathProd/MathMatrix included since #1009's z.lazy() rewrite made ContentBlockSchema, ContentEmbeddedObjectSchema, and MathExpressionSchema real, self-recursive z.discriminatedUnion()s rather than z.custom() predicates — see that test file's own top comment for the registered-schema list and for why this is the only structural defence this generator has against silently drifting away from the schemas it's meant to describe.
//
// If CONTENT_DEFS stayed inline in the .mjs script, only path 1 above would work: the script imports Zod schemas exclusively from '../dist/index.js' (a build artefact that may not exist, and per eslint.config.ts/tsconfig.json is deliberately excluded from both linting and typechecking, matching test/smoke.test.mjs's own precedent) — a test that has to import through that path would only ever run after a build, which `pnpm test` (the "unit" vitest project, run standalone in CI's own "test" job, with no build step beforehand) never guarantees. Living here instead, this is an ordinary, fully typechecked and linted src module like any other — CONTENT_DEFS just happens to be consumed by a script as well as by the package's own test suite.
//
// The fragments below still cover exactly what scripts/generate-json-schemas.mjs's own top-of-file comment already explains, updated for ExaDev/documents.js#1009: the package tree's own opaque set, added in the 4.0.0 major, remains — DocumentTreeSchema's children reach the tree's per-kind group schemas (src/package-node.ts, all z.custom over recursive tree-of-groups guards, a genuinely separate recursion axis #1009 does not touch), so the whole TreeNode vocabulary — container descriptors, anchor paragraphs, the nine group wrappers (the seven of 4.0.0 plus 4.1.0's two construct groups), and the sheet-image/vector leaves — is transcribed here, and the generator splices CONTENT_DEFS into document-tree.schema.json as well as content-document.schema.json so both files resolve their local #/$defs pointers without depending on each other's file layout (the one deliberate cross-file ref stays $defs.ContentEmbeddedObject(Block)'s document pointer, CONTENT_DOCUMENT_URI). ContentBlockSchema, ContentEmbeddedObjectSchema, and MathExpressionSchema left the opaque set in #1009 — each is a real, self-recursive z.discriminatedUnion() now (src/content.ts, src/math.ts), the identical z.lazy() rewrite ExaDev/documents.js#937 already applied to MathMlNodeSchema — but ContentBlock/ContentTableCell/ContentTableRow/ContentTable/ContentEmbeddedObject(Block)/ContentFormula/MathExpression/MathApp/MathSum/MathProd/MathMatrix stay hand-transcribed here rather than moving to MathMlAttribute/Element/Node's own computed-`get`-accessor treatment: that treatment exists specifically for a schema with no OTHER already-hand-transcribed sibling fragments cross-referencing it by name, and every one of these eleven is reached from (or reaches) at least one such sibling (ContentBlock's own union members include ContentParagraph/ContentImageBlock/ContentPageBreak/ContentConstructStart/ContentConstructEnd, all separately hand-transcribed fragments elsewhere in this file) — a live registry-based generation covering the whole reachable family would work (content-json-schema-defs.test.ts's own REGISTERED_SCHEMAS registry already proves as much, registering all eleven alongside their siblings), but replacing eleven already-correct, already-independently-verified fragments with computed accessors is a distinct, separable piece of tidying from #1009's own stated scope (converting the three schemas away from z.custom, confirmed via the real-corpus bijection gate and a full-workspace affected typecheck/test run) and is left for a future pass. SymbolTableSchema (transcribed so each ContentDocument arm's symbolTable field is one named $ref rather than five inlined copies of the whole unit-registry subtree) and StyleEntrySchema/DefinitionEntrySchema (same five-copies reason for the package arms' styles/definitions fields) are transcribed for an unrelated, still-current reason — the generator's override() replaces each with a $ref to its fragment here regardless of opacity. Every fragment in this file except the nine group wrappers now has a real, non-custom, exported Zod schema counterpart, and content-json-schema-defs.test.ts's own REGISTERED_SCHEMAS registry holds every one of them to a live z.toJSONSchema() comparison — see that test file's own top comment for the full list and construction.

// Zod's own `.int()` bag range (node_modules/zod/v4/core/json-schema-processors.js's numberProcessor), reproduced verbatim wherever a hand-authored integer field below mirrors a real `z.number().int()...` field — confirmed empirically against ContentListMembershipSchema.level and ContentTableCellSchema.colSpan/rowSpan.

// MathMlAttribute/MathMlElement/MathMlNode (src/mathml.ts), computed from a live z.toJSONSchema() call rather than transcribed by hand: MathMlNodeSchema stopped being a z.custom() node in ExaDev/documents.js#937, so it introspects cleanly now. The `#/$defs/<id>` uri scheme matches every other cross-reference CONTENT_DEFS's own fragments use, and reproduces the identical nested-$ref shape (MathMlElement.children and MathMlNode's own element variant pointing back at each other by name rather than inlining) that content-json-schema-defs.test.ts's own live-comparison registry confirms empirically against CONTENT_DEFS's own value — see that file's top comment for the same construction and for why that comparison is a generation-determinism check for these three ids rather than an independent drift check.
//
// Computed lazily rather than at module load. This module is re-exported wholesale from src/index.ts (`export * from "./content-json-schema-defs"`), so an eager, at-module-load computation here would make every consumer of document-schema.js — a package every codec in the workspace depends on, held to Worker-isomorphism — pay for this z.toJSONSchema() call the moment it imported the package, whether or not it ever read $defs.MathMlAttribute/Element/Node; ExaDev/documents.js#937's z.lazy() rewrite landed the deferral alongside MathMlNodeSchema's own recursion, so no released version of this package ever paid that cost. getMathMlJsonSchemas() below builds the registry and runs the conversion at most once, the first time any of the three `get MathMlAttribute()`/`get MathMlElement()`/`get MathMlNode()` accessors CONTENT_DEFS's own object literal declares further down (in their original field position, not spread in as plain values — see that literal's own comment) is actually read, and every later read reuses the cached result.
let cachedMathMlJsonSchemas: Record<string, JsonSchema> | undefined;
function getMathMlJsonSchemas(): Record<string, JsonSchema> {
  if (cachedMathMlJsonSchemas === undefined) {
    const registry = z.registry<{ id: string }>();
    registry.add(MathMlAttributeSchema, { id: "MathMlAttribute" });
    registry.add(MathMlElementSchema, { id: "MathMlElement" });
    registry.add(MathMlNodeSchema, { id: "MathMlNode" });
    const { schemas } = z.toJSONSchema(registry, {
      uri: (id) => `#/$defs/${id}`,
    });
    cachedMathMlJsonSchemas = schemas;
  }
  return cachedMathMlJsonSchemas;
}

// Strips the $schema/$id root markers z.toJSONSchema() stamps onto every registry entry (each is generated as its own standalone root) — an artefact of generation, not a real structural difference from a fragment nested inside another schema's own $defs, matching content-json-schema-defs.test.ts's own withoutRootMarkers.
//
// The non-null assertion on the lookup below is exactly the case this package's own eslint config turns nonNullAssertion off for: getMathMlJsonSchemas() adds precisely these three ids to the registry before calling z.toJSONSchema() on it, and a registry's own conversion result carries an entry for every schema registered onto it — id is never anything other than one of those three literal strings, so the lookup can never actually miss. A defensive undefined check here would be unreachable by any real input, not a genuine safety net.
function mathMlDef(
  id: "MathMlAttribute" | "MathMlElement" | "MathMlNode",
): JsonSchema {
  const generated = getMathMlJsonSchemas()[id]!;
  const stripped = { ...generated };
  delete stripped.$schema;
  delete stripped.$id;
  return stripped;
}

// Called from each of CONTENT_DEFS's own `get MathMlAttribute()`/`get MathMlElement()`/`get MathMlNode()` accessors (see that object literal further down) as `cacheMathMlDef(this, id)`, so `target` is always CONTENT_DEFS itself — a getter's `this` is bound to the object it was read from, not to whatever value was in scope when the getter was declared, so this takes CONTENT_DEFS as a parameter rather than closing over the module-level binding by name: the binding is declared after this function and referencing it directly would be a forward reference to a value that has not finished being constructed yet at the point this function is declared, even though the getter itself only ever runs later. Redefines the target's own property as a plain cached value on first call so the underlying z.toJSONSchema() call and this stripping work run at most once per id, and every read after the first is a plain property lookup with no getter overhead at all.
function cacheMathMlDef(
  target: Record<string, JsonSchema>,
  id: "MathMlAttribute" | "MathMlElement" | "MathMlNode",
): JsonSchema {
  const value = mathMlDef(id);
  Object.defineProperty(target, id, {
    value,
    enumerable: true,
    configurable: true,
    writable: false,
  });
  return value;
}

// — Hand-authored $defs, spliced into content-document.schema.json only (via scripts/generate-json-schemas.mjs's own ContentDocumentSchema override branch) --
//
// The fragments below are transcribed by hand, field-for-field, from src/content.ts's real Zod object definitions (ContentParagraphSchema, ContentTableSchema/ContentTableRowSchema/ContentTableCellSchema, ContentImageBlockSchema, ContentPageBreakSchema, ContentRunSchema, ContentListMembershipSchema, ColorSchema, BoxSchema, LayoutFrameSchema, AlignmentSchema, ContentStrokeStyleSchema, ContentBorderSchema, ContentCellBordersSchema, ContentParagraphBordersSchema, ContentCellPatternTypeSchema, ContentCellFillSchema, ContentStrokeDashSchema, ContentGradientStyleSchema, ContentGradientFillSchema, ContentHatchStyleSchema, ContentHatchFillSchema, ContentBitmapFillSchema, ContentFillPatternSchema — each cross-checked directly against a real z.toJSONSchema() call over that exact exported schema, and the ones with a real, non-recursive, non-custom counterpart are held to that comparison as a running test by content-json-schema-defs.test.ts) plus the ContentEmbeddedObject/ContentEmbeddedObjectBlock TS interfaces, which have no exported z.object() counterpart at all (both are validated only via the isContentEmbeddedObject*() z.custom() guards), plus the math value schemas of src/math.ts (the semantic half of the two-layer formula model — see that file's own top comment for how the layers divide). Re-verify this block against src/content.ts/src/math.ts whenever those files' field shapes change — nothing here is generated or checked against the real schemas at build time, other than the leaf/near-leaf fragments the regression test below does cover.

// The MathML trio's lazy getters, kept in their original key-order position between the tree/descriptor fragments and the math fragments.
const DEFS_LAZY_MATHML: Record<string, JsonSchema> = {
  // The MathML node tree carried by the ContentDocument 'formula' variant's own ContentFormulaSchema.mathml (src/content.ts) — MathMlAttribute/MathMlElement/MathMlNode, rather than transcribed by hand, since MathMlNodeSchema stopped being a z.custom() node in ExaDev/documents.js#937 and z.toJSONSchema() can introspect it directly now. Declared as `get` accessors here, in their own field position, rather than spread in as plain values from a separately-built object: a getter fires only when the property is actually read, so cacheMathMlDef()'s z.toJSONSchema() call happens on first access to any of the three, not the moment this object literal is constructed — and declaring them in place (rather than via Object.defineProperty after this literal closes) keeps CONTENT_DEFS's own key order exactly where it always was, so the generated content-document.schema.json/document-tree.schema.json's own $defs key order is unaffected by the deferral. See cacheMathMlDef's own comment above for the self-caching mechanism and why it takes its target as a `this` parameter rather than referencing CONTENT_DEFS by name.
  get MathMlAttribute(): JsonSchema {
    return cacheMathMlDef(this, "MathMlAttribute");
  },
  get MathMlElement(): JsonSchema {
    return cacheMathMlDef(this, "MathMlElement");
  },
  get MathMlNode(): JsonSchema {
    return cacheMathMlDef(this, "MathMlNode");
  },
};
// CONTENT_DEFS is assembled from the part records above by copying property descriptors, which preserves both plain fragments and the lazy getters verbatim and keeps the merged key order identical to the single-literal layout this module was split from: parts in file order, then the MathML getters between the tree and math parts, exactly where the original literal declared them. The generated content-document.schema.json/document-tree.schema.json byte output is therefore unchanged.
const DEFS_IN_ORDER: readonly Record<string, JsonSchema>[] = [
  DEFS_BLOCKS,
  DEFS_SHEET,
  DEFS_VECTOR,
  DEFS_TREE,
  DEFS_LAZY_MATHML,
  DEFS_MATH,
];

export const CONTENT_DEFS: Record<string, JsonSchema> = (() => {
  const merged: Record<string, JsonSchema> = {};
  for (const part of DEFS_IN_ORDER) {
    Object.defineProperties(merged, Object.getOwnPropertyDescriptors(part));
  }
  return merged;
})();
