import { type ContentDocument, ContentDocumentSchema } from './content';
import { type LayoutDocument, LayoutDocumentSchema } from './layout';
import { type DocumentPackage, DocumentPackageSchema } from './package';

// The three kinds published as .schema.json files (see scripts/generate-json-schemas.mjs, which imports SCHEMA_FILE_NAMES/schemaUriFor from this module rather than declaring its own copy). Kept in one place so the id string, the filename, and the URL are never edited independently.
export type DocumentSchemaKind = 'DocumentPackage' | 'ContentDocument' | 'LayoutDocument';

export const SCHEMA_FILE_NAMES: Record<DocumentSchemaKind, string> = {
  DocumentPackage: 'document-package.schema.json',
  ContentDocument: 'content-document.schema.json',
  LayoutDocument: 'layout-document.schema.json',
};

// __PACKAGE_VERSION__ is a literal string constant, not a runtime read -- see src/global.d.ts, tsdown.config.ts, and vitest.config.ts.
export function schemaUriFor(kind: DocumentSchemaKind): string {
  return `https://cdn.jsdelivr.net/npm/document-schema.js@${__PACKAGE_VERSION__}/schemas/${SCHEMA_FILE_NAMES[kind]}`;
}

// Version-agnostic on purpose: a value tagged by an older or newer installed version of this package is still recognisable as "a DocumentPackage" (etc.) from its $schema alone -- only the capturing group (the file stem) is used, the @<version> segment is deliberately not constrained beyond "no slash".
const SCHEMA_URI_PATTERN =
  /^https:\/\/cdn\.jsdelivr\.net\/npm\/document-schema\.js@[^/]+\/schemas\/(document-package|content-document|layout-document)\.schema\.json$/;

function kindForFileStem(stem: string): DocumentSchemaKind | undefined {
  switch (stem) {
    case 'document-package':
      return 'DocumentPackage';
    case 'content-document':
      return 'ContentDocument';
    case 'layout-document':
      return 'LayoutDocument';
    default:
      return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The one place a raw, unvalidated $schema value is read back out of an unknown input -- used by documentFromJson below, and exported on its own for a caller that only wants to know "what kind of document is this, if any" without also parsing the rest of the value.
export function documentSchemaKindOf(value: unknown): DocumentSchemaKind | undefined {
  if (!isRecord(value)) return undefined;
  if (!('$schema' in value) || typeof value.$schema !== 'string') return undefined;
  const match = SCHEMA_URI_PATTERN.exec(value.$schema);
  if (match === null) return undefined;
  const stem = match[1];
  // noUncheckedIndexedAccess types every array/RegExpExecArray element as possibly undefined; this particular capture group is mandatory in the pattern above, so a successful match always populates it -- this check exists to satisfy that, not because it can genuinely fire.
  if (stem === undefined) return undefined;
  return kindForFileStem(stem);
}

export type DocumentPackageJson = DocumentPackage & { readonly $schema: string };
export type ContentDocumentJson = ContentDocument & { readonly $schema: string };
export type LayoutDocumentJson = LayoutDocument & { readonly $schema: string };

// No re-validation here: the parameter type already guarantees a real DocumentPackage at the call site, so re-parsing it would be defensive code for a case that can't happen. $schema is spread first so it's also the first enumerable/JSON key.
export function documentPackageWithSchema(value: DocumentPackage): DocumentPackageJson {
  return { $schema: schemaUriFor('DocumentPackage'), ...value };
}

export function contentDocumentWithSchema(value: ContentDocument): ContentDocumentJson {
  return { $schema: schemaUriFor('ContentDocument'), ...value };
}

export function layoutDocumentWithSchema(value: LayoutDocument): LayoutDocumentJson {
  return { $schema: schemaUriFor('LayoutDocument'), ...value };
}

export class UnrecognizedDocumentSchemaError extends Error {
  readonly schema: unknown;

  constructor(schema: unknown) {
    super(
      `documentFromJson: value has no recognized "$schema" property (expected one of the three document-schema.js .schema.json URIs; found: ${JSON.stringify(schema)}).`,
    );
    this.name = 'UnrecognizedDocumentSchemaError';
    this.schema = schema;
  }
}

export type DocumentJsonResult =
  | { kind: 'DocumentPackage'; value: DocumentPackage }
  | { kind: 'ContentDocument'; value: ContentDocument }
  | { kind: 'LayoutDocument'; value: LayoutDocument };

// The genuinely new ingest capability: a caller that already knows the kind can keep calling DocumentPackageSchema.parse(value) (etc.) directly, unchanged -- these schemas are all plain (non-strict) z.object()s, so they already tolerate and silently strip an incoming $schema property with zero new code. This function exists for the "don't yet know the kind" case: $schema selects which schema to run; the schema itself still does the real structural validation (a recognized $schema with a structurally invalid body throws the underlying ZodError, not UnrecognizedDocumentSchemaError).
export function documentFromJson(value: unknown): DocumentJsonResult {
  const kind = documentSchemaKindOf(value);
  if (kind === undefined) {
    throw new UnrecognizedDocumentSchemaError(isRecord(value) ? value.$schema : undefined);
  }
  switch (kind) {
    case 'DocumentPackage':
      return { kind, value: DocumentPackageSchema.parse(value) };
    case 'ContentDocument':
      return { kind, value: ContentDocumentSchema.parse(value) };
    case 'LayoutDocument':
      return { kind, value: LayoutDocumentSchema.parse(value) };
  }
}
