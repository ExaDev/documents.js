import type { z } from 'zod';
import { SI_BASE_DIMENSIONS } from './math';
import { schemaUriFor } from './schema-io';

// The hand-authored JSON Schema $defs fragments spliced into content-document.schema.json's `override()` callback (scripts/generate-json-schemas.mjs), lifted out into their own src module rather than staying inline in that script. The reason is single-sourcing, not tidiness: this exact object needs to be reachable from two places that cannot share an import graph --
//
//   1. scripts/generate-json-schemas.mjs itself, which only ever runs against the freshly-built ../dist/ (it imports every other schema it needs the same way), so it imports CONTENT_DEFS from '../dist/content-json-schema-defs.js', the file tsdown emits for this module (entry: 'src/**/*.ts', one dist file per src file -- see tsdown.config.ts).
//   2. content-json-schema-defs.test.ts (src/, run directly by vitest's "unit" project against source, never against dist), which imports this exact same CONTENT_DEFS value straight from here and asserts it stays byte-for-byte in step with a live z.toJSONSchema() call over each fragment's real exported Zod schema counterpart (ContentParagraphSchema, ContentRunSchema, ContentListMembershipSchema, ContentImageBlockSchema, ContentPageBreakSchema, ColorSchema, BoxSchema, AlignmentSchema, ContentStrokeStyleSchema, ContentBorderSchema, ContentCellBordersSchema, plus the non-recursive math leaves from src/math.ts: ExactRationalSchema, DimensionVectorSchema, MathPresentationSchema, MathProvenanceSchema, MathUncertaintySchema, MathNumSchema, MathQtySchema, MathSymSchema, MathUnparsedSchema, MathSymbolEntrySchema, MathUnitSchema, MathNormalisationContextSchema, SymbolTableSchema) -- see that test file's own top comment for why this is the only structural defence this generator has against silently drifting away from the schemas it's meant to describe.
//
// If CONTENT_DEFS stayed inline in the .mjs script, only path 1 above would work: the script imports Zod schemas exclusively from '../dist/index.js' (a build artefact that may not exist, and per eslint.config.ts/tsconfig.json is deliberately excluded from both linting and typechecking, matching test/smoke.test.mjs's own precedent) -- a test that has to import through that path would only ever run after a build, which `pnpm test` (the "unit" vitest project, run standalone in CI's own "test" job, with no build step beforehand) never guarantees. Living here instead, this is an ordinary, fully typechecked and linted src module like any other -- CONTENT_DEFS just happens to be consumed by a script as well as by the package's own test suite.
//
// The fragments below still cover exactly what scripts/generate-json-schemas.mjs's own top-of-file comment already explains: ContentBlockSchema, ContentEmbeddedObjectSchema, MathMlNodeSchema, and MathExpressionSchema are z.custom() predicates z.toJSONSchema() cannot introspect at all (recursion the pinned Zod version's z.lazy() can't express -- see src/content.ts's isContentBlock/isContentEmbeddedObject, src/mathml.ts's isMathMlNode, and src/math.ts's isMathExpression), so every schema reachable only through one of those four is transcribed by hand here, field-for-field, from the real Zod object definitions. Two further schemas are transcribed despite being real z.objects themselves: ContentFormulaSchema (its mathml/content fields reach the opaque MathMlNodeSchema/MathExpressionSchema nodes, exactly like ContentTableCellSchema's blocks) and SymbolTableSchema (transcribed so each ContentDocument arm's symbolTable field is one named $ref rather than five inlined copies of the whole unit-registry subtree) -- the generator's override() replaces both with a $ref to their fragments here. Anything transcribed here that DOES have a real, non-custom, exported Zod schema counterpart is exactly what content-json-schema-defs.test.ts holds to a live z.toJSONSchema() comparison; re-verify the rest (ContentTableCell/ContentTableRow/ContentTable, ContentEmbeddedObjectBlock, MathMlElement/MathMlNode, MathApp/MathSum/MathProd/MathMatrix/MathExpression, ContentFormula) against src/content.ts/src/mathml.ts/src/math.ts by hand whenever those files' field shapes change, exactly as before.

type JsonSchema = z.core.JSONSchema.JSONSchema;

// Zod's own `.int()` bag range (node_modules/zod/v4/core/json-schema-processors.js's numberProcessor), reproduced verbatim wherever a hand-authored integer field below mirrors a real `z.number().int()...` field -- confirmed empirically against ContentListMembershipSchema.level and ContentTableCellSchema.colSpan/rowSpan.
export const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

export const EMBEDDED_OBJECT_KINDS = ['formula', 'wordprocessing', 'presentation', 'spreadsheet', 'drawing'];

// The genuine cycle back to a whole ContentDocument: ContentEmbeddedObject(Block)'s own `document` field. Resolved once here since both the ContentEmbeddedObjectBlock fragment below and scripts/generate-json-schemas.mjs's own override() branch for the standalone ContentEmbeddedObjectSchema need the identical URI.
export const CONTENT_DOCUMENT_URI = schemaUriFor('ContentDocument');

// The two binder variants (MathSum/MathProd) differ only in their kind discriminant -- one builder rather than two copies of the same twelve-line fragment, so a binder-field change lands in both or fails the hand re-verification visibly in the diff.
function mathBinderDef(kind: 'sum' | 'prod'): JsonSchema {
  return {
    type: 'object',
    properties: {
      kind: { type: 'string', const: kind },
      binder: { type: 'string' },
      lower: { $ref: '#/$defs/MathExpression' },
      upper: { $ref: '#/$defs/MathExpression' },
      body: { $ref: '#/$defs/MathExpression' },
    },
    required: ['kind', 'binder', 'lower', 'upper', 'body'],
    additionalProperties: false,
  };
}

// -- Hand-authored $defs, spliced into content-document.schema.json only (via scripts/generate-json-schemas.mjs's own ContentDocumentSchema override branch) --
//
// The fragments below are transcribed by hand, field-for-field, from src/content.ts's real Zod object definitions (ContentParagraphSchema, ContentTableSchema/ContentTableRowSchema/ContentTableCellSchema, ContentImageBlockSchema, ContentPageBreakSchema, ContentRunSchema, ContentListMembershipSchema, ColorSchema, BoxSchema, LayoutFrameSchema, AlignmentSchema, ContentStrokeStyleSchema, ContentBorderSchema, ContentCellBordersSchema -- each cross-checked directly against a real z.toJSONSchema() call over that exact exported schema, and the ones with a real, non-recursive, non-custom counterpart are held to that comparison as a running test by content-json-schema-defs.test.ts) plus the ContentEmbeddedObject/ContentEmbeddedObjectBlock TS interfaces, which have no exported z.object() counterpart at all (both are validated only via the isContentEmbeddedObject*() z.custom() guards), plus the math value schemas of src/math.ts (the semantic half of the two-layer formula model -- see that file's own top comment for how the layers divide). Re-verify this block against src/content.ts/src/math.ts whenever those files' field shapes change -- nothing here is generated or checked against the real schemas at build time, other than the leaf/near-leaf fragments the regression test below does cover.
export const CONTENT_DEFS: Record<string, JsonSchema> = {
  Color: {
    type: 'object',
    properties: {
      r: { type: 'number', minimum: 0, maximum: 1 },
      g: { type: 'number', minimum: 0, maximum: 1 },
      b: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['r', 'g', 'b'],
    additionalProperties: false,
  },
  Box: {
    type: 'object',
    properties: {
      xPt: { type: 'number' },
      yPt: { type: 'number' },
      widthPt: { type: 'number', minimum: 0 },
      heightPt: { type: 'number', minimum: 0 },
    },
    required: ['xPt', 'yPt', 'widthPt', 'heightPt'],
    additionalProperties: false,
  },
  LayoutFrame: {
    type: 'object',
    properties: {
      pageIndex: { type: 'integer', minimum: 0, maximum: MAX_SAFE_INTEGER },
      xPt: { type: 'number' },
      yPt: { type: 'number' },
      widthPt: { type: 'number', minimum: 0 },
      heightPt: { type: 'number', minimum: 0 },
    },
    required: ['pageIndex', 'xPt', 'yPt', 'widthPt', 'heightPt'],
    additionalProperties: false,
  },
  Alignment: {
    type: 'string',
    enum: ['left', 'center', 'right', 'justify'],
  },
  ContentStrokeStyle: {
    type: 'string',
    enum: ['solid', 'dashed', 'dotted', 'double'],
  },
  ContentBorder: {
    type: 'object',
    properties: {
      color: { $ref: '#/$defs/Color' },
      widthPt: { type: 'number', exclusiveMinimum: 0 },
      style: { $ref: '#/$defs/ContentStrokeStyle' }, // absent means 'solid'
    },
    required: ['color', 'widthPt'],
    additionalProperties: false,
  },
  ContentCellBorders: {
    type: 'object',
    properties: {
      left: { $ref: '#/$defs/ContentBorder' },
      right: { $ref: '#/$defs/ContentBorder' },
      top: { $ref: '#/$defs/ContentBorder' },
      bottom: { $ref: '#/$defs/ContentBorder' },
    },
    additionalProperties: false,
  },
  ContentListMembership: {
    type: 'object',
    properties: {
      numId: { type: 'string' }, // optional in the Zod source -- depth-only list membership (OOXML drawing paragraphs) carries no numbering identity
      level: { type: 'integer', minimum: 0, maximum: MAX_SAFE_INTEGER },
    },
    required: ['level'],
    additionalProperties: false,
  },
  ContentRun: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      bold: { type: 'boolean' },
      italic: { type: 'boolean' },
      underline: { type: 'boolean' },
      strike: { type: 'boolean' },
      fontFamily: { type: 'string' },
      sizePt: { type: 'number', exclusiveMinimum: 0 },
      color: { $ref: '#/$defs/Color' },
      hyperlink: { type: 'string' }, // resolved external URI
      sourcePath: { type: 'string' },
      frames: { type: 'array', items: { $ref: '#/$defs/LayoutFrame' } },
    },
    required: ['text'],
    additionalProperties: false,
  },
  ContentParagraph: {
    type: 'object',
    properties: {
      kind: { type: 'string', const: 'paragraph' },
      runs: { type: 'array', items: { $ref: '#/$defs/ContentRun' } },
      styleId: { type: 'string' }, // w:pStyle/@w:val, e.g. 'Heading1'
      headingLevel: { type: 'integer', exclusiveMinimum: 0, maximum: MAX_SAFE_INTEGER }, // canonical, format-agnostic heading depth -- see src/content.ts's own field comment
      alignment: { $ref: '#/$defs/Alignment' },
      list: { $ref: '#/$defs/ContentListMembership' },
      spacingBeforePt: { type: 'number' },
      spacingAfterPt: { type: 'number' },
      lineSpacing: { type: 'number', exclusiveMinimum: 0 }, // multiple of single line height
      indentLeftPt: { type: 'number' },
      indentFirstLinePt: { type: 'number' },
      sourcePath: { type: 'string' },
      frames: { type: 'array', items: { $ref: '#/$defs/LayoutFrame' } },
    },
    required: ['kind', 'runs'],
    additionalProperties: false,
  },
  ContentImageBlock: {
    type: 'object',
    properties: {
      kind: { type: 'string', const: 'image' },
      format: { type: 'string', enum: ['png', 'jpeg'] },
      base64: { type: 'string' },
      widthPt: { type: 'number', exclusiveMinimum: 0 },
      heightPt: { type: 'number', exclusiveMinimum: 0 },
      altText: { type: 'string' },
      sourcePath: { type: 'string' },
      frames: { type: 'array', items: { $ref: '#/$defs/LayoutFrame' } },
    },
    required: ['kind', 'format', 'base64', 'widthPt', 'heightPt'],
    additionalProperties: false,
  },
  ContentPageBreak: {
    type: 'object',
    properties: {
      kind: { type: 'string', const: 'pageBreak' },
      sourcePath: { type: 'string' },
      frames: { type: 'array', items: { $ref: '#/$defs/LayoutFrame' } },
    },
    required: ['kind'],
    additionalProperties: false,
  },
  // ContentTableCellSchema/ContentTableRowSchema/ContentTableSchema ARE real, exported z.object() schemas -- but ContentTableCellSchema.blocks is z.array(ContentBlockSchema), which drags in the opaque z.custom() node the moment Zod tries to convert any of the three. Reproduced by hand here instead, for the same reason as everything else in this block. Deliberately not covered by content-json-schema-defs.test.ts's own live comparison: doing so properly needs the same ContentBlockSchema-to-$ref override the real generator applies via a registry, which is out of this fragment's own self-contained scope (see that test file's own top comment).
  ContentTableCell: {
    type: 'object',
    properties: {
      blocks: { type: 'array', items: { $ref: '#/$defs/ContentBlock' } },
      colSpan: { type: 'integer', exclusiveMinimum: 0, maximum: MAX_SAFE_INTEGER },
      rowSpan: { type: 'integer', exclusiveMinimum: 0, maximum: MAX_SAFE_INTEGER },
      background: { $ref: '#/$defs/Color' },
      borders: { $ref: '#/$defs/ContentCellBorders' },
      sourcePath: { type: 'string' },
      frames: { type: 'array', items: { $ref: '#/$defs/LayoutFrame' } },
    },
    required: ['blocks'],
    additionalProperties: false,
  },
  ContentTableRow: {
    type: 'object',
    properties: {
      // pptx tables carry an explicit row height (a:tr/@h); docx tables do not model one at the row level in the same way, so heightPt is undefined there (src/content.ts's own ContentTableRow comment).
      cells: { type: 'array', items: { $ref: '#/$defs/ContentTableCell' } },
      heightPt: { type: 'number', exclusiveMinimum: 0 },
    },
    required: ['cells'],
    additionalProperties: false,
  },
  ContentTable: {
    type: 'object',
    properties: {
      kind: { type: 'string', const: 'table' },
      rows: { type: 'array', items: { $ref: '#/$defs/ContentTableRow' } },
      // Pre-existing discrepancy, not fixed here: ContentTableSchema.columnWidthsPt is z.array(z.number().positive()), stricter than isContentBlock's own runtime guard (src/content.ts), which only checks `typeof w === 'number'` for each width in its 'table' branch. This fragment matches the stricter declared Zod schema, not the looser guard -- flagged, not silently normalized away.
      columnWidthsPt: { type: 'array', items: { type: 'number', exclusiveMinimum: 0 } },
      sourcePath: { type: 'string' },
      frames: { type: 'array', items: { $ref: '#/$defs/LayoutFrame' } },
    },
    required: ['kind', 'rows', 'columnWidthsPt'],
    additionalProperties: false,
  },
  // ContentEmbeddedObjectBlock extends ContentEmbeddedObject (src/content.ts) with its own `kind` discriminant -- neither interface has an exported z.object() schema of its own (both are validated via the isContentEmbeddedObject/isContentEmbeddedObjectBlock z.custom() guards), so this fragment is transcribed directly from the two interface declarations.
  ContentEmbeddedObjectBlock: {
    type: 'object',
    properties: {
      kind: { type: 'string', const: 'embeddedObject' },
      objectKind: { type: 'string', enum: EMBEDDED_OBJECT_KINDS },
      document: { $ref: CONTENT_DOCUMENT_URI },
      frame: { $ref: '#/$defs/Box' },
      sourcePath: { type: 'string' },
      frames: { type: 'array', items: { $ref: '#/$defs/LayoutFrame' } },
      // Cell-anchor position, all four optional -- only set on an embedded object held in a ContentSheetSchema.embeddedObjects array; mirrors ContentSheetImageSchema's own anchorRow/anchorColumn/offsetXPt/offsetYPt representation exactly (see schemas/content-document.schema.json's own ContentSheetImage fragment, generated -- not hand-transcribed -- since that schema is a real z.object()).
      anchorRow: { type: 'integer', minimum: 0, maximum: MAX_SAFE_INTEGER },
      anchorColumn: { type: 'integer', minimum: 0, maximum: MAX_SAFE_INTEGER },
      offsetXPt: { type: 'number' },
      offsetYPt: { type: 'number' },
    },
    required: ['kind', 'objectKind', 'document', 'frame'],
    additionalProperties: false,
  },
  // ContentBlock itself (src/content.ts): `ContentParagraph | ContentTable | ContentImageBlock | ContentPageBreak | ContentEmbeddedObjectBlock`, in that exact declared order.
  ContentBlock: {
    oneOf: [
      { $ref: '#/$defs/ContentParagraph' },
      { $ref: '#/$defs/ContentTable' },
      { $ref: '#/$defs/ContentImageBlock' },
      { $ref: '#/$defs/ContentPageBreak' },
      { $ref: '#/$defs/ContentEmbeddedObjectBlock' },
    ],
  },
  // The MathML node tree carried by the ContentDocument 'formula' variant's own ContentFormulaSchema.mathml (src/content.ts), reached through MathMlNodeSchema -- the third z.custom() node, transcribed field-for-field from src/mathml.ts's own real Zod definitions (MathMlAttributeSchema/MathMlTextSchema/MathMlCdataSchema/MathMlCommentSchema/MathMlDeclarationSchema/MathMlPiSchema) plus the MathMlElement interface, which has no z.object() counterpart usable here for the same reason ContentTableCell doesn't: MathMlElementSchema.children is z.array(MathMlNodeSchema), so converting it drags in the opaque custom node again.
  MathMlAttribute: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      value: { type: 'string' },
    },
    required: ['name', 'value'],
    additionalProperties: false,
  },
  MathMlElement: {
    type: 'object',
    properties: {
      type: { type: 'string', const: 'element' },
      tag: { type: 'string' },
      attributes: { type: 'array', items: { $ref: '#/$defs/MathMlAttribute' } },
      // Recursive -- an element's children may themselves be elements -- so this points at the shared MathMlNode definition rather than inlining, exactly as ContentTableCell.blocks points at ContentBlock.
      children: { type: 'array', items: { $ref: '#/$defs/MathMlNode' } },
    },
    required: ['type', 'tag', 'attributes', 'children'],
    additionalProperties: false,
  },
  // MathMlNode itself (src/mathml.ts): `MathMlText | MathMlCdata | MathMlComment | MathMlDeclaration | MathMlPi | MathMlElement`, in that exact declared order. The five non-element variants are inlined here rather than each getting its own $def -- unlike MathMlElement, none of them is referenced from anywhere else or recursive, so a separate definition would buy nothing.
  MathMlNode: {
    oneOf: [
      {
        type: 'object',
        properties: { type: { type: 'string', const: 'text' }, value: { type: 'string' } },
        required: ['type', 'value'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: { type: { type: 'string', const: 'cdata' }, value: { type: 'string' } },
        required: ['type', 'value'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: { type: { type: 'string', const: 'comment' }, value: { type: 'string' } },
        required: ['type', 'value'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          type: { type: 'string', const: 'declaration' },
          attributes: { type: 'array', items: { $ref: '#/$defs/MathMlAttribute' } },
        },
        required: ['type', 'attributes'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          type: { type: 'string', const: 'pi' },
          target: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['type', 'target', 'content'],
        additionalProperties: false,
      },
      { $ref: '#/$defs/MathMlElement' },
    ],
  },
  // -- The math value schemas (src/math.ts) --
  //
  // ContentFormula itself (src/content.ts): its `mathml` field reaches the opaque MathMlNodeSchema and its `content` field the opaque MathExpressionSchema, so the generator's override() replaces every occurrence with a $ref to this fragment (the ContentTableCell precedent -- a real z.object dragged opaque by one field). presentation/provenance/starMath are transcribed alongside rather than left to inline, so the whole fragment tree under `formula` lives here where the regression test can see the leaves.
  ContentFormula: {
    type: 'object',
    properties: {
      mathml: { type: 'array', items: { $ref: '#/$defs/MathMlNode' } },
      starMath: { type: 'string' },
      presentation: { $ref: '#/$defs/MathPresentation' },
      content: { $ref: '#/$defs/MathExpression' },
      provenance: { $ref: '#/$defs/MathProvenance' },
    },
    required: ['mathml'],
    additionalProperties: false,
  },
  // An exact rational's two halves as canonical decimal-integer strings (src/math.ts's CANONICAL_SIGNED_INTEGER/CANONICAL_POSITIVE_INTEGER -- the patterns ARE the canonicalisation: no leading zeros, no '-0', denominator strictly positive).
  ExactRational: {
    type: 'object',
    properties: {
      numerator: { type: 'string', pattern: '^(0|-?[1-9]\\d*)$' },
      denominator: { type: 'string', pattern: '^[1-9]\\d*$' },
    },
    required: ['numerator', 'denominator'],
    additionalProperties: false,
  },
  // A dimension as exponents over the SI bases (DimensionVectorSchema = z.partialRecord(z.enum(SI_BASE_DIMENSIONS), z.number().int())) -- the enum below is spread from that same const so the two cannot drift.
  DimensionVector: {
    type: 'object',
    propertyNames: { type: 'string', enum: [...SI_BASE_DIMENSIONS] },
    additionalProperties: { type: 'integer', minimum: -MAX_SAFE_INTEGER, maximum: MAX_SAFE_INTEGER },
  },
  MathPresentation: {
    type: 'object',
    properties: {
      latex: { type: 'string' },
    },
    required: ['latex'],
    additionalProperties: false,
  },
  MathProvenance: {
    type: 'object',
    properties: {
      source: { type: 'string' },
      pageRef: { type: 'string' },
      editTrail: { type: 'array', items: { type: 'string' } },
    },
    required: ['source', 'editTrail'],
    additionalProperties: false,
  },
  MathUncertainty: {
    type: 'object',
    properties: {
      magnitude: { $ref: '#/$defs/ExactRational' },
      unit: { type: 'string' },
      coverageFactor: { type: 'number', exclusiveMinimum: 0 },
    },
    required: ['magnitude'],
    additionalProperties: false,
  },
  MathSymbolEntry: {
    type: 'object',
    properties: {
      glyph: { type: 'string' },
      scope: { type: 'string' },
      id: { type: 'string' },
      quantityKind: { type: 'string' },
      preferredUnit: { type: 'string' },
      definitionSource: { type: 'string' },
    },
    required: ['glyph', 'scope', 'id'],
    additionalProperties: false,
  },
  MathUnit: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      symbol: { type: 'string' },
      name: { type: 'string' },
      dimension: { $ref: '#/$defs/DimensionVector' },
      factorToSi: { $ref: '#/$defs/ExactRational' },
      offsetToSi: { $ref: '#/$defs/ExactRational' },
      context: { type: 'string' },
    },
    required: ['id', 'symbol', 'dimension', 'factorToSi'],
    additionalProperties: false,
  },
  // The bases array's entry object is inlined rather than given its own $def -- MathMlNode's five non-element variants set the precedent for inlining definitions nothing else references.
  MathNormalisationContext: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      bases: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            unit: { type: 'string' },
            value: { $ref: '#/$defs/ExactRational' },
          },
          required: ['unit', 'value'],
          additionalProperties: false,
        },
      },
    },
    required: ['id', 'bases'],
    additionalProperties: false,
  },
  // SymbolTableSchema is a real z.object with no custom node anywhere under it, so z.toJSONSchema() could convert it inline -- it is transcribed here (and the generator $refs to it) so each ContentDocument arm's symbolTable field stays one named reference instead of five duplicated copies of this whole subtree.
  SymbolTable: {
    type: 'object',
    properties: {
      symbols: { type: 'array', items: { $ref: '#/$defs/MathSymbolEntry' } },
      units: { type: 'array', items: { $ref: '#/$defs/MathUnit' } },
      contexts: { type: 'array', items: { $ref: '#/$defs/MathNormalisationContext' } },
    },
    required: ['symbols', 'units'],
    additionalProperties: false,
  },
  // MathExpression and the recursive variants below it sit downstream of the fourth opaque z.custom() node (MathExpressionSchema) -- transcribed from src/math.ts's per-variant Zod definitions and interfaces, re-verified by hand when those shapes change.
  MathNum: {
    type: 'object',
    properties: {
      kind: { type: 'string', const: 'num' },
      numerator: { type: 'string', pattern: '^(0|-?[1-9]\\d*)$' },
      denominator: { type: 'string', pattern: '^[1-9]\\d*$' },
    },
    required: ['kind', 'numerator', 'denominator'],
    additionalProperties: false,
  },
  MathQty: {
    type: 'object',
    properties: {
      kind: { type: 'string', const: 'qty' },
      value: { $ref: '#/$defs/ExactRational' },
      unit: { type: 'string' },
      uncertainty: { $ref: '#/$defs/MathUncertainty' },
    },
    required: ['kind', 'value', 'unit'],
    additionalProperties: false,
  },
  MathSym: {
    type: 'object',
    properties: {
      kind: { type: 'string', const: 'sym' },
      id: { type: 'string' },
    },
    required: ['kind', 'id'],
    additionalProperties: false,
  },
  MathApp: {
    type: 'object',
    properties: {
      kind: { type: 'string', const: 'app' },
      operator: { type: 'string' },
      args: { type: 'array', items: { $ref: '#/$defs/MathExpression' } },
    },
    required: ['kind', 'operator', 'args'],
    additionalProperties: false,
  },
  MathSum: mathBinderDef('sum'),
  MathProd: mathBinderDef('prod'),
  MathMatrix: {
    type: 'object',
    properties: {
      kind: { type: 'string', const: 'matrix' },
      rows: { type: 'array', items: { type: 'array', items: { $ref: '#/$defs/MathExpression' } } },
    },
    required: ['kind', 'rows'],
    additionalProperties: false,
  },
  MathUnparsed: {
    type: 'object',
    properties: {
      kind: { type: 'string', const: 'unparsed' },
      latex: { type: 'string' },
    },
    required: ['kind', 'latex'],
    additionalProperties: false,
  },
  // MathExpression itself (src/math.ts): `MathNum | MathQty | MathSym | MathApp | MathSum | MathProd | MathMatrix | MathUnparsed`, in that exact declared order.
  MathExpression: {
    oneOf: [
      { $ref: '#/$defs/MathNum' },
      { $ref: '#/$defs/MathQty' },
      { $ref: '#/$defs/MathSym' },
      { $ref: '#/$defs/MathApp' },
      { $ref: '#/$defs/MathSum' },
      { $ref: '#/$defs/MathProd' },
      { $ref: '#/$defs/MathMatrix' },
      { $ref: '#/$defs/MathUnparsed' },
    ],
  },
};
