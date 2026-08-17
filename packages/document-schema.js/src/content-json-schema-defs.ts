import type { z } from 'zod';
import { schemaUriFor } from './schema-io';

// The hand-authored JSON Schema $defs fragments spliced into content-document.schema.json's `override()` callback (scripts/generate-json-schemas.mjs), lifted out into their own src module rather than staying inline in that script. The reason is single-sourcing, not tidiness: this exact object needs to be reachable from two places that cannot share an import graph --
//
//   1. scripts/generate-json-schemas.mjs itself, which only ever runs against the freshly-built ../dist/ (it imports every other schema it needs the same way), so it imports CONTENT_DEFS from '../dist/content-json-schema-defs.js', the file tsdown emits for this module (entry: 'src/**/*.ts', one dist file per src file -- see tsdown.config.ts).
//   2. content-json-schema-defs.test.ts (src/, run directly by vitest's "unit" project against source, never against dist), which imports this exact same CONTENT_DEFS value straight from here and asserts it stays byte-for-byte in step with a live z.toJSONSchema() call over each fragment's real exported Zod schema counterpart (ContentParagraphSchema, ContentRunSchema, ContentListMembershipSchema, ContentImageBlockSchema, ContentPageBreakSchema, ColorSchema, BoxSchema, AlignmentSchema, ContentStrokeStyleSchema, ContentBorderSchema, ContentCellBordersSchema) -- see that test file's own top comment for why this is the only structural defence this generator has against silently drifting away from the schemas it's meant to describe.
//
// If CONTENT_DEFS stayed inline in the .mjs script, only path 1 above would work: the script imports Zod schemas exclusively from '../dist/index.js' (a build artefact that may not exist, and per eslint.config.ts/tsconfig.json is deliberately excluded from both linting and typechecking, matching test/smoke.test.mjs's own precedent) -- a test that has to import through that path would only ever run after a build, which `pnpm test` (the "unit" vitest project, run standalone in CI's own "test" job, with no build step beforehand) never guarantees. Living here instead, this is an ordinary, fully typechecked and linted src module like any other -- CONTENT_DEFS just happens to be consumed by a script as well as by the package's own test suite.
//
// The fragments below still cover exactly what scripts/generate-json-schemas.mjs's own top-of-file comment already explains: ContentBlockSchema, ContentEmbeddedObjectSchema, and MathMlNodeSchema are z.custom() predicates z.toJSONSchema() cannot introspect at all (recursion the pinned Zod version's z.lazy() can't express -- see src/content.ts's isContentBlock/isContentEmbeddedObject and src/mathml.ts's isMathMlNode), so every schema reachable only through one of those three is transcribed by hand here, field-for-field, from the real Zod object definitions. Anything transcribed here that DOES have a real, non-custom, exported Zod schema counterpart is exactly what content-json-schema-defs.test.ts holds to a live z.toJSONSchema() comparison; re-verify the rest (ContentTableCell/ContentTableRow/ContentTable, ContentEmbeddedObjectBlock, MathMlElement/MathMlNode) against src/content.ts/src/mathml.ts by hand whenever those files' field shapes change, exactly as before.

type JsonSchema = z.core.JSONSchema.JSONSchema;

// Zod's own `.int()` bag range (node_modules/zod/v4/core/json-schema-processors.js's numberProcessor), reproduced verbatim wherever a hand-authored integer field below mirrors a real `z.number().int()...` field -- confirmed empirically against ContentListMembershipSchema.level and ContentTableCellSchema.colSpan/rowSpan.
export const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

export const EMBEDDED_OBJECT_KINDS = ['formula', 'wordprocessing', 'presentation', 'spreadsheet', 'drawing'];

// The genuine cycle back to a whole ContentDocument: ContentEmbeddedObject(Block)'s own `document` field. Resolved once here since both the ContentEmbeddedObjectBlock fragment below and scripts/generate-json-schemas.mjs's own override() branch for the standalone ContentEmbeddedObjectSchema need the identical URI.
export const CONTENT_DOCUMENT_URI = schemaUriFor('ContentDocument');

// -- Hand-authored $defs, spliced into content-document.schema.json only (via scripts/generate-json-schemas.mjs's own ContentDocumentSchema override branch) --
//
// The fragments below are transcribed by hand, field-for-field, from src/content.ts's real Zod object definitions (ContentParagraphSchema, ContentTableSchema/ContentTableRowSchema/ContentTableCellSchema, ContentImageBlockSchema, ContentPageBreakSchema, ContentRunSchema, ContentListMembershipSchema, ColorSchema, BoxSchema, LayoutFrameSchema, AlignmentSchema, ContentStrokeStyleSchema, ContentBorderSchema, ContentCellBordersSchema -- each cross-checked directly against a real z.toJSONSchema() call over that exact exported schema, and the ones with a real, non-recursive, non-custom counterpart are held to that comparison as a running test by content-json-schema-defs.test.ts) plus the ContentEmbeddedObject/ContentEmbeddedObjectBlock TS interfaces, which have no exported z.object() counterpart at all (both are validated only via the isContentEmbeddedObject*() z.custom() guards). Re-verify this block against src/content.ts whenever that file's field shapes change -- nothing here is generated or checked against the real schemas at build time, other than the twelve leaf/near-leaf fragments the regression test below does cover.
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
      numId: { type: 'string' },
      level: { type: 'integer', minimum: 0, maximum: MAX_SAFE_INTEGER },
    },
    required: ['numId', 'level'],
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
};
