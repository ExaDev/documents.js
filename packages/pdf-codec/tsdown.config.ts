import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/*.d.ts', '!src/test-support/**'],
  root: 'src',
  format: ['esm', 'cjs'],
  dts: true,
  platform: 'neutral',
  clean: true,
});
