# Working brief: the spreadsheet canvas model

Scoping and constraints for [#823](https://github.com/ExaDev/documents.js/issues/823) — reading a
spreadsheet as a canvas of cells and regions rather than projecting it to a wordprocessing tree.

The issue states the request. This states how to approach it, what to check before believing it,
and which repository conventions will bite. It is a starting point for a working session, not a
specification; delete or fold it into the package README once the work lands.

---

## Start by trying to falsify the premise

The issue reports that dumping a spreadsheet's package produces a `kind: wordprocessing` tree of
sections, paragraphs and tables — 18 cells inside 2 tables, no sheet nodes, no A1 references, no
formulas. **That is one file, observed through the CLI, and the command used may have fallen
through to a generic `convert` path rather than the xlsx reader.**

So the first task is to disprove it, not to act on it:

- Read an `.xlsx` through the library directly rather than through the CLI, and inspect the
  `ContentDocument` / `DocumentTree` it actually produces.
- Check `packages/ooxml.js/src/typed/xlsx/` — there are already `kitchen-sink.xlsx` and
  `minimal.xlsx` fixtures there, so the typed layer clearly reads real workbooks. The question is
  what survives the hand-off from the typed OOXML layer into the shared schema.
- Establish whether the sheet vocabulary the schema already defines — `SheetGroupNode`,
  `cellTable`, `cellReference`, `merged`, and the `a1.ts` helpers (`CellPosition`, `CellRange`,
  `parseCellReference`, `parseRangeReference`) — is populated by any path at all.

If it is populated and the reporter simply used the wrong exit, the issue collapses from reader
work into documentation, and that is a good outcome worth twenty minutes. If it is genuinely
projected to a wordprocessing shape, the grid is lost before any output format is chosen, and no
amount of work on a markdown emitter recovers it.

## Scope: the representation first, the inference later

The issue carries two asks. **Do the first one on its own.**

1. **Populate the sheet/cell model** — A1 address, value and authored type, unevaluated formula,
   number format, attached comment or note, merged-range membership. Lossless and uninterpreted.
2. **Infer regions and neighbour-derived labels, with confidence** — connected components of
   populated cells; a cell's labels taken from the nearest text cells above and to its left, with
   distance recorded as confidence.

Ask 1 is a prerequisite for ask 2, and it is independently useful: a consumer can build cell
lookup, filtering and summarisation on a lossless cell dump with no regions in existence. Ask 2 is
where every judgement call lives — what counts as a region boundary, when a header is a header,
how confident is confident — and building that on a representation that might still move is
backwards.

Splitting them also keeps the first PR reviewable. A schema addition plus a reader change is
already a cross-package change; adding a heuristics engine to the same diff makes it
unreviewable.

## Where the pieces belong

- **`document-schema.js`** — the cell and region types. It already owns the sheet vocabulary and
  `a1.ts`, and it is the only layer every codec can reach without a dependency cycle.
- **`ooxml.js`** — reading the cells out of the xlsx package into that model.
- **`odf.js`** — the same for `.ods`, which has the identical problem and should not diverge.
- **`document-outline.js`** — the natural home for region inference when it comes. Its README says
  it exists because "every consumer needing a nested tree (chunking a document for retrieval,
  generating a table of contents, structural diffing) had to rebuild the same nesting transform
  for itself". Region segmentation is the same shape of work along a different axis, and it
  depends on the schema alone, which is the right dependency for a heuristic layer.

Note this generalises past spreadsheets: a PDF has regions too — columns, tables, figures,
captions — which is why this repository's PDF path recovers heading structure that converters
attempting no structure recovery do not. Whatever shape the region type takes should not be
spreadsheet-specific.

## Constraints that will bite

**Worker isomorphism.** Runtime `src/` in a Worker-isomorphic package imports no `node:*`, no bare
Node builtin, and uses no `Buffer`. Both a lint guard and the workerd suite check this, and
`pnpm test:workers` runs inside a real Cloudflare Workers isolate. This matters here because cell
reading is byte and buffer work by nature — reach for `byte-codec` rather than Node primitives.

**The schema is a cross-package contract.** `document-schema.js` 4.0.0 made `DocumentTree` the
canonical form, and `document-outline.js` and every codec depend on it. Cell and region types need
to be **additive**, not a reshape, or the change stops being about spreadsheets and becomes a
coordinated release.

**Linear history, conventional commits.** Rebase, never merge or squash — the `pre-commit` hook
rejects both on `main`. `commitlint` gates the message through `commit-msg`, and the scope decides
which package's changelog the entry lands in, so a change touching two packages wants two scoped
commits rather than one. `pre-push` runs typecheck and unit tests across the workspace via turbo.

**Zero-warning lint.** `eslint . --cache --max-warnings 0`, with Prettier as an ordinary lint rule,
and `knip` for dead code — a half-finished export fails CI rather than sitting quietly.

## Fixtures

Build synthetic ones, and make them cover the shapes that motivated the issue rather than a tidy
table:

- a table with unrelated prose in a column beside it, not part of the table
- a sheet that is entirely narrative, laid out with merged cells and no header row
- label/value pairs scattered in margins, with the label sometimes above and sometimes to the left
- a calculator: inputs, formulas, outputs, no row semantics
- a sheet of cells filled in ad hoc with no organising structure at all
- cells carrying comments and notes, which are prose and are currently dropped

`packages/ooxml.js/src/typed/xlsx/fixtures/` is the precedent to follow.

**Do not use real third-party documents as fixtures.** A test corpus that motivated an issue is
usually someone's confidential material, and fixtures are public and permanent. Reproduce the
shape, never the content.

## The consumer's side, for context only

The request originates from a retrieval system that reads a folder of documents, chunks and embeds
them. Its own design decisions — which regions become retrievable chunks, how to budget them
against a reranker quota, what gets linked into a knowledge graph, how cells are exposed to a
query tool — are deliberately **not** being asked for here. The seam is:

> The reader answers "what is on this canvas." The consumer answers "how should this be
> retrievable."

That is why regions must be **advisory**: a consumer needs to ignore them and still have every
cell. Classification should add information, never gate what is emitted — the failure mode of a
structure-gated reader is silently dropping what it did not recognise, and a consumer cannot
distinguish "the sheet does not say that" from "the reader did not understand that part".

The consumer-side reasoning is written up at
[ExaDev/pgkg ADR-0002](https://github.com/ExaDev/pgkg/blob/main/docs/adrs/0002-spreadsheets-are-not-documents.md),
in case the argument is useful — particularly that a table is already a fact store and should be
referenced rather than copied.
