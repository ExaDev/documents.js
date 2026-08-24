# archive-codec

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/documents.js/tree/main/packages/archive-codec) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/archive-codec) [![npm version](https://img.shields.io/npm/v/archive-codec)](https://www.npmjs.com/package/archive-codec) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/documents.js/ci.yml?branch=main)](https://github.com/ExaDev/documents.js/actions)

> ZIP-in-ZIP recursive walking under depth and cumulative decompressed-size guards, and bounded classic OLE compound-file ([MS-CFB]) reading — zero document-format knowledge, the archive and container utility package for the [documents.js family](../../README.md). Worker-isomorphic: the same code runs under Node and inside a Cloudflare Workers isolate.

Created for [documents.js#564](https://github.com/ExaDev/documents.js/issues/564): nothing in the ecosystem recursed into a nested archive. Most concretely, OOXML's embedded-object model — a docx/pptx carrying a genuinely separate ZIP blob at `word/embeddings/oleObject1.xlsx` — had no safe handling anywhere, and no package guarded against recursive-archive inputs at all (`byte-codec`'s 512 MiB per-stream inflate cap does not compose across recursion). A new sibling was chosen over extending `byte-codec` (whose charter is byte/image primitives, zero container-format knowledge) or doing it inline in `documents.js` (which would repeat the duplication `byte-codec`'s own extraction was meant to avoid). Its first family consumer is `ooxml.js`'s OLE embedded-object recovery — [documents.js#733](https://github.com/ExaDev/documents.js/issues/733) (pptx, `p:oleObj`) and [documents.js#734](https://github.com/ExaDev/documents.js/issues/734) (docx, `o:OLEObject`): an OLE payload part's bytes are checked through `isZipArchive` and, when they are a ZIP, decoded as a nested OOXML package behind this package's guarded walk — the bounded inflate that populates `document-schema.js`'s `ContentEmbeddedObject`/`ContentEmbeddedObjectBlock` (the same vocabulary odf.js embeds formula sub-documents through) with a genuinely recovered sub-document.

[documents.js#739](https://github.com/ExaDev/documents.js/issues/739) widened the charter from that ZIP-only v1 scope to the classic OLE compound file, recording the decision explicitly rather than by accident (mirroring the #564 reasoning): real-world Word and PowerPoint files frequently store the embeddee as a `.bin` compound file at `word|ppt/embeddings/oleObject1.bin`, and a CFB reader is container knowledge exactly the way ZIP structure is — sectors, FAT chains, and directory entries, never that any stream is a document. The same recovery now unwraps such a payload's `Package` stream ([MS-OLEDS]'s OLE packaging of the real file) through this package and feeds the packaged ZIP to the unchanged nested decode.

Scope: **ZIP containers** (read and write over [`fflate`](https://github.com/101arrowz/fflate), recursive walking of ZIP-in-ZIP entries) and **classic OLE compound files** (bounded [MS-CFB] reading, plus the OLE Package stream unwrapping). **tar and gzip are explicitly out of scope.**

## Getting started

Requires Node.js `>=20` and pnpm `11.6.0`.

```sh
pnpm install
pnpm build          # tsdown -> dist/ (ESM + CJS + .d.ts, one file set per src module)
pnpm typecheck      # tsc -p tsconfig.json && tsc -p tsconfig.node.json (dual tsconfig)
pnpm lint           # eslint . --fix --cache --max-warnings 0
pnpm test           # vitest run --project unit
pnpm test:watch     # vitest --project unit
pnpm test:workers   # vitest run --config vitest.workers.config.ts, inside a real Cloudflare Workers (workerd) isolate
pnpm test:smoke     # builds dist/, then loads the built ESM and CJS barrels and every advertised deep import
```

To run a single test file, pass its path to vitest directly, e.g. `pnpm exec vitest run src/zip/walk.test.ts`.

## What it provides

Every module is importable by package-relative path as well as through the barrel — `tsdown` builds one dist file per src module (`root: 'src'`, the same layout ooxml.js ships), and `package.json`'s `./*` exports wildcard maps each subpath onto it:

```ts
import { readCompoundFile } from "archive-codec/cfb/read";
import { walkArchive } from "archive-codec/zip/walk";
```

The smoke suite (`test/smoke.test.mjs`) is the guard on that advertisement: it loads each module below from the built `dist/` in both module systems, so a build config that stops serving an advertised subpath fails the suite — neither publint nor `attw` catches a wildcard whose targets are missing.

| Module            | Exports                                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zip/container`   | `zipPackage` (ordered-entries ZIP write with stored-uncompressed support), `unzipPackage`, `ZipEntry`                                                             |
| `zip/detect`      | `detectArchiveFormat` (`'zip' \| 'cfb' \| 'unknown'`), `isZipArchive`, `ArchiveFormat`                                                                            |
| `zip/walk`        | `walkArchive` (recursive ZIP-in-ZIP walking), `ArchiveWalkEntry`, `ArchiveWalkLimitError`, `MAX_WALK_DEPTH`, `MAX_WALK_TOTAL_BYTES`, `WalkArchiveOptions`         |
| `cfb/detect`      | `isCompoundFile` (the `D0 CF 11 E0 …` magic-byte check)                                                                                                           |
| `cfb/read`        | `readCompoundFile` (bounded [MS-CFB] stream extraction), `CompoundFileStream`, `CompoundFileFormatError`, `MAX_CFB_TOTAL_STREAM_BYTES`, `ReadCompoundFileOptions` |
| `cfb/ole-package` | `readOlePackage` (OLE Package stream unwrapping), `OlePackage`, `OlePackageFormatError`                                                                           |

### Recursive walking

```ts
import { walkArchive } from "archive-codec";

// Every entry of every nested ZIP, flattened. Throws ArchiveWalkLimitError if
// the walk exceeds the depth cap or the cumulative decompressed-bytes budget.
for (const entry of walkArchive(docxBytes)) {
  entry.path; // e.g. 'xl/workbook.xml', the path within its own archive
  entry.ancestors; // e.g. ['word/embeddings/oleObject1.xlsx'] -- the nested
  // ZIP entries descended through to reach this one
  entry.bytes; // decompressed content
}
```

Both guards throw rather than truncate: an input outside the contract must fail loudly, never return a partial listing that looks complete. The defaults are `MAX_WALK_DEPTH` (8 — real producers bottom out around depth 3; the motivating OOXML embedded-object case is depth 2) and `MAX_WALK_TOTAL_BYTES` (512 MiB cumulative across every nesting level — the same figure `byte-codec` grants a single stream, re-purposed as one shared budget so a bomb's multiplicative nesting leverage becomes bounded addition). Both are overridable per call via `walkArchive(bytes, { maxDepth, maxTotalBytes })`, and each constant's derivation is stated in its source comment.

### Compound files

```ts
import { readCompoundFile, readOlePackage } from "archive-codec";

// Every stream of a classic OLE compound file, with its storage path.
// Throws CompoundFileFormatError on any structural nonconformance.
for (const stream of readCompoundFile(oleBinBytes)) {
  stream.path; // e.g. 'Package' -- root-level, or 'ObjectStorage/Package'
  stream.bytes; // the stream's content
}

// The OLE packaging a Word/PowerPoint embed wraps the real file in before
// storing it as the 'Package' stream: label, paths, and the file's bytes.
const packageStream = readCompoundFile(oleBinBytes).find(
  (s) => s.path === "Package",
);
if (packageStream !== undefined) {
  readOlePackage(packageStream.bytes).fileBytes; // often a ZIP for a modern embed
}
```

Reading is bounded the same way walking is: chain cycles and out-of-range sectors fail against bounds derived from the file's own sector count, and one cumulative extracted-bytes budget (`MAX_CFB_TOTAL_STREAM_BYTES`, 512 MiB — the same figure the family grants one decompressed stream) bounds the multiplication a hostile FAT gains by aliasing one sector into many streams. Every structural failure throws rather than truncating — a malformed compound file fails whole, never a partial stream listing that looks complete. Version 3 (512-byte sectors) and version 4 (4096-byte) files both read; the mini-FAT path every stream shorter than the header's cutoff takes is first-class, because a small real-world embed genuinely lands there.

### ZIP container

`zipPackage` takes an _ordered_ array of `[path, entry]` tuples, not a `Record`, so the caller controls the exact emission order deterministically (the property formats with a fixed-offset first entry — ODF's `mimetype` — depend on), and any entry can be written stored-uncompressed via `stored: true`. `unzipPackage` is the read side; the returned `Record` makes no ordering promise and collapses duplicate paths.

## Conventions

- Worker-isomorphic (see the [family-wide convention](../../README.md#conventions)): runtime `src/` must not import `node:*`, a bare Node builtin, or use the `Buffer` global — enforced by a `no-restricted-imports`/`no-restricted-globals` ESLint rule and exercised in CI by running the test suite inside an actual `workerd` isolate (`pnpm test:workers`). Test files under `src/**/*.test.ts` and `src/test-support/` are exempt and may use Node APIs for fixtures.
- Only `src/index.ts` may be named `index.*` — a custom ESLint rule (`local/no-non-barrel-index`) rejects any other module using an `index` basename, since that would be a hidden entry point the `exports` map in `package.json` doesn't advertise.
- Zero document-format knowledge: this package knows bytes and container structure — ZIP entries, compound-file sectors and directory entries, the OLE packaging wrapper — never that any entry or stream is a document. It depends only on `fflate` — not on `byte-codec`, `ooxml.js`, or `odf.js` (whose ZIP wrappers it deliberately mirrors rather than imports, keeping their branding and release cadences decoupled).

## Install

```sh
pnpm add archive-codec
# or
npm install archive-codec
```

## Release and publishing

Release, CI, and commit-message conventions are all workspace-wide, not package-local — see the [monorepo root README](../../README.md#releases) for the mechanism (topological per-package `semantic-release` via `@exadev/semantic-release-workspace`, OIDC trusted npm publishing, automatic sibling dependency-range rewriting) and its [post-release republishing and attestation](../../README.md#releases) note on the restored GitHub Packages mirrors, npm aliases, and SBOM/provenance signing.

## Contributing

Conventional Commits, enforced workspace-wide by commitlint through a root `commit-msg` hook. Work inside `packages/archive-codec/`; see [CONTRIBUTING.md](../../CONTRIBUTING.md) for the shared git hooks and history conventions.

## License

MIT
