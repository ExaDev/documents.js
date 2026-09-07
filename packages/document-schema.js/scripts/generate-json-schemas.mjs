#!/usr/bin/env node
// Generates schemas/*.schema.json from the package's own Zod schemas via z.toJSONSchema() (https://zod.dev/json-schema). Run as part of `pnpm build` (see package.json's "build" script), so schemas/ is always fresh for `pnpm test:smoke` and for a real `npm publish` (prepublishOnly runs the full build too, not tsdown alone).
//
// Imports from the freshly-built ../dist/index.js, exactly like test/smoke.test.mjs already does -- this script only ever runs after tsdown has produced dist/.
//
// This script is deliberately outside tsconfig.json's "include" and eslint.config.ts's linted set (see the "scripts" entry in both), matching the existing precedent for test/smoke.test.mjs: a standalone build step, not part of the shipped src/ program.
//
// -- The z.custom() opacity problem, and what's left of it -- ContentDocumentSchema's tree used to contain three schemas built from a hand-written type-guard predicate (z.custom()) rather than real Zod primitives -- ContentBlockSchema, ContentEmbeddedObjectSchema, and MathExpressionSchema -- because the recursive block/table/embedded-object and math-expression structures they represent were believed unable to reach through z.lazy() in the pinned Zod version. ExaDev/documents.js#1009 disproved that (see src/content.ts's and src/math.ts's own comments on the three schemas, and the README's "z.custom() vs z.lazy() for recursive schemas" section): all three are real, self-recursive z.discriminatedUnion()s now, the identical z.lazy() rewrite #937 already applied to MathMlNodeSchema. z.toJSONSchema() can introspect all three directly now -- the historical reason for hand-authoring everything downstream of them (a z.custom() node converts to an empty `{}` under `unrepresentable: 'any'`, or throws outright without it, before override() ever runs) no longer applies to THEM specifically. What still needs override() below is narrower: forcing ContentBlockSchema/ContentEmbeddedObjectSchema to $ref a hand-chosen $defs name rather than z.toJSONSchema()'s own auto-generated anonymous entry for an unregistered self-recursive schema (see their own branches), and forcing ContentFormulaSchema/SymbolTableSchema/StyleEntrySchema/DefinitionEntrySchema -- real, fully generatable z.objects, opaque or not -- to $ref one named definition instead of being inlined once per occurrence. The fragments themselves (CONTENT_DEFS, MAX_SAFE_INTEGER, EMBEDDED_OBJECT_KINDS, CONTENT_DOCUMENT_URI) live in src/content-json-schema-defs.ts rather than inline here, so this script and that module's own regression test (content-json-schema-defs.test.ts) share exactly one copy -- see that src module's own top comment for why it had to move out of this script, and for which fragments now get a live z.toJSONSchema() comparison versus which stay hand-verified. The package tree's own opaque set remains, untouched by #1009: DocumentTreeSchema's five arms' children fields reference the package tree's per-kind group schemas (src/package-node.ts, z.custom over recursive tree-of-groups guards -- a genuinely separate recursion axis from anything #1009 converted), so the whole TreeNode vocabulary is still transcribed in CONTENT_DEFS alongside the content fragments.
//
// -- Cross-file references -- Rather than each .schema.json file being a fully independent, self-contained document (duplicating ContentDocument's entire body inside document-tree.schema.json), this uses Zod's registry-based multi-schema generation: a dedicated z.registry() (not z.globalRegistry, so a one-shot build step never pollutes shared process-wide state), registry.add(schema, {id}) for both schemas, then one z.toJSONSchema(registry, {uri, override, unrepresentable: 'any'}) call. Zod automatically produces real $ref-based cross-references for any registered schema encountered while generating another. The one cross-file pointer that remains is deliberate: $defs.ContentEmbeddedObject(Block)'s `document` field, which is the genuine cycle back to a whole ContentDocument and points at CONTENT_DOCUMENT_URI. Everything else stays file-local -- CONTENT_DEFS is spliced into BOTH output files' roots (the ContentDocumentSchema and DocumentTreeSchema branches below), because the tree fragments reference the content vocabulary through local `#/$defs/...` pointers and each file must resolve its own pointers without depending on the other file's layout; the two copies cannot drift because they are the same object emitted twice in one run.
//
// -- $id/URI scheme -- schemaUriFor() (src/schema-io.ts, imported below from the freshly-built dist/index.js like every other schema this script uses) maps each registered id to https://cdn.jsdelivr.net/npm/document-schema.js@{version}/schemas/{fileName}, pinned to this package's own published npm version (baked in at build time via tsdown's `define`, not read from the npm registry) rather than a git commit. A commit-SHA-embedded $id was tried first and rejected: schemas/ is gitignored (generated, not committed, matching dist/'s own treatment below), so a file whose own content names the exact commit that generated it can never actually exist at that commit -- committing it would change the tree, which would change the hash it would need to embed. That's not a timing gap, it's a structural impossibility, confirmed by testing the resulting raw.githubusercontent.com URL directly (404, forever, for every past and future release). jsdelivr's npm CDN has no such problem: it serves whatever's inside an already-published version's own tarball, and the version is already known and stable by the time this script runs (semantic-release's npm plugin writes the bumped version into package.json before invoking npm's prepublishOnly lifecycle, which is what runs this generator via `pnpm run build`) -- no circularity, and confirmed live by directly curling this exact URL pattern against a previously-published 1.6.0 tarball (200, with `cache-control: immutable`). A local dev build reads whatever version currently happens to be in package.json (the last real release, not a "current" one) -- the resulting URL is only genuinely fetchable once that version is actually published, same caveat any version-pinned CDN reference has. schemaUriFor()/SCHEMA_FILE_NAMES are also exported at runtime (src/schema-io.ts) for documentTreeWithSchema()/documentFromJson()/etc. -- this script reuses that single copy rather than keeping its own parallel id->filename->URL map in sync by hand. The URI is also the artefact's VERSION (4.0.0's versioning contract, src/schema-io.ts): there is no formatVersion integer anywhere in a dumped value, and documentFromJson dispatches on this URI's version segment.
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
  DefinitionEntrySchema,
  DocumentTreeSchema,
  DrawPageGroupSchema,
  SCHEMA_FILE_NAMES,
  schemaUriFor,
  SectionGroupSchema,
  SheetGroupSchema,
  SlideGroupSchema,
  StyleEntrySchema,
  SymbolTableSchema,
} from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const schemasDir = join(repoRoot, 'schemas');

// Only used for the closing console.log below -- schemaUriFor() itself already has the identical version baked in at build time (tsdown.config.ts's `define`), so this read isn't feeding the URL logic, just the human-readable log line.
const { version: packageVersion } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

const registry = z.registry();
registry.add(DocumentTreeSchema, { id: 'DocumentTree' });
registry.add(ContentDocumentSchema, { id: 'ContentDocument' });

// Eight branches, keyed on reference equality against the exported consts (each z.custom() call has distinct object identity, confirmed empirically). override() fires exactly once per unique Zod schema instance encountered anywhere across the whole registry-processing session, regardless of how many field sites reference it or which output file happens to reach it first -- mutating ctx.jsonSchema in place is what makes one override call apply everywhere that exact schema object is used.
function override(ctx) {
  if (ctx.zodSchema === DocumentTreeSchema) {
    // The package root is a discriminated union of the five kind arms; its children fields reach the tree's opaque group schemas, replaced further down with local #/$defs pointers. Splicing CONTENT_DEFS here makes document-tree.schema.json resolve its own pointers: the tree fragments, the styles/definitions fragments, and everything they reference live in that one $defs block (see this file's cross-file-references comment for why both output files carry it).
    ctx.jsonSchema.$defs = CONTENT_DEFS;
    return;
  }
  if (ctx.zodSchema === ContentDocumentSchema) {
    // Zod's own discriminated-union conversion already produced a correct `oneOf` of the five kind variants on ctx.jsonSchema (each is a real z.object; the 'formula' variant reaches the custom nodes through ContentFormulaSchema, replaced wholesale by its own branch below) -- this only adds the hand-authored $defs block alongside it.
    ctx.jsonSchema.$defs = CONTENT_DEFS;
    return;
  }
  if (ctx.zodSchema === ContentFormulaSchema) {
    // A real z.object whose every field is itself a real, non-custom schema now (its `mathml` field reaching MathMlNodeSchema since ExaDev/documents.js#937, its `content` field reaching the now-real, self-recursive MathExpressionSchema since #1009) -- transcribed as $defs.ContentFormula and every occurrence replaced regardless, for the SAME "named reference instead of duplicated inlining" reason SymbolTableSchema gets below, not because anything it reaches is opaque. The auto-generated body must be cleared first: unlike a genuinely opaque node (which starts as `{}`), a real object schema's jsonSchema already carries type/properties/required by the time finalize() runs. Reached twice per build: as the flat ContentDocument 'formula' variant's field and as the tree package's formula-root children item.
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
  if (ctx.zodSchema === StyleEntrySchema || ctx.zodSchema === DefinitionEntrySchema) {
    // The SymbolTable treatment for the package arms' tables: fully generatable entries, $ref-ed so each arm's styles/definitions field is one named reference instead of five inlined copies. The id spelled here is the branch's own -- the two schemas' fragments carry different names.
    const defName = ctx.zodSchema === StyleEntrySchema ? 'StyleEntry' : 'DefinitionEntry';
    for (const key of Object.keys(ctx.jsonSchema)) {
      delete ctx.jsonSchema[key];
    }
    ctx.jsonSchema.$ref = `#/$defs/${defName}`;
    return;
  }
  if (ctx.zodSchema === ContentBlockSchema) {
    // Real and self-recursive since ExaDev/documents.js#1009 (a real z.discriminatedUnion() via z.lazy(), not a z.custom() predicate) -- but every occurrence, including inside $defs.ContentTableCell, still points at this one shared, hand-named definition rather than z.toJSONSchema()'s own cycle handling, which would otherwise factor a self-recursive schema it encounters unregistered into its own anonymous, auto-generated $defs entry instead of the clean "ContentBlock" name this generator wants. Confirmed empirically post-#1009: ctx.jsonSchema still arrives here effectively empty (override fires before Zod's own recursive-body construction for this schema), so the bare assignment below is still sufficient -- no properties to clear first, exactly as before the schema became real.
    ctx.jsonSchema.$ref = '#/$defs/ContentBlock';
    return;
  }
  if (ctx.zodSchema === ContentEmbeddedObjectSchema) {
    // Standalone schema for an embedded object on its own (src/content.ts) -- the sheet-children leaf position of the package tree, and the flat ContentSheetSchema.embeddedObjects entry type. Real since #1009 (see ContentBlockSchema's own comment above for why the override still forces this exact $ref regardless), not a custom node -- but ctx.jsonSchema still arrives here effectively empty, so the bare assignment below still suffices. Transcribed as $defs.ContentEmbeddedObject (same member fields as ContentEmbeddedObjectBlock minus the block-level `kind` discriminant).
    ctx.jsonSchema.$ref = '#/$defs/ContentEmbeddedObject';
    return;
  }
  if (
    ctx.zodSchema === SectionGroupSchema ||
    ctx.zodSchema === SlideGroupSchema ||
    ctx.zodSchema === SheetGroupSchema ||
    ctx.zodSchema === DrawPageGroupSchema
  ) {
    // The four per-kind root group schemas the package arms' children fields reference (src/package-node.ts). ShapeGroup/HeadingGroup/ListGroup never appear here: they are reachable only through the hand-authored fragments' own children pointers, which already spell their $defs names, and zod never walks inside a custom node to reach them. ctx.jsonSchema starts as `{}`, so the assignment alone suffices.
    const defNames = new Map([
      [SectionGroupSchema, 'SectionGroup'],
      [SlideGroupSchema, 'SlideGroup'],
      [SheetGroupSchema, 'SheetGroup'],
      [DrawPageGroupSchema, 'DrawPageGroup'],
    ]);
    const defName = defNames.get(ctx.zodSchema);
    ctx.jsonSchema.$ref = `#/$defs/${defName}`;
  }
}

const { schemas } = z.toJSONSchema(registry, { uri: schemaUriFor, unrepresentable: 'any', override });

mkdirSync(schemasDir, { recursive: true });
for (const [id, fileName] of Object.entries(SCHEMA_FILE_NAMES)) {
  writeFileSync(join(schemasDir, fileName), `${JSON.stringify(schemas[id], null, 2)}\n`, 'utf8');
}

console.log(`Wrote ${Object.keys(SCHEMA_FILE_NAMES).length} JSON Schema files to schemas/ (version ${packageVersion})`);
