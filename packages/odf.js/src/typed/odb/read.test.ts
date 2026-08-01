import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Package } from '../../model/package';
import type { XmlNode } from '../../model/node';
import { el, txt } from '../../xml/fragment';
import { parsePackage } from '../../package-io/read';
import { readOdbInventory } from './read';

// This suite reads a real, unmodified LibreOffice 26.2-generated .odb fixture (src/typed/odb/fixtures/embedded-firebird.odb, built via a headless UNO Basic macro creating a real embedded-Firebird database document with two live SQL tables and one real query -- see read.ts's own top-of-file note for the exact UNO calls and the three genuine findings it produced -- never hand-edited afterwards) for the genuine-producer-shape assertions, mirroring readOdt's and readOdm's own established convention. A handful of synthetic, hand-built packages (via el/txt, per this reader's own task brief) cover shapes the one real fixture can't -- an external connection, the two defensive db:database-description variants (never empirically observed), a fully-populated forms/reports/tables inventory (this session's own headless form/report automation attempt did not succeed -- see read.ts's own top-of-file note), and the part-classification guard the whole reader is built around.

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadFixture(name: string): Package {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
  return parsePackage(bytes);
}

function databaseContentPart(databaseChildren: XmlNode[]) {
  return { kind: 'xml' as const, nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:database', {}, databaseChildren)])])] };
}

function manifestPart(entries: readonly { fullPath: string; mediaType: string }[]) {
  const fileEntries = entries.map((entry) => el('manifest:file-entry', { 'manifest:full-path': entry.fullPath, 'manifest:media-type': entry.mediaType }));
  return { kind: 'xml' as const, nodes: [el('manifest:manifest', { 'manifest:version': '1.3' }, fileEntries)] };
}

const BASE_MANIFEST_ENTRIES = [
  { fullPath: '/', mediaType: 'application/vnd.oasis.opendocument.base' },
  { fullPath: 'content.xml', mediaType: 'text/xml' },
];

describe('readOdbInventory: embedded-firebird.odb (real LibreOffice output)', () => {
  const inventory = readOdbInventory(loadFixture('embedded-firebird.odb'));

  it('reads the real embedded connection info -- an "sdbc:embedded:" href classifies as embedded', () => {
    expect(inventory.connection).toEqual({ type: 'embedded', url: 'sdbc:embedded:firebird' });
  });

  it('never populates driverClass -- ODF has no driver-class-equivalent attribute anywhere in its db: schema', () => {
    expect('driverClass' in (inventory.connection ?? {})).toBe(false);
  });

  it('reads the one real query name, never its db:command SQL text', () => {
    expect(inventory.queries).toEqual(['CustomerList']);
  });

  it('reads an honestly empty tables array -- the two real tables (Customers, Orders) exist only inside the live Firebird engine, invisible to the ODF package itself', () => {
    expect(inventory.tables).toEqual([]);
  });

  it('reads empty forms/reports -- none were created in this fixture', () => {
    expect(inventory.forms).toEqual([]);
    expect(inventory.reports).toEqual([]);
  });
});

describe('readOdbInventory: synthetic fully-populated embedded package', () => {
  const pkg: Package = {
    parts: {
      'content.xml': databaseContentPart([
        el('db:data-source', {}, [el('db:connection-data', {}, [el('db:connection-resource', { 'xlink:href': 'sdbc:embedded:hsqldb', 'xlink:type': 'simple' })])]),
        el('db:queries', {}, [
          el('db:query', { 'db:name': 'Q1', 'db:command': 'SELECT * FROM "Customers"' }),
          el('db:query-collection', { 'db:name': 'Group1' }, [el('db:query', { 'db:name': 'Q2', 'db:command': 'SELECT * FROM "Orders"' })]),
        ]),
        el('db:table-representations', {}, [
          el('db:table-representation', { 'db:name': 'Customers' }),
          el('db:table-representation', { 'db:name': 'Orders' }),
        ]),
      ]),
      'META-INF/manifest.xml': manifestPart([
        ...BASE_MANIFEST_ENTRIES,
        { fullPath: 'forms/Form1/content.xml', mediaType: 'text/xml' },
        { fullPath: 'forms/Form1/styles.xml', mediaType: 'text/xml' },
        { fullPath: 'reports/Report1/content.xml', mediaType: 'text/xml' },
      ]),
    },
  };
  const inventory = readOdbInventory(pkg);

  it('reads db:connection-resource', () => {
    expect(inventory.connection).toEqual({ type: 'embedded', url: 'sdbc:embedded:hsqldb' });
  });

  it('reads both top-level and nested db:query-collection query names, in document order, without including the collection\'s own name', () => {
    expect(inventory.queries).toEqual(['Q1', 'Q2']);
  });

  it('reads table names from db:table-representations, deduplicated and in document order', () => {
    expect(inventory.tables).toEqual(['Customers', 'Orders']);
  });

  it('reads form/report names from the manifest\'s own sub-document parts, ignoring the sibling styles.xml part', () => {
    expect(inventory.forms).toEqual(['Form1']);
    expect(inventory.reports).toEqual(['Report1']);
  });
});

describe('readOdbInventory: external datasource', () => {
  it('classifies a non-"sdbc:embedded:" db:connection-resource href as external, with empty tables/queries/forms/reports', () => {
    const pkg: Package = {
      parts: {
        'content.xml': databaseContentPart([
          el('db:data-source', {}, [
            el('db:connection-data', {}, [
              el('db:connection-resource', { 'xlink:href': 'sdbc:mysql:jdbc://dbhost.example.com:3306/salesdb', 'xlink:type': 'simple' }),
              el('db:login', { 'db:user-name': 'sales_reader', 'db:is-password-required': 'true' }),
            ]),
          ]),
        ]),
        'META-INF/manifest.xml': manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    const inventory = readOdbInventory(pkg);
    expect(inventory.connection).toEqual({ type: 'external', url: 'sdbc:mysql:jdbc://dbhost.example.com:3306/salesdb' });
    expect(inventory.tables).toEqual([]);
    expect(inventory.queries).toEqual([]);
    expect(inventory.forms).toEqual([]);
    expect(inventory.reports).toEqual([]);
  });

  it('never surfaces db:login credentials -- OdbInventory has no field for them', () => {
    const pkg: Package = {
      parts: {
        'content.xml': databaseContentPart([
          el('db:data-source', {}, [el('db:connection-data', {}, [el('db:connection-resource', { 'xlink:href': 'sdbc:mysql:jdbc://dbhost.example.com:3306/salesdb', 'xlink:type': 'simple' }), el('db:login', { 'db:user-name': 'sales_reader' })])]),
        ]),
        'META-INF/manifest.xml': manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    const inventory = readOdbInventory(pkg);
    expect(inventory).not.toHaveProperty('login');
    expect(inventory.connection).not.toHaveProperty('userName');
  });
});

describe('readOdbInventory: db:database-description variants (RNG-derived, never empirically observed -- see read.ts\'s own top-of-file note)', () => {
  it('formats a db:server-database (hostname+port) into a descriptive url', () => {
    const pkg: Package = {
      parts: {
        'content.xml': databaseContentPart([
          el('db:data-source', {}, [
            el('db:connection-data', {}, [
              el('db:database-description', {}, [el('db:server-database', { 'db:type': 'mysql', 'db:hostname': 'db.example.com', 'db:port': '3306', 'db:database-name': 'salesdb' })]),
            ]),
          ]),
        ]),
        'META-INF/manifest.xml': manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(readOdbInventory(pkg).connection).toEqual({ type: 'external', url: 'mysql://db.example.com:3306/salesdb' });
  });

  it('formats a db:server-database (local socket, no database name) into a descriptive url', () => {
    const pkg: Package = {
      parts: {
        'content.xml': databaseContentPart([
          el('db:data-source', {}, [
            el('db:connection-data', {}, [el('db:database-description', {}, [el('db:server-database', { 'db:type': 'postgresql', 'db:local-socket-name': '/var/run/postgresql/.s.PGSQL.5432' })])]),
          ]),
        ]),
        'META-INF/manifest.xml': manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(readOdbInventory(pkg).connection).toEqual({ type: 'external', url: 'postgresql:///var/run/postgresql/.s.PGSQL.5432' });
  });

  it('reads a db:file-based-database href as an external connection', () => {
    const pkg: Package = {
      parts: {
        'content.xml': databaseContentPart([
          el('db:data-source', {}, [
            el('db:connection-data', {}, [el('db:database-description', {}, [el('db:file-based-database', { 'xlink:href': '../data/', 'xlink:type': 'simple', 'db:media-type': 'application/vnd.oasis.opendocument.spreadsheet' })])]),
          ]),
        ]),
        'META-INF/manifest.xml': manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(readOdbInventory(pkg).connection).toEqual({ type: 'external', url: '../data/' });
  });
});

describe('readOdbInventory: part-classification guard (the database/script risk, generalised to any manifest-listed sub-document)', () => {
  it('never misclassifies a non-XML-media-type part under forms/ as a real sub-document, even when its path looks like one', () => {
    const pkg: Package = {
      parts: {
        'content.xml': databaseContentPart([]),
        'database/script': { kind: 'binary', base64: Buffer.from('CREATE SCHEMA PUBLIC AUTHORIZATION DBA\nCREATE MEMORY TABLE "Customers"(...)\n', 'utf-8').toString('base64') },
        'META-INF/manifest.xml': manifestPart([
          ...BASE_MANIFEST_ENTRIES,
          { fullPath: 'database/script', mediaType: '' },
          { fullPath: 'forms/RealForm/content.xml', mediaType: 'text/xml' },
          { fullPath: 'forms/NotReallyXml/content.xml', mediaType: '' },
        ]),
      },
    };
    const inventory = readOdbInventory(pkg);
    expect(inventory.forms).toEqual(['RealForm']);
  });

  it('treats a manifest media type ending in "+xml" as XML-classified too, not only the literal "text/xml"', () => {
    const pkg: Package = {
      parts: {
        'content.xml': databaseContentPart([]),
        'META-INF/manifest.xml': manifestPart([...BASE_MANIFEST_ENTRIES, { fullPath: 'reports/Weird/content.xml', mediaType: 'application/vnd.oasis.opendocument.text+xml' }]),
      },
    };
    expect(readOdbInventory(pkg).reports).toEqual(['Weird']);
  });
});

describe('readOdbInventory: scope boundaries and error paths', () => {
  it('throws when the package has no content.xml part at all', () => {
    expect(() => readOdbInventory({ parts: {} })).toThrow(/content\.xml/);
  });

  it('throws when content.xml is not an XML part', () => {
    const pkg: Package = { parts: { 'content.xml': { kind: 'binary', base64: '' } } };
    expect(() => readOdbInventory(pkg)).toThrow(/content\.xml/);
  });

  it('throws when content.xml has no office:body/office:database element -- e.g. an odt-shaped content.xml', () => {
    const pkg: Package = { parts: { 'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:text')])])] } } };
    expect(() => readOdbInventory(pkg)).toThrow(/office:database/);
  });

  it('reads connection as undefined when office:database has no db:data-source/db:connection-data at all, without throwing', () => {
    const pkg: Package = { parts: { 'content.xml': databaseContentPart([]), 'META-INF/manifest.xml': manifestPart(BASE_MANIFEST_ENTRIES) } };
    const inventory = readOdbInventory(pkg);
    expect(inventory.connection).toBeUndefined();
    expect(inventory.tables).toEqual([]);
    expect(inventory.queries).toEqual([]);
    expect(inventory.forms).toEqual([]);
    expect(inventory.reports).toEqual([]);
  });

  it('reads connection as undefined when db:connection-data has neither db:connection-resource nor db:database-description', () => {
    const pkg: Package = {
      parts: {
        'content.xml': databaseContentPart([el('db:data-source', {}, [el('db:connection-data', {}, [txt('')])])]),
        'META-INF/manifest.xml': manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(readOdbInventory(pkg).connection).toBeUndefined();
  });
});
