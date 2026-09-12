import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type * as ZodModule from "zod";
import { TreeEmbeddedFontSchema } from "./package";
import { ColorSchema } from "./color";
import {
  ContentBlockSchema,
  ContentBorderSchema,
  ContentCellBordersSchema,
  ContentCellFillSchema,
  ContentCellPatternTypeSchema,
  ContentConstructEndSchema,
  ContentConstructStartSchema,
  ContentEmbeddedObjectBlockSchema,
  ContentEmbeddedObjectSchema,
  ContentFloatAlignSchema,
  ContentFloatAxisSchema,
  ContentFloatOriginSchema,
  ContentFloatPositionSchema,
  ContentFormulaSchema,
  ContentBitmapFillSchema,
  ContentFillPatternSchema,
  ContentGradientFillSchema,
  ContentGradientStyleSchema,
  ContentHatchFillSchema,
  ContentHatchStyleSchema,
  ContentStrokeDashSchema,
  ContentImageBlockSchema,
  ContentListMembershipSchema,
  ContentPageBreakSchema,
  ContentParagraphBordersSchema,
  ContentParagraphSchema,
  ContentPathPointSchema,
  ContentPathSegmentSchema,
  ContentRunSchema,
  ContentTableCellSchema,
  ContentTableRowSchema,
  ContentTableSchema,
  RunConstructExtentSchema,
  ContentSheetCellCommentSchema,
  ContentSheetCellSchema,
  ContentSheetColumnSchema,
  ContentSheetConditionalFormatSchema,
  ContentSheetConditionalFormatStyleSchema,
  ContentSheetConditionalFormatValueSchema,
  ContentSheetDataValidationSchema,
  ContentSheetImageSchema,
  ContentImageOriginalSchema,
  ContentOriginSchema,
  ContentInterpretationSchema,
  ContentFontSchema,
  ContentSheetPrintRangeSchema,
  ContentSheetPrintSettingsSchema,
  ContentSheetRangeSchema,
  ContentSheetRepeatRangeSchema,
  ContentSheetRowSchema,
  SheetRuleOperatorSchema,
  ContentStrokeSchema,
  ContentStrokeStyleSchema,
  ContentSubpathSchema,
  ContentVectorSchema,
  ContentCellValueSchema,
  ContentPageFurnitureSchema,
} from "./content";
import {
  CONTENT_DEFS,
  CONTENT_DOCUMENT_URI,
  EMBEDDED_OBJECT_KINDS,
  MAX_SAFE_INTEGER,
} from "./content-json-schema-defs";
import {
  AnchorDescriptorSchema,
  ConstructDescriptorSchema,
  ContentControlDescriptorSchema,
  DivisionDescriptorSchema,
  DivisionSourceSchema,
  FieldDescriptorSchema,
  LinkDescriptorSchema,
  LinkTargetSchema,
  ProvenanceDescriptorSchema,
} from "./construct";
import {
  DefinitionEntrySchema,
  StyleEntrySchema,
  StyleParagraphPropertiesSchema,
  StyleRunPropertiesSchema,
} from "./definitions";
import {
  BoxSchema,
  LayoutFrameSchema,
  MarginsSchema,
  PageSizeSchema,
} from "./geometry";
import {
  DimensionVectorSchema,
  ExactRationalSchema,
  MathAppSchema,
  MathExpressionSchema,
  MathMatrixSchema,
  MathNormalisationContextSchema,
  MathNumSchema,
  MathPresentationSchema,
  MathProdSchema,
  MathProvenanceSchema,
  MathQtySchema,
  MathSumSchema,
  MathSymbolEntrySchema,
  MathSymSchema,
  MathUncertaintySchema,
  MathUnitSchema,
  MathUnparsedSchema,
  SymbolTableSchema,
} from "./math";
import {
  MathMlAttributeSchema,
  MathMlElementSchema,
  MathMlNodeSchema,
} from "./mathml";
import {
  DrawPageDescriptorSchema,
  HeadingParagraphSchema,
  ListParagraphSchema,
  SectionDescriptorSchema,
  ShapeDescriptorSchema,
  SheetDescriptorSchema,
  SlideDescriptorSchema,
} from "./package-node";
import { AlignmentSchema } from "./style";
import { SourceResidueSchema } from "./source";

// This is the regression test scripts/generate-json-schemas.mjs's own top comment calls for: the only structural defence that generator has against silently drifting away from src/content.ts/src/color.ts/src/geometry.ts/src/style.ts/src/math.ts/src/package-node.ts/src/definitions.ts/src/mathml.ts, since CONTENT_DEFS (content-json-schema-defs.ts) is transcribed by hand rather than generated. What's left that CANNOT be checked this way, after ExaDev/documents.js#1009: the nine package-tree group wrappers sit downstream of the tree's own per-kind group schemas (src/package-node.ts, z.custom over recursive tree-of-groups guards, a genuinely separate recursion axis #1009 does not touch, reached only through the hand fragments' own children pointers), and ContentEmbeddedObject/ContentEmbeddedObjectBlock -- both real schemas since #1009, and registerable here in principle -- are excluded for a narrower, empirically-confirmed reason: their `document` field's cross-file cycle back to ContentDocumentSchema produces an anonymous `#/$defs/__shared#/$defs/schemaN`-shaped ref under this test's own multi-schema registry (Zod's own cyclic-schema handling colliding with a locally-registered ContentDocumentSchema in a way a throwaway scratch spike confirmed does NOT occur when ContentDocumentSchema is registered alone alongside just one of the two, only once joined by the rest of this registry's ~90 other entries) rather than the CONTENT_DOCUMENT_URI the hand-authored fragment states -- a real, narrow Zod interaction to revisit separately, not equivalent to the opacity that used to exclude every entry below. MathMlNode/MathMlElement/MathMlAttribute left the un-checkable bucket earlier, in #937 -- MathMlNodeSchema is a real, self-recursive z.discriminatedUnion() now (src/mathml.ts), not a z.custom() node -- but they did not become entries of the same kind as everything below: CONTENT_DEFS's own MathMlAttribute/MathMlElement/MathMlNode fragments are themselves computed from a live z.toJSONSchema() call over that schema (content-json-schema-defs.ts's own getMathMlJsonSchemas()), not hand-transcribed. Registering MathMlAttributeSchema/MathMlElementSchema/MathMlNodeSchema here and comparing the result against CONTENT_DEFS does NOT independently re-derive anything and does NOT catch drift in mathml.ts's own field shapes, because both sides of that comparison call z.toJSONSchema() over the identical schema objects -- a field added to or removed from any of the three changes both sides identically and the comparison stays green regardless. Confirmed empirically: injecting a required `prefix: z.string()` field into MathMlAttributeSchema left the live comparison below entirely green -- the hard-coded describe block further down, added alongside this note, is what actually catches it. What that comparison DOES verify, and it is real, is narrower: that content-json-schema-defs.ts's own generation is deterministic and reproducible -- a second, separately-constructed z.toJSONSchema() call over the same three schemas (this file's own REGISTERED_SCHEMAS registry, built independently of the local registry getMathMlJsonSchemas() constructs inside content-json-schema-defs.ts) produces byte-identical output, catching a bug in the generation plumbing itself (a stale cache, a wrong uri callback, a registry built over the wrong schema instance) rather than a bug in mathml.ts's own fields. Genuine field-shape coverage for these three entries -- the kind every other schema below gets from the live comparison -- lives instead in the separate `CONTENT_DEFS's generated MathML fragments` describe block further down this file: fixed, hand-coded expected keys/types with no dependency on any z.toJSONSchema() call at all, so a field actually added to, removed from, or renamed on one of the three does fail it.
//
// What CAN be checked against a live schema in that same genuine, independent sense -- because a real, exported Zod schema exists for it, and CONTENT_DEFS's own value is still transcribed by hand rather than computed from that same schema -- is every leaf and near-leaf fragment (Color, Box, LayoutFrame, Alignment, SourceResidue, ContentStrokeStyle, ContentBorder, ContentCellBorders, ContentParagraphBorders, ContentCellPatternType, ContentCellFill, ContentListMembership, ContentRun, ContentParagraph, ContentFloatOrigin, ContentFloatAlign, ContentFloatAxis, ContentFloatPosition, ContentImageBlock, ContentPageBreak, PageSize, Margins, SectionDescriptor, SlideDescriptor, SheetDescriptor, DrawPageDescriptor, ShapeDescriptor, HeadingParagraph, ListParagraph, the whole construct descriptor vocabulary, the flat form's two construct boundary markers, ContentSheetCell, ContentCellValue, ContentSheetCellComment, ContentSheetColumn, ContentSheetRow, ContentSheetPrintSettings, ContentSheetPrintRange, ContentSheetRepeatRange, ContentSheetImage, ContentStroke, ContentPathPoint, ContentPathSegment, ContentSubpath, ContentVector, StyleParagraphProperties, StyleRunProperties, StyleEntry, DefinitionEntry, ExactRational, DimensionVector, MathPresentation, MathProvenance, MathUncertainty, MathNum, MathQty, MathSym, MathUnparsed, MathSymbolEntry, MathUnit, MathNormalisationContext, SymbolTable) plus, since #1009 made ContentBlockSchema/MathExpressionSchema real and self-recursive, the whole family reachable through them: ContentTableCell, ContentTableRow, ContentTable, ContentBlock, ContentFormula, MathApp, MathSum, MathProd, MathMatrix, MathExpression. None of these reaches a tree group schema, or ContentEmbeddedObject(Block)'s own cross-file cycle, from anywhere in its own field tree, so each can be generated live and compared directly against a hand-authored fragment that could actually have drifted from it.
//
// Comparison strategy: a bare `z.toJSONSchema(SomeSchema)` call, run in isolation, would INLINE every nested schema it encounters (ColorSchema inside ContentRunSchema, AlignmentSchema inside ContentParagraphSchema, etc.) rather than emit the `{ $ref: '#/$defs/X' }` pointers CONTENT_DEFS itself uses -- because those nested schemas aren't registered anywhere. To reproduce the exact cross-reference shape CONTENT_DEFS hand-authors, this test registers the identical set of real schemas under the identical id strings CONTENT_DEFS uses as its own $defs keys, with a `uri` callback matching the `#/$defs/<id>` convention CONTENT_DEFS was written against -- confirmed empirically (see this file's own construction) to make Zod's registry-based multi-schema generation emit exactly that $ref shape for every registered schema referenced from within another. Each per-schema result still carries its own top-level `$schema`/`$id` (since z.toJSONSchema(registry, ...) treats every registered schema as its own standalone root), which CONTENT_DEFS's own nested fragments never have -- those two keys are stripped before comparison, since they're an artefact of testing each fragment as a registry root rather than a real structural difference.

const REGISTERED_SCHEMAS = {
  ContentPageFurniture: ContentPageFurnitureSchema,
  Color: ColorSchema,
  Box: BoxSchema,
  LayoutFrame: LayoutFrameSchema,
  Alignment: AlignmentSchema,
  SourceResidue: SourceResidueSchema,
  ContentStrokeStyle: ContentStrokeStyleSchema,
  ContentBorder: ContentBorderSchema,
  ContentCellBorders: ContentCellBordersSchema,
  ContentParagraphBorders: ContentParagraphBordersSchema,
  ContentCellPatternType: ContentCellPatternTypeSchema,
  ContentCellFill: ContentCellFillSchema,
  ContentListMembership: ContentListMembershipSchema,
  ContentRun: ContentRunSchema,
  RunConstructExtent: RunConstructExtentSchema,
  ContentParagraph: ContentParagraphSchema,
  ContentFloatOrigin: ContentFloatOriginSchema,
  ContentFloatAlign: ContentFloatAlignSchema,
  ContentFloatAxis: ContentFloatAxisSchema,
  ContentFloatPosition: ContentFloatPositionSchema,
  ContentImageBlock: ContentImageBlockSchema,
  ContentImageOriginal: ContentImageOriginalSchema,
  ContentOrigin: ContentOriginSchema,
  ContentInterpretation: ContentInterpretationSchema,
  TreeEmbeddedFont: TreeEmbeddedFontSchema,
  ContentPageBreak: ContentPageBreakSchema,
  PageSize: PageSizeSchema,
  Margins: MarginsSchema,
  SectionDescriptor: SectionDescriptorSchema,
  SlideDescriptor: SlideDescriptorSchema,
  SheetDescriptor: SheetDescriptorSchema,
  DrawPageDescriptor: DrawPageDescriptorSchema,
  ShapeDescriptor: ShapeDescriptorSchema,
  HeadingParagraph: HeadingParagraphSchema,
  ListParagraph: ListParagraphSchema,
  ContentControlDescriptor: ContentControlDescriptorSchema,
  FieldDescriptor: FieldDescriptorSchema,
  AnchorDescriptor: AnchorDescriptorSchema,
  LinkTarget: LinkTargetSchema,
  LinkDescriptor: LinkDescriptorSchema,
  ProvenanceDescriptor: ProvenanceDescriptorSchema,
  DivisionSource: DivisionSourceSchema,
  DivisionDescriptor: DivisionDescriptorSchema,
  ConstructDescriptor: ConstructDescriptorSchema,
  ContentConstructStart: ContentConstructStartSchema,
  ContentConstructEnd: ContentConstructEndSchema,
  ContentSheetCell: ContentSheetCellSchema,
  ContentFont: ContentFontSchema,
  ContentCellValue: ContentCellValueSchema,
  ContentSheetCellComment: ContentSheetCellCommentSchema,
  ContentSheetColumn: ContentSheetColumnSchema,
  ContentSheetRow: ContentSheetRowSchema,
  ContentSheetPrintSettings: ContentSheetPrintSettingsSchema,
  ContentSheetPrintRange: ContentSheetPrintRangeSchema,
  ContentSheetRepeatRange: ContentSheetRepeatRangeSchema,
  ContentSheetRange: ContentSheetRangeSchema,
  SheetRuleOperator: SheetRuleOperatorSchema,
  ContentSheetDataValidation: ContentSheetDataValidationSchema,
  ContentSheetConditionalFormatStyle: ContentSheetConditionalFormatStyleSchema,
  ContentSheetConditionalFormatValue: ContentSheetConditionalFormatValueSchema,
  ContentSheetConditionalFormat: ContentSheetConditionalFormatSchema,
  ContentSheetImage: ContentSheetImageSchema,
  ContentStrokeDash: ContentStrokeDashSchema,
  ContentStroke: ContentStrokeSchema,
  ContentGradientStyle: ContentGradientStyleSchema,
  ContentGradientFill: ContentGradientFillSchema,
  ContentHatchStyle: ContentHatchStyleSchema,
  ContentHatchFill: ContentHatchFillSchema,
  ContentBitmapFill: ContentBitmapFillSchema,
  ContentFillPattern: ContentFillPatternSchema,
  ContentPathPoint: ContentPathPointSchema,
  ContentPathSegment: ContentPathSegmentSchema,
  ContentSubpath: ContentSubpathSchema,
  ContentVector: ContentVectorSchema,
  StyleParagraphProperties: StyleParagraphPropertiesSchema,
  StyleRunProperties: StyleRunPropertiesSchema,
  StyleEntry: StyleEntrySchema,
  DefinitionEntry: DefinitionEntrySchema,
  ExactRational: ExactRationalSchema,
  DimensionVector: DimensionVectorSchema,
  MathPresentation: MathPresentationSchema,
  MathProvenance: MathProvenanceSchema,
  MathUncertainty: MathUncertaintySchema,
  MathNum: MathNumSchema,
  MathQty: MathQtySchema,
  MathSym: MathSymSchema,
  MathUnparsed: MathUnparsedSchema,
  MathSymbolEntry: MathSymbolEntrySchema,
  MathUnit: MathUnitSchema,
  MathNormalisationContext: MathNormalisationContextSchema,
  SymbolTable: SymbolTableSchema,
  MathMlAttribute: MathMlAttributeSchema,
  MathMlElement: MathMlElementSchema,
  MathMlNode: MathMlNodeSchema,
  // Real, self-recursive schemas since ExaDev/documents.js#1009 (ContentBlockSchema/ContentEmbeddedObjectSchema/MathExpressionSchema left the z.custom() set #937 already moved MathMlNodeSchema out of) -- registered alongside their own already-registered sibling fragments above (ContentParagraph, ContentImageBlock, MathNum, ...) so this registry's own cross-references resolve to the identical named $refs CONTENT_DEFS's hand-transcribed fragments already use, exactly like every other entry in this map. ContentEmbeddedObject/ContentEmbeddedObjectBlock are registered too -- ContentBlock's own union needs the latter registered for ITS OWN $ref to resolve correctly -- but excluded from the comparison loop below (CONTENT_EMBEDDED_OBJECT_CYCLE_IDS); see this file's own top comment for why comparing either of them directly, on its own, does not currently work.
  ContentTableCell: ContentTableCellSchema,
  ContentTableRow: ContentTableRowSchema,
  ContentTable: ContentTableSchema,
  ContentEmbeddedObject: ContentEmbeddedObjectSchema,
  ContentEmbeddedObjectBlock: ContentEmbeddedObjectBlockSchema,
  ContentBlock: ContentBlockSchema,
  ContentFormula: ContentFormulaSchema,
  MathApp: MathAppSchema,
  MathSum: MathSumSchema,
  MathProd: MathProdSchema,
  MathMatrix: MathMatrixSchema,
  MathExpression: MathExpressionSchema,
};

const registry = z.registry<{ id: string }>();
for (const [id, schema] of Object.entries(REGISTERED_SCHEMAS)) {
  registry.add(schema, { id });
}

const { schemas: liveSchemas } = z.toJSONSchema(registry, {
  uri: (id) => `#/$defs/${id}`,
});

// Strips the top-level $schema/$id every registry-root result carries -- an artefact of generating each schema as its own standalone root (see the top comment above), not present in CONTENT_DEFS's own nested fragments.
function withoutRootMarkers(
  fragment: z.core.JSONSchema.JSONSchema,
): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...fragment };
  delete rest.$schema;
  delete rest.$id;
  return rest;
}

function assertFragmentMatchesLiveSchema(id: string): void {
  const live = liveSchemas[id];
  if (live === undefined) {
    throw new Error(
      `z.toJSONSchema() produced no schema for registered id "${id}"`,
    );
  }
  const handAuthored = CONTENT_DEFS[id];
  if (handAuthored === undefined) {
    throw new Error(`CONTENT_DEFS has no fragment for id "${id}"`);
  }
  expect(withoutRootMarkers(live)).toStrictEqual(handAuthored);
}

// CONTENT_DEFS's own MathMlAttribute/MathMlElement/MathMlNode entries are generated (content-json-schema-defs.ts's own getMathMlJsonSchemas()), not hand-authored, so the comparison below is a generation-determinism check for these three ids, not the independent drift check every other id gets -- see this file's own top comment for the full reasoning and the empirical proof.
const MATHML_GENERATED_IDS = ["MathMlAttribute", "MathMlElement", "MathMlNode"];

// Registered above (so ContentBlock's own union member $ref resolves correctly), but excluded here: comparing either directly produces an anonymous #/$defs/__shared#/$defs/schemaN ref for the `document` field's cross-file cycle back to ContentDocumentSchema, once ContentDocumentSchema is reachable through this registry's other ~90 entries -- see this file's own top comment.
const CONTENT_EMBEDDED_OBJECT_CYCLE_IDS = [
  "ContentEmbeddedObject",
  "ContentEmbeddedObjectBlock",
];

describe("CONTENT_DEFS vs live z.toJSONSchema() output", () => {
  it.each(
    Object.keys(REGISTERED_SCHEMAS).filter(
      (id) =>
        !MATHML_GENERATED_IDS.includes(id) &&
        !CONTENT_EMBEDDED_OBJECT_CYCLE_IDS.includes(id),
    ),
  )(
    "%s: hand-authored fragment matches a live z.toJSONSchema() call over its real schema",
    assertFragmentMatchesLiveSchema,
  );

  it.each(MATHML_GENERATED_IDS)(
    "%s: CONTENT_DEFS's generated fragment reproduces a second, independently-invoked z.toJSONSchema() call over the same schema -- not a check against mathml.ts's own field shapes (see the hard-coded describe block below for that)",
    assertFragmentMatchesLiveSchema,
  );
});

// Genuine, independent coverage for MathMlAttribute/MathMlElement/MathMlNode's actual field shapes, since the comparison above cannot provide it (both sides derive from the identical schema call -- see this file's own top comment). These expectations are hard-coded from src/mathml.ts's own field declarations, with no dependency on any z.toJSONSchema() call at all, so a field genuinely added to, removed from, or renamed on MathMlAttributeSchema/MathMlElementSchema/MathMlNodeSchema fails one of these -- confirmed directly: injecting a required `prefix: z.string()` field into MathMlAttributeSchema (the same experiment that leaves the comparison above unchanged) fails the MathMlAttribute case below, since "prefix" is absent from its hard-coded `properties`/`required`.
describe("CONTENT_DEFS's generated MathML fragments (hard-coded shape, independent of any live schema call)", () => {
  it("MathMlAttribute has exactly the two string fields mathml.ts declares", () => {
    expect(CONTENT_DEFS.MathMlAttribute).toStrictEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        value: { type: "string" },
      },
      required: ["name", "value"],
      additionalProperties: false,
    });
  });

  it("MathMlElement carries type/tag/attributes/children with the expected $refs", () => {
    expect(CONTENT_DEFS.MathMlElement).toStrictEqual({
      type: "object",
      properties: {
        type: { type: "string", const: "element" },
        tag: { type: "string" },
        attributes: {
          type: "array",
          items: { $ref: "#/$defs/MathMlAttribute" },
        },
        children: {
          type: "array",
          items: { $ref: "#/$defs/MathMlNode" },
        },
      },
      required: ["type", "tag", "attributes", "children"],
      additionalProperties: false,
    });
  });

  it("MathMlNode is a oneOf over the six variants mathml.ts declares, in declared order", () => {
    expect(CONTENT_DEFS.MathMlNode).toStrictEqual({
      oneOf: [
        {
          type: "object",
          properties: {
            type: { type: "string", const: "text" },
            value: { type: "string" },
          },
          required: ["type", "value"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            type: { type: "string", const: "cdata" },
            value: { type: "string" },
          },
          required: ["type", "value"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            type: { type: "string", const: "comment" },
            value: { type: "string" },
          },
          required: ["type", "value"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            type: { type: "string", const: "declaration" },
            attributes: {
              type: "array",
              items: { $ref: "#/$defs/MathMlAttribute" },
            },
          },
          required: ["type", "attributes"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            type: { type: "string", const: "pi" },
            target: { type: "string" },
            content: { type: "string" },
          },
          required: ["type", "target", "content"],
          additionalProperties: false,
        },
        { $ref: "#/$defs/MathMlElement" },
      ],
    });
  });
});

// CONTENT_DEFS is re-exported wholesale from src/index.ts, so an eager, non-deferred computation here would make document-schema.js's own top-level import run the MathML z.toJSONSchema() call unconditionally -- a cost every codec in the workspace would pay merely by importing the package, whether or not it ever read $defs.MathMlAttribute/Element/Node; ExaDev/documents.js#937's z.lazy() rewrite landed the deferral alongside MathMlNodeSchema's own recursion, so no released version of this package ever paid that cost. Pinning the property-descriptor shape here (a getter until first read, a plain cached value after) is what actually proves the deferral, since a functional check (CONTENT_DEFS.MathMlNode returns the right shape) would pass identically whether or not the underlying computation were lazy. Runs against a freshly re-imported module instance (vi.resetModules() plus a dynamic import) rather than this file's own top-level CONTENT_DEFS import, since every describe block above already reads .MathMlAttribute/.MathMlElement/.MathMlNode on that shared singleton and would otherwise have already resolved these getters to plain values by the time this test runs.
describe("CONTENT_DEFS's MathML entries are computed lazily, not at module load", () => {
  it("MathMlAttribute/MathMlElement/MathMlNode start as getters and become cached values on first read", async () => {
    vi.resetModules();
    const fresh = await import("./content-json-schema-defs");

    for (const id of [
      "MathMlAttribute",
      "MathMlElement",
      "MathMlNode",
    ] as const) {
      const beforeRead = Object.getOwnPropertyDescriptor(
        fresh.CONTENT_DEFS,
        id,
      );
      expect(typeof beforeRead?.get).toBe("function");
      expect(beforeRead?.value).toBeUndefined();
    }

    const firstRead = fresh.CONTENT_DEFS.MathMlAttribute;

    const afterRead = Object.getOwnPropertyDescriptor(
      fresh.CONTENT_DEFS,
      "MathMlAttribute",
    );
    expect(typeof afterRead?.get).toBe("undefined");
    expect(afterRead?.value).toBe(firstRead);
    // A second read reuses the cached value rather than recomputing it.
    expect(fresh.CONTENT_DEFS.MathMlAttribute).toBe(firstRead);
  });

  it("builds the registry and calls z.toJSONSchema() only once total, even though three separate getters each trigger the same underlying computation", async () => {
    // getMathMlJsonSchemas() is called independently by each of the three getters (via mathMlDef), and its own cachedMathMlJsonSchemas check is what stops the second and third calls from re-registering the schemas and re-invoking z.toJSONSchema() -- a functional check on the returned VALUES alone can't distinguish "recomputed but happened to produce the same result" from "reused the cache", since z.toJSONSchema() is deterministic either way. zod's own namespace export can't be vi.spyOn'd directly (ESM module namespaces are non-configurable), so this counts calls through vi.doMock over the whole 'zod' module instead, wrapping the real toJSONSchema.
    let callCount = 0;
    vi.doMock("zod", async (importOriginal) => {
      const actual = await importOriginal<typeof ZodModule>();
      return {
        ...actual,
        z: {
          ...actual.z,
          toJSONSchema: (...args: Parameters<typeof actual.z.toJSONSchema>) => {
            callCount += 1;
            return actual.z.toJSONSchema(...args);
          },
        },
      };
    });
    vi.resetModules();
    try {
      const fresh = await import("./content-json-schema-defs");
      expect(fresh.CONTENT_DEFS.MathMlAttribute).toBeDefined();
      expect(fresh.CONTENT_DEFS.MathMlElement).toBeDefined();
      expect(fresh.CONTENT_DEFS.MathMlNode).toBeDefined();
      expect(callCount).toBe(1);
    } finally {
      vi.doUnmock("zod");
      vi.resetModules();
    }
  });

  it("computes the exact shape on first read, against a genuinely fresh module instance", async () => {
    // Every describe block above this one reads .MathMlAttribute/.MathMlElement/.MathMlNode on the file's own shared top-level CONTENT_DEFS import, caching the getters' computed value the first time any of them runs. A test reading that already-cached value never re-executes getMathMlJsonSchemas/mathMlDef/cacheMathMlDef itself, so Stryker's own per-test coverage never attributes those functions' lines to such a test -- only the test that FIRST computes the value (whichever runs earliest in file order) gets credited, and every later assertion against the resulting value, however exact, is invisible to a mutant confined to those lines. A fresh module instance forces the computation to happen here, inside this test's own coverage, which is what actually lets an assertion here kill a mutation to that code.
    vi.resetModules();
    const fresh = await import("./content-json-schema-defs");
    expect(fresh.CONTENT_DEFS.MathMlAttribute).toStrictEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        value: { type: "string" },
      },
      required: ["name", "value"],
      additionalProperties: false,
    });
    expect(fresh.CONTENT_DEFS.MathMlElement).toStrictEqual({
      type: "object",
      properties: {
        type: { type: "string", const: "element" },
        tag: { type: "string" },
        attributes: {
          type: "array",
          items: { $ref: "#/$defs/MathMlAttribute" },
        },
        children: { type: "array", items: { $ref: "#/$defs/MathMlNode" } },
      },
      required: ["type", "tag", "attributes", "children"],
      additionalProperties: false,
    });
    // The cached value is a plain, non-enumerable-defeating, non-writable, configurable property -- exactly what cacheMathMlDef's own Object.defineProperty call states.
    const descriptor = Object.getOwnPropertyDescriptor(
      fresh.CONTENT_DEFS,
      "MathMlAttribute",
    );
    expect(descriptor?.enumerable).toBe(true);
    expect(descriptor?.configurable).toBe(true);
    expect(descriptor?.writable).toBe(false);
    // The cached property is still enumerable, so a plain Object.keys/spread over CONTENT_DEFS still sees it once resolved -- it never silently drops out of the object's own key set.
    expect(Object.keys(fresh.CONTENT_DEFS)).toContain("MathMlAttribute");
  });
});

describe("EMBEDDED_OBJECT_KINDS", () => {
  it("is the exact six-member vocabulary, in declared order", () => {
    expect(EMBEDDED_OBJECT_KINDS).toStrictEqual([
      "formula",
      "wordprocessing",
      "presentation",
      "spreadsheet",
      "drawing",
      "chart",
    ]);
  });
});

// Genuine, independent coverage for the fragments this file's own top comment says the live z.toJSONSchema() comparison cannot reach: the nine package-tree group wrappers (recursive through their own children arrays, downstream of package-node.ts's z.custom() guards) and ContentEmbeddedObject/ContentEmbeddedObjectBlock (excluded from the comparison for the documented cross-file-cycle reason). Each expectation below is hand-transcribed from this file's own CONTENT_DEFS literal -- the same "pin the exact fixed shape" treatment the MathML describe block above gives the three entries the comparison also cannot reach, so a literal genuinely edited here (a wrong $ref, a dropped required key, additionalProperties flipped) fails one of these instead of silently surviving.
describe("CONTENT_DEFS's package-tree and embedded-object fragments (hard-coded shape, outside the live comparison's reach)", () => {
  it("ContentEmbeddedObject carries the shared embedded-object fields minus the block-level kind discriminant", () => {
    expect(CONTENT_DEFS.ContentEmbeddedObject).toStrictEqual({
      type: "object",
      properties: {
        objectKind: { type: "string", enum: EMBEDDED_OBJECT_KINDS },
        document: { $ref: CONTENT_DOCUMENT_URI },
        frame: { $ref: "#/$defs/Box" },
        anchorRow: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
        anchorColumn: {
          type: "integer",
          minimum: 0,
          maximum: MAX_SAFE_INTEGER,
        },
        offsetXPt: { type: "number" },
        offsetYPt: { type: "number" },
        source: { $ref: "#/$defs/SourceResidue" },
      },
      required: ["objectKind", "document", "frame"],
      additionalProperties: false,
    });
  });

  it("ContentEmbeddedObjectBlock adds the block-level kind discriminant, sourcePath, and frames", () => {
    expect(CONTENT_DEFS.ContentEmbeddedObjectBlock).toStrictEqual({
      type: "object",
      properties: {
        kind: { type: "string", const: "embeddedObject" },
        objectKind: { type: "string", enum: EMBEDDED_OBJECT_KINDS },
        document: { $ref: CONTENT_DOCUMENT_URI },
        frame: { $ref: "#/$defs/Box" },
        sourcePath: { type: "string" },
        source: { $ref: "#/$defs/SourceResidue" },
        frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
        anchorRow: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
        anchorColumn: {
          type: "integer",
          minimum: 0,
          maximum: MAX_SAFE_INTEGER,
        },
        offsetXPt: { type: "number" },
        offsetYPt: { type: "number" },
      },
      required: ["kind", "objectKind", "document", "frame"],
      additionalProperties: false,
    });
  });

  it("ContentBlock is a oneOf over the seven ContentBlock variants, in declared order", () => {
    expect(CONTENT_DEFS.ContentBlock).toStrictEqual({
      oneOf: [
        { $ref: "#/$defs/ContentParagraph" },
        { $ref: "#/$defs/ContentTable" },
        { $ref: "#/$defs/ContentImageBlock" },
        { $ref: "#/$defs/ContentPageBreak" },
        { $ref: "#/$defs/ContentEmbeddedObjectBlock" },
        { $ref: "#/$defs/ContentConstructStart" },
        { $ref: "#/$defs/ContentConstructEnd" },
      ],
    });
  });

  it("TreeBlockLeaf is ContentBlock minus the two construct boundary markers", () => {
    expect(CONTENT_DEFS.TreeBlockLeaf).toStrictEqual({
      oneOf: [
        { $ref: "#/$defs/ContentParagraph" },
        { $ref: "#/$defs/ContentTable" },
        { $ref: "#/$defs/ContentImageBlock" },
        { $ref: "#/$defs/ContentPageBreak" },
        { $ref: "#/$defs/ContentEmbeddedObjectBlock" },
      ],
    });
  });

  const SECTION_FLOW_CHILDREN = [
    { $ref: "#/$defs/HeadingGroup" },
    { $ref: "#/$defs/ListGroup" },
    { $ref: "#/$defs/SectionConstructGroup" },
    { $ref: "#/$defs/TreeBlockLeaf" },
  ];

  it("SectionGroup wraps a SectionDescriptor over the section-flow child vocabulary", () => {
    expect(CONTENT_DEFS.SectionGroup).toStrictEqual({
      type: "object",
      properties: {
        node: { $ref: "#/$defs/SectionDescriptor" },
        style: { type: "string" },
        children: { type: "array", items: { oneOf: SECTION_FLOW_CHILDREN } },
      },
      required: ["node", "children"],
      additionalProperties: false,
    });
  });

  it("HeadingGroup wraps a HeadingParagraph over the identical section-flow child vocabulary", () => {
    expect(CONTENT_DEFS.HeadingGroup).toStrictEqual({
      type: "object",
      properties: {
        node: { $ref: "#/$defs/HeadingParagraph" },
        style: { type: "string" },
        children: { type: "array", items: { oneOf: SECTION_FLOW_CHILDREN } },
      },
      required: ["node", "children"],
      additionalProperties: false,
    });
  });

  const LIST_FLOW_CHILDREN = [
    { $ref: "#/$defs/ListGroup" },
    { $ref: "#/$defs/ShapeConstructGroup" },
    { $ref: "#/$defs/TreeBlockLeaf" },
  ];

  it("ListGroup wraps a ListParagraph over the list/shape-flow child vocabulary -- never HeadingGroup", () => {
    expect(CONTENT_DEFS.ListGroup).toStrictEqual({
      type: "object",
      properties: {
        node: { $ref: "#/$defs/ListParagraph" },
        style: { type: "string" },
        children: { type: "array", items: { oneOf: LIST_FLOW_CHILDREN } },
      },
      required: ["node", "children"],
      additionalProperties: false,
    });
  });

  it("SlideGroup wraps a SlideDescriptor over shape groups only, never a bare leaf", () => {
    expect(CONTENT_DEFS.SlideGroup).toStrictEqual({
      type: "object",
      properties: {
        node: { $ref: "#/$defs/SlideDescriptor" },
        style: { type: "string" },
        children: { type: "array", items: { $ref: "#/$defs/ShapeGroup" } },
      },
      required: ["node", "children"],
      additionalProperties: false,
    });
  });

  it("ShapeGroup wraps a ShapeDescriptor over the list/shape-flow child vocabulary", () => {
    expect(CONTENT_DEFS.ShapeGroup).toStrictEqual({
      type: "object",
      properties: {
        node: { $ref: "#/$defs/ShapeDescriptor" },
        style: { type: "string" },
        children: { type: "array", items: { oneOf: LIST_FLOW_CHILDREN } },
      },
      required: ["node", "children"],
      additionalProperties: false,
    });
  });

  it("SheetGroup wraps a SheetDescriptor over sheet images then whole embedded objects", () => {
    expect(CONTENT_DEFS.SheetGroup).toStrictEqual({
      type: "object",
      properties: {
        node: { $ref: "#/$defs/SheetDescriptor" },
        style: { type: "string" },
        children: {
          type: "array",
          items: {
            oneOf: [
              { $ref: "#/$defs/ContentSheetImage" },
              { $ref: "#/$defs/ContentEmbeddedObject" },
            ],
          },
        },
      },
      required: ["node", "children"],
      additionalProperties: false,
    });
  });

  it("DrawPageGroup wraps a DrawPageDescriptor over shape groups then vector leaves", () => {
    expect(CONTENT_DEFS.DrawPageGroup).toStrictEqual({
      type: "object",
      properties: {
        node: { $ref: "#/$defs/DrawPageDescriptor" },
        style: { type: "string" },
        children: {
          type: "array",
          items: {
            oneOf: [
              { $ref: "#/$defs/ShapeGroup" },
              { $ref: "#/$defs/ContentVector" },
            ],
          },
        },
      },
      required: ["node", "children"],
      additionalProperties: false,
    });
  });

  it("SectionConstructGroup wraps a ConstructDescriptor over the section-flow child vocabulary", () => {
    expect(CONTENT_DEFS.SectionConstructGroup).toStrictEqual({
      type: "object",
      properties: {
        node: { $ref: "#/$defs/ConstructDescriptor" },
        style: { type: "string" },
        children: { type: "array", items: { oneOf: SECTION_FLOW_CHILDREN } },
      },
      required: ["node", "children"],
      additionalProperties: false,
    });
  });

  it("ShapeConstructGroup wraps a ConstructDescriptor over the list/shape-flow child vocabulary", () => {
    expect(CONTENT_DEFS.ShapeConstructGroup).toStrictEqual({
      type: "object",
      properties: {
        node: { $ref: "#/$defs/ConstructDescriptor" },
        style: { type: "string" },
        children: { type: "array", items: { oneOf: LIST_FLOW_CHILDREN } },
      },
      required: ["node", "children"],
      additionalProperties: false,
    });
  });
});
