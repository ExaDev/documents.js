# document-outline.js

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/document-outline.js) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/document-outline.js) [![Release](https://img.shields.io/github/v/release/ExaDev/document-outline.js)](https://github.com/ExaDev/document-outline.js/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/document-outline.js/ci.yml?branch=main)](https://github.com/ExaDev/document-outline.js/actions)

> Heading- and level-driven hierarchical outlines over any `ContentDocument` — all five document kinds — plus `decompose`/`flatten`: the lossless tree-form view of a `DocumentPackage` and back, with bijection property tests as the gate. The outline package for the [documents.js family](https://github.com/ExaDev). Worker-isomorphic: the same code runs under Node and inside a Cloudflare Workers isolate.

Created for [document-schema.js#14](https://github.com/ExaDev/document-schema.js/issues/14): none of `ContentDocument`'s shapes groups content by heading or list level — a heading paragraph sits in a flat `blocks` array like any other — so every consumer needing a nested tree (chunking a document for retrieval, generating a table of contents, structural diffing) had to rebuild the same nesting transform for itself. This package is that transform, once. It depends only on `document-schema.js` (plus `zod`): it never touches a codec, because it only ever operates on an already-produced `ContentDocument`, regardless of which codec made it. [document-outline.js#2](https://github.com/ExaDev/document-outline.js/issues/2) then re-chartered it as the phase-1 vehicle for [document-schema.js#20](https://github.com/ExaDev/document-schema.js/issues/20)'s `DocumentPackage` promotion: the `decompose`/`flatten` pair below is the grouping semantics and the property-tested bijection that promotion depends on.

## Getting started

Requires Node.js `>=20` and pnpm `11.6.0`.

```sh
pnpm install
pnpm build          # tsdown -> dist/ (ESM + CJS + .d.ts)
pnpm typecheck      # tsc -p tsconfig.json && tsc -p tsconfig.node.json (dual tsconfig)
pnpm lint           # eslint . --fix --cache --max-warnings 0
pnpm test           # vitest run
pnpm test:watch     # vitest
pnpm test:workers   # vitest run --config vitest.workers.config.ts, inside a real Cloudflare Workers (workerd) isolate
```

To run a single test file, pass its path to vitest directly, e.g. `pnpm exec vitest run src/outline/build.test.ts`.

## What it provides

| Module | Exports |
|---|---|
| `outline/build` | `buildOutline` (per-kind outline construction) |
| `outline/decompose` | `decompose` (DocumentPackage → package tree) |
| `outline/flatten` | `flatten`, `DocumentEnvelope`, `documentEnvelope` (package tree → ContentDocument) |
| `outline/effective` | `effective`, `effectiveTree` (effective-property resolution) |
| `outline/package-node` | the `PackageNode` types, `PackageNodeSchema`/`PackageGroupSchema`/`PackageLeafSchema`, `isPackageNode`/`isPackageGroup`/`isPackageLeaf`, per-root-kind narrowers |
| `outline/node` | `OutlineNode`, `OutlineChild`, `OutlineLeaf`, `OutlineNodeSchema`, `isOutlineNode`, `isOutlineChild`, `isOutlineLeaf` |
| `outline/helpers` | `flattenOutline`, `outlineLeafText`, `leafContentHash` |

Every module in the table is re-exported from the package root, so its exports import from `'document-outline.js'` directly. `outline/hash` (the `stableContentHash`/`canonicalise`/`sha256` primitives behind `leafContentHash`'s published recipe) is deliberately not on the root entry — it stays reachable via the `document-outline.js/outline/hash` subpath, keeping the root surface at the phase's mandated size.

`buildOutline(doc)` dispatches on `doc.kind` and returns the root scope's children — `OutlineChild[]`, an ordered mix of group nodes and leaf payloads. The root is deliberately not itself a node (no synthetic "document" group), so a wordprocessing document's pre-heading content — or a document with no grouping signal at all — appears as leaves directly in the returned array.

An `OutlineNode` carries `text` (the group's own label), `level` (its source level signal, verbatim), and `children` (nested groups and leaf payloads in document order). `level` is the source signal, not tree depth: heading groups carry `headingLevel` (1-based), list-item groups carry `list.level` (0-based), and the synthetic slide/sheet/page/formula groups are level 1. Render indentation from the nesting, never from `level` — a slide group (level 1) legitimately contains list items at levels 0, 1, 2… on the other scale.

### Per-kind hierarchy

| Kind | Groups | Nesting | Leaves |
|---|---|---|---|
| wordprocessing | one per heading, by `headingLevel` | stack semantics; lists nest inside a group by `list.level` | non-list blocks, at the current depth |
| presentation | one per slide, `Slide N` | slide paragraphs nest by `list.level` | non-paragraph blocks, at the current depth |
| spreadsheet | one per sheet, the sheet's name | — | the sheet's images, then its embedded objects |
| drawing | one per page, `Page N` | — | the page's shape blocks, then its vectors |
| formula | a single node | — | the `ContentFormula` itself |

Both nesting scales follow the same stack semantics, modelled on how Word's navigation pane and PowerPoint's outline view present structure: each new group nests under the deepest open group with a strictly shallower level and pops equal-or-deeper groups closed, so an H4 following an H2 becomes its direct child (no synthetic intermediates) and an H1 after an H3 pops to the root; list items behave identically on `list.level`'s 0-based scale (a jump from level 0 to level 2 nests directly under the 0). Within a group the two compose: headings open groups, list paragraphs nest inside them, and non-paragraph blocks (tables, images, page breaks, embedded objects) attach as leaves at the current depth without changing it. A paragraph with neither a heading level nor list membership sits flat at its scope and closes the list nesting, which is what keeps the flattened leaf order identical to document order. `headingLevel` is the only heading signal read — a Heading style without `headingLevel` does not group — and in presentations it is not read at all: slides have no heading hierarchy of their own, so `list.level` is the only depth signal they carry.

Slide and page labels (`Slide 1`, `Page 1`, …) are 1-based, matching the Markdown renderer's own per-slide/per-page heading convention; spreadsheet groups are labelled with the sheet's own name (cells are addressable data, not outline content, and never appear); drawing vectors stay in the tree as textless leaves so structural diffing still sees them.

### Helpers

```ts
import { buildOutline, flattenOutline, leafContentHash, outlineLeafText } from 'document-outline.js';

const outline = buildOutline(doc);      // OutlineChild[]
flattenOutline(outline);                // every leaf payload, in document order
outlineLeafText(aLeaf);                 // the leaf's own text (paragraph runs, table cells,
                                        // image altText, formula LaTeX; '' for textless leaves)
leafContentHash(aLeaf);                 // stable content hash — see the recipe below
```

Heading and list paragraphs are represented by their group nodes and are not duplicated as leaves, so a tree of groups flattens to the non-paragraph content plus every unlevelled paragraph; a group's own text is always its `text` field.

### The hash recipe

`leafContentHash` is a published contract — changing any step changes every hash ever issued:

1. Canonicalise the leaf: rebuild every plain object with its own keys sorted ascending by UTF-16 code unit (arrays keep their order, primitives pass through) — so independently constructed, structurally identical content is byte-identical from here on regardless of field-construction order.
2. `JSON.stringify` the canonicalised value (no spacing; `undefined`-valued optional fields drop out, so "absent" and "explicitly undefined" hash the same).
3. UTF-8 encode with `TextEncoder`.
4. SHA-256, hand-rolled over `Uint8Array` (Worker-isomorphic; no `node:crypto`, no async `SubtleCrypto`) and pinned against the FIPS 180-4 example vectors in `hash.test.ts`.
5. Hex-encode the digest, lowercase.

The result is deterministic across processes and platforms, equal exactly when the leaf's content is equal, and different for different content up to SHA-256 collision resistance.

## Decompose and flatten: the package tree

`decompose` and `flatten` ([document-schema.js#20](https://github.com/ExaDev/document-schema.js/issues/20)'s promoted `DocumentPackage`, phase 1) are the lossless structural view of a document and its exact inverse:

```ts
import { decompose, flatten, documentEnvelope } from 'document-outline.js';

const tree = decompose(pkg);                                  // PackageRoot[] — one group per top-level container
const content = flatten(tree, documentEnvelope(pkg.content)); // ContentDocument — structurally identical to pkg.content
```

`decompose(pkg)` reads `pkg.content` (the flat codec-exchange form) and wraps it into a tree of `{ node, children }` groups and bare leaves. It never copies content: the tree's leaves are the document's own node objects, embedded — so a consumer holding both views sees an edit through either. It ignores `pkg.pages` (rendered page geometry is already fused onto the content nodes' own `frames` fields).

Groups are `{ node, children }` where `node` embeds either an **anchor paragraph** — heading and list groups carry the full `ContentParagraph`, runs and formatting and frames included, never a projected text label; that projection is `buildOutline`'s job — or a **container descriptor**: `{ kind: 'section', pageSize, margins }`, `{ kind: 'slide', size, notes }`, `{ kind: 'sheet', name, cells, columns, rows, printSettings }`, `{ kind: 'drawPage', size }`. A shape is its own group `{ node: <ContentShape minus blocks>, children }`. Bare leaves carry their own `kind` and never `children`; discrimination is structural on `node` + `children`.

### The container-boundary rule

Grouping happens **within one container's block flow, never across containers**:

- **wordprocessing** — one section group per `ContentSection` (mandatory: a section's pre-layout geometry cannot ride a rendered-pages array, and without section groups the bijection is unsatisfiable for multi-section documents). Inside a section, the same stack semantics as `buildOutline` — headings nest by `headingLevel`, lists nest inside them by `list.level`, plain paragraphs sit flat and close the list nesting — but the stacks reset at each section boundary rather than flowing sections into one tree.
- **presentation** — one slide group per slide, then **one shape group per shape**: a slide's paragraphs are never regrouped across its shapes (that is the outline's lossy TOC projection, not a decomposition). Inside each shape, list nesting only.
- **spreadsheet** — one sheet group per sheet; the grid (`cells`, `columns`, `rows`) and `printSettings` ride **on the sheet node**; children are the sheet's images then its embedded objects. A present-but-empty `embeddedObjects` array normalises to the field absent — the bijection's one declared normalisation (see the laws).
- **drawing** — one page group per page; children are the page's shape groups then its vector leaves.
- **formula** — the single `ContentFormula` node, with no container group around it.

An embedded document (`ContentEmbeddedObject`, the recursive arm) always stays intact as one leaf, whichever container holds it.

### The envelope

`flatten` takes the document-level fields the tree cannot carry, as a `DocumentEnvelope` (`{ kind, metadata, symbolTable? }`) beside the tree. `kind` lives in the envelope rather than being inferred from the top-level nodes because empty documents are legal — a presentation with no slides decomposes to an empty root array, and inferring the kind from nothing would break the bijection for exactly those. `documentEnvelope(pkg.content)` extracts it in one call.

### The three laws

The pair is gated by property tests over an outline-local corpus covering all five kinds (including the recursive embedded-formula arm, multi-section geometry, a multi-frame wrapped run, a present-but-empty `embeddedObjects` sheet, and the empty-document edges) — `src/outline/bijection.test.ts`:

1. **Strict structural equality, both directions** — `flatten(decompose(pkg))` reproduces `pkg.content` exactly (same document order; comparison via `canonicalise` + a JSON cycle, never identity — decompose shares node references, so identity would pass even for a mutating implementation), up to one declared normalisation: a present-but-empty `embeddedObjects` array on a sheet, which the tree's concatenated children cannot distinguish from an absent field, round-trips to the field absent. The schema allows the spelling and no codec emits it; the comparator applies the normalisation to both sides (an equivalence over canonical forms, not a one-way coercion) and a dedicated test pins the direction, so the documents.js gate inherits a declared rule rather than an undeclared failure.
2. **Effective-property equality, universally** — resolve-then-compare: both encodings pass through `effective`/`effectiveTree` before comparison. Today resolution is the identity (no style layer exists yet, so every corpus document is trivially styles-table-free and this law reduces to structural equality); when the styles major lands, the same assertions compare overlay-resolved properties. `effective` is exported now precisely so these tests and `leafContentHash` already route through the one seam where style resolution will land.
3. **Minting idempotence** — `decompose(flatten(decompose(pkg)))` equals `decompose(pkg)`: re-decomposing a flattened tree mints the identical tree.

These laws are the gate for the whole `DocumentPackage` promotion. **Phase 2 ports this pair into documents.js's package boundary** (one implementation, one authority — no second copy of the grouping semantics; `buildOutline` deprecates in favour of the boundary's `decompose`), and documents.js re-runs the same assertions over its real corpus as the promotion's merge gate. The tests travel unchanged.

## Conventions

- Worker-isomorphic (see the [family-wide convention](https://github.com/ExaDev/documents.js/blob/main/README.md#conventions)): runtime `src/` must not import `node:*`, a bare Node builtin, or use the `Buffer` global — enforced by a `no-restricted-imports`/`no-restricted-globals` ESLint rule and exercised in CI by running a test suite inside an actual `workerd` isolate (`pnpm test:workers`).
- Only `src/index.ts` may be named `index.*` — a custom ESLint rule (`local/no-non-barrel-index`) rejects any other module using an `index` basename, since that would be a hidden entry point the `exports` map in `package.json` doesn't advertise.
- `OutlineNodeSchema` follows document-schema.js's `z.custom` hand-written-guard pattern (`ContentBlock` is the precedent): `z.lazy()` collapses recursive schemas' static type to `unknown` in the pinned zod 4, so the recursion lives in a plain function guard instead.
- Releases are fully automated: a push to `main` runs `semantic-release` in CI, which determines the version from Conventional Commit messages and publishes to npm via OIDC trusted publishing (no local `NPM_TOKEN` needed). There is no manual publish step.

## Install

```sh
pnpm add document-outline.js
# or
npm install document-outline.js
```

## License

MIT
