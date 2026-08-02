# markdown-codec

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/markdown-codec)

> Hand-written CommonMark+GFM ⇄ `ContentDocument` codec, built on [document-schema.js](https://github.com/ExaDev/document-schema.js).

`markdown-codec` is a sibling of [`pdf-codec`](https://github.com/ExaDev/pdf-codec): the same "hand-write the format instead of wrapping a third-party library" bet, aimed at CommonMark and its GitHub Flavored Markdown (GFM) extensions rather than PDF. No `micromark`/`remark`/`marked`/`markdown-it`/`commonmark`/`mdast`/`unified`/`turndown`/`showdown` dependency anywhere in this package — see `eslint.config.ts`'s `no-restricted-imports` rule, which bans importing any of them by name. `readMarkdown`/`writeMarkdown` read and write `document-schema.js`'s shared `ContentDocument` pivot directly, the same pivot [`documents.js`](https://github.com/ExaDev/documents.js) already builds docx/pptx/odt/odp conversions around, so a caller can bridge markdown to any other format that pivot already supports without this package knowing anything about docx, PDF, or ODF.

## Status

The parser is complete and passes **every example in the vendored CommonMark 0.31.2 conformance corpus** (`assets/commonmark/spec.json`, all sections), plus every `table`, `strikethrough`, `autolink`, and task-list-item example the GFM spec source tags as an extension (see `src/gfm-conformance.test.ts`'s own top-of-file note on why `disabled` — the literal tag this pinned spec version's two task-list examples carry — is exercised here rather than skipped). `tagfilter` is the one tagged extension deliberately out of scope: an output-sanitisation pass over already-parsed raw HTML, not a parsing rule, and this package's read side has no HTML output to sanitise.

`src/scan/`, `src/block/`, `src/inline/`, `src/html/` (including `src/html/render.ts`, the CommonMark-HTML conformance oracle both suites above render through — internal plumbing, never exported from `src/index.ts`), `src/lower/` (the AST → `ContentDocument` lowering stage), and `src/emit/` (its structural inverse) are all real implementations, exercised by `lowerMarkdown`/`emitMarkdown`. `src/read.ts`/`src/write.ts`/`src/codec.ts` — the public `readMarkdown`/`writeMarkdown`/`markdownCodec` entry points — are still placeholders: front matter extraction, block parsing, and lowering are already composed in one call by `src/lower/lower.ts`'s own `lowerMarkdown`, so wiring `readMarkdown` itself is a thin follow-on, not a rewrite. Tooling (build, lint, typecheck, CI, release) is fully wired.

The conformance suites live at `src/conformance.test.ts` and `src/gfm-conformance.test.ts`, and run as part of `pnpm test`. Any example not yet passing would be named individually in `src/test-support/conformance-exclusions.ts`, which a test asserts is shrink-only: every excluded example must genuinely still fail, so the list can never hide one that already passes. It is currently empty.

Every construct-mapping gap the AST ⇄ `ContentDocument` lowering/emission pair cannot represent losslessly is recorded as a stable, namespaced `MarkdownDiagnosticCodes` entry (`src/diagnostics/diagnostics.ts`) and proven reachable from real input by `src/diagnostics/diagnostics.test.ts`'s own coverage sweep — see `src/lower/lower.ts` and `src/emit/emit.ts`'s own top-of-file tables for the read/write side each code belongs to.

## Getting started

Requires Node.js `>=20` and pnpm `11.6.0` (pinned via `packageManager` in `package.json`).

```sh
pnpm install
```

## Usage

The read and write halves, ahead of `src/read.ts`/`src/write.ts` themselves wiring up `readMarkdown`/`writeMarkdown`:

```ts
import { lowerMarkdown } from 'markdown-codec/lower/lower';
import { emitMarkdown } from 'markdown-codec/emit/emit';

const document = lowerMarkdown('# Title\n\nSome **bold** text with a [link](https://example.com).', {
  frontMatter: true, // parse a leading YAML front matter block into ContentDocument.metadata
  images: (destination) => undefined, // a synchronous MarkdownImageResolver port for non-data: URI images
});

const markdown = emitMarkdown(document, {
  bulletListMarker: '-',
  emphasisMarker: '_',
  frontMatter: true, // emit ContentDocument.metadata back out as a leading front matter block
});
```

Every construct either side cannot represent losslessly reports through an optional `sink: MarkdownDiagnosticSink` — see [Status](#status) for where each gap's own code is documented.

## Architecture

Modelled on `pdf-codec`'s own layering (generic primitives outward to the two conversion directions), aimed at CommonMark+GFM instead of PDF:

- **`src/diagnostics/`** — the read-side diagnostic sink, matching `pdf-codec`'s own three-tier `PdfDiagnosticSink` policy (throw for unreadable input, recover-with-diagnostic for malformed-but-salvageable markdown, degrade-with-diagnostic for an individual unsupported construct while the rest of the document still reads). `MarkdownDiagnosticCodes` names every code either tier can produce, block/inline-phase recover-tier codes alongside src/lower's and src/emit's own degrade-tier construct-mapping gaps.
- **`src/ast/`** — this package's own markdown AST node types (document/block/inline discriminated union), Zod-first like every other model in this family: every node type inferred from its schema, never hand-written.
- **`src/options/`** / **`src/defaults/`** — `readMarkdown`/`writeMarkdown`'s own options (GFM extension toggles, a diagnostic sink, an `AbortSignal`, `writeMarkdown`'s own style choices — heading/bullet/ordered-delimiter/emphasis/code-fence/thematic-break characters, line ending, front matter emission) and their default values.
- **`src/scan/`** — the hand-written CommonMark line/character scanner feeding block parsing, cross-checked against `assets/commonmark/spec.json`.
- **`src/block/`** — CommonMark's block-structure algorithm (open-block stack, continuation-line matching): paragraphs, headings, code blocks, block quotes, lists (including GFM task-list-item markers), thematic breaks, link reference definitions, GFM tables.
- **`src/inline/`** — inline-level parsing within a block's own content: emphasis, code spans, links, autolinks, raw inline HTML, GFM strikethrough, line breaks.
- **`src/html/`** — raw block/inline HTML recognition (CommonMark's own bounded seven-condition block-HTML rules and inline tag syntax — not a general HTML parser) plus `render.ts`, the real CommonMark-HTML conformance oracle `src/conformance.test.ts`/`src/gfm-conformance.test.ts` render parsed documents through — internal plumbing, never re-exported from `src/index.ts`.
- **`src/image/`** — a hand-written PNG/JPEG dimension reader plus an isomorphic base64 codec, shared by `src/lower/image.ts`'s data: URI decoding and `src/emit/image.ts`'s re-encoding.
- **`src/shared/`** — string-shape conventions `src/lower` (mint/read) and `src/emit` (read/write) must agree on exactly: `style-constants.ts` (heading/quote/code-block/rule/HTML-preformatted styleIds, the monospace font family, the blockquote per-level indent unit, the GFM task-checkbox glyph pair) and `list-id.ts` (the opaque `numId` grammar a list's own type/task/tightness is packed into, since `ContentListMembership` itself carries only `{numId, level}`).
- **`src/lower/`** — the AST → `ContentDocument` lowering stage: the markdown-side counterpart to `ooxml.js`'s `readDocx`/`readPptx` and `odf.js`'s `readOdt`/`readOdp` — a thin adapter from a format-specific parse result onto the shared pivot, not a second parser. `lower.ts`'s own top-of-file table maps every construct (headings, emphasis/links/breaks via `inline.ts`, code blocks, blockquotes, lists via `src/shared/list-id.ts`, GFM tables via `table.ts`, images via `image.ts`'s `MarkdownImageResolver` port, raw HTML, front matter via `front-matter.ts`) onto its own `MarkdownDiagnosticCodes` gap.
- **`src/emit/`** — the `ContentDocument` → markdown text emission stage (`writeMarkdown`'s build-side half), the structural inverse of `src/lower/` construct for construct — `emit.ts`'s own top-of-file table mirrors `lower.ts`'s.
- **`src/read.ts`** / **`src/write.ts`** / **`src/codec.ts`** — the public `readMarkdown`/`writeMarkdown` entry points and their `z.codec()` pair (`markdownCodec`), matching `pdf-codec`'s own `pdfCodec` convention. Not yet implemented; `src/lower/lower.ts`'s own `lowerMarkdown`/`src/emit/emit.ts`'s own `emitMarkdown` already do the real work these will wrap.

See `src/read.ts`'s own top-of-file comment for the recorded reconciliation decision on `ContentDocument` shape (full envelope vs. bare `{metadata, sections}`), reasoned from `ooxml.js`'s `readXlsxContent`/`buildXlsxPackage` precedent.

## Vendored assets

`assets/` holds real, unmodified conformance corpora fetched directly from their canonical sources, each with its own `NOTICE.md` recording the exact source URL, commit/version, and confirmed licence:

- **`assets/commonmark/`** — the official CommonMark spec (`spec.txt`) and its machine-readable conformance test corpus (`spec.json`), from the `commonmark/commonmark-spec` project (CC-BY-SA 4.0).
- **`assets/gfm/`** — the official GitHub Flavored Markdown Spec (`spec.txt`), from `github/cmark-gfm` (CC-BY-SA 4.0).
- **`assets/html-entities/`** — the WHATWG HTML5 named character reference table (`entities.json`), from the WHATWG HTML Standard (BSD 3-Clause, per the WHATWG's own "incorporated into source code" licence clause).

## Build, test, and lint

```sh
pnpm build         # tsdown -> dist/ (ESM + CJS + .d.ts)
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint . --max-warnings 0
pnpm test          # vitest run --project unit
pnpm test:watch    # vitest --project unit
pnpm test:smoke    # rebuilds dist/, then verifies ESM/CJS parity from the built CJS bundle
```

To run a single test file: `pnpm vitest run src/path/to/file.test.ts`.

## Conventions

- **Zod-first schema/type/guard**, matching `pdf-codec`/`documents.js`: every model type is inferred from its Zod schema, never hand-written.
- **No type assertions anywhere.** Every loosely-typed value is narrowed through a type guard or a Zod parse at the boundary.
- **No markdown-parsing library dependency**, enforced by an eslint `no-restricted-imports` rule naming every mainstream alternative — this package hand-writes its own scanner, block parser, and inline parser against the CommonMark/GFM specs directly.
- **Conventional commits**, enforced via commitlint + husky, matching the rest of this family.

## Release and publishing

`.github/workflows/ci.yml` runs commitlint, lint, typecheck, the unit suite, and the smoke test on every push and pull request. On a push to `main` where those all pass, `release.config.ts` drives [semantic-release](https://semantic-release.gitbook.io/semantic-release): commit history since the last tag decides the version bump, `CHANGELOG.md` and `package.json` are committed back to `main`, a GitHub Release is cut, and the package publishes to [npmjs.org](https://www.npmjs.com/package/markdown-codec) via npm's OIDC trusted publishing, so no `NPM_TOKEN` exists anywhere in the pipeline.

Two further jobs then run: one republishes the same build under the scoped `@exadev/markdown-codec` alias to GitHub Packages (authenticated with `GITHUB_TOKEN`, since GitHub Packages has no OIDC exchange of its own), and one republishes under the `mrkdwn.js` alias to npmjs.org, matching `pdf-codec`'s own `pdf-codec.js`/`pdf-parser.js` alias convention. A final job packs the release, generates an SPDX SBOM, and signs both an SBOM and a build-provenance attestation against that exact tarball.

## Contributing

Commits follow Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, …), enforced by commitlint (`commitlint.config.ts`) via a husky `commit-msg` hook and a CI `commitlint` job — semantic-release's version bump depends on these being well-formed, not just style. A husky `pre-commit` hook runs `lint-staged` (`eslint --fix` on staged `*.ts` files) and `pre-push` runs the test suite. There is a single `main` branch and no open pull request workflow established so far.

## References

- [document-schema.js](https://github.com/ExaDev/document-schema.js) — the sibling package that owns the shared `ContentDocument` pivot this package reads and writes.
- [pdf-codec](https://github.com/ExaDev/pdf-codec) — the sibling package this project's own scaffold, tooling, and "hand-write the format" philosophy are modelled on.
- [documents.js](https://github.com/ExaDev/documents.js) — the consumer package that will bridge markdown to docx/pptx/odt/odp/PDF via this package's `ContentDocument` output, the same way it already bridges odt⇄docx and odp⇄pptx.
- [CommonMark Spec](https://spec.commonmark.org/) — the base specification this package's scanner/block/inline parsers target.
- [GitHub Flavored Markdown Spec](https://github.github.com/gfm/) — the GFM extensions layered on top of CommonMark.
- [WHATWG HTML Standard § named character references](https://html.spec.whatwg.org/multipage/named-characters.html) — the entity table `assets/html-entities/` vendors.

## License

MIT
