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
