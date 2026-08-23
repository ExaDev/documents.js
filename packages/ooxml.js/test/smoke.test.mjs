// Smoke test: the built dist/ artifact loads and works under both ESM and CJS. Run only via `pnpm test:smoke` (tsdown, then vitest scoped to this file by vitest.smoke.config.ts) -- never part of the default `pnpm test` file set, since it requires a fresh build to mean anything.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as esm from '../dist/index.js';

const require = createRequire(import.meta.url);
const cjs = require('../dist/index.cjs');

const FUNCTIONS = [
  'decodePackage',
  'encodePackage',
  'zipPackage',
  'readDocx',
  'readPptx',
  'readXlsx',
  'buildDocxPackage',
  'buildXlsxPackage',
  'readDocxContent',
  'readPptxContent',
  'readXlsxWorkbook',
  'readXlsxContent',
  'buildDocxPackageFromContent',
  'buildXlsxPackageFromContent',
  'assembleTree',
  'flattenTree',
  'toCompact',
  'fromCompact',
  'decodeCompactPackage',
  'encodeCompactPackage',
];
const OBJECTS = ['packageCodec', 'xmlCodec', 'compactCodec', 'compactPackageCodec'];

describe('dist/ exports are present in both builds', () => {
  for (const name of FUNCTIONS) {
    it(`${name} is a function`, () => {
      expect(typeof esm[name]).toBe('function');
      expect(typeof cjs[name]).toBe('function');
    });
  }

  for (const name of OBJECTS) {
    it(`${name} is exported`, () => {
      expect(esm[name]).toBeDefined();
      expect(cjs[name]).toBeDefined();
    });
  }
});

const enc = (s) => new TextEncoder().encode(s);
const bytes = esm.zipPackage({
  '[Content_Types].xml': enc(
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  ),
  '_rels/.rels': enc(
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  ),
  'word/document.xml': enc(
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Smoke &amp; test</w:t></w:r></w:p></w:body></w:document>',
  ),
});

describe.each([
  ['ESM', esm],
  ['CJS', cjs],
])('%s artifact behaviour', (_label, api) => {
  const pkg1 = api.decodePackage(bytes);

  it('round-trips decode -> encode -> decode idempotently', () => {
    expect(api.decodePackage(api.encodePackage(pkg1))).toEqual(pkg1);
  });

  it('readDocxContent extracts decoded entity text', () => {
    const doc = api.readDocxContent(pkg1);
    const firstBlock = doc.sections[0]?.blocks[0];
    expect(firstBlock?.kind).toBe('paragraph');
    expect(firstBlock?.kind === 'paragraph' ? firstBlock.runs[0]?.text : undefined).toBe('Smoke & test');
  });

  it('readDocx returns the tree-form DocumentTree, and buildDocxPackage writes it back', () => {
    const document = api.readDocx(pkg1);
    expect(document.kind).toBe('wordprocessing');
    expect(api.readDocx(api.decodePackage(api.encodePackage(api.buildDocxPackage(document))))).toEqual(document);
  });

  it('the Package <-> CompactPackage codec round-trips', () => {
    expect(api.fromCompact(api.toCompact(pkg1))).toEqual(pkg1);
  });

  it('the bytes <-> CompactPackage codec round-trips', () => {
    expect(api.decodePackage(api.encodeCompactPackage(api.decodeCompactPackage(bytes)))).toEqual(pkg1);
  });
});
