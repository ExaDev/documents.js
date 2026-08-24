# byte-codec

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/documents.js/tree/main/packages/byte-codec) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/byte-codec) [![npm version](https://img.shields.io/npm/v/byte-codec)](https://www.npmjs.com/package/byte-codec) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/documents.js/ci.yml?branch=main)](https://github.com/ExaDev/documents.js/actions)

> Generic byte-level primitives (ByteWriter, ByteReader, CRC-32, deflate/inflate) and PNG/JPEG image encoding/decoding with zero PDF knowledge — the shared utility package for the [documents.js family](../../README.md).

Extracted from [pdf-codec](../pdf-codec/README.md), where these utilities lived as a directory-isolated subgraph under `src/bytes/` + `src/image/` with no PDF imports. Both pdf-codec and documents.js consume them from this neutral home rather than one fetching byte utilities from a backend.

byte-codec has no internal dependencies in the documents.js family — its only external dependency is [`fflate`](https://github.com/101arrowz/fflate) for raw DEFLATE/zlib compression. Both [pdf-codec](../pdf-codec/README.md) and [documents.js](https://github.com/ExaDev/documents.js) depend on it:

```mermaid
graph TD
    bytecodec("byte-codec")
    pdfcodec("pdf-codec")
    documents("documents.js")

    bytecodec --> pdfcodec
    bytecodec --> documents

    click bytecodec "https://github.com/ExaDev/documents.js/tree/main/packages/byte-codec" "byte-codec"
    click pdfcodec "https://github.com/ExaDev/documents.js/tree/main/packages/pdf-codec" "pdf-codec"
    click documents "https://github.com/ExaDev/documents.js" "documents.js"

    style bytecodec fill:#f9a825,stroke:#333,stroke-width:3px
```

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

To run a single test file, pass its path to vitest directly, e.g. `pnpm exec vitest run src/bytes/crc32.test.ts`.

## What it provides

| Module             | Exports                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `bytes/writer`     | `ByteWriter` (chunked growable byte-output builder), `concatBytes`                                          |
| `bytes/reader`     | `ByteReader` (sequential big/little-endian byte reader), `isAsciiWhitespace`                                |
| `bytes/crc32`      | `crc32` (IEEE 802.3 / ZIP / PNG polynomial table-driven CRC-32)                                             |
| `bytes/flate`      | `deflate`, `inflate`, `inflateTolerant` (fflate-backed DEFLATE compression/decompression with a safety cap) |
| `image/png-encode` | `encodePng` (raw RGB/RGBA pixels → PNG bytes)                                                               |
| `image/png-decode` | `decodePng` (PNG bytes → raw pixels), `RawImage`                                                            |
| `image/png-filter` | `filterScanlines`, `unfilterScanlines` (the five PNG scanline filters)                                      |
| `image/jpeg-info`  | `readJpegInfo` (JPEG header reader: dimensions, components, progressive flag — no sample decoding)          |

## Conventions

- Worker-isomorphic (see the [family-wide convention](../../README.md#conventions)): runtime `src/` must not import `node:*`, a bare Node builtin, or use the `Buffer` global — enforced by a `no-restricted-imports`/`no-restricted-globals` ESLint rule and exercised in CI by running the test suite inside an actual `workerd` isolate (`pnpm test:workers`). Test files under `src/**/*.test.ts` are exempt and may use Node APIs for fixtures.
- Only `src/index.ts` may be named `index.*` — a custom ESLint rule (`local/no-non-barrel-index`) rejects any other module using an `index` basename, since that would be a hidden entry point the `exports` map in `package.json` doesn't advertise.
- Releases are fully automated: a push to `main` runs `semantic-release` in CI, which determines the version from Conventional Commit messages and publishes to npm via OIDC trusted publishing (no local `NPM_TOKEN` needed). There is no manual publish step. This does not extend to the [npm alias](#npm-alias) below — see that section.

## Install

```sh
pnpm add byte-codec
# or
npm install byte-codec
```

## npm alias

This package also published under an alternate name from the pre-monorepo pipeline:

- [document-bytes](https://www.npmjs.com/package/document-bytes)

**Frozen since the monorepo migration** — see the [root README's release note](../../README.md#releases): the alias republish step was dropped along with GitHub Packages mirroring and SBOM/provenance signing, and nothing today keeps this name in sync with `byte-codec`'s own releases. Tracked in [ExaDev/documents.js#727](https://github.com/ExaDev/documents.js/issues/727).

## License

MIT
