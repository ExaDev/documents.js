import { defineConfig } from 'tsdown';

// One dist file per src module (root: 'src' makes dist/ mirror src/'s layout), the same shape ooxml.js ships -- because package.json's `./*` exports wildcard and the README's module table advertise deep imports (archive-codec/zip/walk, archive-codec/cfb/read, ...) that a single bundled barrel entry cannot serve: dist/ previously held only index.js/index.cjs, so every advertised subpath resolved to ERR_MODULE_NOT_FOUND (#745). Tests and fixture support are excluded: they are not published surface, and src/test-support exists only for the unit suite.
export default defineConfig({
  entry: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/*.d.ts', '!src/test-support/**'],
  root: 'src',
  format: ['esm', 'cjs'],
  dts: true,
  platform: 'neutral',
  clean: true,
});
