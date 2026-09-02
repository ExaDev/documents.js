# documents.js

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/documents.js) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/documents.js) [![npm version](https://img.shields.io/npm/v/documents.js)](https://www.npmjs.com/package/documents.js) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/documents.js/ci.yml?branch=main)](https://github.com/ExaDev/documents.js/actions)

> A family of independent, MIT-licensed TypeScript packages for lossless, type-safe document conversion — OOXML (docx/pptx/xlsx), OpenDocument (odt/ods/odp), Markdown, and PDF — sharing a common Zod-based schema layer, plus the CLI, MCP server, and web UI built on top of them.

This repository is a pnpm workspace: one repository, one lockfile, one CI pipeline, and one release run, holding every package in the family under `packages/`. Each package keeps its own version, its own changelog, its own npm release cadence, and its own README — consolidating the repositories did not merge the packages into one artifact, and there is no lockstep version shared between them. What is shared is everything that was previously copied: the workspace settings, the task pipeline, the git hooks, commit-message validation, dependency automation, and the release orchestration.

## Getting started

Node 22 (pinned in `.tool-versions`) and pnpm `11.6.0` (pinned as `packageManager` in the root `package.json`) are the only prerequisites; corepack resolves the latter automatically. `pnpm install` resolves and links every package in one pass — there is no per-package install step.

No environment variable is required for a normal build/lint/test run. `documents.js`'s examples suite regenerates its fixtures only when `GENERATE_EXAMPLES` is set; `pnpm test:corpus` additionally expects the gitignored real-world conformance corpora to already be present locally (see each codec's own README for what it checks against).

## Packages

The packages layer from foundation up to user-facing interfaces. Each depends only on the layers below it.

### Foundation

| Package                                                         | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`document-schema.js`](packages/document-schema.js/README.md)   | The canonical, format-agnostic content and document-tree schema shared by every codec, plus the structural transform between them (`decompose`/`flattenTree`/`factorStyles`/`assembleTree`, converting a flat `ContentDocument` to and from the tree-form `DocumentTree`). Free of any format-specific or I/O behaviour: the transform lives here because every codec depends on this package and none of them depends on `documents.js`, so it is the only layer a codec can reach to expose `DocumentTree` publicly without a dependency cycle. |
| [`byte-codec`](packages/byte-codec/README.md)                   | Generic byte-level primitives (`ByteWriter`, `ByteReader`, CRC-32, deflate/inflate) and PNG/JPEG image encoding and decoding, with zero knowledge of any document format.                                                                                                                                                                                                                                                                                                                                                                         |
| [`document-outline.js`](packages/document-outline.js/README.md) | Utilities for consumers holding a tree-form `DocumentTree`: the TOC outline projection, effective-property resolution, and the flatten/leaf-text/stable-hash helpers. Depends on the schema alone, and is consumed by the interface packages rather than by the codecs.                                                                                                                                                                                                                                                                           |
| [`archive-codec`](packages/archive-codec/README.md)             | Recursive archive (ZIP-in-ZIP) detection and walking with depth and cumulative decompressed-size guards, plus bounded classic OLE compound-file ([MS-CFB]) reading and OLE Package stream unwrapping — zero document-format knowledge. Consumed by `ooxml.js`, whose pptx (`p:oleObj`) and docx (`o:OLEObject`) OLE reading detects a ZIP-payload embedded object through it and decodes the nested package as a content document, and unwraps the classic `.bin` compound-file spelling through its CFB reader to the same nested decode.        |
| [`document-compute.js`](packages/document-compute.js/README.md) | Units-typed evaluation over the schema's `MathExpression`: `evaluate()` for point values and bounded intervals through one interpreter with exact-rational unit conversion, plus `solveFor()` numeric root-finding on one unknown. Depends on the schema alone; a leaf nothing else depends on yet — it is not wired into any conversion pipeline.                                                                                                                                                                                                |

### Format codecs

Each converts one document format to and from the shared schema, built on `document-schema.js`:

| Package                                               | Formats                                                                                  |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [`ooxml.js`](packages/ooxml.js/README.md)             | OOXML packages (docx, pptx, xlsx) to and from JSON.                                      |
| [`odf.js`](packages/odf.js/README.md)                 | OpenDocument packages (odt, ods, odp) to and from JSON.                                  |
| [`markdown-codec`](packages/markdown-codec/README.md) | CommonMark+GFM to and from the shared content schema.                                    |
| [`pdf-codec`](packages/pdf-codec/README.md)           | Parses arbitrary real-world PDFs and generates new ones, also depending on `byte-codec`. |

### Conversion engine

| Package                                           | What it is                                                                                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`documents.js`](packages/documents.js/README.md) | Bidirectional docx/pptx to and from PDF conversion, and a read+write editable OOXML document model, built on `ooxml.js` and depending on every codec above. |

### Interfaces

Each exposes the conversion engine through a different surface:

| Package                                           | Surface                                                                                                                                                                                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`document-cli`](packages/document-cli/README.md) | CLI and interactive Ink TUI covering every docx/pptx/odt/odp/ods/odg/odf/pdf/odm/odb/xlsx/markdown conversion, bridge, and editor as a scriptable command or a terminal app.                                                |
| [`document-mcp`](packages/document-mcp/README.md) | MCP server exposing the conversion, `.odb`, metadata, and font tooling as MCP tools.                                                                                                                                        |
| [`documents`](packages/documents/README.md)       | Client-only, statically-built web UI for every conversion and editing tool in the ecosystem, also depending directly on `markdown-codec`. The one package here that is never published: it deploys to GitHub Pages instead. |

## PDF is an equal peer, not a junction

PDF is one document format among those this ecosystem handles — never a special "hub" format that every other format converts through to get somewhere else. The real interchange between codecs is the format-agnostic schema in `document-schema.js` — `ContentDocument` for semantic content, and the tree-form `DocumentTree` that fuses structure, layout, and content in one artefact: each codec converts one on-disk format to and from that schema, and a cross-format conversion is source → schema → target, not source → PDF → target. (`LayoutDocument`, the fixed-page-layout item family, is `pdf-codec`'s own private representation now, not part of this shared interchange — see that package's README.) PDF enters that flow only when a user genuinely asks for a PDF (or hands the ecosystem a PDF as the source), in which case it is treated exactly like any other source or target format — no more privileged than docx, odt, or markdown.

This matters for anyone building on top of the conversion engine (the CLI, MCP server, or web UI). A feature like "preview this document" must render the document's own native representation (its `ContentDocument`), not silently round-trip every format through a PDF rendition just because a PDF happens to be easy to display — that would make PDF a junction in disguise, re-introducing exactly the coupling the schema layer exists to remove, and paying a full layout-engine + font-resolution + PDF-write pass for a side effect the caller never asked for. The same applies to inspection, metadata, and any other tooling: operate on the native representation, and reach for PDF only when the user's actual request names PDF.

## Comparison to alternatives

documents.js's own claim — one shared, Zod-typed schema doing bidirectional, lossless conversion across office formats, PDF, and markdown, as an MIT-licensed, dependency-minimal, Worker-isomorphic library — was checked against 108 real alternatives across 11 categories (open-source libraries, cross-format engines, CLI tools, MCP servers, hyperscaler document-AI platforms, and commercial/SaaS vendors), each verified by fetching its own registry page, repo, or pricing page rather than recalled from memory. One representative alternative per category:

| Category                    | Closest alternative                                                                        | Licence                 | Key difference                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| Foundation codecs           | [fflate](https://www.npmjs.com/package/fflate)                                             | MIT                     | ~8kB, zero deps — closest single-purpose analogue to `byte-codec`, but scoped to compression/ZIP alone. |
| OOXML                       | [docx](https://www.npmjs.com/package/docx)                                                 | MIT                     | Write-only, docx/pptx only, bespoke object model — no read/round-trip path, no xlsx.                    |
| OpenDocument                | [odf-kit](https://www.npmjs.com/package/odf-kit)                                           | Apache-2.0              | No ODP support; converts formats as hand-wired pairs, not through a shared schema.                      |
| Markdown                    | [remark / mdast](https://www.npmjs.com/package/remark)                                     | MIT                     | Markdown-only AST; reaches other formats only via separate HTML bridges, not directly.                  |
| PDF                         | [pdf-lib](https://www.npmjs.com/package/pdf-lib)                                           | MIT                     | PDF-only object-graph API, no shared cross-format schema; dormant since ~2021.                          |
| Cross-format engines        | [Pandoc](https://pandoc.org/)                                                              | GPL-2.0-or-later        | Genuinely does N-format conversion via a shared AST — but GPL, native binary, untyped, not embeddable.  |
| CLI & TUI                   | [office2pdf](https://crates.io/crates/office2pdf)                                          | Apache-2.0              | Hand-written, single Rust binary — but one-directional (OOXML→PDF only), no shared schema.              |
| MCP servers                 | [mcp-pandoc](https://pypi.org/project/mcp-pandoc/)                                         | MIT                     | Wraps Pandoc's own AST; needs a native binary, so no Worker/browser.                                    |
| Other language ecosystems   | [Apache POI](https://poi.apache.org/)                                                      | Apache-2.0              | Three unrelated per-format APIs (XSSF/XWPF/XSLF) — no shared schema between them.                       |
| Platform-native document AI | [Amazon Textract](https://aws.amazon.com/textract/)                                        | Proprietary AWS service | Images/PDF only, no office formats; per-feature metered pricing; no self-hosting.                       |
| Commercial & RAG SaaS       | [Adobe PDF Services API](https://developer.adobe.com/document-services/apis/pdf-services/) | Proprietary, cloud-only | Free to 500 transactions/month; beyond that, sales-quote only with no published price.                  |

None of them combine symmetric read+write conversion, a runtime-validated shared schema, MIT licensing, and Worker/browser portability in one embeddable package — see [COMPARISON.md](COMPARISON.md) for the complete, cited comparison (all 108 entries, pricing tiers, and adoption/maintenance signals).

## Conventions

Individual packages set their own build and test configuration, but as a family they share:

- TypeScript with Zod 4 for schema definition and validation.
- MIT licensing.
- Hand-written, dependency-minimal codecs over pulling in heavyweight format libraries — see each package's own README for what it deliberately avoids depending on.
- The foundation and format-codec packages (`byte-codec`, `document-schema.js`, `document-outline.js`, `archive-codec`, `document-compute.js`, `ooxml.js`, `odf.js`, `markdown-codec`, `pdf-codec`, `documents.js`) are Worker-isomorphic: their published `src/` must not import `node:*`/bare Node builtins or use the Node-only `Buffer` global. The `no-restricted-imports`/`no-restricted-globals` ban enforcing that is defined once in the root's `eslint.shared.ts`, which derives the module list from `node:module`'s own `builtinModules` rather than restating it; a package opts in by passing `isomorphic: true` to `packageLintConfig` rather than declaring the rule itself, and a workerd test suite proves it at runtime. The interface packages (`document-cli`, `document-mcp`, `documents`) are not held to this, since they legitimately run under Node or a browser rather than needing Worker portability.

## Working in the workspace

```sh
pnpm install          # one install for every package
pnpm build            # tsdown per package, in dependency order, plus the web UI's vite build
pnpm lint             # eslint per package, plus the root's own tooling files
pnpm typecheck        # tsc per package (web-only and Node programs both, where a package has both)
pnpm test             # vitest unit suites
pnpm test:coverage    # the same suites with coverage
pnpm test:workers     # the same code inside workerd, the real Cloudflare Workers runtime
pnpm test:smoke       # each package's built dist/ exercised as a real artifact
pnpm test:corpus      # the real-world conformance corpora (gitignored, so local only)
```

Every one of these runs through turbo, so a package whose inputs have not changed replays a cached result rather than re-running.

To scope a run, drive turbo directly rather than adding a filter to the scripts above. The scripts name two task sets (the underscore tasks every package defines, and the web UI's plainly-named ones — see the pipeline note below), and turbo unions an explicitly named `package#task` with whatever `--filter` selects, so `pnpm test --filter=pdf-codec` would run the web UI's tests too:

```sh
pnpm exec turbo run _test --filter=pdf-codec           # one package and its dependencies
pnpm exec turbo run _test _build --affected            # whatever the current branch changed
pnpm exec turbo run documents#test                     # the web UI alone
```

Each package also keeps its own scripts, so `pnpm --dir packages/odf.js test:watch` (or running the script from inside that directory) still works for focused work on a single package.

### How the task pipeline is wired

`turbo.json` is the whole story, and two details in it are worth knowing before editing it.

The tasks the root pipeline runs are the underscore-prefixed ones (`_build`, `_lint`, `_test`, …). Each package already used that convention: its public `build` script was `turbo run _build`, and `_build` held the real command. Running the public names from the root would make turbo invoke those wrapper scripts, which invoke turbo again — the recursive-call case Turborepo's own documentation warns about. The root reaches straight past the wrappers to the leaf commands, and the wrappers stay usable inside a single package. The web UI predates the convention and names its scripts plainly, so it gets package-scoped `documents#…` entries instead.

Every task depends on `^_build` — its dependencies' builds. In the separate repositories a sibling arrived pre-built from the npm registry, so nothing needed building before a typecheck, lint, or test run. Here a sibling is a symlink into `packages/<name>`, whose `dist/` exists only once that package's own build has run, and `tsc`, type-aware ESLint, and vitest all resolve imports through it.

The same symlink is why `_test:smoke` orders itself on `^_test:smoke`, not just `^_build`: each package's own smoke script rebuilds `dist/` with `clean: true` before testing it, so two smoke tasks running concurrently could let one observe a sibling's `dist/` mid-clean — reproduced directly as a `document-mcp` smoke failure ("Failed to resolve entry for package documents.js") that only ever showed up in a parallel run. Ordering smoke tasks topologically means no package resolves through a dependency's `dist/` while that dependency is still rewriting it.

### Dependency ranges between packages

A dependency on a sibling is written as an ordinary semver range (`"document-schema.js": "^4.3.0"`), not `workspace:*`. With `linkWorkspacePackages: true` in `pnpm-workspace.yaml`, pnpm links the workspace copy whenever that range is satisfied by the version in `packages/`, and silently falls back to the npm registry when it is not. That fallback is the failure mode to watch for: a range left behind by an older release still installs, still typechecks, and still passes tests — against a published tarball rather than the sibling in this repository, with no topological edge for turbo to order and no reason for the two to agree. After bumping a package's major or minor version, check that every sibling range still admits it; `pnpm list --recursive --depth 0` shows which internal dependencies resolved to a workspace link and which to a registry version.

The release orchestrator maintains these ranges from then on: when a package releases, every dependent's range is rewritten, committed, and pushed before that dependent's own release runs.

## Releases

Releases run through [`@exadev/semantic-release-workspace`](https://github.com/ExaDev/semantic-release-workspace), configured by `release-workspace.config.json` and invoked as `pnpm release` from the `release` job in `.github/workflows/ci.yml`. One orchestrator run replaces the per-package release workflows the separate repositories each had:

- It discovers the packages from `pnpm-workspace.yaml`, builds the dependency graph from their manifests, and releases them in topological order, so a package is only published after every sibling it depends on.
- Each package's release is decided by its own commit history: `semantic-release` runs per package with the commit list path-filtered to that package's own directory, and tags in `name@version` form so every package's tags stay distinct in the one shared tag namespace.
- The moment a package releases, every not-yet-released dependent's dependency range is rewritten on disk, committed, and pushed — before that dependent's own release runs, so its published artifact and the repository never disagree. A package whose only change is such a bump still gets a patch release, because its published dependency range changed.
- Publishing itself is the standard plugin pipeline (`@semantic-release/changelog`, `npm`, `github`, `git`), scoped per package. npm authentication is OIDC trusted publishing: no `NPM_TOKEN` anywhere, `id-token: write` on the job, and deliberately no `registry-url` on `setup-node` — setting it writes an `.npmrc` `_authToken` line that wins over the OIDC exchange, so the input that looks like it configures the registry is the one that would break trusted publishing.
- The web UI is `private: true`, so `@semantic-release/npm` skips publishing it while still versioning, tagging, and changelogging it; its GitHub Pages deploy runs after the release job, building from the release commit.

Release configuration is **only** at the root. The orchestrator sets `tagFormat`, `plugins`, `analyzeCommits`, and `generateNotes` explicitly on every per-package run, so a `release.config.*` inside a package would be overridden by construction rather than honoured — which is why the per-package release configs are gone rather than kept alongside this one.

**Post-release republishing and attestation, restored:** the separate repositories' own per-package pipelines also republished each package under one or more alternate npm names (and, for several packages, under a `@exadev/<name>` scope to GitHub Packages), and signed an SPDX SBOM plus a build-provenance attestation against every release tarball. The orchestrator itself has no equivalent step, so three post-release jobs in the same CI workflow now provide it (previously [#732](https://github.com/ExaDev/documents.js/issues/732)): when the release job finishes, it diffs the `name@version` tags the orchestrator created and fans out over exactly the packages that released, each leg checking out its package's own release tag so a queued next release can never shift the tree under it. One matrix republishes each package that `.github/release-republish.json` maps to GitHub Packages (`npm pkg set` of the scoped name and a `publishConfig.registry` override at publish time — never a second package.json, so the mirror cannot drift from the real metadata); one matrix republishes under each alternate npm name the same map lists (`document-bytes`, `mrkdwn.js`, `pdf-codec.js`/`pdf-parser.js`, the five `document-schema.js` aliases, `js.documents`, `doculi`) via OIDC trusted publishing; one generates an SPDX SBOM (`pnpm sbom --sbom-format spdx --prod`), packs the shipped tarball, attests SBOM and build provenance against it with `actions/attest`, and attaches the raw SBOM to the package's GitHub Release. Nothing depends on these jobs, so a failure there can never block the release or the Pages deploy, and every leg skips as already-done on re-runs.

One user-only action remains before the npm aliases resume tracking their packages: each alias name's trusted publisher must be registered once against this repository and workflow, because trusted publishing is registered per package name and every alias's existing registration still names its archived standalone repository. Until an alias is registered, its publish leg skips with a notice rather than failing the job (the same graceful skip covers a legacy GitHub Packages mirror whose Actions-access list still names only its archived standalone repository — grant this repository Write on the package's settings page once, and the next release mirrors automatically); the registration is: sign in to [npmjs.com](https://www.npmjs.com) as a user with access to the package's settings → **Packages** → the alias (e.g. `document-bytes`) → **Settings** → **Trusted publisher** → select **GitHub Actions**, then enter Organization `ExaDev`, Repository `documents.js`, Workflow filename `ci.yml` (filename only — it must exist in `.github/workflows/`), leave the environment empty, and allow the `npm publish` action ([npm's trusted-publishers documentation](https://docs.npmjs.com/trusted-publishers) has the canonical form). The first release after that publishes under the alias automatically. The stranded aliases are tracked individually in [ExaDev/documents.js#727](https://github.com/ExaDev/documents.js/issues/727), [#728](https://github.com/ExaDev/documents.js/issues/728), [#729](https://github.com/ExaDev/documents.js/issues/729), [#730](https://github.com/ExaDev/documents.js/issues/730), [#731](https://github.com/ExaDev/documents.js/issues/731), and [#770](https://github.com/ExaDev/documents.js/issues/770).

`commitlint.config.ts` derives its allowed commit types from `release-workspace.config.json`'s own `releaseRules`, preserving the invariant each package's own config was built around: a conventional-commit type cannot trigger a release without also being accepted by commit-message validation, or the reverse.

## CI

`.github/workflows/ci.yml` holds one job per task — Commitlint, Lint, Typecheck, Test, Test (workerd), Smoke test — each running that task once across the workspace through turbo, followed by Release, its three post-release republish/attestation matrices (see Releases above), and the web UI's Pages deploy on `main`. On a pull request every turbo task runs with `--affected`, restricting work to the packages the branch changed and their dependents; on `main` the full workspace runs, so the caches later runs restore from are complete and the release gate covers everything. Each job restores turbo's cache keyed by task, so an unchanged package costs a cache replay rather than a rebuild. The Typecheck job additionally runs `attw --pack` across every published package after building it, checking that each package's declared types resolve under every module resolution mode — the web UI is excluded, since it publishes nothing and exposes no types.

Dependabot covers the root manifest and every package's, batching minor and patch updates into one pull request and leaving majors individual; `.github/workflows/dependabot-auto-merge.yml` auto-merges the former once CI is green. The cross-repository `sibling-released` dispatch the separate repositories used to propagate version bumps between themselves is gone: the orchestrator does that inside a single run now, in dependency order, without a pull request per bump.

## Naming note

The repository is named `documents.js`, and so is one of the packages inside it (`packages/documents.js`). They are not the same thing: the repository is this workspace, holding every package in the family, while `documents.js` is the specific published package that implements the conversion engine.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the git hooks and history conventions, and for the checklist to follow when adding a new package to the workspace.
