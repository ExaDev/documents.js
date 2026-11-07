# Content projection

How to tell whether a same-format rewrite of a document kept its content, when its bytes can never be equal to the original's.

## The problem

A same-format round trip (read a document into the shared content model, write it back to the same format) cannot be judged by comparing hashes at any level. The writer regenerates every XML part, so no part is byte-equal, and it is not idempotent through its own reader, so even the rewrite of a rewrite differs from the rewrite. Lexical difference (zip order, timestamps, compression, attribute order, quoting, prefixes, entity spelling) and real difference (a paragraph, a footnote, a cell, a picture gone) arrive together and a hash cannot separate them.

Two things separate them. A canonical form removes only lexical difference, so what remains is real. A content projection reduces each document to units a rewrite can be held to, so a unit the original has and the rewrite lacks is a loss, whatever bytes carried it. A control (the rewrite of the rewrite) then tells a writer that is not at a fixed point from one that lost content.

## Where each piece lives

All of it is in `documents.js`, which already owns the OPC mechanics (`src/opc/`) and the XML helpers (`src/xml/`), under `src/content-projection/`, and exported from the package root. Nothing in it is specific to a consumer: it takes package bytes and returns plain data.

- `canonicalizeXml`, `canonicalizeOpcPackage`, `comparePartDigests`: the canonical form of a package.
- `projectDocxContent`, `projectXlsxContent`: the projections.
- `compareProjections`: the comparison and the verdict.

A consumer decides what to record, what its time and memory limits are, and where the work runs (an isolated process is the natural place for corpus-scale runs). The package does not spawn anything and has no opinion about either.

## The canonical form

`canonicalizeXml` applies a closed list of lexical transformations and nothing else.

1. The byte order mark and the XML declaration are dropped.
2. CRLF and lone CR become LF, and literal tabs and line feeds in attribute values become spaces (XML 1.0 sections 2.11 and 3.3.3).
3. Entity and character references are decoded, then the output is re-escaped with one fixed escaping.
4. Namespace prefixes are replaced by the URIs they resolve to, and namespace declarations are dropped. The prefix lists of the Markup Compatibility attributes (`mc:Ignorable` and its siblings) are rewritten the same way and sorted, since the specification treats them as sets.
5. Attributes are sorted by expanded name, and quoting and whitespace inside tags are fixed.
6. An empty element is always written as a start tag and an end tag.
7. CDATA sections become text and adjacent text is merged.

Identifiers, revision stamps, timestamps, document property values and relationship identifiers are never touched, and neither are child order, whitespace-only text, comments or processing instructions. A prefix inside an ordinary attribute value (a type name, a formula) is content and is left alone.

A document type declaration is refused with `XmlDoctypeError` and never dropped: its internal subset can declare entities that change what the text means, and no OPC part has a legitimate use for one. An undeclared entity or any other malformation is an `XmlScanError`.

`canonicalizeXml` returns two serialisations. The second leaves out identifier and revision-stamp attributes (`rsid*`, `paraId`, `textId`, `durableId`, `id`, `uid`, `guid` and similar), so a part whose canonical forms differ but whose identifier-free forms agree is classified as differing in identifiers only.

`canonicalizeOpcPackage` reads only each part's inflated bytes, so zip order, timestamps, compression method and extra fields cannot matter, and digests each XML part's two serialisations and every other part's bytes (SHA-256). A part the scanner refuses is recorded as `unparsed` with the error's class name (never its message, which can quote the document) and a digest of its raw bytes. A part the memory budget does not cover is recorded as `skipped`.

`comparePartDigests` then reports, per part, whether it is identical, differs only in identifiers, is a document property part (`docProps/`) whose values differ (metadata), differs in canonical content, is missing, was added, or is undetermined because a side could not read it. This is what remains to be explained after the lexical noise is gone, not a content verdict: a writer regenerates styles, themes and settings, so `differing` is expected to be long for any rewrite.

## Projections

A projection holds, per category, a multiset of units, plus an element census, the media by content hash, and for xlsx every non-empty cell. Words are gathered per paragraph (or per string, comment or chart value) and counted when the container closes, so a different split into runs changes nothing.

For docx the categories are `body`, `headers-footers`, `notes` (footnotes and endnotes), `comments`, `drawings` (text boxes, DrawingML text, diagram data) and `charts`. The census counts paragraphs, tables, rows, cells, content controls, hyperlinks, drawings, pictures, text boxes, bookmarks, simple fields, field codes, section properties, header and footer references, footnotes, endnotes, comments, embedded objects, blips and equations. Field codes are counted but are not display text. Deleted tracked text and equation text are words.

For xlsx the categories are `shared-strings`, `sheet-names`, `defined-names`, `comments` (legacy and threaded), `drawings` and `charts`, with the census over sheets (cells, formulas, rows, merges, validations, conditional formats, hyperlinks, columns, drawing references), the workbook (sheets, defined names), shared strings, comments and drawings. Cells are keyed by the sheet's position in the workbook and the resolved reference, with the value (resolved through shared strings and inline strings, booleans normalised, numbers normalised so `1.0` and `1` agree) and the formula text beside it. A row or cell with no reference takes the position the specification implies. A cell that reads a shared formula's master is marked, and only the presence of a formula is compared there. Keying by position means a renamed sheet is a name difference and does not make every cell on it look lost. Phonetic runs are not part of a string.

The `mc:Fallback` branch of a Markup Compatibility choice is skipped whole, text and census alike: it repeats what the `mc:Choice` branch holds for readers that do not understand it.

Both Transitional and Strict namespaces are recognised. Parts are classified by their declared content type, not by their names.

Parts that carry content these projections do not read (pivot data, external workbooks, macros, query and connection definitions, slicers, ActiveX controls, web extensions, custom XML data stores) are listed in `unmodelledParts` by name with digits replaced, so a clean verdict says what it did not cover. Defined-name formulas and table definitions are not compared; each cell's own formula is.

ODF packages and EPUB are not covered. An ODF projection follows the same shape over `content.xml`, `styles.xml` and the manifest, and an EPUB one over its spine documents, with the same canonical form. They are follow-ups.

## Verdicts

`compareProjections(original, rewrite, control?)` returns the per-category units the rewrite lacks (`missing`) and adds (`extra`), the census families whose counts differ, the media difference, the cell difference, a list of findings and a verdict. Each finding carries a class.

- `loss`: the original has content the rewrite lacks, and the control shows nothing lost in the same place.
- `unstable`: the original has content the rewrite lacks, but rewriting the rewrite also loses content in the same place, so loss cannot be told from writer noise there.
- `writer-asymmetry`: the rewrite has content the original lacks and rewriting the rewrite changes the same place: the writer is not at a fixed point there.
- `writer-addition`: the rewrite has content the original lacks and the writer is stable there.
- `reencoded-media`: the same kind of medium (image or embedded object) with different bytes. Whether the pixels survived is not decided here.

"The same place" is the category. A category whose control loses anything is unstable for every shortfall in it, units and element counts alike. Without a control nothing is unstable, every shortfall is a loss and every surplus is an addition.

The verdict is the worst finding: `loss`, then `unstable`, then `incomplete` (a part on either side could not be read, so nothing is claimed), then `writer-differences` (only surplus or re-encoded content), else `equivalent`. Differences in identifiers, revision stamps and properties are not content and never affect it.

## Bounded memory

A real workbook can hold hundreds of megabytes of sheet XML, and a document tree built from it does not fit. These passes never build one.

- The zip directory is read without inflating anything, so each part's size is known before it is inflated, and only one part is held at a time.
- A streaming scanner (`scanXml`) raises events as it goes. Memory is bounded by nesting depth plus whatever the handler keeps: for a projection, the units, census counts and resolved cells.
- The caller names the memory it allows (`memoryBudgetBytes`; there is no default, since only the caller knows its own limit). A part is admitted when the allowance still covers its transient cost on top of everything earlier parts retained. The cost per byte of an XML part is two measured factors, one for what a part costs while it is processed and one for what its result keeps, kept as named constants in `memory-budget.ts` and re-measured by `scripts/measure-memory-factors.mjs`. The script runs synthetic parts through the built package in a child process and reads the growth of the process's resident set, because Node holds a large decoded string and every inflated part outside the V8 heap, so a heap limit would not see most of what a part costs. The retained factor is the heap still held after a collection.
- A part that does not fit is recorded in `skippedParts` with the reason `exceeds-memory-budget`, never read and never silently ignored. A projection with any skipped part cannot yield `equivalent`.
- A part that is not well-formed is scanned into a scratch builder that is merged only when the scan reaches the end, so a part that fails halfway contributes nothing. It is recorded as `unparsed:` plus the error's class name.

## What a verdict does and does not say

`equivalent` means every unit, element count, medium and cell the projection reads agrees. It does not say anything about what the projection does not read (styles, layout, theme, defined-name formulas, unmodelled parts), and the report names the unmodelled parts it saw. `loss` means content the projection reads is gone. Every simulated loss in the tests (a paragraph, a table row, an empty table row, a footnote, a comment, an image, a header paragraph, a text box, chart text, a cell, a formula, a sheet row, a sheet, a defined name) is caught and attributed; a real writer can lose content in a construct the projection does not read, and that stays invisible until a category is added for it.
