# archive-codec

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/documents.js/tree/main/packages/archive-codec) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/archive-codec) [![npm version](https://img.shields.io/npm/v/archive-codec)](https://www.npmjs.com/package/archive-codec) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/documents.js/ci.yml?branch=main)](https://github.com/ExaDev/documents.js/actions)

> Recursive archive (ZIP-in-ZIP) detection and walking with depth and cumulative decompressed-size guards — zero document-format knowledge, the archive utility package for the [documents.js family](../../README.md). Worker-isomorphic: the same code runs under Node and inside a Cloudflare Workers isolate.

Created for [documents.js#564](https://github.com/ExaDev/documents.js/issues/564): nothing in the ecosystem recursed into a nested archive. Most concretely, OOXML's embedded-object model — a docx/pptx carrying a genuinely separate ZIP blob at `word/embeddings/oleObject1.xlsx` — had no safe handling anywhere, and no package guarded against recursive-archive inputs at all (`byte-codec`'s 512 MiB per-stream inflate cap does not compose across recursion). A new sibling was chosen over extending `byte-codec` (whose charter is byte/image primitives, zero container-format knowledge) or doing it inline in `documents.js` (which would repeat the duplication `byte-codec`'s own extraction was meant to avoid). No family package depends on it yet — `document-schema.js`'s `ContentEmbeddedObject`/`ContentEmbeddedObjectBlock` already has the `objectKind` vocabulary to carry a recovered embedded OOXML sub-document (mirroring how odf.js embeds formula sub-documents), but nothing in `ooxml.js` populates it from this package yet. Tracked as two separate follow-ups given their different risk profiles: [documents.js#733](https://github.com/ExaDev/documents.js/issues/733) (pptx, extending existing partial OLE-handling) and [documents.js#734](https://github.com/ExaDev/documents.js/issues/734) (docx, built from scratch with no existing fixtures).

Scope for v1: **ZIP containers only** — read and write over [`fflate`](https://github.com/101arrowz/fflate), recursive walking of ZIP-in-ZIP entries, and archive-format detection (ZIP vs not-ZIP). **tar and gzip are explicitly out of scope.**

## Getting started

Requires Node.js `>=20` and pnpm `11.6.0`.

```sh
pnpm install
pnpm build          # tsdown -> dist/ (ESM + CJS + .d.ts)
pnpm typecheck      # tsc -p tsconfig.json && tsc -p tsconfig.node.json (dual tsconfig)
pnpm lint           # eslint . --fix --cache --max-warnings 0
pnpm test           # vitest run
pnpm test:watch     # vitest
pnpm test:workers   # vitest run --config vitest.workers.config.ts, inside a real Cloudflare Workers (workerd) isolate
```

To run a single test file, pass its path to vitest directly, e.g. `pnpm exec vitest run src/zip/walk.test.ts`.

## What it provides

| Module | Exports |
|---|---|
| `zip/container` | `zipPackage` (ordered-entries ZIP write with stored-uncompressed support), `unzipPackage`, `ZipEntry` |
| `zip/detect` | `detectArchiveFormat` (`'zip' \| 'unknown'`), `isZipArchive`, `ArchiveFormat` |
| `zip/walk` | `walkArchive` (recursive ZIP-in-ZIP walking), `ArchiveWalkEntry`, `ArchiveWalkLimitError`, `MAX_WALK_DEPTH`, `MAX_WALK_TOTAL_BYTES`, `WalkArchiveOptions` |

### Recursive walking

```ts
import { walkArchive } from 'archive-codec';

// Every entry of every nested ZIP, flattened. Throws ArchiveWalkLimitError if
// the walk exceeds the depth cap or the cumulative decompressed-bytes budget.
for (const entry of walkArchive(docxBytes)) {
  entry.path;      // e.g. 'xl/workbook.xml', the path within its own archive
  entry.ancestors; // e.g. ['word/embeddings/oleObject1.xlsx'] -- the nested
                   // ZIP entries descended through to reach this one
  entry.bytes;     // decompressed content
}
```

Both guards throw rather than truncate: an input outside the contract must fail loudly, never return a partial listing that looks complete. The defaults are `MAX_WALK_DEPTH` (8 — real producers bottom out around depth 3; the motivating OOXML embedded-object case is depth 2) and `MAX_WALK_TOTAL_BYTES` (512 MiB cumulative across every nesting level — the same figure `byte-codec` grants a single stream, re-purposed as one shared budget so a bomb's multiplicative nesting leverage becomes bounded addition). Both are overridable per call via `walkArchive(bytes, { maxDepth, maxTotalBytes })`, and each constant's derivation is stated in its source comment.

### ZIP container

`zipPackage` takes an *ordered* array of `[path, entry]` tuples, not a `Record`, so the caller controls the exact emission order deterministically (the property formats with a fixed-offset first entry — ODF's `mimetype` — depend on), and any entry can be written stored-uncompressed via `stored: true`. `unzipPackage` is the read side; the returned `Record` makes no ordering promise and collapses duplicate paths.

## Conventions

- Worker-isomorphic (see the [family-wide convention](../../README.md#conventions)): runtime `src/` must not import `node:*`, a bare Node builtin, or use the `Buffer` global — enforced by a `no-restricted-imports`/`no-restricted-globals` ESLint rule and exercised in CI by running the test suite inside an actual `workerd` isolate (`pnpm test:workers`). Test files under `src/**/*.test.ts` and `src/test-support/` are exempt and may use Node APIs for fixtures.
- Only `src/index.ts` may be named `index.*` — a custom ESLint rule (`local/no-non-barrel-index`) rejects any other module using an `index` basename, since that would be a hidden entry point the `exports` map in `package.json` doesn't advertise.
- Zero document-format knowledge: this package knows bytes and ZIP structure, never that any entry is a document. It depends only on `fflate` — not on `byte-codec`, `ooxml.js`, or `odf.js` (whose ZIP wrappers it deliberately mirrors rather than imports, keeping their branding and release cadences decoupled).

## Install

```sh
pnpm add archive-codec
# or
npm install archive-codec
```

## Release and publishing

Release, CI, and commit-message conventions are all workspace-wide, not package-local — see the [monorepo root README](../../README.md#releases) for the mechanism (topological per-package `semantic-release` via `@exadev/semantic-release-workspace`, OIDC trusted npm publishing, automatic sibling dependency-range rewriting) and its [known gap](../../README.md#releases) note on GitHub Packages republishing and SBOM/provenance signing, both dropped in the migration to this monorepo and not yet restored.

## Contributing

Conventional Commits, enforced workspace-wide by commitlint through a root `commit-msg` hook. Work inside `packages/archive-codec/`; see the [root README](../../README.md#contributing) for the shared git hooks and history conventions.

## License

MIT
