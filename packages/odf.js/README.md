# odf.js

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/documents.js/tree/main/packages/odf.js) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/odf.js) [![npm version](https://img.shields.io/npm/v/odf.js)](https://www.npmjs.com/package/odf.js) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/documents.js/ci.yml?branch=main)](https://github.com/ExaDev/documents.js/actions)

> A hand-written, dependency-minimal codec for the OpenDocument Format (ODF — OASIS/ISO 26300): `.odt`/`.ods`/`.odp`/`.odg`/`.odf`/`.odb`/`.odm` and their template variants, built on [Zod 4](https://zod.dev) codecs — plus read support for the pre-OASIS OpenOffice.org 1.x / StarOffice 6-7 documents ODF was based on (`.sxw`/`.sxc`/`.sxi`/`.sxd`), with a real `.sxw` writer alongside it.

`odf.js` is the ODF sibling of [`ooxml.js`](../ooxml.js/README.md), mirroring its architecture: a lossless ZIP-of-XML core that round-trips any package byte-for-content-faithful, with typed readers layered on top. Two ODF-specific differences shape the design: ODF has no relationship mechanism (inter-part references are direct paths, with an exhaustive `META-INF/manifest.xml`), and ODF has no inline/direct formatting — every formatting difference must be a named "automatic style," so `odf.js` owns a style-interning subsystem (`src/styles/`) with no OOXML equivalent.

**This package does not depend on `ooxml.js`.** `ooxml.js`'s branding and SBOM are scoped to ECMA-376/OOXML; depending on it would be the wrong signal for an OASIS-standard codec and would force a breaking `ooxml.js` release for every ODF-only fix. The small generic ZIP/XML/`Package` layer is duplicated, kept structurally identical so TypeScript's structural typing makes both packages' values interchangeable for a shared consumer like `documents.js`. Both depend on [`document-schema.js`](../document-schema.js/README.md) for the genuinely identical `ContentDocument`/`DocumentTree` content model.

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

    click schema "https://github.com/ExaDev/documents.js/tree/main/packages/document-schema.js" "document-schema.js"
    click ooxml "https://github.com/ExaDev/documents.js/tree/main/packages/ooxml.js" "ooxml.js"
    click odf "https://github.com/ExaDev/documents.js/tree/main/packages/odf.js" "odf.js"
    click pdfcodec "https://github.com/ExaDev/documents.js/tree/main/packages/pdf-codec" "pdf-codec"
    click mdcodec "https://github.com/ExaDev/documents.js/tree/main/packages/markdown-codec" "markdown-codec"
    click bytecodec "https://github.com/ExaDev/documents.js/tree/main/packages/byte-codec" "byte-codec"
    click documents "https://github.com/ExaDev/documents.js" "documents.js"
    click mcp "https://github.com/ExaDev/documents.js/tree/main/packages/document-mcp" "document-mcp"
    click cli "https://github.com/ExaDev/documents.js/tree/main/packages/document-cli" "document-cli"

    style odf fill:#f9a825,stroke:#333,stroke-width:3px
```

## Status

Under active development. Built and shipped:

- **Lossless core** — ZIP-of-XML primitives (`Package`/`XmlNode`/`XmlElement`, XML parse/build, zip/unzip, base64, the `packageCodec`/`xmlCodec` `z.codec()` pairs).
- **Namespaces, media types, mimetype, manifest** (`src/ns.ts`, `src/media-type.ts`, `src/mimetype.ts`, `src/manifest.ts`) — full read and write, including `META-INF/manifest.xml` and the mimetype part's mandatory first-entry/stored/uncompressed layout.
- **Style interning** (`src/styles/`) — `StyleRegistry` adopts existing automatic styles, finds-or-mints on `intern()`, fingerprints on canonical serialized properties (never `JSON.stringify`), collision-checked across all four style containers.
- **Shared typed primitives** (`src/typed/shared/`) — unit parsing, A1 cell-reference computation with repeat-count cursor advancement, colour/geometry/master-page parsing into `document-schema.js` types, whitespace-run decoding, the read-side style cascade, shared `readOdfParagraph`/`readOdfTable`, the `draw:transform`/`draw:g` group-flattening geometry resolver, an `svg:d`/`draw:points` path parser, and `meta.xml` reading.
- **Typed readers, at two levels** — `readOdt`/`readOdp`/`readOdg`/`readOds`/`readOdfFormula` resolve a `Package` into a `document-schema.js` **`DocumentTree`**: the single hierarchical artefact, with a minted styles table. Beneath each sits its `*Content` sibling (`readOdtContent`, `readOdpContent`, `readOdgContent`, `readOdsContent`, `readOdfFormulaContent`) producing the flat `ContentDocument`-level shape instead. See [Reading a document](#reading-a-document).
- **What each reader actually covers** — wordprocessing (`readOdt`), presentation (`readOdp`), drawing (`readOdg`: vector primitives in `draw:z-index`-aware paint order), spreadsheet (`readOds`: every `office:value-type`, cell/page-anchored images, and embedded sub-documents including charts), each expressed in `document-schema.js`'s own `ContentSection`/`ContentSlide`/`ContentDrawPage`/`ContentSheet` vocabulary — plus the fidelity construct vocabulary in `readOdt` (fields including the cross-reference displays, bookmarks and reference-marks, tracked changes, notes, annotations, divisions, index wrappers, forms, and anchored frames; see [Fidelity constructs](#fidelity-constructs)).
- **`readOdfFormulaMathMl`** — resolves a standalone/embedded `.odf` formula's bare-MathML `content.xml` into raw MathML nodes plus a StarMath annotation, with no pivot shaping at all. **`readOdfFormulaContent`** wraps that into a real `'formula'`-kind `ContentDocument`, and **`readOdfFormula`** into a `DocumentTree`.
- **`readOdm`** — resolves a `.odm` master document into an ordered list of chapter references (`{ name, href, filterName? }`); chapters are genuinely external `.odt` files by ODF design, never cached.
- **`readOdbInventory`** — resolves a `.odb` into connection info, table names, query definitions (`{ name, command, escapeProcessing? }` with real SQL text), and form/report `{ name, href }` pairs. A sub-document directory is named after an opaque _persistent_ name (`forms/Obj11`), not the user-visible name.
- **`readOdbForm`/`readOdbReport`** — extract one sub-document's _static structure_, executing nothing: a form's control tree and data bindings, or a report's band stack, recursive group tree, bound fields, and computed expressions.
- **OpenOffice.org 1.x / StarOffice 6-7 reading** (`readSxw`/`readSxc`/`readSxi`/`readSxd` and their `*Content` siblings, plus `transformOoo1Package` and `isOoo1Package`) — the pre-OASIS ancestor ODF 1.0 was based on, read through the ODF readers above rather than beside them. See [Reading and writing an OpenOffice.org 1.x document](#reading-and-writing-an-openofficeorg-1x-document).
- **OpenOffice.org 1.x writing** (`writeSxw`/`writeSxwContent`, plus `transformToOoo1Package`, the read-side transform's own inverse) — `.sxw` only, built on `writeOdt`/`writeOdtContent`: `.sxc`/`.sxi`/`.sxd` have no writer yet. `.sxc` now has a real `writeOds`/`writeOdsContent` to build one on (the same relationship `.sxw` already has to `writeOdt`/`writeOdtContent`); `.sxi`/`.sxd` still have no `writeOdp`/`writeOdg` underneath them.
- **The odt writer, at the same two levels** — `writeOdt` takes the `DocumentTree` `readOdt` returns and `writeOdtContent` the flat `ContentDocument` `readOdtContent` returns, and both produce a real `.odt` `Package` (`encodePackage` turns it into bytes). Paragraphs, headings, runs with character formatting and hyperlinks, whitespace, lists, tables, images, explicit page breaks, per-section page geometry, and `meta.xml` all round-trip; the fidelity constructs and embedded objects are refused by name rather than silently dropped. See [Writing a document](#writing-a-document).
- **The ods writer, at the same two levels** — `writeOds`/`writeOdsContent`, the genuine inverse of `readOds`/`readOdsContent`. Every `office:value-type` a cell can carry (float/percentage/currency/boolean/date/time/string, plus a value-less cell), column widths, row heights, hidden rows/columns, merged ranges, cell background/borders/alignment/vertical-alignment, verbatim formulas, cell-anchored images, and print settings (page geometry, gridlines/headers, page order, scale/fit-to-page, print range, repeated header rows/columns, manual page breaks) all round-trip. Embedded objects, data-validation rules, and conditional-formatting rules are refused by name — `readOdsContent` has no write-side counterpart for any of the three yet. See [Writing a document](#writing-a-document).

Not yet built: writers for `.odp`/`.odg`, a write path for the fidelity constructs, a `.ods` cell's own `number:*` data-style (`readOdsContent` does not read one back yet, so there is nothing to write against), live-view editors, and the `.odb` database-table-export subsystem. A general-purpose SQL query engine for rendering a Report against its data is **deliberately not attempted** — building even a bounded SQL engine means reimplementing HSQLDB's/Firebird's query semantics, a materially different undertaking from decoding their file formats, with unreviewed licensing questions. Gated on the requesting engineer's explicit sign-off.

## Getting started

Requires Node.js `>=20` and pnpm `11.6.0` (pinned via `packageManager` in `package.json`).

```sh
pnpm install
```

Install as a dependency in another project:

```sh
pnpm add odf.js
# or
npm install odf.js
```

## Build, test, and lint

```sh
pnpm build         # turbo run _build -> tsdown (dist/: ESM + CJS + .d.ts)
pnpm typecheck     # turbo run _typecheck -> tsc -p tsconfig.json && tsc -p tsconfig.node.json
pnpm lint          # turbo run _lint -> eslint . --fix --cache --max-warnings 0
pnpm test          # turbo run _test -> vitest run --project unit
pnpm test:workers  # turbo run _test:workers -> vitest run --config vitest.workers.config.ts (the package parsing and ODF content readers run inside a real Cloudflare Workers isolate, proving they carry zero Node-only API usage)
```

To run a single test file: `pnpm vitest run src/path/to/file.test.ts`.

## Usage

### Reading a document

A typed reader takes a `Package` (bytes go through `decodePackage`/`parsePackage` first) and returns a [`DocumentTree`](../document-schema.js/README.md#the-package-tree) — `document-schema.js`'s single hierarchical artefact, where structure, layout, and content are fused in one tree and a `styles` table has already been minted over it:

```ts
import { decodePackage, readOdt } from "odf.js";

const pkg = decodePackage(new Uint8Array(await file.arrayBuffer()));
const document = readOdt(pkg);

document.kind; // 'wordprocessing'
document.metadata; // title, author, keywords, ... from meta.xml
document.children; // one section group per ContentSection, headings and lists grouped inside it
document.styles; // the minted styles table the tree's `style` refs name
```

One reader per format, each returning the `DocumentTree` arm its format produces:

| Format | Reader           | Package kind     |
| ------ | ---------------- | ---------------- |
| `.odt` | `readOdt`        | `wordprocessing` |
| `.odp` | `readOdp`        | `presentation`   |
| `.ods` | `readOds`        | `spreadsheet`    |
| `.odg` | `readOdg`        | `drawing`        |
| `.odf` | `readOdfFormula` | `formula`        |

Each is assembled through `document-schema.js`'s own `assembleTree`, so odf.js's packages are built exactly the way every other package construction site in this family builds one. No `pages` array is populated and no node carries `frames`: a reader runs before any layout pass, and rendered page geometry is a layout engine's to report, never a reader's to invent.

### Writing a document

A typed writer takes a `document-schema.js` `DocumentTree` or flat `ContentDocument` and returns a real `.odt` `Package` — the exact inverse of the reader pair above, mirroring `readOdt`/`readOdtContent`'s own two-level shape:

```ts
import { writeOdt, writeOdtContent, encodePackage } from "odf.js";

const pkg = writeOdt(document); // document-schema.js's DocumentTree -> a real .odt Package
const bytes = encodePackage(pkg); // Package -> bytes

const pkgFromContent = writeOdtContent(contentDocument); // the flat ContentDocument level, same shape readOdtContent returns
```

Paragraphs, headings, runs (character formatting, hyperlinks), whitespace, lists, tables, images, explicit page breaks, per-section page geometry, and `meta.xml` all round-trip: `flattenTree(readOdt(writeOdt(document)))` reproduces `document` up to the same normalisation `normaliseOdtContent` states explicitly (its own doc comment — a section-less input, for instance, has no page geometry to invent, so it refuses rather than fabricating one).

The fidelity constructs `readOdt` reads (fields, bookmarks, notes, annotations, tracked changes, divisions, index wrappers, forms) and embedded objects are refused **by name** rather than silently dropped — a block or paragraph carrying one throws naming exactly what it carries, since writing a document that silently lost semantic content would be worse than not writing it at all. The one deliberate exception is the quarantined residue channel: residue is opaque by construction, so re-emitting it would be actively wrong rather than merely incomplete, and it is dropped instead, a known, tracked restorable-fidelity gap rather than a silent one.

`.odt` and `.ods` have a writer today — `.odp`/`.odg` are read-only still (see [Status](#status)).

`writeOds`/`writeOdsContent` are the same shape, over `readOds`/`readOdsContent`:

```ts
import { writeOds, writeOdsContent, encodePackage } from "odf.js";

const pkg = writeOds(document); // document-schema.js's DocumentTree -> a real .ods Package
const bytes = encodePackage(pkg); // Package -> bytes

const pkgFromContent = writeOdsContent(contentDocument); // the flat ContentDocument level, same shape readOdsContent returns
```

Every `ContentCellValue` kind `readOdsContent` can actually produce (number, percentage, currency, boolean, date, time, string, a value-less cell) writes back with the correct `office:value-type`; `'dateTime'` and `'error'` are refused by name, since the reader's own `office:value-type` switch can never produce either kind for an `.ods` document, so there is no genuine inverse to verify a write against. A `'time'` cell's ISO wall-clock value is converted to a real ODF `xsd:duration` for `office:time-value` — the format's only valid spelling — even though `readOdsContent` does not yet convert it back on the way in, a narrow, pre-existing, unrelated reader gap this writer's own correctness does not depend on. Column widths, row heights, hidden rows/columns, and merged ranges all round-trip: `flattenTree(readOds(writeOds(document)))` reproduces `document` up to the normalisation `normaliseOdsContent` states explicitly — a sparse `columns`/`rows` array densifies to one entry per position across the sheet's own used range (ODF's `table:table-column`/`-row` model is purely positional), and a value-less, formula-less, text-less cell vanishes entirely (`readOdsContent`'s own trailing-empty-cell skip runs before any of its other attributes are considered). Cell-anchored images, print settings (page geometry, gridlines/headers, page order, scale/fit-to-page, print range, repeated header rows/columns, manual page breaks), and multiple sheets all round-trip too.

Embedded objects, data-validation rules, and conditional-formatting rules are refused **by name** for every sheet — `readOdsContent` has no write-side counterpart for any of the three yet (no embedded-sub-document package writer exists anywhere in this package's typed layer, and the reader itself never populates either rule array). A cell's own `numberFormatCode` is not written as a `number:*` data-style/`style:data-style-name` reference for the same reason: `readOdsContent` does not populate that field for any cell today, so there is no genuine inverse to write against. Sheet-level residue is dropped, the same deliberate exception `writeOdt` makes.

### The flat `ContentDocument` level

Beneath each package-native reader sits the flat reader it is built on, unchanged in behaviour and exported under a `*Content` name. Reach for these when you work in `document-schema.js`'s flat codec-exchange form — as `documents.js`'s own conversion pipeline does — rather than in the tree:

```ts
import { readOdsContent, readOdfFormulaMathMl } from "odf.js";

const { metadata, sheets } = readOdsContent(pkg); // the flat ContentSheet[] shape, no tree, no styles table
const { mathml, starMath } = readOdfFormulaMathMl(formulaPkg); // rawest of all: MathML nodes and the StarMath annotation
```

`readOdtContent`/`readOdpContent`/`readOdgContent`/`readOdsContent` return `{ metadata, sections | slides | pages | sheets }`; `readOdfFormulaContent` returns a whole `'formula'`-kind `ContentDocument`; `readOdfFormulaMathMl` returns the raw MathML with no pivot shaping at all. A package-native reader calls its own `*Content` sibling and reshapes that result, so the two levels are one read and can never disagree about what the file says.

Crossing between the levels is `document-schema.js`'s job, not this package's: `flattenTree(readOdt(pkg))` reproduces exactly what `readOdtContent(pkg)` returns, wrapped in its `ContentDocument` envelope. That equality is pinned per format against real fixture bytes in this package's own test suites.

### The primary names moved — migrating from 4.x

Every bare `readOdX` name now belongs to the package-native reader. Callers of the old flat functions rename; nothing about those functions' behaviour changed:

| 4.x                      | 5.0                     | Returns              |
| ------------------------ | ----------------------- | -------------------- |
| `readOdt`                | `readOdtContent`        | `OdtDocument`        |
| `readOdp`                | `readOdpContent`        | `OdpDocument`        |
| `readOdg`                | `readOdgContent`        | `OdgDocument`        |
| `readOds`                | `readOdsContent`        | `OdsDocument`        |
| `readOdfFormulaDocument` | `readOdfFormulaContent` | `ContentDocument`    |
| `readOdfFormula`         | `readOdfFormulaMathMl`  | `OdfFormulaDocument` |

The rename is a compile error at every call site, never a silent behaviour change: each new bare name returns a `DocumentTree`, which is assignable to none of the old return types.

`readOdm`, `readOdbInventory`, `readOdbForm`, and `readOdbReport` are untouched, and none gains a package-native form. `readOdm`'s chapters are external file references and `readOdbInventory`/`readOdbReport` describe structure rather than content, so none of those three has a `ContentDocument` to decompose. `readOdbForm` is the exception that proves the rule rather than a fourth case of it: a form's sub-document is a complete, ordinary ODF text document, so `readOdbForm` does call `readOdtContent` on it and does return an `OdtDocument` — but that document is one component nested inside the form's own control-tree result, not the function's own top-level return value, so there is no `DocumentTree`-native `readOdbForm` to add without changing what the function returns altogether.

### The lossless core

The ZIP-of-XML layer every reader above is built on:

```ts
import { decodePackage, encodePackage } from "odf.js";

// .odt / .ods / .odp bytes -> faithful JSON Package
const pkg = decodePackage(new Uint8Array(await file.arrayBuffer()));

// ...inspect pkg.parts...

// Package -> bytes (content-identical, mimetype-first/stored, manifest untouched)
const bytes = encodePackage(pkg);
```

Manifest and mimetype, ODF's own package-identity mechanism (no relationships, unlike OOXML):

```ts
import {
  readManifest,
  syncManifest,
  setDocumentMediaType,
  readMimetype,
} from "odf.js";

const manifest = readManifest(pkg); // { entries: [{ fullPath, mediaType }, ...] }
setDocumentMediaType(pkg, "application/vnd.oasis.opendocument.text"); // updates mimetype + manifest root entry atomically
syncManifest(pkg); // rebuilds manifest.xml to exactly match pkg's current parts
readMimetype(pkg); // 'application/vnd.oasis.opendocument.text'
```

### Reading and writing an OpenOffice.org 1.x document

`.sxw`/`.sxc`/`.sxi`/`.sxd` (and their `.stw`/`.stc`/`.sti`/`.std` template counterparts) are OpenOffice.org 1.x / StarOffice 6-7 documents — the format OASIS based ODF 1.0 directly on. They read through the same functions as their ODF successors, one reader per format, at the same two levels:

```ts
import { decodePackage, readSxw, readSxcContent } from "odf.js";

const document = readSxw(decodePackage(sxwBytes)); // a wordprocessing DocumentTree
const { sheets } = readSxcContent(decodePackage(sxcBytes)); // the flat ContentSheet[] shape
```

| Format          | Reader    | Flat sibling     | Package kind     |
| --------------- | --------- | ---------------- | ---------------- |
| `.sxw` / `.stw` | `readSxw` | `readSxwContent` | `wordprocessing` |
| `.sxc` / `.stc` | `readSxc` | `readSxcContent` | `spreadsheet`    |
| `.sxi` / `.sti` | `readSxi` | `readSxiContent` | `presentation`   |
| `.sxd` / `.std` | `readSxd` | `readSxdContent` | `drawing`        |

None of these is a second reader. Each is `readOdt`/`readOds`/`readOdp`/`readOdg` run over a package `transformOoo1Package` has rewritten into the ODF shape — the same approach LibreOffice itself takes, where a `.sxw` goes through a transformer (`xmloff/source/transform/`) into the ordinary ODF importer rather than through an importer of its own. Every construct the ODF readers understand therefore works on an OpenOffice.org 1.x document too, and a fix to any of them fixes both formats at once.

`transformOoo1Package` is exported for a caller that wants the transformed `Package` rather than a read of it, and returns anything that is not an OpenOffice.org 1.x package unchanged; `isOoo1Package` is the same detection on its own, decided by the namespace URIs the package's parts declare rather than by a file extension or a manifest media type. `OOO1_NAMESPACES`, `OOO1_MEDIA_TYPES`, `ooo1MediaTypeForExtension` and `odfMediaTypeForOoo1MediaType` expose the format's own namespace and media-type tables.

`.sxw` has a real writer, built the same way the reader is — as a transform either side of the ODF writer, not a second writer of its own:

```ts
import { writeSxw, writeSxwContent, encodePackage } from "odf.js";

const pkg = writeSxw(document); // a wordprocessing DocumentTree -> a real .sxw Package
const bytes = encodePackage(pkg); // Package -> bytes

const pkgFromContent = writeSxwContent(contentDocument); // the flat ContentDocument level, same shape writeOdtContent returns
```

`writeSxw`/`writeSxwContent` call `writeOdt`/`writeOdtContent` to build a real ODF `.odt` `Package`, then run it through `transformToOoo1Package` — `transformOoo1Package`'s own inverse, reversing every rename and restructure the read-side transform documents (namespace URIs, the `office:class` genre wrap/unwrap, the `style:properties` typed-family split/merge, the `draw:frame` wrap/unwrap, the renamed elements and attributes, the `"inch"`/`"in"` unit spelling, and the package-level mimetype/manifest handling) against the same LibreOffice transformer source and OpenOffice.org DTD the forward direction is grounded against. The result genuinely declares OpenOffice.org 1.x namespace URIs, carries no `mimetype` part, and reads back correctly through the ordinary `readSxw`/`readSxwContent` — `readSxw(writeSxw(document))` recovers `document` up to the exact same canonical form `normaliseOdtContent` already states for `writeOdt`, since `writeSxwContent` is `writeOdtContent`'s own output run one transform further. What `writeOdt` refuses (the fidelity constructs — fields, bookmarks, notes, annotations, tracked changes, divisions, index wrappers, forms — and embedded objects), `writeSxw` refuses too, for the same reason: a document that silently lost semantic content would be worse than one this writer declined to produce at all.

`.sxc`/`.sxi`/`.sxd` have no writer yet — this package's typed layer has no `writeOds`/`writeOdp`/`writeOdg` for one to be built on; only `.odt`/`.sxw` do. See [What differs between the two vocabularies](#what-differs-between-the-two-vocabularies) for what the transform covers, and its own module comment (`src/ooo1/transform.ts`) for the full list, including the reverse direction's own note (`transformToOoo1Package`) on the package-wide context (a document's `office:class`, a list's ordered/bullet kind) the reverse needs that the forward direction never did.

### What differs between the two vocabularies

ODF kept OpenOffice.org XML's document model and most of its element and attribute names. What it changed, and what `src/ooo1/` therefore implements:

- **Every namespace URI OpenOffice.org minted** (`http://openoffice.org/2000/office` and its family) became an OASIS one, and `fo:`/`svg:` went the other way — OpenOffice.org bound them to the real W3C XSL-FO and SVG namespaces, where ODF mints its own `xsl-fo-compatible`/`svg-compatible` URIs.
- **The document's genre.** OpenOffice.org 1.x names it in an `office:class` attribute on the root and puts the content straight inside `office:body`; ODF dropped the attribute and wraps the content in `office:text`/`office:spreadsheet`/`office:presentation`/`office:drawing`/`office:chart`.
- **One `style:properties` per style became ODF's family of typed `style:*-properties` elements.** This is the one difference a namespace rename cannot paper over, because the same attribute name is valid in several of them with a different meaning in each (`fo:background-color` is a character highlight, paragraph shading, or a cell fill depending on which element it sits in). The split follows LibreOffice's own algorithm — an ordered candidate list per style family, first match wins — and lives in `src/ooo1/properties.ts`.
- **Frames.** `draw:image`, `draw:text-box`, `draw:object` and their siblings are bare shapes carrying their own position and anchoring; ODF wraps each in a `draw:frame` that carries those instead.
- **Renames**: `text:ordered-list`/`text:unordered-list` → `text:list`, the footnote/endnote pair → the `text:note` family with a `text:note-class`, `text:tab-stop` → `text:tab`, `text:h/@text:level` → `@text:outline-level`, `office:font-decls`/`style:font-decl` → `office:font-face-decls`/`style:font-face`, `style:page-master` → `style:page-layout`, `table:sub-table` → `table:table` + `table:is-sub-table`, and the `meta:keywords` wrapper unwrapped to bare `meta:keyword` children.
- **Values, not just names**: lengths written in the `"inch"` unit become `"in"`; a cell's `table:value-*` attributes become `office:value-*`; the compound `style:text-underline`/`style:text-crossing-out` attributes expand into ODF's style/type/width triples; `fo:keep-with-next`'s boolean becomes `always`/`auto`; a package-internal `xlink:href` loses the `#` OpenOffice.org prefixed it with; and `office:annotation`/`office:change-info` move their author and date from attributes into `dc:creator`/`dc:date` child elements.
- **The package.** An OpenOffice.org 1.x package has no `mimetype` part at all — the manifest's `/` entry, in its own `http://openoffice.org/2001/manifest` namespace, is the only record of the document's type. The transform rewrites that entry to the OASIS media type and synthesises the `mimetype` part.

### Direct module imports

Every module is also importable directly by its own subpath, without going through the barrel:

```ts
import { parseOdfLength } from "odf.js/typed/shared/units";

parseOdfLength("2.5cm"); // 70.86614173228347
```

Any `src/**/*.ts` module (excluding tests and `test-support/` fixtures) resolves at its path relative to `src/` — `src/manifest.ts` as `odf.js/manifest`, `src/typed/odt/read.ts` as `odf.js/typed/odt/read`, and so on.

## Architecture

Layered from a lossless core outward, mirroring `ooxml.js`:

- **`src/model/`** — `Package`/`XmlNode`/`XmlElement`: a duplicate-by-design copy of `ooxml.js`'s equivalent.
- **`src/xml/`** — XML parse/build (`fast-xml-parser`), production element/text-node construction, entity encoding, and tree-query helpers.
- **`src/image/`** — `sniffImageFormat`: a PNG/JPEG magic-byte sniffer consumed by `src/manifest.ts` and `src/typed/draw/shapes.ts`.
- **`src/zip.ts`** — takes _ordered_ `[path, entry]` tuples, not a `Record`, so the mimetype-first/stored/uncompressed requirement doesn't depend on insertion order surviving a Zod round trip.
- **`src/package-io/`** — `write.ts` hoists `mimetype` first (stored) and `META-INF/manifest.xml` second if present; never fabricates either as a side effect.
- **`src/manifest.ts`** — full manifest read/write; the manifest is ODF's one mandatory part, unlike `ooxml.js`'s read-only OPC-relationship stance.
- **`src/styles/`** — `properties.ts`/`serialize.ts` (canonical property-bag ↔ XML attributes), `registry.ts` (`StyleRegistry`, the mandatory style-interning layer), `span.ts` (character-range `text:span` wrapping).
- **`src/typed/shared/`** — ODF-specific typed primitives every reader builds on (units, A1 cursors, colour/geometry, whitespace runs, style cascade, shared paragraph/table readers, transform/path parsing, metadata).
- **`src/typed/odt/`, `odp/`, `odg/`, `ods/`** — one module per format, each carrying both levels of its reader: the package-native `readOdt`/`readOdp`/`readOdg`/`readOds` and the flat `readOdtContent`/`readOdpContent`/`readOdgContent`/`readOdsContent` it is built on.
- **`src/typed/draw/`** — the shared `draw:frame`/`draw:g`/vector shape vocabulary and `readDrawImageBlock` (`shapes.ts`), plus `embedded.ts` (`readDrawObjectReference`, `readEmbeddedObjectDocument`, `readOdfChartContent` — the shared embedded-object reference resolver and the central kind→reader dispatch table).
- **`src/typed/formula/`, `odm/`** — `readOdfFormula`/`readOdfFormulaContent`/`readOdfFormulaMathMl` and `readOdm`.
- **`src/typed/odb/`** — `readOdbInventory`, `readOdbForm`/`readOdbReport`, `resolveOdbComponent`, `subDocumentPackage`.
- **`src/ooo1/`** — the OpenOffice.org 1.x variant reader and writer: `ns.ts` (the pre-OASIS namespace and `application/vnd.sun.xml.*` media-type tables plus package detection, in both directions), `properties.ts` (the `style:properties` split, and `mergeStyleProperties`, its own inverse), `transform.ts` (the whole package rewrite, `transformOoo1Package` and its inverse `transformToOoo1Package`), `read.ts` (`readSxw`/`readSxc`/`readSxi`/`readSxd`), `write.ts` (`writeSxw`/`writeSxwContent`). Sits _beside_ `typed/`, not inside it: it adds no reader or writer of its own for the ODF content model, it feeds `writeOdt`'s output into `transformToOoo1Package` and the ODF readers' input through `transformOoo1Package`.

## Conventions

- **Zod-first schema/type/guard**, matching `ooxml.js`/`document-schema.js`: every model type is inferred from its Zod schema, never hand-written.
- **Recursive types use a hand-written structural guard, not `z.lazy`** (collapses to `unknown` in the pinned Zod version).
- **No type assertions anywhere** — `assertionStyle: 'never'`, `noInlineConfig: true`.
- **Ground truth over memory for every ODF spec fact** — namespace URIs, media types, and attribute names are verified against the OASIS spec or real LibreOffice output, never assumed from an OOXML analogue (see [Gotchas](#gotchas-and-quirks)).

## Gotchas and quirks

- **Several ODF namespace URIs are not what you'd guess from the prefix.** `draw:` is `...drawing:1.0`, `number:` is `...datastyle:1.0`, `fo:`/`svg:`/`smil:` are `*-compatible:1.0`. See `src/ns.ts`.
- **OpenOffice.org 1.x's `presentation:` namespace is `http://openoffice.org/2000/presentation`, not the `2001/` one OpenOffice.org's own DTD declares.** `xmloff/dtd/nmspace.mod` says `2001/presentation`; every real `.sxi` says `2000/presentation`, and the `2001` spelling appears nowhere in LibreOffice's namespace table — so nothing could ever have read it. `config:` and `manifest:` genuinely are the `2001/` ones.
- **An OpenOffice.org 1.x package has no `mimetype` part.** That convention arrived with ODF; before it, the manifest's `/` entry was the only record of a document's type, and it is what `isOoo1Package`-adjacent code reads. `transformOoo1Package` synthesises the ODF part.
- **OpenOffice.org 1.x writes lengths in an `"inch"` unit ODF does not have** (`svg:width="1.9992inch"`), so `parseOdfLength` rejects them — the OpenOffice.org transform rewrites the unit before any reader sees it.
- **`.odb`'s media type is `application/vnd.oasis.opendocument.base`**, not `...database`.
- **`dc:creator` records whoever most recently _saved_ the document, not the author** — the original author is `meta:initial-creator`.
- **`meta:keyword` appears once per keyword**, unlike OOXML's single comma-separated `cp:keywords`.
- **`table:number-columns-repeated`/`-rows-repeated` must be cursor-advanced, never materialized** — real sheets have trailing repeat counts over a million.
- **ODF cells carry no explicit cell-reference attribute** (unlike xlsx's `r="B7"`) — `typed/shared/a1.ts` computes references from a running cursor.
- **A rotated `draw:rect`/`ellipse`/`path`/`custom-shape` reads its own `rotationDeg`** via the same `resolveOdfShapeGeometry` machinery `draw:frame` uses, composing any enclosing `draw:g` rotation.
- **Every `ContentShape`/`ContentVector` carries a resolved `paintOrder`** so true relative paint order survives across the independently-ordered `shapes`/`vectors` arrays.
- **`svg:fill-rule` and `draw:stroke` map onto `ContentVector.fillRule`/`ContentStroke.style`.** A dotted pattern and `"double"` stroke have no ODF vector-stroke counterpart and remain unread.
- **`readOdsContent`/`readTableCell` resolve cell `background`/`borders`/`alignment`/`verticalAlignment` from the real style cascade.** An explicit `fo:border-*` of `"none"`/`"hidden"` clears an inherited edge.
- **`readOdsContent` reads sheet-anchored drawings** — cell-anchored `draw:frame`s (coordinates relative to the cell) and page-anchored ones (in `table:shapes`). An embedded chart resolves as a `chart`-kind object whose document is a frame-sized drawing page carrying the chart's own cached data table, with the `chart:chart` element quarantined in residue. A sheet cannot carry a floating text box or bare vector; each is skipped.
- **`readDrawObjectReference` resolves a frame's embedded sub-document kind from its own `content.xml`, not the manifest.** A `draw:object` must be checked _before_ the frame's preview image, since an embedded-object frame also carries a preview `draw:image`.

## Fidelity constructs

`readOdt` reads ODF's fidelity constructs into `document-schema.js`'s harmonised construct vocabulary — the semantic channel of the family's two-channel fidelity model (the quarantined residue channel is the other half). Two residue rows carry genuine producer fixtures (`conditional-format.ods`, `transitions.odp` — real LibreOffice output, generated through the same UNO calls the Calc/Impress UIs use); every other fixture below the unit suites is programmatic, built to the OASIS element grammar, with real-producer verification outstanding.

- **Fields** — every inline field element (the simple set, the variable/user-field/sequence instance families, the database displays, and the `*-ref` cross-reference displays — `text:bookmark-ref`, `text:reference-ref`, `text:note-ref`, `text:sequence-ref`) reads as ordinary runs carrying its cached text plus a run-level field extent on the paragraph, instruction being the serialised element and `cachedResult` its own text content. Field master declarations (`text:*-decls`) read into the package-root definitions table, keyed per family.
- **Bookmarks, reference-marks, and tracked changes** — paired marker halves at run scope pair inside one paragraph; halves at paragraph edges pair across blocks into `constructStart`/`constructEnd` markers. A `text:reference-mark` is a point bookmark anchor; a `text:reference-mark-start`/`-end` pair is a range anchor in its own pairing family (ODF keeps reference-mark names and bookmark names in separate namespaces, so a same-named bookmark and reference-mark pair independently). Change markers resolve their `text:change-id` against the `text:changed-region` definitions (either id spelling, `xml:id` today and ODF 1.0's `text:id`), carrying author and date as provenance.
- **Notes and annotations** — a `text:note`'s citation becomes a run, its body a definitions entry, an anchor extent naming both; an `office:annotation` does the same and pairs with `office:annotation-end` by `office:name` over a range, falling back to a point anchor when no end arrives.
- **Divisions and index wrappers** — `text:section` brackets its blocks as a division construct (name, protected, column count, and a `text:section-source`'s external-chapter link); the seven index wrappers bracket their cached `text:index-body` blocks as `index` content controls, with the wrapper's `*-source` build rules quarantined in residue.
- **Forms** — `office:forms` in an ordinary text document reads as point content controls in pre-order through the same form-tree walker the `.odb` reader uses; `form:properties` bags quarantine into residue.
- **Anchored frames** — a `draw:frame` in text flow lifts to blocks after its paragraph: images, text-box content, and embedded objects (formula, drawing, presentation, chart, spreadsheet), each dispatched through `typed/draw/embedded.ts`'s shared `readEmbeddedObjectDocument` — the central kind→reader table that lets a Writer document read an embedded Calc sheet (and a Calc sheet an embedded Writer document) without any format reader importing a sibling reader.
- **Style-side tenants** — `number:*` data styles and `office:font-face-decls` read into the definitions table from both parts; a paragraph style's unmodellable properties quarantine as per-node residue.
- **Master pages and page-break styles** — every `style:master-page` reads as part of a whole-page inventory: a paragraph style's `style:paragraph-properties/@style:master-page-name` switch opens a new `ContentSection` at that paragraph carrying the named master page's own geometry (`breakType: 'nextPage'` — ODF defines the switch as forcing a page break), and each master page's `style:header`/`style:footer` variants (default, `-left`, `-first`) read as real block flow on `OdtDocument.headerFooterParts`, with `sectionMasterPages` naming positionally which master page each section came from. Explicit page breaks ride the shared cascade: `fo:break-before`/`fo:break-after="page"` resolve onto the paragraph's `pageBreakBefore`/`pageBreakAfter` flags (`auto` to an explicit false; `column`/`even-page`/`odd-page` quarantine as residue through the unknown-properties path, since the boolean cannot hold their extra meaning).
- **The quarantined residue rows** — inline no-analogue constructs (`text:ruby`, `text:meta`, a heading's `text:is-list-header` flag) quarantine on their own paragraph beside the style-chain unknowns; document-level tenants nothing else owns (`xforms:model`, DDE connection declarations and `text:dde-source` links, vendor-extension elements) quarantine at the package tier on `OdtDocument.source`; `table:calculation-settings` and vendor-extension elements (Calc writes its `calcext:conditional-formats` inside each `table:table`) do the same on `OdsDocument.source`; an odp slide's presentation extras — the transition attributes off the slide's own drawing-page style, where every ODF schema version and real Impress output put them (the legacy `presentation:transition-*`/`presentation:duration` spelling and the ODF 1.2 `smil:type`/`-subtype`/`-direction`/`-fadeColor` one), plus `presentation:sound` and `anim:` trees — and every format's unmapped shape kinds (`dr3d:scene`, `draw:connector`, `draw:measure`, applet/plugin/floating-frame) quarantine on their own slide/page; an unrecognised `draw:custom-shape` preset's whole `draw:enhanced-geometry` quarantines in the text shape it degrades to; and every non-content XML part (`settings.xml`, `META-INF/manifest.rdf`, `Configurations2/…`) quarantines at the package tier keyed by its part path — never an embedded sub-document's own `Object N/` parts, which the semantic channel already carries whole.

Every read-side construct listed above has no write-side counterpart: `writeOdt` refuses each of them by name rather than silently dropping it (see [Writing a document](#writing-a-document)), so the honest asymmetry is a reader that recovers more than either writer will re-emit, not a package with no content writer at all; the lossless `encodePackage` layer remains the byte-fidelity tier regardless.

- **An embedded Math object in a spreadsheet cell reads as `objectKind: 'formula'`** — its `content.xml` root _is_ the MathML root, so `readDrawObjectReference` falls back to `findMathRoot` and dispatches to `readOdfFormulaContent`.
- **A `draw:frame`'s alternative text (`svg:title`, falling back to `svg:desc`) reads into `ContentImageBlock.altText`.**
- **`readOdbInventory`'s `queries` carry real `db:command` SQL text**, not just names — a breaking rename from `string[]` to `OdbQueryInfo[]`.
- **`.odb` Form/Report structure extraction is real** (`readOdbForm`/`readOdbReport`), grounded in a genuine fixture. **A SQL/`rpt:` rendering engine to execute a query or evaluate report totals is deliberately not attempted** — see the Status section. Even a fully bounded SQL engine would not suffice to render a report: grouping breaks (`rpt:HASCHANGED`), prefix functions (`rpt:LEFT`), and running totals (`rpt:SUM`) are evaluated by Report Builder's own `rpt:` formula language, not by SQL.

## Release and publishing

Release, CI, and commit-message conventions are all workspace-wide, not package-local — see the [monorepo root README](../../README.md#releases) for the mechanism (topological per-package `semantic-release` via `@exadev/semantic-release-workspace`, OIDC trusted npm publishing, automatic sibling dependency-range rewriting) and its [post-release republishing and attestation](../../README.md#releases) note on the restored GitHub Packages mirrors, npm aliases, and SBOM/provenance signing.

## Contributing

Conventional Commits, enforced workspace-wide by commitlint through a root `commit-msg` hook. Work inside `packages/odf.js/`; see [CONTRIBUTING.md](../../CONTRIBUTING.md) for the shared git hooks and history conventions.

## References

- [ooxml.js](../ooxml.js/README.md) — the OOXML sibling; architecturally mirrored, deliberately not depended on.
- [document-schema.js](../document-schema.js/README.md) — the canonical `ContentDocument`/`DocumentTree` schema both packages depend on, and the home of the `assembleTree`/`flattenTree`/`decompose`/`factorStyles` transform between the two encodings.
- [documents.js](https://github.com/ExaDev/documents.js) — the downstream consumer; its own `readOdtContent`/`readOdpContent`/`readOdsContent`/`readOdgContent` adapters wrap this package's flat `*Content` readers into `ContentDocument`s, adding the odt/odp formula, image, and vector detection passes those readers deliberately leave out.
- [OpenOffice.org XML File Format 1.0](https://www.openoffice.org/xml/general.html) ([archived](https://web.archive.org/web/20240101000000*/https://www.openoffice.org/xml/general.html)) — the pre-OASIS format's own project page, and the source of the DTD (`xmloff/dtd/office.mod`, `text.mod`, `nmspace.mod`, [retained in Apache OpenOffice's tree](https://github.com/apache/openoffice/tree/trunk/main/xmloff/dtd)) that `src/ooo1/` was written against.
- [LibreOffice's own OpenOffice.org-to-ODF transformer](https://github.com/LibreOffice/core/tree/master/xmloff/source/transform) — `OOo2Oasis.cxx`'s element and attribute action tables and `StyleOOoTContext.cxx`'s `style:properties` splitter, cross-checked against for every rename `src/ooo1/` implements. Its namespace token table is [`xmloff/source/core/xmltoken.cxx`](https://github.com/LibreOffice/core/blob/master/xmloff/source/core/xmltoken.cxx) (the `XML_N_*_OOO` entries).

## License

MIT
