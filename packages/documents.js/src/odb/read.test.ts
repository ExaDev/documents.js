import type { Package, XmlNode } from 'odf.js';
import { bytesToBase64, el } from 'odf.js';
import { describe, expect, it } from 'vitest';
import { HsqldbScriptParseError } from '../hsqldb/script';
import { OdbNoEmbeddedDataSourceError, OdbUnsupportedFormatError, readOdbTables } from './read';

// Mirrors odf.js's own src/typed/odb/read.test.ts fixture-building style (databaseContentPart/manifestPart) -- readOdbTables sits directly on top of readOdbInventory, so its own tests build the identical minimal Package shape rather than a real .odb file. src/convert/odb.test.ts covers the genuine byte-level odbToXlsx/odbToCsv round trip separately.

function databaseContentPart(databaseChildren: XmlNode[]): Package['parts'][string] {
  return { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:database', {}, databaseChildren)])])] };
}

function manifestPart(entries: readonly { readonly fullPath: string; readonly mediaType: string }[]): Package['parts'][string] {
  const fileEntries = entries.map((entry) => el('manifest:file-entry', { 'manifest:full-path': entry.fullPath, 'manifest:media-type': entry.mediaType }));
  return { kind: 'xml', nodes: [el('manifest:manifest', { 'manifest:version': '1.3' }, fileEntries)] };
}

const BASE_MANIFEST_ENTRIES = [
  { fullPath: '/', mediaType: 'application/vnd.oasis.opendocument.base' },
  { fullPath: 'content.xml', mediaType: 'text/xml' },
];

function connectionResource(href: string): XmlNode {
  return el('db:data-source', {}, [el('db:connection-data', {}, [el('db:connection-resource', { 'xlink:href': href, 'xlink:type': 'simple' })])]);
}

const HSQLDB_SCRIPT = ['CREATE MEMORY TABLE T(A INTEGER,B VARCHAR(10))', "INSERT INTO T VALUES(1,'x')"].join('\n');

function binaryPart(text: string): Package['parts'][string] {
  return { kind: 'binary', base64: bytesToBase64(new TextEncoder().encode(text)) };
}

// Narrows a thrown OdbUnsupportedFormatError's own `format` field without a type assertion -- `instanceof` inside a catch block is a genuine type guard, unlike casting whatever expect().toBeInstanceOf() was given.
function formatOfThrownError(fn: () => unknown): OdbUnsupportedFormatError['format'] {
  try {
    fn();
  } catch (error) {
    if (error instanceof OdbUnsupportedFormatError) {
      return error.format;
    }
    throw error;
  }
  throw new Error('expected fn() to throw');
}

describe('readOdbTables: embedded HSQLDB text script (happy path)', () => {
  it('routes to the Tier 1 parser and returns its tables', () => {
    const pkg: Package = {
      parts: {
        'content.xml': databaseContentPart([connectionResource('sdbc:embedded:hsqldb')]),
        'META-INF/manifest.xml': manifestPart([...BASE_MANIFEST_ENTRIES, { fullPath: 'database/script', mediaType: '' }]),
        'database/script': binaryPart(HSQLDB_SCRIPT),
      },
    };
    const tables = readOdbTables(pkg);
    expect(tables).toEqual([{ tableName: 'T', columns: [{ name: 'A', type: 'INTEGER' }, { name: 'B', type: 'VARCHAR(10)' }], rows: [[{ kind: 'number', value: 1 }, { kind: 'string', value: 'x' }]] }]);
  });
});

describe('readOdbTables: no embedded data source', () => {
  it('throws OdbNoEmbeddedDataSourceError for an external MySQL connection', () => {
    const pkg: Package = {
      parts: {
        'content.xml': databaseContentPart([connectionResource('sdbc:mysql:jdbc://dbhost.example.com:3306/salesdb')]),
        'META-INF/manifest.xml': manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(() => readOdbTables(pkg)).toThrow(OdbNoEmbeddedDataSourceError);
    expect(() => readOdbTables(pkg)).toThrow(/external datasource/);
  });

  it('throws OdbNoEmbeddedDataSourceError when office:database has no db:data-source at all', () => {
    const pkg: Package = {
      parts: {
        'content.xml': databaseContentPart([]),
        'META-INF/manifest.xml': manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(() => readOdbTables(pkg)).toThrow(OdbNoEmbeddedDataSourceError);
  });
});

describe('readOdbTables: unsupported embedded formats -- named, never silent', () => {
  it('throws OdbUnsupportedFormatError naming Firebird for an embedded Firebird connection, even with no database/script part at all', () => {
    const pkg: Package = {
      parts: {
        'content.xml': databaseContentPart([connectionResource('sdbc:embedded:firebird')]),
        'META-INF/manifest.xml': manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(() => readOdbTables(pkg)).toThrow(OdbUnsupportedFormatError);
    expect(formatOfThrownError(() => readOdbTables(pkg))).toBe('firebird');
  });

  it('throws OdbUnsupportedFormatError for an unrecognised embedded engine name', () => {
    const pkg: Package = {
      parts: {
        'content.xml': databaseContentPart([connectionResource('sdbc:embedded:derby')]),
        'META-INF/manifest.xml': manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(() => readOdbTables(pkg)).toThrow(/embedded "derby" database engine/);
  });

  it('throws OdbUnsupportedFormatError naming HSQLDB\'s binary script format for a binary-format-simulated database/script', () => {
    const pkg: Package = {
      parts: {
        'content.xml': databaseContentPart([connectionResource('sdbc:embedded:hsqldb')]),
        'META-INF/manifest.xml': manifestPart([...BASE_MANIFEST_ENTRIES, { fullPath: 'database/script', mediaType: '' }]),
        // Simulated HSQLDB BINARY script format (hsqldb.script_format=1): arbitrary non-text bytes, including a NUL and other C0 control bytes real SQL text never contains.
        'database/script': { kind: 'binary', base64: bytesToBase64(new Uint8Array([0x01, 0x02, 0x00, 0x10, 0x20, 0x7f, 0xff, 0xfe])) },
      },
    };
    expect(() => readOdbTables(pkg)).toThrow(OdbUnsupportedFormatError);
    expect(formatOfThrownError(() => readOdbTables(pkg))).toBe('hsqldb-binary');
    expect(() => readOdbTables(pkg)).toThrow(/binary script format/);
  });

  it('throws OdbUnsupportedFormatError naming HSQLDB\'s compressed script format for gzip-magic-prefixed bytes', () => {
    const pkg: Package = {
      parts: {
        'content.xml': databaseContentPart([connectionResource('sdbc:embedded:hsqldb')]),
        'META-INF/manifest.xml': manifestPart([...BASE_MANIFEST_ENTRIES, { fullPath: 'database/script', mediaType: '' }]),
        'database/script': { kind: 'binary', base64: bytesToBase64(new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00])) },
      },
    };
    expect(() => readOdbTables(pkg)).toThrow(OdbUnsupportedFormatError);
    expect(formatOfThrownError(() => readOdbTables(pkg))).toBe('hsqldb-compressed');
  });

  it('throws OdbUnsupportedFormatError when an embedded HSQLDB connection has no database/script part at all', () => {
    const pkg: Package = {
      parts: {
        'content.xml': databaseContentPart([connectionResource('sdbc:embedded:hsqldb')]),
        'META-INF/manifest.xml': manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(() => readOdbTables(pkg)).toThrow(/no database\/script part/);
  });
});

describe('readOdbTables: part-classification guard', () => {
  it('throws a distinct error when database/script is declared as an XML sub-document in the manifest', () => {
    const pkg: Package = {
      parts: {
        'content.xml': databaseContentPart([connectionResource('sdbc:embedded:hsqldb')]),
        'META-INF/manifest.xml': manifestPart([...BASE_MANIFEST_ENTRIES, { fullPath: 'database/script', mediaType: 'text/xml' }]),
        'database/script': binaryPart(HSQLDB_SCRIPT),
      },
    };
    expect(() => readOdbTables(pkg)).toThrow(/declared as an XML sub-document/);
  });
});

describe('readOdbTables: propagates HsqldbScriptParseError for a genuinely malformed text script', () => {
  it('throws HsqldbScriptParseError, not a generic error, for an unrecognised statement', () => {
    const pkg: Package = {
      parts: {
        'content.xml': databaseContentPart([connectionResource('sdbc:embedded:hsqldb')]),
        'META-INF/manifest.xml': manifestPart([...BASE_MANIFEST_ENTRIES, { fullPath: 'database/script', mediaType: '' }]),
        'database/script': binaryPart('SELECT * FROM T'),
      },
    };
    expect(() => readOdbTables(pkg)).toThrow(HsqldbScriptParseError);
  });
});
