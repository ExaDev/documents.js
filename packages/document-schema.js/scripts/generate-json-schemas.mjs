#!/usr/bin/env node
// Generates schemas/*.schema.json from the package's own Zod schemas via z.toJSONSchema() (https://zod.dev/json-schema). Run as part of `pnpm build` (see package.json's "build" script), so schemas/ is always fresh for `pnpm test:smoke` and for a real `npm publish` (prepublishOnly runs the full build too, not tsdown alone).
//
// Imports from the freshly-built ../dist/index.js, exactly like test/smoke.test.mjs already does -- this script only ever runs after tsdown has produced dist/.
//
// This script is deliberately outside tsconfig.json's "include" and eslint.config.ts's linted set (see the "scripts" entry in both), matching the existing precedent for test/smoke.test.mjs: a standalone build step, not part of the shipped src/ program.
//
// -- The z.custom() opacity problem -- ContentDocumentSchema's tree contains four schemas built from a hand-written type-guard predicate (z.custom()) rather than real Zod primitives -- ContentBlockSchema, ContentEmbeddedObjectSchema, MathMlNodeSchema, and MathExpressionSchema -- because the recursive block/table/embedded-object, MathML-element, and math-expression structures they represent can't be expressed via z.lazy() in the pinned Zod version (see src/content.ts's own comments on isContentBlock/isContentEmbeddedObject, src/mathml.ts's on isMathMlNode, and src/math.ts's on isMathExpression). z.toJSONSchema() cannot introspect a z.custom() node at all: with `unrepresentable: 'any'` it silently emits an empty `{}` for that node (confirmed by reading node_modules/zod/v4/core/json-schema-processors.js's customProcessor, which does nothing to its `json` argument once `unrepresentable !== 'throw'`); without that option it throws immediately, before override() ever runs (override only patches at finalize() time, strictly after the pass that would otherwise throw). So everything downstream of those four nodes needs hand-authored JSON Schema fragments, spliced in via the override() callback below -- the fragments themselves (CONTENT_DEFS, MAX_SAFE_INTEGER, EMBEDDED_OBJECT_KINDS, CONTENT_DOCUMENT_URI) now live in src/content-json-schema-defs.ts rather than inline here, so this script and that module's own regression test (content-json-schema-defs.test.ts) share exactly one copy -- see that src module's own top comment for why it had to move out of this script. Two real z.objects are replaced with a $ref to their hand-authored fragments too: ContentFormulaSchema (a real z.object, but its mathml/content fields drag in the opaque MathMlNodeSchema/MathExpressionSchema, so its auto-generated body would be hollowed out around them -- the ContentTableCellSchema situation) and SymbolTableSchema (fully generatable, but $ref-ing it keeps each ContentDocument arm's symbolTable field one named reference instead of five inlined copies of the whole unit-registry subtree).
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
  CONTENT_DEFS,
  ContentBlockSchema,
  ContentDocumentSchema,
  ContentEmbeddedObjectSchema,
  ContentFormulaSchema,
  CONTENT_DOCUMENT_URI,
  DocumentPackageSchema,
  EMBEDDED_OBJECT_KINDS,
  LayoutDocumentSchema,
  MathMlNodeSchema,
  MAX_SAFE_INTEGER,
  SCHEMA_FILE_NAMES,
  schemaUriFor,
  SymbolTableSchema,
} from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const schemasDir = join(repoRoot, 'schemas');

// Only used for the closing console.log below -- schemaUriFor() itself already has the identical version baked in at build time (tsdown.config.ts's `define`), so this read isn't feeding the URL logic, just the human-readable log line.
const { version: packageVersion } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

const registry = z.registry();
registry.add(DocumentPackageSchema, { id: 'DocumentPackage' });
registry.add(ContentDocumentSchema, { id: 'ContentDocument' });
registry.add(LayoutDocumentSchema, { id: 'LayoutDocument' });

// Six branches, keyed on reference equality against the exported consts (each z.custom() call has distinct object identity, confirmed empirically). override() fires exactly once per unique Zod schema instance encountered anywhere across the whole registry-processing session, regardless of how many field sites reference it or which of the three output files happens to reach it first -- mutating ctx.jsonSchema in place is what makes one override call apply everywhere that exact schema object is used (e.g. ContentBlockSchema appears in ContentSectionSchema, ContentShapeSchema, and ContentTableCellSchema all at once).
function override(ctx) {
  if (ctx.zodSchema === ContentDocumentSchema) {
    // Zod's own discriminated-union conversion already produced a correct `oneOf` of the five kind variants on ctx.jsonSchema (each is a real z.object; the 'formula' variant reaches the custom nodes through ContentFormulaSchema, replaced wholesale by its own branch below) -- this only adds the hand-authored $defs block alongside it.
    ctx.jsonSchema.$defs = CONTENT_DEFS;
    return;
  }
  if (ctx.zodSchema === ContentFormulaSchema) {
    // A real z.object, but two of its fields reach opaque custom nodes (mathml -> MathMlNodeSchema, content -> MathExpressionSchema), so the whole thing is transcribed as $defs.ContentFormula and every occurrence replaced -- same treatment as ContentBlockSchema below, except the auto-generated body must be cleared first: unlike a custom node (which starts as `{}`), a real object schema's jsonSchema already carries type/properties/required by the time finalize() runs.
    for (const key of Object.keys(ctx.jsonSchema)) {
      delete ctx.jsonSchema[key];
    }
    ctx.jsonSchema.$ref = '#/$defs/ContentFormula';
    return;
  }
  if (ctx.zodSchema === SymbolTableSchema) {
    // Fully generatable, but $ref-ing the hand-authored $defs.SymbolTable keeps each of the five ContentDocument arms' symbolTable field one named reference instead of five inlined copies of the whole symbol/unit subtree. Same clear-then-set as ContentFormulaSchema above.
    for (const key of Object.keys(ctx.jsonSchema)) {
      delete ctx.jsonSchema[key];
    }
    ctx.jsonSchema.$ref = '#/$defs/SymbolTable';
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
    // Standalone schema for an embedded object on its own (src/content.ts), independent of the ContentBlock 'embeddedObject' wrapper above -- this is what ContentSheetSchema.embeddedObjects validates each entry against. Same object shape as $defs.ContentEmbeddedObjectBlock minus the `kind` discriminant, cell-anchor fields included.
    ctx.jsonSchema.type = 'object';
    ctx.jsonSchema.properties = {
      objectKind: { type: 'string', enum: EMBEDDED_OBJECT_KINDS },
      document: { $ref: CONTENT_DOCUMENT_URI },
      frame: { $ref: '#/$defs/Box' },
      anchorRow: { type: 'integer', minimum: 0, maximum: MAX_SAFE_INTEGER },
      anchorColumn: { type: 'integer', minimum: 0, maximum: MAX_SAFE_INTEGER },
      offsetXPt: { type: 'number' },
      offsetYPt: { type: 'number' },
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
