# xls-codec

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/documents.js/tree/main/packages/xls-codec) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/xls-codec) [![npm version](https://img.shields.io/npm/v/xls-codec)](https://www.npmjs.com/package/xls-codec) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/documents.js/ci.yml?branch=main)](https://github.com/ExaDev/documents.js/actions)

> Hand-written reader for the legacy Excel Binary File Format (`.xls`, BIFF8) as specified by [MS-XLS], mapping a workbook's record stream onto the same `document-schema.js` spreadsheet model `ooxml.js`'s xlsx support and `odf.js`'s ods support target. Worker-isomorphic: the same code runs under Node and inside a Cloudflare Workers isolate.

A `.xls` file is not one format but two nested ones. The outer container is an [MS-CFB] compound file — the same "filesystem in a file" that carries `.doc` and `.ppt` — holding a stream named `Workbook`. Inside that stream is BIFF8: a flat sequence of records, each a two-byte type, a two-byte size, and that many bytes of data, organised into substreams delimited by `BOF`/`EOF`. This package leaves the outer layer to [`archive-codec`](../archive-codec/README.md)'s bounded CFB reader and implements the inner one, from the record framing up to a `ContentDocument`.

## Status

Under active development, **read-only**. Built and shipped:

- **Record framing** (`src/biff/records.ts`) — the three-component record structure of [MS-XLS] 2.1.4, with the 8224-byte data ceiling enforced and every malformed stream thrown on rather than silently truncated.
- **Continuation-aware cursor and strings** (`src/biff/cursor.ts`, `src/biff/strings.ts`) — `Continue` records ([MS-XLS] 2.4.58) joined per the rules of the record being continued, including the case a naive reader gets wrong: an `XLUnicodeRichExtendedString` ([MS-XLS] 2.5.293) resuming after a boundary re-states its own `fHighByte` flag, which may differ from the flag the string started with. All three string shapes (`XLUnicodeString`, `ShortXLUnicodeString`, `XLUnicodeRichExtendedString`) are read.
- **Workbook globals** (`src/workbook/globals.ts`) — `BoundSheet8` (sheet names, tab order, hidden state, type, and substream offsets), `SST` with its `Continue` chain, `Format` (custom number-format codes), `XF`'s fixed prefix (font index, format identifier, style flag), and `Date1904`.
- **Worksheet substreams** (`src/workbook/sheet.ts`) — `Dimensions`, `Row` (height and hidden state), `ColInfo` (width and hidden state, expanded across the column range it covers), `MergeCells`, and the whole cell-value family: `Blank`, `MulBlank`, `RK`, `MulRk`, `Number`, `BoolErr`, `LabelSst`, `Label`, and `Formula` with its `String` result record.
- **Number-format classification and date serials** (`src/number-format.ts`, `src/serial.ts`) — what turns a bare number into the schema's own `percentage`/`currency`/`date`/`time`/`dateTime` value kinds, honouring the workbook's own epoch flag and refusing the 1900 system's phantom leap day.
- **Schema mapping** (`src/content.ts`) — `readXlsContent` produces a `ContentDocument` of `kind: 'spreadsheet'`, and `readXls` the tree-form `DocumentTree`, in the same shape `readXlsxContent`/`readXlsx` produce: sparse 0-based cells, `displayText` on every cell, merged ranges as `colSpan`/`rowSpan` on the anchor cell, and the producer's raw format code kept alongside the classified value.

### Not built yet

**The write path**, which is the substantial one. A conformant workbook has to emit a `BOF` history block, a complete `XF`/`Font`/`Format` table with the fifteen mandatory style records preceding any cell format, an `Index`/`DBCell` row-block lookup structure whose file offsets must agree with where the records actually land, and a compound file to put the resulting `Workbook` stream into. The container half is no longer missing — [`archive-codec`](../archive-codec/README.md)'s `writeCompoundFile` writes [MS-CFB] as well as reading it — so what remains here is the BIFF8 record emission itself. Shipping a plausible-looking writer that produced files Excel rejects would be worse than shipping none. Tracked on [#815](https://github.com/ExaDev/documents.js/issues/815).

Read-side gaps, each deliberate rather than overlooked:

- **Formula expressions.** A `Formula` record's cached _result_ is read, so a formula cell shows the right value, but `ContentSheetCell.formula` stays absent. BIFF8 stores the expression as a compiled `Ptg` token stream rather than as text, and recovering it means implementing the whole `Ptg` vocabulary plus shared-formula (`ShrFmla`) and external-reference (`SupBook`/`ExternSheet`) resolution.
- **Cell decoration** — fill, borders, and alignment from `XF`'s trailing `CellXF` payload, whose colours are palette indices needing the `Palette` record and the default colour table to resolve. `Font` records are not read either: `ContentSheetCell` has no cell-level font field, and `ooxml.js`'s xlsx reader likewise maps only the number format and decoration from a cell format.
- **Print settings** are emitted as Excel's documented "Normal" preset rather than read from the file. The real values need `Setup` (including its paper-size code table), the four margin records, `PrintGrid`, and `PrintRowCol`.
- **Workbook metadata** — `metadata` is empty. Title, author, and dates live in the `\x05SummaryInformation` property-set stream ([MS-OSHARED]), a different format from BIFF8 sitting beside it in the same container.
- **Not read at all:** charts, drawings and images, cell comments (`Note`/`Txo`), data validation, conditional formatting, and defined names (`Lbl`).
- **Encrypted workbooks** are refused rather than mis-read: a `FilePass` record means every record after it is ciphertext.

This package is also not yet wired into `documents.js`'s conversion registry — it stands alone.

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

## Usage

```ts
import { isXlsFile, readXls, readXlsContent } from "xls-codec";

const bytes = new Uint8Array(await file.arrayBuffer());

if (isXlsFile(bytes)) {
  const content = readXlsContent(bytes); // ContentDocument, kind: 'spreadsheet'
  const tree = readXls(bytes); // DocumentTree, the same read decomposed
}
```

`readXlsContent` mirrors `ooxml.js`'s `readXlsxContent` deliberately, down to returning a `ContentDocument` rather than a bare `{ metadata, sheets }` object, so a caller can hold either behind one type. The difference is the input: an `.xls` has no `Package` equivalent to decode first, so these take the file's raw bytes and select the `Workbook` stream themselves.

The record layer is exported in its own right, for a caller inspecting a workbook rather than converting it:

```ts
import { readRecords, readWorkbookStream } from "xls-codec";

const stream = readWorkbookStream(bytes); // the raw BIFF8 record stream out of the compound file
for (const rec of readRecords(stream)) {
  console.log(rec.type.toString(16), rec.data.length);
}
```

### Microsoft Works spreadsheets (`.xlr`)

Works 9's `.xlr` is BIFF8 in the same compound-file container, carrying the identical `Workbook` stream alongside a Works-specific `WksSSWorkBook` stream ([SheetJS format notes](https://docs.sheetjs.com/docs/miscellany/formats/)). Because this package selects the `Workbook` stream by name and ignores every other stream in the container, an `.xlr` reads through exactly the same path with no special-casing; `isXlsFile` accepts one, and there is a test pinning that.

## Architecture

Layered bottom-up, each layer testable against hand-built byte sequences taken from the spec's own field-layout tables:

- **`src/biff/record-types.ts`** — the record type numbers, each cited to [MS-XLS] 2.3.1's own enumeration rather than copied from another implementation.
- **`src/biff/records.ts`** — the record framing, and nothing above it. Deliberately does not merge `Continue` records: whether a continuation's bytes simply append or re-state a flag byte first is decided by the record being continued, so the blocks are reported as written.
- **`src/biff/cursor.ts`** — a field cursor over one record's blocks that reads across a continuation boundary transparently while keeping the boundary observable, which is exactly what the string reader needs.
- **`src/biff/strings.ts`**, **`src/biff/rk.ts`**, **`src/biff/errors.ts`** — the shared value encodings: the three string shapes, the `RkNumber` packed-numeric encoding, and the `BErr` error-value vocabulary.
- **`src/workbook/globals.ts`**, **`src/workbook/sheet.ts`** — the two substream readers, each walking the record sequence its ABNF in [MS-XLS] 2.1.7.20.3 / 2.1.7.20.5 defines.
- **`src/number-format.ts`**, **`src/serial.ts`** — number-format classification and date-serial conversion, the two pieces of xlsx semantics BIFF8 shares because ECMA-376 inherited them from BIFF.
- **`src/content.ts`** — the mapping onto `document-schema.js`.

### Deliberately not depended on

No third-party spreadsheet or compound-file library — not `xlsx`/SheetJS, `exceljs`, or `cfb` — enforced by an ESLint `no-restricted-imports` rule in this package's own config. The format is implemented against its published Open Specification, and the compound-file layer comes from `archive-codec`, a sibling in this workspace.

## Conventions

- Worker-isomorphic (see the [family-wide convention](../../README.md#conventions)): runtime `src/` must not import `node:*`, a bare Node builtin, or use the `Buffer` global — enforced by a `no-restricted-imports`/`no-restricted-globals` ESLint rule and exercised in CI by running a test suite inside an actual `workerd` isolate (`pnpm test:workers`). Test files under `src/**/*.test.ts` and `src/test-support/` are exempt and may use Node APIs for fixtures.
- Only `src/index.ts` may be named `index.*` — a custom ESLint rule (`local/no-non-barrel-index`) rejects any other module using an `index` basename, since that would be a hidden entry point the `exports` map in `package.json` doesn't advertise.
- Every record layout is cited to its own [MS-XLS] section, by URL, at the point it is read. A field offset with no citation is a field offset nobody can check.

## Install

```sh
pnpm add xls-codec
# or
npm install xls-codec
```

## Release and publishing

Release, CI, and commit-message conventions are all workspace-wide, not package-local — see the [monorepo root README](../../README.md#releases) for the mechanism (topological per-package `semantic-release` via `@exadev/semantic-release-workspace`, OIDC trusted npm publishing, automatic sibling dependency-range rewriting) and its [post-release republishing and attestation](../../README.md#releases) note on the restored GitHub Packages mirrors, npm aliases, and SBOM/provenance signing.

## Contributing

Conventional Commits, enforced workspace-wide by commitlint through a root `commit-msg` hook. Work inside `packages/xls-codec/`; see [CONTRIBUTING.md](../../CONTRIBUTING.md) for the shared git hooks and history conventions.

## References

- [MS-XLS]: [Excel Binary File Format (.xls) Structure](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/cd03cb5f-ca02-4934-a391-bb674cb8aa06) — the specification this package implements.
- [MS-CFB]: [Compound File Binary File Format](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/53989ce4-7b05-4f8d-829b-d08d6148375b) — the container, read through `archive-codec`.
- [archive-codec](../archive-codec/README.md) — the bounded CFB reader this package selects the `Workbook` stream through.
- [document-schema.js](../document-schema.js/README.md) — the `ContentDocument`/`ContentSheet`/`ContentSheetCell` vocabulary this package maps onto, and the `assembleTree` transform behind `readXls`.
- [ooxml.js](../ooxml.js/README.md) — the sibling reading `.xlsx`, BIFF8's successor, onto the same schema.

## License

MIT
