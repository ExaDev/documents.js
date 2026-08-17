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
  const packageVersion = JSON.parse(readFileSync(join(schemasDir, '..', 'package.json'), 'utf8')).version;

  function readSchema(fileName) {
    return JSON.parse(readFileSync(join(schemasDir, fileName), 'utf8'));
  }

  it('all three .schema.json files exist and parse as valid JSON', () => {
    for (const fileName of ['document-package.schema.json', 'content-document.schema.json', 'layout-document.schema.json']) {
      expect(() => readSchema(fileName)).not.toThrow();
    }
  });

  it("document-package.schema.json's $id is a jsdelivr URL pinned to the package's own published version, and its content ref shares that same version", () => {
    const documentPackage = readSchema('document-package.schema.json');
    expect(documentPackage.$id).toBe(
      `https://cdn.jsdelivr.net/npm/document-schema.js@${packageVersion}/schemas/document-package.schema.json`,
    );
    expect(documentPackage.properties.content.$ref).toBe(
      `https://cdn.jsdelivr.net/npm/document-schema.js@${packageVersion}/schemas/content-document.schema.json`,
    );
    // The fused-tree design (see src/package.ts): no more standalone `layout` field pairing a whole separate LayoutDocument -- position now lives on content nodes themselves via their own `frames`, and all that remains at the package level is each rendered page's own size.
    expect(documentPackage.properties).not.toHaveProperty('layout');
    expect(documentPackage.properties.pages.type).toBe('array');
    expect(documentPackage.properties.pages.items.required).toEqual(
      expect.arrayContaining(['widthPt', 'heightPt']),
    );
    expect(documentPackage.required).toEqual(expect.arrayContaining(['formatVersion', 'content']));
    expect(documentPackage.required).not.toEqual(expect.arrayContaining(['pages']));
  });

  it("content-document.schema.json's $defs.LayoutFrame and ContentParagraph's headingLevel/frames fields are present, matching the fused-tree design", () => {
    const contentDocument = readSchema('content-document.schema.json');
    expect(contentDocument.$defs.LayoutFrame.required).toEqual(
      expect.arrayContaining(['pageIndex', 'xPt', 'yPt', 'widthPt', 'heightPt']),
    );
    expect(contentDocument.$defs.ContentParagraph.properties.headingLevel.type).toBe('integer');
    expect(contentDocument.$defs.ContentParagraph.properties.frames.items.$ref).toBe('#/$defs/LayoutFrame');
  });

  it("content-document.schema.json's root is a bare oneOf of the 5 ContentDocument variants, and $defs.ContentBlock has 5 members", () => {
    const contentDocument = readSchema('content-document.schema.json');
    expect(contentDocument).not.toHaveProperty('type');
    expect(contentDocument.oneOf).toHaveLength(5);
    expect(contentDocument.$defs.ContentBlock.oneOf).toHaveLength(5);
  });

  it("content-document.schema.json's formula variant refs the hand-authored recursive MathMlNode definition", () => {
    const contentDocument = readSchema('content-document.schema.json');
    const formula = contentDocument.oneOf.find((variant) => variant.properties.kind.const === 'formula');
    expect(formula.properties.formula.properties.mathml.items.$ref).toBe('#/$defs/MathMlNode');
    expect(contentDocument.$defs.MathMlNode.oneOf).toHaveLength(6);
    // The recursion itself: an element's children point back at the shared MathMlNode definition rather than inlining.
    expect(contentDocument.$defs.MathMlElement.properties.children.items.$ref).toBe('#/$defs/MathMlNode');
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
