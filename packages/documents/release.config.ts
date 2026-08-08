import type { Options } from 'semantic-release';

// Runs on main. Drives a versioned tag + GitHub Release from conventional commits, purely for this site's own version history -- there is no npm package to publish (npmPublish: false), but @semantic-release/npm still persists the computed version into package.json, which @semantic-release/git then commits back alongside the changelog.
const config: Options = {
  branches: ['main'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    '@semantic-release/changelog',
    ['@semantic-release/npm', { npmPublish: false }],
    '@semantic-release/git',
    '@semantic-release/github',
  ],
};

export default config;
