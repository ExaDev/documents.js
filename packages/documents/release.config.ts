import type { Options } from 'semantic-release';

type ReleaseLevel = 'major' | 'minor' | 'patch' | false;

interface CommitType {
  readonly type: string;
  readonly release: ReleaseLevel;
}

/**
 * Single source of truth for the conventional-commit types this project uses. commitlint's allowed type-enum (commitlint.config.ts imports this) and commit-analyzer's releaseRules below both derive from it, so a type can't trigger a release without also being accepted by commit-msg validation, or the reverse. Matches every other repo in the documents.js family: every conventional type bumps at least a patch, so a dependency bump or a CI fix genuinely redeploys this site, the same as everywhere else in the ecosystem.
 */
export const commitTypes: readonly CommitType[] = [
  { type: 'feat', release: 'minor' },
  { type: 'fix', release: 'patch' },
  { type: 'perf', release: 'patch' },
  { type: 'revert', release: 'patch' },
  { type: 'refactor', release: 'patch' },
  { type: 'docs', release: 'patch' },
  { type: 'style', release: 'patch' },
  { type: 'test', release: 'patch' },
  { type: 'build', release: 'patch' },
  { type: 'ci', release: 'patch' },
  { type: 'chore', release: 'patch' },
];

// Runs on main. Drives a versioned tag + GitHub Release from conventional commits, purely for this site's own version history -- there is no npm package to publish (npmPublish: false), but @semantic-release/npm still persists the computed version into package.json, which @semantic-release/git then commits back alongside the changelog.
const config: Options = {
  branches: ['main'],
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'conventionalcommits',
        releaseRules: [{ breaking: true, release: 'major' }, ...commitTypes.map((t) => ({ type: t.type, release: t.release }))],
      },
    ],
    [
      '@semantic-release/release-notes-generator',
      {
        // Deliberately angular, not conventionalcommits -- see documents.js's identical note: conventional-changelog-writer's bundled commit partial doesn't match the conventionalcommits preset's function-based partial signature, producing a changelog with a version header and nothing under it. commitTypes still drives commit-analyzer's releaseRules and commitlint's type-enum regardless of which changelog preset is used.
        preset: 'angular',
      },
    ],
    '@semantic-release/changelog',
    ['@semantic-release/npm', { npmPublish: false }],
    '@semantic-release/git',
    '@semantic-release/github',
  ],
};

export default config;
