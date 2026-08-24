import { defineConfig } from "vitest/config";

/**
 * The workspace root's own suites, which today means the two CI scripts under .github/scripts.
 *
 * Named vitest.root.config.ts rather than vitest.config.ts on purpose. vitest resolves its config by walking up from the directory it runs in, and four packages here have no config of their own -- byte-codec, document-compute.js, document-outline.js, and the web UI, which uses vite.config.ts instead. A vitest.config.ts at the workspace root is found by that upward walk, so those packages would inherit this file's `include` and report "no test files found" for their own suites. A name vitest does not auto-discover cannot be inherited by accident; the root script passes it explicitly.
 *
 * `include` is scoped deliberately. vitest's default would sweep every package's suites from here, duplicating what `turbo run _test` already runs per package -- and running them without each package's own config (its workerd pool, its projects, its setup files), so they would not even be the same tests.
 */
export default defineConfig({
  test: {
    include: [".github/scripts/**/*.test.ts"],
  },
});
