## [4.1.0](https://github.com/ExaDev/documents.js/compare/xls-codec%404.0.0...xls-codec%404.1.0) (2026-09-06)

### Features

* **workspace:** add per-package Stryker mutation testing configuration ([ff3eacc](https://github.com/ExaDev/documents.js/commit/ff3eacc124577b163a1c13a63b83484d9611ae5a))

### Bug Fixes

* **workspace:** drop the unused per-package @stryker-mutator/api dependency ([69270b6](https://github.com/ExaDev/documents.js/commit/69270b6e7ad7163c3b76cd085f4e5f367433994c))


### Dependencies

- Updated document-schema.js to ^6.1.0
- Updated excel-number-format to ^1.1.0
- Updated archive-codec to ^1.5.0

## [4.0.0](https://github.com/ExaDev/documents.js/compare/xls-codec%403.0.0...xls-codec%404.0.0) (2026-09-06)

### ⚠ BREAKING CHANGES

* **xls-codec:** WorkbookGlobals.sheetRanges' element type (and biff/ptg.ts's mirrored
  FormulaSheetContext.sheetRanges field) widens from `SheetRange | undefined` to `SheetRange |
  ExternalSheetLabel | undefined`. A consumer that narrowed only on `!== undefined` and read a
  SheetRange-only field (firstSheetIndex/lastSheetIndex) directly must now discriminate the two
  shapes first, e.g. via `"label" in entry`, before accessing either shape's own fields.

### Bug Fixes

* **xls-codec:** abort an array literal on a SerNil element instead of an empty position ([b4f326f](https://github.com/ExaDev/documents.js/commit/b4f326fe4046b3e6d2a7265ad81d187e921fe876))
* **xls-codec:** catch a malformed token inside an otherwise well-formed shared/array group ([ab78b78](https://github.com/ExaDev/documents.js/commit/ab78b78c05a21e10682d8e6b08c0902d207b8359))
* **xls-codec:** catch malformed Ptg tokens in a Formula record's own rgce too ([3732069](https://github.com/ExaDev/documents.js/commit/37320695abc1b94fb48073d15ad9a90caabdf708))
* **xls-codec:** check a virtPath's extracted final segment for brackets, not the path's own start ([2cd94e1](https://github.com/ExaDev/documents.js/commit/2cd94e189af4267c2a67587bd51a44e0be4eca66))
* **xls-codec:** degrade a malformed SupBook or array trailer, not abort the read ([5a156d0](https://github.com/ExaDev/documents.js/commit/5a156d0d6d30178d7d4f56dabba23b2f631edbff))
* **xls-codec:** degrade a ShrFmla/Array record whose declared length overruns its own bytes ([1117bad](https://github.com/ExaDev/documents.js/commit/1117bade58b3bedce21a01f526d963a4efd1e0c7))
* **xls-codec:** explain the bracket-rejection check as ambiguity, not a spec violation ([ab302c0](https://github.com/ExaDev/documents.js/commit/ab302c0f429665056df352e58ef31a3f7862daa8))
* **xls-codec:** guard an ordinary Formula record's own cce overrun ([e2d74a7](https://github.com/ExaDev/documents.js/commit/e2d74a7abf75adf1c7eceb9018a87aba2d7ddc5b))
* **xls-codec:** resolve add-in/DDE/OLE SupBook kinds before the -2 sentinel ([a045eda](https://github.com/ExaDev/documents.js/commit/a045edac494685c9ec668c15cedd3be5464096d4))
* **xls-codec:** resolve array formulas and array-constant literals via PtgArray/PtgExtraArray ([b728f2a](https://github.com/ExaDev/documents.js/commit/b728f2aa4060bd734d262adc345f7a3ded17b631))
* **xls-codec:** resolve external 3D references via SUPBOOK/EXTERNSHEET ([18ffb95](https://github.com/ExaDev/documents.js/commit/18ffb95d39ffdac5312d5edb312d33b8352dd9a2))
* **xls-codec:** resolve shared formulas via ShrFmla PtgExp join ([3c9ab40](https://github.com/ExaDev/documents.js/commit/3c9ab4045b856e561ea781115bd2975a7ffecafe))
* **xls-codec:** stop mangling a virtPath's simple-file-path and bracketed forms ([bbe1483](https://github.com/ExaDev/documents.js/commit/bbe1483079d2b5bd80d49b593702e87a50f2eee6))
* **xls-codec:** stop swallowing a genuine rgce-cursor bug in readFormula's own catch ([c85e539](https://github.com/ExaDev/documents.js/commit/c85e5397f783bf2fc3a24887f715134037619d6a))
* **xls-codec:** stop wrapping an array (CSE) formula in display-only braces ([ee3392c](https://github.com/ExaDev/documents.js/commit/ee3392ce5081ca927ccbd60d1e7555702bc1b709))

### Documentation

* **xls-codec:** correct fileNameFromVirtPath's stale special-case claim ([151340f](https://github.com/ExaDev/documents.js/commit/151340f5823d83785831f7024033f485aec0a120))
* **xls-codec:** document unresolvable 3D references and CSE bracing ([15bb7fb](https://github.com/ExaDev/documents.js/commit/15bb7fb8bf6f5645278f650358091a993542f0de))
* **xls-codec:** fix circular cross-reference in SERAR_FIXED_PAYLOAD_BYTES ([8740bb1](https://github.com/ExaDev/documents.js/commit/8740bb1ed368cea52e38b1318e53210193baf2f4))
* **xls-codec:** fix PtgRefN/PtgAreaN section citations ([8dbb1c4](https://github.com/ExaDev/documents.js/commit/8dbb1c44cbbdc6df7603ecf6458e9e8510bbc673))
* **xls-codec:** fix resolveSheetLabel's comment to match its own return ([5a375c2](https://github.com/ExaDev/documents.js/commit/5a375c2922b3c453bf642220c3f7b10963b1fe4e))
* **xls-codec:** fix VirtualPath bracket-ambiguity reasoning across a separator ([b4b5758](https://github.com/ExaDev/documents.js/commit/b4b57584011dac4e779dd3363c779d0121f4f118))
* **xls-codec:** fix XLUnicodeStringNoCch section citation ([d56b5da](https://github.com/ExaDev/documents.js/commit/d56b5da404decdc9280bb1be4a1bff3189b66222))
* **xls-codec:** justify the widened bracket rule by its real mangling hazard ([3760003](https://github.com/ExaDev/documents.js/commit/37600039ef1cd57f39436fea56af26406523ab9c))
* **xls-codec:** name every cursor read collectFormulaGroup's catch covers ([9c743b2](https://github.com/ExaDev/documents.js/commit/9c743b2679ae085a0dd4e6f99d8d2b50cc5bfc10))
* **xls-codec:** widen the README's bracket-rejection description to match the code ([c46f25f](https://github.com/ExaDev/documents.js/commit/c46f25fd9b5f9feaff37866cef615014ee5a1e7f))

### Tests

* **xls-codec:** cover a genuinely bracketed VirtualPath reached through a separator ([bed5ce5](https://github.com/ExaDev/documents.js/commit/bed5ce54e0eb415ae414b630183fdff73184f56b))
* **xls-codec:** cover a lying-length token in an ordinary and an array-group rgce ([3ea4fd6](https://github.com/ExaDev/documents.js/commit/3ea4fd6ab62dab0379884ecb684abdeb41e30ad5))
* **xls-codec:** cover a mixed absolute/relative shared formula and SerNil ([d811d2e](https://github.com/ExaDev/documents.js/commit/d811d2eefff005163bd67467fbf2e4391ff693e6))

## [3.0.0](https://github.com/ExaDev/documents.js/compare/xls-codec%402.0.2...xls-codec%403.0.0) (2026-09-06)

### ⚠ BREAKING CHANGES

* **xls-codec:** readXlsContent's ContentSheetCell.background is now a
  discriminated ContentCellFill rather than a bare Color, matching
  document-schema.js's own breaking change to the shared schema.
  writeXlsContent's cell background parameter changes the same way. A
  caller reading a solid background as a Color directly, or constructing
  one, must wrap/unwrap it as { kind: 'solid', color }.

### Features

* **xls-codec:** read and write real pattern fills instead of dropping them ([5bcc7f4](https://github.com/ExaDev/documents.js/commit/5bcc7f4cdcafb2e4365066087f0ce786d3c8caf9))

### Bug Fixes

* **xls-codec:** switch exhaustively on cell-fill kind instead of if/else ([bd87ce0](https://github.com/ExaDev/documents.js/commit/bd87ce0c9f2623199f7ac406ff1f13016fcc499e))
* **xls-codec:** update workers write test to the discriminated cell-fill shape ([1eb8901](https://github.com/ExaDev/documents.js/commit/1eb8901955898a8192b7f397b8feb41cca17816c)), references [pre-#951](https://github.com/pre-/issues/951)

### Code Refactoring

* **document-schema.js:** host unrecognizedFillKind for every cell-fill writer ([855121a](https://github.com/ExaDev/documents.js/commit/855121a58523e0ad8f332e28be8def3454918bc7))

### Documentation

* **xls-codec:** correct the grey-shade count in the FillPattern breakdown ([4700477](https://github.com/ExaDev/documents.js/commit/470047700905990e6e040b874ae322b2b8e13b1e))

### Build System

* **xls-codec:** typecheck test/workers so a schema-shape break fails at typecheck time ([490808e](https://github.com/ExaDev/documents.js/commit/490808e5f7d393a3d24ab6193667c02d75bb641f))


### Dependencies

- Updated document-schema.js to ^6.0.0
- Updated excel-number-format to ^1.0.2
- Updated archive-codec to ^1.4.3

## [2.0.2](https://github.com/ExaDev/documents.js/compare/xls-codec%402.0.1...xls-codec%402.0.2) (2026-09-05)

### Continuous Integration

* add the missing _test:coverage script to nine packages ([bc658d0](https://github.com/ExaDev/documents.js/commit/bc658d094b6ffbd0616cc225c57d5c0595374172))


### Dependencies

- Updated excel-number-format to ^1.0.1
- Updated archive-codec to ^1.4.2

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
