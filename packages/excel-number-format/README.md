# excel-number-format

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/documents.js/tree/main/packages/excel-number-format) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/excel-number-format) [![npm version](https://img.shields.io/npm/v/excel-number-format)](https://www.npmjs.com/package/excel-number-format) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/documents.js/ci.yml?branch=main)](https://github.com/ExaDev/documents.js/actions)

> A tokenizing classifier for Excel's number-format mini-language — deciding whether a numeric cell is really a percentage, an amount of money, a date, a time of day, an elapsed duration, or a plain number. The number-format package for the [documents.js family](https://github.com/ExaDev), shared by `ooxml.js` (xlsx) and `xls-codec` (`.xls`/BIFF8). Worker-isomorphic: the same code runs under Node and inside a Cloudflare Workers isolate.

Neither xlsx nor BIFF8 has a native percentage, currency, date, or time cell type: every one of them is stored as a bare number whose meaning lives entirely in the format its style points at. The format mini-language itself is the one [ECMA-376 Part 1 §18.8.30](https://www.ecma-international.org/publications-and-standards/standards/ecma-376/) documents for OOXML, and [MS-XLS] 2.4.126 defers to that same section for how a BIFF8 `Format` record's own `stFormat` string is interpreted (<https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/300280fd-e4fe-4675-a924-4d383af48d3b>) — OOXML inherited the format codes from BIFF, so `.xlsx` and `.xls` share the identical language rather than two similar ones.

Created for [ExaDev/documents.js#848](https://github.com/ExaDev/documents.js/issues/848): `ooxml.js` and `xls-codec` had each implemented this classifier independently, agreeing today with nothing keeping them agreeing — a fix to one could silently leave the other wrong, reading the same format code as a date in one format and a plain number in the other. This package is the one shared implementation both now depend on. It was deliberately not folded into `document-schema.js` (which is format-agnostic, and this is Excel-specific) or made one codec depend on the other (which would wrongly couple two sibling format codecs and drag `ooxml.js`'s XML/ZIP dependency into `xls-codec`, which needs none of it) — a small foundation package matches the family's own existing pattern (`byte-codec`, `archive-codec`, `document-outline.js`, `document-compute.js`).

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

## Usage

```ts
import { classifyNumberFormat } from "excel-number-format";

classifyNumberFormat("0.00%"); // { kind: 'percentage' }
classifyNumberFormat("[$GBP-809]#,##0.00"); // { kind: 'currency', code: 'GBP' }
classifyNumberFormat("yyyy-mm-dd"); // { kind: 'date' }
classifyNumberFormat("h:mm:ss"); // { kind: 'time' }
classifyNumberFormat("m/d/yy h:mm"); // { kind: 'dateTime' }
classifyNumberFormat("[h]:mm:ss"); // { kind: 'elapsedTime' }
classifyNumberFormat("#,##0.00"); // { kind: 'number' }
```

`classifyNumberFormat` is a classifier, **not** a formatter: nothing here renders a value through a format code (that needs locale data, fill/alignment placeholder geometry, conditional-section evaluation, and colour handling neither consuming codec has asked for) — it only decides what kind of thing a numeric cell's value is.

It tokenizes rather than pattern-matches, because every meaningful signal in this language is context-sensitive and a regex over the raw string gets each of them wrong: a `d` inside `"dollars"` is literal text, not a day code; `[$-809]` is a locale tag carrying no currency meaning while `[$GBP-809]` is a real currency marker, one character apart; `[h]` is an elapsed-hours bucket while a bare `h` is an hour of day; `m` is minutes or months depending purely on the runs around it, so `yyyy-mm-dd hh:mm:ss` resolves its two identical `mm` runs oppositely; and a `;` inside a quoted literal does not start a new section.

## What it provides

| Export                       | What it is                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `classifyNumberFormat`       | The classifier: a format code string in, a `NumberFormatClass` out.                                                                                                                                                                                                                                                                                     |
| `NumberFormatClass`          | `{ kind: 'number' \| 'text' \| 'percentage' \| 'date' \| 'time' \| 'dateTime' \| 'elapsedTime' } \| { kind: 'currency'; code?: string }` — `code` is an ISO 4217 code when the format names one, absent when it names a bare currency symbol instead (there is no faithful symbol-to-ISO-code mapping: `$` alone is USD, CAD, AUD, and a dozen others). |
| `BUILTIN_NUMBER_FORMATS`     | `ReadonlyMap<number, string>` — ECMA-376's own implied built-in format-code table (ids 0-49, with 23-36 deliberately absent as reserved), fed through the same classifier a producer-declared code is, so the two feeds can never drift apart.                                                                                                          |
| `tokenizeNumberFormat`       | The tokenizer `classifyNumberFormat` is built on: a format code string to a `NumberFormatToken[]`.                                                                                                                                                                                                                                                      |
| `splitNumberFormatSections`  | Splits a token stream on `;` section separators (never on one inside a quoted literal or a bracket), always returning at least one section.                                                                                                                                                                                                             |
| `MAX_NUMBER_FORMAT_SECTIONS` | `4` — Excel honours at most positive/negative/zero/text sections; a fifth is malformed and dropped.                                                                                                                                                                                                                                                     |
| `NumberFormatToken`          | The tokenizer's own lexical unit type: `literal` (quoted/escaped text), `bracket` (a `[...]` construct), `separator` (an unescaped `;`), or `code` (a single format-language character).                                                                                                                                                                |
| `isIsoCurrencyCodeShape`     | `(marker: string) => boolean` — the three-ASCII-letter ISO 4217 shape check the classifier uses to decide `[$GBP-809]` names a code and `[$£-809]` names a symbol instead, exported for a consuming codec's own writer to reuse when deciding whether a currency string can go inside a `[$...]` bracket.                                               |

Every export is available from the package root. `classifyNumberFormat` reads the **first** section of a format code only: sections two through four are the negative/zero/text renderings of the same underlying value — they can differ in colour, parentheses, and literal text, but never in what kind of thing the cell holds, and a cell whose value happens to be negative must not classify differently from the identical cell holding a positive one.

## Conventions

- Worker-isomorphic (see the [family-wide convention](https://github.com/ExaDev/documents.js/blob/main/README.md#conventions)): runtime `src/` must not import `node:*`, a bare Node builtin, or use the `Buffer` global — enforced by a `no-restricted-imports`/`no-restricted-globals` ESLint rule and exercised in CI by running a test suite inside an actual `workerd` isolate (`pnpm test:workers`). The classifier is a pure string tokenizer with no I/O of any kind, so this holds trivially.
- Only `src/index.ts` may be named `index.*` — a custom ESLint rule (`local/no-non-barrel-index`) rejects any other module using an `index` basename, since that would be a hidden entry point the `exports` map in `package.json` doesn't advertise.
- Release, CI, and commit-message conventions are all workspace-wide, not package-local — see the [monorepo root README](../../README.md#releases) for the mechanism (topological per-package `semantic-release` via `@exadev/semantic-release-workspace`, OIDC trusted npm publishing, automatic sibling dependency-range rewriting) and its [post-release republishing and attestation](../../README.md#releases) note on the restored GitHub Packages mirrors, npm aliases, and SBOM/provenance signing.

## What stayed behind

Each consuming codec keeps what is genuinely its own rather than this shared package's: `ooxml.js`'s own `typed/xlsx/number-format.ts` still owns the **write side** — the specific formats its xlsx writer emits for a `ContentCellValue` kind xlsx cannot express as a cell type (`PERCENTAGE_NUMBER_FORMAT`, `DATE_NUMBER_FORMAT`, `currencyNumberFormat`, and friends) — because that vocabulary is xlsx's own writer decision, not a fact about the number-format language itself; `xls-codec` has no write path at all yet. Both still classify through this package's `classifyNumberFormat`, so the writer's own vocabulary and the shared classification can never drift apart.

## Install

```sh
pnpm add excel-number-format
# or
npm install excel-number-format
```

## License

MIT
