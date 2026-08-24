# documents

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/documents.js/tree/main/packages/documents) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/documents.js/ci.yml?branch=main)](https://github.com/ExaDev/documents.js/actions)

> A client-only, statically-built web UI for every conversion and editing tool in the [documents.js ecosystem](../../README.md) — convert and edit docx, pptx, xlsx, odt, odp, ods, odg, csv, svg, pdf, and markdown documents entirely in the browser, with no server component.

Private (unpublished to npm); deployed as a static site to GitHub Pages.

## Getting started

Requires Node.js `>=20` and pnpm `11.6.0`.

```sh
pnpm install
pnpm dev       # vite dev server
```

## Build, test, and lint

```sh
pnpm build         # tsc (app + worker tsconfigs) then vite build -> dist/
pnpm preview        # serve the production build locally
pnpm typecheck       # tsc across tsconfig.json, tsconfig.worker.json, tsconfig.node.json
pnpm lint            # eslint . --cache --max-warnings 0
pnpm test            # vitest run --project unit
pnpm test:watch      # vitest --project unit
pnpm test:coverage   # vitest run --project unit --coverage
pnpm test:e2e        # playwright test
```

To run a single unit test file, pass its path: `pnpm exec vitest run --project unit src/shared/transferables.test.ts`.

`test:e2e` has no Playwright config or spec files in the repository yet — the script is wired up but there is nothing for it to run until both exist.

## Architecture

The app is split into a main-thread UI and a Web Worker that holds the only code allowed to touch real document bytes:

- **`src/workers/documents.worker.ts`** runs `src/rpc/router.ts`, an [oRPC](https://orpc.unnoq.com/) router that is the sole caller of `documents.js`'s conversion, metadata, and font functions, and the only place a sibling codec package is imported directly -- currently `markdown-codec` alone, though the import boundary below covers `odf.js`, `ooxml.js`, and `pdf-codec` too, so any of them may only ever be reached from here.
- **`src/rpc/client.ts`** is how everything on the main thread reaches the worker — UI code, routes, hooks, and features never import `documents.js` or its sibling packages directly (see Conventions below).
- **`src/routes/`** are TanStack Router file-based routes (`src/routeTree.gen.ts` is generated, not hand-edited).
- **`src/ports/` + `src/adapters/`** hold a small ports-and-adapters boundary for browser capabilities that need a fallback: `FileAccessPort` has a `nativeFileAccess` implementation (File System Access API) and a `fallbackFileAccess` implementation for browsers without it, selected by `createFileAccess.ts`.
- **`src/db/dexie.ts`** is the local IndexedDB store (recent files, preferences) via Dexie.
- **`src/hooks/`** wrap the RPC client and Dexie store in React Query-friendly hooks consumed by `src/routes/` and `src/ui/`.

## Conventions

- UI code (`src/routes/`, `src/features/`, `src/hooks/`, `src/ui/`) may not import `documents.js`'s conversion/editor functions or any sibling package (`odf.js`, `ooxml.js`, `pdf-codec`, `markdown-codec`) directly — enforced by an ESLint `no-restricted-imports` rule. Only `src/workers/**` may import them; everything else goes through `src/rpc/client.ts`. A handful of `documents.js` exports with no non-Zod runtime dependencies (`DocumentFormatSchema`, `DOCUMENT_FORMATS`, and the plain `Content*`/`Diagnostic`/`DocumentPayload` types) are allowlisted for direct import since they don't pull the conversion engine into the main bundle.
- Uses this org's shared `@exadev/eslint-config` (`exadevRecommendedTypeChecked`), which bans type assertions and `@ts-expect-error` outside test files and defaults its barrel-policy rule to `banned` — this app has no public npm entry point, so that default is left as-is rather than overridden.
- Route files under `src/routes/**/*.tsx` are exempt from `exadev/barrel-policy`, `react-refresh/only-export-components`, and `@typescript-eslint/only-throw-error` — all three collide with TanStack Router's own file-based-routing conventions (index-file naming, the exported `Route`'s `component:` property, and `redirect()`/`notFound()` as thrown control-flow objects) rather than being an avoidable choice in this codebase.

## Gotchas

- The production build is served from `/documents/` on GitHub Pages (set via `base` in `vite.config.ts` when `CI` is set) but from `/` in local dev — a build produced locally with `CI` unset will have the wrong base path if deployed as-is.
- This is a PWA (`vite-plugin-pwa`, `autoUpdate`). The worker bundle (by far the largest built asset) is deliberately excluded from the Workbox precache list and instead cached at runtime on first use via a `CacheFirst` rule, so it doesn't block install or blow the default precache size budget.
- `src/workers/documents.worker.ts` is a browser Web Worker, unrelated to Cloudflare Workers — this repo has no `wrangler` config and doesn't deploy to Cloudflare, unlike some sibling packages in the ecosystem.

## Contributing

Release, CI, and commit-message conventions are all workspace-wide, not package-local — see the [monorepo root README](../../README.md#releases) for the mechanism. This package is `private: true`, so the orchestrator versions and changelogs it without publishing to npm; its GitHub Pages deploy runs after the release job, built from the post-release commit so a release's deployed site always matches its tagged version.

## References

- [documents.js ecosystem overview](../../README.md) — how this app relates to the sibling packages it depends on.

## License

MIT
