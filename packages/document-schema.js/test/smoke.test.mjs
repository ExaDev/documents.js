// Verifies the built dist/ output actually loads and exposes the public surface, in both ESM and CJS. Run only via `pnpm test:smoke` (which rebuilds dist/ and schemas/ first, via `pnpm run build`) -- deliberately outside the "unit" vitest project and outside tsconfig's "src" program, since it tests build output rather than source.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('smoke: ESM/CJS parity', () => {
  it('loads the ESM build and exposes the tree-form package and node schemas', async () => {
    const esm = await import('../dist/index.js');
    expect(typeof esm.DocumentPackageSchema.parse).toBe('function');
    expect(typeof esm.PackageNodeSchema.safeParse).toBe('function');
    expect(typeof esm.resolveStyleChain).toBe('function');
    expect(esm.LayoutDocumentSchema).toBeUndefined();
  });

  it('loads the CJS build and exposes the tree-form package and node schemas', () => {
    const require = createRequire(import.meta.url);
    const cjs = require('../dist/index.cjs');
    expect(typeof cjs.DocumentPackageSchema.parse).toBe('function');
    expect(typeof cjs.PackageNodeSchema.safeParse).toBe('function');
    expect(typeof cjs.resolveStyleChain).toBe('function');
    expect(cjs.LayoutDocumentSchema).toBeUndefined();
  });
});

// Verifies scripts/generate-json-schemas.mjs's own output: the two published .schema.json files (see package.json's "files"/"exports"), generated fresh by `pnpm run build` immediately before this test project runs.
describe('smoke: generated JSON Schema files', () => {
  const schemasDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas');
  const packageVersion = JSON.parse(readFileSync(join(schemasDir, '..', 'package.json'), 'utf8')).version;

  function readSchema(fileName) {
    return JSON.parse(readFileSync(join(schemasDir, fileName), 'utf8'));
  }

  it('both .schema.json files exist and parse as valid JSON, and the demoted layout-document file is gone', () => {
    for (const fileName of ['document-package.schema.json', 'content-document.schema.json']) {
      expect(() => readSchema(fileName)).not.toThrow();
    }
    expect(() => readSchema('layout-document.schema.json')).toThrow();
  });

  it("document-package.schema.json's $id is a jsdelivr URL pinned to the package's own published version -- the URI IS the version", () => {
    const documentPackage = readSchema('document-package.schema.json');
    expect(documentPackage.$id).toBe(
      `https://cdn.jsdelivr.net/npm/document-schema.js@${packageVersion}/schemas/document-package.schema.json`,
    );
  });

  it("document-package.schema.json is the tree form: five kind arms, no formatVersion or content field, per-kind children refs, and styles/definitions tables at the root", () => {
    const documentPackage = readSchema('document-package.schema.json');
    expect(documentPackage.oneOf).toHaveLength(5);
    const kinds = documentPackage.oneOf.map((variant) => variant.properties.kind.const);
    expect(kinds).toEqual(['wordprocessing', 'presentation', 'spreadsheet', 'drawing', 'formula']);
    for (const variant of documentPackage.oneOf) {
      expect(variant.properties.formatVersion).toBeUndefined();
      expect(variant.properties.content).toBeUndefined();
      expect(variant.required).toEqual(expect.arrayContaining(['kind', 'metadata', 'children']));
      expect(variant.properties.pages.type).toBe('array');
      expect(variant.properties.styles.additionalProperties.$ref).toBe('#/$defs/StyleEntry');
      expect(variant.properties.definitions.additionalProperties.$ref).toBe('#/$defs/DefinitionEntry');
    }
    // The per-kind root children: sections, slides, sheets, draw pages, and the formula leaf.
    const byKind = Object.fromEntries(documentPackage.oneOf.map((variant) => [variant.properties.kind.const, variant]));
    expect(byKind.wordprocessing.properties.children.items.$ref).toBe('#/$defs/SectionGroup');
    expect(byKind.presentation.properties.children.items.$ref).toBe('#/$defs/SlideGroup');
    expect(byKind.spreadsheet.properties.children.items.$ref).toBe('#/$defs/SheetGroup');
    expect(byKind.drawing.properties.children.items.$ref).toBe('#/$defs/DrawPageGroup');
    expect(byKind.formula.properties.children.items.$ref).toBe('#/$defs/ContentFormula');
    // The tree fragments resolve file-locally: both published files carry the same $defs block (the same object emitted twice in one generator run).
    expect(Object.keys(documentPackage.$defs)).toContain('SectionGroup');
    expect(Object.keys(documentPackage.$defs)).toContain('StyleEntry');
    // The recursion itself: a section group's children point back at the shared HeadingGroup/ListGroup definitions, and those at ContentBlock.
    expect(documentPackage.$defs.SectionGroup.properties.children.items.oneOf).toEqual([
      { $ref: '#/$defs/HeadingGroup' },
      { $ref: '#/$defs/ListGroup' },
      { $ref: '#/$defs/ContentBlock' },
    ]);
    // Style entries enforce the ban list by shape: additionalProperties false on entry and both halves, with no frames/sourcePath/styleId field anywhere.
    expect(documentPackage.$defs.StyleEntry.additionalProperties).toBe(false);
    expect(documentPackage.$defs.StyleParagraphProperties.additionalProperties).toBe(false);
    expect(documentPackage.$defs.StyleParagraphProperties.properties.frames).toBeUndefined();
    expect(documentPackage.$defs.StyleRunProperties.properties.sourcePath).toBeUndefined();
  });

  it("content-document.schema.json's flat arms keep their symbol-table $ref and drop the retired formatVersion field", () => {
    const contentDocument = readSchema('content-document.schema.json');
    expect(contentDocument.oneOf).toHaveLength(5);
    for (const variant of contentDocument.oneOf) {
      expect(variant.properties.formatVersion).toBeUndefined();
      expect(variant.properties.symbolTable.$ref).toBe('#/$defs/SymbolTable');
    }
    expect(contentDocument.$defs.LayoutFrame.required).toEqual(
      expect.arrayContaining(['pageIndex', 'xPt', 'yPt', 'widthPt', 'heightPt']),
    );
    expect(contentDocument.$defs.ContentParagraph.properties.headingLevel.type).toBe('integer');
    expect(contentDocument.$defs.ContentParagraph.properties.frames.items.$ref).toBe('#/$defs/LayoutFrame');
    expect(contentDocument.$defs.ContentBlock.oneOf).toHaveLength(5);
    // The embedded-object cycle is the one deliberate cross-file pointer.
    expect(contentDocument.$defs.ContentEmbeddedObjectBlock.properties.document.$ref).toBe(
      `https://cdn.jsdelivr.net/npm/document-schema.js@${packageVersion}/schemas/content-document.schema.json`,
    );
  });

  it("content-document.schema.json's formula and symbol-table definitions carry the two-layer math model", () => {
    const contentDocument = readSchema('content-document.schema.json');
    const formula = contentDocument.oneOf.find((variant) => variant.properties.kind.const === 'formula');
    expect(formula.properties.formula.$ref).toBe('#/$defs/ContentFormula');
    expect(contentDocument.$defs.ContentFormula.properties.mathml.items.$ref).toBe('#/$defs/MathMlNode');
    expect(contentDocument.$defs.MathMlNode.oneOf).toHaveLength(6);
    expect(contentDocument.$defs.MathMlElement.properties.children.items.$ref).toBe('#/$defs/MathMlNode');
    expect(contentDocument.$defs.ContentFormula.properties.presentation.$ref).toBe('#/$defs/MathPresentation');
    expect(contentDocument.$defs.ContentFormula.properties.content.$ref).toBe('#/$defs/MathExpression');
    expect(contentDocument.$defs.ContentFormula.properties.provenance.$ref).toBe('#/$defs/MathProvenance');
    expect(contentDocument.$defs.ContentFormula.required).toEqual(['mathml']);
    expect(contentDocument.$defs.MathExpression.oneOf).toHaveLength(8);
    expect(contentDocument.$defs.MathUnparsed.required).toEqual(['kind', 'latex']);
    expect(contentDocument.$defs.SymbolTable.required).toEqual(['symbols', 'units']);
  });
});
