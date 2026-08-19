## [4.0.1](https://github.com/ExaDev/ooxml.js/compare/v4.0.0...v4.0.1) (2026-08-19)

# [4.0.0](https://github.com/ExaDev/ooxml.js/compare/v3.1.1...v4.0.0) (2026-08-19)


* feat!: give each format a DocumentPackage-native reader and writer ([b092969](https://github.com/ExaDev/ooxml.js/commit/b0929697de91316971deaacbd6671c6743927ca7))


### Features

* re-export document-schema.js's style-resolution helpers from the barrel ([2f47b40](https://github.com/ExaDev/ooxml.js/commit/2f47b409b89c1683a5f85e91aee4f3a5a30251c8))


### BREAKING CHANGES

* readDocx, readPptx, and readXlsx keep their signatures but
return a DocumentPackage instead of DocxDocument, PptxDocument, and
XlsxWorkbook; buildDocxPackage and buildXlsxPackage take a DocumentPackage
instead of DocxContent and ContentDocument. Callers wanting the previous
behaviour move to readDocxContent, readPptxContent, readXlsxWorkbook,
buildDocxPackageFromContent, and buildXlsxPackageFromContent respectively.

## [3.1.1](https://github.com/ExaDev/ooxml.js/compare/v3.1.0...v3.1.1) (2026-08-19)

# [3.1.0](https://github.com/ExaDev/ooxml.js/compare/v3.0.1...v3.1.0) (2026-08-18)


### Bug Fixes

* **docx:** descend into a trailing construct wrapper to find a section break's paragraph ([9b9c01b](https://github.com/ExaDev/ooxml.js/commit/9b9c01becbb388497e6e27a4608b41d08389aaf5))
* **docx:** keep a pending page break attached to its paragraph through a construct, table, or image ([29780a3](https://github.com/ExaDev/ooxml.js/commit/29780a3c24567d27f25786152814d85f9d7578fd))
* **docx:** wrap a tracked change around a paragraph's own runs, never the paragraph ([2a230a6](https://github.com/ExaDev/ooxml.js/commit/2a230a6c45c098fd01c48659382c942f18b84ba5))
* **docx:** write a construct with no block-level docx element as plain content ([a7e6b02](https://github.com/ExaDev/ooxml.js/commit/a7e6b0233474ce7b0bc847cec0916debd2af5f01))
* **typed:** decode a relationship target's XML entities when resolving it ([6b04db9](https://github.com/ExaDev/ooxml.js/commit/6b04db9c70f9ef90d891e96c65afea15aa1ff149))


### Features

* **docx:** add buildDocxPackage, the write side of readDocx's sections ([b161ad9](https://github.com/ExaDev/ooxml.js/commit/b161ad90c963f21837da99e920f0e372e49a2629))
* **docx:** read block-scoped fields, bookmarks, SDTs, and tracked changes as construct markers ([48f3ef7](https://github.com/ExaDev/ooxml.js/commit/48f3ef74750a1a710b5d9dfb9af441064c7a4f48))

## [3.0.1](https://github.com/ExaDev/ooxml.js/compare/v3.0.0...v3.0.1) (2026-08-18)

# [3.0.0](https://github.com/ExaDev/ooxml.js/compare/v2.17.0...v3.0.0) (2026-08-18)


* feat!: drop ContentDocument formatVersion for document-schema.js 4.0.0 ([ae81880](https://github.com/ExaDev/ooxml.js/commit/ae8188057ea6d9066c3ca53c3cd405698acaf164)), closes [ExaDev/document-schema.js#20](https://github.com/ExaDev/document-schema.js/issues/20)


### BREAKING CHANGES

* readXlsxContent's emitted ContentDocument no longer
carries formatVersion and the CONTENT_FORMAT_VERSION barrel export is
removed; dependents must move to document-schema.js ^4.0.0 in
lockstep.

# [2.17.0](https://github.com/ExaDev/ooxml.js/compare/v2.16.1...v2.17.0) (2026-08-17)


### Features

* emit pptx paragraph outline levels from a:pPr/[@lvl](https://github.com/lvl) ([686252c](https://github.com/ExaDev/ooxml.js/commit/686252c3d02335c21393cc900158cd94d2524b1e))

## [2.16.1](https://github.com/ExaDev/ooxml.js/compare/v2.16.0...v2.16.1) (2026-08-17)

# [2.16.0](https://github.com/ExaDev/ooxml.js/compare/v2.15.0...v2.16.0) (2026-08-17)


### Features

* read pptx OLE graphic frames' fallback picture as an image block ([d5f5a30](https://github.com/ExaDev/ooxml.js/commit/d5f5a3013b052c08ecdde1a8771a3690dd5b1ef1))

# [2.15.0](https://github.com/ExaDev/ooxml.js/compare/v2.14.0...v2.15.0) (2026-08-17)


### Features

* read pptx SmartArt graphic frames' node text in diagram order ([1d54192](https://github.com/ExaDev/ooxml.js/commit/1d5419264b7180d6c1204f078eae927439f09f46))

# [2.14.0](https://github.com/ExaDev/ooxml.js/compare/v2.13.1...v2.14.0) (2026-08-17)


### Features

* read pptx chart graphic frames' cached series/category model as a table block ([4572909](https://github.com/ExaDev/ooxml.js/commit/4572909263e5bba01e852b2c49326888e56de461))

## [2.13.1](https://github.com/ExaDev/ooxml.js/compare/v2.13.0...v2.13.1) (2026-08-17)

# [2.13.0](https://github.com/ExaDev/ooxml.js/compare/v2.12.2...v2.13.0) (2026-08-17)


### Features

* read xlsx cell comments into ContentSheetCell.comment ([fcea960](https://github.com/ExaDev/ooxml.js/commit/fcea9606e24d0bfc7ff8c498effb5b7821fa7708))

## [2.12.2](https://github.com/ExaDev/ooxml.js/compare/v2.12.1...v2.12.2) (2026-08-17)

## [2.12.1](https://github.com/ExaDev/ooxml.js/compare/v2.12.0...v2.12.1) (2026-08-17)

# [2.12.0](https://github.com/ExaDev/ooxml.js/compare/v2.11.33...v2.12.0) (2026-08-17)


### Features

* resolve docx headingLevel from w:outlineLvl through the style cascade ([d46fab7](https://github.com/ExaDev/ooxml.js/commit/d46fab7de87cf000119b9031379a53b3eef791a7))

## [2.11.33](https://github.com/ExaDev/ooxml.js/compare/v2.11.32...v2.11.33) (2026-08-17)

## [2.11.32](https://github.com/ExaDev/ooxml.js/compare/v2.11.31...v2.11.32) (2026-08-17)

## [2.11.31](https://github.com/ExaDev/ooxml.js/compare/v2.11.30...v2.11.31) (2026-08-17)

## [2.11.30](https://github.com/ExaDev/ooxml.js/compare/v2.11.29...v2.11.30) (2026-08-17)

## [2.11.29](https://github.com/ExaDev/ooxml.js/compare/v2.11.28...v2.11.29) (2026-08-17)

## [2.11.28](https://github.com/ExaDev/ooxml.js/compare/v2.11.27...v2.11.28) (2026-08-14)

## [2.11.27](https://github.com/ExaDev/ooxml.js/compare/v2.11.26...v2.11.27) (2026-08-13)

## [2.11.26](https://github.com/ExaDev/ooxml.js/compare/v2.11.25...v2.11.26) (2026-08-13)

## [2.11.25](https://github.com/ExaDev/ooxml.js/compare/v2.11.24...v2.11.25) (2026-08-12)

## [2.11.24](https://github.com/ExaDev/ooxml.js/compare/v2.11.23...v2.11.24) (2026-08-12)

## [2.11.23](https://github.com/ExaDev/ooxml.js/compare/v2.11.22...v2.11.23) (2026-08-12)

## [2.11.22](https://github.com/ExaDev/ooxml.js/compare/v2.11.21...v2.11.22) (2026-08-12)

## [2.11.21](https://github.com/ExaDev/ooxml.js/compare/v2.11.20...v2.11.21) (2026-08-12)

## [2.11.20](https://github.com/ExaDev/ooxml.js/compare/v2.11.19...v2.11.20) (2026-08-12)

## [2.11.19](https://github.com/ExaDev/ooxml.js/compare/v2.11.18...v2.11.19) (2026-08-12)

## [2.11.18](https://github.com/ExaDev/ooxml.js/compare/v2.11.17...v2.11.18) (2026-08-12)


### Bug Fixes

* ignore dependabot commits in commitlint body-length check ([527e6f3](https://github.com/ExaDev/ooxml.js/commit/527e6f388028ce5fa2b9748fc638ca67ba48eee3))

## [2.11.17](https://github.com/ExaDev/ooxml.js/compare/v2.11.16...v2.11.17) (2026-08-12)

## [2.11.16](https://github.com/ExaDev/ooxml.js/compare/v2.11.15...v2.11.16) (2026-08-12)

## [2.11.15](https://github.com/ExaDev/ooxml.js/compare/v2.11.14...v2.11.15) (2026-08-12)

## [2.11.14](https://github.com/ExaDev/ooxml.js/compare/v2.11.13...v2.11.14) (2026-08-12)

## [2.11.13](https://github.com/ExaDev/ooxml.js/compare/v2.11.12...v2.11.13) (2026-08-12)

## [2.11.12](https://github.com/ExaDev/ooxml.js/compare/v2.11.11...v2.11.12) (2026-08-10)

## [2.11.11](https://github.com/ExaDev/ooxml.js/compare/v2.11.10...v2.11.11) (2026-08-10)

## [2.11.10](https://github.com/ExaDev/ooxml.js/compare/v2.11.9...v2.11.10) (2026-08-08)

## [2.11.9](https://github.com/ExaDev/ooxml.js/compare/v2.11.8...v2.11.9) (2026-08-08)

## [2.11.8](https://github.com/ExaDev/ooxml.js/compare/v2.11.7...v2.11.8) (2026-08-07)

## [2.11.7](https://github.com/ExaDev/ooxml.js/compare/v2.11.6...v2.11.7) (2026-08-07)

## [2.11.6](https://github.com/ExaDev/ooxml.js/compare/v2.11.5...v2.11.6) (2026-08-07)

## [2.11.5](https://github.com/ExaDev/ooxml.js/compare/v2.11.4...v2.11.5) (2026-08-07)

## [2.11.4](https://github.com/ExaDev/ooxml.js/compare/v2.11.3...v2.11.4) (2026-08-07)

## [2.11.3](https://github.com/ExaDev/ooxml.js/compare/v2.11.2...v2.11.3) (2026-08-07)

## [2.11.2](https://github.com/ExaDev/ooxml.js/compare/v2.11.1...v2.11.2) (2026-08-07)

## [2.11.1](https://github.com/ExaDev/ooxml.js/compare/v2.11.0...v2.11.1) (2026-08-07)

# [2.11.0](https://github.com/ExaDev/ooxml.js/compare/v2.10.3...v2.11.0) (2026-08-07)


### Features

* add an autofix to the split-statement re-export rule ([17d820e](https://github.com/ExaDev/ooxml.js/commit/17d820e176f6ae77315904dc34ba079685a3db64))

## [2.10.3](https://github.com/ExaDev/ooxml.js/compare/v2.10.2...v2.10.3) (2026-08-07)

## [2.10.2](https://github.com/ExaDev/ooxml.js/compare/v2.10.1...v2.10.2) (2026-08-07)


### Bug Fixes

* render literal braces correctly and catch split-statement default re-exports ([98cd285](https://github.com/ExaDev/ooxml.js/commit/98cd2850f9dd69a418bc3d33300232f68cbad6a5))

## [2.10.1](https://github.com/ExaDev/ooxml.js/compare/v2.10.0...v2.10.1) (2026-08-07)

# [2.10.0](https://github.com/ExaDev/ooxml.js/compare/v2.9.5...v2.10.0) (2026-08-07)


### Features

* **lint:** ban a re-export split across an import and a bare export ([207a1fa](https://github.com/ExaDev/ooxml.js/commit/207a1faa898374b14b40f9fd2cf8516c4c343b4a))

## [2.9.5](https://github.com/ExaDev/ooxml.js/compare/v2.9.4...v2.9.5) (2026-08-06)

## [2.9.4](https://github.com/ExaDev/ooxml.js/compare/v2.9.3...v2.9.4) (2026-08-06)

## [2.9.3](https://github.com/ExaDev/ooxml.js/compare/v2.9.2...v2.9.3) (2026-08-06)

## [2.9.2](https://github.com/ExaDev/ooxml.js/compare/v2.9.1...v2.9.2) (2026-08-06)

## [2.9.1](https://github.com/ExaDev/ooxml.js/compare/v2.9.0...v2.9.1) (2026-08-06)

# [2.9.0](https://github.com/ExaDev/ooxml.js/compare/v2.8.19...v2.9.0) (2026-08-06)


### Features

* cache typecheck/lint/test/build tasks with turbo ([e725735](https://github.com/ExaDev/ooxml.js/commit/e725735d8da77fffd327d6b01e9ada41337687e2))

## [2.8.19](https://github.com/ExaDev/ooxml.js/compare/v2.8.18...v2.8.19) (2026-08-06)

## [2.8.18](https://github.com/ExaDev/ooxml.js/compare/v2.8.17...v2.8.18) (2026-08-06)

## [2.8.17](https://github.com/ExaDev/ooxml.js/compare/v2.8.16...v2.8.17) (2026-08-06)

## [2.8.16](https://github.com/ExaDev/ooxml.js/compare/v2.8.15...v2.8.16) (2026-08-06)

## [2.8.15](https://github.com/ExaDev/ooxml.js/compare/v2.8.14...v2.8.15) (2026-08-06)

## [2.8.14](https://github.com/ExaDev/ooxml.js/compare/v2.8.13...v2.8.14) (2026-08-06)

## [2.8.13](https://github.com/ExaDev/ooxml.js/compare/v2.8.12...v2.8.13) (2026-08-06)

## [2.8.12](https://github.com/ExaDev/ooxml.js/compare/v2.8.11...v2.8.12) (2026-08-06)

## [2.8.11](https://github.com/ExaDev/ooxml.js/compare/v2.8.10...v2.8.11) (2026-08-06)

## [2.8.10](https://github.com/ExaDev/ooxml.js/compare/v2.8.9...v2.8.10) (2026-08-06)

## [2.8.9](https://github.com/ExaDev/ooxml.js/compare/v2.8.8...v2.8.9) (2026-08-06)

## [2.8.8](https://github.com/ExaDev/ooxml.js/compare/v2.8.7...v2.8.8) (2026-08-06)

## [2.8.7](https://github.com/ExaDev/ooxml.js/compare/v2.8.6...v2.8.7) (2026-08-05)

## [2.8.6](https://github.com/ExaDev/ooxml.js/compare/v2.8.5...v2.8.6) (2026-08-05)

## [2.8.5](https://github.com/ExaDev/ooxml.js/compare/v2.8.4...v2.8.5) (2026-08-05)

## [2.8.4](https://github.com/ExaDev/ooxml.js/compare/v2.8.3...v2.8.4) (2026-08-05)

## [2.8.3](https://github.com/ExaDev/ooxml.js/compare/v2.8.2...v2.8.3) (2026-08-05)

## [2.8.2](https://github.com/ExaDev/ooxml.js/compare/v2.8.1...v2.8.2) (2026-08-05)

## [2.8.1](https://github.com/ExaDev/ooxml.js/compare/v2.8.0...v2.8.1) (2026-08-05)

# [2.8.0](https://github.com/ExaDev/ooxml.js/compare/v2.7.0...v2.8.0) (2026-08-05)


### Features

* read w:trHeight into ContentTableRow.heightPt ([b6aaecd](https://github.com/ExaDev/ooxml.js/commit/b6aaecdbec6accd86dc606bdeffb2c4684ff829c))

# [2.7.0](https://github.com/ExaDev/ooxml.js/compare/v2.6.19...v2.7.0) (2026-08-05)


### Features

* read and write per-cell decoration (background/borders/alignment) in xlsx ([f3cd652](https://github.com/ExaDev/ooxml.js/commit/f3cd652c30411de752d98104c6667828bae91939))

## [2.6.19](https://github.com/ExaDev/ooxml.js/compare/v2.6.18...v2.6.19) (2026-08-04)

## [2.6.18](https://github.com/ExaDev/ooxml.js/compare/v2.6.17...v2.6.18) (2026-08-04)

## [2.6.17](https://github.com/ExaDev/ooxml.js/compare/v2.6.16...v2.6.17) (2026-08-04)

## [2.6.16](https://github.com/ExaDev/ooxml.js/compare/v2.6.15...v2.6.16) (2026-08-04)

## [2.6.15](https://github.com/ExaDev/ooxml.js/compare/v2.6.14...v2.6.15) (2026-08-04)

## [2.6.14](https://github.com/ExaDev/ooxml.js/compare/v2.6.13...v2.6.14) (2026-08-04)

## [2.6.13](https://github.com/ExaDev/ooxml.js/compare/v2.6.12...v2.6.13) (2026-08-04)


### Bug Fixes

* **ci:** self-heal stranded sibling-dependency PRs after they fall behind main ([871eb4b](https://github.com/ExaDev/ooxml.js/commit/871eb4b041c65fd09a218ec0393b500315176a26))

## [2.6.12](https://github.com/ExaDev/ooxml.js/compare/v2.6.11...v2.6.12) (2026-08-04)

## [2.6.11](https://github.com/ExaDev/ooxml.js/compare/v2.6.10...v2.6.11) (2026-08-04)

## [2.6.10](https://github.com/ExaDev/ooxml.js/compare/v2.6.9...v2.6.10) (2026-08-03)

## [2.6.9](https://github.com/ExaDev/ooxml.js/compare/v2.6.8...v2.6.9) (2026-08-03)


### Bug Fixes

* **ci:** use pull_request_target so dependabot auto-merge can read secrets ([ce64ee5](https://github.com/ExaDev/ooxml.js/commit/ce64ee5d1cbd774695c5a65506c34fc0e5cf9d4a))

## [2.6.8](https://github.com/ExaDev/ooxml.js/compare/v2.6.7...v2.6.8) (2026-08-03)


### Bug Fixes

* **ci:** wait for a real check-run to register before requesting auto-merge ([af8b755](https://github.com/ExaDev/ooxml.js/commit/af8b755a789bbb6c32963579cc24375bdd920d0c))

## [2.6.7](https://github.com/ExaDev/ooxml.js/compare/v2.6.6...v2.6.7) (2026-08-03)


### Bug Fixes

* **ci:** use the GitHub App token for the branch push and PR creation too ([1072f1d](https://github.com/ExaDev/ooxml.js/commit/1072f1db3f366c32345641e32d1cf397f2bb5f5e))

## [2.6.6](https://github.com/ExaDev/ooxml.js/compare/v2.6.5...v2.6.6) (2026-08-03)


### Bug Fixes

* **ci:** wrap the sibling-bump commit body onto two lines under commitlint's limit ([dacd602](https://github.com/ExaDev/ooxml.js/commit/dacd602b81738dbe0c56c4423edc8d4ada232a0e))

## [2.6.5](https://github.com/ExaDev/ooxml.js/compare/v2.6.4...v2.6.5) (2026-08-03)

## [2.6.4](https://github.com/ExaDev/ooxml.js/compare/v2.6.3...v2.6.4) (2026-08-03)

## [2.6.3](https://github.com/ExaDev/ooxml.js/compare/v2.6.2...v2.6.3) (2026-08-03)

## [2.6.2](https://github.com/ExaDev/ooxml.js/compare/v2.6.1...v2.6.2) (2026-08-03)

## [2.6.1](https://github.com/ExaDev/ooxml.js/compare/v2.6.0...v2.6.1) (2026-08-02)

# [2.6.0](https://github.com/ExaDev/ooxml.js/compare/v2.5.2...v2.6.0) (2026-08-02)


### Features

* compose pptx shape rotation through rotated/flipped ancestor groups ([df654b5](https://github.com/ExaDev/ooxml.js/commit/df654b599f782dc4eced03e8cc5108d542d47fd4))
* **docx:** model word/numbering.xml abstractNum/num level definitions ([9720b6d](https://github.com/ExaDev/ooxml.js/commit/9720b6d02c165152fcced15d0f32be0621cad9f1))
* **docx:** read table cell borders; wire numbering into readDocx ([5f73bef](https://github.com/ExaDev/ooxml.js/commit/5f73bef21c065c0a162355c5e7d25d1a55f9338c))
* **docx:** resolve w:themeColor run colours against the theme scheme ([34fd0fc](https://github.com/ExaDev/ooxml.js/commit/34fd0fcf56a9812900767e26905b64417ad31a76))
* read docx inline and floating images into ContentImageBlock ([017e764](https://github.com/ExaDev/ooxml.js/commit/017e76407907be43b36ef9809b88ff161fdb5a9c))
* read xlsx number formats into percentage/currency/date/time cell kinds ([bfab9f9](https://github.com/ExaDev/ooxml.js/commit/bfab9f9087c03ed6f637996a3ce2273768503820))
* write real xlsx number formats for percentage/currency/date/time/boolean cells ([abb25d6](https://github.com/ExaDev/ooxml.js/commit/abb25d62d84b1a388f122cf3fd1630c2146529fc))

## [2.5.2](https://github.com/ExaDev/ooxml.js/compare/v2.5.1...v2.5.2) (2026-08-02)


### Bug Fixes

* adapt xlsx read/write to document-schema.js's breaking schema changes ([03c3155](https://github.com/ExaDev/ooxml.js/commit/03c3155edf4be51b8a0c8bc842ac078ede4c0e9d))

## [2.5.1](https://github.com/ExaDev/ooxml.js/compare/v2.5.0...v2.5.1) (2026-08-02)

# [2.5.0](https://github.com/ExaDev/ooxml.js/compare/v2.4.1...v2.5.0) (2026-08-02)


### Features

* build one file per module, add wildcard deep-import exports ([f9d6cb6](https://github.com/ExaDev/ooxml.js/commit/f9d6cb6fda3ea193c5d9b98bc679740f597f389c))

## [2.4.1](https://github.com/ExaDev/ooxml.js/compare/v2.4.0...v2.4.1) (2026-08-02)

# [2.4.0](https://github.com/ExaDev/ooxml.js/compare/v2.3.1...v2.4.0) (2026-08-02)


### Features

* ban anything but re-exports in src/index.ts ([6ada89f](https://github.com/ExaDev/ooxml.js/commit/6ada89fc6bb2815b75780ccd7a41d521c752db7f))

## [2.3.1](https://github.com/ExaDev/ooxml.js/compare/v2.3.0...v2.3.1) (2026-08-02)


### Bug Fixes

* don't flag or fix an alias whose source is mutated elsewhere ([84eaa69](https://github.com/ExaDev/ooxml.js/commit/84eaa6939411372654c7be50e94abe5973a77013))

# [2.3.0](https://github.com/ExaDev/ooxml.js/compare/v2.2.5...v2.3.0) (2026-08-02)


### Features

* add custom pointless-reassignment autofix rule, ban re-exports outside src/index.ts ([266cb37](https://github.com/ExaDev/ooxml.js/commit/266cb3785946d3c16f60683c0316b8bc6eb247af))

## [2.2.5](https://github.com/ExaDev/ooxml.js/compare/v2.2.4...v2.2.5) (2026-08-02)

## [2.2.4](https://github.com/ExaDev/ooxml.js/compare/v2.2.3...v2.2.4) (2026-08-01)

## [2.2.3](https://github.com/ExaDev/ooxml.js/compare/v2.2.2...v2.2.3) (2026-08-01)

## [2.2.2](https://github.com/ExaDev/ooxml.js/compare/v2.2.1...v2.2.2) (2026-08-01)

## [2.2.1](https://github.com/ExaDev/ooxml.js/compare/v2.2.0...v2.2.1) (2026-08-01)

# [2.2.0](https://github.com/ExaDev/ooxml.js/compare/v2.1.1...v2.2.0) (2026-08-01)


### Features

* add buildXlsxPackage, the first xlsx writer in this ecosystem ([bfa9473](https://github.com/ExaDev/ooxml.js/commit/bfa9473c17b9e244f093147d5cd78c90f36642e2))
* add readXlsxContent, a geometry-and-print-settings-rich xlsx reader ([102f1f9](https://github.com/ExaDev/ooxml.js/commit/102f1f943105465f5932877317d562ebe04a88fe))
* export readXlsxContent/buildXlsxPackage from the public API ([bfe282b](https://github.com/ExaDev/ooxml.js/commit/bfe282b85f08dc38e149af27c3969b7b35ccaa0b))

## [2.1.1](https://github.com/ExaDev/ooxml.js/compare/v2.1.0...v2.1.1) (2026-07-31)

# [2.1.0](https://github.com/ExaDev/ooxml.js/compare/v2.0.4...v2.1.0) (2026-07-31)


### Features

* assign sourcePath on readDocx/readPptx content in document order ([536ee59](https://github.com/ExaDev/ooxml.js/commit/536ee59efbf1cdc333fb7e4fb358dd7f2d9f874c))

## [2.0.4](https://github.com/ExaDev/ooxml.js/compare/v2.0.3...v2.0.4) (2026-07-31)

## [2.0.3](https://github.com/ExaDev/ooxml.js/compare/v2.0.2...v2.0.3) (2026-07-31)

## [2.0.2](https://github.com/ExaDev/ooxml.js/compare/v2.0.1...v2.0.2) (2026-07-31)

## [2.0.1](https://github.com/ExaDev/ooxml.js/compare/v2.0.0...v2.0.1) (2026-07-31)

# [2.0.0](https://github.com/ExaDev/ooxml.js/compare/v1.3.1...v2.0.0) (2026-07-31)


* feat!: resolve style/theme cascades into readDocx sections and readPptx shapes ([e37fb03](https://github.com/ExaDev/ooxml.js/commit/e37fb0342e0b432e70d9ae6ab24d13929024217a))


### Bug Fixes

* update smoke test to readDocx's sections/blocks shape ([da798d9](https://github.com/ExaDev/ooxml.js/commit/da798d913a6b7e11b96b08fbf9afe875b48bd554))


### Features

* add shared OOXML content model and geometry/colour/unit primitives ([8d032f0](https://github.com/ExaDev/ooxml.js/commit/8d032f04dc3c0a37fa3a091df498af46f887b09d))


### BREAKING CHANGES

* DocxDocument's shape changes from
{ paragraphs, tables, hyperlinks, comments, footnotes, headers, footers }
to { metadata, sections, comments, footnotes, headers, footers } --
sections' ordered ContentBlock[] supersedes the separate paragraphs/
tables arrays, and each run's own resolved hyperlink field supersedes
the flat hyperlinks array. PptxPresentation is renamed PptxDocument and
its shape changes from { slides: [{ index, text, shapes: [{ text }],
tables, notes }] } to { metadata, slides: [{ size, shapes: [{ name,
frame, rotationDeg, insets, blocks }], notes }] } -- array position
supersedes the old index field, and each shape's own blocks (paragraphs/
tables/images) supersedes the separate flat shapes/tables arrays.

## [1.3.1](https://github.com/ExaDev/ooxml.js/compare/v1.3.0...v1.3.1) (2026-07-30)


### Bug Fixes

* stop readDocx paragraphs from duplicating table-cell paragraphs ([3215be4](https://github.com/ExaDev/ooxml.js/commit/3215be4f8ac8562655496e9f4878c2b37b3397f8))

# [1.3.0](https://github.com/ExaDev/ooxml.js/compare/v1.2.1...v1.3.0) (2026-07-30)


### Features

* export XML query helpers from typed/util for downstream packages ([5c39e48](https://github.com/ExaDev/ooxml.js/commit/5c39e48837ec7a192e2285bafd6c75994f31a17d))

## [1.2.1](https://github.com/ExaDev/ooxml.js/compare/v1.2.0...v1.2.1) (2026-07-30)


### Bug Fixes

* use the angular preset for release-notes-generator ([0ead019](https://github.com/ExaDev/ooxml.js/commit/0ead019e2e457d2d6cc0656e90d0d4c8af95294b))

# [1.2.0](https://github.com/ExaDev/ooxml.js/compare/v1.1.0...v1.2.0) (2026-07-30)


### Bug Fixes

* publish the GitHub Packages alias to its own registry ([c025b03](https://github.com/ExaDev/ooxml.js/commit/c025b03b7e0a22b2ca698609070dc04eb699fee1))


### Features

* derive commitlint's type-enum from release.config's commit types ([254f91c](https://github.com/ExaDev/ooxml.js/commit/254f91cf05e0def15f1542d49ecaf94f2b79e65e))

# [1.1.0](https://github.com/ExaDev/ooxml.js/compare/v1.0.0...v1.1.0) (2026-07-30)


### Features

* add ESLint and typescript-eslint, downgrading TypeScript to 6.x ([ea41494](https://github.com/ExaDev/ooxml.js/commit/ea4149448adb2c63479466207716492d027c7112))
* gate releases on a CI lint job ([482afd5](https://github.com/ExaDev/ooxml.js/commit/482afd5290eafc6e6765910aa1106661d40aed8d))

# 1.0.0 (2026-07-30)


### Bug Fixes

* load release config as plain JS, not TypeScript ([2e41a07](https://github.com/ExaDev/ooxml.js/commit/2e41a07f3f0985422b17ac775e822e93eae57cc0))
* preserve significant text whitespace in the XML parser ([3da5be1](https://github.com/ExaDev/ooxml.js/commit/3da5be1583a90c9bba96d655ccb30ea1e902e6f8))
* resolve CJS package types and add an ESM/CJS smoke test ([5d25ed2](https://github.com/ExaDev/ooxml.js/commit/5d25ed2d11f75fccbbc1338530f7f0fcd06c6284))


### Features

* add a direct bytes <-> CompactPackage codec ([d8e2336](https://github.com/ExaDev/ooxml.js/commit/d8e233600072300ebc218f4e3b094f8dbc488e4a))
* add CI workflow for release, GitHub Packages, and attestations ([1b396ae](https://github.com/ExaDev/ooxml.js/commit/1b396aef01fd5d48130f0aaad2bbde9595ae86e9))
* add lossless generic OOXML<->JSON package codec ([6913eb5](https://github.com/ExaDev/ooxml.js/commit/6913eb5daabc860c04ceb760cfd42da98966fd77))
* add the ooxml.js format (compact-JSON codec layer) ([8a03ce6](https://github.com/ExaDev/ooxml.js/commit/8a03ce6a1d8c76c13247e418c700c6c9cee3b744))
* automate releases and npm publishing with semantic-release ([a146766](https://github.com/ExaDev/ooxml.js/commit/a146766f876d5ac43c6c8af05ae96d6675d74515))
* **docx:** add docx typed projection reader ([5508daf](https://github.com/ExaDev/ooxml.js/commit/5508dafab6e69eaca2892f4a58cd9bc70ded1148))
* **docx:** expand typed reader with tables, hyperlinks, and metadata ([dbe4cec](https://github.com/ExaDev/ooxml.js/commit/dbe4cec226bfc5a73211d583a3dfac8224f4da49))
* export the expanded typed schemas and refresh the README ([ab10d3b](https://github.com/ExaDev/ooxml.js/commit/ab10d3b76ae49bc4f8dc3ad4b272a0c0f56d82a1))
* export typed readers from the package barrel ([20a8d6b](https://github.com/ExaDev/ooxml.js/commit/20a8d6bc59ef871dfa28fed1949f41d67c717a96))
* **pptx:** add pptx typed projection reader ([bc45fa3](https://github.com/ExaDev/ooxml.js/commit/bc45fa352278ca243141e1e7746f8b7f7af54ee5))
* **pptx:** expand typed reader with shapes, tables, and notes ([f4f18db](https://github.com/ExaDev/ooxml.js/commit/f4f18db46764d020831e187a7aa32258d97539e7))
* **test:** migrate smoke test to Vitest project ([f9ca35c](https://github.com/ExaDev/ooxml.js/commit/f9ca35c1f684d918ae66417b22c08e1f09d28428))
* **typed:** add a shared relationship resolver ([ffd3c74](https://github.com/ExaDev/ooxml.js/commit/ffd3c7456fd9aad2360a26a9b3a24d81fad50f80))
* **xlsx:** add xlsx typed projection reader ([b7293bb](https://github.com/ExaDev/ooxml.js/commit/b7293bb8f005e7e5f4927403aa9949c63f91f081))
* **xlsx:** expand typed reader with formulas, merges, and defined names ([a650a48](https://github.com/ExaDev/ooxml.js/commit/a650a48d135982cf1f90dc4f3da4d26766633e85))
