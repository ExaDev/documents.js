# xls-codec

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/documents.js/tree/main/packages/xls-codec) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/xls-codec) [![npm version](https://img.shields.io/npm/v/xls-codec)](https://www.npmjs.com/package/xls-codec) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/documents.js/ci.yml?branch=main)](https://github.com/ExaDev/documents.js/actions)

> Hand-written reader and writer for the legacy Excel Binary File Format (`.xls`, BIFF8) as specified by [MS-XLS], mapping a workbook's record stream onto the same `document-schema.js` spreadsheet model `ooxml.js`'s xlsx support and `odf.js`'s ods support target. Worker-isomorphic: the same code runs under Node and inside a Cloudflare Workers isolate.

A `.xls` file is not one format but two nested ones. The outer container is an [MS-CFB] compound file — the same "filesystem in a file" that carries `.doc` and `.ppt` — holding a stream named `Workbook`. Inside that stream is BIFF8: a flat sequence of records, each a two-byte type, a two-byte size, and that many bytes of data, organised into substreams delimited by `BOF`/`EOF`. This package leaves the outer layer to [`archive-codec`](../archive-codec/README.md)'s bounded CFB reader and writer and implements the inner one, from the record framing up to a `ContentDocument` and back.

## Status

Under active development, with real, tested **read and write** support. Built and shipped:

- **Record framing** (`src/biff/records.ts`, `src/biff/record-writer.ts`) — the three-component record structure of [MS-XLS] 2.1.4 in both directions, with the 8224-byte data ceiling enforced and every malformed or oversized stream thrown on rather than silently truncated or split into a `Continue` chain the writer does not implement.
- **Continuation-aware cursor and strings** (`src/biff/cursor.ts`, `src/biff/strings.ts`, `src/biff/string-writer.ts`) — `Continue` records ([MS-XLS] 2.4.58) joined per the rules of the record being continued on read, including the case a naive reader gets wrong: an `XLUnicodeRichExtendedString` ([MS-XLS] 2.5.293) resuming after a boundary re-states its own `fHighByte` flag, which may differ from the flag the string started with. All three string shapes (`XLUnicodeString`, `ShortXLUnicodeString`, `XLUnicodeRichExtendedString`) are read and written, compressed (one byte per UTF-16 code unit) whenever every character allows it and uncompressed otherwise.
- **Workbook globals**, read (`src/workbook/globals.ts`) and write (`src/workbook/globals-writer.ts`) — `BoundSheet8` (sheet names, tab order, hidden state, type, and substream offsets), `SST` with its `Continue` chain on read, `Format` (custom number-format codes), `Font`, `XF`'s fixed prefix plus a fully-packed `CellXF`/`StyleXF` payload on write, the fifteen mandatory built-in `Style` records, and `Date1904`.
- **Worksheet substreams**, read (`src/workbook/sheet.ts`) and write (`src/workbook/sheet-writer.ts`) — `Dimensions`, `Row` (height and hidden state), `ColInfo` (width and hidden state), `MergeCells`, and the cell-value family: `Number`, `BoolErr`, and `LabelSst` on write (`Blank`, `MulBlank`, `RK`, `MulRk`, `Label`, and `Formula` with its `String` result record are read-only — see below).
- **Number-format classification and date serials** ([`excel-number-format`](../excel-number-format/README.md), `src/serial.ts`) — what turns a bare number into the schema's own `percentage`/`currency`/`date`/`time`/`dateTime` value kinds and back, honouring the workbook's own epoch flag (the writer always emits the 1900 system) and refusing the 1900 system's phantom leap day in both directions. The classification itself is a dependency, not local code: this package shares it with `ooxml.js`'s xlsx support, since it is the identical mini-language in both formats (ExaDev/documents.js#848). A cell's own `numberFormatCode` is preserved verbatim on write when present; absent, it resolves to a representative built-in code for its value kind (`General` for a plain number/string/boolean/error, `0%` for a percentage, a bare `$` format for a currency with no code, `mm-dd-yy`/`h:mm:ss`/`m/d/yy h:mm` for date/time/dateTime), and the workbook-wide `Format`/`XF` table is deduplicated across every sheet so two cells sharing one code share one entry.
- **Schema mapping** — `readXlsContent`/`readXls` (`src/content.ts`) as before; `writeXlsContent`/`writeXls` (`src/write.ts`) the counterpart, taking a `ContentDocument`/`DocumentTree` of `kind: 'spreadsheet'` and producing genuine `.xls` bytes: a real BIFF8 `Workbook` stream (globals substream, one worksheet substream per sheet, `BoundSheet8.lbPlyPos` patched to each sheet's real byte offset once every substream's length is known) wrapped in a real [MS-CFB] compound file via `archive-codec`'s `writeCompoundFile`.

Verified primarily by round trip (`src/write.test.ts`, plus a dedicated `test/workers/write.test.ts` proving the whole write path inside a real `workerd` isolate, not just Node): build a `ContentDocument`, write it, read it back through this package's own independently-pinned reader, and check the result. Every record's own byte layout is additionally cited to its [MS-XLS] section in the writer's source, matching the reader's own convention.

### Writer scope

What `writeXlsContent`/`writeXls` cover: every `ContentCellValue` kind a real `.xls` can hold (`number`, `percentage`, `currency`, `boolean`, `date`, `time`, `dateTime`, `string`, `error`; `empty` cells are never written as records — see below), merged ranges (`colSpan`/`rowSpan`), row heights and hidden rows, column widths and hidden columns, multiple sheets, explicit and default number formats, and a shared string table deduplicated across the whole workbook. What it deliberately does not:

| Not written                                                                                                                                                                  | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Formula` records                                                                                                                                                            | The read side never recovers a formula's expression either (see below) — there is nothing to write back. A `ContentSheetCell.formula` is silently ignored; only the cell's own typed `value` is written.                                                                                                                                                                                                                                                                                                                                         |
| Cell decoration (fill, borders, alignment, per-cell font)                                                                                                                    | The reader does not read a `CellXF`'s decoration payload back (see below), so writing real values here would be unverifiable by round trip. Every `XF` this writer emits carries the same undecorated defaults (general alignment, bottom vertical alignment, no border, no fill) a genuinely undecorated Excel-written cell also carries.                                                                                                                                                                                                       |
| `Blank`/`MulBlank`/`RK`/`MulRk`                                                                                                                                              | Pure compaction optimisations over information a plain `Number`/`LabelSst`/`BoolErr` record already carries losslessly. An `empty`-kind cell is never written at all — `content.ts`'s own reader drops every blank cell it reads regardless, and a merged range's empty anchor is independently reconstructed from `MergeCells` alone, so writing nothing for one is what round-trips correctly rather than a gap.                                                                                                                               |
| Images, embedded objects, comments (`Note`/`Txo`), data validation, conditional formatting, defined names (`Lbl`)                                                            | Not read either (see below); there is no round trip to verify a writer for them against.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Print settings (`Setup`, margins, `PrintGrid`, `PrintRowCol`) and workbook metadata (`\x05SummaryInformation`)                                                               | Same reason — the reader always returns its own fixed "Normal" preset and empty metadata regardless of what a file states, so writing the real values would be unverifiable.                                                                                                                                                                                                                                                                                                                                                                     |
| `RECALC`/calc-state records (`CalcMode`, `CalcCount`, …), `Window1`/`Window2`, `CodePage`, `Index`/`DBCell`, the legacy interface records (`InterfaceHdr`, `WriteAccess`, …) | UI and interoperability bookkeeping [MS-XLS]'s own grammar names in the globals/worksheet substreams alongside the content-carrying records above, not data. `Index`/`DBCell` specifically is a pure cell-lookup performance optimisation (see [MS-XLS]'s own "Retrieval of Last-Calculated Cell Values Without Loading Cell Table") that this reader — and Excel's own reader — does not require to find a cell; real, well-established minimal BIFF8 writers (e.g. Python's `xlwt`) omit the same set and produce files Excel opens correctly. |
| `Continue`-chain splitting                                                                                                                                                   | A record whose data would exceed the 8224-byte single-record ceiling ([MS-XLS] 2.1.4) — an extremely long shared string, an enormous shared string table, or thousands of merged ranges in one sheet — is refused with a thrown `BiffWriteError` rather than silently split across `Continue` records.                                                                                                                                                                                                                                           |

Column widths round-trip to the nearest pixel Excel's own integer-pixel-grid quantization allows (matching the read direction's own "honestly approximate" contract, `units.ts`), never narrower than requested. A `.xls` cell outside BIFF8's own grid (65536 rows, 256 columns) is refused rather than silently wrapped or truncated.

### Read-side gaps

Each deliberate rather than overlooked:

- **Formula expressions.** A `Formula` record's cached _result_ is read, so a formula cell shows the right value, but `ContentSheetCell.formula` stays absent. BIFF8 stores the expression as a compiled `Ptg` token stream rather than as text, and recovering it means implementing the whole `Ptg` vocabulary plus shared-formula (`ShrFmla`) and external-reference (`SupBook`/`ExternSheet`) resolution.
- **Cell decoration** — fill, borders, and alignment from `XF`'s trailing `CellXF` payload, whose colours are palette indices needing the `Palette` record and the default colour table to resolve. `Font` records are not read either: `ContentSheetCell` has no cell-level font field, and `ooxml.js`'s xlsx reader likewise maps only the number format and decoration from a cell format.
- **Print settings** are emitted as Excel's documented "Normal" preset rather than read from the file. The real values need `Setup` (including its paper-size code table), the four margin records, `PrintGrid`, and `PrintRowCol`.
- **Workbook metadata** — `metadata` is empty. Title, author, and dates live in the `\x05SummaryInformation` property-set stream ([MS-OSHARED]), a different format from BIFF8 sitting beside it in the same container.
- **Not read at all:** charts, drawings and images, cell comments (`Note`/`Txo`), data validation, conditional formatting, and defined names (`Lbl`).
- **Encrypted workbooks** are refused rather than mis-read: a `FilePass` record means every record after it is ciphertext.

This package is also not yet wired into `documents.js`'s conversion registry — it stands alone. Tracked on [#815](https://github.com/ExaDev/documents.js/issues/815).

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
- **[`excel-number-format`](../excel-number-format/README.md)**, **`src/serial.ts`** — number-format classification and date-serial conversion, the two pieces of xlsx semantics BIFF8 shares because ECMA-376 inherited them from BIFF. The classifier itself is a dependency shared with `ooxml.js`, not a module in this package (ExaDev/documents.js#848) — `classifyNumberFormat` and `BUILTIN_NUMBER_FORMATS` still ride this package's own barrel (`export * from "excel-number-format"` in `src/index.ts`), so `import { classifyNumberFormat } from "xls-codec"` is unchanged.
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
- [excel-number-format](../excel-number-format/README.md) — the number-format classifier this package depends on, shared with `ooxml.js`'s xlsx support.
- [ooxml.js](../ooxml.js/README.md) — the sibling reading `.xlsx`, BIFF8's successor, onto the same schema.

## License

MIT
