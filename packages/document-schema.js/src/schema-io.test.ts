import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ContentDocument } from './content';
import {
  type DocumentPackage,
  DocumentPackageSchema,
} from './package';
import type { SectionGroupNode } from './package-node';
import {
  contentDocumentWithSchema,
  documentFromJson,
  documentPackageWithSchema,
  documentSchemaKindOf,
  LayoutSchemaDemotedError,
  SchemaVersionMismatchError,
  schemaUriFor,
  UnrecognizedDocumentSchemaError,
} from './schema-io';

function isPackageJsonWithVersion(value: unknown): value is { version: string } {
  if (typeof value !== 'object' || value === null) return false;
  if (!('version' in value)) return false;
  return typeof value.version === 'string';
}

const parsedPackageJson: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
if (!isPackageJsonWithVersion(parsedPackageJson)) {
  throw new Error('package.json is missing a string "version" field');
}
const packageVersion: string = parsedPackageJson.version;
// The installed release's major, read the same way src/schema-io.ts's dispatch reads it -- every URI this test builds keys on this, so the suite stays correct whatever the dev package.json happens to say.
const installedMajor = Number(/^(\d+)/.exec(packageVersion)?.[1]);
const installedMajorMinusOne = installedMajor - 1;
const installedMajorPlusOne = installedMajor + 1;

function uriForVersion(majorOrVersion: number | string, stem: 'document-package' | 'content-document' | 'layout-document'): string {
  const version = typeof majorOrVersion === 'number' ? `${majorOrVersion}.0.0` : majorOrVersion;
  return `https://cdn.jsdelivr.net/npm/document-schema.js@${version}/schemas/${stem}.schema.json`;
}

function wordprocessingDocument(): ContentDocument {
  return {
    kind: 'wordprocessing',
    metadata: { title: 'schema-io fixture', author: 'document-schema.js' },
    sections: [
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        blocks: [{ kind: 'paragraph', runs: [{ text: 'Hello, schema-io.' }] }],
      },
    ],
  };
}

function documentPackage(): DocumentPackage {
  const section: SectionGroupNode = {
    node: { kind: 'section', pageSize: { widthPt: 612, heightPt: 792 }, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 } },
    children: [{ kind: 'paragraph', runs: [{ text: 'Hello, schema-io.' }] }],
  };
  return { kind: 'wordprocessing', metadata: { title: 'schema-io fixture' }, children: [section] };
}

describe('schemaUriFor', () => {
  it('builds a release-pinned jsdelivr URL, one per kind', () => {
    expect(schemaUriFor('DocumentPackage')).toBe(uriForVersion(packageVersion, 'document-package'));
    expect(schemaUriFor('ContentDocument')).toBe(uriForVersion(packageVersion, 'content-document'));
  });
});

describe('*WithSchema', () => {
  it('documentPackageWithSchema stamps $schema as the first key and preserves every field', () => {
    const pkg = documentPackage();
    const tagged = documentPackageWithSchema(pkg);
    expect(Object.keys(tagged)[0]).toBe('$schema');
    expect(tagged.$schema).toBe(schemaUriFor('DocumentPackage'));
    expect(tagged).toEqual({ $schema: schemaUriFor('DocumentPackage'), ...pkg });
  });

  it('contentDocumentWithSchema stamps $schema as the first key and preserves every field', () => {
    const doc = wordprocessingDocument();
    const tagged = contentDocumentWithSchema(doc);
    expect(Object.keys(tagged)[0]).toBe('$schema');
    expect(tagged.$schema).toBe(schemaUriFor('ContentDocument'));
    expect(tagged).toEqual({ $schema: schemaUriFor('ContentDocument'), ...doc });
  });
});

describe('documentSchemaKindOf', () => {
  it('recognizes both live kinds', () => {
    expect(documentSchemaKindOf(documentPackageWithSchema(documentPackage()))).toBe('DocumentPackage');
    expect(documentSchemaKindOf(contentDocumentWithSchema(wordprocessingDocument()))).toBe('ContentDocument');
  });

  it('is version-agnostic: a $schema from a different release still names its kind', () => {
    expect(documentSchemaKindOf({ $schema: uriForVersion(installedMajorPlusOne, 'document-package') })).toBe('DocumentPackage');
  });

  it('returns undefined for a layout-document URI -- that kind moved to pdf-codec', () => {
    expect(documentSchemaKindOf({ $schema: schemaUriFor('DocumentPackage').replace('document-package', 'layout-document') })).toBeUndefined();
  });

  it('returns undefined for a missing, non-string, or unrelated $schema', () => {
    expect(documentSchemaKindOf({})).toBeUndefined();
    expect(documentSchemaKindOf({ $schema: 42 })).toBeUndefined();
    expect(documentSchemaKindOf({ $schema: 'https://example.com/not-a-real-schema.json' })).toBeUndefined();
  });

  it('returns undefined for non-object input', () => {
    expect(documentSchemaKindOf(null)).toBeUndefined();
    expect(documentSchemaKindOf(undefined)).toBeUndefined();
    expect(documentSchemaKindOf('a string')).toBeUndefined();
    expect(documentSchemaKindOf(['array', 'not', 'record'])).toBeUndefined();
  });
});

describe('documentFromJson dispatches on the $schema URI', () => {
  it('round-trips each live kind stamped with the installed release URI', () => {
    const pkg = documentPackage();
    expect(documentFromJson(documentPackageWithSchema(pkg))).toEqual({ kind: 'DocumentPackage', value: pkg });

    const content = wordprocessingDocument();
    expect(documentFromJson(contentDocumentWithSchema(content))).toEqual({ kind: 'ContentDocument', value: content });
  });

  it('accepts a URI from another release of the SAME major -- patch and minor releases validate a major\'s dumps', () => {
    const pkg = documentPackage();
    const tagged = { ...documentPackageWithSchema(pkg), $schema: uriForVersion(`${installedMajor}.9.9`, 'document-package') };
    expect(documentFromJson(tagged)).toEqual({ kind: 'DocumentPackage', value: pkg });
  });

  it('refuses an older major\'s URI and names the change -- the formatVersion era and the flat package shape', () => {
    const oldDump = {
      $schema: uriForVersion(installedMajorMinusOne, 'document-package'),
      formatVersion: 2,
      content: { kind: 'wordprocessing', metadata: {}, sections: [] },
    };
    try {
      documentFromJson(oldDump);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaVersionMismatchError);
      if (!(error instanceof SchemaVersionMismatchError)) throw error;
      expect(error.dumpVersion).toBe(`${installedMajorMinusOne}.0.0`);
      expect(error.installedVersion).toBe(packageVersion);
      expect(error.message).toContain('formatVersion');
      expect(error.message).toContain('tree-form DocumentPackage');
      expect(error.message).toContain('ExaDev/document-schema.js#20');
    }
  });

  it('refuses a newer major\'s URI with the upgrade pointer', () => {
    const futureDump = { $schema: uriForVersion(installedMajorPlusOne, 'document-package') };
    try {
      documentFromJson(futureDump);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaVersionMismatchError);
      if (!(error instanceof SchemaVersionMismatchError)) throw error;
      expect(error.message).toContain('Upgrade document-schema.js');
    }
  });

  it('tombstones a layout-document URI from any release with the pointer to pdf-codec', () => {
    for (const version of [1, 2, 3, installedMajor, installedMajorPlusOne]) {
      const layoutDump = { $schema: uriForVersion(version, 'layout-document'), pages: [] };
      try {
        documentFromJson(layoutDump);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(LayoutSchemaDemotedError);
        if (!(error instanceof LayoutSchemaDemotedError)) throw error;
        expect(error.schema).toBe(uriForVersion(version, 'layout-document'));
        expect(error.message).toContain('pdf-codec');
        expect(error.message).toContain('ExaDev/pdf-codec#65');
      }
    }
  });

  it('throws UnrecognizedDocumentSchemaError, carrying the offending value, for unrecognized input', () => {
    expect(() => documentFromJson({ $schema: 'https://example.com/not-a-real-schema.json' })).toThrow(
      UnrecognizedDocumentSchemaError,
    );
    try {
      documentFromJson({ $schema: 'https://example.com/not-a-real-schema.json' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UnrecognizedDocumentSchemaError);
      if (!(error instanceof UnrecognizedDocumentSchemaError)) throw error;
      expect(error.schema).toBe('https://example.com/not-a-real-schema.json');
    }

    expect(() => documentFromJson({})).toThrow(UnrecognizedDocumentSchemaError);
    expect(() => documentFromJson(null)).toThrow(UnrecognizedDocumentSchemaError);
  });

  it('a recognized $schema with a structurally invalid body throws the underlying ZodError, not UnrecognizedDocumentSchemaError', () => {
    expect(() => documentFromJson({ $schema: schemaUriFor('DocumentPackage') })).toThrow();
    expect(() => documentFromJson({ $schema: schemaUriFor('DocumentPackage') })).not.toThrow(
      UnrecognizedDocumentSchemaError,
    );
  });

  it('a bare DocumentPackageSchema.parse does not version-discriminate: it structurally validates whatever it is handed', () => {
    // The documented contract (src/schema-io.ts): a direct parse validates structure only. This value carries a foreign version's $schema, which documentFromJson would refuse -- the direct parse accepts, because the installed schema's shape tolerates and strips the unknown $schema key and the tree underneath is valid.
    const foreignTagged = {
      ...documentPackage(),
      $schema: uriForVersion(installedMajorPlusOne, 'document-package'),
    } as unknown;
    expect(DocumentPackageSchema.safeParse(foreignTagged).success).toBe(true);
  });
});
