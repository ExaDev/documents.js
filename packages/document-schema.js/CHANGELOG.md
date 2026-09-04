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
