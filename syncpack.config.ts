import type { RcFile } from "syncpack";

// Every dependency in every package.json is pinned to an exact, fixed version -- no caret, tilde, or other range -- for fully reproducible installs: the same version resolves the same way regardless of when `pnpm install` runs, and a version bump anywhere is a visible, reviewable diff rather than a silent float. This applies uniformly to third-party dependencies (zod, vitest, eslint, and the rest already show real drift as of this file's own introduction -- see `pnpm run deps:lint`) and to this monorepo's own internal packages alike, since a dependency on a sibling like archive-codec is written as an ordinary semver specifier here (README.md's own "internal dependency ranges" note), not `workspace:*` -- syncpack has no reason to tell the two apart, and this is a deliberate choice to also exact-pin a published package's own runtime dependency on a sibling, accepting that a consumer installing e.g. xls-codec alongside another package that ranges on a slightly different archive-codec version gets two installed copies rather than one deduped one.
//
// @exadev/semantic-release-workspace already keeps every dependent's specifier in sync with a sibling's own releases the moment it publishes (its own README's "Cross-package manifest bumping" section handles bare exact pins exactly the same way it handles ranges -- "preserving the comparator" on rewrite -- so this policy needs no special-casing there), so this config is a safety net catching drift from that invariant -- a manual edit, a rebase that reintroduced a stale specifier, a package added before the release tool covered it -- never a competing mechanism trying to force versions together on its own schedule. It only ever reports or fixes an actual disagreement between package.json files, the same thing `pnpm list --recursive --depth 0` already checks by hand today (README.md's own "Dependency ranges between packages" section).
//
// minimumReleaseAge is deliberately left unset: syncpack falls back to pnpm-workspace.yaml's own value (60 minutes, tuned there for the --frozen-lockfile gotcha its own comment documents) when the rcfile doesn't set one, so there stays exactly one place that number is chosen.
//
// A CI job (`Dependency versions` in .github/workflows/ci.yml) and a pre-commit hook (lint-staged.config.ts) both run `deps:lint`/`deps:fix`, so drift is caught before it merges, not just documented as a manual check.

const config: RcFile = {
  dependencyGroups: [
    {
      // @vitest/coverage-v8 is Vitest's own coverage provider, which the exact-fixed-version policy would otherwise leave free to disagree with the vitest version it instruments -- the two aren't textually related, so syncpack's own per-name matching can't see they need to move together, and Vitest itself does not support a coverage provider whose version differs from the runner's.
      aliasName: "vitest-and-coverage-provider",
      dependencies: ["vitest", "@vitest/coverage-v8"],
    },
  ],
  versionGroups: [
    {
      label:
        "The workspace root itself is never published, per its own package.json description, so it deliberately carries no version field for syncpack's local-package check to validate against.",
      packages: ["documents-js-monorepo"],
      dependencyTypes: ["local"],
      isIgnored: true,
    },
  ],
  semverGroups: [
    {
      label:
        "Every dependency, everywhere, is an exact fixed version -- see this file's own top comment for why.",
      dependencies: ["**"],
      range: "",
    },
  ],
};

export default config;
