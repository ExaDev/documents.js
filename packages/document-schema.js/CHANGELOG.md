## [7.6.1](https://github.com/ExaDev/documents.js/compare/document-schema.js%407.6.0...document-schema.js%407.6.1) (2026-09-10)

### Documentation

* state the npm aliases as registered and republishing ([8bb4de8](https://github.com/ExaDev/documents.js/commit/8bb4de80a954b7dc728776a761cf63a344eb6f71))

## [7.6.0](https://github.com/ExaDev/documents.js/compare/document-schema.js%407.5.1...document-schema.js%407.6.0) (2026-09-10)

### Features

* **document-schema.js:** give sections page-furniture slots for headers and footers ([c9acf39](https://github.com/ExaDev/documents.js/commit/c9acf39dd2b222d43667232b2691e818a5c4cae7))

## [7.5.1](https://github.com/ExaDev/documents.js/compare/document-schema.js%407.5.0...document-schema.js%407.5.1) (2026-09-08)

### Documentation

* **document-schema.js:** state that a construct's extent is its own heading and list scope ([beeda39](https://github.com/ExaDev/documents.js/commit/beeda397ea8e7fdd101673d53e0ba3c183c340ae))

## [7.5.0](https://github.com/ExaDev/documents.js/compare/document-schema.js%407.4.0...document-schema.js%407.5.0) (2026-09-08)

### Features

* **document-schema.js:** add a wpd residue format and a table cell formula field ([fb38b36](https://github.com/ExaDev/documents.js/commit/fb38b3629ceba300702cd40499e2426f7dbf6707))

## [7.4.0](https://github.com/ExaDev/documents.js/compare/document-schema.js%407.3.1...document-schema.js%407.4.0) (2026-09-08)

### Features

* **document-schema.js:** model gradient/bitmap/hatch fills, opacity, dash patterns ([31b0d73](https://github.com/ExaDev/documents.js/commit/31b0d733329114c8524545051543db77e272f3ec))

## [7.3.1](https://github.com/ExaDev/documents.js/compare/document-schema.js%407.3.0...document-schema.js%407.3.1) (2026-09-08)

### Bug Fixes

* **deps:** pin @vitest/coverage-v8 to match its vitest runner ([6912e0e](https://github.com/ExaDev/documents.js/commit/6912e0e5c602f0c21d9df12d2dc9899422bf5bd2))

### Miscellaneous Chores

* **deps:** pin every workspace dependency to an exact fixed version ([6a38142](https://github.com/ExaDev/documents.js/commit/6a38142facc043dfa499573f37431d3b32ff602e))

## [7.3.0](https://github.com/ExaDev/documents.js/compare/document-schema.js%407.2.0...document-schema.js%407.3.0) (2026-09-07)

### Features

* **document-schema.js:** add year-scoped time periods to ContentSheetConditionalFormat ([b38e855](https://github.com/ExaDev/documents.js/commit/b38e855b12a6a92e270ec592c34b0e3e0c8a8d54))

## [7.2.0](https://github.com/ExaDev/documents.js/compare/document-schema.js%407.1.0...document-schema.js%407.2.0) (2026-09-07)

### Features

* **document-schema.js:** add a format-agnostic floating-image position ([45193f1](https://github.com/ExaDev/documents.js/commit/45193f1be507372c65b28a37d59f36cac016fcce))

## [7.1.0](https://github.com/ExaDev/documents.js/compare/document-schema.js%407.0.0...document-schema.js%407.1.0) (2026-09-07)

### Features

* **document-schema.js:** add ContentParagraph.borders for direct paragraph border formatting ([abd7bd1](https://github.com/ExaDev/documents.js/commit/abd7bd175e6ac93beb3791f25726f1679aac720e))

## [7.0.0](https://github.com/ExaDev/documents.js/compare/document-schema.js%406.2.3...document-schema.js%407.0.0) (2026-09-07)

### ⚠ BREAKING CHANGES

* **document-schema.js:** close list nesting on a construct boundary in decomposeSection

### Bug Fixes

* **document-schema.js:** close list nesting on a construct boundary in decomposeSection ([9e2ee14](https://github.com/ExaDev/documents.js/commit/9e2ee14314774c3f85b619b14fcd2da4d050cb4d))

## [6.2.3](https://github.com/ExaDev/documents.js/compare/document-schema.js%406.2.2...document-schema.js%406.2.3) (2026-09-07)

### Bug Fixes

* **workspace:** narrow discriminated unions and Uint8Array generics in worker tests ([54e92fa](https://github.com/ExaDev/documents.js/commit/54e92fad8aabe767b3f8a33423de819468fb1b54))

## [6.2.2](https://github.com/ExaDev/documents.js/compare/document-schema.js%406.2.1...document-schema.js%406.2.2) (2026-09-07)

### Bug Fixes

* **document-schema.js:** make MathExpression and ContentBlock genuinely self-recursive schemas ([b785474](https://github.com/ExaDev/documents.js/commit/b785474ff3cd014b237dff43db66d8baf784fa86))

### Code Refactoring

* **document-schema.js:** compare generated JSON schema against live z.toJSONSchema() output ([596b627](https://github.com/ExaDev/documents.js/commit/596b627634256202bc715fa3b7b177a7401e435b))

## [6.2.1](https://github.com/ExaDev/documents.js/compare/document-schema.js%406.2.0...document-schema.js%406.2.1) (2026-09-07)

### Bug Fixes

* **odf.js:** recognise and write ODF's Preformatted_20_Text paragraph style ([8b2d518](https://github.com/ExaDev/documents.js/commit/8b2d518f2df6e5aad4a59aff6a3daded4263f5db)), closes [ExaDev/documents.js#1020](https://github.com/ExaDev/documents.js/issues/1020), references [994/#996](https://github.com/ExaDev/documents.js/issues/996)

## [6.2.0](https://github.com/ExaDev/documents.js/compare/document-schema.js%406.1.0...document-schema.js%406.2.0) (2026-09-06)

### Features

* **document-schema.js:** add preformatted flag distinguishing verbatim-whitespace paragraphs ([781cadc](https://github.com/ExaDev/documents.js/commit/781cadc4116834c8481634f73734103941721782))

### Documentation

* **document-schema.js:** note preformatted's actual reader coverage, not just its intent ([44f3c61](https://github.com/ExaDev/documents.js/commit/44f3c61e06ce32c64724a81f6862bd508cdf6c82)), references [ExaDev/documents.js#1020](https://github.com/ExaDev/documents.js/issues/1020)

## [6.1.0](https://github.com/ExaDev/documents.js/compare/document-schema.js%406.0.0...document-schema.js%406.1.0) (2026-09-06)

### Features

* **workspace:** add per-package Stryker mutation testing configuration ([ff3eacc](https://github.com/ExaDev/documents.js/commit/ff3eacc124577b163a1c13a63b83484d9611ae5a))

### Bug Fixes

* **workspace:** drop the unused per-package @stryker-mutator/api dependency ([69270b6](https://github.com/ExaDev/documents.js/commit/69270b6e7ad7163c3b76cd085f4e5f367433994c))

## [6.0.0](https://github.com/ExaDev/documents.js/compare/document-schema.js%405.6.0...document-schema.js%406.0.0) (2026-09-06)

### ⚠ BREAKING CHANGES

* **document-schema.js:** ContentTableCell.background and ContentSheetCell.background
  change type from Color to the discriminated ContentCellFill (a
  'solid'/'pattern' union). A caller reading a cell's background as a
  Color directly (e.g. cell.background.r) must switch on .kind and read
  .color for a 'solid' fill, or use the new resolveCellFillColor() helper
  to reduce either variant to a single representative Color. A caller
  constructing a ContentTableCell/ContentSheetCell with a bare Color
  background must wrap it as { kind: 'solid', color }.
* **document-schema.js:** MathMlNodeSchema silently strips unrecognised keys on
  parse instead of preserving them verbatim, now that plain z.object()
  member schemas replaced the z.custom() predicate that returned its input
  unchanged. The exported binding's type also narrowed from the concrete
  ZodCustom<MathMlNode, MathMlNode> to the abstract
  z.ZodType<MathMlNode, MathMlNode>, so code naming the concrete ZodCustom
  type explicitly no longer typechecks against it.

### Features

* **document-schema.js:** add discriminated pattern-fill shape for cell backgrounds ([2f0b65a](https://github.com/ExaDev/documents.js/commit/2f0b65a5b1f47f415a4636928fd0e10b0438bc83)), closes [#951](https://github.com/ExaDev/documents.js/issues/951)

### Bug Fixes

* **document-schema.js:** annotate MathMlNodeSchema's z.ZodType input, not just its output ([99935a5](https://github.com/ExaDev/documents.js/commit/99935a5e45e2515d013860a7c48259e1b199e47c))
* **document-schema.js:** defer MathML JSON Schema generation until first read ([fcb8429](https://github.com/ExaDev/documents.js/commit/fcb8429bb4b3f231d4d2a66bf13530615b4958f5))

### Code Refactoring

* **document-schema.js:** generate MathML JSON Schema $defs instead of hand-authoring them ([9d8e9ea](https://github.com/ExaDev/documents.js/commit/9d8e9ea3d70497d9b99d255ab1eac5db22104e3a))
* **document-schema.js:** host unrecognizedFillKind for every cell-fill writer ([855121a](https://github.com/ExaDev/documents.js/commit/855121a58523e0ad8f332e28be8def3454918bc7))
* **document-schema.js:** rewrite MathMlNodeSchema with z.lazy() instead of z.custom() ([4d235fe](https://github.com/ExaDev/documents.js/commit/4d235fe0d598d1ef25ad55262a4bcd2beb4cda90))

### Documentation

* **document-schema.js:** describe the MathML $defs accessors' real caching mechanism ([cd27fdf](https://github.com/ExaDev/documents.js/commit/cd27fdf5d4eeda2c5054f010414d13263d625d0a))
* **document-schema.js:** document MathMlNode's now-silent unknown-key stripping ([dee3cf6](https://github.com/ExaDev/documents.js/commit/dee3cf6960b436305d6969c078ad3881069278a0)), references [ExaDev/documents.js#937](https://github.com/ExaDev/documents.js/issues/937)
* **document-schema.js:** document the z.ZodType input-parameter gotcha z.codec() surfaced ([eb69229](https://github.com/ExaDev/documents.js/commit/eb692297c6d7359e332637463e8722767b58d42f))
* **document-schema.js:** fix MathMlElement comment's stale single-parameter ZodType spelling ([1956e3d](https://github.com/ExaDev/documents.js/commit/1956e3dd73de33d49f584335836d51d876861f30))
* **document-schema.js:** fix stale opaque-MathMlNodeSchema comment on ContentFormula ([6a176b9](https://github.com/ExaDev/documents.js/commit/6a176b9fb62fc11b9fd61357455d063b4fcc1443))
* **document-schema.js:** fix wrong location claim for CONTENT_DEFS's MathML getters ([9e4ee67](https://github.com/ExaDev/documents.js/commit/9e4ee6724c409773c852371b1ac72184d3a632b0))
* **document-schema.js:** mark the z.lazy() MathML rewrite as landed ([41a0c7c](https://github.com/ExaDev/documents.js/commit/41a0c7c4f980003b0b81cc6ca5d0b860e5187244)), references [ExaDev/documents.js#937](https://github.com/ExaDev/documents.js/issues/937)
* **document-schema.js:** rename stale MATHML_JSON_DEFS references ([526b258](https://github.com/ExaDev/documents.js/commit/526b25886dbc457d461611b4e116f2cfa5616c75))
* **document-schema.js:** stop claiming the MathML field-injection experiment left every test green ([598ac7e](https://github.com/ExaDev/documents.js/commit/598ac7e82980630029d5ae30f6b47d7f7701da1d))
* **document-schema.js:** stop claiming the MathML live comparison independently verifies drift ([a61f281](https://github.com/ExaDev/documents.js/commit/a61f281ad89bbd4ef573540ead2b931de7e77c73))
* **document-schema.js:** stop implying eager MathML JSON Schema generation ever shipped ([b97437a](https://github.com/ExaDev/documents.js/commit/b97437ac9c7abbc95bd95b779d11ada9277a252b)), references [ExaDev/documents.js#937](https://github.com/ExaDev/documents.js/issues/937)

### Tests

* **document-schema.js:** cover MathMlAttribute/Element/Node in the live JSON Schema comparison ([905014c](https://github.com/ExaDev/documents.js/commit/905014c540a722bc014bd329bbd093268a9a0d36))
* **document-schema.js:** stop claiming the MathML live comparison catches drift it can't ([2b72cbd](https://github.com/ExaDev/documents.js/commit/2b72cbd80223243723a13bcaae7410d346db2f83))

### Build System

* drop document-schema.js and pdf-codec from the test/workers typecheck fix ([6eb3f27](https://github.com/ExaDev/documents.js/commit/6eb3f2785e006481677cb73f6b802c5fd4bc3f53)), closes [#1021](https://github.com/ExaDev/documents.js/issues/1021), references [#1021](https://github.com/ExaDev/documents.js/issues/1021)
* typecheck test/workers across every package where it is currently clean ([f340428](https://github.com/ExaDev/documents.js/commit/f340428b51a669010c0c4e5edb4310fe6ea4789a)), closes [#1021](https://github.com/ExaDev/documents.js/issues/1021)

## [5.6.0](https://github.com/ExaDev/documents.js/compare/document-schema.js%405.5.1...document-schema.js%405.6.0) (2026-09-05)

### Features

* **document-schema.js:** add subscript, list format, cell/paragraph, and metadata fields ([186af90](https://github.com/ExaDev/documents.js/commit/186af907b9cd5ec5ac90d3687b2674bf7145d694))

## [5.5.1](https://github.com/ExaDev/documents.js/compare/document-schema.js%405.5.0...document-schema.js%405.5.1) (2026-09-04)

### Code Refactoring

* **document-schema.js:** host the named border-weight quantisation both Excel codecs need ([ae50b0c](https://github.com/ExaDev/documents.js/commit/ae50b0c9d7082200de7b504f41ab91b7e7809bc3))

## [5.5.0](https://github.com/ExaDev/documents.js/compare/document-schema.js%405.4.0...document-schema.js%405.5.0) (2026-09-03)

### Features

* **document-schema.js:** add rtf to the residue channel's format vocabulary ([583fe1f](https://github.com/ExaDev/documents.js/commit/583fe1fef15a0422cf0acd455c9d3271f7be292d))

## [5.4.0](https://github.com/ExaDev/documents.js/compare/document-schema.js%405.3.0...document-schema.js%405.4.0) (2026-09-02)

### Features

* **document-schema.js:** add epub to SourceFormatSchema ([dc0891b](https://github.com/ExaDev/documents.js/commit/dc0891bd0a811884bb69d07ff3ab414ac156aa9a))

### Bug Fixes

* **document-schema.js:** add epub to the SourceResidue JSON-Schema fragment ([20c790f](https://github.com/ExaDev/documents.js/commit/20c790f9b6f2954e1f41c5486043f3745038a91d))

## [5.3.0](https://github.com/ExaDev/documents.js/compare/document-schema.js%405.2.0...document-schema.js%405.3.0) (2026-09-02)

### Features

* **document-schema.js:** carry a sheet cell's own raw number-format code ([8b51a80](https://github.com/ExaDev/documents.js/commit/8b51a80eb50f0e02841f5ac194f7c1b1a3ff790f))

## [5.2.0](https://github.com/ExaDev/documents.js/compare/document-schema.js%405.1.0...document-schema.js%405.2.0) (2026-09-02)

### Features

* **document-schema.js:** add sheet dataValidation/conditionalFormatting vocabulary ([0cc8efd](https://github.com/ExaDev/documents.js/commit/0cc8efd8f584cfed96cade47866ffca970faf307))

### Miscellaneous Chores

* **release:** document-schema.js@5.2.0 [skip ci] ([53ec134](https://github.com/ExaDev/documents.js/commit/53ec1342c9d27f55d3322645d035622f10635aba))

## [5.2.0](https://github.com/ExaDev/documents.js/compare/document-schema.js%405.1.0...document-schema.js%405.2.0) (2026-09-02)

### Features

* **document-schema.js:** add sheet dataValidation/conditionalFormatting vocabulary ([60b4143](https://github.com/ExaDev/documents.js/commit/60b414324ecc92957ae2026a8a7a0af758dd8c09))

## [5.1.0](https://github.com/ExaDev/documents.js/compare/document-schema.js%405.0.0...document-schema.js%405.1.0) (2026-08-24)

### Features

* **eslint:** enable strictTypeChecked across the workspace ([67eec04](https://github.com/ExaDev/documents.js/commit/67eec04a380b25142f5d1afd11cb9906ff2cfd5f))
* **eslint:** lint JSON, Markdown, and YAML alongside the TypeScript ([016b127](https://github.com/ExaDev/documents.js/commit/016b127119733c50aa7694bad6265e9bc26bb215))

### Code Refactoring

* clear what strictTypeChecked's non-deviated rules found ([92a9fc9](https://github.com/ExaDev/documents.js/commit/92a9fc98f76244fca3a42ff0a12312ab0ce1a79b))
* **eslint:** move the seven preset-using packages onto the shared config ([f91e3a5](https://github.com/ExaDev/documents.js/commit/f91e3a5d8708424963f10ebb7f2db07a11b5ff45))
* **tsconfig:** share the strict compiler options through one base config ([43af382](https://github.com/ExaDev/documents.js/commit/43af382f726d7d42754ac0b6bf6d91b0ae302e25))

### Styles

* format the workspace with prettier ([56c3a1d](https://github.com/ExaDev/documents.js/commit/56c3a1dd1b0f05fbeccfc9b5e8b1d27ca97486b4))

### Miscellaneous Chores

* **deps:** drop the dependencies each package no longer uses ([80094aa](https://github.com/ExaDev/documents.js/commit/80094aa6db412392ef6e6457014d5963a5e910a7))

# [5.0.0](https://github.com/ExaDev/documents.js/compare/document-schema.js@4.10.0...document-schema.js@5.0.0) (2026-08-23)


* feat(document-schema.js)!: rename DocumentPackage to DocumentTree, land division's residue field ([d4e1a5a](https://github.com/ExaDev/documents.js/commit/d4e1a5ae816570060f22d2fec225b8f847016761)), closes [#743](https://github.com/ExaDev/documents.js/issues/743) [#661](https://github.com/ExaDev/documents.js/issues/661) [#743](https://github.com/ExaDev/documents.js/issues/743)


### BREAKING CHANGES

* DocumentPackage and the whole Package-rooted type
family (PackageNode/Group/Leaf/BlockLeaf, their *Schema and isPackageX
siblings, PackageChildren, assemblePackage, flattenPackage,
documentPackageWithSchema, the 'DocumentPackage' DocumentSchemaKind
literal) are renamed to their Tree-rooted equivalents. The published
document-package.schema.json file is renamed to document-tree.schema.json;
a dump stamped with the old $schema URI now throws
DocumentPackageRenamedError instead of parsing. DivisionDescriptor's
`source` field (the ODF text:section-source external-chapter link) is
renamed to `linked`; `source` now carries division's own quarantined
residue instead.

# [4.10.0](https://github.com/ExaDev/documents.js/compare/document-schema.js@4.9.1...document-schema.js@4.10.0) (2026-08-23)


### Features

* **schema:** add Quantity and FormulaBindings math schemas ([98e342d](https://github.com/ExaDev/documents.js/commit/98e342d233b516e73319b67afe66b062e3450ac3))

## [4.9.1](https://github.com/ExaDev/documents.js/compare/document-schema.js@4.9.0...document-schema.js@4.9.1) (2026-08-23)

# [4.9.0](https://github.com/ExaDev/documents.js/compare/document-schema.js@4.8.0...document-schema.js@4.9.0) (2026-08-22)


### Features

* **schema:** page-break paragraph properties on the node and styles-table halves ([25c072a](https://github.com/ExaDev/documents.js/commit/25c072aae01e337123aec16e2c705435e120c0b1))

# [4.8.0](https://github.com/ExaDev/documents.js/compare/document-schema.js@4.7.0...document-schema.js@4.8.0) (2026-08-21)


### Features

* **pdf:** read document language, mirror XMP Dublin Core, and quarantine package-level residue rows ([26b9f14](https://github.com/ExaDev/documents.js/commit/26b9f14edbaf48d7ed978bcfed7e294ac448ee1d))
* **schema:** task checked state, list-item identity, and code language as additive content fields ([0d57c70](https://github.com/ExaDev/documents.js/commit/0d57c70ce0d69a4be46340264b4c5972fa973d00))

# [4.7.0](https://github.com/ExaDev/documents.js/compare/document-schema.js@4.6.0...document-schema.js@4.7.0) (2026-08-21)


### Features

* **schema:** add the chart member to ContentEmbeddedObjectKind ([ec9fdad](https://github.com/ExaDev/documents.js/commit/ec9fdade9dea63fa76d6cac5524b2724f84d6854))

# [4.6.0](https://github.com/ExaDev/documents.js/compare/document-schema.js@4.5.0...document-schema.js@4.6.0) (2026-08-21)


### Features

* **schema:** add 'chart' to ContentEmbeddedObjectKind ([2527a9a](https://github.com/ExaDev/documents.js/commit/2527a9ac1a0dc083e8eb0360dc34d3daa741a803))
* **schema:** add ContentSection.breakType for the section-break kind ([9d023b6](https://github.com/ExaDev/documents.js/commit/9d023b6c0da77dbd120ec59244c1196a25983f5b))

# [4.5.0](https://github.com/ExaDev/documents.js/compare/document-schema.js@4.4.0...document-schema.js@4.5.0) (2026-08-21)


### Features

* add run-level construct extents as an optional constructs field on ContentParagraph ([3137cdf](https://github.com/ExaDev/documents.js/commit/3137cdfd9129b8c3132c73787f912dc1428c1984))
* read and write mid-paragraph docx bookmarks through run-level construct extents ([1d2079b](https://github.com/ExaDev/documents.js/commit/1d2079b0ecd0ad36ad011c1d5c295ec6bf01d38e))

# [4.4.0](https://github.com/ExaDev/documents.js/compare/document-schema.js@4.3.7...document-schema.js@4.4.0) (2026-08-20)


### Features

* **schema:** carry the source residue field on every content node a reader produces ([89f7a1d](https://github.com/ExaDev/documents.js/commit/89f7a1d9baae95f767b9e45868cc8c5d55019bf7))
* **schema:** define the quarantined source residue value ({ format, xml }) as its own module ([4d0b6f6](https://github.com/ExaDev/documents.js/commit/4d0b6f66f7c4ef59661e9ad884b8bca65f8c577e))
* **schema:** residue on construct descriptors (division excepted) and a package-level source table ([9e40c00](https://github.com/ExaDev/documents.js/commit/9e40c007e054426bbc4f25d7fbe0ecbcc1a2a821))

## [4.3.7](https://github.com/ExaDev/documents.js/compare/document-schema.js@4.3.6...document-schema.js@4.3.7) (2026-08-20)

## [4.3.6](https://github.com/ExaDev/documents.js/compare/document-schema.js@4.3.5...document-schema.js@4.3.6) (2026-08-20)

## [4.3.5](https://github.com/ExaDev/documents.js/compare/document-schema.js@4.3.4...document-schema.js@4.3.5) (2026-08-20)


### Bug Fixes

* point package homepage and bugs URLs at the monorepo, not the old standalone repos ([1b605e8](https://github.com/ExaDev/documents.js/commit/1b605e846393f417001227758a8606347c04e219))

## [4.3.4](https://github.com/ExaDev/documents.js/compare/document-schema.js@4.3.3...document-schema.js@4.3.4) (2026-08-20)


### Bug Fixes

* sync document-schema.js and documents versions with published state ([61ea77f](https://github.com/ExaDev/documents.js/commit/61ea77fdc4e23fb53b8c1f41fe786d36334d6d08))

## [4.3.1](https://github.com/ExaDev/documents.js/compare/document-schema.js@4.3.0...document-schema.js@4.3.1) (2026-08-20)


### Bug Fixes

* reconcile package versions/deps with published state, fix smoke-test build race ([da4caa7](https://github.com/ExaDev/documents.js/commit/da4caa76e885f644755311eea9f529040e41743a))

# [4.3.0](https://github.com/ExaDev/document-schema.js/compare/v4.2.0...v4.3.0) (2026-08-19)


### Features

* add the flat/tree structural transform beside the schemas it relates ([d97eff4](https://github.com/ExaDev/document-schema.js/commit/d97eff43ddf35a246df4ea09b138cc155ac4449e))
* export the package boundary from the public entry point ([02b0b66](https://github.com/ExaDev/document-schema.js/commit/02b0b66c8817b212bc61789a3b7f0162d0d9e862))

# [4.2.0](https://github.com/ExaDev/document-schema.js/compare/v4.1.0...v4.2.0) (2026-08-18)


### Features

* carry constructs in the flat form as matched boundary markers ([a61880d](https://github.com/ExaDev/document-schema.js/commit/a61880d5440c28e5daed3812d83118d8205b0fad))
* publish the boundary markers and the marker-free tree leaf as JSON Schema fragments ([447e7c2](https://github.com/ExaDev/document-schema.js/commit/447e7c271dcc27688931e6e461719899fce9a9a1))
* refuse construct boundary markers at package-tree leaf positions ([ea524dd](https://github.com/ExaDev/document-schema.js/commit/ea524dd5555390fafcc9823567f93bc6097ada28))

# [4.1.0](https://github.com/ExaDev/document-schema.js/compare/v4.0.0...v4.1.0) (2026-08-18)


### Features

* add the fidelity construct descriptor kinds ([3669943](https://github.com/ExaDev/document-schema.js/commit/366994331fcfd63744ae6f7ab90d9a10d7331aae)), closes [ExaDev/document-schema.js#22](https://github.com/ExaDev/document-schema.js/issues/22) [ExaDev/document-schema.js#24](https://github.com/ExaDev/document-schema.js/issues/24)
* admit construct groups at every block-flow position of the package tree ([15ca95b](https://github.com/ExaDev/document-schema.js/commit/15ca95b7c5d6942a021b50a3b114f34ae037ce70)), closes [ExaDev/document-schema.js#24](https://github.com/ExaDev/document-schema.js/issues/24)
* carry layers, attachments, and destinations tables at the package root ([15f9f72](https://github.com/ExaDev/document-schema.js/commit/15f9f72b2a7fc9766bc506b38ec3503d38729748)), closes [ExaDev/document-schema.js#24](https://github.com/ExaDev/document-schema.js/issues/24) [ExaDev/pdf-codec#66](https://github.com/ExaDev/pdf-codec/issues/66)

# [4.0.0](https://github.com/ExaDev/document-schema.js/compare/v3.3.0...v4.0.0) (2026-08-18)


### Bug Fixes

* reject wrapper keys outside node/style/children and style refs on bare package-tree leaves ([dc77740](https://github.com/ExaDev/document-schema.js/commit/dc77740d91e38699e02d6dfeadd70e2c1be3f4d3))


### Features

* pin the formula package arm to exactly one ContentFormula child ([4748c19](https://github.com/ExaDev/document-schema.js/commit/4748c195b16a2b2d2ef722bb9c2232e51e386d74))

# [3.3.0](https://github.com/ExaDev/document-schema.js/compare/v3.2.0...v3.3.0) (2026-08-17)


### Features

* make ContentListMembership.numId optional for depth-only list membership ([8c41086](https://github.com/ExaDev/document-schema.js/commit/8c410862ef2b16bde6202eed6e17198c0c7de747))

# [3.2.0](https://github.com/ExaDev/document-schema.js/compare/v3.1.0...v3.2.0) (2026-08-17)


### Features

* add the semantic math value schemas (rationals, units, symbol table, expression grammar) ([4455daa](https://github.com/ExaDev/document-schema.js/commit/4455daace215555c764fdda96142e26025ba993f))
* carry the two-layer math model on ContentFormula and a symbol table on every document arm ([3c7feae](https://github.com/ExaDev/document-schema.js/commit/3c7feae0a918c3b8efa696dc24493a08e78bc24f))

# [3.1.0](https://github.com/ExaDev/document-schema.js/compare/v3.0.0...v3.1.0) (2026-08-17)


### Features

* add optional comment field to ContentSheetCell ([b2160f6](https://github.com/ExaDev/document-schema.js/commit/b2160f666369b8b0bfbd38ae5f3b001529ccdf92))

# [3.0.0](https://github.com/ExaDev/document-schema.js/compare/v2.7.17...v3.0.0) (2026-08-17)


* feat!: fuse content and layout into a single DocumentPackage tree, add canonical headingLevel ([74f1f6b](https://github.com/ExaDev/document-schema.js/commit/74f1f6bef3c37cac1eaaa61d1ede7e6a4eaec012))


### BREAKING CHANGES

* DocumentPackageSchema no longer has a `layout` field.
A DocumentPackage produced against DOCUMENT_PACKAGE_FORMAT_VERSION 1
must be rebuilt: move each rendered position onto its own content
node's new `frames` field and replace the old `layout` value with a
`pages` array of page sizes. ContentDocumentSchema's own
CONTENT_FORMAT_VERSION moves from 2 to 3 for the new `frames` and
`headingLevel` fields.

## [2.7.17](https://github.com/ExaDev/document-schema.js/compare/v2.7.16...v2.7.17) (2026-08-17)

## [2.7.16](https://github.com/ExaDev/document-schema.js/compare/v2.7.15...v2.7.16) (2026-08-17)

## [2.7.15](https://github.com/ExaDev/document-schema.js/compare/v2.7.14...v2.7.15) (2026-08-17)

## [2.7.14](https://github.com/ExaDev/document-schema.js/compare/v2.7.13...v2.7.14) (2026-08-17)

## [2.7.13](https://github.com/ExaDev/document-schema.js/compare/v2.7.12...v2.7.13) (2026-08-13)

## [2.7.12](https://github.com/ExaDev/document-schema.js/compare/v2.7.11...v2.7.12) (2026-08-13)

## [2.7.11](https://github.com/ExaDev/document-schema.js/compare/v2.7.10...v2.7.11) (2026-08-12)

## [2.7.10](https://github.com/ExaDev/document-schema.js/compare/v2.7.9...v2.7.10) (2026-08-12)

## [2.7.9](https://github.com/ExaDev/document-schema.js/compare/v2.7.8...v2.7.9) (2026-08-12)


### Bug Fixes

* **commitlint:** exempt dependabot commits from body-max-line-length ([18df775](https://github.com/ExaDev/document-schema.js/commit/18df775972687f011c27b9612fe997f0ab8eb488))

## [2.7.8](https://github.com/ExaDev/document-schema.js/compare/v2.7.7...v2.7.8) (2026-08-12)

## [2.7.7](https://github.com/ExaDev/document-schema.js/compare/v2.7.6...v2.7.7) (2026-08-12)

## [2.7.6](https://github.com/ExaDev/document-schema.js/compare/v2.7.5...v2.7.6) (2026-08-10)

## [2.7.5](https://github.com/ExaDev/document-schema.js/compare/v2.7.4...v2.7.5) (2026-08-08)

## [2.7.4](https://github.com/ExaDev/document-schema.js/compare/v2.7.3...v2.7.4) (2026-08-07)

## [2.7.3](https://github.com/ExaDev/document-schema.js/compare/v2.7.2...v2.7.3) (2026-08-07)

## [2.7.2](https://github.com/ExaDev/document-schema.js/compare/v2.7.1...v2.7.2) (2026-08-07)

## [2.7.1](https://github.com/ExaDev/document-schema.js/compare/v2.7.0...v2.7.1) (2026-08-07)

# [2.7.0](https://github.com/ExaDev/document-schema.js/compare/v2.6.1...v2.7.0) (2026-08-07)


### Features

* add an autofix to the split-statement re-export rule ([2870b02](https://github.com/ExaDev/document-schema.js/commit/2870b02932ba03672b074dd3ff0fb499bbf6327e))

## [2.6.1](https://github.com/ExaDev/document-schema.js/compare/v2.6.0...v2.6.1) (2026-08-07)


### Bug Fixes

* render literal braces correctly and catch split-statement default re-exports ([677787d](https://github.com/ExaDev/document-schema.js/commit/677787d0ec9ba1434fda66def8c5c910cd323f56))

# [2.6.0](https://github.com/ExaDev/document-schema.js/compare/v2.5.3...v2.6.0) (2026-08-07)


### Features

* ban split-statement import-then-export re-exports ([dd19319](https://github.com/ExaDev/document-schema.js/commit/dd19319e9285ac850cb04e58d9da8e1ab5778e08))

## [2.5.3](https://github.com/ExaDev/document-schema.js/compare/v2.5.2...v2.5.3) (2026-08-06)

## [2.5.2](https://github.com/ExaDev/document-schema.js/compare/v2.5.1...v2.5.2) (2026-08-06)

## [2.5.1](https://github.com/ExaDev/document-schema.js/compare/v2.5.0...v2.5.1) (2026-08-06)

# [2.5.0](https://github.com/ExaDev/document-schema.js/compare/v2.4.8...v2.5.0) (2026-08-06)


### Features

* add canonical A1 cell-addressing utilities + FontFace type ([4285662](https://github.com/ExaDev/document-schema.js/commit/42856623ec34d3880859755855ae03c8c7dc0929))

## [2.4.8](https://github.com/ExaDev/document-schema.js/compare/v2.4.7...v2.4.8) (2026-08-06)

## [2.4.7](https://github.com/ExaDev/document-schema.js/compare/v2.4.6...v2.4.7) (2026-08-06)

## [2.4.6](https://github.com/ExaDev/document-schema.js/compare/v2.4.5...v2.4.6) (2026-08-06)

## [2.4.5](https://github.com/ExaDev/document-schema.js/compare/v2.4.4...v2.4.5) (2026-08-06)

## [2.4.4](https://github.com/ExaDev/document-schema.js/compare/v2.4.3...v2.4.4) (2026-08-06)

## [2.4.3](https://github.com/ExaDev/document-schema.js/compare/v2.4.2...v2.4.3) (2026-08-05)

## [2.4.2](https://github.com/ExaDev/document-schema.js/compare/v2.4.1...v2.4.2) (2026-08-05)

## [2.4.1](https://github.com/ExaDev/document-schema.js/compare/v2.4.0...v2.4.1) (2026-08-05)

# [2.4.0](https://github.com/ExaDev/document-schema.js/compare/v2.3.5...v2.4.0) (2026-08-05)


### Features

* host the layout/font/math port contracts pdf-codec used to own ([5490587](https://github.com/ExaDev/document-schema.js/commit/5490587cf707cef2b31396205e5ab1768b8676e2))

## [2.3.5](https://github.com/ExaDev/document-schema.js/compare/v2.3.4...v2.3.5) (2026-08-05)

## [2.3.4](https://github.com/ExaDev/document-schema.js/compare/v2.3.3...v2.3.4) (2026-08-04)

## [2.3.3](https://github.com/ExaDev/document-schema.js/compare/v2.3.2...v2.3.3) (2026-08-04)

## [2.3.2](https://github.com/ExaDev/document-schema.js/compare/v2.3.1...v2.3.2) (2026-08-04)

## [2.3.1](https://github.com/ExaDev/document-schema.js/compare/v2.3.0...v2.3.1) (2026-08-04)

# [2.3.0](https://github.com/ExaDev/document-schema.js/compare/v2.2.4...v2.3.0) (2026-08-04)


### Features

* add ContentCodec and LayoutCodec interfaces ([553e789](https://github.com/ExaDev/document-schema.js/commit/553e789d086dd302b0461201e4fbf7d371930564))

## [2.2.4](https://github.com/ExaDev/document-schema.js/compare/v2.2.3...v2.2.4) (2026-08-03)


### Bug Fixes

* **ci:** use pull_request_target so dependabot auto-merge can read secrets ([0806071](https://github.com/ExaDev/document-schema.js/commit/0806071a626ce74b9470d07788bc4089f325327a))

## [2.2.3](https://github.com/ExaDev/document-schema.js/compare/v2.2.2...v2.2.3) (2026-08-03)

## [2.2.2](https://github.com/ExaDev/document-schema.js/compare/v2.2.1...v2.2.2) (2026-08-03)

## [2.2.1](https://github.com/ExaDev/document-schema.js/compare/v2.2.0...v2.2.1) (2026-08-03)

# [2.2.0](https://github.com/ExaDev/document-schema.js/compare/v2.1.0...v2.2.0) (2026-08-03)


### Features

* add a cell-anchor position to ContentEmbeddedObject for sheet-anchored content ([258e032](https://github.com/ExaDev/document-schema.js/commit/258e032cfefddada72fd0e28ec28dc849ff1e6c9))

# [2.1.0](https://github.com/ExaDev/document-schema.js/compare/v2.0.0...v2.1.0) (2026-08-03)


### Features

* add a style field to LayoutLine and LayoutPath for stroke dash patterns ([4f5f49b](https://github.com/ExaDev/document-schema.js/commit/4f5f49b803ea710425fce42d2c2825fc311461f8))

# [2.0.0](https://github.com/ExaDev/document-schema.js/compare/v1.10.1...v2.0.0) (2026-08-02)


* feat!: add a real MathML ContentDocument kind and fix several breaking schema issues ([a73415e](https://github.com/ExaDev/document-schema.js/commit/a73415eaf174737ccc15646f4be4a88d25fea8f3))


### Features

* add an exactValue decimal-string sidecar for arbitrary-precision cell values ([2a5a616](https://github.com/ExaDev/document-schema.js/commit/2a5a616880d309b13b11b6bc3e57e79771eb4899))
* add vector rotation, stroke style, cell borders/alignment, and shared paint order ([cd96e21](https://github.com/ExaDev/document-schema.js/commit/cd96e217177026de046775bfcc9da6047aa4bbfe))


### BREAKING CHANGES

* CONTENT_FORMAT_VERSION bumped from 1 to 2;
ContentDocument has a fifth 'formula' variant,
so an exhaustive switch over its kinds no longer compiles;
ContentSheetPrintSettings.scale renamed to scalePercent;
ContentSheetColumn.widthPt/ContentSheetRow.heightPt are now optional and reject an explicit 0;
ContentCellValue has a new 'dateTime' kind.

## [1.10.1](https://github.com/ExaDev/document-schema.js/compare/v1.10.0...v1.10.1) (2026-08-02)

# [1.10.0](https://github.com/ExaDev/document-schema.js/compare/v1.9.1...v1.10.0) (2026-08-02)


### Features

* build one file per module, add wildcard deep-import exports ([bf7b002](https://github.com/ExaDev/document-schema.js/commit/bf7b00253ca8e4ab63b4e932d837d009bfee060e))

## [1.9.1](https://github.com/ExaDev/document-schema.js/compare/v1.9.0...v1.9.1) (2026-08-02)

# [1.9.0](https://github.com/ExaDev/document-schema.js/compare/v1.8.1...v1.9.0) (2026-08-02)


### Features

* ban anything but re-exports in src/index.ts ([ed2d482](https://github.com/ExaDev/document-schema.js/commit/ed2d48242c471cc34106e9e5164562ca6e4e4bc9))

## [1.8.1](https://github.com/ExaDev/document-schema.js/compare/v1.8.0...v1.8.1) (2026-08-02)


### Bug Fixes

* don't flag or fix an alias whose source is mutated elsewhere ([5802704](https://github.com/ExaDev/document-schema.js/commit/58027045e666135b6e52ffdfb411244d7cdc435d))

# [1.8.0](https://github.com/ExaDev/document-schema.js/compare/v1.7.1...v1.8.0) (2026-08-02)


### Features

* add custom pointless-reassignment autofix rule, ban re-exports outside src/index.ts ([0dd5dd9](https://github.com/ExaDev/document-schema.js/commit/0dd5dd9a750437a063603a8907beb74289adf8c8))

## [1.7.1](https://github.com/ExaDev/document-schema.js/compare/v1.7.0...v1.7.1) (2026-08-02)

# [1.7.0](https://github.com/ExaDev/document-schema.js/compare/v1.6.1...v1.7.0) (2026-08-02)


### Features

* emit and ingest self-describing JSON via $schema for the pivot types ([335e921](https://github.com/ExaDev/document-schema.js/commit/335e921e914b173d82f766b7356bdafbb320b77c))

## [1.6.1](https://github.com/ExaDev/document-schema.js/compare/v1.6.0...v1.6.1) (2026-08-01)


### Bug Fixes

* pin JSON Schema $id to jsdelivr npm version, not commit SHA ([c51e240](https://github.com/ExaDev/document-schema.js/commit/c51e2401178b8a890a4fc2c2fab2590e55743731))

# [1.6.0](https://github.com/ExaDev/document-schema.js/compare/v1.5.3...v1.6.0) (2026-08-01)


### Features

* publish JSON Schema files for DocumentPackage/ContentDocument/LayoutDocument ([b88bd8f](https://github.com/ExaDev/document-schema.js/commit/b88bd8f0cb59d1269afb09b2818d6f538f938fd3))

## [1.5.3](https://github.com/ExaDev/document-schema.js/compare/v1.5.2...v1.5.3) (2026-08-01)

## [1.5.2](https://github.com/ExaDev/document-schema.js/compare/v1.5.1...v1.5.2) (2026-08-01)

## [1.5.1](https://github.com/ExaDev/document-schema.js/compare/v1.5.0...v1.5.1) (2026-08-01)


### Bug Fixes

* split the GitHub Packages alias back into its own job ([40852fc](https://github.com/ExaDev/document-schema.js/commit/40852fc2fdf3eca852a4000ae4268e97da198735))

# [1.5.0](https://github.com/ExaDev/document-schema.js/compare/v1.4.0...v1.5.0) (2026-08-01)


### Bug Fixes

* update repository/homepage/bugs URLs to the renamed document-schema.js repo ([b823e65](https://github.com/ExaDev/document-schema.js/commit/b823e653084ab5a9fb254472be59c107d5b25bb1))


### Features

* publish package under five additional name aliases ([75591bf](https://github.com/ExaDev/document-schema.js/commit/75591bff1769beda45b8b96d8a7a4fb954ed0cf1))
* rename package to document-schema.js ([9bf01b7](https://github.com/ExaDev/document-schema.js/commit/9bf01b7b4114c547deec27b1a6b5b2ad491020eb))

# [1.4.0](https://github.com/ExaDev/document-content-model/compare/v1.3.0...v1.4.0) (2026-08-01)


### Features

* add DocumentPackageSchema, a content+layout superset envelope ([9cd33e6](https://github.com/ExaDev/document-content-model/commit/9cd33e6cf181885d1a1a22477b6dcb731ba0a4d3))

# [1.3.0](https://github.com/ExaDev/document-content-model/compare/v1.2.1...v1.3.0) (2026-07-31)


### Features

* add LayoutPath, a general vector-path item for the PDF pivot ([cb76475](https://github.com/ExaDev/document-content-model/commit/cb76475b64b34a6b543dd787ac869e5030d5823b))

## [1.2.1](https://github.com/ExaDev/document-content-model/compare/v1.2.0...v1.2.1) (2026-07-31)

# [1.2.0](https://github.com/ExaDev/document-content-model/compare/v1.1.1...v1.2.0) (2026-07-31)


### Features

* add spreadsheet/drawing ContentDocument variants and embedded-object recursion ([26cf115](https://github.com/ExaDev/document-content-model/commit/26cf1154c5d6bce06d9eaac5171786a4ca77698c))

## [1.1.1](https://github.com/ExaDev/document-content-model/compare/v1.1.0...v1.1.1) (2026-07-31)

# [1.1.0](https://github.com/ExaDev/document-content-model/compare/v1.0.1...v1.1.0) (2026-07-31)


### Features

* add sourcePath field linking LayoutItem to its ContentDocument origin ([108253e](https://github.com/ExaDev/document-content-model/commit/108253eed264474107b34649faac02dbdb4d2c4a))

## [1.0.1](https://github.com/ExaDev/document-content-model/compare/v1.0.0...v1.0.1) (2026-07-31)

# 1.0.0 (2026-07-31)


### Features

* add ContentDocument and LayoutDocument schema package ([ce72f13](https://github.com/ExaDev/document-content-model/commit/ce72f139c08535610cddf2aee2477efd209d3644))
