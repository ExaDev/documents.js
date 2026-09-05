## [2.0.1](https://github.com/ExaDev/documents.js/compare/xls-codec%402.0.0...xls-codec%402.0.1) (2026-09-05)


### Dependencies

- Updated document-schema.js to ^5.6.0
- Updated archive-codec to ^1.4.1

## [2.0.0](https://github.com/ExaDev/documents.js/compare/xls-codec%401.0.2...xls-codec%402.0.0) (2026-09-04)

### ⚠ BREAKING CHANGES

* **xls-codec:** readWorkbookStream is renamed to readWorkbookStreams
  and now returns { workbook, metadata } instead of a bare workbook byte
  array. A caller importing readWorkbookStream must switch to
  readWorkbookStreams and destructure the workbook field.

### Features

* **xls-codec:** add date-serial and column-width write conversions ([f8acb64](https://github.com/ExaDev/documents.js/commit/f8acb64d6c9a55a1628ad8a8b02522c05d855d28))
* **xls-codec:** add low-level BIFF8 record-writing primitives ([28201fc](https://github.com/ExaDev/documents.js/commit/28201fc2fdc3604fbe0a097ece10a82713ffcf00))
* **xls-codec:** add writeXlsContent/writeXls, real .xls output ([53c0aa2](https://github.com/ExaDev/documents.js/commit/53c0aa2be524fe765061870bd3d4bebf6c6f6006))
* **xls-codec:** parse BIFF8 Ptg token streams into formula text ([964fb72](https://github.com/ExaDev/documents.js/commit/964fb72bbddf5d8de72ef41144fa3906edf6875a))
* **xls-codec:** populate ContentSheetCell.formula from recovered Ptg expressions ([792f3e6](https://github.com/ExaDev/documents.js/commit/792f3e65797150b046bb547a4ffee4fda5df226b))
* **xls-codec:** read a cell's fill colour and per-side borders from its CellXF payload ([e2924b4](https://github.com/ExaDev/documents.js/commit/e2924b4e0cafaeded423616acdf2e5f31788f7f3))
* **xls-codec:** read and write a cell's own horizontal/vertical alignment ([f9662ba](https://github.com/ExaDev/documents.js/commit/f9662ba68a4e29b094be951edc365cd65f7da4bc))
* **xls-codec:** read and write a sheet's real print settings ([66a89d9](https://github.com/ExaDev/documents.js/commit/66a89d9db99f886b1a4546ae6258d91b3bfda072))
* **xls-codec:** read and write document metadata via SummaryInformation ([ab8b849](https://github.com/ExaDev/documents.js/commit/ab8b849df2ad42df04e1ac91a062d9d32be18adf))
* **xls-codec:** recover a Formula record's own expression text ([b545ebe](https://github.com/ExaDev/documents.js/commit/b545ebe2ce2c7d29039311fab2ac475937484f57))
* **xls-codec:** resolve a 3D reference's ixti to a sheet range ([8cae48d](https://github.com/ExaDev/documents.js/commit/8cae48d0b4b68c825bb6b7fbc0097b752bdf07e4))
* **xls-codec:** write a cell's fill colour and per-side borders into its CellXF payload ([4187b1d](https://github.com/ExaDev/documents.js/commit/4187b1d33dc1b33374ecb6ffce9dc0093712233c))

### Bug Fixes

* **xls-codec:** budget palette slots against the cells the writer actually emits ([a27a1c3](https://github.com/ExaDev/documents.js/commit/a27a1c347645a0853fdacc29770505c1a00b7196))
* **xls-codec:** carry a blank cell's own fill and borders in both directions ([1dd9688](https://github.com/ExaDev/documents.js/commit/1dd9688d7e4b145b67f27f88b2cb49b21eab71bb))
* **xls-codec:** clamp a print scale and fit-to-page count to their Setup fields ([6cbb947](https://github.com/ExaDev/documents.js/commit/6cbb947681ad80cb5c865b806ddb9cf246b7977d))
* **xls-codec:** mask PrintGrid's own single defined bit before testing it ([66c5776](https://github.com/ExaDev/documents.js/commit/66c57761035ce53dbbd11322ce1dceae72967bd5))
* **xls-codec:** refuse a Palette record whose ccv is not the 56 [MS-XLS] requires ([85f8dbe](https://github.com/ExaDev/documents.js/commit/85f8dbe796052518706b6e1b3457826636a575e9))
* **xls-codec:** refuse an XF-index lookup for a cell the interning pass never saw ([87faebd](https://github.com/ExaDev/documents.js/commit/87faebd858d9f48c6f4dc551ced23a7bde2b213f))
* **xls-codec:** reject a malformed createdIso/modifiedIso before the FILETIME conversion ([42fb3e4](https://github.com/ExaDev/documents.js/commit/42fb3e4cea175ded75f80f02c896d527feebe8aa))
* **xls-codec:** stop silently wrapping an out-of-grid print range, repeat band, or page break ([252e9cd](https://github.com/ExaDev/documents.js/commit/252e9cdc766b24133cb7ce71ca1161d1b486a43b))
* **xls-codec:** write an unnamed page size as custom paper, not as a failure ([11f7b27](https://github.com/ExaDev/documents.js/commit/11f7b2756154bb360774ff4460c028db605b5063))

### Code Refactoring

* **ooxml.js,xls-codec:** consume the shared excel-number-format classifier ([8b6cab4](https://github.com/ExaDev/documents.js/commit/8b6cab443a7e2c18ae8057c48c4448f67310c80c))
* **ppt-codec:** consume archive-codec's shared LayoutMetadata mapping ([7d0c81d](https://github.com/ExaDev/documents.js/commit/7d0c81d4842979eddf3a5ab0dc6e3201c390565a))
* **xls-codec:** consume archive-codec's shared LayoutMetadata mapping ([cdd11b0](https://github.com/ExaDev/documents.js/commit/cdd11b00f8d2ff2f57d1454493bada8dd4dea75f))
* **xls-codec:** resolve a cell's decoration once per cell, not twice ([da81182](https://github.com/ExaDev/documents.js/commit/da81182653da875c0cddd8c347cf2f7eb8635113))
* **xls-codec:** resolve BIFF8 border weights through the shared quantisation ([d267f5a](https://github.com/ExaDev/documents.js/commit/d267f5a64ca8bd3725f5d40b14f43a7a93d89f37))
* **xls-codec:** resolve BUILTIN_NUMBER_FORMATS from excel-number-format ([b151b0b](https://github.com/ExaDev/documents.js/commit/b151b0b81d68e51fac489acf532279f03c98e456))

### Documentation

* **xls-codec:** cite the Palette record as [MS-XLS] 2.4.188, not 2.4.204 ([456291e](https://github.com/ExaDev/documents.js/commit/456291e036da06523bf5bc36b8fecc47cd2813c6))
* **xls-codec:** document cell alignment as built and shipped ([55493cb](https://github.com/ExaDev/documents.js/commit/55493cb4d5690c6215bb575717eea3ba163d06d3))
* **xls-codec:** document cell decoration as read and write support, not a gap ([d451669](https://github.com/ExaDev/documents.js/commit/d4516697c9491d18ea9467ee87b5b047a752acd5))
* **xls-codec:** document formula-text recovery and its remaining boundary ([2ede1ca](https://github.com/ExaDev/documents.js/commit/2ede1cad2b3f670285afed42e29927889de94700))
* **xls-codec:** document print settings as built and shipped ([81b6264](https://github.com/ExaDev/documents.js/commit/81b626460be52a49b54e69ebb737dc64c96c1db2))
* **xls-codec:** document the new write support and its scope ([4192fe6](https://github.com/ExaDev/documents.js/commit/4192fe61d8a8b48ec3aa19bb5ff68ad982e00b23))
* **xls-codec:** fix stale claim that this package stands alone outside the conversion registry ([14a8cb6](https://github.com/ExaDev/documents.js/commit/14a8cb652a4a664f08cabba6bdcd8b6bbdd7eec3)), references [#881](https://github.com/ExaDev/documents.js/issues/881)
* **xls-codec:** record the LibreOffice check of a decorated blank cell ([26f60b5](https://github.com/ExaDev/documents.js/commit/26f60b5e411af3ebcf2d47cb386cdfab00b14a30))
* **xls-codec:** state what the LibreOffice check actually matched on borders ([6ba5518](https://github.com/ExaDev/documents.js/commit/6ba55181a17c39f2aaa296dec1f160d85864f52a))

### Tests

* **xls-codec:** cover cell alignment, fixing a shared XF fixture that assumed it was never read ([3c97bf8](https://github.com/ExaDev/documents.js/commit/3c97bf88a0a271dc57febc10c534a3fd8a8dcb24))
* **xls-codec:** cover cell decoration reading, writing, and round-tripping ([1ef0a53](https://github.com/ExaDev/documents.js/commit/1ef0a53bbefe680dfc48ad7afc70e8ce3229564e))
* **xls-codec:** cover the new print-settings modules in the deep-import smoke test ([b478302](https://github.com/ExaDev/documents.js/commit/b478302b22b2a349616527409603870da6b65f81))
* **xls-codec:** exercise the Palette path with a colour the default table lacks ([878ee0a](https://github.com/ExaDev/documents.js/commit/878ee0a9c03cd52abb6c24e2479ccde8c5fba553))
* **xls-codec:** name the Lbl record by its own constant, not a bare literal ([513d47b](https://github.com/ExaDev/documents.js/commit/513d47b7cfa4233b36a48f835428a4b7528f6528))


### Dependencies

- Updated document-schema.js to ^5.5.1
- Updated excel-number-format to ^1.0.0
- Updated archive-codec to ^1.4.0

## [1.0.2](https://github.com/ExaDev/documents.js/compare/xls-codec%401.0.1...xls-codec%401.0.2) (2026-09-03)


### Dependencies

- Updated document-schema.js to ^5.5.0

## [1.0.1](https://github.com/ExaDev/documents.js/compare/xls-codec%401.0.0...xls-codec%401.0.1) (2026-09-03)

### Documentation

* record that archive-codec writes compound files, not only reads them ([b8873e7](https://github.com/ExaDev/documents.js/commit/b8873e7336ecbe41e2fdb4ff19afadc94c2f65bd)), references [#815](https://github.com/ExaDev/documents.js/issues/815)


### Dependencies

- Updated archive-codec to ^1.3.0

## 1.0.0 (2026-09-03)

### Features

* **xls-codec:** decode RK numbers, error values, substreams, formats, serials ([2bd5e08](https://github.com/ExaDev/documents.js/commit/2bd5e08796c725b8b3d4e385bb6c099ab5dfb5a3))
* **xls-codec:** read a BIFF8 workbook into the shared content schema ([6bd9cc7](https://github.com/ExaDev/documents.js/commit/6bd9cc7a88730cccd8031b2877eac172d951123b))
* **xls-codec:** read the BIFF record framing, strings, and continuations ([64bb7b8](https://github.com/ExaDev/documents.js/commit/64bb7b8f00ddd039e2181394812c996331c39080))
* **xls-codec:** scaffold package for the legacy .xls binary format ([f1a61c8](https://github.com/ExaDev/documents.js/commit/f1a61c8df41b07d574df91531b3020e3af6b0f4e))

### Bug Fixes

* **xls-codec:** correct the row-height flag and find a shared formula's result ([f998ea5](https://github.com/ExaDev/documents.js/commit/f998ea571f66458719bfa4cd5faa127333bac8cc))

### Documentation

* **xls-codec:** link the classifier-duplication issue from its own module ([467341c](https://github.com/ExaDev/documents.js/commit/467341cc24392c83a9fb9e3cff4f2855a19a3cf0))
* **xls-codec:** state the reader's real coverage and its gaps ([fb854bd](https://github.com/ExaDev/documents.js/commit/fb854bdb481a50edf0c7ccc0026c0a00becc63c5))

### Styles

* **xls-codec:** normalise README emphasis markers to Prettier's form ([421519a](https://github.com/ExaDev/documents.js/commit/421519a42e934e5aca036d71bdd2fa0766c5ca3d))

### Tests

* **xls-codec:** validate the reader's output against the schema itself ([f34fcdc](https://github.com/ExaDev/documents.js/commit/f34fcdcee03b5ca26f654047266ba44b77b7b90a))
