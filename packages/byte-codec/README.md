# byte-codec

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/byte-codec) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/byte-codec) [![Release](https://img.shields.io/github/v/release/ExaDev/byte-codec)](https://github.com/ExaDev/byte-codec/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/byte-codec/ci.yml?branch=main)](https://github.com/ExaDev/byte-codec/actions)

> Generic byte-level primitives (ByteWriter, ByteReader, CRC-32, deflate/inflate) and PNG/JPEG image encoding/decoding with zero PDF knowledge — the shared utility package for the documents.js family.

Extracted from [pdf-codec](https://github.com/ExaDev/pdf-codec), where these utilities lived as a directory-isolated subgraph under `src/bytes/` + `src/image/` with no PDF imports. Both pdf-codec and documents.js consume them from this neutral home rather than one fetching byte utilities from a backend.

byte-codec has no internal dependencies in the documents.js family — its only external dependency is [`fflate`](https://github.com/101arrowz/fflate) for raw DEFLATE/zlib compression. Both [pdf-codec](https://github.com/ExaDev/pdf-codec) and [documents.js](https://github.com/ExaDev/documents.js) depend on it:

```mermaid
graph TD
    bytecodec("byte-codec")
    pdfcodec("pdf-codec")
    documents("documents.js")

    bytecodec --> pdfcodec
    bytecodec --> documents

    click bytecodec "https://github.com/ExaDev/byte-codec" "byte-codec"
    click pdfcodec "https://github.com/ExaDev/pdf-codec" "pdf-codec"
    click documents "https://github.com/ExaDev/documents.js" "documents.js"

    style bytecodec fill:#f9a825,stroke:#333,stroke-width:3px
```

## Getting started

Requires Node.js `>=20` and pnpm `11.6.0`.

```sh
pnpm install
pnpm build      # tsdown -> dist/ (ESM + CJS + .d.ts)
pnpm test       # vitest
pnpm typecheck  # tsc --noEmit
```

## What it provides

| Module | Exports |
|---|---|
| `bytes/writer` | `ByteWriter` (chunked growable byte-output builder), `concatBytes` |
| `bytes/reader` | `ByteReader` (sequential big/little-endian byte reader), `isAsciiWhitespace` |
| `bytes/crc32` | `crc32` (IEEE 802.3 / ZIP / PNG polynomial table-driven CRC-32) |
| `bytes/flate` | `deflate`, `inflate`, `inflateTolerant` (fflate-backed DEFLATE compression/decompression with a safety cap) |
| `image/png-encode` | `encodePng` (raw RGB/RGBA pixels → PNG bytes) |
| `image/png-decode` | `decodePng` (PNG bytes → raw pixels), `RawImage` |
| `image/png-filter` | `filterScanlines`, `unfilterScanlines` (the five PNG scanline filters) |
| `image/jpeg-info` | `readJpegInfo` (JPEG header reader: dimensions, components, progressive flag — no sample decoding) |

## Install

```sh
pnpm add byte-codec
# or
npm install byte-codec
```

## npm aliases

This package also publishes under the following alternate npm name — the identical build, same version, republished by CI alongside the primary `byte-codec` package:

- [document-bytes](https://www.npmjs.com/package/document-bytes)

## License

MIT
