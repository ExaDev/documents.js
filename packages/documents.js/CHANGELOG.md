## [1.60.1](https://github.com/ExaDev/documents.js/compare/v1.60.0...v1.60.1) (2026-08-02)

# [1.60.0](https://github.com/ExaDev/documents.js/compare/v1.59.0...v1.60.0) (2026-08-02)


### Bug Fixes

* pin markdown-codec to its final commit and unblock its build script ([2486f76](https://github.com/ExaDev/documents.js/commit/2486f7691ba97307aacad57f58eb3f79bae6916c))
* re-pin markdown-codec to its prebuilt-dist commit ([e453317](https://github.com/ExaDev/documents.js/commit/e4533177e2f18b979e754808a5d63943d71290c8))


### Features

* add markdown reader/writer adapters ([94783f3](https://github.com/ExaDev/documents.js/commit/94783f3f2e6053526e7b830da825e928e6f1b597))
* wire markdown into the conversion port ([d9c4fbb](https://github.com/ExaDev/documents.js/commit/d9c4fbba686ceb15f84fcd145127408f5253df51))

# [1.59.0](https://github.com/ExaDev/documents.js/compare/v1.58.0...v1.59.0) (2026-08-02)


### Bug Fixes

* write ods column width and row height instead of dropping them ([ef1afd6](https://github.com/ExaDev/documents.js/commit/ef1afd6f476b5227848ad9c8347c5d44eb809ed8))


### Features

* add xlsxToPdf/pdfToXlsx via ods-composed conversion path ([36e810d](https://github.com/ExaDev/documents.js/commit/36e810d77d9f707381c883e6a49a18c579c38830))

# [1.58.0](https://github.com/ExaDev/documents.js/compare/v1.57.1...v1.58.0) (2026-08-02)


### Features

* build one file per module, add wildcard deep-import exports ([f3cef55](https://github.com/ExaDev/documents.js/commit/f3cef55a8aa1ec0d9bca4e60605ce839912366c9))

## [1.57.1](https://github.com/ExaDev/documents.js/compare/v1.57.0...v1.57.1) (2026-08-02)

# [1.57.0](https://github.com/ExaDev/documents.js/compare/v1.56.1...v1.57.0) (2026-08-02)


### Features

* ban anything but re-exports in src/index.ts ([8e39efd](https://github.com/ExaDev/documents.js/commit/8e39efd1ab2710ab42f08a2a6005c5f40c903b6c))

## [1.56.1](https://github.com/ExaDev/documents.js/compare/v1.56.0...v1.56.1) (2026-08-02)


### Bug Fixes

* don't flag or fix an alias whose source is mutated elsewhere ([6816c25](https://github.com/ExaDev/documents.js/commit/6816c2541a1d0c3579b99fdc7ee2b5bdaa31c102))

# [1.56.0](https://github.com/ExaDev/documents.js/compare/v1.55.0...v1.56.0) (2026-08-02)


### Features

* add custom pointless-reassignment autofix rule, ban re-exports outside src/index.ts ([bbc66c8](https://github.com/ExaDev/documents.js/commit/bbc66c8b1b8a0b4893d4ec75572d5b382f589707))

# [1.55.0](https://github.com/ExaDev/documents.js/compare/v1.54.6...v1.55.0) (2026-08-02)


### Features

* re-export document-schema.js's $schema emit/ingest helpers ([7616060](https://github.com/ExaDev/documents.js/commit/7616060d685786b75474fcf17adf7e4803f1e567))

## [1.54.6](https://github.com/ExaDev/documents.js/compare/v1.54.5...v1.54.6) (2026-08-02)

## [1.54.5](https://github.com/ExaDev/documents.js/compare/v1.54.4...v1.54.5) (2026-08-01)

## [1.54.4](https://github.com/ExaDev/documents.js/compare/v1.54.3...v1.54.4) (2026-08-01)

## [1.54.3](https://github.com/ExaDev/documents.js/compare/v1.54.2...v1.54.3) (2026-08-01)

## [1.54.2](https://github.com/ExaDev/documents.js/compare/v1.54.1...v1.54.2) (2026-08-01)

## [1.54.1](https://github.com/ExaDev/documents.js/compare/v1.54.0...v1.54.1) (2026-08-01)

# [1.54.0](https://github.com/ExaDev/documents.js/compare/v1.53.3...v1.54.0) (2026-08-01)


### Features

* publish js.documents as an additional npm alias ([3cbe604](https://github.com/ExaDev/documents.js/commit/3cbe604b3f53b0f9965dd2e119cfb8573d26bac3))

## [1.53.3](https://github.com/ExaDev/documents.js/compare/v1.53.2...v1.53.3) (2026-08-01)

## [1.53.2](https://github.com/ExaDev/documents.js/compare/v1.53.1...v1.53.2) (2026-08-01)

## [1.53.1](https://github.com/ExaDev/documents.js/compare/v1.53.0...v1.53.1) (2026-08-01)

# [1.53.0](https://github.com/ExaDev/documents.js/compare/v1.52.0...v1.53.0) (2026-08-01)


### Features

* export CACHED-table .odb decoding from the public API ([424340b](https://github.com/ExaDev/documents.js/commit/424340bd10d8a10959b35c0984c1be93e7755a8a))
* **firebird:** add a Firebird gbak backup format reader for .odb Tier 3 ([52063e0](https://github.com/ExaDev/documents.js/commit/52063e07b6796dd58f4ca7baedb214817caac53a))
* **hsqldb:** decode HSQLDB 1.8.x binary field encoding for CACHED-table rows ([7e86f32](https://github.com/ExaDev/documents.js/commit/7e86f3297e1aa7d06107ef3e5ff544e7948ece92))
* **hsqldb:** walk a CACHED table's own row-store tree from its SET TABLE INDEX root ([b5c7eb4](https://github.com/ExaDev/documents.js/commit/b5c7eb43b0c081db0ab87fd3bb26ecc099118d75))
* **odb:** add .odb Tier 2 HSQLDB CACHED-table (binary row-store) decoding ([968b957](https://github.com/ExaDev/documents.js/commit/968b957351f5634fc791e8374ef2fca94fb06a47))
* **odb:** add .odb Tier 3 Firebird gbak backup format decoding ([786d324](https://github.com/ExaDev/documents.js/commit/786d32442b6d318e3afe43946c4440e793b595af))
* **odb:** route Firebird-embedded .odb packages to readFirebirdBackup ([10d56ba](https://github.com/ExaDev/documents.js/commit/10d56bae312aec1fc32e792212e562ece9e6cefd))
* **odb:** splice CACHED-table rows into readOdbTables; fix compressed-script detection ([a4e4464](https://github.com/ExaDev/documents.js/commit/a4e44649ace07e54cd7d74c86543b26cfbc1d448))

# [1.52.0](https://github.com/ExaDev/documents.js/compare/v1.51.0...v1.52.0) (2026-08-01)


### Features

* **convert:** add onDocument callback exposing the built DocumentPackage ([50e7234](https://github.com/ExaDev/documents.js/commit/50e72346ea31df59bc27693784bd19a9a05c78e0))
* **convert:** surface DocumentPackage through ConversionResult ([b996a7e](https://github.com/ExaDev/documents.js/commit/b996a7ee9863cb2a429cb8c72af8a6070835ce17))

# [1.51.0](https://github.com/ExaDev/documents.js/compare/v1.50.0...v1.51.0) (2026-08-01)


### Features

* add .odb Tier 1 HSQLDB text-script table export ([dee2b3b](https://github.com/ExaDev/documents.js/commit/dee2b3b7e1c492dff7a291dcce66500b8c138e1e))
* add .odb Tier 1 table extraction and xlsx/CSV conversion ([b9bec5c](https://github.com/ExaDev/documents.js/commit/b9bec5c299fffd08b1dabbd691a642ffe7d494cc))
* add a bounded HSQLDB TEXT-script parser ([9b15941](https://github.com/ExaDev/documents.js/commit/9b15941357a23a3cf731ac4de7ef9cecb4f7bb6e))
* add MathML formula rendering for odf-to-PDF conversion ([07ab210](https://github.com/ExaDev/documents.js/commit/07ab210fb4ec0b3ab97c5d842f70bdab89bdcf94))
* **convert:** add odfToPdf for standalone ODF formula documents ([806ad90](https://github.com/ExaDev/documents.js/commit/806ad90a813ea8dacf6fc3f955e11beefbb74eb0))
* export the MathML typesetting engine and formula public API ([b0c3e0e](https://github.com/ExaDev/documents.js/commit/b0c3e0ebb5e008f977d9e43ae09aba5c7d5ee074))
* **layout:** render embedded formulas during wordprocessing and presentation layout ([8efb484](https://github.com/ExaDev/documents.js/commit/8efb484b7640bd56d3dfa0904a32c7860f906553))
* **mathml:** add MathML presentation-layer typesetting engine ([33d23a3](https://github.com/ExaDev/documents.js/commit/33d23a315d9bfd29a39922eada93db165e629d25))
* **odf:** detect embedded formula objects in odt and odp ([298e242](https://github.com/ExaDev/documents.js/commit/298e2424c014bf34d8df1b9dab7aa65ca0abde7b))
* **pdf:** embed STIX Two Math for PDF formula rendering ([04f9550](https://github.com/ExaDev/documents.js/commit/04f9550c71b00c85c0f3205b2dcdc2f12352f476))

# [1.50.0](https://github.com/ExaDev/documents.js/compare/v1.49.0...v1.50.0) (2026-08-01)


### Bug Fixes

* merge duplicate odf.js entries in minimumReleaseAgeExclude into one ([cf07732](https://github.com/ExaDev/documents.js/commit/cf077322a49cf82f72b932c2c20757f6780d9d8a))


### Features

* add odmToPdf, concatenating ODF master-document chapters through the odt flow engine ([caf9a1b](https://github.com/ExaDev/documents.js/commit/caf9a1b797c277e345b569f5fa2a720b09792021))

# [1.49.0](https://github.com/ExaDev/documents.js/compare/v1.48.0...v1.49.0) (2026-08-01)


### Bug Fixes

* write paragraph list membership and styleId back through buildDocxPackage/buildOdtPackage ([df6d549](https://github.com/ExaDev/documents.js/commit/df6d549a86e728dd02abce94c7d5931f865dca1e))


### Features

* add cross-format bridges (odt<->docx, odp<->pptx, ods<->xlsx) bypassing PDF ([4a1e42f](https://github.com/ExaDev/documents.js/commit/4a1e42f09b48e92949cc7d30ad8fdb6111a6c2f1))

# [1.48.0](https://github.com/ExaDev/documents.js/compare/v1.47.0...v1.48.0) (2026-08-01)


### Bug Fixes

* write ods sheet print settings via a new OdsSheet.printSettings getter/setter ([041bfbe](https://github.com/ExaDev/documents.js/commit/041bfbe2d26b8ade9b1da955445af45d21210d68))


### Features

* add pdfToOds and odsPdfCodec, completing ods's round trip ([5005809](https://github.com/ExaDev/documents.js/commit/5005809a0440094fe1822553ce3465b0474c2f69))
* add reconstructSpreadsheet for PDF-to-spreadsheet grid recovery ([162c0a2](https://github.com/ExaDev/documents.js/commit/162c0a205af87525d4e6c98361f4ec8c81de67a0))

# [1.47.0](https://github.com/ExaDev/documents.js/compare/v1.46.1...v1.47.0) (2026-08-01)


### Bug Fixes

* close the ellipse's Bezier path explicitly in PDF output ([8c204c6](https://github.com/ExaDev/documents.js/commit/8c204c636847767853ef8c104059b62006f7fab9))
* write draw:fill="solid" explicitly for odg vector styles ([3592d1c](https://github.com/ExaDev/documents.js/commit/3592d1c4c5d713c6249c579b4caf5cd2da9306f7))


### Features

* add pdfToOdg and odgPdfCodec, completing odg's round trip ([26f131e](https://github.com/ExaDev/documents.js/commit/26f131e6c284495ee32e918c74d99ba7d717d30d))
* add reconstructDrawing for PDF-to-drawing geometry recovery ([e71355a](https://github.com/ExaDev/documents.js/commit/e71355a0571d4925ce677457154c0ff81765f600))

## [1.46.1](https://github.com/ExaDev/documents.js/compare/v1.46.0...v1.46.1) (2026-07-31)

# [1.46.0](https://github.com/ExaDev/documents.js/compare/v1.45.0...v1.46.0) (2026-07-31)


### Features

* track general vector paths in the PDF content-stream reader ([24f7aea](https://github.com/ExaDev/documents.js/commit/24f7aea6479d490697ded4e5c9503e097562436b))

# [1.45.0](https://github.com/ExaDev/documents.js/compare/v1.44.0...v1.45.0) (2026-07-31)


### Features

* add the odg live-view editor ([89467ae](https://github.com/ExaDev/documents.js/commit/89467ae9899cd214a2744130bc717b739a2b9b22))

# [1.44.0](https://github.com/ExaDev/documents.js/compare/v1.43.1...v1.44.0) (2026-07-31)


### Features

* add convertDrawingToLayout, laying out odg vector primitives and shapes ([58aae96](https://github.com/ExaDev/documents.js/commit/58aae962590885e6fa1b039c2236c89a03b51c32))
* add odgToPdf, converting odg drawings to PDF ([79a5b71](https://github.com/ExaDev/documents.js/commit/79a5b719caedc79bed663fc258aeab89c2a1fb79))
* add writePath, emitting PDF path operators for LayoutPath items ([64b8fb7](https://github.com/ExaDev/documents.js/commit/64b8fb703fd389fc46077466887b1766a6ce0a81))

## [1.43.1](https://github.com/ExaDev/documents.js/compare/v1.43.0...v1.43.1) (2026-07-31)

# [1.43.0](https://github.com/ExaDev/documents.js/compare/v1.42.0...v1.43.0) (2026-07-31)


### Bug Fixes

* document mergeCells' area-proportional cost and widen timing budgets ([d9aff72](https://github.com/ExaDev/documents.js/commit/d9aff72d9d139222a7973ec845d3614cccdd9b2c))


### Features

* add the ods live-view editor ([c192264](https://github.com/ExaDev/documents.js/commit/c192264292fb206cd7a936a3e2f492b112940e90))

# [1.42.0](https://github.com/ExaDev/documents.js/compare/v1.41.0...v1.42.0) (2026-07-31)


### Features

* add the spreadsheet layout algorithm and odsToPdf ([4bbacf1](https://github.com/ExaDev/documents.js/commit/4bbacf173fd8a1bf9a5c4e995520a27fc52a489e))

# [1.41.0](https://github.com/ExaDev/documents.js/compare/v1.40.0...v1.41.0) (2026-07-31)


### Features

* add the odp live-view editor and pdfToOdp ([320f80c](https://github.com/ExaDev/documents.js/commit/320f80cb3a6c5d1505630e0ed8fb32a1d9647f50))

# [1.40.0](https://github.com/ExaDev/documents.js/compare/v1.39.1...v1.40.0) (2026-07-31)


### Features

* add odpToPdf, converting OpenDocument Presentation through the existing pptx layout engine ([1f5f950](https://github.com/ExaDev/documents.js/commit/1f5f9500e399ce279bc05c1026defe555f952a0b))

## [1.39.1](https://github.com/ExaDev/documents.js/compare/v1.39.0...v1.39.1) (2026-07-31)


### Bug Fixes

* export pdfToOdt and odtPdfCodec from the public API surface ([6137ec2](https://github.com/ExaDev/documents.js/commit/6137ec261b17a98bf451a0160edc8eed58d2a561))

# [1.39.0](https://github.com/ExaDev/documents.js/compare/v1.38.0...v1.39.0) (2026-07-31)


### Features

* add the odt live-view editor and pdfToOdt ([ca37f88](https://github.com/ExaDev/documents.js/commit/ca37f8889a11f97740bf545438d9935f931480b5))

# [1.38.0](https://github.com/ExaDev/documents.js/compare/v1.37.0...v1.38.0) (2026-07-31)


### Features

* add ODF package mechanics and whitespace-run text encoding ([d633b0b](https://github.com/ExaDev/documents.js/commit/d633b0bccd54399561dc6a30cba5e09d38cce86c))

# [1.37.0](https://github.com/ExaDev/documents.js/compare/v1.36.0...v1.37.0) (2026-07-31)


### Bug Fixes

* handle document-content-model's embeddedObject ContentBlock variant ([9e898c0](https://github.com/ExaDev/documents.js/commit/9e898c08870ee671bdfcee8671a4398a137d02a0))


### Features

* add odtToPdf, converting OpenDocument Text through the existing docx layout engine ([a33e01b](https://github.com/ExaDev/documents.js/commit/a33e01b9865a6b2c731548e04c00205118b6ebf4))

# [1.36.0](https://github.com/ExaDev/documents.js/compare/v1.35.1...v1.36.0) (2026-07-31)


### Bug Fixes

* merge duplicate document-content-model minimum-release-age excludes into one entry ([bed7e8e](https://github.com/ExaDev/documents.js/commit/bed7e8e6c591076c7a7477fd9990fa44c86bee1e))


### Features

* add ODF byte-signature schemas and an odf.js/ooxml.js structural-compatibility guard ([90a5819](https://github.com/ExaDev/documents.js/commit/90a5819238ec308cbd381d4bf1fa0433cfeffe60))

## [1.35.1](https://github.com/ExaDev/documents.js/compare/v1.35.0...v1.35.1) (2026-07-31)

# [1.35.0](https://github.com/ExaDev/documents.js/compare/v1.34.2...v1.35.0) (2026-07-31)


### Features

* propagate sourcePath from ContentDocument onto emitted LayoutItems ([ae93f21](https://github.com/ExaDev/documents.js/commit/ae93f21d1b3d298ce7c19fca02ddae4d529cf7f5))

## [1.34.2](https://github.com/ExaDev/documents.js/compare/v1.34.1...v1.34.2) (2026-07-31)

## [1.34.1](https://github.com/ExaDev/documents.js/compare/v1.34.0...v1.34.1) (2026-07-31)

# [1.34.0](https://github.com/ExaDev/documents.js/compare/v1.33.4...v1.34.0) (2026-07-31)


### Features

* carry pptx speaker notes through the PDF round trip ([3ee79ba](https://github.com/ExaDev/documents.js/commit/3ee79bab8486eddc6fb9a4cee89fb0d1e15b2480))

## [1.33.4](https://github.com/ExaDev/documents.js/compare/v1.33.3...v1.33.4) (2026-07-31)


### Bug Fixes

* make speaker notes actually open in real presentation software ([bd3b11e](https://github.com/ExaDev/documents.js/commit/bd3b11ed21b200083f39115ee705619b625e88ea))

## [1.33.3](https://github.com/ExaDev/documents.js/compare/v1.33.2...v1.33.3) (2026-07-31)


### Bug Fixes

* make generated pptx files actually open in real presentation software ([79c793c](https://github.com/ExaDev/documents.js/commit/79c793c966121e7dfa1436ecc52ad469e43160a8))

## [1.33.2](https://github.com/ExaDev/documents.js/compare/v1.33.1...v1.33.2) (2026-07-31)

## [1.33.1](https://github.com/ExaDev/documents.js/compare/v1.33.0...v1.33.1) (2026-07-31)

# [1.33.0](https://github.com/ExaDev/documents.js/compare/v1.32.0...v1.33.0) (2026-07-30)


### Features

* add z.codec() pairs for PDF and docx/pptx byte round trips ([c218623](https://github.com/ExaDev/documents.js/commit/c2186238cbd35bfa19a06ce742e857c440684652))

# [1.32.0](https://github.com/ExaDev/documents.js/compare/v1.31.0...v1.32.0) (2026-07-30)


### Bug Fixes

* **layout:** insert a space between words reconstructed from PDF text ([4c25ccd](https://github.com/ExaDev/documents.js/commit/4c25ccd746c24b1b70ae31ef8f362e22718eb629))


### Features

* **convert:** add the ergonomic conversion functions and public API ([42e26a9](https://github.com/ExaDev/documents.js/commit/42e26a9a6e3b8442e2baf4ace7efa1f983809d84))

# [1.31.0](https://github.com/ExaDev/documents.js/compare/v1.30.0...v1.31.0) (2026-07-30)


### Features

* thread an abort signal through readPdf and reconstruct* ([49dfb21](https://github.com/ExaDev/documents.js/commit/49dfb21feacb1bbf426749ba9bd684ceda5417b0))

# [1.30.0](https://github.com/ExaDev/documents.js/compare/v1.29.0...v1.30.0) (2026-07-30)


### Features

* **edit:** add buildDocxPackage and buildPptxPackage ([8fbe3db](https://github.com/ExaDev/documents.js/commit/8fbe3dbe98ea7ae0bc96892544136d7c018680cb))
* **edit:** add PptxEditor.slideSize ([4e06bda](https://github.com/ExaDev/documents.js/commit/4e06bda82b61547e8c7012a7e2d5d4d21124c4f7))

# [1.29.0](https://github.com/ExaDev/documents.js/compare/v1.28.0...v1.29.0) (2026-07-30)


### Features

* **edit:** add tab runs to docx and rich styled text to pptx shapes ([c1affde](https://github.com/ExaDev/documents.js/commit/c1affdea7720afb8422d127ac30a63bf71a8866d))

# [1.28.0](https://github.com/ExaDev/documents.js/compare/v1.27.0...v1.28.0) (2026-07-30)


### Features

* **layout:** add PDF -> docx/pptx reconstruction ([2038a46](https://github.com/ExaDev/documents.js/commit/2038a46d7e0bfaa18ecc94a6df67e16f2bdb3c77))

# [1.27.0](https://github.com/ExaDev/documents.js/compare/v1.26.0...v1.27.0) (2026-07-30)


### Features

* **pdf:** add readPdf, completing the PDF read pipeline ([0ee8404](https://github.com/ExaDev/documents.js/commit/0ee84048a622f8e3c53919bdef52a126eacaeb1e))

# [1.26.0](https://github.com/ExaDev/documents.js/compare/v1.25.0...v1.26.0) (2026-07-30)


### Features

* **pdf:** add Image XObject decoding to PNG/JPEG bytes ([902529f](https://github.com/ExaDev/documents.js/commit/902529f058f0edc6d57f8bd540c03c5f0261ed37))

# [1.25.0](https://github.com/ExaDev/documents.js/compare/v1.24.0...v1.25.0) (2026-07-30)


### Features

* **pdf:** add code-to-Unicode lookups for the read path ([7ef1591](https://github.com/ExaDev/documents.js/commit/7ef1591d8d72cacaaf885b34bb03f9351ad3fddf))
* **pdf:** add ToUnicode CMap parsing and font-dict resolution ([973bb70](https://github.com/ExaDev/documents.js/commit/973bb70aac114134ab97955ff42a0b6593fee342))

# [1.24.0](https://github.com/ExaDev/documents.js/compare/v1.23.0...v1.24.0) (2026-07-30)


### Features

* **pdf:** add content-stream tokenizing and the graphics/text interpreter ([bc2a846](https://github.com/ExaDev/documents.js/commit/bc2a846bac76b18ac9f15141706ba6cee1e4f728))

# [1.23.0](https://github.com/ExaDev/documents.js/compare/v1.22.0...v1.23.0) (2026-07-30)


### Features

* **pdf:** add cross-reference resolution and the object store ([a63c4f6](https://github.com/ExaDev/documents.js/commit/a63c4f64c8014345ef1cf88ee6a29e2c9b16bb3f))

# [1.22.0](https://github.com/ExaDev/documents.js/compare/v1.21.0...v1.22.0) (2026-07-30)


### Features

* **pdf:** add stream filter decoding and Flate/LZW predictors ([ed648a6](https://github.com/ExaDev/documents.js/commit/ed648a622c37b46df6c872d0f83a7abb549bd464))

# [1.21.0](https://github.com/ExaDev/documents.js/compare/v1.20.0...v1.21.0) (2026-07-30)


### Features

* **pdf:** add tokens-to-PdfObject parser ([2eb72e9](https://github.com/ExaDev/documents.js/commit/2eb72e91a6824d6ada85be74d4d9c61bfc1b16af))

# [1.20.0](https://github.com/ExaDev/documents.js/compare/v1.19.0...v1.20.0) (2026-07-30)


### Features

* **pdf:** add byte-level PDF lexer ([4255153](https://github.com/ExaDev/documents.js/commit/4255153e73861ee87dd836a04a881bd065c7ee3e)), closes [#XX](https://github.com/ExaDev/documents.js/issues/XX)
* **pdf:** add diagnostics vocabulary for the read-side parser ([956e5b0](https://github.com/ExaDev/documents.js/commit/956e5b022035f9244986ce2bea51973f871776de))

# [1.19.0](https://github.com/ExaDev/documents.js/compare/v1.18.0...v1.19.0) (2026-07-30)


### Features

* **layout:** add docx flow/pagination engine, completing docx->PDF ([e840e91](https://github.com/ExaDev/documents.js/commit/e840e91f83fde072460590985e42829c2593fc54))

# [1.18.0](https://github.com/ExaDev/documents.js/compare/v1.17.0...v1.18.0) (2026-07-30)


### Features

* **ooxml:** add readDocxContent, Package -> ContentDocument for docx ([266007a](https://github.com/ExaDev/documents.js/commit/266007a2331b2fb18ca333992f640d8119f6c124))

# [1.17.0](https://github.com/ExaDev/documents.js/compare/v1.16.0...v1.17.0) (2026-07-30)


### Features

* **ooxml:** add the docx style cascade resolver ([47b53c6](https://github.com/ExaDev/documents.js/commit/47b53c6027f404acf0939f5c1bb46195dca3ef0e))

# [1.16.0](https://github.com/ExaDev/documents.js/compare/v1.15.0...v1.16.0) (2026-07-30)


### Features

* **layout:** add pptx direct-placement layout, completing pptx->PDF ([a8dfd27](https://github.com/ExaDev/documents.js/commit/a8dfd27c53b0a11a787a9be0d163d6de2c7d9a60))

# [1.15.0](https://github.com/ExaDev/documents.js/compare/v1.14.0...v1.15.0) (2026-07-30)


### Features

* **pdf:** carry hyperlink through text-layout wrapping ([3798607](https://github.com/ExaDev/documents.js/commit/379860764cc817e8849850c834f12d41ef1e7bc1))

# [1.14.0](https://github.com/ExaDev/documents.js/compare/v1.13.0...v1.14.0) (2026-07-30)


### Features

* **ooxml:** read pptx table row height from a:tr/[@h](https://github.com/h) ([fda7067](https://github.com/ExaDev/documents.js/commit/fda706746a0d333d9fade7e2684233c790940673))

# [1.13.0](https://github.com/ExaDev/documents.js/compare/v1.12.0...v1.13.0) (2026-07-30)


### Features

* **ooxml:** read pptx text-box insets and normAutofit scale ([5ed0849](https://github.com/ExaDev/documents.js/commit/5ed08491c6bbf1a6a40d5ec4cd17ddb86a6e7bfe))
* **pdf:** add rotatePointAboutCenter for shape-rotation reconciliation ([48ff663](https://github.com/ExaDev/documents.js/commit/48ff663221914c0d08672ee0808373f5543a247c))

# [1.12.0](https://github.com/ExaDev/documents.js/compare/v1.11.0...v1.12.0) (2026-07-30)


### Features

* **ooxml:** add readPptxContent, Package -> ContentDocument for pptx ([d4f9660](https://github.com/ExaDev/documents.js/commit/d4f9660c33895746f3849ee24e62814d722810d6))

# [1.11.0](https://github.com/ExaDev/documents.js/compare/v1.10.0...v1.11.0) (2026-07-30)


### Features

* **model:** add rotationDeg to ContentShape ([82bae97](https://github.com/ExaDev/documents.js/commit/82bae9778e02ff6dc70e1a1facf3e82703348560))
* **ooxml:** add DrawingML group-shape child-to-parent transform ([357af37](https://github.com/ExaDev/documents.js/commit/357af3784ccbf391242e287d76ccbcfbbdca258e))
* **ooxml:** add pptx placeholder/layout/master/theme inheritance cascade ([86cc6fc](https://github.com/ExaDev/documents.js/commit/86cc6fc4cd4ed4cdec7c59dc7fb8fdcb7bc965d8))

# [1.10.0](https://github.com/ExaDev/documents.js/compare/v1.9.0...v1.10.0) (2026-07-30)


### Features

* **model:** add DrawingML hundredths-of-a-point font-size conversion ([d7b311c](https://github.com/ExaDev/documents.js/commit/d7b311c928ef1ff5bdb561721992099eaf095a22))
* **model:** add DrawingML shade/tint/lumMod/lumOff colour transforms ([9a0f675](https://github.com/ExaDev/documents.js/commit/9a0f675106d54d46574274708dfd67c726ece015))
* **ooxml:** add shared docProps metadata reader ([228c9f1](https://github.com/ExaDev/documents.js/commit/228c9f115fa8cc14204f45754a6fb4af49043a5f))
* **ooxml:** add shared DrawingML geometry and theme colour resolution ([9542423](https://github.com/ExaDev/documents.js/commit/95424230c36320789a330350ca954f0b767df5ac))

# [1.9.0](https://github.com/ExaDev/documents.js/compare/v1.8.0...v1.9.0) (2026-07-30)


### Features

* add ClockPort and abort-signal ports ([43bf591](https://github.com/ExaDev/documents.js/commit/43bf591241474d3ce0fce48a99c65392d39c8f19))
* **pdf:** add writePdf, assembling the full object graph and xref table ([3c1c793](https://github.com/ExaDev/documents.js/commit/3c1c793949e99ebb8f115815b43da95bfab07b1f))

# [1.8.0](https://github.com/ExaDev/documents.js/compare/v1.7.0...v1.8.0) (2026-07-30)


### Features

* **pdf:** add content-stream generation from LayoutItem ([2c26dd5](https://github.com/ExaDev/documents.js/commit/2c26dd54afd97e6de1e28050bd46e7b198f702d1))

# [1.7.0](https://github.com/ExaDev/documents.js/compare/v1.6.0...v1.7.0) (2026-07-30)


### Features

* **pdf:** add greedy line-wrapping over styled runs ([f843c54](https://github.com/ExaDev/documents.js/commit/f843c544f6fe3bf816ee047992181bbe2ce92aec))
* **pdf:** add standard-14 font text measurer ([1605f44](https://github.com/ExaDev/documents.js/commit/1605f44028cbac81d65bccce050b3622f76b6062))

# [1.6.0](https://github.com/ExaDev/documents.js/compare/v1.5.0...v1.6.0) (2026-07-30)


### Features

* add WinAnsi sanitization, font-family resolution, and matrix math for the PDF writer ([f37b301](https://github.com/ExaDev/documents.js/commit/f37b3011630d267073afedb9efb79830bf3ac782))

# [1.5.0](https://github.com/ExaDev/documents.js/compare/v1.4.0...v1.5.0) (2026-07-30)


### Features

* add the PDF object model, serializer, and standard-14 font metrics ([1801e3c](https://github.com/ExaDev/documents.js/commit/1801e3c783eb134475d3c075e8120e7ee1c8c65b))

# [1.4.0](https://github.com/ExaDev/documents.js/compare/v1.3.0...v1.4.0) (2026-07-30)


### Features

* add the pptx live-view read+write editor ([76d355d](https://github.com/ExaDev/documents.js/commit/76d355d65c2ea76617dffad43fb976345802da3c))

# [1.3.0](https://github.com/ExaDev/documents.js/compare/v1.2.0...v1.3.0) (2026-07-30)


### Features

* add the docx live-view read+write editor ([752c9fc](https://github.com/ExaDev/documents.js/commit/752c9fc6b34df56213f343761fae20e829054de0))

# [1.2.0](https://github.com/ExaDev/documents.js/compare/v1.1.0...v1.2.0) (2026-07-30)


### Features

* add byte primitives and hand-written PNG/JPEG image codecs ([9b8011e](https://github.com/ExaDev/documents.js/commit/9b8011e92079a538edfcbf99b0be132336e73936))

# [1.1.0](https://github.com/ExaDev/documents.js/compare/v1.0.0...v1.1.0) (2026-07-30)


### Features

* add XML mutation and OPC package mechanics layers ([4086462](https://github.com/ExaDev/documents.js/commit/4086462517e76d2a81c92b394608ce5c077a7dc6))

# 1.0.0 (2026-07-30)


### Features

* add core model schemas for units, geometry, color, and the two document pivots ([891231f](https://github.com/ExaDev/documents.js/commit/891231feb17ee3929420602c6a12f2a220410a24))
