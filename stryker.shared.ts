import type { PartialStrykerOptions } from "@stryker-mutator/api/core";

// @stryker-mutator/vitest-runner's own option shape (dist/src/vitest-runner-options-with-stryker-options.d.ts) is deliberately not re-exported from the package's public entry point -- only strykerPlugins/strykerValidationSchema are -- so this is typed against the plugin's own documented options (configFile, dir, related; see its docs/vitest-runner.md) rather than a deep import into the plugin's dist internals, which is not a contract the plugin promises to keep stable.
interface VitestRunnerPluginOptions {
  configFile?: string;
  dir?: string;
  related?: boolean;
}

type StrykerConfig = PartialStrykerOptions & {
  vitest?: VitestRunnerPluginOptions;
};

export interface PackageStrykerOptions {
  // Glob(s) of source files Stryker should mutate, relative to the package root. Defaults to every TypeScript source file under src/, excluding tests -- the same scope every package's own _test task already covers.
  mutate?: string[];
  // The package's own root tsconfig, passed to both the sandbox rewrite step and the TypeScript checker plugin. Every package here already has a tsconfig.json at its root, so this rarely needs overriding.
  tsconfigFile?: string;
  // Path to the vitest config Stryker's vitest-runner should load. Left undefined for a package with no multi-project split (Vitest's own zero-config discovery already finds exactly the right test files, matching what its plain `vitest run` _test script does); set to "vitest.mutation.config.ts" (generated alongside this file) for a package whose real vitest.config.ts (or vite.config.ts) splits unit/smoke/workers into named projects, since Stryker's vitest-runner has no --project-equivalent selector and would otherwise also try to run the smoke suite (which imports from a dist/ Stryker's sandboxed copy never builds).
  vitestConfigFile?: string;
  // Whole-dry-run budget in minutes, passed straight through to Stryker's own option of the same name (default 5). Only a package whose INSTRUMENTED unit suite can legitimately approach the default needs this: instrumentation multiplies per-call cost far beyond what the plain or v8-coverage-instrumented suite costs, so a package with one pathologically call-heavy test (pdf-codec's whole-Unicode-range font enumeration is the measured case: ~28s instrumented on a fast local machine, several multiples of that on a GitHub runner) can burn most of the default budget on a single test. Passed by a package only once measured, never speculatively -- the default 5 minutes fits every package whose dry run has actually completed within it.
  dryRunTimeoutMinutes?: number;
}

/**
 * The mutation-testing configuration every package in this workspace shares, as a function rather than a static object -- mirroring eslint.shared.ts's own packageLintConfig, for the same reason: the real per-package variation (which vitest config actually reflects the unit suite alone, whether a package's tsconfig needs a non-default path) is structural, not cosmetic, so it is parameterised here rather than duplicated as near-identical JSON in every package.
 *
 * Deliberately a real .ts file, not stryker.config.mjs with a `@type` JSDoc annotation (Stryker's own documented pattern): this workspace already depends on `jiti` for exactly this job (ESLint's flat config loads eslint.config.ts the same way), and Stryker's own config loader is a plain `import()` under the hood (see ConfigReader#importJSConfig in @stryker-mutator/core) with no opinion at all about the extension it is given -- so running `stryker` under `node --import jiti/register` (wired into every package's own _test:mutation script) makes a real, type-checked .ts config work with no shim file, and Stryker's own option validation still runs afterward exactly as it would for a .js config.
 */
export function packageStrykerConfig(
  options: PackageStrykerOptions = {},
): StrykerConfig {
  const {
    mutate = ["src/**/*.ts", "!src/**/*.test.ts", "!src/**/*.test.tsx"],
    tsconfigFile = "tsconfig.json",
    vitestConfigFile,
    dryRunTimeoutMinutes,
  } = options;

  return {
    packageManager: "pnpm",
    mutate,
    testRunner: "vitest",
    plugins: [
      "@stryker-mutator/vitest-runner",
      "@stryker-mutator/typescript-checker",
    ],
    checkers: ["typescript"],
    tsconfigFile,
    vitest: {
      ...(vitestConfigFile === undefined
        ? {}
        : { configFile: vitestConfigFile }),
      related: false,
    },
    // Reused between CI runs via actions/cache (see .github/workflows/mutation.yml): a mutant Stryker already proved Killed (and whose covering tests are unchanged) or already proved Survived (and whose test coverage is unchanged) is skipped outright rather than re-run, which is the difference between a full run and a genuinely incremental one on a workspace this size.
    incremental: true,
    // Static mutants (module-load-time code) can only be killed by a test that fails on IMPORT, so each one re-runs its ENTIRE related suite -- measured directly against document-schema.js: Stryker's own MutantTestPlanner reported 2989 of 5217 mutants (57%) as static, estimated at 92% of the run's total time. Dropping them is what makes a cold run (no incremental cache to restore -- documents.js and pdf-codec, this workspace's two largest packages, will hit this on their very first CI run) finish inside mutation.yml's own job timeout at all. This can only RAISE a package's score (static mutants are disproportionately survived/no-coverage, never killed), so it never needs revisiting once a package's baseline is eventually measured.
    ignoreStatic: true,
    // high/low colour-code the HTML/clear-text report; deliberately no `break`. No package in this workspace has a measured baseline mutation score yet, and a `break` threshold picked without one would be an arbitrary number rather than a derived one -- exactly the magic-number failure mode to avoid. mutation.yml runs this workspace-wide, sharded and cached, purely to gather real per-package scores; once a package's own baseline is measured, add a `break` to that package's own stryker.config.ts (never here, since a workspace-wide `break` would either be too strict for the workspace's smallest, least-tested package or too lax for its most mature one) and consider promoting the CI job to a required check at that point.
    thresholds: { high: 80, low: 60 },
    // dist/coverage/.turbo are build/tooling output Stryker would otherwise copy into every mutant's own sandbox for nothing -- none of it is ever read by a test.
    ignorePatterns: ["dist", "coverage", ".turbo"],
    reporters: ["progress", "clear-text", "html"],
    tempDirName: ".stryker-tmp",
    cleanTempDir: true,
    concurrency: 4,
    timeoutMS: 30000,
    ...(dryRunTimeoutMinutes === undefined ? {} : { dryRunTimeoutMinutes }),
  };
}
