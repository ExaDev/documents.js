# wpd-codec

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/documents.js/tree/main/packages/wpd-codec) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/wpd-codec) [![npm version](https://img.shields.io/npm/v/wpd-codec)](https://www.npmjs.com/package/wpd-codec) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/documents.js/ci.yml?branch=main)](https://github.com/ExaDev/documents.js/actions)

> Hand-written, read-only WordPerfect 6.x-X6 (`.wpd`) reading into `document-schema.js`'s `ContentDocument`, from Corel's own published File Format SDK — part of the [documents.js family](../../README.md). Worker-isomorphic: the same code runs under Node and inside a Cloudflare Workers isolate.

**Status: under active development.** The read path below is tested against the specification's own worked examples, against hand-built fixtures derived from its field tables, and — since the corpus check described in [Evidence](#evidence) — against 93 real WordPerfect documents, 90 of which read and 3 of which are refused correctly. See [Remaining scope](#remaining-scope) for what is deliberately not handled yet.

Created for [documents.js#819](https://github.com/ExaDev/documents.js/issues/819). The premise that made the issue worth acting on is that WordPerfect is not a reverse-engineered format: Corel shipped a File Format SDK as a supported developer product, and one specification covers the entire modern lineage — its own document-structure page states outright that "Files created in WordPerfect 6.x, through X6 are structured the same", so 1993 through 2012 is one format, not a family of them. There is also no JavaScript or TypeScript reader for it at all: [libwpd](https://libwpd.sourceforge.net/) is LGPL C++, WP_Reader is C#, and the SDK's own surviving mirror ships an Ada implementation.

## Sources

Everything this package does is derived from the vendor's own documentation, and every non-obvious decision in the source cites the page it comes from.

| Source                                                                                                                                                                                                                                                      | What it gives                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [WordPerfect File Format SDK help](https://github.com/OneWingedShark/WordPerfect/tree/master/doc/SDK_Help/FileFormats)                                                                                                                                      | The specification itself, mirrored in full: document structure, the prefix packet catalogue, single-byte characters and functions, every variable-length function group, the fixed-length functions, and table formulas. |
| [WPFF Document Structure](https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_DocumentStructure.htm)                                                                                                                    | The file header, the index and packet data areas, the function-code stream's shape, the units glossary, and a complete annotated hex dump of a conforming generic prefix.                                                |
| [WPFF Single-Byte Characters and Functions](https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_SingleByte.htm)                                                                                                         | The character model and the eighty single-byte function codes.                                                                                                                                                           |
| [WPFF D0 EOL Functions](https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_D0-EOL.htm)                                                                                                                                 | The End-of-Line group and, crucially, its "Conversion/Search mappings" column — the specification stating what a converting application should turn each break code into.                                                |
| [WPFF Fixed-Length Multi-Byte Functions](https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_xFixedLength.htm)                                                                                                          | Attribute On/Off, the Extended Character function, and the size of every fixed-length code.                                                                                                                              |
| [WPFF D3 Paragraph](https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_D3-Paragraph.htm) and [D4 Character](https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_D4-Character.htm)  | Justification, font face and size changes, colour, and the rest of the paragraph- and character-oriented functions.                                                                                                      |
| [WPFF D1 Page](https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_D1-Page.htm) and [D2 Column](https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_D2-Column.htm)                  | Page geometry: the Form function's own page size, and the four margin functions split across the two groups.                                                                                                             |
| [WPFF DD Style](https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_DD-Style.htm) and [DA Display Number](https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_DA-DisplayNumber.htm) | The system style number enumeration this package's heading and outline-level recovery rests on, and the paragraph-number display pair.                                                                                   |
| [WPFF E0 Tab](https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_E0-Tab.htm)                                                                                                                                           | The tab definition bitfield, which this group carries in place of a subfunction number.                                                                                                                                  |
| [WPFF prefix packet catalogue](https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_PrefixPkt0-32.htm)                                                                                                                   | The packet types, including the font typeface descriptor layout this package reads a run's font family out of, and the Extended Document Summary the document's own metadata comes from.                                 |
| [Corel's File Format SDK product page](https://web.archive.org/web/20120125025312/http://apps.corel.com/partners_developers/csp/wordperfect_fileformatsdk.htm)                                                                                              | The provenance: a supported Corel developer product documenting "the entire document format, document prefix and document codes".                                                                                        |

## Getting started

Requires Node.js `>=20` and pnpm `11.6.0`.

```sh
pnpm install
pnpm build          # tsdown -> dist/ (ESM + CJS + .d.ts, one file set per src module)
pnpm typecheck      # tsc -p tsconfig.json && tsc -p tsconfig.node.json, plus attw --pack
pnpm lint           # eslint . --fix --cache --max-warnings 0
pnpm test           # vitest run --project unit
pnpm test:watch     # vitest --project unit
pnpm test:workers   # vitest run --config vitest.workers.config.ts, inside a real Cloudflare Workers (workerd) isolate
pnpm test:smoke     # builds dist/, then loads the built ESM and CJS barrels and every advertised deep import
```

To run a single test file, pass its path to vitest directly, e.g. `pnpm exec vitest run src/stream/tokenise.test.ts`.

## Usage

```ts
import { readWpdContent } from "wpd-codec";

// Both containers are accepted, decided by inspecting the bytes: a bare
// WordPerfect 6.x file, and a WP7-and-later OLE compound file whose
// PerfectOffice_MAIN stream holds the identical byte stream.
const document = readWpdContent(bytes);
document.sections[0].pageSize; // the document's own form, not an assumed default
document.sections[0].blocks; // paragraphs, tables, page breaks
document.metadata; // from the document's own Extended Document Summary
```

`readWpd` is the same read one level up, returning the tree-form `DocumentTree` every other codec in the family also offers. `wpdContentCodec` states the read half as `document-schema.js`'s own `ContentCodec` port, so a consumer dispatching over formats treats WordPerfect uniformly with the rest.

Anything that would silently lose information is reported through an optional diagnostic sink rather than swallowed:

```ts
readWpdContent(bytes, {
  sink: (diagnostic) => {
    diagnostic.code; // 'wpd/unmapped-character', 'wpd/table-flattened', ...
    diagnostic.message;
  },
});
```

Structural nonconformance is not a diagnostic — it throws. `WpdNotAWordPerfectFileError`, `WpdEncryptedDocumentError`, `WpdUnsupportedVersionError`, and the general `WpdFormatError` are all exported, and all extend the last.

## What it provides

Every module is importable by package-relative path as well as through the barrel — `tsdown` builds one dist file per src module (`root: 'src'`, the layout `archive-codec` and `ooxml.js` also ship), and `package.json`'s `./*` exports wildcard maps each subpath onto it. The smoke suite is the guard on that advertisement: it loads each module below from the built `dist/` in both module systems.

| Module                | Exports                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `read`                | `readWpdContent` (bytes to `ContentDocument`), `readWpd` (bytes to `DocumentTree`), `ReadWpdOptions`                                            |
| `codec`               | `wpdContentCodec` (`ContentCodec`), `WpdBytesSchema`                                                                                            |
| `format`              | `WPD_MEDIA_TYPE`, `WPD_FILE_EXTENSION`                                                                                                          |
| `diagnostics`         | `WpdDiagnostic`, `WpdDiagnosticSink`, `WpdDiagnosticCodes`, `NOOP_WPD_DIAGNOSTIC_SINK`                                                          |
| `errors`              | `WpdFormatError` and its three subclasses                                                                                                       |
| `container/container` | `openWpdDocument` (container, header, packets, and document-area bounds in one), `PERFECT_OFFICE_MAIN_STREAM`, `PERFECT_OFFICE_OBJECTS_STORAGE` |
| `container/header`    | `readFileHeader`, `hasWordPerfectFileId`, `WPD_FILE_ID`, `WPD_PREFIX_HEADER_SIZE`                                                               |
| `container/prefix`    | `readPrefixPackets`, `packetByPrefixId`, `readTypefaceName`, `WPD_INDEX_RECORD_SIZE`, `PACKET_TYPE_DESIRED_FONT_DESCRIPTOR`                     |
| `container/summary`   | `readDocumentSummary` (the Extended Document Summary packet as a `LayoutMetadata`), `PACKET_TYPE_EXTENDED_DOCUMENT_SUMMARY`                     |
| `stream/tokenise`     | `tokeniseDocumentArea` and the four token types                                                                                                 |
| `stream/characters`   | `decodeWpCharacter`, `decodeSingleByteCharacter`, `decodeWordString`, `UNMAPPED_CHARACTER`                                                      |
| `stream/eol`          | `eolMappingForSubfunction`, `subfunctionForSingleByteEol`, `isSingleByteEol`                                                                    |
| `stream/attributes`   | `decodeAttributeByte`, `runAttributesFrom`, `WpdAttribute`                                                                                      |
| `stream/units`        | `pointsFromWpu`, `WPU_PER_INCH`, `POINTS_PER_INCH`                                                                                              |
| `stream/page`         | `readPageForm`, `readMarginPt`, the Page and Column group constants, and the WordPerfect default page                                           |
| `stream/style`        | `styleSemanticsFor`, `readSystemStyleNumber`, the style scope predicates, and the Display Number group's paragraph-number pair                  |
| `stream/table`        | `readEmbeddedSubfunctions`, `readTableColumnWidthPt`, `readRowInformation`, `readCellInformation`, `readCellSpanning`, `readCellFill`           |
| `stream/tab`          | `tabEffectFor`, `TAB_GROUP`, `WpdTabEffect`                                                                                                     |

The container and stream layers are public deliberately, not by accident: a consumer inspecting a WordPerfect file — a migration audit, a forensic tool, a reader for a construct this package does not yet lift into the shared schema — needs the parsed prefix and the raw function stream, not only the document they fold into.

## Architecture

A WordPerfect 6.x-X6 file is a **prefix** followed by a **document area**, optionally wrapped in an OLE compound file. Reading it is three layers, each in its own directory.

**The container** (`src/container/`) resolves the wrapper and the prefix. A 16-byte header gives the offset of the document area, the product/type/version bytes, an encryption word, and the offset of the index area; a 496-byte extended header follows it, of which only the file size is documented. The index area is a run of 14-byte records — the first is the index header, and each of the rest points at one **packet** in the packet data area. A packet holds data referenced many times but not part of the document's content: a font descriptor, a style definition, a comment's text. Functions in the document area name a packet by its **prefix ID**, which is its 1-based position among the index entries, not its packet type.

**The tokeniser** (`src/stream/tokenise.ts`) walks the document area. Bytes at or below 0x7F are characters; above it, four ranges of function codes — single-byte (0x80-0xCF), variable-length multi-byte (0xD0-0xEF, self-describing through a size field), fixed-length multi-byte (0xF0-0xFE, sized by a table), and 0xFF, which cannot appear at all. Every multi-byte function is bracketed by matching begin and end gates, and the variable form repeats its size before the end gate; this package verifies all three redundancies, because they are the format's own integrity check — a stream that has gone out of step fails at the very next function rather than decoding rubbish for the rest of the file.

**The fold** (`src/read.ts`) turns tokens into a `ContentDocument`. Characters accumulate into the current run, an attribute or font change closes that run and opens another, and an end-of-line function closes the paragraph. Nothing recurses and nothing looks ahead, which is what makes a hand-written reader for this format tractable at all. It has exactly one nesting concept, and it is not recursion: while a table definition is open a closed paragraph joins the cell being built rather than the section's own block list, which is as deep as this format's own grid model goes.

### A table is stated in two halves, in two different groups

Neither half is nested inside the other, and knowing that is most of what reading one takes. The **definition** opens with Table Definition (`0xD42A`, "Table On"), is followed by one Table Column function (`0xD42C`) per column, and closes with Define Table End (`0xD42B`) — column widths and gutters, no content. The **content** follows as ordinary document text delimited by End-of-Line codes: subfunction 10 ends a cell, 11 through 16 end a cell and its row, 17 through 19 end the table. That is also why a reader with no table support recovers a table's text in reading order anyway: every boundary is a line break too.

The per-cell facts are not functions of their own. Spanning, justification, background fill and fixed row height ride **inside** the End-of-Line function that ends the cell, as "embedded subfunctions" in its non-deletable data — a layout unique to this group ("This format is unique in that the non-deletable data area also contains deletable data"), so that region opens with a size word for the deletable half and the documented subfunctions sit after it. Each embedded subfunction is gated by its own code the way every multi-byte function is, and the SDK prints a size against each; `src/stream/table.ts` holds that column as a table, because a record whose size the specification does not state cannot be stepped over — the walk stops there and says so rather than guessing a length and decoding the rest as rubbish.

### A heading is a heading because the file says which style it is

WordPerfect states a style's identity twice: as a prefix ID naming the style's own packet, and — for a style the product defines rather than the user — as a **system style number** in the function's own data. The SDK enumerates that number, and its entries include "68 = heading level 1 style" through "75 = heading level 8 style", "52 = level 1 style (indented)" through "67 = level 8 style (not indented)", "31 = list" and "48 = bullets". Those are the whole basis for this package's heading and list recovery: nothing here infers a heading from a short line or a large font.

One detail of the fold exists for this. A style region ends at its own closing code, which in a real document sits **before** the hard return that ends the paragraph — so a paragraph's heading level is captured when its first character arrives, not when it closes, which would find the scope already popped.

### Two containers, one document

WordPerfect 6.x writes the byte stream straight to disk. From WP7 onwards it may be wrapped in an OLE compound file, with the document in a `PerfectOffice_MAIN` stream — but the SDK is explicit that the wrapper is optional even then ("When creating WordPerfect 7/8 documents you do not need to include the OLE Compound Document wrapper"), so the container is decided by inspecting the bytes, never by the file's extension or its version bytes. Both paths produce the identical document, which the test suite asserts directly.

The compound-file half is [`archive-codec`](../archive-codec/README.md)'s bounded [MS-CFB] reader rather than anything written here: sectors, FAT chains, and directory entries are container structure with no document-format knowledge in them, which is exactly that package's charter.

### Byte 0x20 is not a space

The one part of the character model that looks like a bug on first reading, so it is worth stating plainly. The SDK maps byte values 1 through 32 to thirty-two "Default Extended International Characters" — a shorthand for common accented letters — and byte values 33 through 127 to ASCII. Byte 0x20 is therefore the sharp s, not a space. A space is the single-byte Soft Space function 0x80, which the specification describes as "Equivalent of an ASCII 0x20", or the Hard Space function 0x81. Both statements appear twice in the SDK, and the design reason is plain from the function list: WordPerfect must distinguish a justifiable soft space from a hard one, so neither can be a plain text byte. `src/stream/characters.ts` owns the whole mapping in one place.

### Deliberately not depending on libwpd

The only mature reader for this format is [libwpd](https://libwpd.sourceforge.net/), which is LGPL C++ — so binding it would forfeit both this family's MIT licensing and its Worker portability in one step, and it could not run in a browser or a Workers isolate at all. Writing the parser by hand against the vendor's own specification is the same bet `markdown-codec` makes against micromark and `pdf-codec` makes against pdf-lib, and here it is not really a bet: the format is documented at byte level by the company that wrote it. An ESLint rule bans importing any libwpd binding by name rather than leaving the decision to memory.

## Scope

**Read-only, WordPerfect 6.0 through X6.** Two deliberate exclusions, both decided before any code was written:

- **No writer.** WordPerfect File Format is complete enough to write against, but a lossless round-trip through a function-code stream — keeping prefix packet indices, use counts, and the document's own well-formedness invariants consistent — is a much larger job than reading one, and a half-correct writer is worse than no writer given the lossless bar the rest of this family holds to.
- **No WordPerfect 4.2, 5.x, or Macintosh generations.** Those share the file ID but not the structure; they are separate formats with their own vendor documentation, not earlier drafts of this one. A 5.x file reaches `WpdUnsupportedVersionError` on its major version byte rather than being misparsed as a 6.x file.

### What is handled

- Both containers: a bare WordPerfect file, and an OLE compound file's `PerfectOffice_MAIN` stream.
- The file header, with encryption, product type, file type, and major version all checked rather than assumed.
- The index area and packet data area, with prefix IDs resolvable to packets.
- The full document-area token stream: characters, all four function-code ranges, prefix ID references, non-deletable data, and gate/size verification.
- The character model: ASCII, the thirty-two international shorthands, and the Extended Character function for character set 0 and the documented part of set 1.
- Paragraph structure from the End-of-Line group, in both its single-byte and multi-byte spellings, using the specification's own conversion table — hard returns become paragraphs, soft returns become spaces, hard end-of-page becomes a `pageBreak` block.
- Character attributes: bold, italics, underline (plain and double), and strikeout, including the specification's "ignore" bit for a nested duplicate.
- Font family, from the Desired Font Descriptor packet a Font Face Change names; font size, from a Font Size Change; character colour.
- Paragraph justification.
- The Start/End of Text to Skip pair, whose contents the formatter does not display and this reader drops.
- **Page geometry**: the page size from the Form function (0xD111) and all four margins from their own two groups — the vertical pair in the Page group (0xD100/0xD101), the horizontal pair in the Column group (0xD200/0xD201). Each dimension falls back to the WordPerfect default independently, so a document overriding only its top margin keeps US Letter and the other three inches rather than the whole default set.
- **Tables**, as real `ContentTable` grids: column widths from the Table Column functions, cells and rows from the End-of-Line boundaries, and — from the embedded subfunctions riding inside those boundaries — merged cells as `colSpan`/`rowSpan` with the positions they cover dropped, cell background colour, per-cell justification applied to the paragraphs it holds, and fixed row heights.
- **Heading levels and outline list levels**, from the Style group's system style numbers.
- **Outline numbering**, from the Display Number group's Paragraph Number Display pair: the level becomes a list membership and the pair's rendered digits are dropped in favour of it, since a counter's display is generated content rather than typed text.
- **Document metadata**, from the Extended Document Summary prefix packet (type 0x12): the Descriptive Name as the title, plus author, subject, keywords, and the creation and revision dates.
- **Tabs and line-scoped alignment**, from the Tab group (0xE0), whose byte in the subfunction position is the tab definition itself rather than a subfunction number. A type that advances to a tab stop becomes a tab character; centre-on-margins, centre-on-current-position and flush-right instead begin the line-scoped alignment the single-byte End of Center Align functions already terminate.

### Remaining scope

Everything below is recognised by the tokeniser and skipped by the fold, so a document containing it still reads — losing that construct's own structure, never the surrounding text. Each is reported through the diagnostic sink rather than passed over in silence.

- **Boxes and graphics** (the 0xDF group): figures, text boxes, equations, and the WPG graphics they carry. Reported through `wpd/box-dropped`. Two things make this genuinely larger than it looks rather than merely unfinished: which of a box's prefix IDs is its contents, its caption, its border or its fill is not stated positionally but decided by a nested tree of override flags, each of which is itself a mask-plus-data record whose presence depends on the flag above it — so the PID list cannot be read at all without walking that tree correctly, and there is no real file here to walk it against. And a box whose content type is image carries WPG vector graphics, which `ContentImageBlock`'s own `png`/`jpeg` pair cannot hold whatever the walk recovers.
- **Embedded OLE objects**, stored under the compound file's `PerfectOffice_OBJECTS` storage. `archive-codec`'s compound-file reader already reaches that storage, which is how `ooxml.js` recovers a ZIP-payload embedded object — but a WordPerfect OLE object's payload is a native OLE server's own stream rather than a nested document package, so recovering one is a scoping question in its own right rather than a wiring job.
- **Headers, footers, footnotes, and endnotes** (the 0xD6 and 0xD7 groups). Reported through `wpd/header-footer-dropped` and `wpd/note-dropped`. The text is genuinely recoverable — each function names a General WP Text packet (type 0x08) holding its own function-code stream, which this package's tokeniser and fold would read — but the flat `ContentDocument` has no page-furniture position for a header or footer and no note position for a footnote body. That body's real home is `document-schema.js`'s tree-only `definitions` table, which a codec producing the flat form cannot reach; it is the same gap `rtf-codec` documents for its own equivalent constructs, and it closes at the schema boundary rather than here.
- **Styles** (the 0xDD group) beyond their system style numbers: a run's directly-applied attributes are read and a style region's own heading or outline level is recovered, but a style packet's own definitions (type 0x30) are not resolved onto the runs that reference them.
- **The counter groups** (0xD8, 0xD9, 0xDB, 0xDC): setting, numbering-method, increment and decrement carry no text and change no structure this reader models, so only the Display Number group's own paragraph-number pair is read.
- **Merge codes** (the 0xDE group) and **cross-references** (0xD5). A cross-reference's displayed text survives as ordinary text; its target binding does not. Reported through `wpd/merge-code-dropped` and `wpd/cross-reference-flattened`.
- **Table formulas** (`WPFF_TableFormulas`): the New Cell Formula embedded subfunction is walked past by its own length so the cells around it still read, but its tokenised formula is not decoded.
- **Character sets 2 and above**, and the part of set 1 the mirrored SDK pages do not tabulate — the largest remaining fidelity gap, and the one the corpus check measured (see [Evidence](#evidence)): two thirds of the extended characters in real documents name **character set 4** alone, with set 1's untabulated part next, then sets 13, 6, 5, 8, 12 and 3. This is a missing source rather than unfinished work: the mirrored SDK Help states the mechanism — "The high byte is the number of the WordPerfect character set. The low byte contains an offset value into the character set" — and tabulates the thirty-two Default Extended International Characters, but carries no character-set table of its own for any set. It closes when one is transcribed against a citable source, not by inference. An unmapped character renders as U+FFFD and is reported through `wpd/unmapped-character` rather than dropped.
- **Encrypted documents**, which throw: the specification states that nothing beyond the file header is intelligible without the password, so there is no partial read to offer.

## Evidence

Two independent kinds, which answer different questions.

**The specification's own worked examples and field tables** answer "does this match what Corel documented". Every unit test is built either from a worked example — the annotated generic-prefix hex dump, the `can't` extended-character example, the `com<0x83>ment` soft-hyphen example — or from a byte sequence assembled directly from a field table, so each expectation is checkable against the page it cites without a file to hand.

**A real corpus** answers "does what Corel documented match what WordPerfect actually wrote", which the first kind cannot. The check ran against every WordPerfect 6.x-X6 file (file ID `FF 57 50 43`, major version 2) in [libwpd's own oss-fuzz seed corpus](https://sourceforge.net/projects/libwpd/files/corpus/) — 93 files: hand-authored feature tests, real bug-report attachments from the AbiWord, OpenOffice, LibreOffice and freedesktop trackers, and a batch of anonymised real-world documents — alongside the two WordPerfect 6 samples in the [Open Preservation Foundation's format corpus](https://github.com/openpreserve/format-corpus/tree/master/office/wordprocessing/WordPerfect6).

Ninety read. Three are refused, and each refusal is the right answer rather than a failure: a WordPerfect 3 for Macintosh file is rejected on its major-version byte (a separate format that shares the file ID — see Scope), an encrypted document is rejected because nothing past its header is intelligible without the password, and one file's function gates genuinely do not match — an AbiWord bug-report attachment, in a corpus whose whole purpose is to collect files that broke something. That last one is the tokeniser's own design working: it fails at the first byte the format says cannot be there, naming the offset, rather than decoding rubbish for the rest of the file.

What the corpus settles:

- **The character model is right.** This was the assumption most likely to make every real document read back as nonsense — bytes 1 through 32 are accented-letter shorthands rather than ASCII, so byte `0x20` is the sharp s and a space is the Soft Space function. Real documents read back as correct prose, which they could not do if that were wrong.
- **Page geometry, tables, metadata, and outline numbering are exercised by real files**, not only by fixtures: a quarter of the corpus states a page size other than US Letter, a third contains a table, and a sixth carries a document summary.
- **The heading mapping is not.** No document in the corpus uses WordPerfect's own heading styles (system style numbers 68 through 75), so heading recovery is still evidenced by the specification's enumeration alone. The style group itself is heavily exercised — footnote-number, endnote-number, document and hypertext system styles all appear, and all correctly carry no structure.
- **Character sets 2 and above are the largest remaining fidelity gap, and set 4 is most of it.** Two thirds of the extended characters in the corpus name character set 4, with the untabulated part of set 1 next, then sets 13, 6, 5, 8, 12 and 3. Each renders as U+FFFD today. That makes the missing character-set tables a concrete, measurable piece of work rather than a theoretical one.

### What is still not proven

- **Two readings the specification does not settle, both chosen deliberately.** The Form function states its desired width and its desired length as two independent fields and its orientation as a third, and says nothing about whether the pair is written before or after the rotation — so a landscape form's dimensions go through exactly as written and the flag is reported through `wpd/landscape-orientation-unmapped` rather than rotated on this package's own inference. And a Table Column's `[width]` is the one horizontal dimension in the format the SDK does not tag `(WPU)`, so it is read as WordPerfect Units on the strength of the two gutter fields immediately after it, which are.
- **Reading a document is not rendering one.** The corpus check confirms that each file reads, that its text is prose, and that the structures above are recovered; it does not compare the result against what WordPerfect itself would display, which would need a reference renderer this family does not have.
- **The document-area's own file-size bound.** The header's file-size field is honoured only when self-consistent, because the SDK itself warns that a third-party writer failing to update it is a common real-world defect whose symptom is a document reading back blank.

## Conventions

- Worker-isomorphic (see the [family-wide convention](../../README.md#conventions)): runtime `src/` must not import `node:*`, a bare Node builtin, or use the `Buffer` global — enforced by a `no-restricted-imports`/`no-restricted-globals` ESLint rule and exercised in CI by running a test suite inside an actual `workerd` isolate (`pnpm test:workers`). Test files under `src/**/*.test.ts` and `src/test-support/` are exempt.
- Only `src/index.ts` may be named `index.*`, and it may contain only re-export statements.
- Every non-obvious constant, offset, and mapping in `src/` cites the SDK page it comes from. A number that cannot be traced to the specification does not belong in this package.

## Install

```sh
pnpm add wpd-codec
# or
npm install wpd-codec
```

## Release and publishing

Release, CI, and commit-message conventions are all workspace-wide, not package-local — see the [monorepo root README](../../README.md#releases) for the mechanism (topological per-package `semantic-release` via `@exadev/semantic-release-workspace`, OIDC trusted npm publishing, automatic sibling dependency-range rewriting).

## Contributing

Conventional Commits, enforced workspace-wide by commitlint through a root `commit-msg` hook. Work inside `packages/wpd-codec/`; see [CONTRIBUTING.md](../../CONTRIBUTING.md) for the shared git hooks and history conventions.

## License

MIT
