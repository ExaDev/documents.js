import { describe, expect, it } from "vitest";
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

// This is the regression test scripts/generate-json-schemas.mjs's own top comment calls for: the only structural defence that generator has against silently drifting away from src/content.ts/src/color.ts/src/geometry.ts/src/style.ts/src/math.ts/src/package-node.ts/src/definitions.ts, since CONTENT_DEFS (content-json-schema-defs.ts) is transcribed by hand rather than generated. Not every entry in CONTENT_DEFS can be checked this way -- ContentBlock/ContentTable/ContentTableRow/ContentTableCell/ContentEmbeddedObject(Block)/MathMlNode/MathMlElement/MathMlAttribute all sit downstream of one of the genuinely un-representable z.custom() nodes (ContentBlockSchema, ContentEmbeddedObjectSchema, MathMlNodeSchema), the nine package-tree group wrappers sit downstream of the tree's own per-kind group schemas (src/package-node.ts, z.custom over recursive guards, reached only through the hand fragments' own children pointers), and ContentFormula/MathExpression/MathApp/MathSum/MathProd/MathMatrix sit downstream of the fourth opaque node (MathExpressionSchema, reached through ContentFormulaSchema.content for the first and through the grammar's own recursion for the rest) -- see that module's own top comment -- so a bare z.toJSONSchema() call over their real schema counterpart either throws or degrades to `{}` for the recursive/custom part, which is exactly the problem CONTENT_DEFS exists to work around in the first place. What CAN be checked -- because a real, non-recursive, non-custom exported Zod schema exists for it -- is every leaf and near-leaf fragment: Color, Box, LayoutFrame, Alignment, SourceResidue, ContentStrokeStyle, ContentBorder, ContentCellBorders, ContentListMembership, ContentRun, ContentParagraph, ContentImageBlock, ContentPageBreak, PageSize, Margins, SectionDescriptor, SlideDescriptor, SheetDescriptor, DrawPageDescriptor, ShapeDescriptor, HeadingParagraph, ListParagraph, the whole construct descriptor vocabulary (ContentControlDescriptor, FieldDescriptor, AnchorDescriptor, LinkTarget, LinkDescriptor, ProvenanceDescriptor, DivisionSource, DivisionDescriptor, and the ConstructDescriptor union over them -- each a plain z.strictObject or a union of them, reaching no opaque node), the flat form's two construct boundary markers (ContentConstructStart, whose only non-literal field is that same ConstructDescriptor union, and ContentConstructEnd, whose kind literal is its whole payload), ContentSheetCell, ContentCellValue, ContentSheetCellComment, ContentSheetColumn, ContentSheetRow, ContentSheetPrintSettings, ContentSheetPrintRange, ContentSheetRepeatRange, ContentSheetImage, ContentStroke, ContentPathPoint, ContentPathSegment, ContentSubpath, ContentVector, StyleParagraphProperties, StyleRunProperties, StyleEntry, DefinitionEntry, ExactRational, DimensionVector, MathPresentation, MathProvenance, MathUncertainty, MathNum, MathQty, MathSym, MathUnparsed, MathSymbolEntry, MathUnit, MathNormalisationContext, SymbolTable. None of these reaches ContentBlockSchema, ContentEmbeddedObjectSchema, MathMlNodeSchema, MathExpressionSchema, or a tree group schema from anywhere in its own field tree, so each can be generated live and compared directly.
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

describe("CONTENT_DEFS vs live z.toJSONSchema() output", () => {
  it.each(Object.keys(REGISTERED_SCHEMAS))(
    "%s: hand-authored fragment matches a live z.toJSONSchema() call over its real schema",
    (id) => {
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
    },
  );
});
