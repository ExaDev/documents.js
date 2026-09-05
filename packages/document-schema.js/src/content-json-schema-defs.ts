import { z } from "zod";
import { SI_BASE_DIMENSIONS } from "./math";
import {
  MathMlAttributeSchema,
  MathMlElementSchema,
  MathMlNodeSchema,
} from "./mathml";
import { schemaUriFor } from "./schema-io";

// The hand-authored JSON Schema $defs fragments spliced into content-document.schema.json's `override()` callback (scripts/generate-json-schemas.mjs), lifted out into their own src module rather than staying inline in that script. The reason is single-sourcing, not tidiness: this exact object needs to be reachable from two places that cannot share an import graph --
//
//   1. scripts/generate-json-schemas.mjs itself, which only ever runs against the freshly-built ../dist/ (it imports every other schema it needs the same way), so it imports CONTENT_DEFS from '../dist/content-json-schema-defs.js', the file tsdown emits for this module (entry: 'src/**/*.ts', one dist file per src file -- see tsdown.config.ts).
//   2. content-json-schema-defs.test.ts (src/, run directly by vitest's "unit" project against source, never against dist), which imports this exact same CONTENT_DEFS value straight from here and asserts it stays byte-for-byte in step with a live z.toJSONSchema() call over each fragment's real exported Zod schema counterpart (ContentParagraphSchema, ContentRunSchema, ContentListMembershipSchema, ContentImageBlockSchema, ContentPageBreakSchema, ColorSchema, BoxSchema, LayoutFrameSchema, PageSizeSchema, MarginsSchema, AlignmentSchema, ContentStrokeStyleSchema, ContentBorderSchema, ContentCellBordersSchema, the package tree's non-recursive descriptors and anchors from src/package-node.ts: SectionDescriptorSchema, SlideDescriptorSchema, SheetDescriptorSchema, DrawPageDescriptorSchema, ShapeDescriptorSchema, HeadingParagraphSchema, ListParagraphSchema, the sheet grid and vector leaves from src/content.ts: ContentSheetCellSchema, ContentCellValueSchema, ContentSheetCellCommentSchema, ContentSheetColumnSchema, ContentSheetRowSchema, ContentSheetPrintSettingsSchema, ContentSheetPrintRangeSchema, ContentSheetRepeatRangeSchema, ContentSheetImageSchema, ContentStrokeSchema, ContentPathPointSchema, ContentPathSegmentSchema, ContentSubpathSchema, ContentVectorSchema, and the definitions facility from src/definitions.ts: StyleParagraphPropertiesSchema, StyleRunPropertiesSchema, StyleEntrySchema, DefinitionEntrySchema, the whole construct descriptor vocabulary from src/construct.ts: ContentControlDescriptorSchema, FieldDescriptorSchema, AnchorDescriptorSchema, LinkTargetSchema, LinkDescriptorSchema, ProvenanceDescriptorSchema, DivisionSourceSchema, DivisionDescriptorSchema, ConstructDescriptorSchema, the flat form's two construct boundary markers from src/content.ts: ContentConstructStartSchema, ContentConstructEndSchema, the quarantined residue value from src/source.ts: SourceResidueSchema, plus the non-recursive math leaves from src/math.ts: ExactRationalSchema, DimensionVectorSchema, MathPresentationSchema, MathProvenanceSchema, MathUncertaintySchema, MathNumSchema, MathQtySchema, MathSymSchema, MathUnparsedSchema, MathSymbolEntrySchema, MathUnitSchema, MathNormalisationContextSchema, SymbolTableSchema) -- see that test file's own top comment for why this is the only structural defence this generator has against silently drifting away from the schemas it's meant to describe.
//
// If CONTENT_DEFS stayed inline in the .mjs script, only path 1 above would work: the script imports Zod schemas exclusively from '../dist/index.js' (a build artefact that may not exist, and per eslint.config.ts/tsconfig.json is deliberately excluded from both linting and typechecking, matching test/smoke.test.mjs's own precedent) -- a test that has to import through that path would only ever run after a build, which `pnpm test` (the "unit" vitest project, run standalone in CI's own "test" job, with no build step beforehand) never guarantees. Living here instead, this is an ordinary, fully typechecked and linted src module like any other -- CONTENT_DEFS just happens to be consumed by a script as well as by the package's own test suite.
//
// The fragments below still cover exactly what scripts/generate-json-schemas.mjs's own top-of-file comment already explains: ContentBlockSchema, ContentEmbeddedObjectSchema, and MathExpressionSchema are z.custom() predicates z.toJSONSchema() cannot introspect at all (recursion the pinned Zod version's z.lazy() can't express -- see src/content.ts's isContentBlock/isContentEmbeddedObject and src/math.ts's isMathExpression), so every schema reachable only through one of those three is transcribed by hand here, field-for-field, from the real Zod object definitions. MathMlNodeSchema left that set in ExaDev/documents.js#937: it is a real, self-recursive z.discriminatedUnion() now (src/mathml.ts), so CONTENT_DEFS.MathMlAttribute/MathMlElement/MathMlNode are lazy `get` accessors declared in their own field position inside this file's own CONTENT_DEFS object literal (not spliced in after that literal closes) computing that live z.toJSONSchema() call on first read instead of transcribing them -- lazy rather than a plain computed spread so a bare import of document-schema.js never pays for the conversion, since every codec in the workspace imports this package and is held to Worker-isomorphism. The package tree added its own opaque set in the 4.0.0 major: DocumentTreeSchema's children reach the tree's per-kind group schemas (src/package-node.ts, all z.custom over recursive guards), so the whole TreeNode vocabulary -- container descriptors, anchor paragraphs, the nine group wrappers (the seven of 4.0.0 plus 4.1.0's two construct groups), and the sheet-image/vector leaves -- is transcribed here too, and the generator splices CONTENT_DEFS into document-tree.schema.json as well as content-document.schema.json so both files resolve their local #/$defs pointers without depending on each other's file layout (the one deliberate cross-file ref stays $defs.ContentEmbeddedObject(Block)'s document pointer, CONTENT_DOCUMENT_URI). Three further schemas are transcribed despite being real z.objects themselves: ContentFormulaSchema (its `content` field still reaches the opaque MathExpressionSchema node, exactly like ContentTableCellSchema's blocks -- its `mathml` field reaches the now-real MathMlNodeSchema, but the fragment stays hand-transcribed as a whole because of the field that doesn't), SymbolTableSchema (transcribed so each ContentDocument arm's symbolTable field is one named $ref rather than five inlined copies of the whole unit-registry subtree), and now StyleEntrySchema/DefinitionEntrySchema (same five-copies reason for the package arms' styles/definitions fields) -- the generator's override() replaces each with a $ref to its fragment here. Anything transcribed here that DOES have a real, non-custom, exported Zod schema counterpart is exactly what content-json-schema-defs.test.ts holds to a live z.toJSONSchema() comparison -- which is every construct descriptor fragment, since a descriptor is a plain z.strictObject reaching no opaque node, plus MathMlAttribute/MathMlElement/MathMlNode now that they are generated rather than transcribed; re-verify the rest (ContentTableCell/ContentTableRow/ContentTable, ContentEmbeddedObject(Block), the two block unions -- ContentBlock and the tree's marker-free TreeBlockLeaf -- the nine group wrappers, MathApp/MathSum/MathProd/MathMatrix/MathExpression, ContentFormula) against src/content.ts/src/package-node.ts/src/math.ts by hand whenever those files' field shapes change, exactly as before.

type JsonSchema = z.core.JSONSchema.JSONSchema;

// Zod's own `.int()` bag range (node_modules/zod/v4/core/json-schema-processors.js's numberProcessor), reproduced verbatim wherever a hand-authored integer field below mirrors a real `z.number().int()...` field -- confirmed empirically against ContentListMembershipSchema.level and ContentTableCellSchema.colSpan/rowSpan.
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

// MathMlAttribute/MathMlElement/MathMlNode (src/mathml.ts), computed from a live z.toJSONSchema() call rather than transcribed by hand: MathMlNodeSchema stopped being a z.custom() node in ExaDev/documents.js#937, so it introspects cleanly now. The `#/$defs/<id>` uri scheme matches every other cross-reference CONTENT_DEFS's own fragments use, and reproduces the identical nested-$ref shape (MathMlElement.children and MathMlNode's own element variant pointing back at each other by name rather than inlining) that content-json-schema-defs.test.ts's own live-comparison registry confirms empirically against CONTENT_DEFS's own value -- see that file's top comment for the same construction and for why that comparison is a generation-determinism check for these three ids rather than an independent drift check.
//
// Computed lazily rather than at module load. This module is re-exported wholesale from src/index.ts (`export * from "./content-json-schema-defs"`), so an eager, at-module-load computation here would make every consumer of document-schema.js -- a package every codec in the workspace depends on, held to Worker-isomorphism -- pay for this z.toJSONSchema() call the moment it imported the package, whether or not it ever read $defs.MathMlAttribute/Element/Node; ExaDev/documents.js#937's z.lazy() rewrite landed the deferral alongside MathMlNodeSchema's own recursion, so no released version of this package ever paid that cost. getMathMlJsonSchemas() below builds the registry and runs the conversion at most once, the first time any of the three `get MathMlAttribute()`/`get MathMlElement()`/`get MathMlNode()` accessors CONTENT_DEFS's own object literal declares further down (in their original field position, not spread in as plain values -- see that literal's own comment) is actually read, and every later read reuses the cached result.
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

// Strips the $schema/$id root markers z.toJSONSchema() stamps onto every registry entry (each is generated as its own standalone root) -- an artefact of generation, not a real structural difference from a fragment nested inside another schema's own $defs, matching content-json-schema-defs.test.ts's own withoutRootMarkers.
function mathMlDef(
  id: "MathMlAttribute" | "MathMlElement" | "MathMlNode",
): JsonSchema {
  const generated = getMathMlJsonSchemas()[id];
  if (generated === undefined) {
    throw new Error(
      `z.toJSONSchema() produced no schema for registered id "${id}"`,
    );
  }
  const stripped = { ...generated };
  delete stripped.$schema;
  delete stripped.$id;
  return stripped;
}

// Called from each of CONTENT_DEFS's own `get MathMlAttribute()`/`get MathMlElement()`/`get MathMlNode()` accessors (see that object literal further down), never before CONTENT_DEFS itself has finished being constructed: a getter's body only runs when something later reads the property, strictly after the `export const CONTENT_DEFS = {...}` statement below has completed, so referencing CONTENT_DEFS by name here is safe despite this function being declared above it -- the same forward-reference-inside-a-deferred-closure pattern ordinary mutual recursion between top-level functions already relies on. Redefines CONTENT_DEFS's own property as a plain cached value on first call so the underlying z.toJSONSchema() call and this stripping work run at most once per id, and every read after the first is a plain property lookup with no getter overhead at all.
function cacheMathMlDef(
  id: "MathMlAttribute" | "MathMlElement" | "MathMlNode",
): JsonSchema {
  const value = mathMlDef(id);
  Object.defineProperty(CONTENT_DEFS, id, {
    value,
    enumerable: true,
    configurable: true,
    writable: false,
  });
  return value;
}

// The two binder variants (MathSum/MathProd) differ only in their kind discriminant -- one builder rather than two copies of the same twelve-line fragment, so a binder-field change lands in both or fails the hand re-verification visibly in the diff.
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

// -- Hand-authored $defs, spliced into content-document.schema.json only (via scripts/generate-json-schemas.mjs's own ContentDocumentSchema override branch) --
//
// The fragments below are transcribed by hand, field-for-field, from src/content.ts's real Zod object definitions (ContentParagraphSchema, ContentTableSchema/ContentTableRowSchema/ContentTableCellSchema, ContentImageBlockSchema, ContentPageBreakSchema, ContentRunSchema, ContentListMembershipSchema, ColorSchema, BoxSchema, LayoutFrameSchema, AlignmentSchema, ContentStrokeStyleSchema, ContentBorderSchema, ContentCellBordersSchema -- each cross-checked directly against a real z.toJSONSchema() call over that exact exported schema, and the ones with a real, non-recursive, non-custom counterpart are held to that comparison as a running test by content-json-schema-defs.test.ts) plus the ContentEmbeddedObject/ContentEmbeddedObjectBlock TS interfaces, which have no exported z.object() counterpart at all (both are validated only via the isContentEmbeddedObject*() z.custom() guards), plus the math value schemas of src/math.ts (the semantic half of the two-layer formula model -- see that file's own top comment for how the layers divide). Re-verify this block against src/content.ts/src/math.ts whenever those files' field shapes change -- nothing here is generated or checked against the real schemas at build time, other than the leaf/near-leaf fragments the regression test below does cover.
export const CONTENT_DEFS: Record<string, JsonSchema> = {
  Color: {
    type: "object",
    properties: {
      r: { type: "number", minimum: 0, maximum: 1 },
      g: { type: "number", minimum: 0, maximum: 1 },
      b: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["r", "g", "b"],
    additionalProperties: false,
  },
  Box: {
    type: "object",
    properties: {
      xPt: { type: "number" },
      yPt: { type: "number" },
      widthPt: { type: "number", minimum: 0 },
      heightPt: { type: "number", minimum: 0 },
    },
    required: ["xPt", "yPt", "widthPt", "heightPt"],
    additionalProperties: false,
  },
  LayoutFrame: {
    type: "object",
    properties: {
      pageIndex: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      xPt: { type: "number" },
      yPt: { type: "number" },
      widthPt: { type: "number", minimum: 0 },
      heightPt: { type: "number", minimum: 0 },
    },
    required: ["pageIndex", "xPt", "yPt", "widthPt", "heightPt"],
    additionalProperties: false,
  },
  Alignment: {
    type: "string",
    enum: ["left", "center", "right", "justify"],
  },
  // The quarantined residue channel (src/source.ts): one `source: { format, xml }` value riding every content node and construct descriptor, including division since ExaDev/documents.js#743 renamed its external-chapter link field to `linked`, and the package root's per-key table. A real, non-recursive Zod schema, so this fragment is held to the live z.toJSONSchema() comparison by content-json-schema-defs.test.ts like the descriptors beside it.
  SourceResidue: {
    type: "object",
    properties: {
      format: {
        type: "string",
        enum: [
          "docx",
          "pptx",
          "xlsx",
          "odt",
          "ods",
          "odp",
          "odg",
          "odm",
          "odb",
          "odf",
          "markdown",
          "pdf",
          "epub",
          "rtf",
        ],
      },
      xml: { type: "string" }, // opaque text -- validation stops at "is a string"; everything about the content is the producer's to know
    },
    required: ["format", "xml"],
    additionalProperties: false,
  },
  ContentStrokeStyle: {
    type: "string",
    enum: ["solid", "dashed", "dotted", "double"],
  },
  ContentBorder: {
    type: "object",
    properties: {
      color: { $ref: "#/$defs/Color" },
      widthPt: { type: "number", exclusiveMinimum: 0 },
      style: { $ref: "#/$defs/ContentStrokeStyle" }, // absent means 'solid'
    },
    required: ["color", "widthPt"],
    additionalProperties: false,
  },
  ContentCellBorders: {
    type: "object",
    properties: {
      left: { $ref: "#/$defs/ContentBorder" },
      right: { $ref: "#/$defs/ContentBorder" },
      top: { $ref: "#/$defs/ContentBorder" },
      bottom: { $ref: "#/$defs/ContentBorder" },
      diagonalUp: { $ref: "#/$defs/ContentBorder" }, // bottom-left to top-right
      diagonalDown: { $ref: "#/$defs/ContentBorder" }, // top-left to bottom-right
    },
    additionalProperties: false,
  },
  ContentListMembership: {
    type: "object",
    properties: {
      numId: { type: "string" }, // optional in the Zod source -- depth-only list membership (OOXML drawing paragraphs) carries no numbering identity
      level: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      checked: { type: "boolean" }, // a GFM task-list item's checkbox state -- see src/content.ts's own field comment
      itemId: { type: "string" }, // the identity of ONE list item, distinguishing "one item, several blocks" from sibling items sharing a numId/level -- see src/content.ts's own field comment
      format: {
        type: "string",
        enum: [
          "bullet",
          "decimal",
          "lowerLetter",
          "upperLetter",
          "lowerRoman",
          "upperRoman",
        ],
      }, // the item's own numbering format -- see src/content.ts's own field comment
    },
    required: ["level"],
    additionalProperties: false,
  },
  ContentRun: {
    type: "object",
    properties: {
      text: { type: "string" },
      bold: { type: "boolean" },
      italic: { type: "boolean" },
      underline: { type: "boolean" },
      strike: { type: "boolean" },
      fontFamily: { type: "string" },
      sizePt: { type: "number", exclusiveMinimum: 0 },
      color: { $ref: "#/$defs/Color" },
      hyperlink: { type: "string" }, // resolved external URI
      verticalAlign: { type: "string", enum: ["superscript", "subscript"] },
      direction: { type: "string", enum: ["ltr", "rtl"] }, // RTF's \rtlch/\ltrch scope -- see src/content.ts's own field comment
      sourcePath: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
    },
    required: ["text"],
    additionalProperties: false,
  },
  // A run-scoped construct extent (src/content.ts's RunConstructExtentSchema): one construct covering a sub-sequence of one paragraph's runs, as a descriptor plus a half-open run range. A plain z.object reaching only the strict-object descriptor vocabulary, so it is held to the live comparison by content-json-schema-defs.test.ts.
  RunConstructExtent: {
    type: "object",
    properties: {
      descriptor: { $ref: "#/$defs/ConstructDescriptor" },
      startRun: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      endRun: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
    },
    required: ["descriptor", "startRun", "endRun"],
    additionalProperties: false,
  },
  ContentParagraph: {
    type: "object",
    properties: {
      kind: { type: "string", const: "paragraph" },
      runs: { type: "array", items: { $ref: "#/$defs/ContentRun" } },
      constructs: {
        type: "array",
        items: { $ref: "#/$defs/RunConstructExtent" },
      }, // the run-scoped construct extents this paragraph carries -- see src/content.ts's own field comment for the block-marker/run-extent scope split
      styleId: { type: "string" }, // w:pStyle/@w:val, e.g. 'Heading1'
      codeLanguage: { type: "string" }, // the source-format language identifier of a code-styled block -- see src/content.ts's own field comment
      preformatted: { type: "boolean" }, // whitespace inside this paragraph's own runs is significant and must survive verbatim -- see src/content.ts's own field comment
      headingLevel: {
        type: "integer",
        exclusiveMinimum: 0,
        maximum: MAX_SAFE_INTEGER,
      }, // canonical, format-agnostic heading depth -- see src/content.ts's own field comment
      alignment: { $ref: "#/$defs/Alignment" },
      list: { $ref: "#/$defs/ContentListMembership" },
      spacingBeforePt: { type: "number" },
      spacingAfterPt: { type: "number" },
      lineSpacing: { type: "number", exclusiveMinimum: 0 }, // multiple of single line height
      indentLeftPt: { type: "number" },
      indentRightPt: { type: "number" },
      indentFirstLinePt: { type: "number" },
      direction: { type: "string", enum: ["ltr", "rtl"] }, // RTF's \rtlpar/\ltrpar scope -- see src/content.ts's own field comment
      pageBreakBefore: { type: "boolean" }, // explicit page boundaries a paragraph style forces around its own paragraph
      pageBreakAfter: { type: "boolean" },
      sourcePath: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
    },
    required: ["kind", "runs"],
    additionalProperties: false,
  },
  ContentImageBlock: {
    type: "object",
    properties: {
      kind: { type: "string", const: "image" },
      format: { type: "string", enum: ["png", "jpeg", "svg", "gif"] },
      base64: { type: "string" },
      widthPt: { type: "number", exclusiveMinimum: 0 },
      heightPt: { type: "number", exclusiveMinimum: 0 },
      altText: { type: "string" },
      sourcePath: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
    },
    required: ["kind", "format", "base64", "widthPt", "heightPt"],
    additionalProperties: false,
  },
  ContentPageBreak: {
    type: "object",
    properties: {
      kind: { type: "string", const: "pageBreak" },
      sourcePath: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
    },
    required: ["kind"],
    additionalProperties: false,
  },
  // ContentTableCellSchema/ContentTableRowSchema/ContentTableSchema ARE real, exported z.object() schemas -- but ContentTableCellSchema.blocks is z.array(ContentBlockSchema), which drags in the opaque z.custom() node the moment Zod tries to convert any of the three. Reproduced by hand here instead, for the same reason as everything else in this block. Deliberately not covered by content-json-schema-defs.test.ts's own live comparison: doing so properly needs the same ContentBlockSchema-to-$ref override the real generator applies via a registry, which is out of this fragment's own self-contained scope (see that test file's own top comment).
  ContentTableCell: {
    type: "object",
    properties: {
      blocks: { type: "array", items: { $ref: "#/$defs/ContentBlock" } },
      colSpan: {
        type: "integer",
        exclusiveMinimum: 0,
        maximum: MAX_SAFE_INTEGER,
      },
      rowSpan: {
        type: "integer",
        exclusiveMinimum: 0,
        maximum: MAX_SAFE_INTEGER,
      },
      background: { $ref: "#/$defs/Color" },
      borders: { $ref: "#/$defs/ContentCellBorders" },
      verticalAlign: { type: "string", enum: ["top", "center", "bottom"] },
      sourcePath: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
    },
    required: ["blocks"],
    additionalProperties: false,
  },
  ContentTableRow: {
    type: "object",
    properties: {
      // pptx tables carry an explicit row height (a:tr/@h); docx tables do not model one at the row level in the same way, so heightPt is undefined there (src/content.ts's own ContentTableRow comment).
      cells: { type: "array", items: { $ref: "#/$defs/ContentTableCell" } },
      heightPt: { type: "number", exclusiveMinimum: 0 },
      direction: { type: "string", enum: ["ltr", "rtl"] }, // RTF's \rtlrow/\ltrrow scope -- see src/content.ts's own field comment
    },
    required: ["cells"],
    additionalProperties: false,
  },
  ContentTable: {
    type: "object",
    properties: {
      kind: { type: "string", const: "table" },
      rows: { type: "array", items: { $ref: "#/$defs/ContentTableRow" } },
      // Pre-existing discrepancy, not fixed here: ContentTableSchema.columnWidthsPt is z.array(z.number().positive()), stricter than isContentBlock's own runtime guard (src/content.ts), which only checks `typeof w === 'number'` for each width in its 'table' branch. This fragment matches the stricter declared Zod schema, not the looser guard -- flagged, not silently normalized away.
      columnWidthsPt: {
        type: "array",
        items: { type: "number", exclusiveMinimum: 0 },
      },
      sourcePath: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
    },
    required: ["kind", "rows", "columnWidthsPt"],
    additionalProperties: false,
  },
  // ContentEmbeddedObjectBlock extends ContentEmbeddedObject (src/content.ts) with its own `kind` discriminant -- neither interface has an exported z.object() schema of its own (both are validated via the isContentEmbeddedObject/isContentEmbeddedObjectBlock z.custom() guards), so this fragment is transcribed directly from the two interface declarations.
  ContentEmbeddedObjectBlock: {
    type: "object",
    properties: {
      kind: { type: "string", const: "embeddedObject" },
      objectKind: { type: "string", enum: EMBEDDED_OBJECT_KINDS },
      document: { $ref: CONTENT_DOCUMENT_URI },
      frame: { $ref: "#/$defs/Box" },
      sourcePath: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
      // Cell-anchor position, all four optional -- only set on an embedded object held in a ContentSheetSchema.embeddedObjects array; mirrors ContentSheetImageSchema's own anchorRow/anchorColumn/offsetXPt/offsetYPt representation exactly (see schemas/content-document.schema.json's own ContentSheetImage fragment, generated -- not hand-transcribed -- since that schema is a real z.object()).
      anchorRow: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      anchorColumn: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      offsetXPt: { type: "number" },
      offsetYPt: { type: "number" },
    },
    required: ["kind", "objectKind", "document", "frame"],
    additionalProperties: false,
  },
  // The flat form's two construct boundary markers (src/content.ts): a matched pair bracketing the extent a construct spans, which is how a codec emits construct data into the one shape it actually produces. Both are real z.objects reaching no opaque node, so both are held to the live comparison by content-json-schema-defs.test.ts. Neither carries frames, sourcePath, or a style ref -- see the schemas' own comments for why a boundary has none of those facts to state.
  ContentConstructStart: {
    type: "object",
    properties: {
      kind: { type: "string", const: "constructStart" },
      descriptor: { $ref: "#/$defs/ConstructDescriptor" },
    },
    required: ["kind", "descriptor"],
    additionalProperties: false,
  },
  ContentConstructEnd: {
    type: "object",
    properties: {
      kind: { type: "string", const: "constructEnd" },
    },
    required: ["kind"],
    additionalProperties: false,
  },
  // ContentBlock itself (src/content.ts): `ContentParagraph | ContentTable | ContentImageBlock | ContentPageBreak | ContentEmbeddedObjectBlock | ContentConstructStart | ContentConstructEnd`, in that exact declared order.
  ContentBlock: {
    oneOf: [
      { $ref: "#/$defs/ContentParagraph" },
      { $ref: "#/$defs/ContentTable" },
      { $ref: "#/$defs/ContentImageBlock" },
      { $ref: "#/$defs/ContentPageBreak" },
      { $ref: "#/$defs/ContentEmbeddedObjectBlock" },
      { $ref: "#/$defs/ContentConstructStart" },
      { $ref: "#/$defs/ContentConstructEnd" },
    ],
  },
  // The block leaf of the package tree (src/package-node.ts's TreeBlockLeaf): every ContentBlock member except the two boundary markers, which the tree refuses because it carries a construct as a group instead. Its own fragment rather than a reuse of ContentBlock above, so the published schema forbids exactly what the runtime guards forbid -- a tree fragment pointing at ContentBlock would advertise marker leaves as legal to every non-TypeScript consumer while documentFromJson rejected them. A table cell's blocks keep pointing at ContentBlock: a table is one leaf, decomposition never descends into its cells, so a cell's list is flat in both encodings and a construct inside one is a marker pair there too.
  TreeBlockLeaf: {
    oneOf: [
      { $ref: "#/$defs/ContentParagraph" },
      { $ref: "#/$defs/ContentTable" },
      { $ref: "#/$defs/ContentImageBlock" },
      { $ref: "#/$defs/ContentPageBreak" },
      { $ref: "#/$defs/ContentEmbeddedObjectBlock" },
    ],
  },
  // -- The package tree (src/package-node.ts), reached through DocumentTreeSchema's children --
  //
  // Everything in this block is here because the tree's group schemas are z.custom() guards z.toJSONSchema() cannot walk, so the descriptors, anchors, leaves, and wrappers underneath them exist only as these fragments. The descriptors, anchors, and leaves have real exported Zod counterparts built from the content schemas by omit+extend, and content-json-schema-defs.test.ts holds each to a live comparison; only the seven group wrappers (recursive through their children arrays) and ContentEmbeddedObject (the z.custom-backed interface with no z.object at all) are hand-verified alone.
  PageSize: {
    type: "object",
    properties: {
      widthPt: { type: "number", exclusiveMinimum: 0 },
      heightPt: { type: "number", exclusiveMinimum: 0 },
    },
    required: ["widthPt", "heightPt"],
    additionalProperties: false,
  },
  Margins: {
    type: "object",
    properties: {
      topPt: { type: "number", minimum: 0 },
      rightPt: { type: "number", minimum: 0 },
      bottomPt: { type: "number", minimum: 0 },
      leftPt: { type: "number", minimum: 0 },
    },
    required: ["topPt", "rightPt", "bottomPt", "leftPt"],
    additionalProperties: false,
  },
  SectionDescriptor: {
    type: "object",
    properties: {
      pageSize: { $ref: "#/$defs/PageSize" },
      margins: { $ref: "#/$defs/Margins" },
      breakType: {
        type: "string",
        enum: ["nextPage", "continuous", "evenPage", "oddPage"],
      },
      source: { $ref: "#/$defs/SourceResidue" },
      kind: { type: "string", const: "section" },
    },
    required: ["pageSize", "margins", "kind"],
    additionalProperties: false,
  },
  SlideDescriptor: {
    type: "object",
    properties: {
      size: { $ref: "#/$defs/PageSize" },
      notes: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      kind: { type: "string", const: "slide" },
    },
    required: ["size", "notes", "kind"],
    additionalProperties: false,
  },
  SheetDescriptor: {
    type: "object",
    properties: {
      name: { type: "string" },
      cells: { type: "array", items: { $ref: "#/$defs/ContentSheetCell" } },
      columns: { type: "array", items: { $ref: "#/$defs/ContentSheetColumn" } },
      rows: { type: "array", items: { $ref: "#/$defs/ContentSheetRow" } },
      printSettings: { $ref: "#/$defs/ContentSheetPrintSettings" },
      dataValidations: {
        type: "array",
        items: { $ref: "#/$defs/ContentSheetDataValidation" },
      },
      conditionalFormats: {
        type: "array",
        items: { $ref: "#/$defs/ContentSheetConditionalFormat" },
      },
      source: { $ref: "#/$defs/SourceResidue" },
      kind: { type: "string", const: "sheet" },
    },
    required: ["name", "cells", "columns", "rows", "printSettings", "kind"],
    additionalProperties: false,
  },
  DrawPageDescriptor: {
    type: "object",
    properties: {
      size: { $ref: "#/$defs/PageSize" },
      source: { $ref: "#/$defs/SourceResidue" },
      kind: { type: "string", const: "drawPage" },
    },
    required: ["size", "kind"],
    additionalProperties: false,
  },
  // A shape group's node payload -- the one descriptor with no kind tag, since ContentShape carries none; identified structurally by its frame and insets. strictObject in the source (src/package-node.ts) is what rejects a raw flat ContentShape's blocks key here, matching additionalProperties: false plus blocks' absence.
  ShapeDescriptor: {
    type: "object",
    properties: {
      name: { type: "string" },
      frame: { $ref: "#/$defs/Box" },
      rotationDeg: { type: "number" },
      insetLeftPt: { type: "number", minimum: 0 },
      insetTopPt: { type: "number", minimum: 0 },
      insetRightPt: { type: "number", minimum: 0 },
      insetBottomPt: { type: "number", minimum: 0 },
      fontScale: { type: "number", exclusiveMinimum: 0 },
      lineSpacingReduction: { type: "number", minimum: 0 },
      paintOrder: { type: "number" },
      sourcePath: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
    },
    required: [
      "frame",
      "insetLeftPt",
      "insetTopPt",
      "insetRightPt",
      "insetBottomPt",
    ],
    additionalProperties: false,
  },
  // The heading-group anchor: ContentParagraphSchema's every field with headingLevel required (ContentParagraphSchema.extend in src/package-node.ts).
  HeadingParagraph: {
    type: "object",
    properties: {
      kind: { type: "string", const: "paragraph" },
      runs: { type: "array", items: { $ref: "#/$defs/ContentRun" } },
      constructs: {
        type: "array",
        items: { $ref: "#/$defs/RunConstructExtent" },
      },
      styleId: { type: "string" },
      codeLanguage: { type: "string" },
      preformatted: { type: "boolean" },
      headingLevel: {
        type: "integer",
        exclusiveMinimum: 0,
        maximum: MAX_SAFE_INTEGER,
      },
      alignment: { $ref: "#/$defs/Alignment" },
      list: { $ref: "#/$defs/ContentListMembership" },
      spacingBeforePt: { type: "number" },
      spacingAfterPt: { type: "number" },
      lineSpacing: { type: "number", exclusiveMinimum: 0 },
      indentLeftPt: { type: "number" },
      indentRightPt: { type: "number" },
      indentFirstLinePt: { type: "number" },
      direction: { type: "string", enum: ["ltr", "rtl"] },
      pageBreakBefore: { type: "boolean" }, // explicit page boundaries a paragraph style forces around its own paragraph
      pageBreakAfter: { type: "boolean" },
      sourcePath: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
    },
    required: ["kind", "runs", "headingLevel"],
    additionalProperties: false,
  },
  // The list-group anchor: ContentParagraphSchema's every field with list required.
  ListParagraph: {
    type: "object",
    properties: {
      kind: { type: "string", const: "paragraph" },
      runs: { type: "array", items: { $ref: "#/$defs/ContentRun" } },
      constructs: {
        type: "array",
        items: { $ref: "#/$defs/RunConstructExtent" },
      },
      styleId: { type: "string" },
      codeLanguage: { type: "string" },
      preformatted: { type: "boolean" },
      headingLevel: {
        type: "integer",
        exclusiveMinimum: 0,
        maximum: MAX_SAFE_INTEGER,
      },
      alignment: { $ref: "#/$defs/Alignment" },
      list: { $ref: "#/$defs/ContentListMembership" },
      spacingBeforePt: { type: "number" },
      spacingAfterPt: { type: "number" },
      lineSpacing: { type: "number", exclusiveMinimum: 0 },
      indentLeftPt: { type: "number" },
      indentRightPt: { type: "number" },
      indentFirstLinePt: { type: "number" },
      direction: { type: "string", enum: ["ltr", "rtl"] },
      pageBreakBefore: { type: "boolean" }, // explicit page boundaries a paragraph style forces around its own paragraph
      pageBreakAfter: { type: "boolean" },
      sourcePath: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
    },
    required: ["kind", "runs", "list"],
    additionalProperties: false,
  },
  ContentSheetCell: {
    type: "object",
    properties: {
      row: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      column: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      value: { $ref: "#/$defs/ContentCellValue" },
      formula: { type: "string" },
      displayText: { type: "string" },
      numberFormatCode: { type: "string" },
      runs: { type: "array", items: { $ref: "#/$defs/ContentRun" } },
      colSpan: {
        type: "integer",
        exclusiveMinimum: 0,
        maximum: MAX_SAFE_INTEGER,
      },
      rowSpan: {
        type: "integer",
        exclusiveMinimum: 0,
        maximum: MAX_SAFE_INTEGER,
      },
      background: { $ref: "#/$defs/Color" },
      borders: { $ref: "#/$defs/ContentCellBorders" },
      alignment: { $ref: "#/$defs/Alignment" },
      verticalAlignment: { type: "string", enum: ["top", "middle", "bottom"] },
      comment: { $ref: "#/$defs/ContentSheetCellComment" },
      sourcePath: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
    },
    required: ["row", "column", "value", "displayText"],
    additionalProperties: false,
  },
  // A cell's own computed/typed value, one variant per ODF office:value-type plus dateTime -- the ten-member discriminated union in declared order (src/content.ts's ContentCellValueSchema).
  ContentCellValue: {
    oneOf: [
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "number" },
          value: { type: "number" },
          exactValue: {
            type: "string",
            pattern: "^-?(0|[1-9]\\d*)(\\.\\d+)?$",
          },
        },
        required: ["kind", "value"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "percentage" },
          value: { type: "number" },
          exactValue: {
            type: "string",
            pattern: "^-?(0|[1-9]\\d*)(\\.\\d+)?$",
          },
        },
        required: ["kind", "value"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "currency" },
          value: { type: "number" },
          currency: { type: "string" },
          exactValue: {
            type: "string",
            pattern: "^-?(0|[1-9]\\d*)(\\.\\d+)?$",
          },
        },
        required: ["kind", "value"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "boolean" },
          value: { type: "boolean" },
        },
        required: ["kind", "value"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "date" },
          value: { type: "string" },
        },
        required: ["kind", "value"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "time" },
          value: { type: "string" },
        },
        required: ["kind", "value"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "dateTime" },
          value: { type: "string" },
        },
        required: ["kind", "value"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "string" },
          value: { type: "string" },
        },
        required: ["kind", "value"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "error" },
          value: { type: "string" },
        },
        required: ["kind", "value"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: { kind: { type: "string", const: "empty" } },
        required: ["kind"],
        additionalProperties: false,
      },
    ],
  },
  ContentSheetCellComment: {
    type: "object",
    properties: {
      text: { type: "string" },
      author: { type: "string" },
      createdAt: { type: "string" },
      replies: {
        type: "array",
        items: {
          type: "object",
          properties: { text: { type: "string" }, author: { type: "string" } },
          required: ["text"],
          additionalProperties: false,
        },
      },
    },
    required: ["text"],
    additionalProperties: false,
  },
  ContentSheetColumn: {
    type: "object",
    properties: {
      index: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      widthPt: { type: "number", exclusiveMinimum: 0 },
      hidden: { type: "boolean" },
    },
    required: ["index"],
    additionalProperties: false,
  },
  ContentSheetRow: {
    type: "object",
    properties: {
      index: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      heightPt: { type: "number", exclusiveMinimum: 0 },
      hidden: { type: "boolean" },
    },
    required: ["index"],
    additionalProperties: false,
  },
  ContentSheetPrintSettings: {
    type: "object",
    properties: {
      pageSize: { $ref: "#/$defs/PageSize" },
      margins: { $ref: "#/$defs/Margins" },
      printRange: { $ref: "#/$defs/ContentSheetPrintRange" },
      scalePercent: { type: "number", exclusiveMinimum: 0 },
      fitToPages: {
        type: "object",
        properties: {
          width: {
            type: "integer",
            exclusiveMinimum: 0,
            maximum: MAX_SAFE_INTEGER,
          },
          height: {
            type: "integer",
            exclusiveMinimum: 0,
            maximum: MAX_SAFE_INTEGER,
          },
        },
        required: ["width", "height"],
        additionalProperties: false,
      },
      repeatRows: { $ref: "#/$defs/ContentSheetRepeatRange" },
      repeatColumns: { $ref: "#/$defs/ContentSheetRepeatRange" },
      gridlines: { type: "boolean" },
      headers: { type: "boolean" },
      pageOrder: { type: "string", enum: ["downThenOver", "overThenDown"] },
      manualBreaks: {
        type: "object",
        properties: {
          rows: {
            type: "array",
            items: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
          },
          columns: {
            type: "array",
            items: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
          },
        },
        required: ["rows", "columns"],
        additionalProperties: false,
      },
    },
    required: ["pageSize", "margins", "gridlines", "headers", "pageOrder"],
    additionalProperties: false,
  },
  ContentSheetPrintRange: {
    type: "object",
    properties: {
      startRow: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      startColumn: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      endRow: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      endColumn: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
    },
    required: ["startRow", "startColumn", "endRow", "endColumn"],
    additionalProperties: false,
  },
  ContentSheetRepeatRange: {
    type: "object",
    properties: {
      start: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      end: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
    },
    required: ["start", "end"],
    additionalProperties: false,
  },
  // A rule's target range -- structurally identical to ContentSheetPrintRange above, kept separate since the two facts are unrelated (src/content.ts's own comment on ContentSheetRangeSchema).
  ContentSheetRange: {
    type: "object",
    properties: {
      startRow: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      startColumn: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      endRow: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      endColumn: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
    },
    required: ["startRow", "startColumn", "endRow", "endColumn"],
    additionalProperties: false,
  },
  SheetRuleOperator: {
    type: "string",
    enum: [
      "between",
      "notBetween",
      "equal",
      "notEqual",
      "greaterThan",
      "greaterThanOrEqual",
      "lessThan",
      "lessThanOrEqual",
    ],
  },
  ContentSheetDataValidation: {
    type: "object",
    properties: {
      ranges: { type: "array", items: { $ref: "#/$defs/ContentSheetRange" } },
      type: {
        type: "string",
        enum: [
          "whole",
          "decimal",
          "list",
          "date",
          "time",
          "textLength",
          "custom",
        ],
      },
      operator: { $ref: "#/$defs/SheetRuleOperator" },
      formula1: { type: "string" },
      formula2: { type: "string" },
      allowBlank: { type: "boolean" },
      showInputMessage: { type: "boolean" },
      promptTitle: { type: "string" },
      prompt: { type: "string" },
      showErrorMessage: { type: "boolean" },
      errorStyle: { type: "string", enum: ["stop", "warning", "information"] },
      errorTitle: { type: "string" },
      error: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
    },
    required: ["ranges", "type"],
    additionalProperties: false,
  },
  ContentSheetConditionalFormatStyle: {
    type: "object",
    properties: {
      textColor: { $ref: "#/$defs/Color" },
      background: { $ref: "#/$defs/Color" },
      source: { $ref: "#/$defs/SourceResidue" },
    },
    additionalProperties: false,
  },
  ContentSheetConditionalFormatValue: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["num", "percent", "max", "min", "formula", "percentile"],
      },
      value: { type: "string" },
    },
    required: ["type"],
    additionalProperties: false,
  },
  ContentSheetConditionalFormat: {
    oneOf: [
      {
        type: "object",
        properties: {
          type: { type: "string", const: "cellIs" },
          ranges: {
            type: "array",
            items: { $ref: "#/$defs/ContentSheetRange" },
          },
          priority: {
            type: "integer",
            minimum: -MAX_SAFE_INTEGER,
            maximum: MAX_SAFE_INTEGER,
          },
          stopIfTrue: { type: "boolean" },
          source: { $ref: "#/$defs/SourceResidue" },
          operator: { $ref: "#/$defs/SheetRuleOperator" },
          formula1: { type: "string" },
          formula2: { type: "string" },
          style: { $ref: "#/$defs/ContentSheetConditionalFormatStyle" },
        },
        required: ["type", "ranges", "operator", "formula1"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["containsText", "notContainsText", "beginsWith", "endsWith"],
          },
          ranges: {
            type: "array",
            items: { $ref: "#/$defs/ContentSheetRange" },
          },
          priority: {
            type: "integer",
            minimum: -MAX_SAFE_INTEGER,
            maximum: MAX_SAFE_INTEGER,
          },
          stopIfTrue: { type: "boolean" },
          source: { $ref: "#/$defs/SourceResidue" },
          text: { type: "string" },
          style: { $ref: "#/$defs/ContentSheetConditionalFormatStyle" },
        },
        required: ["type", "ranges", "text"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [
              "containsBlanks",
              "notContainsBlanks",
              "containsErrors",
              "notContainsErrors",
              "uniqueValues",
              "duplicateValues",
            ],
          },
          ranges: {
            type: "array",
            items: { $ref: "#/$defs/ContentSheetRange" },
          },
          priority: {
            type: "integer",
            minimum: -MAX_SAFE_INTEGER,
            maximum: MAX_SAFE_INTEGER,
          },
          stopIfTrue: { type: "boolean" },
          source: { $ref: "#/$defs/SourceResidue" },
          style: { $ref: "#/$defs/ContentSheetConditionalFormatStyle" },
        },
        required: ["type", "ranges"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          type: { type: "string", const: "top10" },
          ranges: {
            type: "array",
            items: { $ref: "#/$defs/ContentSheetRange" },
          },
          priority: {
            type: "integer",
            minimum: -MAX_SAFE_INTEGER,
            maximum: MAX_SAFE_INTEGER,
          },
          stopIfTrue: { type: "boolean" },
          source: { $ref: "#/$defs/SourceResidue" },
          rank: { type: "number", exclusiveMinimum: 0 },
          percent: { type: "boolean" },
          bottom: { type: "boolean" },
          style: { $ref: "#/$defs/ContentSheetConditionalFormatStyle" },
        },
        required: ["type", "ranges", "rank"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          type: { type: "string", const: "aboveAverage" },
          ranges: {
            type: "array",
            items: { $ref: "#/$defs/ContentSheetRange" },
          },
          priority: {
            type: "integer",
            minimum: -MAX_SAFE_INTEGER,
            maximum: MAX_SAFE_INTEGER,
          },
          stopIfTrue: { type: "boolean" },
          source: { $ref: "#/$defs/SourceResidue" },
          aboveAverage: { type: "boolean" },
          equalAverage: { type: "boolean" },
          stdDev: {
            type: "integer",
            exclusiveMinimum: 0,
            maximum: MAX_SAFE_INTEGER,
          },
          style: { $ref: "#/$defs/ContentSheetConditionalFormatStyle" },
        },
        required: ["type", "ranges"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          type: { type: "string", const: "timePeriod" },
          ranges: {
            type: "array",
            items: { $ref: "#/$defs/ContentSheetRange" },
          },
          priority: {
            type: "integer",
            minimum: -MAX_SAFE_INTEGER,
            maximum: MAX_SAFE_INTEGER,
          },
          stopIfTrue: { type: "boolean" },
          source: { $ref: "#/$defs/SourceResidue" },
          timePeriod: {
            type: "string",
            enum: [
              "yesterday",
              "today",
              "tomorrow",
              "last7Days",
              "thisMonth",
              "lastMonth",
              "nextMonth",
              "thisWeek",
              "lastWeek",
              "nextWeek",
            ],
          },
          style: { $ref: "#/$defs/ContentSheetConditionalFormatStyle" },
        },
        required: ["type", "ranges", "timePeriod"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          type: { type: "string", const: "colorScale" },
          ranges: {
            type: "array",
            items: { $ref: "#/$defs/ContentSheetRange" },
          },
          priority: {
            type: "integer",
            minimum: -MAX_SAFE_INTEGER,
            maximum: MAX_SAFE_INTEGER,
          },
          stopIfTrue: { type: "boolean" },
          source: { $ref: "#/$defs/SourceResidue" },
          stops: {
            minItems: 2,
            maxItems: 3,
            type: "array",
            items: {
              type: "object",
              properties: {
                value: { $ref: "#/$defs/ContentSheetConditionalFormatValue" },
                color: { $ref: "#/$defs/Color" },
              },
              required: ["value", "color"],
              additionalProperties: false,
            },
          },
        },
        required: ["type", "ranges", "stops"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          type: { type: "string", const: "dataBar" },
          ranges: {
            type: "array",
            items: { $ref: "#/$defs/ContentSheetRange" },
          },
          priority: {
            type: "integer",
            minimum: -MAX_SAFE_INTEGER,
            maximum: MAX_SAFE_INTEGER,
          },
          stopIfTrue: { type: "boolean" },
          source: { $ref: "#/$defs/SourceResidue" },
          min: { $ref: "#/$defs/ContentSheetConditionalFormatValue" },
          max: { $ref: "#/$defs/ContentSheetConditionalFormatValue" },
          color: { $ref: "#/$defs/Color" },
          showValue: { type: "boolean" },
        },
        required: ["type", "ranges", "min", "max", "color"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          type: { type: "string", const: "iconSet" },
          ranges: {
            type: "array",
            items: { $ref: "#/$defs/ContentSheetRange" },
          },
          priority: {
            type: "integer",
            minimum: -MAX_SAFE_INTEGER,
            maximum: MAX_SAFE_INTEGER,
          },
          stopIfTrue: { type: "boolean" },
          source: { $ref: "#/$defs/SourceResidue" },
          iconSetType: { type: "string" },
          thresholds: {
            type: "array",
            items: { $ref: "#/$defs/ContentSheetConditionalFormatValue" },
          },
          reverse: { type: "boolean" },
          showValue: { type: "boolean" },
        },
        required: ["type", "ranges", "iconSetType", "thresholds"],
        additionalProperties: false,
      },
    ],
  },
  // A sheet-anchored image leaf: ContentImageBlockSchema's own fields plus the four required cell-anchor placement fields (ContentImageBlockSchema.extend, src/content.ts).
  ContentSheetImage: {
    type: "object",
    properties: {
      kind: { type: "string", const: "image" },
      format: { type: "string", enum: ["png", "jpeg", "svg", "gif"] },
      base64: { type: "string" },
      widthPt: { type: "number", exclusiveMinimum: 0 },
      heightPt: { type: "number", exclusiveMinimum: 0 },
      altText: { type: "string" },
      sourcePath: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
      anchorRow: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      anchorColumn: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      offsetXPt: { type: "number" },
      offsetYPt: { type: "number" },
    },
    required: [
      "kind",
      "format",
      "base64",
      "widthPt",
      "heightPt",
      "anchorRow",
      "anchorColumn",
      "offsetXPt",
      "offsetYPt",
    ],
    additionalProperties: false,
  },
  ContentStroke: {
    type: "object",
    properties: {
      color: { $ref: "#/$defs/Color" },
      widthPt: { type: "number", exclusiveMinimum: 0 },
      style: { $ref: "#/$defs/ContentStrokeStyle" },
    },
    required: ["color", "widthPt"],
    additionalProperties: false,
  },
  ContentPathPoint: {
    type: "object",
    properties: {
      xPt: { type: "number" },
      yPt: { type: "number" },
    },
    required: ["xPt", "yPt"],
    additionalProperties: false,
  },
  ContentPathSegment: {
    oneOf: [
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "line" },
          to: { $ref: "#/$defs/ContentPathPoint" },
        },
        required: ["kind", "to"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "cubic" },
          control1: { $ref: "#/$defs/ContentPathPoint" },
          control2: { $ref: "#/$defs/ContentPathPoint" },
          to: { $ref: "#/$defs/ContentPathPoint" },
        },
        required: ["kind", "control1", "control2", "to"],
        additionalProperties: false,
      },
    ],
  },
  ContentSubpath: {
    type: "object",
    properties: {
      start: { $ref: "#/$defs/ContentPathPoint" },
      segments: {
        type: "array",
        items: { $ref: "#/$defs/ContentPathSegment" },
      },
      closed: { type: "boolean" },
    },
    required: ["start", "segments", "closed"],
    additionalProperties: false,
  },
  // The textless vector primitives, in their declared variant order (rect / ellipse / line / path, src/content.ts's ContentVectorSchema).
  ContentVector: {
    oneOf: [
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "rect" },
          frame: { $ref: "#/$defs/Box" },
          rotationDeg: { type: "number" },
          fill: { $ref: "#/$defs/Color" },
          stroke: { $ref: "#/$defs/ContentStroke" },
          paintOrder: { type: "number" },
          sourcePath: { type: "string" },
          source: { $ref: "#/$defs/SourceResidue" },
          frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
        },
        required: ["kind", "frame"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "ellipse" },
          frame: { $ref: "#/$defs/Box" },
          rotationDeg: { type: "number" },
          fill: { $ref: "#/$defs/Color" },
          stroke: { $ref: "#/$defs/ContentStroke" },
          paintOrder: { type: "number" },
          sourcePath: { type: "string" },
          source: { $ref: "#/$defs/SourceResidue" },
          frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
        },
        required: ["kind", "frame"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "line" },
          from: { $ref: "#/$defs/ContentPathPoint" },
          to: { $ref: "#/$defs/ContentPathPoint" },
          stroke: { $ref: "#/$defs/ContentStroke" },
          paintOrder: { type: "number" },
          sourcePath: { type: "string" },
          source: { $ref: "#/$defs/SourceResidue" },
          frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
        },
        required: ["kind", "from", "to", "stroke"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "path" },
          frame: { $ref: "#/$defs/Box" },
          rotationDeg: { type: "number" },
          subpaths: {
            type: "array",
            items: { $ref: "#/$defs/ContentSubpath" },
          },
          fill: { $ref: "#/$defs/Color" },
          fillRule: { type: "string", enum: ["nonzero", "evenodd"] },
          stroke: { $ref: "#/$defs/ContentStroke" },
          paintOrder: { type: "number" },
          sourcePath: { type: "string" },
          source: { $ref: "#/$defs/SourceResidue" },
          frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
        },
        required: ["kind", "frame", "subpaths"],
        additionalProperties: false,
      },
    ],
  },
  // An embedded object on its own (the sheet-children leaf position) -- the same member fields as ContentEmbeddedObjectBlock above minus the block-level kind discriminant, transcribed from the ContentEmbeddedObject interface (src/content.ts), which has no z.object() counterpart at all.
  ContentEmbeddedObject: {
    type: "object",
    properties: {
      objectKind: { type: "string", enum: EMBEDDED_OBJECT_KINDS },
      document: { $ref: CONTENT_DOCUMENT_URI },
      frame: { $ref: "#/$defs/Box" },
      anchorRow: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      anchorColumn: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      offsetXPt: { type: "number" },
      offsetYPt: { type: "number" },
      source: { $ref: "#/$defs/SourceResidue" },
    },
    required: ["objectKind", "document", "frame"],
    additionalProperties: false,
  },
  // The nine group wrappers, hand-verified alone (recursive through their children arrays): `{ node, style?, children }` where children's permitted members are exactly that group kind's own child types (src/package-node.ts's per-kind guards) -- which is why every block-flow wrapper points at TreeBlockLeaf rather than ContentBlock: a construct is a group at these positions, never a boundary marker. A wordprocessing section's flow.
  SectionGroup: {
    type: "object",
    properties: {
      node: { $ref: "#/$defs/SectionDescriptor" },
      style: { type: "string" },
      children: {
        type: "array",
        items: {
          oneOf: [
            { $ref: "#/$defs/HeadingGroup" },
            { $ref: "#/$defs/ListGroup" },
            { $ref: "#/$defs/SectionConstructGroup" },
            { $ref: "#/$defs/TreeBlockLeaf" },
          ],
        },
      },
    },
    required: ["node", "children"],
    additionalProperties: false,
  },
  HeadingGroup: {
    type: "object",
    properties: {
      node: { $ref: "#/$defs/HeadingParagraph" },
      style: { type: "string" },
      children: {
        type: "array",
        items: {
          oneOf: [
            { $ref: "#/$defs/HeadingGroup" },
            { $ref: "#/$defs/ListGroup" },
            { $ref: "#/$defs/SectionConstructGroup" },
            { $ref: "#/$defs/TreeBlockLeaf" },
          ],
        },
      },
    },
    required: ["node", "children"],
    additionalProperties: false,
  },
  ListGroup: {
    type: "object",
    properties: {
      node: { $ref: "#/$defs/ListParagraph" },
      style: { type: "string" },
      children: {
        type: "array",
        items: {
          oneOf: [
            { $ref: "#/$defs/ListGroup" },
            { $ref: "#/$defs/ShapeConstructGroup" },
            { $ref: "#/$defs/TreeBlockLeaf" },
          ],
        },
      },
    },
    required: ["node", "children"],
    additionalProperties: false,
  },
  // A slide holds shape groups only, in shape order -- grouping never crosses a shape boundary (a slide's paragraphs across its shapes is the outline's lossy TOC projection, not a decomposition).
  SlideGroup: {
    type: "object",
    properties: {
      node: { $ref: "#/$defs/SlideDescriptor" },
      style: { type: "string" },
      children: { type: "array", items: { $ref: "#/$defs/ShapeGroup" } },
    },
    required: ["node", "children"],
    additionalProperties: false,
  },
  ShapeGroup: {
    type: "object",
    properties: {
      node: { $ref: "#/$defs/ShapeDescriptor" },
      style: { type: "string" },
      children: {
        type: "array",
        items: {
          oneOf: [
            { $ref: "#/$defs/ListGroup" },
            { $ref: "#/$defs/ShapeConstructGroup" },
            { $ref: "#/$defs/TreeBlockLeaf" },
          ],
        },
      },
    },
    required: ["node", "children"],
    additionalProperties: false,
  },
  // A sheet's children: its anchored images then its whole embedded documents, in that fixed order; the grid rides the sheet descriptor.
  SheetGroup: {
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
  },
  // A drawing page's children: shape groups then vector leaves, in that fixed order.
  DrawPageGroup: {
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
  },
  // The two construct group wrappers (src/package-node.ts), hand-verified alone for the same reason as the seven above -- their children arrays recurse back through the same per-flow child unions. One per block flow: the section-scoped variant admits heading groups, the shape-scoped one does not, exactly as SectionChild and ShapeChild differ. A list item's flow takes the shape-scoped variant, since ListChild and ShapeChild admit the same members.
  SectionConstructGroup: {
    type: "object",
    properties: {
      node: { $ref: "#/$defs/ConstructDescriptor" },
      style: { type: "string" },
      children: {
        type: "array",
        items: {
          oneOf: [
            { $ref: "#/$defs/HeadingGroup" },
            { $ref: "#/$defs/ListGroup" },
            { $ref: "#/$defs/SectionConstructGroup" },
            { $ref: "#/$defs/TreeBlockLeaf" },
          ],
        },
      },
    },
    required: ["node", "children"],
    additionalProperties: false,
  },
  ShapeConstructGroup: {
    type: "object",
    properties: {
      node: { $ref: "#/$defs/ConstructDescriptor" },
      style: { type: "string" },
      children: {
        type: "array",
        items: {
          oneOf: [
            { $ref: "#/$defs/ListGroup" },
            { $ref: "#/$defs/ShapeConstructGroup" },
            { $ref: "#/$defs/TreeBlockLeaf" },
          ],
        },
      },
    },
    required: ["node", "children"],
    additionalProperties: false,
  },
  // -- The construct descriptor vocabulary (src/construct.ts), the node payload of the two group wrappers above. Every fragment from here to ConstructDescriptor has a real, non-recursive, non-custom Zod counterpart, so all of them are held to the live z.toJSONSchema() comparison by content-json-schema-defs.test.ts rather than needing hand re-verification. --
  ContentControlDescriptor: {
    type: "object",
    properties: {
      kind: { type: "string", const: "contentControl" },
      controlType: {
        type: "string",
        enum: [
          "richText",
          "plainText",
          "checkbox",
          "dropDown",
          "comboBox",
          "date",
          "picture",
          "repeatingSection",
          "button",
          "index",
          "group",
        ],
      },
      tag: { type: "string" },
      alias: { type: "string" },
      lock: { type: "string", enum: ["content", "container", "both"] },
      value: { type: "string" },
      checked: { type: "boolean" },
      options: { type: "array", items: { type: "string" } },
      source: { $ref: "#/$defs/SourceResidue" },
    },
    required: ["kind", "controlType"],
    additionalProperties: false,
  },
  FieldDescriptor: {
    type: "object",
    properties: {
      kind: { type: "string", const: "field" },
      instruction: { type: "string" },
      cachedResult: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
    },
    required: ["kind", "instruction"],
    additionalProperties: false,
  },
  AnchorDescriptor: {
    type: "object",
    properties: {
      kind: { type: "string", const: "anchor" },
      anchorType: {
        type: "string",
        enum: ["bookmark", "footnote", "endnote", "comment"],
      },
      name: { type: "string" },
      definition: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
    },
    required: ["kind", "anchorType", "name"],
    additionalProperties: false,
  },
  LinkTarget: {
    oneOf: [
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "external" },
          uri: { type: "string" },
        },
        required: ["kind", "uri"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "internal" },
          anchor: { type: "string" },
        },
        required: ["kind", "anchor"],
        additionalProperties: false,
      },
    ],
  },
  LinkDescriptor: {
    type: "object",
    properties: {
      kind: { type: "string", const: "link" },
      target: { $ref: "#/$defs/LinkTarget" },
      title: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
    },
    required: ["kind", "target"],
    additionalProperties: false,
  },
  ProvenanceDescriptor: {
    type: "object",
    properties: {
      kind: { type: "string", const: "provenance" },
      change: {
        type: "string",
        enum: ["insertion", "deletion", "moveFrom", "moveTo", "formatChange"],
      },
      author: { type: "string" },
      dateIso: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
    },
    required: ["kind", "change"],
    additionalProperties: false,
  },
  DivisionSource: {
    type: "object",
    properties: { href: { type: "string" }, sectionName: { type: "string" } },
    required: ["href"],
    additionalProperties: false,
  },
  DivisionDescriptor: {
    type: "object",
    properties: {
      kind: { type: "string", const: "division" },
      name: { type: "string" },
      columnCount: {
        type: "integer",
        exclusiveMinimum: 0,
        maximum: MAX_SAFE_INTEGER,
      },
      protected: { type: "boolean" },
      linked: { $ref: "#/$defs/DivisionSource" },
      source: { $ref: "#/$defs/SourceResidue" },
    },
    required: ["kind"],
    additionalProperties: false,
  },
  ConstructDescriptor: {
    oneOf: [
      { $ref: "#/$defs/ContentControlDescriptor" },
      { $ref: "#/$defs/FieldDescriptor" },
      { $ref: "#/$defs/AnchorDescriptor" },
      { $ref: "#/$defs/LinkDescriptor" },
      { $ref: "#/$defs/ProvenanceDescriptor" },
      { $ref: "#/$defs/DivisionDescriptor" },
    ],
  },
  // -- The definitions facility (src/definitions.ts), reached through DocumentTreeSchema's styles/definitions fields and, since 4.1.0, its layers/attachments/destinations tables --
  StyleParagraphProperties: {
    type: "object",
    properties: {
      alignment: { $ref: "#/$defs/Alignment" },
      list: { $ref: "#/$defs/ContentListMembership" },
      spacingBeforePt: { type: "number" },
      spacingAfterPt: { type: "number" },
      lineSpacing: { type: "number", exclusiveMinimum: 0 },
      indentLeftPt: { type: "number" },
      indentFirstLinePt: { type: "number" },
      pageBreakBefore: { type: "boolean" }, // the page-boundary flags ContentParagraph carries -- the styles-table spelling of a paragraph style that forces a page break
      pageBreakAfter: { type: "boolean" },
    },
    additionalProperties: false,
  },
  StyleRunProperties: {
    type: "object",
    properties: {
      bold: { type: "boolean" },
      italic: { type: "boolean" },
      underline: { type: "boolean" },
      strike: { type: "boolean" },
      fontFamily: { type: "string" },
      sizePt: { type: "number", exclusiveMinimum: 0 },
      color: { $ref: "#/$defs/Color" },
    },
    additionalProperties: false,
  },
  StyleEntry: {
    type: "object",
    properties: {
      paragraph: { $ref: "#/$defs/StyleParagraphProperties" },
      run: { $ref: "#/$defs/StyleRunProperties" },
    },
    additionalProperties: false,
  },
  // A tenant-generic definitions-table entry: a required `kind` discriminator plus an open body whose keys belong to the tenant's vocabulary, never this package's -- the empty additionalProperties schema is JSON Schema's "anything", the emitted form of z.looseObject (src/definitions.ts).
  DefinitionEntry: {
    type: "object",
    properties: {
      kind: { type: "string" },
    },
    required: ["kind"],
    additionalProperties: {},
  },
  // The MathML node tree carried by the ContentDocument 'formula' variant's own ContentFormulaSchema.mathml (src/content.ts) -- MathMlAttribute/MathMlElement/MathMlNode, rather than transcribed by hand, since MathMlNodeSchema stopped being a z.custom() node in ExaDev/documents.js#937 and z.toJSONSchema() can introspect it directly now. Declared as `get` accessors here, in their own field position, rather than spread in as plain values from a separately-built object: a getter fires only when the property is actually read, so cacheMathMlDef()'s z.toJSONSchema() call happens on first access to any of the three, not the moment this object literal is constructed -- and declaring them in place (rather than via Object.defineProperty after this literal closes) keeps CONTENT_DEFS's own key order exactly where it always was, so the generated content-document.schema.json/document-tree.schema.json's own $defs key order is unaffected by the deferral. See cacheMathMlDef's own comment above for the self-caching mechanism and why referencing CONTENT_DEFS from inside it is safe.
  get MathMlAttribute(): JsonSchema {
    return cacheMathMlDef("MathMlAttribute");
  },
  get MathMlElement(): JsonSchema {
    return cacheMathMlDef("MathMlElement");
  },
  get MathMlNode(): JsonSchema {
    return cacheMathMlDef("MathMlNode");
  },
  //
  // -- The math value schemas (src/math.ts) --
  //
  // ContentFormula itself (src/content.ts): its `content` field reaches the opaque MathExpressionSchema, so the generator's override() replaces every occurrence with a $ref to this fragment (the ContentTableCell precedent -- a real z.object dragged opaque by one field); its `mathml` field reaches the now-real, self-recursive MathMlNodeSchema instead, since ExaDev/documents.js#937, but the whole fragment still stays hand-transcribed because of the field that remains opaque. presentation/provenance/starMath are transcribed alongside rather than left to inline, so the whole fragment tree under `formula` lives here where the regression test can see the leaves.
  ContentFormula: {
    type: "object",
    properties: {
      mathml: { type: "array", items: { $ref: "#/$defs/MathMlNode" } },
      starMath: { type: "string" },
      presentation: { $ref: "#/$defs/MathPresentation" },
      content: { $ref: "#/$defs/MathExpression" },
      provenance: { $ref: "#/$defs/MathProvenance" },
      source: { $ref: "#/$defs/SourceResidue" },
    },
    required: ["mathml"],
    additionalProperties: false,
  },
  // An exact rational's two halves as canonical decimal-integer strings (src/math.ts's CANONICAL_SIGNED_INTEGER/CANONICAL_POSITIVE_INTEGER -- the patterns ARE the canonicalisation: no leading zeros, no '-0', denominator strictly positive).
  ExactRational: {
    type: "object",
    properties: {
      numerator: { type: "string", pattern: "^(0|-?[1-9]\\d*)$" },
      denominator: { type: "string", pattern: "^[1-9]\\d*$" },
    },
    required: ["numerator", "denominator"],
    additionalProperties: false,
  },
  // A dimension as exponents over the SI bases (DimensionVectorSchema = z.partialRecord(z.enum(SI_BASE_DIMENSIONS), z.number().int())) -- the enum below is spread from that same const so the two cannot drift.
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
  // The bases array's entry object is inlined rather than given its own $def -- MathMlNode's five non-element variants set the precedent for inlining definitions nothing else references.
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
  // SymbolTableSchema is a real z.object with no custom node anywhere under it, so z.toJSONSchema() could convert it inline -- it is transcribed here (and the generator $refs to it) so each ContentDocument arm's symbolTable field stays one named reference instead of five duplicated copies of this whole subtree.
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
  // MathExpression and the recursive variants below it sit downstream of the fourth opaque z.custom() node (MathExpressionSchema) -- transcribed from src/math.ts's per-variant Zod definitions and interfaces, re-verified by hand when those shapes change.
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
