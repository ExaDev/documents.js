import { type ContentDocument, ContentDocumentSchema } from './content';
import { type DocumentPackage, DocumentPackageSchema } from './package';

// The two kinds published as .schema.json files (see scripts/generate-json-schemas.mjs, which imports SCHEMA_FILE_NAMES/schemaUriFor from this module rather than declaring its own copy). Kept in one place so the id string, the filename, and the URL are never edited independently.
export type DocumentSchemaKind = 'DocumentPackage' | 'ContentDocument';

export const SCHEMA_FILE_NAMES: Record<DocumentSchemaKind, string> = {
  DocumentPackage: 'document-package.schema.json',
  ContentDocument: 'content-document.schema.json',
};

// __PACKAGE_VERSION__ is a literal string constant, not a runtime read -- see src/global.d.ts, tsdown.config.ts, and vitest.config.ts.
export function schemaUriFor(kind: DocumentSchemaKind): string {
  return `https://cdn.jsdelivr.net/npm/document-schema.js@${__PACKAGE_VERSION__}/schemas/${SCHEMA_FILE_NAMES[kind]}`;
}

// THE VERSIONING CONTRACT (ExaDev/document-schema.js#20's errata): the $schema URI a dumper stamps is the artefact's version, and it is release-pinned -- the @version segment names the exact npm release whose schema validates the value. It replaces the formatVersion integers releases 1.x-3.x carried (DocumentPackage's own and ContentDocument's per-arm literals), which were a second, hand-kept source of truth alongside URIs that already named the release. There is no version field anywhere in a dumped value any more.
//
// That makes documentFromJson the enforcement point for untrusted input: it reads the URI's version segment and refuses anything this installed release cannot faithfully validate (see the version gate in documentFromJson below -- a different MAJOR never parses, because a major is exactly a schema generation this release may not describe). A bare DocumentPackageSchema.parse() does not version-discriminate at all -- it structurally validates whatever it is handed against the installed schema, full stop -- so a caller ingesting a dump from anywhere it did not itself produce must go through documentFromJson, not a direct parse. Callers that already trust the value's provenance may keep parsing directly, exactly as before.

// The layout-document stem stays in this pattern on purpose: this package no longer defines that schema (the whole LayoutDocument family moved to pdf-codec in this major, ExaDev/pdf-codec#65), but values stamped with its URI are still recognised -- by documentFromJson's tombstone branch, which names where the schema went instead of failing as if the value were unrelated.
const SCHEMA_URI_PATTERN =
  /^https:\/\/cdn\.jsdelivr\.net\/npm\/document-schema\.js@([^/]+)\/schemas\/(document-package|content-document|layout-document)\.schema\.json$/;

interface SchemaUriParts { version: string; stem: string }

function parseSchemaUri(uri: string): SchemaUriParts | undefined {
  const match = SCHEMA_URI_PATTERN.exec(uri);
  if (match === null) return undefined;
  const version = match[1];
  const stem = match[2];
  // Both capturing groups are mandatory in the pattern above, so a successful match always populates them; these checks exist to satisfy noUncheckedIndexedAccess, not because either can genuinely fire.
  if (version === undefined || stem === undefined) return undefined;
  return { version, stem };
}

function kindForFileStem(stem: string): DocumentSchemaKind | undefined {
  switch (stem) {
    case 'document-package':
      return 'DocumentPackage';
    case 'content-document':
      return 'ContentDocument';
    default:
      return undefined;
  }
}

// The major of a release-pinned version string, or undefined when it does not start with one (which no real URI does -- a mismatch, never a parse).
function majorVersionOf(version: string): number | undefined {
  const match = /^(\d+)/.exec(version);
  if (match?.[1] === undefined) return undefined;
  return Number(match[1]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The one place a raw, unvalidated $schema value is read back out of an unknown input -- used by documentFromJson below, and exported on its own for a caller that only wants to know "what kind of document is this, if any" without also parsing the rest of the value. Version-agnostic on purpose: it answers "which kind does this URI name", not "may this installed release parse it" -- a value tagged by an older or newer release is still recognisable as "a DocumentPackage" from its file stem alone, and only documentFromJson applies the version gate. A layout-document URI returns undefined here because this package no longer defines that kind; documentFromJson recognises it separately and answers it with the demotion tombstone.
export function documentSchemaKindOf(value: unknown): DocumentSchemaKind | undefined {
  if (!isRecord(value)) return undefined;
  if (!('$schema' in value) || typeof value.$schema !== 'string') return undefined;
  const parts = parseSchemaUri(value.$schema);
  if (parts === undefined) return undefined;
  return kindForFileStem(parts.stem);
}

export type DocumentPackageJson = DocumentPackage & { readonly $schema: string };
export type ContentDocumentJson = ContentDocument & { readonly $schema: string };

// No re-validation here: the parameter type already guarantees a real DocumentPackage at the call site, so re-parsing it would be defensive code for a case that can't happen. $schema is spread first so it's also the first enumerable/JSON key.
//
// $schema is envelope metadata, not content: a content hash or structural comparison computed over a serialised dump must exclude it (document-outline.js's leafContentHash recipe -- canonicalise, stringify, SHA-256 -- is the family's stated canonicaliser, and the $schema key is stripped before that canonicalisation runs, never hashed alongside the content it merely labels). Two dumps of one document by two different installed releases hash equal once $schema is excluded; hashing it in would make the digest name the dumper, not the document.
export function documentPackageWithSchema(value: DocumentPackage): DocumentPackageJson {
  return { $schema: schemaUriFor('DocumentPackage'), ...value };
}

export function contentDocumentWithSchema(value: ContentDocument): ContentDocumentJson {
  return { $schema: schemaUriFor('ContentDocument'), ...value };
}

export class UnrecognizedDocumentSchemaError extends Error {
  readonly schema: unknown;

  constructor(schema: unknown) {
    super(
      `documentFromJson: value has no recognized "$schema" property (expected one of the document-schema.js .schema.json URIs; found: ${JSON.stringify(schema)}).`,
    );
    this.name = 'UnrecognizedDocumentSchemaError';
    this.schema = schema;
  }
}

// The demotion tombstone: a value stamped with the layout-document schema's URI was written by document-schema.js 3.x or earlier, and the schema it names now lives in pdf-codec. The pointer is the entire answer -- this release cannot validate the value, and pretending not to recognise the URI would hide the one fact the reader needs.
export class LayoutSchemaDemotedError extends Error {
  readonly schema: string;

  constructor(schema: string) {
    super(
      `documentFromJson: this value is a layout-document dump (${schema}), and LayoutDocument moved to pdf-codec in document-schema.js 4.0.0 (ExaDev/pdf-codec#65). Read it with pdf-codec's own layout model, or with a document-schema.js 3.x release.`,
    );
    this.name = 'LayoutSchemaDemotedError';
    this.schema = schema;
  }
}

// The version gate's refusal: the dump's URI names a release this installed package cannot validate. An older major gets the migration pointer (the formatVersion era and the flat DocumentPackage shape are what it is), a newer major the upgrade pointer.
export class SchemaVersionMismatchError extends Error {
  readonly schema: string;
  readonly dumpVersion: string;
  readonly installedVersion: string;

  constructor(schema: string, dumpVersion: string, installedVersion: string) {
    const dumpMajor = majorVersionOf(dumpVersion);
    const installedMajor = majorVersionOf(installedVersion);
    const isOlder = dumpMajor !== undefined && installedMajor !== undefined && dumpMajor < installedMajor;
    super(
      `documentFromJson: this dump's $schema pins document-schema.js@${dumpVersion}, but the installed release is @${installedVersion}, and a dump only parses under the major that wrote it.` +
        (isOlder
          ? ` Dumps from before 4.0.0 carry the retired formatVersion field and (for packages) the flat { formatVersion, content, pages } shape, replaced in 4.0.0 by the tree-form DocumentPackage (ExaDev/document-schema.js#20). Re-dump the value with a 4.x release, or parse it with the release that produced it.`
          : ` Upgrade document-schema.js to read it.`),
    );
    this.name = 'SchemaVersionMismatchError';
    this.schema = schema;
    this.dumpVersion = dumpVersion;
    this.installedVersion = installedVersion;
  }
}

export type DocumentJsonResult =
  | { kind: 'DocumentPackage'; value: DocumentPackage }
  | { kind: 'ContentDocument'; value: ContentDocument };

// The ingest entry point for a value of unknown provenance. $schema selects which schema to run and the version gate decides whether this release may run it; the schema itself still does the real structural validation (a recognized $schema with a structurally invalid body throws the underlying ZodError, not one of this module's errors). Within one major the installed schema validates the dump -- patch and minor releases are semver-compatible with the major's schema generation -- and across majors it refuses, because a major boundary is exactly where the schema's shape may have changed incompatibly (4.0.0's tree-form envelope being the live example). A caller that already knows the kind and trusts the value's provenance can keep calling DocumentPackageSchema.parse(value) (etc.) directly, unchanged -- these schemas are plain (non-strict) z.object()s, so they already tolerate and silently strip an incoming $schema property with zero new code -- but such a caller is validating structure only, not version: that is the documented difference between a direct parse and this dispatch.
export function documentFromJson(value: unknown): DocumentJsonResult {
  if (!isRecord(value) || typeof value.$schema !== 'string') {
    throw new UnrecognizedDocumentSchemaError(isRecord(value) ? value.$schema : undefined);
  }
  const parts = parseSchemaUri(value.$schema);
  if (parts === undefined) {
    throw new UnrecognizedDocumentSchemaError(value.$schema);
  }
  if (parts.stem === 'layout-document') {
    throw new LayoutSchemaDemotedError(value.$schema);
  }
  const kind = kindForFileStem(parts.stem);
  // kindForFileStem answers every stem the pattern matches besides the layout-document one intercepted above, so a defined kind here is guaranteed; the check exists because the type system cannot see the pattern and the stem union, not because it can genuinely fire.
  if (kind === undefined) {
    throw new UnrecognizedDocumentSchemaError(value.$schema);
  }
  const dumpMajor = majorVersionOf(parts.version);
  const installedMajor = majorVersionOf(__PACKAGE_VERSION__);
  if (dumpMajor !== installedMajor) {
    throw new SchemaVersionMismatchError(value.$schema, parts.version, __PACKAGE_VERSION__);
  }
  switch (kind) {
    case 'DocumentPackage':
      return { kind, value: DocumentPackageSchema.parse(value) };
    case 'ContentDocument':
      return { kind, value: ContentDocumentSchema.parse(value) };
  }
}
