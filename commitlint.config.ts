import { readdirSync, readFileSync } from 'node:fs';

/**
 * Commit-message validation for the whole workspace. Commit messages are a property of the repository, not of a package, so this config lives at the root: every package carried an identical copy, and in one repository only one of those could ever have run.
 *
 * The allowed type list is derived from release-workspace.config.json's own releaseRules rather than restated here, preserving the invariant every package's own config was built around: a conventional-commit type cannot trigger a release without also being accepted by commit-msg validation, or the reverse. That file is the canonical release configuration -- @exadev/semantic-release-workspace reads it directly via `--config` -- so deriving from it means there is exactly one place a type gets added.
 *
 * Read through fs rather than a JSON import so this file makes no assumption about how commitlint's TypeScript loader handles JSON module resolution or import attributes.
 */

const RELEASE_CONFIG_FILE = 'release-workspace.config.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** A releaseRules entry keyed by commit type. The `{ breaking: true }` entry has no type and is deliberately not matched: "breaking" is a commit footer, never a type anyone writes in a subject line. */
function isTypedReleaseRule(value: unknown): value is { readonly type: string } {
  return isRecord(value) && 'type' in value && typeof value.type === 'string';
}

function releasableCommitTypes(): readonly string[] {
  const raw: unknown = JSON.parse(readFileSync(new URL(RELEASE_CONFIG_FILE, import.meta.url), 'utf8'));
  if (!isRecord(raw) || !isRecord(raw.analyzeCommits) || !isUnknownArray(raw.analyzeCommits.releaseRules)) {
    throw new Error(`${RELEASE_CONFIG_FILE} must define analyzeCommits.releaseRules as an array`);
  }
  const types = raw.analyzeCommits.releaseRules.filter(isTypedReleaseRule).map((rule) => rule.type);
  if (types.length === 0) {
    throw new Error(`${RELEASE_CONFIG_FILE} defines no type-keyed releaseRules, so no commit type would be accepted`);
  }
  return types;
}

const PACKAGES_DIR = 'packages';

/**
 * Every package directory name, which is also its npm name -- the scope a commit touching that package must use, so the scope decides which package's changelog the entry lands in. Read from the filesystem rather than listed here so adding a package needs no edit to this file, matching how the type list derives from the release config rather than restating it.
 */
function packageScopes(): readonly string[] {
  const entries = readdirSync(new URL(PACKAGES_DIR, import.meta.url), { withFileTypes: true });
  const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (names.length === 0) {
    throw new Error(`${PACKAGES_DIR}/ contains no package directories, so no package scope would be accepted`);
  }
  return names;
}

/**
 * Scopes for work that belongs to the repository rather than to any one package.
 *
 * The first three are emitted by automation and must never be rejected: the release orchestrator writes `chore(release): <pkg>@<version>` and `chore(deps): bump <pkg> ...`, and Dependabot writes `build(deps)` / `build(deps-dev)` for npm and `ci(deps)` for actions. Rejecting any of those would fail the Commitlint job on commits no human can reword.
 *
 * The rest name the root-level tooling a change can actually target. Deliberately absent are the package-internal area names the pre-monorepo history is full of -- `docx`, `pptx`, `odb`, `layout`, `tui`, `typed` and the like. Those were meaningful when each package was its own repository and the scope had nothing else to say; here the scope is what routes an entry to a package's changelog, so a commit touching a package must name the package. Existing history keeps whatever it was written with, since commitlint only ever validates new commits.
 */
const REPOSITORY_SCOPES = [
  'release',
  'deps',
  'deps-dev',
  'build',
  'ci',
  'commitlint',
  'dependabot',
  'eslint',
  'hooks',
  'husky',
  'knip',
  'lint',
  'prettier',
  'turbo',
  'workspace',
] as const;

export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', releasableCommitTypes()],
    // header-max-length, subject-case, and subject-full-stop all ship enabled in @commitlint/config-conventional and are inherited as-is; scope-enum is the one it leaves unrestricted, so a typo'd or invented scope silently routed a changelog entry nowhere. An unscoped commit stays valid -- scope-emptiness is scope-empty's business, not this rule's -- so a repository-wide change needs no scope at all.
    'scope-enum': [2, 'always', [...packageScopes(), ...REPOSITORY_SCOPES]],
  },
  // dependabot-auto-merge.yml lands Dependabot's rebase-merged commits on main verbatim, including its generated Bumps/Release notes/Changelog body, which routinely contains a markdown link line over the inherited body-max-line-length limit and cannot be reformatted by this repository. Skip linting entirely for those commits, identified by the "Signed-off-by: dependabot[bot]" trailer that fetch-metadata's auto-merge always appends, while leaving every rule fully enforced for human-authored commits. The orchestrator's own release and dependency-bump commits need no exemption: `chore(release): <pkg>@<version> [skip ci]` and `chore(deps): bump <pkg> to <range> in <dependent> [skip ci]` are both conventional, and their `[skip ci]` keeps CI from running on them at all.
  ignores: [(message: string) => /^Signed-off-by: dependabot\[bot\]/m.test(message)],
};
