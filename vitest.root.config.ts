import { defineConfig } from "vitest/config";

/**
 * The workspace root's own suites: the CI scripts under .github/scripts, and the root-level suites guarding the repository's own configuration files, which sit beside the file each one checks rather than in a directory away from it.
 *
 * Named vitest.root.config.ts rather than vitest.config.ts on purpose. vitest resolves its config by walking up from the directory it runs in, and four packages here have no config of their own -- byte-codec, document-compute.js, document-outline.js, and the web UI, which uses vite.config.ts instead. A vitest.config.ts at the workspace root is found by that upward walk, so those packages would inherit this file's `include` and report "no test files found" for their own suites. A name vitest does not auto-discover cannot be inherited by accident; the root script passes it explicitly.
 *
 * `include` is scoped deliberately. vitest's default would sweep every package's suites from here, duplicating what `turbo run _test` already runs per package -- and running them without each package's own config (its workerd pool, its projects, its setup files), so they would not even be the same tests.
 */
export default defineConfig({
  test: {
    // Root-level suites are matched with a single-segment glob, not `**`, so this stays scoped to the workspace root and never sweeps a package's own suites -- see the note above on why that would run them without their own config.
    include: [".github/scripts/**/*.test.ts", "*.test.ts"],
  },
});
