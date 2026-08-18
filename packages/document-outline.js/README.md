# document-outline.js

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/document-outline.js) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/document-outline.js) [![Release](https://img.shields.io/github/v/release/ExaDev/document-outline.js)](https://github.com/ExaDev/document-outline.js/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/document-outline.js/ci.yml?branch=main)](https://github.com/ExaDev/document-outline.js/actions)

> Utilities for consumers holding a tree-form `DocumentPackage` (document-schema.js 4.0.0) — the table-of-contents projection, effective-property resolution, and the flatten-to-leaves / leaf-text / stable-hash helpers — without importing the producer that made it. The outline package for the [documents.js family](https://github.com/ExaDev). Worker-isomorphic: the same code runs under Node and inside a Cloudflare Workers isolate.

Created for [document-schema.js#14](https://github.com/ExaDev/document-schema.js/issues/14): none of the content shapes groups content by heading or list level — a heading paragraph sits in a flat `blocks` array like any other — so every consumer needing a nested tree (chunking a document for retrieval, generating a table of contents, structural diffing) had to rebuild the same nesting transform for itself. This package is that transform, once. It depends only on `document-schema.js` (plus `zod`): it never touches a codec, because it only ever operates on an already-produced package, regardless of which producer made it.

[document-schema.js#20](https://github.com/ExaDev/document-schema.js/issues/20) then made the tree the canonical form: since 4.0.0, `DocumentPackage` **is** the tree — a discriminated union of `{ node, children }` group wrappers (`SectionGroupNode`, `SlideGroupNode`, `SheetGroupNode`, `DrawPageGroupNode`, `ShapeGroupNode`, `HeadingGroupNode`, `ListGroupNode`, all imported from `document-schema.js` itself). With the tree vocabulary owned by the schema, this package's phase-1 `decompose`/`flatten` pair — the flat-to-tree transform and its bijection — moved wholesale into [documents.js](https://github.com/ExaDev/documents.js)'s package boundary ([document-outline.js#2](https://github.com/ExaDev/document-outline.js/issues/2), phase 2): one implementation, one authority, no second copy of the grouping semantics here. What remains — and what this major release re-charters the package around — is the artefact-utility surface: everything a consumer holding a serialised tree-form package JSON needs to project, resolve, and hash it, with `document-schema.js` as the only dependency. The removal is the release note: `decompose`, `flatten`, `documentEnvelope`, and the local `PackageNode` types are gone from this package's surface outright, not `@deprecated` — the tree types live in `document-schema.js`, the lossless tree↔flat pair lives in `documents.js`.

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
| `outline/build` | `buildOutline` (per-kind TOC projection over a `DocumentPackage`) |
| `outline/effective` | `effectivePackage` (effective-property resolution) |
| `outline/node` | `OutlineNode`, `OutlineChild`, `OutlineLeaf`, `OutlineNodeSchema`, `isOutlineNode`, `isOutlineChild`, `isOutlineLeaf` |
| `outline/helpers` | `flattenOutline`, `outlineLeafText`, `leafContentHash` |

Every module in the table is re-exported from the package root, so its exports import from `'document-outline.js'` directly. `outline/hash` (the `stableContentHash`/`canonicalise`/`sha256` primitives behind `leafContentHash`'s published recipe) is deliberately not on the root entry — it stays reachable via the `document-outline.js/outline/hash` subpath, keeping the root surface small.

`buildOutline(pkg)` dispatches on `pkg.kind` and projects `pkg.children` into the root scope's children — `OutlineChild[]`, an ordered mix of this package's own `OutlineNode` groups and the schema's leaf payloads. The root is deliberately not itself a node (no synthetic "document" group), so a wordprocessing package's pre-heading content — or a package with no grouping signal at all — appears as leaves directly in the returned array.

This is the **TOC projection**, not a decomposition, and the difference is the charter: it deliberately re-groups across container boundaries — a wordprocessing package's sections flow into one tree, a slide's paragraphs are taken across its shapes in shape order — which is exactly the lossiness a table of contents wants, and exactly why the lossless container-boundary-respecting pair lives in `documents.js`'s package boundary instead.

An `OutlineNode` carries `text` (the group's own label), `level` (its source level signal, verbatim), and `children` (nested groups and leaf payloads in document order). `level` is the source signal, not tree depth: heading groups carry their anchor's `headingLevel` (1-based), list-item groups carry `list.level` (0-based), and the synthetic slide/sheet/page/formula groups are level 1. Render indentation from the nesting, never from `level` — a slide group (level 1) legitimately contains list items at levels 0, 1, 2… on the other scale.

### Per-kind hierarchy

| Kind | Groups | Nesting | Leaves |
|---|---|---|---|
| wordprocessing | one per heading group, by `headingLevel` | stack semantics; list groups nest inside by `list.level` | non-list blocks, at the current depth |
| presentation | one per slide group, `Slide N` | slide paragraphs nest by `list.level`, across its shapes | non-paragraph blocks, at the current depth |
| spreadsheet | one per sheet group, the sheet's name | — | the sheet's images, then its embedded objects |
| drawing | one per page group, `Page N` | — | the page's shape contents flattened, then its vectors |
| formula | a single node | — | the `ContentFormula` itself |

Both nesting scales follow the same stack semantics, modelled on how Word's navigation pane and PowerPoint's outline view present structure: each new group nests under the deepest open group with a strictly shallower level and pops equal-or-deeper groups closed, so an H4 following an H2 becomes its direct child (no synthetic intermediates) and an H1 after an H3 pops to the root; list groups behave identically on `list.level`'s 0-based scale (a jump from level 0 to level 2 nests directly under the 0). Within a group the two compose: heading groups open scopes, list groups nest inside them, and non-paragraph blocks (tables, images, page breaks, embedded objects) attach as leaves at the current depth without changing it. A paragraph at a leaf position carries neither grouping signal in a well-formed tree, sits flat at its scope, and closes the list nesting — which is what keeps the flattened leaf order identical to document order. `headingLevel` is the only heading signal read — a Heading `styleId` without `headingLevel` does not group — and in presentations it is not read at all: slides have no heading hierarchy of their own, so `list.level` is the only depth signal they carry.

Slide and page labels (`Slide 1`, `Page 1`, …) are 1-based, matching the Markdown renderer's own per-slide/per-page heading convention; spreadsheet groups are labelled with the sheet's own name (cells are addressable data, not outline content, and never appear); drawing vectors stay in the tree as textless leaves so structural diffing still sees them.

## Effective properties

A tree group may carry a `style` ref into the package's `styles` table ([document-schema.js#21](https://github.com/ExaDev/document-schema.js/issues/21)). `effectivePackage(pkg)` resolves those refs away using document-schema.js's own overlay helpers (`resolveStyleChain`, `applyParagraphStyleProperties`, `applyRunStyleProperties` — the mechanics are the schema's to own, the same single-authority rule that moved the tree vocabulary there) and returns the package with every ref consumed and the styles table dropped:

```ts
import { effectivePackage } from 'document-outline.js';

const resolved = effectivePackage(pkg); // same tree, properties inlined, no styles table
```

The semantics: a group's ref, plus every ancestor group's ref, overlays onto each paragraph in that group's subtree — group anchors (heading and list groups carry full `ContentParagraph` anchors) and bare paragraph leaves alike — with the chain ordered outermost-first so the nearest group's entry wins over further-out ones, and the paragraph's own direct properties win over everything (the schema's apply helpers fill gaps, never overwrite). The run half of a resolved entry applies to every run of each paragraph it resolved for. The walk's boundary is the block flow: a table leaf's cell paragraphs and an embedded document's own content are leaf-local payload this walk does not rewrite — an embedded document is its own whole document context.

Two guarantees worth depending on. First, `effectivePackage(factored)` deep-equals `effectivePackage(unfactored)`: a serialisation that factored properties into style refs and one that inlined them everywhere resolve to the same effective tree, so consumers comparing or hashing content never see the producer's compression choices. To get that property for hashes, resolve first — `leafContentHash` over the leaves of `buildOutline(effectivePackage(pkg))` names the document, not the factoring. Second, resolution runs loudly: a ref the styles table does not carry is malformed, and `resolveStyleChain` throws rather than silently skipping. A styles-free package is returned as the same object — nothing anywhere needs rewriting.

## Helpers

```ts
import { buildOutline, effectivePackage, flattenOutline, leafContentHash, outlineLeafText } from 'document-outline.js';

const outline = buildOutline(pkg);      // OutlineChild[] — the TOC projection
const resolved = effectivePackage(pkg); // style refs consumed, table dropped
flattenOutline(outline);                // every leaf payload, in document order
outlineLeafText(aLeaf);                 // the leaf's own text (paragraph runs, table cells,
                                        // image altText, formula LaTeX; '' for textless leaves)
leafContentHash(aLeaf);                 // stable content hash — see the recipe below
```

Heading and list paragraphs are represented by their group nodes and are not duplicated as leaves, so a tree of groups flattens to the non-paragraph content plus every unlevelled paragraph; a group's own text is always its `text` field. `leafContentHash` hashes the leaf as given and deliberately does not fold style resolution in — a leaf alone does not know its ancestor group refs, so effective-property resolution can only happen with the whole package in hand. The resolve-then-hash route is `effectivePackage(pkg)` first, then hash the resolved leaves; hash the raw leaf only when you truly mean the literal object.

### The hash recipe

`leafContentHash` (via `stableContentHash`) is a published contract — changing any step changes every hash ever issued:

1. Strip `$schema` keys recursively from the value (arrays mapped, plain objects rebuilt without the key). Serialised dumps carry a release-pinned `$schema` CDN URI stamped by `document-schema.js`'s serialisation helper; the label is transport metadata about which schema version produced the JSON, not content, and no content field is named `$schema` — so a dump and its parsed-then-rehashed original agree.
2. Canonicalise the result: rebuild every plain object with its own keys sorted ascending by UTF-16 code unit (arrays keep their order, primitives pass through) — so independently constructed, structurally identical content is byte-identical from here on regardless of field-construction order.
3. `JSON.stringify` the canonicalised value (no spacing; `undefined`-valued optional fields drop out, so "absent" and "explicitly undefined" hash the same).
4. UTF-8 encode with `TextEncoder`.
5. SHA-256, hand-rolled over `Uint8Array` (Worker-isomorphic; no `node:crypto`, no async `SubtleCrypto`) and pinned against the FIPS 180-4 example vectors in `hash.test.ts`.
6. Hex-encode the digest, lowercase.

The result is deterministic across processes and platforms, equal exactly when the leaf's content is equal, and different for different content up to SHA-256 collision resistance.

## Where decompose and flatten went

The phase-1 `decompose`/`flatten` pair and its property-tested bijection — the lossless tree↔flat transform this package once carried as the vehicle for the `DocumentPackage` promotion — now live in [documents.js](https://github.com/ExaDev/documents.js)'s package boundary. Schema 4.0.0 made `DocumentPackage` itself tree-form, so the grouping semantics have one home next to the codecs that produce and consume packages, and the tree types (`PackageNode`, `PackageGroup`, `SectionGroupNode`, …) import from `document-schema.js`. If you hold a flat `ContentDocument` and need the tree, or need the exact container-boundary-preserving inverse of the TOC projection above, that is documents.js's surface now.

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
