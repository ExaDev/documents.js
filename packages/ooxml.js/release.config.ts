import type { Options } from 'semantic-release';

type ReleaseLevel = 'major' | 'minor' | 'patch' | false;

interface CommitType {
  readonly type: string;
  readonly section: string;
  readonly release: ReleaseLevel;
}

/**
 * Single source of truth for the conventional-commit types this project uses. commitlint's allowed type-enum (commitlint.config.ts imports this) and the commit-analyzer/release-notes config below both derive from it, so a type can't trigger a release without also getting a changelog section, or the reverse.
 *
 * Defined here rather than in a shared commit-types.ts: semantic-release loads this file via cosmiconfig, which transpiles only this one file to ESM, so a sibling .ts module would not resolve. commitlint's jiti loader has no such limit, so it imports commitTypes from here.
 */
export const commitTypes: readonly CommitType[] = [
  { type: 'feat', section: 'Features', release: 'minor' },
  { type: 'fix', section: 'Bug Fixes', release: 'patch' },
  { type: 'perf', section: 'Performance Improvements', release: 'patch' },
  { type: 'revert', section: 'Reverts', release: 'patch' },
  { type: 'refactor', section: 'Code Refactoring', release: false },
  { type: 'docs', section: 'Documentation', release: false },
  { type: 'style', section: 'Styles', release: false },
  { type: 'test', section: 'Tests', release: false },
  { type: 'build', section: 'Build System', release: false },
  { type: 'ci', section: 'Continuous Integration', release: false },
  { type: 'chore', section: 'Miscellaneous Chores', release: false },
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
        releaseRules: [
          { breaking: true, release: 'major' },
          ...commitTypes.map((t) => ({ type: t.type, release: t.release })),
        ],
      },
    ],
    [
      '@semantic-release/release-notes-generator',
      {
        preset: 'conventionalcommits',
        presetConfig: {
          // The preset hides everything but feat/fix/perf/revert by default; re-surface every type under its own section instead.
          types: commitTypes.map((t) => ({ type: t.type, section: t.section })),
        },
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
