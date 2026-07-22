// Smoke test: the built dist/ artifact loads and works under both ESM and CJS. Run after `pnpm build` (or via `pnpm test:smoke`).
import { createRequire } from 'node:module';
import * as esm from '../dist/index.js';

const require = createRequire(import.meta.url);
const cjs = require('../dist/index.cjs');

const functions = ['decodePackage', 'encodePackage', 'zipPackage', 'readDocx', 'readPptx', 'readXlsx'];
const objects = ['packageCodec', 'xmlCodec'];
for (const name of functions) {
  if (typeof esm[name] !== 'function') throw new Error(`ESM build is missing function export: ${name}`);
  if (typeof cjs[name] !== 'function') throw new Error(`CJS build is missing function export: ${name}`);
}
for (const name of objects) {
  if (esm[name] === undefined) throw new Error(`ESM build is missing export: ${name}`);
  if (cjs[name] === undefined) throw new Error(`CJS build is missing export: ${name}`);
}

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

// ESM artifact: round-trip idempotency + typed read.
const pkg1 = esm.decodePackage(bytes);
const pkg2 = esm.decodePackage(esm.encodePackage(pkg1));
if (JSON.stringify(pkg1) !== JSON.stringify(pkg2)) throw new Error('ESM round-trip is not idempotent');
const doc = esm.readDocx(pkg1);
if (doc.paragraphs[0]?.runs[0]?.text !== 'Smoke & test') {
  throw new Error('ESM readDocx did not extract the expected decoded text');
}

// CJS artifact: same functional behaviour.
const cdoc = cjs.readDocx(cjs.decodePackage(bytes));
if (cdoc.paragraphs[0]?.runs[0]?.text !== 'Smoke & test') {
  throw new Error('CJS readDocx did not extract the expected decoded text');
}

console.log('smoke OK: ESM and CJS builds both load, expose the same API, round-trip idempotently, and decode entities');
