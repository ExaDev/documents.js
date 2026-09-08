import type { RcFile } from "syncpack";

// Every dependency in every package.json is pinned to an exact, fixed version -- no caret, tilde, or other range -- for fully reproducible installs: the same version resolves the same way regardless of when `pnpm install` runs, and a version bump anywhere is a visible, reviewable diff rather than a silent float. This applies uniformly to third-party dependencies (zod, vitest, eslint, and the rest already show real drift as of this file's own introduction -- see `pnpm run deps:lint`) and to this monorepo's own internal packages alike, since a dependency on a sibling like archive-codec is written as an ordinary semver specifier here (README.md's own "internal dependency ranges" note), not `workspace:*` -- syncpack has no reason to tell the two apart, and this is a deliberate choice to also exact-pin a published package's own runtime dependency on a sibling, accepting that a consumer installing e.g. xls-codec alongside another package that ranges on a slightly different archive-codec version gets two installed copies rather than one deduped one.
//
// @exadev/semantic-release-workspace already keeps every dependent's specifier in sync with a sibling's own releases the moment it publishes (its own README's "Cross-package manifest bumping" section handles bare exact pins exactly the same way it handles ranges -- "preserving the comparator" on rewrite -- so this policy needs no special-casing there), so this config is a safety net catching drift from that invariant -- a manual edit, a rebase that reintroduced a stale specifier, a package added before the release tool covered it -- never a competing mechanism trying to force versions together on its own schedule. It only ever reports or fixes an actual disagreement between package.json files, the same thing `pnpm list --recursive --depth 0` already checks by hand today (README.md's own "Dependency ranges between packages" section).
//
// minimumReleaseAge is deliberately left unset: syncpack falls back to pnpm-workspace.yaml's own value (60 minutes, tuned there for the --frozen-lockfile gotcha its own comment documents) when the rcfile doesn't set one, so there stays exactly one place that number is chosen.
//
// Not wired into CI yet: the drift already present (both real third-party drift and every existing caret-ranged specifier that this exact-pin policy now treats as needing correction) needs fixing first (`pnpm run deps:fix`, then a full workspace verify) before `syncpack lint` can be a required check without failing on day one -- a separate change, since fixing it touches every package's manifest.

const config: RcFile = {
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
