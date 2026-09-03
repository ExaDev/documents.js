# ppt-codec

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/documents.js/tree/main/packages/ppt-codec) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/ppt-codec) [![npm version](https://img.shields.io/npm/v/ppt-codec)](https://www.npmjs.com/package/ppt-codec) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/documents.js/ci.yml?branch=main)](https://github.com/ExaDev/documents.js/actions)

> A hand-written reader for the PowerPoint 97-2003 binary file format (`.ppt`, [MS-PPT]), producing the same `document-schema.js` presentation content model `ooxml.js`'s pptx support and `odf.js`'s odp support both target. Worker-isomorphic: the same code runs under Node and inside a Cloudflare Workers isolate.

Created for [documents.js#817](https://github.com/ExaDev/documents.js/issues/817), part of the legacy-binary-formats epic [#85](https://github.com/ExaDev/documents.js/issues/85). Nothing in the ecosystem read a pre-2007 PowerPoint file: `ooxml.js` reads the XML-based pptx that replaced it, and the two formats share no structure at all beyond both being containers.

## Status

**Under active development. The read path for slide text and geometry is built and tested; there is no write path.** What that means concretely is set out in [What it reads](#what-it-reads) and [What it does not read yet](#what-it-does-not-read-yet) below — both lists are exhaustive rather than illustrative, so a caller can tell from this page alone whether the format's own feature it cares about is covered.

## Why the format is shaped the way it is

Unlike Word's and Excel's binary formats, whose content is a flat stream of records, a `.ppt` file's content is a **tree** of records, and the tree is not even the whole story:

- The file is an [MS-CFB] compound file, whose `PowerPoint Document` stream holds the records and whose `Current User` stream holds a single atom pointing into it.
- Every record — [MS-PPT]'s own and the [MS-ODRAW] drawing records nested inside it — carries the identical 8-byte header: a 16-bit word packing `recVer` (4 bits) and `recInstance` (12 bits), then `recType` and `recLen`. `recVer == 0xF` marks a container, whose data is more records; anything else marks an atom, whose data is fields. That one distinction is what makes the format a tree rather than a stream, and it is also what lets an unknown record be skipped by seeking `recLen` bytes past its header.
- The stream is **append-only across edits**. Saving a presentation can append a new _user edit_ rather than rewriting the file, so the same stream can hold several generations of the same slide. Which copy is live is decided by the `Current User` stream's `offsetToCurrentEdit`, the `UserEditAtom` chain it starts, and the persist directory those edits build up — a later edit's directory entry supersedes an earlier one's for the same persist identifier. A reader that simply scanned the stream for `RT_Slide` records would find superseded slides and have no way to tell them from live ones.
- Slide **placeholder** text is not stored on the slide. A title or body shape's `OfficeArtClientTextbox` holds an `OutlineTextRefAtom` — an index into the text records the _document's_ slide list carries for that slide. Only a plain text box stores its own text.

## Getting started

Requires Node.js `>=20` and pnpm `11.6.0`.

```sh
pnpm install
pnpm build          # tsdown -> dist/ (ESM + CJS + .d.ts, one file set per src module)
pnpm typecheck      # tsc -p tsconfig.json && tsc -p tsconfig.node.json, then attw --pack
pnpm lint           # eslint . --fix --cache --max-warnings 0
pnpm test           # vitest run --project unit
pnpm test:watch     # vitest --project unit
pnpm test:workers   # vitest run --config vitest.workers.config.ts, inside a real Cloudflare Workers (workerd) isolate
pnpm test:smoke     # builds dist/, then loads the built ESM and CJS barrels and every advertised deep import
```

To run a single test file, pass its path to vitest directly, e.g. `pnpm exec vitest run src/text/style.test.ts`.

## Reading a document

```ts
import { readPpt, readPptContent } from "ppt-codec";

// The tree form: a document-schema.js DocumentTree, the same artefact
// ooxml.js's readPptx and odf.js's readOdp produce for their own formats.
const tree = readPpt(pptBytes);

// The flat form: metadata plus ContentSlide[], matching the shape
// readPptxContent and readOdpContent return.
const { metadata, slides } = readPptContent(pptBytes);
for (const slide of slides) {
  slide.size; // { widthPt, heightPt }
  for (const shape of slide.shapes) {
    shape.frame; // { xPt, yPt, widthPt, heightPt }
    shape.blocks; // ContentParagraph[], each with its own ContentRun[]
  }
}
```

`readPptStreams(currentUserStream, powerPointDocumentStream)` is the same read one level down, for a caller that already holds the two streams — the compound file beneath them is `archive-codec`'s business, and separating the two is what lets every record-level behaviour be tested without a container around it.

## What it reads

The whole path from a file's first byte to a slide's text, record by record:

| Layer           | Records                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container       | The `Current User` and `PowerPoint Document` streams, read through `archive-codec`'s bounded [MS-CFB] reader.                                                                                                                                                                                                                                                                                                                                            |
| Record framing  | The generic 8-byte `RecordHeader`, the container/atom distinction, sibling sequences, child walks, and typed-descendant search — shared with [MS-ODRAW]'s records, which carry the identical header.                                                                                                                                                                                                                                                     |
| Edit resolution | `CurrentUserAtom` (including its encrypted/plaintext `headerToken`), the `UserEditAtom` chain, `PersistDirectoryAtom`/`PersistDirectoryEntry`'s packed 20-bit/12-bit run form, and the oldest-first directory construction whose later entries supersede earlier ones — [MS-PPT] 2.1.2's own "live record" process, Part 1.                                                                                                                              |
| Document        | `DocumentContainer` → `DocumentAtom` (slide size, in master units), `DocumentTextInfoContainer`'s `FontCollectionContainer`/`FontEntityAtom` typeface names, and `SlideListWithTextContainer` (distinguished from the master and notes lists by `recInstance`, which does not run in the order the names suggest).                                                                                                                                       |
| Slides          | `SlidePersistAtom` → the persist directory → each `SlideContainer`, and the placeholder texts the slide list carries for it.                                                                                                                                                                                                                                                                                                                             |
| Drawing         | `DrawingContainer` → `OfficeArtDgContainer` → the `OfficeArtSpgrContainer`/`OfficeArtSpContainer` tree, `OfficeArtFSP`'s group/patriarch/deleted flags, `OfficeArtClientAnchor` in both its 8-byte `SmallRectStruct` and 16-byte `RectStruct` spellings, and `OfficeArtChildAnchor` mapped through nested `OfficeArtFSPGR` group coordinate systems.                                                                                                     |
| Text            | `OfficeArtClientTextbox`, `TextHeaderAtom`, `TextCharsAtom` (UTF-16) and `TextBytesAtom` (one byte per character), `OutlineTextRefAtom` indirection into the slide list, and the paragraph split on the stored `\r`.                                                                                                                                                                                                                                     |
| Formatting      | `StyleTextPropAtom`: `TextPFRun`/`TextPFException` (indent level, alignment) and `TextCFRun`/`TextCFException` (bold, italic, underline, shadow, emboss, typeface reference, size in points, and a `ColorIndexStruct` colour when it is a literal sRGB value), each read in the spec's **declared field order** rather than its mask-bit order — the two differ, and following the mask-bit order desynchronises every field after the first divergence. |

Geometry is converted from master units (1/576 inch) to points on the way out, so a slide's `size` and every shape's `frame` are in the same unit the shared schema uses everywhere else.

## What it does not read yet

Each of these is a real construct of the format that this package currently ignores or cannot represent — not a claim that it does not exist:

- **Writing.** There is no write path at all: this package reads `.ppt` and does not produce it.
- **Encrypted documents.** Recognised and refused by name (`PptEncryptedError`) rather than misparsed, but not decrypted.
- **Speaker notes.** Every slide's `notes` is `""`. Notes live in their own `NotesContainer` persist objects reached through the document's notes list, which is not yet walked.
- **Document metadata.** `metadata` is always `{}`. Document properties live in the compound file's own `SummaryInformation` stream ([MS-OSHARED]), not in any [MS-PPT] record.
- **Master and layout inheritance.** A run that states no size, typeface, or weight inherits it from the master's `TextMasterStyleAtom`; this reader reports such a property as absent rather than resolving the cascade, so a run's formatting is what the slide itself states and no more.
- **Scheme colours.** A `ColorIndexStruct` naming a colour-scheme slot (rather than a literal sRGB value) yields no colour, because resolving it needs the slide's `SlideSchemeColorSchemeAtom`.
- **Per-shape text insets.** Every shape reports PowerPoint's own defaults (0.1 inch left and right, 0.05 inch top and bottom); a per-shape override lives in the shape's `OfficeArtFOPT` property table, which is not read.
- **Images, tables, and OLE embeddings.** A picture shape, a table object, and an embedded or linked OLE object all read as a shape with geometry and no blocks. `ExObjListContainer` and the `ExOleObjStg` persist objects are not walked.
- **Shapes with no anchor.** A shape carrying neither an `OfficeArtClientAnchor` nor an `OfficeArtChildAnchor` is dropped, because `ContentShape` has no way to say "positioned, but unknown where".
- **Hyperlinks, bullets, spacing and margins.** `InteractiveInfo`/`TextInteractiveInfoAtom`, `TextPFException`'s bullet fields, and its `lineSpacing`/`spaceBefore`/`spaceAfter`/`leftMargin`/`indent` are parsed past correctly but not surfaced.
- **Animations, transitions, comments, headers and footers, and the metacharacter atoms** (slide number, date, header, footer).
- **Alignment values the shared schema has no name for.** `Tx_ALIGNDistributed`, `Tx_ALIGNThaiDistributed` and `Tx_ALIGNJustifyLow` map to no alignment rather than being rounded to `justify`.
- **The soft line break.** U+000B inside a paragraph is converted to a newline, an inference from the spec's own worked examples rather than a rule it states; the specification publishes no table of the special characters a text body may hold.

## Architecture

Every module is importable by package-relative path as well as through the barrel — `tsdown` builds one dist file per src module (`root: 'src'`, the layout every sibling codec ships), and `package.json`'s `./*` exports wildcard maps each subpath onto it:

```ts
import { readRecordAt } from "ppt-codec/record/tree";
import { readStyleTextPropAtom } from "ppt-codec/text/style";
```

| Module                   | What it owns                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `record/header`          | The generic 8-byte record header and the container/atom distinction.                                                 |
| `record/types`           | The `RecordType` values this reader dispatches on, plus the [MS-ODRAW] types the drawing walk crosses into.          |
| `record/tree`            | Offset-addressed records, sibling sequences, child walks, typed-descendant search.                                   |
| `stream/current-user`    | `CurrentUserAtom`: where the live edit is, and whether the file is encrypted.                                        |
| `stream/persist`         | `UserEditAtom`, `PersistDirectoryAtom`, and the persist directory the edit chain builds.                             |
| `document/document-atom` | `DocumentAtom`: slide and notes sizes, master persist references.                                                    |
| `document/fonts`         | The font collection, resolved to typeface names a `FontIndexRef` indexes.                                            |
| `document/slide-list`    | `SlideListWithTextContainer`: each slide's persist reference and its placeholder texts.                              |
| `drawing/shapes`         | The OfficeArt shape tree, flattened, with every anchor resolved into slide coordinates through its enclosing groups. |
| `text/atoms`             | The two text-body spellings, the text-type enumeration, and the paragraph split.                                     |
| `text/style`             | `StyleTextPropAtom`'s two run arrays and their mask-driven exception structures.                                     |
| `content`                | The mapping of PowerPoint's character-counted runs onto the schema's paragraph-owned runs.                           |
| `read`                   | The whole pipeline, and the `readPpt`/`readPptContent`/`readPptStreams` surface.                                     |
| `units`                  | Master units to points.                                                                                              |
| `errors`                 | `PptFormatError` for malformed input, `PptEncryptedError` for well-formed input this package cannot decrypt.         |

### Every fixture is built from the specification, not captured

There is no `.ppt` file anywhere in this package's tests. Every fixture is assembled byte by byte from [MS-PPT]'s own field-layout tables, through the builders in `src/test-support/` — including a whole synthetic presentation and a minimal [MS-CFB] writer, so the end-to-end suite exercises the real offset arithmetic (the persist directory, the edit chain, every cross-stream reference) rather than a stubbed one. That is deliberate: a fixture built from the spec's field tables states what the parser is being held to, whereas a captured file would only state what one producer happened to emit, and could not be reduced to the single record under test.

### What it deliberately does not depend on

The [MS-CFB] container beneath the format is the one piece not hand-written again: `archive-codec` already owns bounded compound-file reading for the family, and a second implementation here would be exactly the duplication that package's extraction exists to prevent. Everything above it — the record tree, the persist layer, the OfficeArt walk, the text and formatting model — is hand-written against the published specification, the same bet every sibling codec here makes against a heavyweight format library.

## Conventions

- Worker-isomorphic (see the [family-wide convention](../../README.md#conventions)): runtime `src/` must not import `node:*`, a bare Node builtin, or use the `Buffer` global — enforced by a `no-restricted-imports`/`no-restricted-globals` ESLint rule and exercised in CI by running a suite inside an actual `workerd` isolate (`pnpm test:workers`). Test files under `src/**/*.test.ts` and `src/test-support/` are exempt and may use Node APIs for fixtures.
- Only `src/index.ts` may be named `index.*` — a custom ESLint rule (`local/no-non-barrel-index`) rejects any other module using an `index` basename, since that would be a hidden entry point the `exports` map in `package.json` doesn't advertise.
- Every structural failure throws `PptFormatError` rather than degrading: a malformed file fails whole, never returning a partial slide list that looks complete.

## Specification references

Every field layout in this package is taken from a specification page, cited in the source at the point it is used. The load-bearing ones:

- [[MS-PPT]: PowerPoint (.ppt) Binary File Format](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/6be79dde-33c1-4c1b-8ccc-4b2301c08662)
- [[MS-PPT] 2.1.2: PowerPoint Document Stream](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/1fc22d56-28f9-4818-bd45-67c2bf721ccf) — the "live record" process this reader implements
- [[MS-PPT] 2.3.1: RecordHeader](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/df201194-0cd0-4dfb-bf10-eea353d8eabc)
- [[MS-PPT] 2.3.2: CurrentUserAtom](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/940d5700-e4d7-4fc0-ab48-fed5dbc48bc1)
- [[MS-PPT] 2.3.3: UserEditAtom](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/3ffb3fab-95de-4873-98aa-d508fbbac981) and [2.3.5: PersistDirectoryEntry](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/6214b5a6-7ca2-4a86-8a0e-5fd3d3eff1c9)
- [[MS-PPT] 2.4.1: DocumentContainer](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/6254c4d1-5217-4e16-b20d-c04ddcce31c9) and [2.4.2: DocumentAtom](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/121f2728-3497-4a0a-829e-6f416fee2ee6)
- [[MS-PPT] 2.4.14.3: SlideListWithTextContainer](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/307e6d12-7304-47a8-acbd-3e7b8041ad3c) and [2.4.14.5: SlidePersistAtom](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/48dce412-9692-4f93-aeb7-3d9fdd3a0a5a)
- [[MS-PPT] 2.5.1: SlideContainer](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/4cac0976-73d0-4ab3-a70b-e98b3cf1c312) and [2.5.13: DrawingContainer](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/0595b49f-da96-4402-b353-1f766e9d548f)
- [[MS-PPT] 2.7.1: OfficeArtClientAnchor](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/37ee18c7-3c7c-4adc-91fb-cb3b01789d72), [SmallRectStruct](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/e47cb973-8480-4995-90b2-008bcb2ffc65), [RectStruct](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/8a58e3ae-2682-42d0-82cd-a41c2999584e)
- [[MS-PPT] 2.9.76: OfficeArtClientTextbox](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/f50070dd-a4dc-4edd-a446-c4fcc5c80ace), [TextHeaderAtom](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/08d31a66-0750-4009-b416-49f2871cd178), [TextCharsAtom](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/a3c5c8d5-e530-4167-a242-7743bc99aeac), [TextBytesAtom](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/80aae34b-2699-43fa-9e6a-c560ae790cd7)
- [[MS-PPT]: StyleTextPropAtom](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/a9a5fa71-238d-491e-acc7-fa1fffd5f100), [TextPFException](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/c15a13b3-db2c-4b50-a7e6-08045581a663), [PFMasks](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/2a02831a-088b-44e7-84c9-c185ab314a71), [TextCFException](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/c75024a2-14cb-4d7d-9964-bdab2fcd9d93), [CFMasks](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/bbca8581-d011-4293-a375-b209523cf962), [CFStyle](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/3ea010b9-0ef9-4c05-9982-618130ca66cd), [ColorIndexStruct](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/5d6b0509-f3c7-435f-9bf4-6f1fc5f8293c)
- [[MS-ODRAW]: Office Drawing Binary File Format](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/8560795e-7759-4745-838f-f7f2ef2f1872) — [OfficeArtSpContainer](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/16194cb9-b4b0-476c-9678-a6ac1f06b034), [OfficeArtFSP](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/8a7e7be3-0582-4461-9400-29d7eda8497d), [OfficeArtFSPGR](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/82d2d6a1-3a7a-4d15-9803-33145a76545a), [OfficeArtChildAnchor](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/33a44593-02df-4684-ab35-5a7c4a9bcaac)
- [[MS-CFB]: Compound File Binary File Format](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/53989ce4-7b05-4f8d-829b-d08d6148375b) — the container, read through `archive-codec`

## Install

```sh
pnpm add ppt-codec
# or
npm install ppt-codec
```

## Release and publishing

Release, CI, and commit-message conventions are all workspace-wide, not package-local — see the [monorepo root README](../../README.md#releases) for the mechanism.

## Contributing

Conventional Commits, enforced workspace-wide by commitlint through a root `commit-msg` hook. Work inside `packages/ppt-codec/`; see [CONTRIBUTING.md](../../CONTRIBUTING.md) for the shared git hooks and history conventions.

## License

MIT
