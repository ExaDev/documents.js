import type { Options } from 'semantic-release';

type ReleaseLevel = 'major' | 'minor' | 'patch' | false;

interface CommitType {
  readonly type: string;
  readonly release: ReleaseLevel;
}

/**
 * Single source of truth for the conventional-commit types this project uses. commitlint's allowed type-enum (commitlint.config.ts imports this) and commit-analyzer's releaseRules below both derive from it, so a type can't trigger a release without also being accepted by commit-msg validation, or the reverse.
 *
 * Defined here rather than in a shared commit-types.ts: semantic-release loads this file via cosmiconfig, which transpiles only this one file to ESM, so a sibling .ts module would not resolve. commitlint's jiti loader has no such limit, so it imports commitTypes from here.
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

/**
 * Runs on `main`. Analyses commits since the last tag, bumps the version, publishes to npmjs.org (trusted OIDC publishing, no stored token -- see .github/workflows/ci.yml), creates a versioned tag and GitHub Release with generated notes, and commits CHANGELOG.md + package.json back to main. The release commit's [skip ci] message avoids a redundant CI run.
 */
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
    ['@semantic-release/npm', { npmPublish: true }],
    '@semantic-release/github',
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json'],
        message: 'chore(release): ${nextRelease.version} [skip ci]',
      },
    ],
  ],
};

export default config;
