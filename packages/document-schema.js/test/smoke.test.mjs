// Verifies the built dist/ output actually loads and exposes the public surface, in both ESM and CJS. Run only via `pnpm test:smoke` (which rebuilds dist/ and schemas/ first, via `pnpm run build`) -- deliberately outside the "unit" vitest project and outside tsconfig's "src" program, since it tests build output rather than source.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('smoke: ESM/CJS parity', () => {
  it('loads the ESM build and exposes ContentDocumentSchema/LayoutDocumentSchema', async () => {
    const esm = await import('../dist/index.js');
    expect(typeof esm.ContentDocumentSchema.parse).toBe('function');
    expect(typeof esm.LayoutDocumentSchema.parse).toBe('function');
  });

  it('loads the CJS build and exposes ContentDocumentSchema/LayoutDocumentSchema', () => {
    const require = createRequire(import.meta.url);
    const cjs = require('../dist/index.cjs');
    expect(typeof cjs.ContentDocumentSchema.parse).toBe('function');
    expect(typeof cjs.LayoutDocumentSchema.parse).toBe('function');
  });
});

// Verifies scripts/generate-json-schemas.mjs's own output: the three published .schema.json files (see package.json's "files"/"exports"), generated fresh by `pnpm run build` immediately before this test project runs.
describe('smoke: generated JSON Schema files', () => {
  const schemasDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas');
  const SHA_PATTERN = /^[0-9a-f]{40}$/; // a real commit SHA, not a hardcoded specific one -- it changes every commit

  function readSchema(fileName) {
    return JSON.parse(readFileSync(join(schemasDir, fileName), 'utf8'));
  }

  it('all three .schema.json files exist and parse as valid JSON', () => {
    for (const fileName of ['document-package.schema.json', 'content-document.schema.json', 'layout-document.schema.json']) {
      expect(() => readSchema(fileName)).not.toThrow();
    }
  });

  it("document-package.schema.json's $id is a commit-SHA-pinned raw GitHub URL, and its content/layout refs share that same SHA", () => {
    const documentPackage = readSchema('document-package.schema.json');
    const idMatch = /^https:\/\/raw\.githubusercontent\.com\/ExaDev\/document-schema\.js\/([0-9a-f]{40})\/schemas\/document-package\.schema\.json$/.exec(
      documentPackage.$id,
    );
    expect(idMatch).not.toBeNull();
    const sha = idMatch[1];
    expect(sha).toMatch(SHA_PATTERN);
    expect(documentPackage.properties.content.$ref).toBe(
      `https://raw.githubusercontent.com/ExaDev/document-schema.js/${sha}/schemas/content-document.schema.json`,
    );
    expect(documentPackage.properties.layout.$ref).toBe(
      `https://raw.githubusercontent.com/ExaDev/document-schema.js/${sha}/schemas/layout-document.schema.json`,
    );
    expect(documentPackage.required).toEqual(expect.arrayContaining(['formatVersion', 'content']));
  });

  it("content-document.schema.json's root is a bare oneOf of the 4 ContentDocument variants, and $defs.ContentBlock has 5 members", () => {
    const contentDocument = readSchema('content-document.schema.json');
    expect(contentDocument).not.toHaveProperty('type');
    expect(contentDocument.oneOf).toHaveLength(4);
    expect(contentDocument.$defs.ContentBlock.oneOf).toHaveLength(5);
  });

  it('layout-document.schema.json has the expected pages/images shape', () => {
    const layoutDocument = readSchema('layout-document.schema.json');
    expect(layoutDocument.type).toBe('object');
    expect(layoutDocument.properties.pages.type).toBe('array');
    expect(layoutDocument.properties.pages.items.type).toBe('object');
    expect(layoutDocument.properties.images.type).toBe('object');
    expect(layoutDocument.properties.images.additionalProperties.type).toBe('object');
  });
});
