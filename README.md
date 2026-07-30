# documents.js

> Bidirectional docx/pptx ⇄ PDF conversion and a read+write editable OOXML document model, built on [ooxml.js](https://github.com/ExaDev/ooxml.js) and Zod 4 codecs.

`documents.js` depends on `ooxml.js` for lossless docx/pptx/xlsx ⇄ JSON handling and extends it in two directions `ooxml.js` deliberately does not cover: full PDF support, and a read-**and-write** manipulation API for docx/pptx content (`ooxml.js`'s own typed readers are one-way and explicitly forbid write-back). PDF reading, writing, and the docx⇄pdf/pptx⇄pdf conversion codecs are entirely hand-written — no external PDF library is a dependency.

**Status: early bootstrap.** This repository currently contains only project scaffolding; the source tree, tooling, and package have not been built yet.

## Getting started

Requires Node.js `>=20` and pnpm `11.6.0` (pinned via `packageManager` in `package.json`, once it exists).

```sh
pnpm install
```

Install as a dependency in another project:

```sh
pnpm add documents.js
# or
npm install documents.js
```

## Build, test, and lint

Once the tooling scaffold lands, the scripts mirror `ooxml.js` exactly:

```sh
pnpm build         # tsdown -> dist/ (ESM + CJS + .d.ts)
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint . --max-warnings 0
pnpm test          # vitest run --project unit
pnpm test:watch    # vitest --project unit
pnpm test:smoke    # rebuilds dist/, then verifies ESM/CJS parity
pnpm test:corpus   # optional real-world PDF conformance checks against a local, gitignored test/corpus/
```

To run a single test file: `pnpm vitest run src/path/to/file.test.ts`.

## Architecture

The package is layered from a lossless OOXML core (delegated entirely to `ooxml.js`) outward to conversion and editing:

- **`src/model/`** — Zod schemas only: unit conversions (EMU/twip/point/half-point), geometry, color, and the two pivot models — `LayoutDocument` (the PDF-side pivot: pages of positioned text/image/rect/line/ellipse/link items, PDF-native coordinates) and `ContentDocument` (the semantic pivot: a discriminated union of `wordprocessing` and `presentation` variants sharing paragraph/run/table/image building blocks).
- **`src/bytes/`** and **`src/image/`** — generic byte and image-container primitives (PNG decode/encode, JPEG marker scanning) with zero PDF or OOXML knowledge. `src/bytes/flate.ts` is the only file that imports `fflate`, mirroring how `ooxml.js`'s own `src/zip.ts` wraps `fflate` for ZIP handling.
- **`src/xml/`** and **`src/opc/`** — parent-aware XML query/mutation and OPC package mechanics (relationships, content types, media parts) built over `ooxml.js`'s `Package`/`XmlNode`.
- **`src/edit/`** — the read+write editable model: live-view wrappers over the actual `XmlElement` objects inside a decoded `Package`, so mutations edit the tree in place and untouched content stays byte-faithful on save. This is the novel piece beyond what `ooxml.js` itself provides.
- **`src/pdf/`** — a fully hand-written PDF codec: object model, writer (content-stream generation, standard-14 font metrics, xref table), and reader (tokenizer, cross-reference/object-stream resolution, content-stream interpreter, font/Unicode recovery). No external PDF library.
- **`src/ooxml/`** — resolves a `Package` into a `ContentDocument`: the docx style cascade (`basedOn` chains, theme fonts, toggle properties) and the pptx placeholder→layout→master→theme inheritance cascade.
- **`src/layout/`** — the conversion algorithms: `ContentDocument → LayoutDocument` (docx flow/pagination; pptx direct EMU-to-point placement) and the reverse (`LayoutDocument → ContentDocument`, via line/paragraph/shape clustering).
- **`src/convert/`** — the `DocumentConverter` port/contract and its local adapter, plus the `docxPdfCodec`/`pptxPdfCodec` Zod codecs and ergonomic `docxToPdf`/`pdfToDocx`/`pptxToPdf`/`pdfToPptx` wrappers.

## Conventions

- **Zod-first schema/type/guard**, matching `ooxml.js`: every model type is inferred from its Zod schema, never hand-written. Recursive types (`ContentBlock`, mirroring `ooxml.js`'s `XmlNode`) use a hand-written structural guard + `z.custom`, not `z.lazy`.
- **No type assertions.** Every third-party or loosely-typed value (from `fast-xml-parser` via `ooxml.js`) is narrowed through a type guard or a Zod parse at the boundary. `src/pdf/`'s own object model narrows natively on its `kind` discriminant, so it needs no such guard.
- **Dependency direction is strictly downward and checkable**: `model`/`bytes` import nothing local; `image` imports `bytes` only; `pdf` imports `model`+`bytes`+`image` only (no OOXML knowledge); `ooxml/*` imports `xml`/`model` only (no PDF knowledge); `layout` imports `model` only (pure, no I/O); `convert` composes everything else. No `PdfObject`/`PdfDict`/`PdfStream` type may appear outside `src/pdf/`.
- **Conventional commits**, enforced via commitlint + husky, matching `ooxml.js`.

## Gotchas and quirks

- **`ooxml.js`'s typed readers (`readDocx`/`readPptx`) are not used as a basis for conversion.** They flatten body content with a recursive-descendant search (destroying document order for paragraphs inside tables) and carry no font/size/color/geometry data. `documents.js` walks `word/document.xml`/`ppt/slides/slideN.xml` directly.
- **The docx⇄pdf and pptx⇄pdf conversion codecs are explicitly not round-trip-lossless** — in deliberate contrast to `ooxml.js`'s own `packageCodec`, which is. A `z.codec()` here means a validated, named pair of format-*converting* transforms, not a lossless round-trip guarantee.
- **PDF output uses standard-14 fonts only (no embedding).** Helvetica/Times-Roman are metric-compatible substitutes for Arial/Times New Roman, but Word's actual default fonts (Calibri, Aptos) are not — expect a faithful visual approximation, not a line-identical reproduction of Word/PowerPoint's own rendering.
- **Reading arbitrary real-world PDFs is the hardest part of this package.** The hand-written parser targets cleanly-generated output from mainstream producers (Word, PowerPoint, Chrome, LibreOffice, Acrobat) and fails loudly and specifically on adversarial or badly malformed files, rather than matching a mature library's robustness.
- **Encrypted PDFs are unsupported** (`/Encrypt` present → throws), including the common empty-user-password case.
- **JPEG images pass through losslessly** (embedded/extracted via PDF's `DCTDecode` filter with no decode/re-encode); PNG-sourced images go through a real, narrowly-scoped hand-written codec.

## References

- [ooxml.js](https://github.com/ExaDev/ooxml.js) — the sibling package this depends on for all docx/pptx/xlsx ⇄ JSON handling.

## License

MIT
