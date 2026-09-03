# archive-codec

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/documents.js/tree/main/packages/archive-codec) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/archive-codec) [![npm version](https://img.shields.io/npm/v/archive-codec)](https://www.npmjs.com/package/archive-codec) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/documents.js/ci.yml?branch=main)](https://github.com/ExaDev/documents.js/actions)

> ZIP-in-ZIP recursive walking under depth and cumulative decompressed-size guards, classic OLE compound-file ([MS-CFB]) reading and writing, and [MS-OLEPS] Property Set Stream reading and writing — zero document-format knowledge, the archive and container utility package for the [documents.js family](../../README.md). Worker-isomorphic: the same code runs under Node and inside a Cloudflare Workers isolate.

Created for [documents.js#564](https://github.com/ExaDev/documents.js/issues/564): nothing in the ecosystem recursed into a nested archive. Most concretely, OOXML's embedded-object model — a docx/pptx carrying a genuinely separate ZIP blob at `word/embeddings/oleObject1.xlsx` — had no safe handling anywhere, and no package guarded against recursive-archive inputs at all (`byte-codec`'s 512 MiB per-stream inflate cap does not compose across recursion). A new sibling was chosen over extending `byte-codec` (whose charter is byte/image primitives, zero container-format knowledge) or doing it inline in `documents.js` (which would repeat the duplication `byte-codec`'s own extraction was meant to avoid). Its first family consumer is `ooxml.js`'s OLE embedded-object recovery — [documents.js#733](https://github.com/ExaDev/documents.js/issues/733) (pptx, `p:oleObj`) and [documents.js#734](https://github.com/ExaDev/documents.js/issues/734) (docx, `o:OLEObject`): an OLE payload part's bytes are checked through `isZipArchive` and, when they are a ZIP, decoded as a nested OOXML package behind this package's guarded walk — the bounded inflate that populates `document-schema.js`'s `ContentEmbeddedObject`/`ContentEmbeddedObjectBlock` (the same vocabulary odf.js embeds formula sub-documents through) with a genuinely recovered sub-document.

[documents.js#739](https://github.com/ExaDev/documents.js/issues/739) widened the charter from that ZIP-only v1 scope to the classic OLE compound file, recording the decision explicitly rather than by accident (mirroring the #564 reasoning): real-world Word and PowerPoint files frequently store the embeddee as a `.bin` compound file at `word|ppt/embeddings/oleObject1.bin`, and a CFB reader is container knowledge exactly the way ZIP structure is — sectors, FAT chains, and directory entries, never that any stream is a document. The same recovery now unwraps such a payload's `Package` stream ([MS-OLEDS]'s OLE packaging of the real file) through this package and feeds the packaged ZIP to the unchanged nested decode.

[documents.js#815](https://github.com/ExaDev/documents.js/issues/815), [#816](https://github.com/ExaDev/documents.js/issues/816), and [#817](https://github.com/ExaDev/documents.js/issues/817) then needed the other direction. `xls-codec`, `doc-codec`, `ppt-codec`, and `wpd-codec` each read a legacy Office binary format out of an [MS-CFB] container, and none of them can write one back, because there was no container to put their streams into: a `.xls` writer producing a `Workbook` stream, or a `.doc` writer producing `WordDocument` and `1Table`, needs a conformant compound file to hold them. That container is structural knowledge exactly as the reader's is, so `writeCompoundFile` is the mirror of `readCompoundFile` here rather than four hand-rolled emitters in four codecs.

[documents.js#815](https://github.com/ExaDev/documents.js/issues/815), [#816](https://github.com/ExaDev/documents.js/issues/816), and [#817](https://github.com/ExaDev/documents.js/issues/817) also each named the same remaining gap: `doc-codec`, `xls-codec`, and `ppt-codec` all hard-coded document metadata (title, author, dates) to an empty object, because that metadata lives in a genuinely different structure from the one each format's own reader already parses -- a [MS-OLEPS] Property Set Stream, conventionally stored as a "\x05SummaryInformation" stream beside `WordDocument`/`Workbook`/`PowerPoint Document` in the identical [MS-CFB] container all three already read through this package. `oleps/read` and `oleps/write` are the generic property-set codec (the stream header, the PropertySet packet's dictionary, and VT_I2/VT_I4/VT_LPSTR/VT_LPWSTR/VT_FILETIME typed values), and `oleps/summary-information` is the SummaryInformation-specific mapping on top of it -- the same two-layer split `cfb/read.ts` and `cfb/ole-package.ts` already establish for the OLE Package stream, container structure below, one named stream's own field layout above.

Scope: **ZIP containers** (read and write over [`fflate`](https://github.com/101arrowz/fflate), recursive walking of ZIP-in-ZIP entries), **classic OLE compound files** (bounded [MS-CFB] reading and conformant [MS-CFB] writing, plus the OLE Package stream unwrapping), and **[MS-OLEPS] Property Set Streams** (generic read/write of a single-property-set stream, plus SummaryInformation's own title/subject/author/keywords/comments/created/last-saved/last-printed fields). **tar and gzip, DocumentSummaryInformation's extended and user-defined property sets, and writing VT_LPSTR (ANSI-codepage) string properties are explicitly out of scope.**

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

| Module                      | Exports                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zip/container`             | `zipPackage` (ordered-entries ZIP write with stored-uncompressed support), `unzipPackage`, `ZipEntry`                                                               |
| `zip/detect`                | `detectArchiveFormat` (`'zip' \| 'cfb' \| 'unknown'`), `isZipArchive`, `ArchiveFormat`                                                                              |
| `zip/walk`                  | `walkArchive` (recursive ZIP-in-ZIP walking), `ArchiveWalkEntry`, `ArchiveWalkLimitError`, `MAX_WALK_DEPTH`, `MAX_WALK_TOTAL_BYTES`, `WalkArchiveOptions`           |
| `cfb/detect`                | `isCompoundFile` (the `D0 CF 11 E0 …` magic-byte check)                                                                                                             |
| `cfb/read`                  | `readCompoundFile` (bounded [MS-CFB] stream extraction), `CompoundFileStream`, `CompoundFileFormatError`, `MAX_CFB_TOTAL_STREAM_BYTES`, `ReadCompoundFileOptions`   |
| `cfb/write`                 | `writeCompoundFile` ([MS-CFB] container generation), `CompoundFileWriteError`, `WriteCompoundFileOptions` — takes the `CompoundFileStream` array `cfb/read` returns |
| `cfb/ole-package`           | `readOlePackage` (OLE Package stream unwrapping), `OlePackage`, `OlePackageFormatError`                                                                             |
| `oleps/read`                | `readPropertySetStream` (generic [MS-OLEPS] property-set decoding), `PropertySetFormatError`                                                                        |
| `oleps/write`               | `writePropertySetStream` (generic [MS-OLEPS] property-set encoding), `PropertySetWriteError` — takes the `PropertySet` shape `oleps/read` returns                   |
| `oleps/summary-information` | `readSummaryInformation`, `writeSummaryInformationStream`, `SummaryInformationProperties`, `FMTID_SUMMARY_INFORMATION`                                              |

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

Writing is the mirror image, taking the same `CompoundFileStream` array reading returns:

```ts
import { readCompoundFile, writeCompoundFile } from "archive-codec";

const bytes = writeCompoundFile([
  { path: "WordDocument", bytes: mainStream },
  { path: "1Table", bytes: tableStream },
  { path: "SummaryInformation", bytes: summaryStream },
  { path: "ObjectPool/_1234/Package", bytes: embeddedFile }, // a nested storage
]);

// ... so re-writing what was read is a round trip, not a translation.
writeCompoundFile(readCompoundFile(bytes));
```

Slash-separated paths name the enclosing storages exactly as reading reports them, so nested storages are written as well as read; a request that cannot be expressed as a conformant file throws `CompoundFileWriteError` rather than producing bytes that only look valid — an over-long or illegally named entry (`\`, `:`, and `!` are the characters [MS-CFB] forbids), an empty path segment, two siblings whose names collide under the format's case-insensitive ordering, or a version 3 stream past the 2 GB the format allows one. Both allocation paths are written: a stream at or above the 4096-byte cutoff takes FAT-chained sectors, one below it a run of 64-byte mini sectors in the root entry's own mini stream. Files past the 6.875 MiB that the header's own 109-entry DIFAT array can address spill into chained DIFAT sectors rather than failing, which matters because a real `.doc` or `.xls` reaches that size routinely.

Two details are deliberate rather than incidental. The directory's sibling trees are genuine red-black trees — balanced by construction and coloured so that every [MS-CFB] 2.6.4 constraint holds, including the black-height property — because the sibling tree exists to be binary-searched by name, and the degenerate right-sibling chain that a purely structural reader would still accept is not a search tree. And the output depends only on the set of paths, never on the order they were supplied in, since the directory's order is the format's own name ordering: two callers building the same file from differently ordered lists get identical bytes.

Correctness is checked against independent parsers, not only against this package's own reader: the written files are accepted by [`olefile`](https://github.com/decalage2/olefile) in its strict `DEFECT_INCORRECT` mode and by 7-Zip's Compound handler, both of which return byte-identical stream content, and a real LibreOffice-authored `.doc` read through `readCompoundFile` and re-emitted through `writeCompoundFile` still opens in LibreOffice Writer.

### Property sets

```ts
import {
  readCompoundFile,
  readSummaryInformation,
  writeSummaryInformationStream,
} from "archive-codec";

const stream = readCompoundFile(docBytes).find(
  (s) => s.path === "\x05SummaryInformation",
);
if (stream !== undefined) {
  const metadata = readSummaryInformation(stream.bytes);
  metadata.title; // string | undefined
  metadata.createdIso; // string | undefined, ISO-8601
}

// The mirror image: builds a "\x05SummaryInformation" stream's bytes from the
// same shape, to hand to writeCompoundFile alongside the format's own streams.
const summaryStream = writeSummaryInformationStream({ title: "Q3 report" });
```

`readSummaryInformation`/`writeSummaryInformationStream` cover the seven SummaryInformation fields a caller actually needs (title, subject, author, keywords, comments, and the created/last-saved/last-printed FILETIME timestamps, as ISO-8601 strings); everything else the property set can carry (template, last author, revision number, application name, edit time, page/word/character counts, document security) is read into the stream but not projected into `SummaryInformationProperties`, and the separate `"\x05DocumentSummaryInformation"` stream (company, manager, and custom user-defined properties) is not read or written at all. `readPropertySetStream`/`writePropertySetStream` are the generic layer beneath it — a `PropertySet`'s `formatId` and its `properties` map, keyed by `PropertyIdentifier`, valued by a `{ type, value }` pair over `VT_I2`/`VT_I4`/`VT_LPSTR`/`VT_LPWSTR`/`VT_FILETIME` — for a caller working with a different, non-SummaryInformation property set built on the identical [MS-OLEPS] wire format. The writer only emits `VT_LPWSTR` (Unicode) strings, never `VT_LPSTR`: a `CodePageString`'s ANSI encoding depends on the property set's own CodePage property, and writing an arbitrary codepage's bytes would need a full codepage table this package does not carry, so `VT_LPWSTR`'s codepage-independent UTF-16LE sidesteps the question entirely. The reader still decodes `VT_LPSTR` on the way in — `CP_WINUNICODE` (1200) and windows-1252 (1252, the value the [MS-OLEPS] SummaryInformation worked example itself declares, and the same ANSI convention `cfb/ole-package.ts` already uses) — since a real Office-authored file almost always writes ANSI strings, not Unicode ones.

### ZIP container

`zipPackage` takes an _ordered_ array of `[path, entry]` tuples, not a `Record`, so the caller controls the exact emission order deterministically (the property formats with a fixed-offset first entry — ODF's `mimetype` — depend on), and any entry can be written stored-uncompressed via `stored: true`. `unzipPackage` is the read side; the returned `Record` makes no ordering promise and collapses duplicate paths.

## Conventions

- Worker-isomorphic (see the [family-wide convention](../../README.md#conventions)): runtime `src/` must not import `node:*`, a bare Node builtin, or use the `Buffer` global — enforced by a `no-restricted-imports`/`no-restricted-globals` ESLint rule and exercised in CI by running the test suite inside an actual `workerd` isolate (`pnpm test:workers`). Test files under `src/**/*.test.ts` and `src/test-support/` are exempt and may use Node APIs for fixtures.
- Only `src/index.ts` may be named `index.*` — a custom ESLint rule (`local/no-non-barrel-index`) rejects any other module using an `index` basename, since that would be a hidden entry point the `exports` map in `package.json` doesn't advertise.
- Zero document-format knowledge: this package knows bytes and container structure — ZIP entries, compound-file sectors and directory entries, the OLE packaging wrapper, [MS-OLEPS] property identifiers and typed values — never that any entry or stream is a document, or that PID 2 means a title. It depends only on `fflate` — not on `byte-codec`, `ooxml.js`, or `odf.js` (whose ZIP wrappers it deliberately mirrors rather than imports, keeping their branding and release cadences decoupled).

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
