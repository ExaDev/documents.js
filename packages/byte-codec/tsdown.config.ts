import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/**/*.ts', '!src/**/*.test.ts'],
  root: 'src',
  format: ['esm', 'cjs'],
  dts: true,
  platform: 'neutral',
  clean: true,
});
