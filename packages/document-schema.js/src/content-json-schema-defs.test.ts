import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ColorSchema } from "./color";
import {
  ContentBorderSchema,
  ContentCellBordersSchema,
  ContentConstructEndSchema,
  ContentConstructStartSchema,
  ContentImageBlockSchema,
  ContentListMembershipSchema,
  ContentPageBreakSchema,
  ContentParagraphSchema,
  ContentPathPointSchema,
  ContentPathSegmentSchema,
  ContentRunSchema,
  RunConstructExtentSchema,
  ContentSheetCellCommentSchema,
  ContentSheetCellSchema,
  ContentSheetColumnSchema,
  ContentSheetConditionalFormatSchema,
  ContentSheetConditionalFormatStyleSchema,
  ContentSheetConditionalFormatValueSchema,
  ContentSheetDataValidationSchema,
  ContentSheetImageSchema,
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
} from "./content";
import { CONTENT_DEFS } from "./content-json-schema-defs";
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
  MathNormalisationContextSchema,
  MathNumSchema,
  MathPresentationSchema,
  MathProvenanceSchema,
  MathQtySchema,
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

// This is the regression test scripts/generate-json-schemas.mjs's own top comment calls for: the only structural defence that generator has against silently drifting away from src/content.ts/src/color.ts/src/geometry.ts/src/style.ts/src/math.ts/src/package-node.ts/src/definitions.ts/src/mathml.ts, since CONTENT_DEFS (content-json-schema-defs.ts) is transcribed by hand rather than generated. Not every entry in CONTENT_DEFS can be checked this way -- ContentBlock/ContentTable/ContentTableRow/ContentTableCell/ContentEmbeddedObject(Block) sit downstream of one of the genuinely un-representable z.custom() nodes (ContentBlockSchema, ContentEmbeddedObjectSchema), the nine package-tree group wrappers sit downstream of the tree's own per-kind group schemas (src/package-node.ts, z.custom over recursive guards, reached only through the hand fragments' own children pointers), and ContentFormula/MathExpression/MathApp/MathSum/MathProd/MathMatrix sit downstream of the third opaque node (MathExpressionSchema, reached through ContentFormulaSchema.content for the first and through the grammar's own recursion for the rest) -- see that module's own top comment -- so a bare z.toJSONSchema() call over their real schema counterpart either throws or degrades to `{}` for the recursive/custom part, which is exactly the problem CONTENT_DEFS exists to work around in the first place. MathMlNode/MathMlElement/MathMlAttribute left that un-checkable bucket in ExaDev/documents.js#937 -- MathMlNodeSchema is a real, self-recursive z.discriminatedUnion() now (src/mathml.ts), not a z.custom() node -- but they did not become entries of the same kind as everything below: CONTENT_DEFS's own MathMlAttribute/MathMlElement/MathMlNode fragments are themselves computed from a live z.toJSONSchema() call over that schema (content-json-schema-defs.ts's own getMathMlJsonSchemas()), not hand-transcribed. Registering MathMlAttributeSchema/MathMlElementSchema/MathMlNodeSchema here and comparing the result against CONTENT_DEFS does NOT independently re-derive anything and does NOT catch drift in mathml.ts's own field shapes, because both sides of that comparison call z.toJSONSchema() over the identical schema objects -- a field added to or removed from any of the three changes both sides identically and the comparison stays green regardless. Confirmed empirically: injecting a required `prefix: z.string()` field into MathMlAttributeSchema left every one of this file's tests passing. What that comparison DOES verify, and it is real, is narrower: that content-json-schema-defs.ts's own generation is deterministic and reproducible -- a second, separately-constructed z.toJSONSchema() call over the same three schemas (this file's own REGISTERED_SCHEMAS registry, built independently of the local registry getMathMlJsonSchemas() constructs inside content-json-schema-defs.ts) produces byte-identical output, catching a bug in the generation plumbing itself (a stale cache, a wrong uri callback, a registry built over the wrong schema instance) rather than a bug in mathml.ts's own fields. Genuine field-shape coverage for these three entries -- the kind every other schema below gets from the live comparison -- lives instead in the separate `CONTENT_DEFS's generated MathML fragments` describe block further down this file: fixed, hand-coded expected keys/types with no dependency on any z.toJSONSchema() call at all, so a field actually added to, removed from, or renamed on one of the three does fail it.
//
// What CAN be checked against a live schema in that same genuine, independent sense -- because a real, non-recursive, non-custom exported Zod schema exists for it, and CONTENT_DEFS's own value is still transcribed by hand rather than computed from that same schema -- is every leaf and near-leaf fragment: Color, Box, LayoutFrame, Alignment, SourceResidue, ContentStrokeStyle, ContentBorder, ContentCellBorders, ContentListMembership, ContentRun, ContentParagraph, ContentImageBlock, ContentPageBreak, PageSize, Margins, SectionDescriptor, SlideDescriptor, SheetDescriptor, DrawPageDescriptor, ShapeDescriptor, HeadingParagraph, ListParagraph, the whole construct descriptor vocabulary (ContentControlDescriptor, FieldDescriptor, AnchorDescriptor, LinkTarget, LinkDescriptor, ProvenanceDescriptor, DivisionSource, DivisionDescriptor, and the ConstructDescriptor union over them -- each a plain z.strictObject or a union of them, reaching no opaque node), the flat form's two construct boundary markers (ContentConstructStart, whose only non-literal field is that same ConstructDescriptor union, and ContentConstructEnd, whose kind literal is its whole payload), ContentSheetCell, ContentCellValue, ContentSheetCellComment, ContentSheetColumn, ContentSheetRow, ContentSheetPrintSettings, ContentSheetPrintRange, ContentSheetRepeatRange, ContentSheetImage, ContentStroke, ContentPathPoint, ContentPathSegment, ContentSubpath, ContentVector, StyleParagraphProperties, StyleRunProperties, StyleEntry, DefinitionEntry, ExactRational, DimensionVector, MathPresentation, MathProvenance, MathUncertainty, MathNum, MathQty, MathSym, MathUnparsed, MathSymbolEntry, MathUnit, MathNormalisationContext, SymbolTable. None of these reaches ContentBlockSchema, ContentEmbeddedObjectSchema, MathExpressionSchema, or a tree group schema from anywhere in its own field tree, so each can be generated live and compared directly against a hand-authored fragment that could actually have drifted from it.
//
// Comparison strategy: a bare `z.toJSONSchema(SomeSchema)` call, run in isolation, would INLINE every nested schema it encounters (ColorSchema inside ContentRunSchema, AlignmentSchema inside ContentParagraphSchema, etc.) rather than emit the `{ $ref: '#/$defs/X' }` pointers CONTENT_DEFS itself uses -- because those nested schemas aren't registered anywhere. To reproduce the exact cross-reference shape CONTENT_DEFS hand-authors, this test registers the identical set of real schemas under the identical id strings CONTENT_DEFS uses as its own $defs keys, with a `uri` callback matching the `#/$defs/<id>` convention CONTENT_DEFS was written against -- confirmed empirically (see this file's own construction) to make Zod's registry-based multi-schema generation emit exactly that $ref shape for every registered schema referenced from within another. Each per-schema result still carries its own top-level `$schema`/`$id` (since z.toJSONSchema(registry, ...) treats every registered schema as its own standalone root), which CONTENT_DEFS's own nested fragments never have -- those two keys are stripped before comparison, since they're an artefact of testing each fragment as a registry root rather than a real structural difference.

const REGISTERED_SCHEMAS = {
  Color: ColorSchema,
  Box: BoxSchema,
  LayoutFrame: LayoutFrameSchema,
  Alignment: AlignmentSchema,
  SourceResidue: SourceResidueSchema,
  ContentStrokeStyle: ContentStrokeStyleSchema,
  ContentBorder: ContentBorderSchema,
  ContentCellBorders: ContentCellBordersSchema,
  ContentListMembership: ContentListMembershipSchema,
  ContentRun: ContentRunSchema,
  RunConstructExtent: RunConstructExtentSchema,
  ContentParagraph: ContentParagraphSchema,
  ContentImageBlock: ContentImageBlockSchema,
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
  ContentStroke: ContentStrokeSchema,
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

describe("CONTENT_DEFS vs live z.toJSONSchema() output", () => {
  it.each(
    Object.keys(REGISTERED_SCHEMAS).filter(
      (id) => !MATHML_GENERATED_IDS.includes(id),
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

// CONTENT_DEFS is re-exported wholesale from src/index.ts, so document-schema.js's own top-level import used to run the MathML z.toJSONSchema() call unconditionally -- a cost every codec in the workspace paid merely by importing the package, whether or not it ever read $defs.MathMlAttribute/Element/Node. Pinning the property-descriptor shape here (a getter until first read, a plain cached value after) is what actually proves the deferral, since a functional check (CONTENT_DEFS.MathMlNode returns the right shape) would pass identically whether or not the underlying computation were lazy. Runs against a freshly re-imported module instance (vi.resetModules() plus a dynamic import) rather than this file's own top-level CONTENT_DEFS import, since every describe block above already reads .MathMlAttribute/.MathMlElement/.MathMlNode on that shared singleton and would otherwise have already resolved these getters to plain values by the time this test runs.
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
});
