# pdf-codec

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/pdf-codec) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/pdf-codec) [![Release](https://img.shields.io/github/v/release/ExaDev/pdf-codec)](https://github.com/ExaDev/pdf-codec/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/pdf-codec/ci.yml?branch=main)](https://github.com/ExaDev/pdf-codec/actions)

> A hand-written, dependency-minimal PDF codec: parses arbitrary real-world PDFs into a structured, positioned-content document and generates new PDFs from one, built on [`document-schema.js`](https://github.com/ExaDev/document-schema.js)'s `LayoutDocument` pivot and [Zod 4](https://zod.dev) codecs.

`pdf-codec` is the PDF-reading-and-writing half of [`documents.js`](https://github.com/ExaDev/documents.js), extracted into its own package: every layer of the PDF format — the object model, the cross-reference table, the content-stream operators, standard-font metrics, the parser's cross-reference/object-stream resolution and content-stream interpreter — is hand-written against the ISO 32000-1 specification, with no external PDF library (`pdf-lib`, `pdfjs-dist`, `mupdf`, or any other) as a dependency. The one exception is [`fflate`](https://github.com/101arrowz/fflate) for raw DEFLATE/zlib compression underneath PDF's `FlateDecode` filter and PNG's `IDAT` chunks. The OpenType/CFF font parsing this package's own writer uses to embed a real math font (`sfnt.ts`/`math-*.ts`) is hand-written too, for the same "no supply-chain surface beyond what's already declared" reason — the one bundled binary asset is the vendored STIX Two Math font itself (OFL-1.1, see [Fidelity](#fidelity) and `assets/fonts/NOTICE.md`), not a library.

That is a genuinely large undertaking — this codec is comparable in size to a small application in its own right — and it comes with an honest trade-off spelled out in [Fidelity](#fidelity) below: this is not, and does not attempt to be, as robust against adversarial or badly malformed real-world PDFs as a library with 15+ years of hardening. What it buys instead is a dependency-free, fully auditable PDF implementation with no supply-chain surface beyond `document-schema.js`, `fflate`, and `zod`.

`documents.js` uses this package to convert docx/pptx/odt/odp/ods/odg to and from PDF, and to render MathML formulas (typeset by its own `src/mathml/` engine) through the embedded math font this package parses and writes. That MathML *layout* engine deliberately stays in `documents.js` — see [Architecture](#architecture) below for exactly where the boundary between the two packages sits and why a real `MathBox` value crosses it with zero cast or wrapper.

## Getting started

Requires Node.js `>=20` and pnpm `11.6.0` (pinned via `packageManager` in `package.json`).

```sh
pnpm install
```

Install as a dependency in another project:

```sh
pnpm add pdf-codec
# or
npm install pdf-codec
```

## Usage

Reading and writing PDF bytes:

```ts
import { readPdf, writePdf } from 'pdf-codec';

const layout = readPdf(pdfBytes); // -> LayoutDocument: pages of positioned text/image/rect/line/ellipse/path/link items
const bytes = writePdf(layout);
```

Both accept an optional `signal` (`AbortSignal`); `readPdf` additionally takes a `sink` (a `PdfDiagnosticSink`, called once per recoverable parse diagnostic — see the three-tier failure policy under [Conventions](#conventions)), and `writePdf` an `onSubstitution` callback, called once per character not representable in a standard-14 font (see [Fidelity](#fidelity)).

The same round trip is also available as a schema-validated [`z.codec()`](https://zod.dev) pair:

```ts
import { z } from 'zod';
import { pdfCodec } from 'pdf-codec';

const layout = z.decode(pdfCodec, pdfBytes); // throws a ZodError if pdfBytes has no %PDF- header
const pdfBytes2 = z.encode(pdfCodec, layout);
```

`z.decode` validates the input bytes against `PdfBytesSchema` (the `%PDF-` header) before parsing, and the parsed result against `LayoutDocumentSchema`; `z.encode` validates the reverse. This is the no-extra-options form only — `readPdf`/`writePdf` remain the entry points for cancellation, diagnostics, or substitution reporting, none of which fit `z.codec()`'s fixed `decode(input)`/`encode(output)` signature.

Embedding a real math formula: `writePdf`'s own `formulas` option takes an array of `PositionedFormula` — an already-laid-out `MathBox` (positioned glyph runs, fraction/radical rules, radical-hook strokes) placed at a page position. This package supplies the font — `loadMathFont()` parses and caches the vendored STIX Two Math font once per process, exposing per-size `MathFontMetrics` — but it does not lay MathML out itself; that is a separate concern this package deliberately doesn't own (see [Architecture](#architecture)). `documents.js`'s own `layoutFormula` is the typical producer of a `MathBox`:

```ts
import { loadMathFont, writePdf } from 'pdf-codec';
import { layoutFormula } from 'documents.js'; // or any other producer of a structurally-compatible MathBox

const { metricsAt } = loadMathFont();
const { box } = layoutFormula(mathml, { metrics: metricsAt(12), sizePt: 12, color: { r: 0, g: 0, b: 0 } });

const pdfBytes = writePdf(doc, { formulas: [{ pageIndex: 0, xPt: 50, yPt: 700, box }] });
```

Because `MathBox` and its own constituent types (`MathGlyphRun`/`MathRule`/`MathStroke`/`MathColor`) are plain, structurally-typed data — not a class, not branded — any producer whose output happens to match the shape works here with no cast, no wrapper, and no transformation, whether or not it imports this package at all.

Building a layout engine on top of this codec (this is what `documents.js`'s own `src/layout/` does for docx/pptx/odt/odp/ods/odg): `TextMeasurer`/`createStandardFontMeasurer` and `wrapRunsToWidth` answer "how wide does this text render, and where does this line break" against the standard-14 metrics; `resolveStandardFont`/`STANDARD_METRICS` map an arbitrary requested family/weight/style onto one of the 14 standard PDF faces and that face's own AFM-derived metrics; `rotatePointAboutCenter` handles shape-rotation placement math. None of these do any PDF I/O themselves — they're the same primitives `writePdf`/`readPdf` use internally, exported so a caller assembling its own `LayoutDocument` (from any source format) can measure and wrap text identically to how this package will actually render it.

The full `src/bytes/`/`src/image/` surface is exported too — `crc32`, `deflate`/`inflate`/`inflateTolerant`, `ByteReader`/`ByteWriter`/`concatBytes`, `readJpegInfo`, `decodePng`/`encodePng`, `unfilterScanlines`/`filterScanlines` — generic byte- and image-container primitives with zero PDF-specific knowledge of their own, useful independently of anything PDF-related.

## Architecture

The package is layered from generic primitives outward to the codec itself:

- **`src/math-types.ts`** and **`src/formula.ts`** — a local, structurally-compatible mirror of `documents.js`'s own `src/mathml/layout-types.ts` + `src/mathml/metrics.ts` (`MathColor`/`MathGlyphRun`/`MathRule`/`MathStroke`/`MathLayoutItem`/`MathBox`/`MathGlyphMetrics`/`MathFontMetrics`, including the latter's own `glyph()` method signature) and `src/model/formula.ts`'s `PositionedFormula`. Deliberately not imported from `documents.js` — that would be a circular dependency once `documents.js` depends on this package for `readPdf`/`writePdf` — the same "mirror the shape, don't import the package" trick this whole family already uses elsewhere (`odf.js`'s own `MathMlNode` mirrors `ooxml.js`'s `XmlNode` rather than importing it). Because every one of these types is plain data (only `MathFontMetrics` carries a method), a real `MathBox` value `documents.js`'s own MathML layout engine produces passes into `writePdf({ formulas })` with zero cast, zero wrapper, and zero transformation.
- **`src/bytes/`** and **`src/image/`** — generic byte and image-container primitives with zero PDF-specific knowledge: a chunked byte writer, a backtracking byte reader, CRC32, and a hand-written PNG decoder/encoder (palette/gray/RGB/alpha, multi-`IDAT` files, all five scanline filters) plus JPEG marker scanning for dimensions only — JPEG's compressed bytes pass through completely unchanged in both directions. `src/bytes/flate.ts` is the only file that imports `fflate`.
- **`src/util/`** — two small, independently-duplicated copies of logic that lives elsewhere in the family for a reason narrow enough not to warrant a shared dependency: `base64.ts` (isomorphic base64 ⇄ `Uint8Array`, a verbatim copy of `odf.js`'s own `src/util/base64.ts`, replacing a dependency this codec used to have on `ooxml.js` purely for this one helper pair) and `abort.ts` (`throwIfAborted`, a four-line signal-check helper called at every page loop boundary in `write.ts`/`read.ts` — there is no `await` point in this package's synchronous reader/writer pipeline for cancellation to hook into implicitly, so every long-running loop checks explicitly instead; a duplicate of `documents.js`'s own `src/ports/abort.ts`, which stays there since other, non-PDF consumers still depend on it in that repository).
- **The codec itself, importing only `math-types`/`formula`/`bytes`/`image` (no OOXML or ODF knowledge at all):**
  - **Write**: `objects.ts` (the `PdfObject` discriminated union), `afm-widths.ts`/`encoding.ts`/`winansi.ts`/`fonts.ts` (standard-14 metrics, WinAnsi encoding, family resolution), `measure.ts`/`text-layout.ts` (greedy line-wrapping), `matrix.ts`, `content-write.ts` (`LayoutItem[]` → content-stream operators), `write.ts` (the full object graph, classic cross-reference table, trailer, and — when `WritePdfOptions.formulas` is non-empty — one embedded math composite font group, allocated once and shared across pages).
  - **Embedded math font**: `sfnt.ts` (a generic sfnt table-directory reader), `math-cmap.ts`/`math-hmtx.ts`/`math-table.ts` (Unicode → glyph ID, per-glyph advance widths, and the OpenType `MATH` table's constants/glyph-info subtables), `math-font.ts` (parses and caches the vendored STIX Two Math font once per process, exposing a size-specific `MathFontMetrics` implementation), `math-font-write.ts` (builds the `/Type0`/`/CIDFontType0`/`/FontDescriptor`/`/FontFile3`/ToUnicode object group), `math-content-write.ts` (a `PositionedFormula[]` → PDF content-stream bytes, Identity-H 2-byte CIDs for text-showing, `re`/`m`/`l` operators for rules and the radical hook). See [Fidelity](#fidelity) for the CFF-full-embed (not glyph-subsetted) simplification this makes.
  - **Read**: `lexer.ts`/`parse.ts` (byte tokenizer and tokens → `PdfObject`), `filters.ts`/`predictors.ts` (Flate/LZW/ASCII85/ASCIIHex/RunLength, TIFF/PNG predictors), `xref.ts`/`document.ts` (classic and cross-reference-stream resolution, object streams, `/Prev` chains, linear-scan recovery, the page tree with attribute inheritance), `content-read.ts`/`interpret.ts` (the content-stream tokenizer and graphics/text state machine, including form-XObject recursion and general vector-path tracking — see [Gotchas](#gotchas-and-quirks)), `cmap.ts`/`font-style.ts`/`font-read.ts` (`/ToUnicode` CMaps, font-dictionary resolution), `images-read.ts` (Image XObjects → PNG/JPEG bytes), `read.ts` (`readPdf`, assembling all of the above into a `LayoutDocument`).
  - `codec.ts` — `pdfCodec`, a `z.codec()` pair over `readPdf`/`writePdf`, plus a standalone, ~20-line local copy of just the `%PDF-` header check `PdfBytesSchema` needs (`documents.js`'s own equivalent schema lives in a file that also carries unrelated docx/pptx/odt schemas that have no place here).
- **`src/test-support/pdf.ts`** — hand-built PDF fixtures for the parser's own tests (a classic-xref file, an xref-stream-with-object-streams file, a broken-`startxref` file needing linear-scan recovery, an incremental update, an encrypted trailer, and more), built by literal byte/string concatenation and deliberately importing NOTHING from this package's own writer — a fixture built by calling `writePdf` would let a writer bug hide from the corresponding reader test and vice versa. Not part of the public surface; test-only.

Dependency direction is strictly downward and checkable: `math-types`/`formula`/`bytes`/`util` import nothing local (`bytes/flate.ts` imports `fflate`); `image` imports `bytes` only; the codec itself imports `math-types`+`formula`+`bytes`+`image`+`util` only. No `PdfObject`/`PdfDict`/`PdfStream` type appears outside the codec's own read/write modules — it never crosses a public boundary and is constructed exclusively by this package's own parser.

## Conventions

- **Zod-first schema/type/guard**: `PdfBytesSchema`/`LayoutDocumentSchema` (the latter imported from `document-schema.js`) are the only two schemas this package validates against; every other model type (`PdfObject`, `MathBox` and friends) is plain TypeScript, never Zod-validated, for reasons specific to each — see the next two bullets.
- **`z.codec()` for the one schema-to-schema round trip this package owns**: `pdfCodec` (PDF bytes ⇄ `LayoutDocument`), wrapping the already-independently-tested `readPdf`/`writePdf` pair and adding automatic two-way schema validation. Deliberately the no-options form — `readPdf`/`writePdf` remain the primary entry points wherever a caller needs an `AbortSignal`, a `PdfDiagnosticSink`, or an `onSubstitution` callback, since `z.codec()`'s fixed `decode(input)`/`encode(output)` signature has no room for side-channel options.
- **`PdfObject` has no Zod schema at all**, deliberately: it never crosses a public boundary or round-trips through JSON, and is constructed exclusively by this package's own parser — validating it would just be validating our own output. It narrows natively on its own `kind` discriminant instead.
- **The `MathBox`/`MathFontMetrics` family is structurally typed on purpose, not validated by Zod either.** This is the mechanism that lets a caller (`documents.js`) hand this package a real value produced by a completely independent module, with zero cast, zero wrapper, and no shared class or branded type — see [Architecture](#architecture).
- **No type assertions anywhere.** Every third-party or loosely-typed value is narrowed through a type guard or a Zod parse at the boundary.
- **A three-tier PDF-read failure policy**, applied consistently across every read module: throw a typed `PdfParseError`/`PdfEncryptedError` for a file that cannot be meaningfully processed at all; recover with a `PdfDiagnostic` (`severity: 'warning'`) for something malformed but salvageable (a bad `startxref`, a wrong stream `/Length`); degrade with a diagnostic for an individual unsupported feature (an unimplemented filter, an unrecognised colour space) while the rest of the document still reads.
- **Conventional commits**, enforced via commitlint + husky.

## Gotchas and quirks

- **Reading arbitrary real-world PDFs is the single largest risk surface in this package**, and the parser is honest about its design target: cleanly-generated output from mainstream producers (Word, PowerPoint, Chrome, LibreOffice, Acrobat), recovering from the malformations those producers and their downstream tooling actually create, and failing loudly and specifically on anything else — not matching a mature library's robustness against adversarial input.
- **Encrypted PDFs are unsupported.** `/Encrypt` present in the trailer throws `PdfEncryptedError`, even for the common empty-user-password case.
- **`CCITTFaxDecode`/`JBIG2Decode`/`JPXDecode` PDF images are unsupported** (scanned-fax and JPEG2000 formats) — the image is skipped with a diagnostic, the rest of the page still reads. JPEG images (`DCTDecode`) pass through completely losslessly in both directions; PNG-sourced images go through a real, narrowly-scoped hand-written codec.
- **`interpret.ts` tracks general vector paths, not just axis-aligned `re` rectangles.** `m`/`l`/`c`/`v`/`y`/`h` (and `re` itself, per its own ISO 32000-1 definition as a 4-point rectangle subpath) accumulate real subpaths — CTM-transformed line/cubic segments, open or closed — and any paint operator (`f`/`F`/`f*`/`S`/`s`/`B`/`B*`/`b`/`b*`) emits a `LayoutPath` item when the path isn't reducible to the simple single-`re`-on-an-axis-aligned-CTM case (which still takes the original, unchanged `LayoutRect` fast path). Verified both by dedicated tests and by a genuine `writePath` → `writePdf` → `readPdf` round trip recovering the original `LayoutPath` value exactly. A stroked-and-filled rect, any ellipse (`writeEllipse` always emits four cubic Beziers, with no PDF-level marker that it started life as an ellipse), and a plain line each come back as a generic `LayoutPath` too — this is the shared infrastructure a caller reconstructing structure from a `LayoutDocument` (a spreadsheet grid, a vector drawing) builds on; `readPdf` never reconstructs a dedicated `'line'`-kind item at all.
- **`writePdf`/`readPdf` round-trip a page's own `notes` field via a hidden annotation, not any real PDF feature.** PDF has no native concept of hidden presenter notes, so a page's `LayoutPage.notes` (when present) is written as a `/Subtype /Text` annotation (the same construct Acrobat's own sticky-note tool uses) with the `Hidden` annotation flag set so it never renders or prints, and `readPdf` reads it back via an internal author marker that distinguishes this package's own notes annotation from a genuine third-party sticky note. This is a round-trip mechanism specific to this package's own writer/reader pair — a PDF produced by anything else will never carry it, and a PDF consumer other than this package's own `readPdf` will never see it as anything but an invisible, empty sticky note. `documents.js` uses this to carry pptx/odp speaker notes through `pptxToPdf`/`pdfToPptx` and `odpToPdf`/`pdfToOdp`.
- **STIX Two Math (the embedded formula font) is a CFF-flavoured OpenType font (an `OTTO` sfnt wrapping a `CFF ` table), not TrueType/glyf** — confirmed by inspecting the vendored font's own sfnt table directory while `math-font.ts` was built. Genuine Type2-charstring glyph subsetting (re-encoding charstrings, rebuilding the CFF `INDEX` structures with a renumbered, minimal glyph set) is a substantially larger undertaking than TrueType glyf/loca subsetting, and is out of scope: the **entire** `CFF ` table is embedded verbatim, unmodified, as a single `/FontFile3` `/Subtype /CIDFontType0C` stream — a real, correct, working embedded font, just not glyph-subsetted. Everything else genuinely IS built from a targeted parse of only what's used: `cmap` resolves exactly the Unicode code points a document's formulas actually reference to glyph IDs, and the emitted `/W` widths array and ToUnicode CMap only ever cover those same glyph IDs, not the font's full ~5,500-glyph repertoire. A CID-keyed composite font built this way needs no `/CIDToGIDMap` at all (that key exists only for `/CIDFontType2`): per ISO 32000-1 9.7.4.2, a `/CIDFontType0` whose `/FontFile3` is a "bare" (non-CID-keyed) CFF program is read with CID treated as directly indexing the CFF's own `CharStrings` INDEX by glyph order — i.e. CID == GID, exactly the numbering `cmap`-derived glyph IDs already use, so Identity-H text-showing needs no further remapping anywhere in the write path.
- **The OpenType `MATH` table's `MathVariants` subtable (stretchy glyph assembly — building a tall parenthesis or brace from reusable top/middle/bottom/extender pieces) is deliberately not parsed by `math-table.ts`.** A caller asking for a stretchy fence or a stretchy operator wrapping a tall construct gets back the base glyph at its own fixed size, not a dynamically assembled one — a documented, honest omission, not a bug. `MathConstants` (every fraction/radical/script-positioning constant `MathFontMetrics` exposes) and `MathGlyphInfo` (italics correction, top-accent attachment) ARE both genuinely parsed in full.
- **`math-font.ts`'s own token-level metrics (`ascentPerEm`/`descentPerEm`) come from the font's nominal design ascent/descent (`hhea`), not a tight per-glyph ink bounding box.** This package never parses glyph outlines (no `glyf`/CFF charstring geometry extraction anywhere in it), so a caller measuring a token run against these metrics gets one uniform vertical extent regardless of which characters it actually contains — accurate enough for box-model layout (spacing, baseline alignment, page placement) but not pixel-tight around an unusually tall or shallow glyph.

## Fidelity

**Ordinary text in PDF output uses the standard 14 fonts only — no font embedding.** Helvetica/Times-Roman are genuinely metric-compatible substitutes for Arial/Times New Roman, but a modern default like Calibri or Aptos is not, so a caller's own line wrapping and pagination (built against this package's `TextMeasurer`) will drift slightly from what the original authoring application would itself produce. Expect a faithful visual approximation, not a line-identical reproduction.

**The one exception is math-formula rendering (`WritePdfOptions.formulas`): this genuinely embeds a real, hand-parsed font.** Real box-model glyph runs are shown through the embedded STIX Two Math font with genuine per-glyph metrics (advance width, italic correction, top-accent attachment) and font-wide layout constants (axis height, fraction/radical rule thickness and gaps, script shift amounts) parsed directly from that font's own `MATH` table — not approximated or hand-tuned. See [Gotchas](#gotchas-and-quirks) for the exact boundary of what this package's own font parsing does and doesn't cover (the CFF-full-embed simplification, the unparsed `MathVariants` subtable, and the nominal-rather-than-ink vertical metrics).

**`readPdf(writePdf(doc))` is not guaranteed to reproduce `doc` exactly, and `writePdf(readPdf(bytes))` is not guaranteed to reproduce `bytes` exactly — this package makes no round-trip-losslessness claim in either direction.** A PDF page is fundamentally a stream of positioned drawing operators, not a structured document: a filled-and-stroked rectangle, an ellipse, and a plain line all collapse to the same generic `LayoutPath` shape once read back (see the `interpret.ts` gotcha above), and text is recovered as positioned glyph runs with no guarantee the original run boundaries (which characters were grouped into one `Tj` versus several) survive identically. This is a deliberate, permanent contrast with format-preserving codecs like `ooxml.js`'s own `packageCodec`. `pdfCodec` shares `z.codec()`'s *mechanism* (schema-validated both ways) but not that *guarantee* — wrapping this round trip in `z.codec()` validates the shape of what comes out, not its fidelity to what went in.

**Optional real-world corpus.** `test/corpus/` (gitignored, never committed) holds a `pnpm test:corpus` vitest project for manual conformance checking against real PDFs a hand-built fixture can't fully stand in for — a Word "Save as PDF", a PowerPoint "Save as PDF", a Chrome "Print to PDF", a LibreOffice export. It is not part of `pnpm test` and does not gate CI; drop files in locally before a significant parser change.

## Release and publishing

`.github/workflows/ci.yml` runs commitlint, lint, typecheck, the unit suite, and the smoke test on every push and pull request. On a push to `main` where those all pass, `release.config.ts` drives [semantic-release](https://semantic-release.gitbook.io/semantic-release): commit history since the last tag decides the version bump, `CHANGELOG.md` and `package.json` are committed back to `main`, a GitHub Release is cut, and the package publishes to [npmjs.org](https://www.npmjs.com/package/pdf-codec) — via npm's OIDC trusted publishing, so no `NPM_TOKEN` exists anywhere in the pipeline.

Whether that release actually published a new version is detected by diffing `package.json`'s version before and after the release step, not by trusting a third-party action's own detection. Two further jobs gate on that: one republishes the same build under the scoped `@exadev/pdf-codec` alias to GitHub Packages (which has no OIDC exchange of its own, so it authenticates with `GITHUB_TOKEN` instead), and one packs the release into its own directory, generates an SPDX SBOM (`pnpm sbom`), and signs both an SBOM and a build-provenance attestation against that exact tarball — verifiable independently of the registry, and still present if the package is later unpublished.

## Contributing

Commits follow Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, …), enforced by commitlint (`commitlint.config.ts`) via a husky `commit-msg` hook and a CI `commitlint` job — semantic-release's version bump depends on these being well-formed, not just style. A husky `pre-commit` hook runs `lint-staged` (`eslint --fix` on staged `*.ts` files) and `pre-push` runs the test suite (`pnpm build`/`pnpm typecheck`/`pnpm lint`/`pnpm test`/`pnpm test:smoke` are all available directly too). There is a single `main` branch and no open pull request workflow established so far.

## References

- [documents.js](https://github.com/ExaDev/documents.js) — the package this codec was extracted from, and its principal downstream consumer: docx/pptx/odt/odp/ods/odg ⇄ PDF conversion, and MathML formula rendering (its own `src/mathml/` typesetting engine feeds a real `MathBox` into this package's `writePdf({ formulas })` with zero cast — see [Architecture](#architecture)).
- [document-schema.js](https://github.com/ExaDev/document-schema.js) — the sibling package that owns `LayoutDocument` itself (the PDF-side pivot this codec reads into and writes from), and the canonical `ContentDocument` pivot the wider `documents.js`/`odf.js`/`ooxml.js` family shares.
- [STIX Two Math](https://github.com/stipub/stixfonts) — the embedded math font `math-font.ts` parses and `writePdf({ formulas })` renders through, vendored at `assets/fonts/STIXTwoMath-Regular.otf` and embedded into `dist/` as a base64 string (`src/assets/stix-two-math-font.ts`, generated by `scripts/generate-math-font-asset.mjs`) rather than read from disk at runtime. Copyright 2001-2021 The STIX Fonts Project Authors, licensed [OFL-1.1](assets/fonts/OFL.txt) — see `assets/fonts/NOTICE.md` for the exact source commit and version this was vendored from.

## License

MIT
