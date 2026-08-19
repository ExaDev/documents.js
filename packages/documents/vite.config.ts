import { execFileSync } from 'node:child_process';

import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

import { BACKGROUND_COLOR, BRAND_COLOR } from './src/design-tokens';

// GitHub Pages serves this repo at /documents/ (exadev.github.io is already the org's own Pages root, so this app can never live at the bare domain). Local dev stays at '/'.
const base = process.env.CI ? '/documents/' : '/';

// The sidebar's version link needs the real commit this build was produced from, and whether it happens to be an exact release tag -- read here rather than dry-running semantic-release, because CI's own job graph already guarantees the answer is sitting on disk by build time: the deploy job's checkout runs strictly after the release job (`needs: [..., release]`), re-fetching `ref: main` fresh, so if semantic-release just cut a release its version-bump commit and tag are already the checked-out HEAD. A dry run would only ever predict what real git state already states outright.
function execGit(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8' }).trim();
}

function tryExecGit(args: string[]): string | undefined {
  try {
    // 'no tag at HEAD' is an expected outcome for most commits, not a real failure -- stderr is piped rather than inherited so git's own "fatal: no tag exactly matches" doesn't scroll through every dev/build run.
    return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

// Handles both the HTTPS form GitHub Actions' checkout uses (optionally with embedded credentials) and the SSH form a local clone might use -- the regex searches rather than anchors from the start, so a credentials prefix before "github.com" doesn't break the match.
function parseGitHubRepoUrl(remoteUrl: string): string {
  const match = /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/.exec(remoteUrl);
  if (match === null) throw new Error(`Could not parse a GitHub owner/repo from origin remote URL: ${remoteUrl}`);
  const [, owner, repo] = match;
  return `https://github.com/${owner}/${repo}`;
}

const commitSha = execGit(['rev-parse', 'HEAD']);
// semantic-release's default tagFormat is 'v${version}' (release.config.ts doesn't override it) -- validated here so an unrelated tag some clone happens to have checked out can't be mistaken for a release.
const exactTag = tryExecGit(['describe', '--tags', '--exact-match', 'HEAD']);
const releaseTag = exactTag !== undefined && /^v\d+\.\d+\.\d+$/.test(exactTag) ? exactTag : null;
const repoUrl = parseGitHubRepoUrl(execGit(['remote', 'get-url', 'origin']));
// %ct is the committer date as Unix seconds -- for a release commit this is effectively its release time (semantic-release commits, tags, and publishes the release in the same CI step), and for an ordinary commit it's simply when that commit was made. Multiplied to milliseconds for direct use with Date.now()-based relative time.
const commitTimestampMs = Number(execGit(['show', '-s', '--format=%ct', 'HEAD'])) * 1000;

// documents.worker-*.js is ~3.7MB (by far the largest built asset) and is only ever constructed lazily inside getRpcClient() when a tool actually runs a job, never at page load. Workbox's default 2MiB precache size cutover would either silently exclude it or, if raised, block PWA install on downloading a chunk most users don't need on first paint -- excluded from the precache glob and instead cached at runtime on first use via a CacheFirst rule, which is safe because the filename is content-hashed by Vite's build (a new build is a new URL, so there is no staleness risk to revalidate against).
const pwa = VitePWA({
  registerType: 'autoUpdate',
  manifest: {
    name: 'documents',
    short_name: 'documents',
    description:
      'Convert and edit docx, pptx, xlsx, odt, odp, ods, odg, pdf, and markdown documents entirely in your browser.',
    theme_color: BRAND_COLOR,
    background_color: BACKGROUND_COLOR,
    display: 'standalone',
    scope: './',
    start_url: './',
    icons: [
      { src: 'icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
      { src: 'icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
      { src: 'icons/maskable-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,woff2}'],
    globIgnores: ['**/documents.worker-*.js'],
    runtimeCaching: [
      {
        urlPattern: /documents\.worker-.*\.js$/,
        handler: 'CacheFirst',
        options: { cacheName: 'documents-worker', expiration: { maxEntries: 2, purgeOnQuotaError: true } },
      },
    ],
  },
});

export default defineConfig({
  base,
  define: {
    __APP_COMMIT_SHA__: JSON.stringify(commitSha),
    __APP_RELEASE_TAG__: JSON.stringify(releaseTag),
    __APP_REPO_URL__: JSON.stringify(repoUrl),
    __APP_COMMIT_TIMESTAMP__: JSON.stringify(commitTimestampMs),
  },
  plugins: [
    // Must precede react(): the router plugin's route-tree codegen needs to run before plugin-react's JSX transform sees the generated imports.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    vanillaExtractPlugin(),
    pwa,
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@mantine')) return 'vendor-mantine';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'vendor-react';
          if (id.includes('/dexie') || id.includes('/zod/')) return 'vendor-data';
          if (id.includes('@tanstack')) return 'vendor-tanstack';
          return undefined;
        },
      },
    },
  },
  test: {
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/test/**', 'src/main.tsx', 'src/**/*.css.ts', 'src/routeTree.gen.ts'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
        },
      },
    ],
  },
});
