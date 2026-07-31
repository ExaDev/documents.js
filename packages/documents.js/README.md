# documents.js

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/documents.js) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/documents.js) [![Release](https://img.shields.io/github/v/release/ExaDev/documents.js)](https://github.com/ExaDev/documents.js/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/documents.js/ci.yml?branch=main)](https://github.com/ExaDev/documents.js/actions)

> Bidirectional docx/pptx/odt/odp ⇄ PDF conversion, one-directional ods → PDF conversion, a read-and-write live-view editor for docx/pptx/odt/odp/ods content, and a fully hand-written PDF codec, built on [ooxml.js](https://github.com/ExaDev/ooxml.js) and [odf.js](https://github.com/ExaDev/odf.js).

`documents.js` depends on `ooxml.js` for lossless docx/pptx/xlsx ⇄ JSON handling and extends it in two directions `ooxml.js` deliberately does not cover: full PDF support (parsing arbitrary real-world PDFs and generating new ones), and a read-**and-write** manipulation API for docx/pptx content — `ooxml.js`'s own typed readers (`readDocx`/`readPptx`) are one-way and explicitly forbid write-back. PDF reading, writing, and the docx⇄PDF/pptx⇄PDF conversion pipeline are entirely hand-written: no external PDF library (`pdf-lib`, `pdfjs-dist`, `mupdf`, or any other) is a dependency. The one exception is [`fflate`](https://github.com/101arrowz/fflate) for raw DEFLATE/zlib compression underneath PDF's `FlateDecode` filter and PNG's `IDAT` chunks — the same dependency `ooxml.js` itself already relies on for ZIP handling.

## Why

Converting docx/pptx to PDF and back is usually solved by wrapping a mature third-party PDF library. This package takes the opposite approach: every layer of the PDF format — the object model, the cross-reference table, the content-stream operators, standard-font metrics, the parser's cross-reference/object-stream resolution and content-stream interpreter — is hand-written against the ISO 32000-1 specification. That is a genuinely large undertaking (the PDF codec is comparable in size to the rest of the package combined), and it comes with an honest trade-off spelled out in [Fidelity](#fidelity) below: this is not, and does not attempt to be, as robust against adversarial or badly malformed real-world PDFs as a library with 15+ years of hardening. What it buys instead is a dependency-free, fully auditable PDF implementation with no supply-chain surface beyond `ooxml.js` and `fflate`.

The read-and-write editor exists because `ooxml.js`'s own typed readers are a deliberate one-way, lossy projection — reading is fine, but there is no way to add a paragraph, style a run, or insert an image and get a valid docx/pptx back out. `documents.js`'s editors are live views directly over the `XmlElement` objects inside a decoded `Package`: a mutation edits that tree in place, and everything you don't touch round-trips byte-faithful, because it never stopped being the original XML.

## Getting started

Requires Node.js `>=20` and pnpm `11.6.0` (pinned via `packageManager` in `package.json`).

```sh
pnpm install
```

Install as a dependency in another project:

```sh
pnpm add documents.js
# or
npm install documents.js
```

## Usage

The eight round-trip ergonomic conversions (docx/pptx/odt/odp ⇄ PDF), plus `odsToPdf`'s one-directional addition (there is no `pdfToOds` yet — PDF → spreadsheet reconstruction needs general vector-path tracking in the PDF reader that doesn't exist yet, see [Gotchas](#gotchas-and-quirks)):

```ts
import { docxToPdf, odpToPdf, odsToPdf, odtToPdf, pdfToDocx, pdfToOdp, pdfToOdt, pptxToPdf, pdfToPptx } from 'documents.js';

const pdfBytes = docxToPdf(docxBytes);
const docxBytes2 = pdfToDocx(pdfBytes);

const pdfFromSlides = pptxToPdf(pptxBytes);
const pptxBytes2 = pdfToPptx(pdfFromSlides);

const pdfFromOdt = odtToPdf(odtBytes);
const odtBytes2 = pdfToOdt(pdfFromOdt);

const pdfFromOdp = odpToPdf(odpBytes);
const odpBytes2 = pdfToOdp(pdfFromOdp);

const pdfFromOds = odsToPdf(odsBytes); // ods -> PDF only -- there is no pdfToOds yet
```

Each accepts an optional `signal` (`AbortSignal`) and either a `onSubstitution` callback (docx/pptx/odt/odp → PDF, called once per character not representable in a standard-14 font) or a `sink` (PDF → docx/pptx/odt/odp, called once per recoverable parse diagnostic).

The same conversions behind a swappable port, for a caller that wants to inject a different implementation later without changing call sites:

```ts
import { createLocalDocumentConverter } from 'documents.js';

const converter = createLocalDocumentConverter();
const { document, diagnostics } = await converter.convert(
  { source: { format: 'docx', bytes: docxBytes }, targetFormat: 'pdf' },
  { signal: new AbortController().signal },
);
```

Reading and editing docx/pptx content directly, without going through PDF at all:

```ts
import { openDocx, createDocx } from 'documents.js';

const editor = openDocx(existingDocxBytes);
const paragraph = editor.body.appendParagraph({ alignment: 'center' });
const run = paragraph.appendRun({ text: 'Hello' });
run.bold = true;
run.color = { r: 1, g: 0, b: 0 };
const bytes = editor.toBytes();

// or start from nothing:
const fresh = createDocx();
fresh.body.appendParagraph().appendRun({ text: 'New document' });
```

`openPptx`/`createPptx` and `PptxSlide`/`PptxShape` are the pptx equivalent (`slide.addTextBox`, `slide.addImage`, `shape.setParagraphs` for multi-paragraph styled text).

`openOdt`/`createOdt` and `OdtParagraph`/`OdtRun`/`OdtTable`/`OdtList` are the odt equivalent, built on ODF's own style-name-referencing model (`run.bold = true` interns or reuses a named `style:style` in `office:automatic-styles`, rather than writing an inline attribute — see [Conventions](#conventions) below). `openOdp`/`createOdp` and `OdpSlide`/`OdpShape` are the odp equivalent of `PptxSlide`/`PptxShape` (`slide.addTextBox`, `slide.addImage`, `slide.notes`), and reuse `OdtParagraph`/`OdtRun`/`OdtList` directly for a shape's own text content — a `draw:frame`'s `draw:text-box` holds the identical `text:p`/`text:span` model `office:text` does, interned into the same `content.xml` style registry:

```ts
import { createOdp } from 'documents.js';

const editor = createOdp();
const slide = editor.addSlide();
const title = slide.addTextBox({ frame: { xPt: 40, yPt: 30, widthPt: 640, heightPt: 80 }, text: 'Title' });
title.rotationDeg = 15; // OdpShape has a genuine draw:transform rotation setter, unlike PptxShape's own documented gap below
const bullets = slide.addTextBox({ frame: { xPt: 40, yPt: 130, widthPt: 300, heightPt: 200 }, text: '' });
bullets.paragraphs()[0].remove();
bullets.addList().addItem().appendParagraph({ text: 'A real bulleted text:list' });
slide.notes = 'Speaker notes for this slide';
const bytes = editor.toBytes();
```

`createOds`/`openOds` and `OdsEditor`/`OdsSheet`/`OdsCell` are the spreadsheet equivalent — cell addressing has no docx/pptx analogue at all, so this is the one editor family built from scratch rather than reusing `OdtParagraph`/`OdtRun`. Setting a cell far from the origin does not materialise every cell in between: the underlying `table:number-columns-repeated`/`table:number-rows-repeated` runs are split in place at exactly the target position, the same repeat-compression convention `odf.js`'s own reader already reads.

```ts
import { createOds } from 'documents.js';

const editor = createOds();
const sheet = editor.addSheet('Sheet1');
sheet.cell(0, 0).value = { kind: 'string', value: 'Total' }; // 0-based (row, column) -- there is no A1-string overload
sheet.cell(0, 1).value = { kind: 'currency', value: 42.5, currency: 'USD' };
sheet.cell(500, 50).value = { kind: 'boolean', value: true }; // does not materialise 500x50 empty cells
const bytes = editor.toBytes();
```

Reading and writing PDF bytes directly, without going through docx/pptx:

```ts
import { readPdf, writePdf } from 'documents.js';

const layout = readPdf(pdfBytes); // -> LayoutDocument: pages of positioned text/image/rect/link items
const bytes = writePdf(layout);
```

The same five round trips (PDF ⇄ `LayoutDocument`, docx ⇄ PDF, pptx ⇄ PDF, odt ⇄ PDF, odp ⇄ PDF) are each also available as a schema-validated [`z.codec()`](https://zod.dev) pair, mirroring `ooxml.js`'s own `packageCodec` — `z.decode`/`z.encode` validate both the raw bytes (against the magic-byte schemas below) and the parsed value (against `LayoutDocumentSchema`) on every call, catching a malformed value that a bare function call wouldn't. This is the no-extra-options form: `readPdf`/`writePdf`/`docxToPdf`/etc. remain the entry points for cancellation (`signal`), diagnostics (`sink`), or substitution reporting (`onSubstitution`), none of which fit `z.codec()`'s fixed `decode(input)`/`encode(output)` signature.

```ts
import { z } from 'zod';
import { docxPdfCodec, pdfCodec, pptxPdfCodec } from 'documents.js';

const layout = z.decode(pdfCodec, pdfBytes); // throws a ZodError if pdfBytes has no %PDF- header
const pdfBytes2 = z.encode(pdfCodec, layout);

const pdfFromDocx = z.decode(docxPdfCodec, docxBytes);
const docxBack = z.encode(docxPdfCodec, pdfFromDocx);
```

`readDocxContent`/`readPptxContent`/`readOdtContent`/`readOdpContent`/`readOdsContent` (docx/pptx/odt/odp/ods → `ContentDocument`), `convertWordprocessingToLayout`/`convertPresentationToLayout`/`convertSpreadsheetToLayout` (`ContentDocument` → `LayoutDocument`), and `reconstructWordprocessing`/`reconstructPresentation` (`LayoutDocument` → `ContentDocument`) are each exported individually too, for a caller that wants one stage of the pipeline without the rest. `readDocxContent` and `readOdtContent` both produce the identical `wordprocessing`-variant `ContentDocument` shape from two completely unrelated package formats (OOXML and ODF), which is what lets `odtToPdf` feed `convertWordprocessingToLayout` without a single line of that engine changing; `readPptxContent` and `readOdpContent` do the same for the `presentation` variant and `convertPresentationToLayout`. `readOdsContent`/`convertSpreadsheetToLayout` have no OOXML-side counterpart yet (no `readXlsxContent`/xlsx layout exists in this package) — `convertSpreadsheetToLayout` is the one genuinely new layout algorithm this package has needed since its original docx/pptx build, since a spreadsheet's addressed-grid-with-print-settings semantics have no flow/pagination or direct-placement analogue. There is no `reconstructSpreadsheet` yet (see [Gotchas](#gotchas-and-quirks)).

## Architecture

The package is layered from generic primitives outward to the two conversion directions:

- **`src/model/`** — thin, documents.js-specific additions on top of the sibling [`document-content-model`](https://github.com/ExaDev/document-content-model) package, which now owns the two pivot models themselves: `LayoutDocument` (the PDF-side pivot: pages of positioned text/image/rect/line/ellipse/link items, PDF-native coordinates and units) and `ContentDocument` (the semantic pivot: a discriminated union of `wordprocessing` and `presentation` variants sharing paragraph/run/table/image building blocks) are both imported, not defined here — `document-content-model` exists specifically so `ooxml.js`, `odf.js`, and `documents.js` share one schema instead of each maintaining an independent, drift-prone copy. What remains local: `bytes.ts` (magic-byte-validated `Uint8Array` schemas for docx/pptx/PDF, plus `Odt`/`Ods`/`Odp`/`OdgBytesSchema`, which check the package's actual declared media type against `odf.js`'s `ODF_MEDIA_TYPES` table rather than only the generic ZIP signature the OOXML schemas are limited to), `units.ts` (OOXML EMU/twip/point/half-point conversions), and `geometry.ts`/`color.ts`/`style.ts`, each now mostly a thin re-export of `document-content-model`'s `Box`/`Margins`/`PageSize`/`Color`/`Alignment`/`LayoutFont` — the one genuinely PDF-specific piece each still adds locally is `geometry.ts`'s `flipY` (the top-left/y-down ↔ bottom-left/y-up space conversion between OOXML/ODF and PDF coordinates); `LayoutFont`/`DEFAULT_LAYOUT_FONT` moved to `document-content-model` too (since `LayoutText`, part of the pivot, needs the field), leaving only the standard-14 font *resolution* logic that consumes it (`src/pdf/fonts.ts`/`font-read.ts`) as PDF-specific and local.
- **`src/bytes/`** and **`src/image/`** — generic byte and image-container primitives with zero PDF or OOXML knowledge: a chunked byte writer, a backtracking byte reader, CRC32, and a hand-written PNG decoder/encoder (palette/gray/RGB/alpha, multi-`IDAT` files, all five scanline filters) plus JPEG marker scanning for dimensions only — JPEG's compressed bytes pass through completely unchanged in both directions. `src/bytes/flate.ts` is the only file that imports `fflate`, mirroring how `ooxml.js`'s own `src/zip.ts` wraps it for ZIP handling.
- **`src/xml/`** and **`src/opc/`** — parent-aware XML query/mutation and OPC package mechanics (relationship IDs, content-type entries, atomic media-part insertion) built over `ooxml.js`'s `Package`/`XmlNode`, needed because `ooxml.js`'s own XML nodes have no parent pointers and `ooxml.js` never writes new parts into an existing package.
- **`src/edit/`** — the read-and-write editable model: live-view classes (`DocxEditor`/`DocxParagraph`/`DocxRun`/`DocxTable`, `PptxEditor`/`PptxSlide`/`PptxShape`, `OdtEditor`/`OdtParagraph`/`OdtRun`/`OdtTable`/`OdtList`, `OdpEditor`/`OdpSlide`/`OdpShape`, `OdsEditor`/`OdsSheet`/`OdsCell`) wrapping the actual `XmlElement` objects inside a decoded `Package`, plus `buildDocxPackage`/`buildPptxPackage`/`buildOdtPackage`/`buildOdpPackage`/`buildOdsPackage` bridging a `ContentDocument` to a fresh package built entirely through those same primitives (there is no `pdfToOds` calling `buildOdsPackage` yet, though — see below). `src/edit/odp/*` reuses `src/edit/odt/*`'s own paragraph/run/list/style-interning classes WHOLESALE rather than reimplementing them for presentations: a `draw:frame`'s `draw:text-box` holds the identical `text:p`/`text:span` content model `office:text` does, interned into the identical `content.xml` `office:automatic-styles` registry (`src/edit/odt/props.ts`'s `applyStyleChange`) — `OdpShape.appendParagraph`/`.paragraphs()`/`.addList()` return real `OdtParagraph`/`OdtList` instances, not odp-specific lookalikes. The genuinely new odp-specific work is `draw:page`/`draw:frame` mechanics (a slide is a `draw:page`, a shape's geometry is explicit `svg:x`/`svg:y`/`svg:width`/`svg:height` rather than pptx's placeholder-inheritance-heavy model) and rotation: `OdpShape.rotationDeg` is a genuine `draw:transform` setter built on `odf.js`'s own `applyOdfTransform`/`resolveOdfShapeGeometry` (`typed/shared/transform.ts`) — the write-side inverse of the exact function odf.js's own reader uses — unlike `PptxShape`, which has no rotation setter yet (see Gotchas below). `src/edit/ods/*` has no docx/pptx/odt/odp analogue to reuse for its core concern (cell addressing) but still reuses `src/edit/odt/*`'s style interning and `src/edit/odt/content.ts`'s `populateParagraph` for cell text content — `src/edit/ods/address.ts` is the write-side counterpart to `odf.js`'s own read-side `table:number-*-repeated`-aware cursor: setting a distant cell's value splits the covering repeated run in place at that one position rather than materialising every cell in between, exactly mirroring the read-side hazard `odf.js`'s own `typed/shared/a1.ts` already solved.
- **`src/pdf/`** — the hand-written PDF codec, importing only `model`/`bytes`/`image` (no OOXML knowledge at all):
  - **Write**: `objects.ts` (the `PdfObject` discriminated union), `afm-widths.ts`/`encoding.ts`/`winansi.ts`/`fonts.ts` (standard-14 metrics, WinAnsi encoding, family resolution), `measure.ts`/`text-layout.ts` (greedy line-wrapping), `matrix.ts`, `content-write.ts` (`LayoutItem[]` → content-stream operators), `write.ts` (the full object graph, classic cross-reference table, trailer).
  - **Read**: `lexer.ts`/`parse.ts` (byte tokenizer and tokens → `PdfObject`), `filters.ts`/`predictors.ts` (Flate/LZW/ASCII85/ASCIIHex/RunLength, TIFF/PNG predictors), `xref.ts`/`document.ts` (classic and cross-reference-stream resolution, object streams, `/Prev` chains, linear-scan recovery, the page tree with attribute inheritance), `content-read.ts`/`interpret.ts` (the content-stream tokenizer and graphics/text state machine, including form-XObject recursion), `cmap.ts`/`font-style.ts`/`font-read.ts` (`/ToUnicode` CMaps, font-dictionary resolution), `images-read.ts` (Image XObjects → PNG/JPEG bytes), `read.ts` (`readPdf`, assembling all of the above into a `LayoutDocument`).
  - `codec.ts` — `pdfCodec`, a `z.codec()` pair over `readPdf`/`writePdf` (PDF bytes ⇄ `LayoutDocument`).
- **`src/ooxml/`** — resolves a `Package` into a `ContentDocument`: `docx/read.ts` and `pptx/read.ts` are now thin adapters over `ooxml.js`'s own `readDocx`/`readPptx`, wrapping their `{ metadata, sections }`/`{ metadata, slides }` result into `ContentDocument`'s `wordprocessing`/`presentation` shape. The docx style cascade (`docDefaults` → named-style `basedOn` chains → paragraph-mark run properties → character styles → direct formatting), the pptx placeholder → layout → master → theme inheritance cascade, and DrawingML geometry/colour resolution all now live upstream in `ooxml.js` itself, not in this package.
- **`src/odf/`** — the ODF-side counterpart to `src/ooxml/`, resolving an `odf.js` `Package` into a `ContentDocument`: `odt/read.ts`'s `readOdtContent` is a thin adapter over `odf.js`'s own `readOdt`, wrapping its `{ metadata, sections }` result into the identical `wordprocessing` shape `readDocxContent` produces — the concrete proof that odt and docx genuinely share one pivot and one layout engine. `odp/read.ts`'s `readOdpContent` is the same adapter over `odf.js`'s `readOdp`, wrapping `{ metadata, slides }` into the identical `presentation` shape `readPptxContent` produces. `ods/read.ts`'s `readOdsContent` wraps `odf.js`'s `readOds`'s `{ metadata, sheets }` into the `spreadsheet` `ContentDocument` variant — this one has no OOXML-side sibling adapter (there is no `readXlsxContent`). Every direction now builds the reverse too — `buildOdtPackage`/`buildOdpPackage`/`buildOdsPackage` (`src/edit/{odt,odp,ods}/content.ts`) — closing the PDF → odt/odp direction on the live-view editors above (ods's own `buildOdsPackage` exists and is exported, but nothing calls it yet — see the `pdfToOds` gotcha below).
- **`src/layout/`** — the pure conversion algorithms, importing only `model` (no I/O): `engine.ts` (`ContentDocument` wordprocessing → `LayoutDocument`: flow, line-breaking, pagination — fed identically by docx- and odt-sourced content), `slides.ts` (`ContentDocument` presentation → `LayoutDocument`: direct EMU-to-point placement, no pagination needed — fed identically by pptx- and odp-sourced content), `sheets.ts` (`ContentDocument` spreadsheet → `LayoutDocument`: the one genuinely new layout algorithm since this package's original docx/pptx build — resolve the print range, build cumulative column/row offsets skipping hidden ones, reserve header/repeat-row-column space, resolve an explicit or non-iterative fit-to-page scale, partition into column/row bands honouring manual breaks with the same "an oversized item gets its own band and overflows rather than looping" guarantee `engine.ts`'s `ensureRoom` documents, emit pages in `downThenOver`/`overThenDown` order, then per page paint backgrounds/gridlines/headers/cell text with default alignment by value kind and `###`/spill-then-truncate overflow handling — the first layout algorithm in this package that accepts an `AbortSignal`, since a 50k-cell sheet needs cancellation where a docx/pptx page count never did), `reconstruct.ts` (`LayoutDocument` → `ContentDocument`, wordprocessing and presentation only — no `reconstructSpreadsheet` yet, see Gotchas: baseline-proximity line clustering, then paragraph/text-block clustering from geometry — PDF has no semantic paragraph or shape structure to recover, only positioned glyphs).
- **`src/convert/`** — `convert.ts` (the eight round-trip ergonomic wrappers plus `odsToPdf`'s one-directional ninth), `codec.ts` (`docxPdfCodec`/`pptxPdfCodec`/`odtPdfCodec`/`odpPdfCodec`, a `z.codec()` pair over each — deliberately no `odsPdfCodec` yet, matching this package's own established rule that a codec needs both a genuine `decode` and `encode` half, and `odsToPdf` alone has no `pdfToOds` to encode with), `port.ts`/`local.ts` (the swappable `DocumentConverter` contract and its synchronous local implementation, covering `docx`/`pptx`/`odt`/`odp`/`ods` → `pdf` and `pdf` → `docx`/`pptx`/`odt`/`odp`).

Dependency direction is strictly downward and checkable: `model`/`bytes` import nothing local; `image` imports `bytes` only; `pdf` imports `model`+`bytes`+`image` only; `ooxml/*` imports `xml`/`model` only (no PDF knowledge); `odf/*` imports `model` only (no PDF knowledge, no `xml/*` — `odf.js` already owns its own XML query helpers); `layout` imports `model` only; `convert` composes everything else. No `PdfObject`/`PdfDict`/`PdfStream` type appears outside `src/pdf/`.

## Build, test, and lint

```sh
pnpm build         # tsdown -> dist/ (ESM + CJS + .d.ts)
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint . --max-warnings 0
pnpm test          # vitest run --project unit
pnpm test:watch    # vitest --project unit
pnpm test:smoke    # rebuilds dist/, then verifies ESM/CJS parity, a real docxToPdf/pdfToDocx round trip, real odtToPdf/odpToPdf conversions, and a real createOdp/odpToPdf/pdfToOdp round trip, from the built CJS bundle
pnpm test:corpus   # optional real-world PDF conformance checks against a local, gitignored test/corpus/ (see Fidelity)
```

To run a single test file: `pnpm vitest run src/path/to/file.test.ts`.

## Conventions

- **Zod-first schema/type/guard**, matching `ooxml.js`: every model type is inferred from its Zod schema, never hand-written. `ContentBlock` (recursive, mirroring `ooxml.js`'s own `XmlNode` treatment) uses a hand-written structural guard + `z.custom`, not `z.lazy`, which collapses to `unknown` for recursive element-children in the pinned Zod version.
- **`z.codec()` for every schema-to-schema round trip**, matching `ooxml.js`'s `packageCodec`/`xmlCodec`: `pdfCodec` (PDF bytes ⇄ `LayoutDocument`) and `docxPdfCodec`/`pptxPdfCodec`/`odtPdfCodec`/`odpPdfCodec` (docx/pptx/odt/odp bytes ⇄ PDF bytes) each wrap an already-independently-tested function pair, adding automatic two-way schema validation. These are deliberately the no-options form — `readPdf`/`writePdf`/`docxToPdf`/`pdfToDocx`/`pptxToPdf`/`pdfToPptx`/`odtToPdf`/`pdfToOdt`/`odpToPdf`/`pdfToOdp` remain the primary entry points wherever a caller needs an `AbortSignal`, a `PdfDiagnosticSink`, or an `onSubstitution` callback, since `z.codec()`'s fixed `decode(input)`/`encode(output)` signature has no room for side-channel options.
- **`PdfObject` has no Zod schema at all**, deliberately: it never crosses a public boundary or round-trips through JSON, and is constructed exclusively by this package's own parser — validating it would just be validating our own output. It narrows natively on its own `kind` discriminant instead, the same reasoning `ooxml.js` applies when it picks a hand-written `isXmlNode` guard over `z.lazy`.
- **No type assertions anywhere.** Every third-party or loosely-typed value is narrowed through a type guard or a Zod parse at the boundary.
- **Live views, not flatten-and-regenerate.** `src/edit/*`'s editor classes hold a reference directly into the real `Package`/`XmlElement` objects; saving is `encodePackage(pkg)`, nothing more. This is what makes "everything you didn't touch stays byte-faithful" a structural guarantee rather than a best effort.
- **A three-tier PDF-read failure policy**, applied consistently across every `src/pdf/*` read module: throw a typed `PdfParseError`/`PdfEncryptedError` for a file that cannot be meaningfully processed at all; recover with a `PdfDiagnostic` (`severity: 'warning'`) for something malformed but salvageable (a bad `startxref`, a wrong stream `/Length`); degrade with a diagnostic for an individual unsupported feature (an unimplemented filter, an unrecognised colour space) while the rest of the document still reads.
- **Conventional commits**, enforced via commitlint + husky, matching `ooxml.js`.

## Gotchas and quirks

- **`ooxml.js`'s typed readers (`readDocx`/`readPptx`) are now the actual basis for conversion** — `readDocxContent`/`readPptxContent` are thin wrappers around them, not an independent walk of `word/document.xml`/`ppt/slides/slideN.xml`. They are still deliberately not re-exported from this package's own public surface: `readDocx`/`readPptx` also carry `comments`/`footnotes`/`headers`/`footers` (docx) that `ContentDocument` doesn't model, so exposing both the wrapper and the thing it wraps would invite a caller to reach for the wrong one rather than genuinely offering two competing models.
- **The docx⇄PDF and pptx⇄PDF conversions are explicitly not round-trip-lossless** — in deliberate contrast to `ooxml.js`'s own `packageCodec`, which is byte/part-faithful by design. See [Fidelity](#fidelity).
- **`odpToPdf`/`pdfToOdp` needed zero new layout code.** `readOdpContent` (`src/odf/odp/read.ts`) produces the identical `presentation` `ContentDocument` shape `readPptxContent` does, so it feeds `convertPresentationToLayout` unmodified — including the existing hidden-annotation speaker-notes mechanism below, which carries odp's `presentation:notes` through to the PDF with no new notes-handling code at all; `pdfToOdp` reuses `reconstructPresentation` unmodified too, the same architectural bet `pdfToOdt` already proved for `reconstructWordprocessing`. The genuinely new work for the reverse direction was the live-view editor itself (`src/edit/odp/*`) — see Architecture above.
- **`OdpShape.rotationDeg` writes a real `draw:transform`, built on `odf.js`'s own transform machinery.** It is the write-side inverse of `odf.js`'s `resolveOdfShapeGeometry` (`typed/shared/transform.ts`), built on that module's own exported `applyOdfTransform` rather than a hand-rolled rotation matrix, so it inherits that module's own empirically-verified rotate/translate composition order and sign convention by construction. Unlike `PptxShape` (see the `colSpan`/`rowSpan` gotcha below, which pptx still has and odp does not), `buildOdpPackage` writes a rotated shape's rotation back correctly — verified both by this package's own tests and by opening a fresh, editor-built `.odp` in actual LibreOffice.
- **`odsToPdf` is one-directional — there is no `pdfToOds` yet, and no `reconstructSpreadsheet`.** Unlike odt/odp, going from PDF back to a spreadsheet needs general vector-path tracking in the PDF reader (`src/pdf/interpret.ts` currently only tracks the specific `re` rectangle operator, discarding general `m`/`l`/`c` path construction) so a reconstructed sheet's gridlines can be detected from the recovered geometry — that infrastructure doesn't exist yet. `buildOdsPackage` (`src/edit/ods/content.ts`) is built and exported, ready for `pdfToOds` to call the moment path tracking lands; nothing currently calls it.
- **`ContentSheetCellSchema` (`document-content-model`) models no per-cell border or background, and no per-cell alignment override** — unlike `ContentTableCellSchema.background`. `sheets.ts`'s cell-background and cell-border z-order steps are consequently skipped entirely (no dead placeholder code), and cell text alignment always falls back to the value-kind default (numeric right, boolean/error centre, string left) since there is nothing to override it with. A tracked, documented gap, not a silent one.
- **PDF output uses the standard 14 fonts only — no font embedding.** Helvetica/Times-Roman are genuinely metric-compatible substitutes for Arial/Times New Roman, but Word's actual current defaults (Calibri, Aptos) are not, so line wrapping and pagination will drift slightly from what Word itself would produce. Expect a faithful visual approximation, not a line-identical reproduction.
- **Reading arbitrary real-world PDFs is the single largest risk surface in this package**, and the parser is honest about its design target: cleanly-generated output from mainstream producers (Word, PowerPoint, Chrome, LibreOffice, Acrobat), recovering from the malformations those producers and their downstream tooling actually create, and failing loudly and specifically on anything else — not matching a mature library's robustness against adversarial input.
- **Encrypted PDFs are unsupported.** `/Encrypt` present in the trailer throws `PdfEncryptedError`, even for the common empty-user-password case.
- **`CCITTFaxDecode`/`JBIG2Decode`/`JPXDecode` PDF images are unsupported** (scanned-fax and JPEG2000 formats) — the image is skipped with a diagnostic, the rest of the page still reads. JPEG images (`DCTDecode`) pass through completely losslessly in both directions; PNG-sourced images go through a real, narrowly-scoped hand-written codec.
- **PDF → docx/pptx reconstruction has no table or vector-shape recovery.** A PDF has no semantic table structure to recover — a wide horizontal gap on a line becomes a tab character, not a reconstructed grid. General vector paths, curves, gradients, and shadings are not recovered either.
- **Table cell `colSpan`/`rowSpan` and pptx shape rotation are read from a `ContentDocument` but not yet written back** by `buildDocxPackage`/`buildOdtPackage`/`buildPptxPackage` — a merged cell round-trips as an ordinary unmerged one, and a rotated *pptx* shape round-trips unrotated (`buildOdpPackage` does not share the rotation half of this gap — see the `OdpShape.rotationDeg` gotcha above). Both are bounded, tracked gaps (the cell's own text content and the shape's own position are still correct), not silent ones.
- **docx headers/footers, live `PAGE`/`NUMPAGES` field substitution, and inline images are not read** by `readDocxContent` — a deliberate, tracked scope narrowing from the original design, not an oversight.
- **pptx speaker notes survive `pptxToPdf`/`pdfToPptx`, but not through any real PDF feature.** PDF has no native concept of hidden presenter notes, so `convertPresentationToLayout` carries `ContentSlide.notes` as a hidden `/Subtype /Text` annotation on the page (the same construct Acrobat's own sticky-note tool uses, marked with the `Hidden` annotation flag so it never renders or prints), and `reconstructPresentation` reads it back via a `/T` marker that distinguishes this package's own notes annotation from a genuine third-party sticky note. This is a round-trip mechanism specific to this package's own writer/reader pair — a PDF produced by anything else will never carry it, and a PDF consumer other than this package's own `readPdf` will never see it as anything but an invisible, empty sticky note.
- **`sourcePath` traces a `LayoutItem` back to the `ContentDocument` node it came from, but only within one read+layout pass.** `ooxml.js`'s `readDocx`/`readPptx` stamp every `ContentRun`/`ContentImageBlock`/`ContentTable`/`ContentShape` with a positional path (`sections[0].blocks[2].runs[1]`, `slides[1].shapes[3].blocks[0]`); `convertWordprocessingToLayout`/`convertPresentationToLayout` copy that same string onto whichever `LayoutText`/`LayoutImage`/`LayoutLink`/`LayoutRect` item(s) it produces, so a positioned PDF-side item can be traced back to its semantic origin. When line-wrapping splits one run's word across a run boundary, every resulting fragment gets its own run's path (not a shared or merged one); when a single run is emergency-split across several lines or pages, every resulting fragment keeps that same one run's path unchanged. A table cell's background `LayoutRect` is attributed to its containing table's own `sourcePath`, since `ContentTableCell` carries none of its own. This is **not** an edit-tracking or incremental-relayout mechanism — the path is only valid against the exact `ContentDocument`/`Package` it was assigned from in that one read; editing the document, re-reading it, or reordering its blocks invalidates every previously-captured path, and nothing here recomputes or diffs paths across two versions of a document.

## Fidelity

**docx/pptx/odt/odp → PDF** is a genuine layout render: the docx/odt flow/pagination engine and the pptx/odp direct-placement engine both produce real positioned text, images, tables, and (for docx/odt) numbered/bulleted lists, styled through the full cascade (theme fonts/colours, `basedOn` chains, placeholder inheritance for docx/pptx; `style:default-style`/`style:parent-style-name` chains for odt/odp). It is a faithful **visual approximation**, not a pixel- or line-identical reproduction of what Word/PowerPoint/Writer/Impress would themselves render — see the standard-14 font substitution gotcha above.

**PDF → docx/pptx/odt/odp** is necessarily a **best-effort reconstruction** from geometry: a PDF page is just positioned glyphs and images, with no semantic paragraph or shape structure to recover. Reading order, bold/italic/colour/font-size, and page/slide count are preserved; paragraph and text-block boundaries are inferred from baseline spacing and left-margin indentation, not recovered exactly.

Neither direction is round-trip-lossless, and the two conversions are not inverses of each other — `pdfToDocx(docxToPdf(x))` will not reproduce `x` exactly, and is not intended to. This is a deliberate, permanent contrast with `ooxml.js`'s own `packageCodec`, which genuinely is a lossless round trip. `docxPdfCodec`/`pptxPdfCodec`/`odtPdfCodec`/`odpPdfCodec`/`pdfCodec` share `packageCodec`'s *mechanism* (`z.codec()`, schema-validated both ways) but not its *guarantee* — wrapping a lossy conversion in `z.codec()` validates the shape of what comes out, not its fidelity to what went in.

**Optional real-world corpus.** `test/corpus/` (gitignored, never committed) holds a `pnpm test:corpus` vitest project for manual conformance checking against real PDFs a hand-built fixture can't fully stand in for — a Word "Save as PDF", a PowerPoint "Save as PDF", a Chrome "Print to PDF", a LibreOffice export. It is not part of `pnpm test` and does not gate CI; drop files in locally before a significant parser change.

## Release and publishing

`.github/workflows/ci.yml` runs commitlint, lint, typecheck, the unit suite, and the smoke test on every push and pull request. On a push to `main` where those all pass, `release.config.ts` drives [semantic-release](https://semantic-release.gitbook.io/semantic-release): commit history since the last tag decides the version bump, `CHANGELOG.md` and `package.json` are committed back to `main`, a GitHub Release is cut, and the package publishes to [npmjs.org](https://www.npmjs.com/package/documents.js) — via npm's OIDC trusted publishing, so no `NPM_TOKEN` exists anywhere in the pipeline.

Whether that release actually published a new version is detected by diffing `package.json`'s version before and after the release step, not by trusting a third-party action's own detection. Two further jobs gate on that: one republishes the same build under the scoped `@exadev/documents.js` alias to GitHub Packages (which has no OIDC exchange of its own, so it authenticates with `GITHUB_TOKEN` instead), and one packs the release into its own directory, generates an SPDX SBOM (`pnpm sbom`), and signs both an SBOM and a build-provenance attestation against that exact tarball — verifiable independently of the registry, and still present if the package is later unpublished.

## Contributing

Commits follow Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, …), enforced by commitlint (`commitlint.config.ts`) via a husky `commit-msg` hook and a CI `commitlint` job — semantic-release's version bump depends on these being well-formed, not just style. A husky `pre-commit` hook runs `lint-staged` (`eslint --fix` on staged `*.ts` files) and `pre-push` runs the test suite. There is a single `main` branch and no open pull request workflow established so far.

## References

- [ooxml.js](https://github.com/ExaDev/ooxml.js) — the sibling package this depends on for all docx/pptx/xlsx ⇄ JSON handling and cascade-resolved typed reading.
- [document-content-model](https://github.com/ExaDev/document-content-model) — the sibling package that owns `ContentDocument`/`LayoutDocument` themselves; both `ooxml.js` and `documents.js` import from it rather than each maintaining an independent copy.
- [odf.js](https://github.com/ExaDev/odf.js) — a sibling package doing the equivalent lossless-codec job for the OpenDocument Format (odt/ods/odp/odg/…), also built on `document-content-model`. A dependency of `documents.js` for: this package's `Odt`/`Ods`/`Odp`/`OdgBytesSchema` (`src/model/bytes.ts`), which validate against its `ODF_MEDIA_TYPES` table; `src/interop.test.ts`, a type-level guard that `ooxml.js`'s and `odf.js`'s raw `XmlElement`/`XmlNode`/`Attribute`/`Package` container types stay structurally compatible; `src/odf/odt/read.ts`'s `readOdtContent`, a thin adapter over `odf.js`'s own `readOdt`, feeding `odtToPdf`/`pdfToOdt` (`src/convert/convert.ts`); `src/odf/odp/read.ts`'s `readOdpContent`, the same adapter over `odf.js`'s `readOdp`, feeding `odpToPdf`/`pdfToOdp`; `src/edit/odt/*`'s `StyleRegistry`/`resolveStyle` (style interning) and `src/edit/odp/shape.ts`'s `applyOdfTransform`/`resolveOdfShapeGeometry` (rotation), both consumed directly rather than reimplemented. odt and odp → `ContentDocument` reading and PDF conversion are now integrated both ways; ods/odg → `ContentDocument` reading (the equivalent for spreadsheets and drawings) is not yet.

## License

MIT
