import { defineConfig } from 'vitest/config';

// Two named projects, each its own real config file (vitest.unit.config.ts / vitest.smoke.config.ts) rather than inline objects here -- Vitest's `test.projects` only loads inline objects as bare test-level overrides (name/include/etc.); a genuine vite-level option like `define` (which vitest.unit.config.ts needs, to bake __PACKAGE_VERSION__ into the "unit" project's own transform) is silently dropped for inline project entries, confirmed empirically against vitest@4.1.10 -- only a real project config *file* goes through Vite's normal config-loading/merge path and actually applies it.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text', 'html', 'cobertura'],
    },
    projects: ['vitest.unit.config.ts', 'vitest.smoke.config.ts'],
  },
});
