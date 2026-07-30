/**
 * Runs on `main`. Analyses commits since the last tag, bumps the version, publishes to npmjs.org (trusted OIDC publishing, no stored token -- see .github/workflows/ci.yml), creates a versioned tag and GitHub Release with generated notes, and commits CHANGELOG.md + package.json back to main. The release commit's [skip ci] message avoids a redundant CI run.
 *
 * Plain JS, not TypeScript: semantic-release loads this file through cosmiconfig's TypeScript loader, which calls `typescript.findConfigFile` -- an API TypeScript 7 no longer exports, so a `.ts` config here fails with "typescript.findConfigFile is not a function" the moment semantic-release tries to read it. commitlint.config.ts is unaffected because commitlint loads its own TS config through jiti instead.
 *
 * @type {import('semantic-release').Options}
 */
const config = {
  branches: ['main'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
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
