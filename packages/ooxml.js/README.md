# ooxml.js

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/ooxml.js) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/ooxml.js) [![Release](https://img.shields.io/github/v/release/ExaDev/ooxml.js)](https://github.com/ExaDev/ooxml.js/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/ooxml.js/ci.yml?branch=main)](https://github.com/ExaDev/ooxml.js/actions)

> Type-safe, lossless round-trip conversion between OOXML packages (`.docx`, `.pptx`, `.xlsx`) and a faithful JSON model, built on [Zod 4](https://zod.dev) codecs.

An OOXML file is a ZIP of parts (an OPC "package"): `[Content_Types].xml`, relationships, XML content, and binary parts. `ooxml.js` decodes the whole package to faithful JSON and encodes it back part-for-part.

```mermaid
graph TD
    schema("document-schema.js")
    ooxml("ooxml.js")
    odf("odf.js")
    pdfcodec("pdf-codec")
    mdcodec("markdown-codec")
    bytecodec("byte-codec")
    documents("documents.js")
    mcp("document-mcp")
    cli("document-cli")

    schema --> ooxml
    schema --> odf
    schema --> pdfcodec
    schema --> mdcodec
    schema --> documents
    ooxml --> documents
    odf --> documents
    pdfcodec --> documents
    mdcodec --> documents
    bytecodec --> pdfcodec
    bytecodec --> documents
    documents --> mcp
    pdfcodec --> mcp
    documents --> cli
    odf --> cli
    pdfcodec --> cli

    click schema "https://github.com/ExaDev/document-schema.js" "document-schema.js"
    click ooxml "https://github.com/ExaDev/ooxml.js" "ooxml.js"
    click odf "https://github.com/ExaDev/odf.js" "odf.js"
    click pdfcodec "https://github.com/ExaDev/pdf-codec" "pdf-codec"
    click mdcodec "https://github.com/ExaDev/markdown-codec" "markdown-codec"
    click bytecodec "https://github.com/ExaDev/byte-codec" "byte-codec"
    click documents "https://github.com/ExaDev/documents.js" "documents.js"
    click mcp "https://github.com/ExaDev/document-mcp" "document-mcp"
    click cli "https://github.com/ExaDev/document-cli" "document-cli"

    style ooxml fill:#f9a825,stroke:#333,stroke-width:3px
```

## Why

Semantic typed models are lossy and one-directional: they cannot round-trip. True round-trip needs every part, relationship, and binary byte-for-byte at the content level. `ooxml.js` provides that lossless foundation, with typed reading views (`Document`/`Presentation`/`Workbook`) on top.

## Getting started

Requires Node.js `>=20` and pnpm `11.6.0` (pinned via `packageManager` in `package.json`).

```sh
pnpm install
```

Install as a dependency in another project:

```sh
pnpm add ooxml.js
# or
npm install ooxml.js
```

## Compatibility

Worker-isomorphic: runtime `src/` uses no Node-only APIs (no `node:*` imports, no bare Node builtins, no `Buffer` global), so the published package runs in Cloudflare Workers, Deno Deploy, browser bundlers, or any ES2024+ host — not just Node. This is enforced statically by an `eslint` guard (`no-restricted-imports`/`no-restricted-globals` in `eslint.config.ts`) that rejects any Node-only import in `src/`, and dynamically by the `workerd` test suite (`pnpm test:workers`) that exercises the xlsx decode path inside a Cloudflare Workers isolate on every CI run. The `engines.node >= 20` pin is the development and CI floor, not a runtime constraint on consumers.

## Usage

```ts
import { decodePackage, encodePackage } from 'ooxml.js';

// .docx / .pptx / .xlsx bytes -> faithful JSON Package
const pkg = decodePackage(new Uint8Array(await file.arrayBuffer()));

// ...inspect or modify pkg.parts...

// Package -> bytes (content-identical to the original)
const bytes = encodePackage(pkg);
```

The core is a Zod 4 codec, so both directions are schema-validated:

```ts
import { z } from 'zod';
import { packageCodec } from 'ooxml.js';

const pkg = z.decode(packageCodec, bytes);
const out = z.encode(packageCodec, pkg);
```

Typed views project `Package` into ergonomic models (lossy; read-only). `readDocx`/`readPptx` resolve the full style/theme cascade, so order, styling, and geometry come through, not just flattened text:

```ts
import { decodePackage, readDocx } from 'ooxml.js';

const doc = readDocx(decodePackage(bytes));
// doc.sections[0].blocks holds paragraphs/tables/page-breaks in document order (including
// inside tables); each run already carries its cascade-resolved bold/italic/colour/font.
```

`readXlsx` is the lossy, cell-values-only view. `readXlsxContent`/`buildXlsxPackage` are a separate `ContentDocument`-shaped pair — a richer reader (column widths, row heights, hidden rows/columns, merged ranges, every cell value kind, cell comments, print settings) matched with this package's first writer, round-tripping a spreadsheet through the same `ContentDocument` shape `documents.js`/`odf.js` use:

```ts
import { buildXlsxPackage, decodePackage, readXlsxContent } from 'ooxml.js';

const content = readXlsxContent(decodePackage(bytes)); // ContentDocument, kind: 'spreadsheet'
const pkg = buildXlsxPackage(content); // a fresh Package built from scratch, not a write-back into `pkg`
```

Every module under `src/` is importable directly, by the same path it has relative to `src/`, without going through the barrel:

```ts
import { bytesToBase64, base64ToBytes } from 'ooxml.js/util/base64';
import { readXlsxContent } from 'ooxml.js/typed/xlsx/content';
```

## The ooxml.js format

**The ooxml.js format** is a compact, still-plain-JSON alternative to the verbose `Package` (which repeats `type`/`tag`/`attributes`/`children` keys per node, with tag/namespace strings recurring thousands of times) — tuple-encoded nodes plus one interned string table, composing on `packageCodec`:

```
OOXML bytes --[packageCodec]--> Package --[compactCodec]--> CompactPackage (the ooxml.js format)
```

```ts
import { decodePackage, toCompact, fromCompact } from 'ooxml.js';

const pkg = decodePackage(bytes);
const compact = toCompact(pkg); // { s: string[], p: Record<path, CompactPart> }
const roundTripped = fromCompact(compact); // deep-equals pkg
```

A `word/document.xml` part holding a single run of text:

```xml
<w:p><w:r><w:t>Hi</w:t></w:r></w:p>
```

decodes to this `Package` (one entry in `parts`, each element an `XmlNode`):

```json
{
  "parts": {
    "word/document.xml": {
      "kind": "xml",
      "nodes": [
        {
          "type": "element",
          "tag": "w:p",
          "attributes": [],
          "children": [
            {
              "type": "element",
              "tag": "w:r",
              "attributes": [],
              "children": [
                {
                  "type": "element",
                  "tag": "w:t",
                  "attributes": [],
                  "children": [{ "type": "text", "value": "Hi" }]
                }
              ]
            }
          ]
        }
      ]
    }
  }
}
```

`toCompact` interns every tag and text value once (first-occurrence order) and replaces each node with a tuple (type code `0`=element/`1`=text, then string-table indices):

```json
{
  "s": ["w:p", "w:r", "w:t", "Hi"],
  "p": {
    "word/document.xml": [[0, 0, [], [[0, 1, [], [[0, 2, [], [[1, 3]]]]]]]]
  }
}
```

Reading the outer tuple: `[0, 0, [], [...]]` is an element whose tag is `s[0]` (`"w:p"`), wrapping a child recursing down to the text leaf `[1, 3]` (`s[3]` = `"Hi"`). It is a JSON shape, not a compression layer: every string stays human-readable, so it stays diffable and debuggable. `fromCompact(toCompact(pkg))` round-trips exactly; `toCompact` is deterministic.

All three format pairs have a direct codec — `packageCodec` (bytes ⇄ `Package`), `compactCodec` (`Package` ⇄ `CompactPackage`), and `compactPackageCodec` (bytes ⇄ `CompactPackage` directly):

```ts
import { decodeCompactPackage, encodeCompactPackage } from 'ooxml.js';

const compact = decodeCompactPackage(bytes); // OOXML bytes -> CompactPackage directly
const out = encodeCompactPackage(compact); // CompactPackage -> OOXML bytes directly
```

## Build, test, and lint

```sh
pnpm build          # turbo run _build (tsdown -> dist/: one ESM + CJS + .d.ts set per source module, via tsdown.config.ts)
pnpm lint           # turbo run _lint (eslint . --fix --cache --max-warnings 0)
pnpm typecheck      # turbo run _typecheck _typecheck:node (tsc against tsconfig.json + tsconfig.node.json, the dual-tsconfig setup)
pnpm test           # turbo run _test (vitest run --project unit)
pnpm test:watch     # vitest --project unit
pnpm test:workers   # turbo run _test:workers (vitest run --config vitest.workers.config.ts)
pnpm test:smoke     # turbo run _test:smoke (builds dist/, then runs test/smoke.test.mjs to verify the built ESM and CJS artifacts both load and behave identically)
```

`pnpm prepublishOnly` runs `lint`, `typecheck`, `tsdown`, `publint`, and `attw --pack`. `test/smoke.test.mjs` loads the built ESM/CJS barrels and checks they behave identically — a check `tsc`/`publint`/`attw` cannot do.

`tsdown.config.ts`'s `entry` is a `src/**/*.ts` glob (excluding tests/`.d.ts`), so `dist/` mirrors `src/` one ESM/CJS/.d.ts/.d.cts set per module; `package.json`'s `exports` adds a `"./*"` wildcard for deep imports.

To run a single test file: `pnpm vitest run src/typed/docx.test.ts`.

## Architecture

The package layers a lossless core outward to lossy convenience views:

- **`src/model/`** — schemas: `node.ts` (`XmlNode`: `text`/`cdata`/`comment`/`declaration`/`pi`/`element`, an ordered forest matching XML mixed content) and `package.ts` (`Package`: path → `Part`; `xml` parts hold parsed nodes, `binary` parts hold base64 bytes — keeping `Package` plain JSON).
- **`src/xml/`** — `parse.ts`/`build.ts` convert XML strings ⇄ `XmlNode[]` via `fast-xml-parser` (`preserveOrder`, entity re-encoding disabled, so order, mixed content, and entity encoding survive).
- **`src/zip.ts`** — thin `fflate` wrapper (`zipSync`/`unzipSync`).
- **`src/package-io/`** — `read.ts`/`write.ts` unzip, classify each entry as XML or binary (`looksLikeXml` byte sniff), and parse/serialize.
- **`src/codec.ts`** — public round-trip surface: `packageCodec`/`xmlCodec` (`z.codec()` pairs) plus `decodePackage`/`encodePackage` wrappers.
- **`src/compact.ts`** — the ooxml.js format: `compactCodec`/`compactPackageCodec` plus `toCompact`/`fromCompact`/`decodeCompactPackage`/`encodeCompactPackage` wrappers.
- **`src/typed/`** — one-way, lossy projections. `readDocx` resolves the full style cascade (`docDefaults` → `basedOn` → paragraph-mark → character styles → direct formatting) into ordered `sections` plus comments/footnotes/headers/footers/numbering; `readPptx` resolves placeholder → layout → master → theme inheritance into `slides` (presentation order via `p:sldIdLst`); `readXlsx` covers cell values/formulas, merged ranges, defined names. `typed/shared/` holds shared OOXML primitives (`drawingml.ts` geometry/theme/colour, `color.ts` `ColorTransform` cascade, `units.ts`, `metadata.ts`, `source-path.ts`). Types come from `document-schema.js`. None encodes back to a `Package` — round-trip goes through `decodePackage`/`encodePackage` (see `src/typed/xlsx/` for the one write-back exception).
- **`src/typed/xlsx/`** — a `ContentDocument`-shaped read/write pair alongside the lossy `readXlsx` (both exported; different callers). `readXlsxContent` reads column widths, row heights, hidden rows/columns, merged ranges, every cell value kind, print settings, and cell comments (`comments.ts`: legacy `xl/comments{N}.xml` notes plus `[MS-XLSX]` threaded comments, both resolved through the worksheet part's own relationships, never by part name); `buildXlsxPackage` builds a complete xlsx `Package` from scratch (never editing the decoded package). `number-format.ts`/`styles.ts`/`serial.ts` run both ways: reading classifies style index → format code → kind (`percentage`/`currency`/`date`/`time`/`dateTime`); writing emits interned `numFmt` codes, fed back through the classifier in tests. The classifier is not a formatter (`displayText` is the typed-value spelling). Scope limits: `currency` with no ISO code writes as plain `number`; non-canonical temporal values degrade to text; cell comments read but do not write (`buildXlsxPackage` emits no comment part, so they do not survive this pair).

## Conventions

- **Zod-first schema/type/guard.** Every model type is inferred from its Zod schema (`z.infer<typeof XSchema>`), not hand-written.
- **`XmlNode` uses a recursive structural guard, not `z.lazy`.** `z.lazy` collapses to `unknown` for element-children in the pinned Zod version, so `XmlElementSchema` validates `children` via `z.custom<XmlNode>(isXmlNode)`. Any change to `XmlNode`'s shape must update `isXmlNode` in step. `CompactXmlNode` and `document-schema.js`'s `ContentBlock` reuse this pattern.
- **Lossless core vs. lossy views is a hard boundary.** `decodePackage`/`encodePackage` stay byte/part faithful. `src/typed/*` readers are one-way; round-tripping goes through the generic `Package`. `readXlsxContent`/`buildXlsxPackage` are the deliberate exception — a read/write pair around `ContentDocument`, where `buildXlsxPackage` never touches the decoded package.
- **XML entities stay raw in the lossless layer.** `parseXml` runs with `processEntities: false`; typed readers decode the five standard entities (`decodeEntities` in `typed/util.ts`) only in their own lossy projection.
- **No type assertions.** `eslint.config.ts` bans `as` and angle-bracket casts (`assertionStyle: "never"`, `noInlineConfig: true` — no `eslint-disable` escape hatch). Narrow with a guard or parse with Zod.

## Gotchas and quirks

- **`readDocx`/`readPptx` are not a round-trip path.** Numbering definitions, cell border styling/shading, and `w:themeColor` (without `themeShade`/`themeTint`) are read; images read into `ContentImageBlock` (floating `wp:anchor` position not recorded); `PAGE`/`NUMPAGES` fields resolve to Word's cached text. On pptx: connector shapes (`p:cxnSp`) are skipped; shape rotation composes through groups; non-table graphic frames (chart/SmartArt/OLE) come through with geometry but empty content.
- **xlsx has no native percentage/currency/date/time cell type.** Both directions are closed via the number-format engine: reading classifies style → format code → kind; writing emits interned `numFmt` codes, fed back through the classifier in tests. `displayText` is the typed-value spelling, not the producer's rendered string.
- **`test:smoke` depends on a fresh build.** It runs `tsdown && vitest run --project smoke`, always rebuilding `dist/` first. A bare `vitest` runs both projects; `smoke` fails loudly (`Cannot find module '../dist/index.js'`) if `dist/` is unbuilt.
- **Binary-vs-XML part classification is a byte sniff, not an extension check.** `looksLikeXml` looks for a leading `<` after skipping a UTF-8 BOM and whitespace; any future binary format starting with `<` would misclassify.
- **`Array.isArray` narrows `unknown` to `any[]`, not `unknown[]`.** Indexing the result reintroduces `any` and trips `no-unsafe-assignment`. `compact.ts` and `xml/parse.ts` each define a local `isUnknownArray` guard (`value is unknown[]`) — use it wherever the narrowed element is read.
- **TypeScript is pinned to the latest 6.x, not 7.** TS 7 breaks `typescript-eslint` (peer range `<6.1.0`) and `cosmiconfig`'s TS loader (via `typescript.findConfigFile`, which TS 7 no longer exports). Wait for ecosystem support.
- **`release-notes-generator`'s `preset` is `angular`, not `conventionalcommits` (unlike `commit-analyzer`).** `conventional-changelog-conventionalcommits@10.x` exports its body under `template`, but the bundled `conventional-changelog-writer` reads only `options.mainTemplate`, so the body falls back to a generic default — producing an empty changelog. Don't switch without checking upstream.

## Fidelity

Conversion is **part-content-faithful**: every XML part re-serialises to equivalent XML, every binary part to identical bytes, no parts dropped or added. The re-zipped file opens correctly in Word, Excel, and PowerPoint. It is **not** byte-for-byte identical at the ZIP-container level — re-zipping changes archive entry layout (order, compression, metadata), not achievable deterministically across tools.

## Release and publishing

`.github/workflows/ci.yml` runs commitlint, lint, typecheck, unit, and smoke on every push/PR. On push to `main`, `release.config.ts` drives [semantic-release](https://semantic-release.gitbook.io/semantic-release): commit history decides the bump, `CHANGELOG.md`/`package.json` commit back to `main`, a GitHub Release is cut, and the package publishes to [npmjs.org](https://www.npmjs.com/package/ooxml.js) via OIDC trusted publishing (no `NPM_TOKEN`).

Release success is detected by diffing `package.json`'s version before/after. Two further jobs gate on that: one republishes under `@exadev/ooxml.js` to GitHub Packages (via `GITHUB_TOKEN`), and one packs the release, generates an SPDX SBOM (`pnpm sbom`), and signs an SBOM and a build-provenance attestation — verifiable independently of the registry, and present even if the package is later unpublished.

## Contributing

Commits follow Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, …), enforced by commitlint (`commitlint.config.ts`) via a husky `commit-msg` hook and a CI job — semantic-release's version bump depends on these being well-formed. A husky `pre-commit` runs `lint-staged` (`eslint --fix` on staged `*.ts`); `pre-push` runs the test suite. Single `main` branch; no open PR workflow established.

## References

- [document-schema.js](https://github.com/ExaDev/document-schema.js) — canonical `ContentBlock`/`ContentSection`/geometry/colour schemas and `ContentDocument`/`LayoutMetadata` types shared with `odf.js` and `documents.js`.
- [odf.js](https://github.com/ExaDev/odf.js) — sibling OpenDocument Format package, also on `document-schema.js`.
- [documents.js](https://github.com/ExaDev/documents.js) — adds PDF conversion and a read-and-write docx/pptx editor on top of this package.

## License

MIT
