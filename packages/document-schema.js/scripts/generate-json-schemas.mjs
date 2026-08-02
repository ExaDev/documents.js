#!/usr/bin/env node
// Generates schemas/*.schema.json from the package's own Zod schemas via z.toJSONSchema() (https://zod.dev/json-schema). Run as part of `pnpm build` (see package.json's "build" script), so schemas/ is always fresh for `pnpm test:smoke` and for a real `npm publish` (prepublishOnly runs the full build too, not tsdown alone).
//
// Imports from the freshly-built ../dist/index.js, exactly like test/smoke.test.mjs already does -- this script only ever runs after tsdown has produced dist/.
//
// This script is deliberately outside tsconfig.json's "include" and eslint.config.ts's linted set (see the "scripts" entry in both), matching the existing precedent for test/smoke.test.mjs: a standalone build step, not part of the shipped src/ program.
//
// -- The z.custom() opacity problem -- ContentDocumentSchema's tree contains three schemas built from a hand-written type-guard predicate (z.custom()) rather than real Zod primitives -- ContentBlockSchema, ContentEmbeddedObjectSchema, and MathMlNodeSchema -- because the recursive block/table/embedded-object and MathML-element structures they represent can't be expressed via z.lazy() in the pinned Zod version (see src/content.ts's own comments on isContentBlock/isContentEmbeddedObject, and src/mathml.ts's on isMathMlNode). z.toJSONSchema() cannot introspect a z.custom() node at all: with `unrepresentable: 'any'` it silently emits an empty `{}` for that node (confirmed by reading node_modules/zod/v4/core/json-schema-processors.js's customProcessor, which does nothing to its `json` argument once `unrepresentable !== 'throw'`); without that option it throws immediately, before override() ever runs (override only patches at finalize() time, strictly after the pass that would otherwise throw). So these three nodes need hand-authored JSON Schema fragments, spliced in via the override() callback below.
//
// -- Cross-file references -- Rather than each of the three .schema.json files being a fully independent, self-contained document (duplicating ContentDocument's entire body inside document-package.schema.json), this uses Zod's registry-based multi-schema generation: a dedicated z.registry() (not z.globalRegistry, so a one-shot build step never pollutes shared process-wide state), registry.add(schema, {id}) for all three schemas, then one z.toJSONSchema(registry, {uri, override, unrepresentable: 'any'}) call. Zod automatically produces real $ref-based cross-references between the three output files for any registered schema encountered while generating another (confirmed empirically: see the experiment behind this script's own review) -- DocumentPackageSchema's own `content`/`layout` fields come out as `{ $ref: <external URI> }` rather than inlining ContentDocument/LayoutDocument's entire bodies.
//
// -- $id/URI scheme -- schemaUriFor() (src/schema-io.ts, imported below from the freshly-built dist/index.js like every other schema this script uses) maps each registered id to https://cdn.jsdelivr.net/npm/document-schema.js@{version}/schemas/{fileName}, pinned to this package's own published npm version (baked in at build time via tsdown's `define`, not read from the npm registry) rather than a git commit. A commit-SHA-embedded $id was tried first and rejected: schemas/ is gitignored (generated, not committed, matching dist/'s own treatment below), so a file whose own content names the exact commit that generated it can never actually exist at that commit -- committing it would change the tree, which would change the hash it would need to embed. That's not a timing gap, it's a structural impossibility, confirmed by testing the resulting raw.githubusercontent.com URL directly (404, forever, for every past and future release). jsdelivr's npm CDN has no such problem: it serves whatever's inside an already-published version's own tarball, and the version is already known and stable by the time this script runs (semantic-release's npm plugin writes the bumped version into package.json before invoking npm's prepublishOnly lifecycle, which is what runs this generator via `pnpm run build`) -- no circularity, and confirmed live by directly curling this exact URL pattern against the previously-published 1.6.0 tarball (200, with `cache-control: immutable`). A local dev build reads whatever version currently happens to be in package.json (the last real release, not a "current" one) -- the resulting URL is only genuinely fetchable once that version is actually published, same caveat any version-pinned CDN reference has. schemaUriFor()/SCHEMA_FILE_NAMES are also exported at runtime (src/schema-io.ts) for documentPackageWithSchema()/documentFromJson()/etc. -- this script reuses that single copy rather than keeping its own parallel id->filename->URL map in sync by hand.
//
// No try/catch anywhere in this script -- any failure (a Zod throw, a filesystem error) crashes it loudly with a non-zero exit, matching this project's standing "never silently swallow a failure" convention.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  ContentBlockSchema,
  ContentDocumentSchema,
  ContentEmbeddedObjectSchema,
  DocumentPackageSchema,
  LayoutDocumentSchema,
  MathMlNodeSchema,
  SCHEMA_FILE_NAMES,
  schemaUriFor,
} from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const schemasDir = join(repoRoot, 'schemas');

// Only used for the closing console.log below -- schemaUriFor() itself already has the identical version baked in at build time (tsdown.config.ts's `define`), so this read isn't feeding the URL logic, just the human-readable log line.
const { version: packageVersion } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

// The genuine cycle back to a whole ContentDocument: ContentEmbeddedObject(Block)'s own `document` field. Resolved once up front since both override branches below need the identical URI.
const CONTENT_DOCUMENT_URI = schemaUriFor('ContentDocument');

// Zod's own `.int()` bag range (node_modules/zod/v4/core/json-schema-processors.js's numberProcessor), reproduced verbatim wherever a hand-authored integer field below mirrors a real `z.number().int()...` field -- confirmed empirically against ContentListMembershipSchema.level and ContentTableCellSchema.colSpan/rowSpan.
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

const EMBEDDED_OBJECT_KINDS = ['formula', 'wordprocessing', 'presentation', 'spreadsheet', 'drawing'];

// -- Hand-authored $defs, spliced into content-document.schema.json only (via the ContentDocumentSchema override branch below) --
//
// ContentBlockSchema and ContentEmbeddedObjectSchema (src/content.ts) and MathMlNodeSchema (src/mathml.ts) are z.custom() predicates standing in for a recursive block/table/embedded-object structure and a recursive MathML element tree, neither of which has a representable Zod schema of its own. The fragments below are transcribed by hand, field-for-field, from src/content.ts's real Zod object definitions (ContentParagraphSchema, ContentTableSchema/ContentTableRowSchema/ContentTableCellSchema, ContentImageBlockSchema, ContentPageBreakSchema, ContentRunSchema, ContentListMembershipSchema, ColorSchema, BoxSchema, AlignmentSchema -- each cross-checked directly against a real z.toJSONSchema() call over that exact exported schema during this script's own review) plus the ContentEmbeddedObject/ContentEmbeddedObjectBlock TS interfaces, which have no exported z.object() counterpart at all (both are validated only via the isContentEmbeddedObject*() z.custom() guards). Re-verify this block against src/content.ts whenever that file's field shapes change -- nothing here is generated or checked against the real schemas at build time.
const CONTENT_DEFS = {
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
      alignment: { $ref: '#/$defs/Alignment' },
      list: { $ref: '#/$defs/ContentListMembership' },
      spacingBeforePt: { type: 'number' },
      spacingAfterPt: { type: 'number' },
      lineSpacing: { type: 'number', exclusiveMinimum: 0 }, // multiple of single line height
      indentLeftPt: { type: 'number' },
      indentFirstLinePt: { type: 'number' },
      sourcePath: { type: 'string' },
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
    },
    required: ['kind', 'format', 'base64', 'widthPt', 'heightPt'],
    additionalProperties: false,
  },
  ContentPageBreak: {
    type: 'object',
    properties: {
      kind: { type: 'string', const: 'pageBreak' },
      sourcePath: { type: 'string' },
    },
    required: ['kind'],
    additionalProperties: false,
  },
  // ContentTableCellSchema/ContentTableRowSchema/ContentTableSchema ARE real, exported z.object() schemas -- but ContentTableCellSchema.blocks is z.array(ContentBlockSchema), which drags in the opaque z.custom() node the moment Zod tries to convert any of the three. Reproduced by hand here instead, for the same reason as everything else in this block.
  ContentTableCell: {
    type: 'object',
    properties: {
      blocks: { type: 'array', items: { $ref: '#/$defs/ContentBlock' } },
      colSpan: { type: 'integer', exclusiveMinimum: 0, maximum: MAX_SAFE_INTEGER },
      rowSpan: { type: 'integer', exclusiveMinimum: 0, maximum: MAX_SAFE_INTEGER },
      background: { $ref: '#/$defs/Color' },
      borders: { $ref: '#/$defs/ContentCellBorders' },
      sourcePath: { type: 'string' },
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

const registry = z.registry();
registry.add(DocumentPackageSchema, { id: 'DocumentPackage' });
registry.add(ContentDocumentSchema, { id: 'ContentDocument' });
registry.add(LayoutDocumentSchema, { id: 'LayoutDocument' });

// Four branches, keyed on reference equality against the exported consts (each z.custom() call has distinct object identity, confirmed empirically). override() fires exactly once per unique Zod schema instance encountered anywhere across the whole registry-processing session, regardless of how many field sites reference it or which of the three output files happens to reach it first -- mutating ctx.jsonSchema in place is what makes one override call apply everywhere that exact schema object is used (e.g. ContentBlockSchema appears in ContentSectionSchema, ContentShapeSchema, and ContentTableCellSchema all at once).
function override(ctx) {
  if (ctx.zodSchema === ContentDocumentSchema) {
    // Zod's own discriminated-union conversion already produced a correct `oneOf` of the five kind variants on ctx.jsonSchema (each is a real z.object; the 'formula' variant reaches the custom MathMlNodeSchema through ContentFormulaSchema.mathml, patched by its own branch below) -- this only adds the hand-authored $defs block alongside it.
    ctx.jsonSchema.$defs = CONTENT_DEFS;
    return;
  }
  if (ctx.zodSchema === MathMlNodeSchema) {
    // Recursive -- an element's children may themselves be elements -- so every occurrence, including inside $defs.MathMlElement above, points at one shared definition rather than inlining, exactly as ContentBlockSchema does below. ctx.jsonSchema starts as `{}` here, so this assignment alone is sufficient.
    ctx.jsonSchema.$ref = '#/$defs/MathMlNode';
    return;
  }
  if (ctx.zodSchema === ContentBlockSchema) {
    // Recursive -- a table cell's own blocks may themselves be tables -- so every occurrence, including inside $defs.ContentTableCell above, points at one shared definition rather than inlining, which cannot express unbounded recursion. ctx.jsonSchema starts as `{}` here (customProcessor does nothing to it once unrepresentable !== 'throw'), so this assignment alone is sufficient -- no properties to clear first.
    ctx.jsonSchema.$ref = '#/$defs/ContentBlock';
    return;
  }
  if (ctx.zodSchema === ContentEmbeddedObjectSchema) {
    // Standalone schema for an embedded object on its own (src/content.ts), independent of the ContentBlock 'embeddedObject' wrapper above -- this is what ContentSheetSchema.embeddedObjects validates each entry against. Same object shape as $defs.ContentEmbeddedObjectBlock minus the `kind` discriminant.
    ctx.jsonSchema.type = 'object';
    ctx.jsonSchema.properties = {
      objectKind: { type: 'string', enum: EMBEDDED_OBJECT_KINDS },
      document: { $ref: CONTENT_DOCUMENT_URI },
      frame: { $ref: '#/$defs/Box' },
    };
    ctx.jsonSchema.required = ['objectKind', 'document', 'frame'];
    ctx.jsonSchema.additionalProperties = false;
  }
}

const { schemas } = z.toJSONSchema(registry, { uri: schemaUriFor, unrepresentable: 'any', override });

mkdirSync(schemasDir, { recursive: true });
for (const [id, fileName] of Object.entries(SCHEMA_FILE_NAMES)) {
  writeFileSync(join(schemasDir, fileName), `${JSON.stringify(schemas[id], null, 2)}\n`, 'utf8');
}

console.log(`Wrote ${Object.keys(SCHEMA_FILE_NAMES).length} JSON Schema files to schemas/ (version ${packageVersion})`);
