// Smoke test: the built dist/ artifact loads and works under both ESM and CJS. Run only via `pnpm test:smoke` (tsdown, then vitest scoped to the "smoke" project) -- never part of the default `pnpm test` file set, since it requires a fresh build to mean anything. Placeholder assertions until documents.js's own public API lands; see src/index.ts's top-of-file comment.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as esm from '../dist/index.js';

const require = createRequire(import.meta.url);
const cjs = require('../dist/index.cjs');

const FUNCTIONS = ['decodePackage', 'encodePackage'];

describe('dist/ exports are present in both builds', () => {
  for (const name of FUNCTIONS) {
    it(`${name} is a function`, () => {
      expect(typeof esm[name]).toBe('function');
      expect(typeof cjs[name]).toBe('function');
    });
  }
});
