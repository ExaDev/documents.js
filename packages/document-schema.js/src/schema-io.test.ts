import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLOR_BLACK } from './color';
import { CONTENT_FORMAT_VERSION, type ContentDocument } from './content';
import { LAYOUT_FORMAT_VERSION, type LayoutDocument } from './layout';
import { DOCUMENT_PACKAGE_FORMAT_VERSION, type DocumentPackage } from './package';
import {
  contentDocumentWithSchema,
  documentFromJson,
  documentPackageWithSchema,
  documentSchemaKindOf,
  layoutDocumentWithSchema,
  schemaUriFor,
  UnrecognizedDocumentSchemaError,
} from './schema-io';
import { DEFAULT_LAYOUT_FONT } from './style';

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

function wordprocessingDocument(): ContentDocument {
  return {
    kind: 'wordprocessing',
    formatVersion: CONTENT_FORMAT_VERSION,
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

function layoutDocument(): LayoutDocument {
  return {
    formatVersion: LAYOUT_FORMAT_VERSION,
    metadata: { title: 'schema-io fixture', author: 'document-schema.js' },
    pages: [
      {
        widthPt: 612,
        heightPt: 792,
        items: [
          {
            kind: 'text',
            text: 'Hello, schema-io.',
            xPt: 72,
            yPt: 720,
            font: DEFAULT_LAYOUT_FONT,
            sizePt: 12,
            color: COLOR_BLACK,
          },
        ],
      },
    ],
    images: {},
  };
}

function documentPackage(): DocumentPackage {
  return {
    formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION,
    content: wordprocessingDocument(),
    pages: [{ widthPt: 612, heightPt: 792 }],
  };
}

describe('schemaUriFor', () => {
  it('builds a jsdelivr URL pinned to the current published version, one per kind', () => {
    expect(schemaUriFor('DocumentPackage')).toBe(
      `https://cdn.jsdelivr.net/npm/document-schema.js@${packageVersion}/schemas/document-package.schema.json`,
    );
    expect(schemaUriFor('ContentDocument')).toBe(
      `https://cdn.jsdelivr.net/npm/document-schema.js@${packageVersion}/schemas/content-document.schema.json`,
    );
    expect(schemaUriFor('LayoutDocument')).toBe(
      `https://cdn.jsdelivr.net/npm/document-schema.js@${packageVersion}/schemas/layout-document.schema.json`,
    );
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

  it('layoutDocumentWithSchema stamps $schema as the first key and preserves every field', () => {
    const layout = layoutDocument();
    const tagged = layoutDocumentWithSchema(layout);
    expect(Object.keys(tagged)[0]).toBe('$schema');
    expect(tagged.$schema).toBe(schemaUriFor('LayoutDocument'));
    expect(tagged).toEqual({ $schema: schemaUriFor('LayoutDocument'), ...layout });
  });
});

describe('documentSchemaKindOf', () => {
  it('recognizes all three kinds', () => {
    expect(documentSchemaKindOf(documentPackageWithSchema(documentPackage()))).toBe('DocumentPackage');
    expect(documentSchemaKindOf(contentDocumentWithSchema(wordprocessingDocument()))).toBe('ContentDocument');
    expect(documentSchemaKindOf(layoutDocumentWithSchema(layoutDocument()))).toBe('LayoutDocument');
  });

  it('is version-agnostic: a $schema from a different installed version still resolves', () => {
    expect(
      documentSchemaKindOf({
        $schema: 'https://cdn.jsdelivr.net/npm/document-schema.js@0.0.1/schemas/document-package.schema.json',
      }),
    ).toBe('DocumentPackage');
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

describe('documentFromJson', () => {
  it('round-trips each kind end-to-end', () => {
    const pkg = documentPackage();
    expect(documentFromJson(documentPackageWithSchema(pkg))).toEqual({ kind: 'DocumentPackage', value: pkg });

    const content = wordprocessingDocument();
    expect(documentFromJson(contentDocumentWithSchema(content))).toEqual({ kind: 'ContentDocument', value: content });

    const layout = layoutDocument();
    expect(documentFromJson(layoutDocumentWithSchema(layout))).toEqual({ kind: 'LayoutDocument', value: layout });
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
});
