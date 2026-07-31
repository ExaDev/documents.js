// Verifies the built dist/ output actually loads and exposes the public surface, in both ESM and CJS. Run only via `pnpm test:smoke` (which rebuilds dist/ first) -- deliberately outside the "unit" vitest project and outside tsconfig's "src" program, since it tests build output rather than source.
import { createRequire } from 'node:module';
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
