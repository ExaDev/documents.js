# odf.js

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/documents.js/tree/main/packages/odf.js) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/odf.js) [![npm version](https://img.shields.io/npm/v/odf.js)](https://www.npmjs.com/package/odf.js) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/documents.js/ci.yml?branch=main)](https://github.com/ExaDev/documents.js/actions)

> A hand-written, dependency-minimal codec for the OpenDocument Format (ODF — OASIS/ISO 26300): `.odt`/`.ods`/`.odp`/`.odg`/`.odf`/`.odb`/`.odm` and their template variants, built on [Zod 4](https://zod.dev) codecs — plus read support for the pre-OASIS OpenOffice.org 1.x / StarOffice 6-7 documents ODF was based on (`.sxw`/`.sxc`/`.sxi`/`.sxd`), with real `.sxw`, `.sxc`, and `.sxi` writers alongside it. `.odt`, `.ods`, `.odp`, and `.odg` all read and write.

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
- **OpenOffice.org 1.x writing** (`writeSxw`/`writeSxwContent`, `writeSxc`/`writeSxcContent`, and `writeSxi`/`writeSxiContent`, plus `transformToOoo1Package`, the read-side transform's own inverse) — `.sxw`, built on `writeOdt`/`writeOdtContent`; `.sxc`, built on `writeOds`/`writeOdsContent`; `.sxi`, built on `writeOdp`/`writeOdpContent`. `.sxd` still has no writer of its own — `writeOdg` now exists for one to wrap, so what remains is the wrapper.
- **The odt writer, at the same two levels** — `writeOdt` takes the `DocumentTree` `readOdt` returns and `writeOdtContent` the flat `ContentDocument` `readOdtContent` returns, and both produce a real `.odt` `Package` (`encodePackage` turns it into bytes). Paragraphs, headings, runs with character formatting and hyperlinks, whitespace, lists, tables, images, explicit page breaks, per-section page geometry, and `meta.xml` all round-trip; the fidelity constructs and embedded objects are refused by name rather than silently dropped. See [Writing a document](#writing-a-document).
- **The ods writer, at the same two levels** — `writeOds`/`writeOdsContent`, the genuine inverse of `readOds`/`readOdsContent`. Every `office:value-type` a cell can carry (float/percentage/currency/boolean/date/time/string, plus a value-less cell), column widths, row heights, hidden rows/columns, merged ranges, cell background/borders/alignment/vertical-alignment, verbatim formulas, cell-anchored images, and print settings (page geometry, gridlines/headers, page order, scale/fit-to-page, print range, repeated header rows/columns, manual page breaks) all round-trip. Embedded objects, data-validation rules, and conditional-formatting rules are refused by name — `readOdsContent` has no write-side counterpart for any of the three yet. See [Writing a document](#writing-a-document).
- **The odp writer, at the same two levels** — `writeOdp`/`writeOdpContent`, the genuine inverse of `readOdp`/`readOdpContent`. A slide's shapes (positioned text boxes with formatted runs and lists, a rotated shape's `draw:transform`, a shape carrying a table or an image as its sole content, per-shape text insets), per-slide page geometry, and speaker notes all round-trip. Shape writing itself (`typed/draw/write-shapes.ts`) is factored out as the shared mirror of the read side's own `typed/draw/shapes.ts`, and the `.odg` writer below reuses it unchanged. The fidelity constructs a shape's own text cannot carry (a heading, a run-level construct extent, a page break, an embedded object, a table or image mixed with other shape content) are refused by name; a slide's own residue (transitions/animations/sound) is dropped, the same deliberate exception `writeOdt` makes. See [Writing a document](#writing-a-document) and this package's own [LibreOffice verification](#libreoffice-verification-writeodp) section for what was checked against a real, independent ODF implementation, including the two gaps that verification found and closed.
- **The odg writer, at the same two levels** — `writeOdg`/`writeOdgContent`, the genuine inverse of `readOdg`/`readOdgContent`, and the one writer here with content the others have no vocabulary for: a drawing page's **vector primitives**. Rectangles, ellipses, lines, and free-form paths write as real `draw:rect`/`draw:ellipse`/`draw:line`/`draw:path` elements, with fill and stroke interned as graphic-family automatic styles and a path's own subpaths serialised into genuine `svg:d` path data against an `svg:viewBox` sized to its own frame. A page's text-in-a-frame shapes go through the same `writeDrawShapes` the odp writer uses, and per-page geometry through the same `style:master-page`/`style:page-layout` pair, so a drawing costs no second copy of either. A dotted or double stroke, a non-positive stroke width, and a path with no subpaths or a zero-extent frame are refused by name — ODF has no spelling for the first two, and this package's own reader discards the last two outright. See [Writing a document](#writing-a-document) and [LibreOffice verification (`writeOdg`)](#libreoffice-verification-writeodg).

Not yet built: a `.sxd` writer (which needs only to wrap `writeOdg` the way `writeSxi` wraps `writeOdp`), a write path for the fidelity constructs, a `.ods` cell's own `number:*` data-style (`readOdsContent` does not read one back yet, so there is nothing to write against), live-view editors, and the `.odb` database-table-export subsystem. A general-purpose SQL query engine for rendering a Report against its data is **deliberately not attempted** — building even a bounded SQL engine means reimplementing HSQLDB's/Firebird's query semantics, a materially different undertaking from decoding their file formats, with unreviewed licensing questions. Gated on the requesting engineer's explicit sign-off.

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

`.odt`, `.ods`, `.odp`, and `.odg` all have a writer today (see [Status](#status)).

`writeOds`/`writeOdsContent` are the same shape, over `readOds`/`readOdsContent`:

```ts
import { writeOds, writeOdsContent, encodePackage } from "odf.js";

const pkg = writeOds(document); // document-schema.js's DocumentTree -> a real .ods Package
const bytes = encodePackage(pkg); // Package -> bytes

const pkgFromContent = writeOdsContent(contentDocument); // the flat ContentDocument level, same shape readOdsContent returns
```

Every `ContentCellValue` kind `readOdsContent` can actually produce (number, percentage, currency, boolean, date, time, string, a value-less cell) writes back with the correct `office:value-type`; `'dateTime'` and `'error'` are refused by name, since the reader's own `office:value-type` switch can never produce either kind for an `.ods` document, so there is no genuine inverse to verify a write against. A `'time'` cell's ISO wall-clock value is converted to a real ODF `xsd:duration` for `office:time-value` — the format's only valid spelling — even though `readOdsContent` does not yet convert it back on the way in, a narrow, pre-existing, unrelated reader gap this writer's own correctness does not depend on. Column widths, row heights, hidden rows/columns, and merged ranges all round-trip: `flattenTree(readOds(writeOds(document)))` reproduces `document` up to the normalisation `normaliseOdsContent` states explicitly — a sparse `columns`/`rows` array densifies to one entry per position across the sheet's own used range (ODF's `table:table-column`/`-row` model is purely positional), and a value-less, formula-less, text-less cell vanishes entirely (`readOdsContent`'s own trailing-empty-cell skip runs before any of its other attributes are considered). Cell-anchored images, print settings (page geometry, gridlines/headers, page order, scale/fit-to-page, print range, repeated header rows/columns, manual page breaks), and multiple sheets all round-trip too.

Embedded objects, data-validation rules, and conditional-formatting rules are refused **by name** for every sheet — `readOdsContent` has no write-side counterpart for any of the three yet (no embedded-sub-document package writer exists anywhere in this package's typed layer, and the reader itself never populates either rule array). A cell's own `numberFormatCode` is not written as a `number:*` data-style/`style:data-style-name` reference for the same reason: `readOdsContent` does not populate that field for any cell today, so there is no genuine inverse to write against. Sheet-level residue is dropped, the same deliberate exception `writeOdt` makes.

`writeOdp`/`writeOdpContent` are the same shape, over `readOdp`/`readOdpContent`:

```ts
import { writeOdp, writeOdpContent, encodePackage } from "odf.js";

const pkg = writeOdp(document); // document-schema.js's DocumentTree -> a real .odp Package
const bytes = encodePackage(pkg); // Package -> bytes

const pkgFromContent = writeOdpContent(contentDocument); // the flat ContentDocument level, same shape readOdpContent returns
```

A presentation is a sequence of slides, each a positioned bag of shapes rather than flowed blocks — `writeOdp` writes one `style:master-page`/`style:page-layout` pair per slide (a presentation genuinely allows different slides to reference different page geometry, unlike OOXML's single document-level `p:sldSz`) and one `draw:page` per slide, its shapes written by `typed/draw/write-shapes.ts`'s `writeDrawShapes` — the shape writer this package factored out as the shared mirror of the read side's own `typed/draw/shapes.ts`, so the `.odg` writer reuses it rather than reimplementing shape geometry, insets, and text/table/image content from scratch. A shape's own `frame`/`rotationDeg` write as plain `svg:x`/`svg:y`/`svg:width`/`svg:height` when unrotated, or `svg:width`/`svg:height` plus a `draw:transform="rotate(...) translate(...)"` when rotated — the exact algebraic inverse of the reader's own `resolveOdfShapeGeometry`, exact up to ordinary floating-point rounding on a real round trip. A shape's own text (formatted runs, alignment, spacing, indentation, bullet/ordered lists nested per level) writes as a `draw:text-box`; a shape whose sole block is a table or an image writes that content directly as the frame's own `table:table`/`draw:image`, since a real `draw:frame` can hold exactly one of the three, never a mix — a combination ODF has no spelling for is refused **by name**, the same fidelity-construct stance `writeOdt` takes, and so is a heading or a page break inside a shape's own text (a `draw:text-box` has no `text:h` reading path and no page concept at all). A shape's own `paintOrder` writes as `draw:z-index`, the one spelling ODF has for a stacking order independent of document position, and the one the reader already resolves; a `paintOrder` ODF's own `xsd:nonNegativeInteger` cannot spell (a negative or fractional one) writes no attribute rather than a rounded approximation that would reorder it past a sibling. Speaker notes write as `presentation:notes`, one `text:p` per line. `flattenTree(readOdp(writeOdp(document)))` reproduces `document` up to the normalisation `normaliseOdpContent` states explicitly — including the one fact ODF forces rather than this writer choosing it: an image's own `widthPt`/`heightPt` become its enclosing shape's own frame size, since a `draw:image` has no size of its own at all inside a `draw:frame`. A shape's `fontScale`/`lineSpacingReduction` are dropped and say so: they are DrawingML's own `a:normAutofit` percentages — the shrink factor PowerPoint _computed_ and stored — and ODF's own autofit vocabulary is a mode flag with no computed factor anywhere, so a pptx → odp conversion loses autofit shrink state rather than having it approximated into something the format never said. A slide's own residue (transition/animation/sound facts) is dropped, the same deliberate exception `writeOdt` makes. `.sxi` is covered too: `writeSxi`/`writeSxiContent` wrap this writer exactly the way `writeSxw`/`writeSxc` wrap `writeOdt`/`writeOds` — see [Reading and writing an OpenOffice.org 1.x document](#reading-and-writing-an-openofficeorg-1x-document).

#### LibreOffice verification (`writeOdp`)

Round-tripping through this package's own reader proves internal consistency, not that a real, independent ODF implementation accepts the result — so a sample `.odp` covering multiple slides (one widescreen, one A4-portrait, exercising per-slide page geometry), a shape with mixed bold/italic/plain runs and centred alignment, rotated shapes (`draw:transform`) both away from and at the page origin, shapes whose `paintOrder` disagrees with their document order, a shape whose `draw:name` carries XML special characters, a nested bullet list, a shape carrying a table (including a merged cell) as its sole content, a shape carrying an image as its sole content, and multi-line speaker notes was built with `writeOdp` and checked against LibreOffice 26.2.5.2 directly (`soffice --headless`), matching this package family's own established verification bar (see `doc-codec`'s README and this package's own `.sxw`/`.ods`/`.sxc` writer PRs):

```sh
soffice --headless --convert-to fodp sample.odp   # flat XML, for text-content inspection
soffice --headless --convert-to pdf sample.odp    # rendered pages, for visual inspection
```

Both commands exit `0` with no error. What the flat-XML conversion establishes is that every authored string appears **verbatim** in LibreOffice's re-serialised output — all three `draw:page`s, the `table:table`, the `draw:transform`, both `text:list`s, and every string of authored text: titles, bullets, table cells, the rotated shape's own text. It is not a byte-identity check, and could not be: `--convert-to fodp` re-serialises the whole document through LibreOffice's own writer, which renames styles, reorders and reformats attributes, and adds defaults of its own, so its bytes differ from `writeOdp`'s by construction. The rendered PDF (3 pages, matching the 3 slides) visually confirms the bold/italic mixed formatting, the centred title, the nested bullet list, the shape rotated clockwise by the requested angle, the table with its merged cell, and the A4-portrait slide's own different page geometry, all laid out correctly with no visible loss.

**One gap found and fixed during this verification**: an earlier version of this writer's `presentation:notes` carried no `style:page-layout-name` attribute at all. Real LibreOffice output always states one (a notes page is sized for printing, independent of whatever on-screen size its slide's own page-layout states), and every real producer's own notes page references it directly — `writeOdp` now mints one page-layout for the whole presentation's own notes pages, lazily, the first time any slide actually has notes to write.

**A second gap found and fixed — an undeclared namespace prefix**: speaker notes initially arrived on the slide itself rather than its notes page, which read as LibreOffice's own AutoLayout placeholder-matching declining to bind a minimal `presentation:notes`/`draw:frame` to its internal Notes view. It was not: `presentation:notes` and its frame's `presentation:class` are the only `presentation:`-prefixed names any writer here emits, and `package-io/scaffold.ts`'s shared prefix list never declared that prefix, so the part was not namespace-well-formed XML at all — `xmllint --noout content.xml` reported `Namespace prefix presentation on notes is not defined`. LibreOffice imported the file anyway, treated the unrecognised element as ordinary slide content, and re-homed its text onto the visible shape list. With the prefix declared, `--convert-to fodp` round-trips the notes inside `presentation:notes` where they were written, the slide carries only its own shapes, and `--convert-to pdf` renders no notes text on the slide page.

Nothing between a writer and the emitted bytes checks that a qualified name's prefix is actually bound — `src/xml/build.ts` writes whatever name an element carries — so this failure mode is silent by construction, and round-trips perfectly through this package's own (prefix-string-matching, namespace-unaware) reader. `src/package-io/namespace-declarations.test.ts` now audits every prefix each writer emits, across element and attribute names at any depth, against what that part's own root declares, so the next writer to reach for an undeclared prefix fails a test instead of shipping a document no XML parser will accept.

**`draw:z-index` is honoured by a real consumer**, confirmed on the same sample: its slide-1 shapes were written in an array order deliberately unlike their own `paintOrder` (`3, 1, 0, 2`), and LibreOffice re-emitted them in `paintOrder` order — dropping the attribute and physically reordering the elements instead, the mirror image of what `typed/draw/shapes.ts`'s own reading of `draw:z-index` already documents finding in LibreOffice-authored files.

**One class of defect this verification cannot catch, worth stating so nobody reads more into a green `soffice` run than it proves**: LibreOffice's own length parser accepts values outside the OASIS `length` datatype. A `translate()` component written in JavaScript's exponent notation (`7.105427357601002e-15pt` — the ordinary result of the rotation inverse's terms cancelling for a frame at the page origin) converts through `--convert-to fodp` with no error and lands at the right place, so the file looked correct by every check above while being invalid ODF that this package's own (spec-conforming) reader silently discarded — dropping the whole `translate()` for a rotated frame, and the whole shape for an unrotated one whose `svg:x`/`svg:y` were the unparseable values. `formatOdfLength` now emits fixed-point decimal only, and the regression is pinned by unit tests rather than by a `soffice` run, since `soffice` would have passed either way.

`writeOdg`/`writeOdgContent` are the same shape again, over `readOdg`/`readOdgContent`:

```ts
import { writeOdg, writeOdgContent, encodePackage } from "odf.js";

const pkg = writeOdg(document); // document-schema.js's DocumentTree -> a real .odg Package
const bytes = encodePackage(pkg); // Package -> bytes

const pkgFromContent = writeOdgContent(contentDocument); // the flat ContentDocument level, same shape readOdgContent returns
```

A drawing page is a presentation slide's structural twin — `draw:page`'s content model is one format-agnostic schema fragment shared by `office:drawing` and `office:presentation` alike — so `writeOdg` writes the same one `style:master-page`/`style:page-layout` pair per page and delegates a page's text-in-a-frame shapes to the same `typed/draw/write-shapes.ts`'s `writeDrawShapes` `writeOdp` uses, refusing exactly what that shared writer refuses. What a drawing adds, and the whole reason it has a writer of its own, is `ContentDrawPage`'s second array: **vector primitives**, which a `ContentShape` has no vocabulary for at all.

A `'rect'` writes as `draw:rect`, an `'ellipse'` as `draw:ellipse` (including a circular one — real LibreOffice writes `draw:circle` when width and height happen to be equal, and the reader maps both spellings onto the one variant, so the general spelling loses nothing), a `'line'` as `draw:line` carrying its two endpoints in `svg:x1`/`svg:y1`/`svg:x2`/`svg:y2` rather than a box, and a `'path'` as `draw:path`. Geometry and rotation for the three boxed kinds go through the identical `frameGeometryAttrs` inverse a `draw:frame` uses, because the reader resolves all four element kinds through the same `resolveOdfShapeGeometry`. A path's own subpaths serialise into real `svg:d` path data — one absolute `M` per subpath, an explicit absolute `L`/`C` per segment, a trailing `Z` only when the subpath is closed — against an `svg:viewBox` stated as `0 0 <frame width> <frame height>`, which makes the reader's own viewBox-to-frame scale factor exactly 1 and the coordinates therefore an exact round trip. Every number this writer emits — path coordinates and `svg:viewBox` extents, and `draw:transform`'s own `rotate()` angle alongside its `translate()` lengths — goes through the same fixed-point spelling `formatOdfLength`/`formatOdfNumber` use, since neither `svg:viewBox` nor a bare rotation angle has an exponent form either.

Fill and stroke are graphic-family automatic styles, interned like every other formatting difference (ODF has no direct formatting): `draw:fill="solid"` plus `draw:fill-color`, `draw:stroke="solid"`/`"dash"` plus `svg:stroke-color` and `svg:stroke-width`, and `svg:fill-rule` for a path that states one — the exact six attributes `typed/draw/shapes.ts`'s own `readOdfFillAndStroke` reads. A vector with neither fill nor stroke still carries a style, stating `draw:fill="none"` and `draw:stroke="none"` explicitly: an absent declaration means _inherit_ in ODF, and a consumer's own default graphic style supplies a fill, so an unfilled rectangle that says nothing renders filled. A text-in-a-frame shape carries the identical explicit `draw:fill="none"`/`draw:stroke="none"` for the same reason — `ContentShape` has no fill/stroke vocabulary of its own to lose by stating it, and a real consumer's own default graphic style otherwise renders a plain text shape as a filled, bordered box. A `'dotted'` or `'double'` stroke style is refused **by name** — ODF's `draw:stroke` is enumerated to exactly none/solid/dash and its vector-stroke model has no double-line concept — and so are a non-positive stroke width, a path with no subpaths, and a path whose frame has a zero or negative extent, each of which this package's own reader discards outright rather than reading back smaller.

`flattenTree(readOdg(writeOdg(document)))` reproduces `document` up to the normalisation `normaliseOdgContent` states explicitly, which adds two page-level facts to the ones the shared shape canonical form already states. First, **a page's shapes and vectors share one document-encounter counter**: the reader walks a `draw:page`'s children once, stamping every shape and vector it meets, so an element carrying no `draw:z-index` takes its position in that single walk. This writer emits a page's shapes first and its vectors after, which is a stated choice rather than an implied one — the two arrays carry no interleaving information beyond `paintOrder` itself, so a page whose items state no paint order has no cross-array order to preserve and one has to be picked; anything that _does_ state an ODF-spellable `paintOrder` carries a real `draw:z-index` and is ordered by that instead. Every item's `draw:z-index` is written **unconditionally**, resolved shape (its own stated `paintOrder` when ODF can spell it, its document-encounter index otherwise) — never omitted for the items that state no spellable `paintOrder`, because an item with no attribute at all reads back on a real consumer as appended after every sibling that does carry one, regardless of its own resolved order relative to them (see [LibreOffice verification](#libreoffice-verification-writeodg) below for the mixed case this closes). Second, **both arrays come back sorted by paint order**, because `readDrawPageContent` sorts them — the one structural difference from `writeOdp`'s own canonical form, where a slide has no sibling vectors array for the value to be comparable across. A page's own residue (the unmapped shape kinds and vendor-extension elements the reader quarantines) is dropped, the same deliberate exception every other writer here makes. `.sxd` is not covered — see [Reading and writing an OpenOffice.org 1.x document](#reading-and-writing-an-openofficeorg-1x-document).

#### LibreOffice verification (`writeOdg`)

Round-tripping through this package's own reader proves internal consistency, not that a real, independent ODF implementation accepts the result — so a sample `.odg` was built with `writeOdgContent` and checked against LibreOffice 26.2.5.2 directly (`soffice --headless`), matching the bar the `writeOdp` section above sets. The sample covers two pages with genuinely different geometry (720×540pt landscape and A4 portrait), a filled and stroked rectangle, a filled ellipse with a dashed stroke, a plain line, a path whose two subpaths are one closed line-plus-cubic and one open cubic (with a fill, an `evenodd` fill rule, and a stroke), a rectangle rotated 30° clockwise, text-in-a-frame shapes alongside the vectors on the same page, and paint orders across **both** arrays deliberately unlike document order (shapes `6, 1`; vectors `5, 0, 3, 2, 4`):

```sh
xmllint --noout content.xml styles.xml meta.xml META-INF/manifest.xml  # the written package's own parts
soffice --headless --convert-to fodg sample.odg   # flat XML, for element and value inspection
soffice --headless --convert-to pdf sample.odg    # rendered pages, for visual inspection
```

`xmllint` accepts every part of the written package and the resulting flat XML; both `soffice` commands exit `0` with no error, identifying the input as `a Draw document`. What the flat-XML conversion establishes is that **every authored value appears in LibreOffice's re-serialised output**, either verbatim or unit-converted: all seven authored colours survive verbatim (`#0033ff`, `#cc0000`, `#00aa44`, `#000000`, `#ffcc33`, `#9933cc`, `#e6e6f2`), as does every authored string; each element comes back as a real element of the matching kind (`draw:rect`, `draw:ellipse` — and `draw:circle` for the equal-width-and-height case, LibreOffice's own spelling, which the reader already maps back onto `'ellipse'` — plus `draw:line`, `draw:path`, `draw:frame`), with nothing dropped in either direction; lengths convert exactly (a 200pt width to `7.056cm`, a 280pt `svg:x` to `9.878cm`, stroke widths of 3/2/4/1pt to `0.106cm`/`0.071cm`/`0.141cm`/`0.035cm`); `draw:stroke="dash"`, `draw:stroke="none"` and `draw:fill="none"` all survive as written; and the rotated rectangle's whole `draw:transform` survives, `rotate(-0.5235987755982988) translate(441.07695154586736pt 286.69872981077805pt)` re-emitted as `rotate (-0.523598775598299) translate (15.56cm 10.114cm)`. The path's `svg:d` is re-expressed in LibreOffice's own 1/100mm `svg:viewBox` using relative and shorthand commands, and every coordinate maps back exactly — the authored `C 180,0 180,100 120,100` becomes `c2117 0 2117 3529 0 3529`, the same +60pt/+100pt control offsets and +120pt/+100pt endpoint. It is **not** a byte-identity check and could not be: `--convert-to fodg` re-serialises the whole document through LibreOffice's own writer, which renames styles, reorders and reformats attributes, converts units, and adds defaults of its own, so its bytes differ from `writeOdg`'s by construction. The rendered PDF (2 pages) visually confirms each shape's geometry, its fill and stroke colours, the dashed ellipse border, the 30° clockwise rotation, and the path's curve, and carries the sample's `meta.xml` title, author, subject, and keywords into its own metadata.

**`draw:z-index` is honoured across both arrays**, which is the finding that matters most here: LibreOffice re-emitted page 1's seven elements in exactly the authored paint order `0…6` — an ellipse written second came out first, a text frame written first came out last — dropping the attribute and physically reordering the elements instead. That is the same behaviour the `writeOdp` verification found, now confirmed for the case only a drawing has, where the ordering has to hold _between_ the shapes array and the vectors array rather than within one of them.

**One gap found and fixed during this verification**: the sample above states an ODF-spellable `paintOrder` on every one of its seven items, which never exercises the case where a page mixes an item that states one with an item that does not. An earlier version of this writer omitted `draw:z-index` entirely for the unspellable case (absent, negative, or fractional `paintOrder`), matching `writeOdp`'s own established convention at the time — but LibreOffice does not treat an omitted `draw:z-index` as "insert at this item's own resolved position": it appends every item with no attribute at all **after** every item that does carry one, regardless of where the omitted item's own resolved order would otherwise place it. A follow-up sample mixing an explicit-`paintOrder` shape with an unspelled-`paintOrder` vector on the same page confirmed it directly — `soffice --headless --convert-to fodg` re-emitted the vector last even though its own resolved document-encounter order placed it between two shapes — so `writeDrawFrame`/`writeDrawVector` now write the fully resolved paint order (`paintOrder` when ODF can spell it, the item's own document-encounter index otherwise) as `draw:z-index` **unconditionally**, never omitting the attribute. `typed/odg/write.test.ts` pins the same mixed case as a unit test, and `writeOdp`'s writer inherited the identical fix since both writers share `writeDrawFrame`.

**A second gap found and fixed — the same exponent-notation hazard `writeOdp`'s own verification closed for `translate()`, reached this time through `rotate()`'s own angle.** `draw:transform`'s two components are written by one template string, and an earlier version of `frameGeometryAttrs` ran the `translate()` lengths through `formatOdfLength` but interpolated the `rotate()` angle directly — a bare radians value with no unit suffix, so it never went through any fixed-point formatter at all. A very small non-zero `rotationDeg` (never exactly zero, which collapses to no transform) drives the angle itself into JavaScript's own exponent spelling (`rotate(-1.7453292519943295e-11)`), exactly as invalid to the ODF `length`/number grammar as the `translate()` case, and by the identical mechanism: LibreOffice's own parser accepts it regardless (confirmed directly — a real `.odg` carrying this exact spelling round-trips through `soffice --headless --convert-to fodg` with no error), so a `soffice` check alone cannot catch it. `frameGeometryAttrs` now runs the angle through the bare-number sibling `formatOdfLength` already uses internally (`formatOdfNumber`, `typed/shared/units.ts`), and `typed/odg/write.test.ts`/`typed/odp/write.test.ts` each pin a very-small-`rotationDeg` regression alongside the existing near-origin `translate()` one.

**A third gap found and fixed — a text-in-a-frame shape with no insets rendered as a filled, bordered box in LibreOffice**, even though `ContentShape` carries no fill/stroke vocabulary at all for a document to have stated one. `shapeGraphicStyleName` minted a style only when at least one inset was non-zero, so a shape with every inset at zero wrote no `draw:style-name` and inherited LibreOffice's own built-in `standard` graphic style — solid-filled, coloured border — the identical silent-inherit hazard `typed/draw/write-vectors.ts`'s own top-of-file note already documents closing for a vector. It now mints a style unconditionally, stating explicit `draw:fill="none"`/`draw:stroke="none"` (insets are still written only when at least one is non-zero, since `readFrameInsets` already defaults an absent style to zero). Confirmed directly: a zero-inset text shape written with the fix carries a `draw:style-name` whose `style:graphic-properties` states `draw:fill="none" draw:stroke="none"`, and that survives `soffice --headless --convert-to fodg` verbatim.

Three things LibreOffice does with a valid file that are worth stating precisely, none of them a defect in what this writer emits:

- **`svg:fill-rule` does not survive a LibreOffice round trip.** The attribute is real, spec-defined ODF vocabulary on `style:graphic-properties` (which is why `typed/draw/shapes.ts` reads it and this writer emits it), but LibreOffice's own Draw import/export drops it entirely — it appears zero times in the re-serialised output. It round-trips through this package's own reader; a real consumer simply does not keep it.
- **A `draw:path` mixing closed and open subpaths renders unfilled in LibreOffice.** A controlled test holding every other property identical — three paths with the same colours, stroke, and frame size, differing only in their subpaths — renders the closed-only path filled, the open-only path unfilled (correct: an open path has no area), and the mixed path unfilled even for its closed subpath. LibreOffice classifies a whole `draw:path` as open or closed for its own shape model, and an open shape is never filled. The fill is preserved in the file: the re-serialised style still reads `draw:fill="solid" draw:fill-color="#ffcc33"`, and this package's own reader reads it back. Only the render omits it.
- **Per-page geometry is preserved in ODF but normalised on PDF export.** The written package states two `style:page-layout`s and two `style:master-page`s with each `draw:page` referencing its own, LibreOffice's flat XML preserves both (`25.4cm × 19.05cm` landscape and `21cm × 29.7cm` portrait), and `readOdgContent` reads both back — but `--convert-to pdf` renders every page at the first page's size. Separately, LibreOffice tightens a `draw:path`'s own frame to the path geometry's bounding box on re-serialisation: the sample's 240×140pt path frame, whose curve only spans 240×120pt, came back as 240×120pt with its `svg:viewBox` rescaled to match and every coordinate intact.

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

`.sxw`, `.sxc`, and `.sxi` each have a real writer, built the same way the reader is — as a transform either side of the ODF writer, not a second writer of its own:

```ts
import {
  writeSxw,
  writeSxwContent,
  writeSxc,
  writeSxcContent,
  writeSxi,
  writeSxiContent,
  encodePackage,
} from "odf.js";

const pkg = writeSxw(document); // a wordprocessing DocumentTree -> a real .sxw Package
const bytes = encodePackage(pkg); // Package -> bytes

const pkgFromContent = writeSxwContent(contentDocument); // the flat ContentDocument level, same shape writeOdtContent returns

const sxcPkg = writeSxc(spreadsheetTree); // a spreadsheet DocumentTree -> a real .sxc Package
const sxcPkgFromContent = writeSxcContent(spreadsheetContentDocument); // the flat ContentDocument level, same shape writeOdsContent returns

const sxiPkg = writeSxi(presentationTree); // a presentation DocumentTree -> a real .sxi Package
const sxiPkgFromContent = writeSxiContent(presentationContentDocument); // the flat ContentDocument level, same shape writeOdpContent returns
```

`writeSxw`/`writeSxwContent` call `writeOdt`/`writeOdtContent` to build a real ODF `.odt` `Package`; `writeSxc`/`writeSxcContent` call `writeOds`/`writeOdsContent` to build a real ODF `.ods` `Package`; `writeSxi`/`writeSxiContent` call `writeOdp`/`writeOdpContent` to build a real ODF `.odp` `Package` — all three the identical way. Each then runs its package through `transformToOoo1Package` — `transformOoo1Package`'s own inverse, reversing every rename and restructure the read-side transform documents (namespace URIs, the `office:class` genre wrap/unwrap, the `style:properties` typed-family split/merge, the `draw:frame` wrap/unwrap, the renamed elements and attributes including a cell's `office:value-*` family becoming `table:value-*`, the `"inch"`/`"in"` unit spelling, and the package-level mimetype/manifest handling) against the same LibreOffice transformer source and OpenOffice.org DTD the forward direction is grounded against. Since `transformToOoo1Package` is itself generic across every ODF media type rather than `.odt`-specific, wiring `.sxc` and `.sxi` up to it needed no changes to the transform at all — only one more pair of writer entry points each time, wrapping `writeOds`/`writeOdsContent` and `writeOdp`/`writeOdpContent` the way `writeSxw`/`writeSxwContent` already wrap `writeOdt`/`writeOdtContent`. The result genuinely declares OpenOffice.org 1.x namespace URIs, carries no `mimetype` part, and reads back correctly through the ordinary readers — `readSxw(writeSxw(document))` recovers `document` up to the exact same canonical form `normaliseOdtContent` already states for `writeOdt`, `readSxc(writeSxc(document))` recovers `document` up to the canonical form `normaliseOdsContent` already states for `writeOds`, and `readSxi(writeSxi(document))` recovers `document` up to the canonical form `normaliseOdpContent` already states for `writeOdp`, since each `*Content` writer here is its ODF counterpart's own output run one transform further. What `writeOdt`/`writeOds`/`writeOdp` refuse (the odt fidelity constructs — fields, bookmarks, notes, annotations, tracked changes, divisions, index wrappers, forms; the ods embedded objects, data-validation rules, and conditional-formatting rules; the odp fidelity constructs a shape's own text cannot carry), `writeSxw`/`writeSxc`/`writeSxi` refuse too, for the same reason: a document that silently lost semantic content would be worse than one this writer declined to produce at all.

Verified against real LibreOffice 26.2.5.2 the same way, not just the round-trip law: a `.sxi` built with `writeSxiContent` (a title, a rotated shape, a table, an image, and multi-line speaker notes) converts cleanly with `soffice --headless --convert-to fodp`/`--convert-to pdf` (both exit `0`, LibreOffice identifies the input as a genuine Impress document), every authored string survives verbatim in the flat XML, and the rendered PDF confirms the content lays out correctly with the speaker notes absent from the slide itself.

`.sxd` still has no writer, tracked as its own follow-up: `writeOdg` now exists for one to wrap, exactly the way `writeSxi` wraps `writeOdp`, so what remains is the wrapper rather than the ODF writer beneath it. See [What differs between the two vocabularies](#what-differs-between-the-two-vocabularies) for what the transform covers, and its own module comment (`src/ooo1/transform.ts`) for the full list, including the reverse direction's own note (`transformToOoo1Package`) on the package-wide context (a document's `office:class`, a list's ordered/bullet kind) the reverse needs that the forward direction never did.

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
- **`src/typed/shared/`** — ODF-specific typed primitives every reader/writer builds on (units, A1 cursors, colour/geometry, whitespace runs, style cascade, shared paragraph/table readers, transform/path parsing, metadata, `list.ts`'s write-side numId canonicalisation shared by `writeOdt`/`writeOdp`, `canonicalise.ts`'s write-side paragraph/table/image canonical form shared the same way).
- **`src/typed/odt/`, `odp/`, `odg/`, `ods/`** — one module per format: `read.ts` carries both levels of the reader (the package-native `readOdt`/`readOdp`/`readOdg`/`readOds` and the flat `readOdtContent`/`readOdpContent`/`readOdgContent`/`readOdsContent` it is built on); `odt/write.ts`, `ods/write.ts`, `odp/write.ts`, and `odg/write.ts` carry the write side the same way.
- **`src/typed/draw/`** — the shared `draw:frame`/`draw:g`/vector shape vocabulary and `readDrawImageBlock` (`shapes.ts`), plus `embedded.ts` (`readDrawObjectReference`, `readEmbeddedObjectDocument`, `readOdfChartContent` — the shared embedded-object reference resolver and the central kind→reader dispatch table), plus the write-side mirror of `shapes.ts` in two halves: `write-shapes.ts` (`writeDrawFrame`/`writeDrawShapes` and the `canonicalDrawShape` canonical form, shared between `writeOdp` and `writeOdg`) and `write-vectors.ts` (`writeDrawVector`/`writeDrawVectors` and `canonicalDrawVector`, the vector-primitive half only `writeOdg` has content for).
- **`src/typed/formula/`, `odm/`** — `readOdfFormula`/`readOdfFormulaContent`/`readOdfFormulaMathMl` and `readOdm`.
- **`src/typed/odb/`** — `readOdbInventory`, `readOdbForm`/`readOdbReport`, `resolveOdbComponent`, `subDocumentPackage`.
- **`src/ooo1/`** — the OpenOffice.org 1.x variant reader and writer: `ns.ts` (the pre-OASIS namespace and `application/vnd.sun.xml.*` media-type tables plus package detection, in both directions), `properties.ts` (the `style:properties` split, and `mergeStyleProperties`, its own inverse), `transform.ts` (the whole package rewrite, `transformOoo1Package` and its inverse `transformToOoo1Package`), `read.ts` (`readSxw`/`readSxc`/`readSxi`/`readSxd`), `write.ts` (`writeSxw`/`writeSxwContent`/`writeSxc`/`writeSxcContent`/`writeSxi`/`writeSxiContent`). Sits _beside_ `typed/`, not inside it: it adds no reader or writer of its own for the ODF content model, it feeds `writeOdt`'s/`writeOds`'s/`writeOdp`'s own output into `transformToOoo1Package` and the ODF readers' input through `transformOoo1Package`.

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

Every read-side construct listed above has no write-side counterpart: `writeOdt` refuses each of them by name rather than silently dropping it (see [Writing a document](#writing-a-document)), so the honest asymmetry is a reader that recovers more than any writer in this package will re-emit, not a package with no content writer at all; the lossless `encodePackage` layer remains the byte-fidelity tier regardless.

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
