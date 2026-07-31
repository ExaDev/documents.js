# documents.js

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/documents.js) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/documents.js) [![Release](https://img.shields.io/github/v/release/ExaDev/documents.js)](https://github.com/ExaDev/documents.js/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/documents.js/ci.yml?branch=main)](https://github.com/ExaDev/documents.js/actions)

> Bidirectional docx/pptx ⇄ PDF conversion, a read-and-write live-view editor for docx/pptx content, and a fully hand-written PDF codec, built on [ooxml.js](https://github.com/ExaDev/ooxml.js).

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

The four ergonomic conversions:

```ts
import { docxToPdf, pdfToDocx, pptxToPdf, pdfToPptx } from 'documents.js';

const pdfBytes = docxToPdf(docxBytes);
const docxBytes2 = pdfToDocx(pdfBytes);

const pdfFromSlides = pptxToPdf(pptxBytes);
const pptxBytes2 = pdfToPptx(pdfFromSlides);
```

Each accepts an optional `signal` (`AbortSignal`) and either a `onSubstitution` callback (docx/pptx → PDF, called once per character not representable in a standard-14 font) or a `sink` (PDF → docx/pptx, called once per recoverable parse diagnostic).

The same four conversions behind a swappable port, for a caller that wants to inject a different implementation later without changing call sites:

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

Reading and writing PDF bytes directly, without going through docx/pptx:

```ts
import { readPdf, writePdf } from 'documents.js';

const layout = readPdf(pdfBytes); // -> LayoutDocument: pages of positioned text/image/rect/link items
const bytes = writePdf(layout);
```

The same three round trips (PDF ⇄ `LayoutDocument`, docx ⇄ PDF, pptx ⇄ PDF) are each also available as a schema-validated [`z.codec()`](https://zod.dev) pair, mirroring `ooxml.js`'s own `packageCodec` — `z.decode`/`z.encode` validate both the raw bytes (against the magic-byte schemas below) and the parsed value (against `LayoutDocumentSchema`) on every call, catching a malformed value that a bare function call wouldn't. This is the no-extra-options form: `readPdf`/`writePdf`/`docxToPdf`/etc. remain the entry points for cancellation (`signal`), diagnostics (`sink`), or substitution reporting (`onSubstitution`), none of which fit `z.codec()`'s fixed `decode(input)`/`encode(output)` signature.

```ts
import { z } from 'zod';
import { docxPdfCodec, pdfCodec, pptxPdfCodec } from 'documents.js';

const layout = z.decode(pdfCodec, pdfBytes); // throws a ZodError if pdfBytes has no %PDF- header
const pdfBytes2 = z.encode(pdfCodec, layout);

const pdfFromDocx = z.decode(docxPdfCodec, docxBytes);
const docxBack = z.encode(docxPdfCodec, pdfFromDocx);
```

`readDocxContent`/`readPptxContent` (docx/pptx → `ContentDocument`), `convertWordprocessingToLayout`/`convertPresentationToLayout` (`ContentDocument` → `LayoutDocument`), and `reconstructWordprocessing`/`reconstructPresentation` (`LayoutDocument` → `ContentDocument`) are each exported individually too, for a caller that wants one stage of the pipeline without the rest.

## Architecture

The package is layered from generic primitives outward to the two conversion directions:

- **`src/model/`** — Zod schemas only, no behaviour: unit conversions (EMU/twip/point/half-point), geometry (`Box`, `PageSize`, `Margins`, the one deliberate `flipY` between OOXML's top-left/y-down space and PDF's bottom-left/y-up space), colour, and the two pivot models — `LayoutDocument` (the PDF-side pivot: pages of positioned text/image/rect/line/ellipse/link items, PDF-native coordinates and units) and `ContentDocument` (the semantic pivot: a discriminated union of `wordprocessing` and `presentation` variants sharing paragraph/run/table/image building blocks).
- **`src/bytes/`** and **`src/image/`** — generic byte and image-container primitives with zero PDF or OOXML knowledge: a chunked byte writer, a backtracking byte reader, CRC32, and a hand-written PNG decoder/encoder (palette/gray/RGB/alpha, multi-`IDAT` files, all five scanline filters) plus JPEG marker scanning for dimensions only — JPEG's compressed bytes pass through completely unchanged in both directions. `src/bytes/flate.ts` is the only file that imports `fflate`, mirroring how `ooxml.js`'s own `src/zip.ts` wraps it for ZIP handling.
- **`src/xml/`** and **`src/opc/`** — parent-aware XML query/mutation and OPC package mechanics (relationship IDs, content-type entries, atomic media-part insertion) built over `ooxml.js`'s `Package`/`XmlNode`, needed because `ooxml.js`'s own XML nodes have no parent pointers and `ooxml.js` never writes new parts into an existing package.
- **`src/edit/`** — the read-and-write editable model: live-view classes (`DocxEditor`/`DocxParagraph`/`DocxRun`/`DocxTable`, `PptxEditor`/`PptxSlide`/`PptxShape`) wrapping the actual `XmlElement` objects inside a decoded `Package`, plus `buildDocxPackage`/`buildPptxPackage` bridging a `ContentDocument` to a fresh package built entirely through those same primitives.
- **`src/pdf/`** — the hand-written PDF codec, importing only `model`/`bytes`/`image` (no OOXML knowledge at all):
  - **Write**: `objects.ts` (the `PdfObject` discriminated union), `afm-widths.ts`/`encoding.ts`/`winansi.ts`/`fonts.ts` (standard-14 metrics, WinAnsi encoding, family resolution), `measure.ts`/`text-layout.ts` (greedy line-wrapping), `matrix.ts`, `content-write.ts` (`LayoutItem[]` → content-stream operators), `write.ts` (the full object graph, classic cross-reference table, trailer).
  - **Read**: `lexer.ts`/`parse.ts` (byte tokenizer and tokens → `PdfObject`), `filters.ts`/`predictors.ts` (Flate/LZW/ASCII85/ASCIIHex/RunLength, TIFF/PNG predictors), `xref.ts`/`document.ts` (classic and cross-reference-stream resolution, object streams, `/Prev` chains, linear-scan recovery, the page tree with attribute inheritance), `content-read.ts`/`interpret.ts` (the content-stream tokenizer and graphics/text state machine, including form-XObject recursion), `cmap.ts`/`font-style.ts`/`font-read.ts` (`/ToUnicode` CMaps, font-dictionary resolution), `images-read.ts` (Image XObjects → PNG/JPEG bytes), `read.ts` (`readPdf`, assembling all of the above into a `LayoutDocument`).
  - `codec.ts` — `pdfCodec`, a `z.codec()` pair over `readPdf`/`writePdf` (PDF bytes ⇄ `LayoutDocument`).
- **`src/ooxml/`** — resolves a `Package` into a `ContentDocument`: `docx/read.ts` and `pptx/read.ts` are now thin adapters over `ooxml.js`'s own `readDocx`/`readPptx`, wrapping their `{ metadata, sections }`/`{ metadata, slides }` result into `ContentDocument`'s `wordprocessing`/`presentation` shape. The docx style cascade (`docDefaults` → named-style `basedOn` chains → paragraph-mark run properties → character styles → direct formatting), the pptx placeholder → layout → master → theme inheritance cascade, and DrawingML geometry/colour resolution all now live upstream in `ooxml.js` itself, not in this package.
- **`src/layout/`** — the pure conversion algorithms, importing only `model` (no I/O): `engine.ts` (`ContentDocument` wordprocessing → `LayoutDocument`: flow, line-breaking, pagination), `slides.ts` (`ContentDocument` presentation → `LayoutDocument`: direct EMU-to-point placement, no pagination needed), `reconstruct.ts` (`LayoutDocument` → `ContentDocument`, both variants: baseline-proximity line clustering, then paragraph/text-block clustering from geometry — PDF has no semantic paragraph or shape structure to recover, only positioned glyphs).
- **`src/convert/`** — `convert.ts` (the four ergonomic wrappers), `codec.ts` (`docxPdfCodec`/`pptxPdfCodec`, a `z.codec()` pair over each), `port.ts`/`local.ts` (the swappable `DocumentConverter` contract and its synchronous local implementation).

Dependency direction is strictly downward and checkable: `model`/`bytes` import nothing local; `image` imports `bytes` only; `pdf` imports `model`+`bytes`+`image` only; `ooxml/*` imports `xml`/`model` only (no PDF knowledge); `layout` imports `model` only; `convert` composes everything else. No `PdfObject`/`PdfDict`/`PdfStream` type appears outside `src/pdf/`.

## Build, test, and lint

```sh
pnpm build         # tsdown -> dist/ (ESM + CJS + .d.ts)
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint . --max-warnings 0
pnpm test          # vitest run --project unit
pnpm test:watch    # vitest --project unit
pnpm test:smoke    # rebuilds dist/, then verifies ESM/CJS parity and a real docxToPdf/pdfToDocx round trip from the built CJS bundle
pnpm test:corpus   # optional real-world PDF conformance checks against a local, gitignored test/corpus/ (see Fidelity)
```

To run a single test file: `pnpm vitest run src/path/to/file.test.ts`.

## Conventions

- **Zod-first schema/type/guard**, matching `ooxml.js`: every model type is inferred from its Zod schema, never hand-written. `ContentBlock` (recursive, mirroring `ooxml.js`'s own `XmlNode` treatment) uses a hand-written structural guard + `z.custom`, not `z.lazy`, which collapses to `unknown` for recursive element-children in the pinned Zod version.
- **`z.codec()` for every schema-to-schema round trip**, matching `ooxml.js`'s `packageCodec`/`xmlCodec`: `pdfCodec` (PDF bytes ⇄ `LayoutDocument`) and `docxPdfCodec`/`pptxPdfCodec` (docx/pptx bytes ⇄ PDF bytes) each wrap an already-independently-tested function pair, adding automatic two-way schema validation. These are deliberately the no-options form — `readPdf`/`writePdf`/`docxToPdf`/`pdfToDocx`/`pptxToPdf`/`pdfToPptx` remain the primary entry points wherever a caller needs an `AbortSignal`, a `PdfDiagnosticSink`, or an `onSubstitution` callback, since `z.codec()`'s fixed `decode(input)`/`encode(output)` signature has no room for side-channel options.
- **`PdfObject` has no Zod schema at all**, deliberately: it never crosses a public boundary or round-trips through JSON, and is constructed exclusively by this package's own parser — validating it would just be validating our own output. It narrows natively on its own `kind` discriminant instead, the same reasoning `ooxml.js` applies when it picks a hand-written `isXmlNode` guard over `z.lazy`.
- **No type assertions anywhere.** Every third-party or loosely-typed value is narrowed through a type guard or a Zod parse at the boundary.
- **Live views, not flatten-and-regenerate.** `src/edit/*`'s editor classes hold a reference directly into the real `Package`/`XmlElement` objects; saving is `encodePackage(pkg)`, nothing more. This is what makes "everything you didn't touch stays byte-faithful" a structural guarantee rather than a best effort.
- **A three-tier PDF-read failure policy**, applied consistently across every `src/pdf/*` read module: throw a typed `PdfParseError`/`PdfEncryptedError` for a file that cannot be meaningfully processed at all; recover with a `PdfDiagnostic` (`severity: 'warning'`) for something malformed but salvageable (a bad `startxref`, a wrong stream `/Length`); degrade with a diagnostic for an individual unsupported feature (an unimplemented filter, an unrecognised colour space) while the rest of the document still reads.
- **Conventional commits**, enforced via commitlint + husky, matching `ooxml.js`.

## Gotchas and quirks

- **`ooxml.js`'s typed readers (`readDocx`/`readPptx`) are now the actual basis for conversion** — `readDocxContent`/`readPptxContent` are thin wrappers around them, not an independent walk of `word/document.xml`/`ppt/slides/slideN.xml`. They are still deliberately not re-exported from this package's own public surface: `readDocx`/`readPptx` also carry `comments`/`footnotes`/`headers`/`footers` (docx) that `ContentDocument` doesn't model, so exposing both the wrapper and the thing it wraps would invite a caller to reach for the wrong one rather than genuinely offering two competing models.
- **The docx⇄PDF and pptx⇄PDF conversions are explicitly not round-trip-lossless** — in deliberate contrast to `ooxml.js`'s own `packageCodec`, which is byte/part-faithful by design. See [Fidelity](#fidelity).
- **PDF output uses the standard 14 fonts only — no font embedding.** Helvetica/Times-Roman are genuinely metric-compatible substitutes for Arial/Times New Roman, but Word's actual current defaults (Calibri, Aptos) are not, so line wrapping and pagination will drift slightly from what Word itself would produce. Expect a faithful visual approximation, not a line-identical reproduction.
- **Reading arbitrary real-world PDFs is the single largest risk surface in this package**, and the parser is honest about its design target: cleanly-generated output from mainstream producers (Word, PowerPoint, Chrome, LibreOffice, Acrobat), recovering from the malformations those producers and their downstream tooling actually create, and failing loudly and specifically on anything else — not matching a mature library's robustness against adversarial input.
- **Encrypted PDFs are unsupported.** `/Encrypt` present in the trailer throws `PdfEncryptedError`, even for the common empty-user-password case.
- **`CCITTFaxDecode`/`JBIG2Decode`/`JPXDecode` PDF images are unsupported** (scanned-fax and JPEG2000 formats) — the image is skipped with a diagnostic, the rest of the page still reads. JPEG images (`DCTDecode`) pass through completely losslessly in both directions; PNG-sourced images go through a real, narrowly-scoped hand-written codec.
- **PDF → docx/pptx reconstruction has no table or vector-shape recovery.** A PDF has no semantic table structure to recover — a wide horizontal gap on a line becomes a tab character, not a reconstructed grid. General vector paths, curves, gradients, and shadings are not recovered either.
- **Table cell `colSpan`/`rowSpan` and pptx shape rotation are read from a `ContentDocument` but not yet written back** by `buildDocxPackage`/`buildPptxPackage` — a merged cell round-trips as an ordinary unmerged one, and a rotated shape round-trips unrotated. Both are bounded, tracked gaps (the cell's own text content and the shape's own position are still correct), not silent ones.
- **docx headers/footers, live `PAGE`/`NUMPAGES` field substitution, and inline images are not read** by `readDocxContent` — a deliberate, tracked scope narrowing from the original design, not an oversight.
- **pptx speaker notes survive `pptxToPdf`/`pdfToPptx`, but not through any real PDF feature.** PDF has no native concept of hidden presenter notes, so `convertPresentationToLayout` carries `ContentSlide.notes` as a hidden `/Subtype /Text` annotation on the page (the same construct Acrobat's own sticky-note tool uses, marked with the `Hidden` annotation flag so it never renders or prints), and `reconstructPresentation` reads it back via a `/T` marker that distinguishes this package's own notes annotation from a genuine third-party sticky note. This is a round-trip mechanism specific to this package's own writer/reader pair — a PDF produced by anything else will never carry it, and a PDF consumer other than this package's own `readPdf` will never see it as anything but an invisible, empty sticky note.
- **`sourcePath` traces a `LayoutItem` back to the `ContentDocument` node it came from, but only within one read+layout pass.** `ooxml.js`'s `readDocx`/`readPptx` stamp every `ContentRun`/`ContentImageBlock`/`ContentTable`/`ContentShape` with a positional path (`sections[0].blocks[2].runs[1]`, `slides[1].shapes[3].blocks[0]`); `convertWordprocessingToLayout`/`convertPresentationToLayout` copy that same string onto whichever `LayoutText`/`LayoutImage`/`LayoutLink`/`LayoutRect` item(s) it produces, so a positioned PDF-side item can be traced back to its semantic origin. When line-wrapping splits one run's word across a run boundary, every resulting fragment gets its own run's path (not a shared or merged one); when a single run is emergency-split across several lines or pages, every resulting fragment keeps that same one run's path unchanged. A table cell's background `LayoutRect` is attributed to its containing table's own `sourcePath`, since `ContentTableCell` carries none of its own. This is **not** an edit-tracking or incremental-relayout mechanism — the path is only valid against the exact `ContentDocument`/`Package` it was assigned from in that one read; editing the document, re-reading it, or reordering its blocks invalidates every previously-captured path, and nothing here recomputes or diffs paths across two versions of a document.

## Fidelity

**docx/pptx → PDF** is a genuine layout render: the docx flow/pagination engine and the pptx direct-placement engine both produce real positioned text, images, tables, and (for docx) numbered/bulleted lists, styled through the full cascade (theme fonts/colours, `basedOn` chains, placeholder inheritance). It is a faithful **visual approximation**, not a pixel- or line-identical reproduction of what Word/PowerPoint would themselves render — see the standard-14 font substitution gotcha above.

**PDF → docx/pptx** is necessarily a **best-effort reconstruction** from geometry: a PDF page is just positioned glyphs and images, with no semantic paragraph or shape structure to recover. Reading order, bold/italic/colour/font-size, and page/slide count are preserved; paragraph and text-block boundaries are inferred from baseline spacing and left-margin indentation, not recovered exactly.

Neither direction is round-trip-lossless, and the two conversions are not inverses of each other — `pdfToDocx(docxToPdf(x))` will not reproduce `x` exactly, and is not intended to. This is a deliberate, permanent contrast with `ooxml.js`'s own `packageCodec`, which genuinely is a lossless round trip. `docxPdfCodec`/`pptxPdfCodec`/`pdfCodec` share `packageCodec`'s *mechanism* (`z.codec()`, schema-validated both ways) but not its *guarantee* — wrapping a lossy conversion in `z.codec()` validates the shape of what comes out, not its fidelity to what went in.

**Optional real-world corpus.** `test/corpus/` (gitignored, never committed) holds a `pnpm test:corpus` vitest project for manual conformance checking against real PDFs a hand-built fixture can't fully stand in for — a Word "Save as PDF", a PowerPoint "Save as PDF", a Chrome "Print to PDF", a LibreOffice export. It is not part of `pnpm test` and does not gate CI; drop files in locally before a significant parser change.

## Release and publishing

`.github/workflows/ci.yml` runs commitlint, lint, typecheck, the unit suite, and the smoke test on every push and pull request. On a push to `main` where those all pass, `release.config.ts` drives [semantic-release](https://semantic-release.gitbook.io/semantic-release): commit history since the last tag decides the version bump, `CHANGELOG.md` and `package.json` are committed back to `main`, a GitHub Release is cut, and the package publishes to [npmjs.org](https://www.npmjs.com/package/documents.js) — via npm's OIDC trusted publishing, so no `NPM_TOKEN` exists anywhere in the pipeline.

Whether that release actually published a new version is detected by diffing `package.json`'s version before and after the release step, not by trusting a third-party action's own detection. Two further jobs gate on that: one republishes the same build under the scoped `@exadev/documents.js` alias to GitHub Packages (which has no OIDC exchange of its own, so it authenticates with `GITHUB_TOKEN` instead), and one packs the release into its own directory, generates an SPDX SBOM (`pnpm sbom`), and signs both an SBOM and a build-provenance attestation against that exact tarball — verifiable independently of the registry, and still present if the package is later unpublished.

## Contributing

Commits follow Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, …), enforced by commitlint (`commitlint.config.ts`) via a husky `commit-msg` hook and a CI `commitlint` job — semantic-release's version bump depends on these being well-formed, not just style. A husky `pre-commit` hook runs `lint-staged` (`eslint --fix` on staged `*.ts` files) and `pre-push` runs the test suite. There is a single `main` branch and no open pull request workflow established so far.

## References

- [ooxml.js](https://github.com/ExaDev/ooxml.js) — the sibling package this depends on for all docx/pptx/xlsx ⇄ JSON handling.

## License

MIT
