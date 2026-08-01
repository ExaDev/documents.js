#!/usr/bin/env node
// Generates schemas/*.schema.json from the package's own Zod schemas via z.toJSONSchema() (https://zod.dev/json-schema). Run as part of `pnpm build` (see package.json's "build" script), so schemas/ is always fresh for `pnpm test:smoke` and for a real `npm publish` (prepublishOnly runs the full build too, not tsdown alone).
//
// Imports from the freshly-built ../dist/index.js, exactly like test/smoke.test.mjs already does -- this script only ever runs after tsdown has produced dist/.
//
// This script is deliberately outside tsconfig.json's "include" and eslint.config.ts's linted set (see the "scripts" entry in both), matching the existing precedent for test/smoke.test.mjs: a standalone build step, not part of the shipped src/ program.
//
// -- The z.custom() opacity problem -- ContentDocumentSchema's tree contains two schemas built from a hand-written type-guard predicate (z.custom()) rather than real Zod primitives -- ContentBlockSchema and ContentEmbeddedObjectSchema -- because the recursive block/table/embedded-object structure they represent can't be expressed via z.lazy() in the pinned Zod version (see src/content.ts's own comments on isContentBlock/isContentEmbeddedObject). z.toJSONSchema() cannot introspect a z.custom() node at all: with `unrepresentable: 'any'` it silently emits an empty `{}` for that node (confirmed by reading node_modules/zod/v4/core/json-schema-processors.js's customProcessor, which does nothing to its `json` argument once `unrepresentable !== 'throw'`); without that option it throws immediately, before override() ever runs (override only patches at finalize() time, strictly after the pass that would otherwise throw). So these two nodes need hand-authored JSON Schema fragments, spliced in via the override() callback below.
//
// -- Cross-file references -- Rather than each of the three .schema.json files being a fully independent, self-contained document (duplicating ContentDocument's entire body inside document-package.schema.json), this uses Zod's registry-based multi-schema generation: a dedicated z.registry() (not z.globalRegistry, so a one-shot build step never pollutes shared process-wide state), registry.add(schema, {id}) for all three schemas, then one z.toJSONSchema(registry, {uri, override, unrepresentable: 'any'}) call. Zod automatically produces real $ref-based cross-references between the three output files for any registered schema encountered while generating another (confirmed empirically: see the experiment behind this script's own review) -- DocumentPackageSchema's own `content`/`layout` fields come out as `{ $ref: <external URI> }` rather than inlining ContentDocument/LayoutDocument's entire bodies.
//
// -- $id/URI scheme and its timing -- uriForId() maps each registered id to https://raw.githubusercontent.com/ExaDev/document-schema.js/{commitSha}/schemas/{fileName} -- a real, live, immediately-resolvable URL, pinned to the exact commit that generated it via `git rev-parse HEAD` (shelled out with Node's child_process.execSync so this behaves identically on a local dev machine and in CI, both of which have the repo checked out with .git present). A commit SHA gives genuine immutability: that exact URL resolves to that exact file's content forever. This only works correctly if the commit being built from is already pushed to GitHub by the time the generator runs -- confirmed safe for this repo's actual CI sequence: the release job in .github/workflows/ci.yml triggers on push to main (so the triggering commit is already on GitHub), and
// @semantic-release/npm's prepublishOnly (which now runs this generator via `pnpm run build`, see package.json)
// executes before @semantic-release/git creates and pushes the version-bump commit, per release.config.ts's actual plugin order (npm -> github -> git). So the SHA captured at generation time is always already-resolvable on GitHub by the time anything references it. A local, not-yet-pushed dev build generates a technically-correct file whose URL simply isn't fetchable until pushed -- expected and harmless for local iteration.
//
// No try/catch anywhere in this script -- any failure (a Zod throw, a git/filesystem error) crashes it loudly with a non-zero exit, matching this project's standing "never silently swallow a failure" convention.

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  ContentBlockSchema,
  ContentDocumentSchema,
  ContentEmbeddedObjectSchema,
  DocumentPackageSchema,
  LayoutDocumentSchema,
} from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const schemasDir = join(repoRoot, 'schemas');

const commitSha = execSync('git rev-parse HEAD', { cwd: repoRoot }).toString().trim();

// Kebab-case of the exported type names, not the bare module filenames (content.ts, package.ts, layout.ts), which would collide confusingly with e.g. package.json.
const FILE_NAMES = {
  DocumentPackage: 'document-package.schema.json',
  ContentDocument: 'content-document.schema.json',
  LayoutDocument: 'layout-document.schema.json',
};

function uriForId(id) {
  return `https://raw.githubusercontent.com/ExaDev/document-schema.js/${commitSha}/schemas/${FILE_NAMES[id]}`;
}

// The genuine cycle back to a whole ContentDocument: ContentEmbeddedObject(Block)'s own `document` field. Resolved once up front since both override branches below need the identical URI.
const CONTENT_DOCUMENT_URI = uriForId('ContentDocument');

// Zod's own `.int()` bag range (node_modules/zod/v4/core/json-schema-processors.js's numberProcessor), reproduced verbatim wherever a hand-authored integer field below mirrors a real `z.number().int()...` field -- confirmed empirically against ContentListMembershipSchema.level and ContentTableCellSchema.colSpan/rowSpan.
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

const EMBEDDED_OBJECT_KINDS = ['formula', 'wordprocessing', 'presentation', 'spreadsheet', 'drawing'];

// -- Hand-authored $defs, spliced into content-document.schema.json only (via the ContentDocumentSchema override branch below) --
//
// ContentBlockSchema and ContentEmbeddedObjectSchema are z.custom() predicates (src/content.ts) standing in for a recursive block/table/embedded-object structure that has no representable Zod schema of its own. The fragments below are transcribed by hand, field-for-field, from src/content.ts's real Zod object definitions (ContentParagraphSchema, ContentTableSchema/ContentTableRowSchema/ContentTableCellSchema, ContentImageBlockSchema, ContentPageBreakSchema, ContentRunSchema, ContentListMembershipSchema, ColorSchema, BoxSchema, AlignmentSchema -- each cross-checked directly against a real z.toJSONSchema() call over that exact exported schema during this script's own review) plus the ContentEmbeddedObject/ContentEmbeddedObjectBlock TS interfaces, which have no exported z.object() counterpart at all (both are validated only via the isContentEmbeddedObject*() z.custom() guards). Re-verify this block against src/content.ts whenever that file's field shapes change -- nothing here is generated or checked against the real schemas at build time.
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
};

const registry = z.registry();
registry.add(DocumentPackageSchema, { id: 'DocumentPackage' });
registry.add(ContentDocumentSchema, { id: 'ContentDocument' });
registry.add(LayoutDocumentSchema, { id: 'LayoutDocument' });

// Three branches, keyed on reference equality against the exported consts (each z.custom() call has distinct object identity, confirmed empirically). override() fires exactly once per unique Zod schema instance encountered anywhere across the whole registry-processing session, regardless of how many field sites reference it or which of the three output files happens to reach it first -- mutating ctx.jsonSchema in place is what makes one override call apply everywhere that exact schema object is used (e.g. ContentBlockSchema appears in ContentSectionSchema, ContentShapeSchema, and ContentTableCellSchema all at once).
function override(ctx) {
  if (ctx.zodSchema === ContentDocumentSchema) {
    // Zod's own discriminated-union conversion already produced a correct `oneOf` of the four real (non-custom) kind variants on ctx.jsonSchema -- this only adds the hand-authored $defs block alongside it.
    ctx.jsonSchema.$defs = CONTENT_DEFS;
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

const { schemas } = z.toJSONSchema(registry, { uri: uriForId, unrepresentable: 'any', override });

mkdirSync(schemasDir, { recursive: true });
for (const [id, fileName] of Object.entries(FILE_NAMES)) {
  writeFileSync(join(schemasDir, fileName), `${JSON.stringify(schemas[id], null, 2)}\n`, 'utf8');
}

console.log(`Wrote ${Object.keys(FILE_NAMES).length} JSON Schema files to schemas/ (commit ${commitSha})`);
