// Smoke test: the built dist/ artifact loads and works under both ESM and CJS. Run only via `pnpm test:smoke` (tsdown, then vitest scoped to this file by vitest.config.ts's "smoke" project) -- never part of the default `pnpm test` file set, since it requires a fresh build to mean anything.
//
// The public barrel (src/index.ts) is currently empty -- readMarkdown/writeMarkdown/markdownCodec are not yet implemented (see src/read.ts/src/write.ts/src/codec.ts's own top-of-file notes). This smoke test therefore checks the one thing that IS true at this stage of the scaffold: tsdown's dual ESM/CJS build pipeline produces two loadable modules whose public surface matches exactly (both empty), proving the build/dts/module-resolution wiring itself works. Once readMarkdown/writeMarkdown/markdownCodec land, this file should grow the same "call the real function against a real fixture" assertions pdf-codec's own smoke.test.mjs makes -- see that file for the shape to follow.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as esm from '../dist/index.js';

const require = createRequire(import.meta.url);
const cjs = require('../dist/index.cjs');

describe('dist/ builds load under both ESM and CJS', () => {
  it('ESM and CJS export an identical (currently empty) public surface', () => {
    expect(Object.keys(esm).sort()).toEqual(Object.keys(cjs).sort());
  });
});
