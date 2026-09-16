## [4.15.7](https://github.com/ExaDev/documents.js/compare/xls-codec%404.15.6...xls-codec%404.15.7) (2026-09-16)

### Bug Fixes

* **xls-codec:** narrow the FLSNULL dxf test to conditionalFormats' own cellIs shape ([fddafca](https://github.com/ExaDev/documents.js/commit/fddafcaf789b3ee97f483e2732a950f670d7d1d9))
* **xls-codec:** use real Color/ContentBorder shapes in written-cells tests ([736538a](https://github.com/ExaDev/documents.js/commit/736538a2abdb4ff0dea793bfdbc2f1dbc30705c7))

### Code Refactoring

* **xls-codec:** add a shared malformed-record recovery classifier ([38de7d7](https://github.com/ExaDev/documents.js/commit/38de7d7bad0eb83f67309217b56e045b00dfac91))
* **xls-codec:** always slice bytesFromBase64's own trailing padding ([a00ea40](https://github.com/ExaDev/documents.js/commit/a00ea40c709fe2b653bc0ae0cd53b92e00fb1853))
* **xls-codec:** build a cell-Xf signature via JSON.stringify ([3d016e1](https://github.com/ExaDev/documents.js/commit/3d016e1533d7177428478dd91a50a5eed247d27c))
* **xls-codec:** close content.ts's remaining survivors, cover sheet-writer.ts boundaries ([fc57255](https://github.com/ExaDev/documents.js/commit/fc57255845dabb330037cfc7931c8cfcc580ff0b))
* **xls-codec:** compile formula rgce bytes with an explicit worklist, not recursion ([686af6b](https://github.com/ExaDev/documents.js/commit/686af6bde6fcb539b8da1a98cc2ed47f65ca30a8))
* **xls-codec:** drop addCacheEntry's own redundant default-case return ([bf82ffc](https://github.com/ExaDev/documents.js/commit/bf82ffc6101b90ddc2081e82405fafce643bac00))
* **xls-codec:** drop BlockCursor's genuinely redundant settle passes ([ddaab29](https://github.com/ExaDev/documents.js/commit/ddaab29a38ceee29fd4c03dd186f6f92b8e1ed34))
* **xls-codec:** drop chart.ts's own dead switch default and pointInRange's redundant edge cases ([5b4ddec](https://github.com/ExaDev/documents.js/commit/5b4ddec65dacfffaf5ba6b563aa69ff090a57bf1))
* **xls-codec:** drop checkedLength's unreachable whole-text embedding branch ([910c7e4](https://github.com/ExaDev/documents.js/commit/910c7e43c4089cd6167ec02541d48cfbb9531d8e))
* **xls-codec:** drop container's redundant CompoundFileFormatError branch ([286f404](https://github.com/ExaDev/documents.js/commit/286f404e2606e27acaf7cc2d3e99f625b75ad519))
* **xls-codec:** drop embedded-object's redundant safeParse success guard ([41aa011](https://github.com/ExaDev/documents.js/commit/41aa01126a6dcdc4030a6bd48f4cfbfea487f03a))
* **xls-codec:** drop md4's redundant zero offset term ([bcc4d0f](https://github.com/ExaDev/documents.js/commit/bcc4d0f8626807f5e5069f7c49e474b11f975751))
* **xls-codec:** drop readArrayGroup's unreachable rgcb branch and a redundant break ([dad2b7b](https://github.com/ExaDev/documents.js/commit/dad2b7b9f984981930969f24a70a2c44ae26e2b3))
* **xls-codec:** drop readCf12's dead error-recovery indirection and CFColor's unreachable skip ([843517a](https://github.com/ExaDev/documents.js/commit/843517a717b57c3d7d26f0d50051468303e9df55))
* **xls-codec:** drop readFormula's own unreachable rgcb branch ([3747dd3](https://github.com/ExaDev/documents.js/commit/3747dd322ba6c7127d132ecfc199aa6fbb03fedc))
* **xls-codec:** drop readObjPictFmlaStorageId's redundant FtCmo skip ([9815db8](https://github.com/ExaDev/documents.js/commit/9815db8de9d6a76883be46d15d4c36b911d2eb09))
* **xls-codec:** drop readRichExtendedString's redundant run/phonetic skip guards ([a334ef6](https://github.com/ExaDev/documents.js/commit/a334ef69b984cec6cadf6e6f572ddc64442bc523))
* **xls-codec:** drop readSheetRecords' own redundant loop bound ([ede1b0e](https://github.com/ExaDev/documents.js/commit/ede1b0ec4674d917b02db711ae6763fa73671f32))
* **xls-codec:** drop readSheetShapes' redundant empty-stream check and pib's dead fComplex test ([08881b0](https://github.com/ExaDev/documents.js/commit/08881b0277cdf7321fabd8ad849aff8d4cde28bd))
* **xls-codec:** drop resolveIcvColor's redundant palette upper bound ([2bbef83](https://github.com/ExaDev/documents.js/commit/2bbef83ec524d039317007473c837087e8a609d0))
* **xls-codec:** drop the RK double's never-written low dword ([5cc0363](https://github.com/ExaDev/documents.js/commit/5cc036382c4c726679a6659d90dc201c6cc0d99c))
* **xls-codec:** drop three unobservable globals.ts checks ([c97a01d](https://github.com/ExaDev/documents.js/commit/c97a01d1d1db833b7f496eec177e3a061468ce03))
* **xls-codec:** drop two Ptg cases already reachable through their own generic fallback ([2835e64](https://github.com/ExaDev/documents.js/commit/2835e646c20d4e51e68cdf825e83073404c38ffc))
* **xls-codec:** drop two redundant loop-bound checks in sheet.ts ([5a93d15](https://github.com/ExaDev/documents.js/commit/5a93d15ec248b0621633c0b2ddb2036aa58d87e3))
* **xls-codec:** extract validateRuleCount for a testable exact boundary ([1fc030e](https://github.com/ExaDev/documents.js/commit/1fc030eb8145d7b3ab42c369db9659f921573019))
* **xls-codec:** filter written cells once per workbook-wide scan pass ([4b22f18](https://github.com/ExaDev/documents.js/commit/4b22f187996ebfe5ac041448c3c6ce9c0d5b364c))
* **xls-codec:** key the phantom leap day's own origin choice off Math.sign, not a threshold ([720e57e](https://github.com/ExaDev/documents.js/commit/720e57ec87f1b87204d9bc81adf93d75f12dfed0))
* **xls-codec:** narrow writeSheetComments to cells proven to carry a comment ([f1d0b90](https://github.com/ExaDev/documents.js/commit/f1d0b9052f7c7b58009b8c3e6e2d6f84ab425b83))
* **xls-codec:** pass writeFormulaRecords its already-narrowed formula ([0163211](https://github.com/ExaDev/documents.js/commit/016321171098adaff61810dbe02f6c8f8f5eef6c))
* **xls-codec:** reach genuine 100% mutation coverage on biff/ptg.ts ([d928cd9](https://github.com/ExaDev/documents.js/commit/d928cd9e5674d7a54ac21e8f63132f85ef8fb48b))
* **xls-codec:** reach genuine 100% mutation coverage on conditional-format.ts ([60c14be](https://github.com/ExaDev/documents.js/commit/60c14bebe944b3f058975704685e37c863cb00fa))
* **xls-codec:** reach genuine 100% mutation coverage on content.ts ([b5bdc96](https://github.com/ExaDev/documents.js/commit/b5bdc963ffab54538ba5b55c721db838e0ede372))
* **xls-codec:** reach genuine 100% mutation coverage on drawing/blips.ts ([44c2881](https://github.com/ExaDev/documents.js/commit/44c2881308e3af08e1bccdfde6fd8cdf20387c53))
* **xls-codec:** refuse an invalid base64 character rather than silently skipping it ([13bcf9a](https://github.com/ExaDev/documents.js/commit/13bcf9a1555dfe8a039bea0a3ae6d5acfee81b70))
* **xls-codec:** remove cfb.ts's own DIFAT sector count write ([d8f37d9](https://github.com/ExaDev/documents.js/commit/d8f37d976173f88e2e8c1b65717380db849fdc4f))
* **xls-codec:** remove cfb.ts's own unreachable checks and self-correcting bounds ([f97b0e3](https://github.com/ExaDev/documents.js/commit/f97b0e34ffa439db70a0eab11482c44094503ced))
* **xls-codec:** remove OwnSheetRange's own unread endRow field ([b37d68f](https://github.com/ExaDev/documents.js/commit/b37d68fbc6fba754c0d37ee3bb0e06ed9ce1fa92))
* **xls-codec:** remove ptg-writer's redundant eof push and drop-in unterminated-string check ([a416390](https://github.com/ExaDev/documents.js/commit/a4163905516542f234b3dc0dd74dd458080cf9e1))
* **xls-codec:** remove redundant conditional-format write paths ([a8960a4](https://github.com/ExaDev/documents.js/commit/a8960a47bc1f64cb577bf31b48906c35cc6ce17f))
* **xls-codec:** remove redundant drawing-read loop bounds and export testable seams ([1acb4fb](https://github.com/ExaDev/documents.js/commit/1acb4fbf96527d2499150a011a045394b46de032))
* **xls-codec:** remove two unobservable sheet.ts mutation surfaces ([cd4a93a](https://github.com/ExaDev/documents.js/commit/cd4a93af846ea8a43e855a13a54e95b25b387b83))
* **xls-codec:** remove xf-colors' dead achromatic shortcut and drop redundant range bounds ([e32d622](https://github.com/ExaDev/documents.js/commit/e32d6228d8682d0bf9ca7439515e20a92615515c))
* **xls-codec:** replace strings/string-writer's chunking loops with Array.from ([b88f0f6](https://github.com/ExaDev/documents.js/commit/b88f0f6d4202ef37028c760180e307ada5b41f84))
* **xls-codec:** replace unreachable map-lookup guards with exhaustive switches ([a12879f](https://github.com/ExaDev/documents.js/commit/a12879f6c82c53d3f71407c4643056680173d0ef))
* **xls-codec:** resolve a blip's dedup by value, not a re-derived index ([c37b513](https://github.com/ExaDev/documents.js/commit/c37b513ccec7805fe9a850a76da1244e3195e529))
* **xls-codec:** restate hslToRgb's piecewise hue curve as one clamp ([f1dbbfa](https://github.com/ExaDev/documents.js/commit/f1dbbfa132bb53cdcc46921cd1089016ef7bc68c))
* **xls-codec:** route every malformed-record catch through recoverFromFormatError ([95effa9](https://github.com/ExaDev/documents.js/commit/95effa98fbe4888face45dde9df781f644454da5))
* **xls-codec:** stop the shape/Obj pairing loop at the first exhausted side ([4094c1f](https://github.com/ExaDev/documents.js/commit/4094c1fd9f3b6433be83e5a98525c95b8e9edc5c))

### Tests

* **xls-codec:** add a dedicated test file for the Escher write side ([df46745](https://github.com/ExaDev/documents.js/commit/df467456a489d6eafca286e1efa06b15fb7d91da))
* **xls-codec:** assert BiffWriteError's own name and message ([6cd8ad3](https://github.com/ExaDev/documents.js/commit/6cd8ad3ed489385e5f4ad4d2a47d61651eae0b63))
* **xls-codec:** assert conditional-format and cell fixtures with toStrictEqual ([cf92d77](https://github.com/ExaDev/documents.js/commit/cf92d77d04e530ef5f2efbd4c33c2498bd33a89d))
* **xls-codec:** assert data validation ranges accept BIFF8's own grid edge ([2337c51](https://github.com/ExaDev/documents.js/commit/2337c51affec65d1838ba1335d3e1a6bea611649))
* **xls-codec:** assert encryption's disjunctive checks reject each half alone ([151d83d](https://github.com/ExaDev/documents.js/commit/151d83dfd00bb06d789c421e0510201bd4018bc3))
* **xls-codec:** assert pointsToColumnWidth's exact ceil formula ([4533387](https://github.com/ExaDev/documents.js/commit/4533387b1bde88c353f39fcc0834809622876325))
* **xls-codec:** assert print-setup's landscape conjunction and tolerance boundary ([e13bfff](https://github.com/ExaDev/documents.js/commit/e13bfff855bec4889a31693b7793ae3ee0e13957))
* **xls-codec:** assert readRecords' own thrown messages and error name ([c096886](https://github.com/ExaDev/documents.js/commit/c096886270bb6ca03810b048e4e7b9cb54a07336))
* **xls-codec:** assert record-writer's oversized-record message ([7da5c2f](https://github.com/ExaDev/documents.js/commit/7da5c2f9a3dc7d556a10027fe6fb99353d546da9))
* **xls-codec:** assert substreams' thrown messages and the BOF length boundary ([609a318](https://github.com/ExaDev/documents.js/commit/609a31849b4d746a9a4b18f99eea8cf58a81f2ba))
* **xls-codec:** close defined-names.ts's last two mutation survivors ([475f827](https://github.com/ExaDev/documents.js/commit/475f8279b375120013e1b0385ce1d11ad9f41c0e))
* **xls-codec:** close ptg.ts's remaining mutation survivors and no-coverage lines ([9366143](https://github.com/ExaDev/documents.js/commit/9366143acccb1055eb2c586542bb8d0102d55a19))
* **xls-codec:** close ptg.ts's remaining survivors ([1d0ede2](https://github.com/ExaDev/documents.js/commit/1d0ede2caf3ce196f5e85790609bcbe54856c3c9))
* **xls-codec:** close write.ts's remaining mutation survivors ([5a14728](https://github.com/ExaDev/documents.js/commit/5a1472834660ca16f7c391ae2583bb8c1acbbe05))
* **xls-codec:** cover applyTint's own HSL branches and icv range boundaries ([14d8494](https://github.com/ExaDev/documents.js/commit/14d84949b855de05c4ede5913c682c78b2ca53a6))
* **xls-codec:** cover chart series AI dispatch, cache roles, and range resolution ([eb0ced7](https://github.com/ExaDev/documents.js/commit/eb0ced7f521d9690a937cdd161ed1f5947ac6457))
* **xls-codec:** cover compileFormulaText's tokenizer, parser, and compiler directly ([e0ed190](https://github.com/ExaDev/documents.js/commit/e0ed1906fda6129557e77164b946cdb6d81bb864))
* **xls-codec:** cover compoundFile's ASCII boundary, name collisions, and raw byte layout ([cdf8133](https://github.com/ExaDev/documents.js/commit/cdf8133e47af22ef98673a18544a660f12bd6372))
* **xls-codec:** cover compoundFile's own validation and sector-layout branches directly ([ce2c1e1](https://github.com/ExaDev/documents.js/commit/ce2c1e12c185fdcbdf5fd5fe55dc0e1bd37753dc))
* **xls-codec:** cover conditional-format boolean flags and gradient bytes directly ([2049751](https://github.com/ExaDev/documents.js/commit/2049751cd271815a217f302c32081053a69a68ea))
* **xls-codec:** cover conditional-format write boundaries and nID assignment ([ebf01fa](https://github.com/ExaDev/documents.js/commit/ebf01fab1004166a8fc613ed0780beae0a83bfda))
* **xls-codec:** cover data validation's notBetween operator and isolate its own grid-edge checks ([37cfd28](https://github.com/ExaDev/documents.js/commit/37cfd2823a1bc095c60bed58044c53d31b2bf8be))
* **xls-codec:** cover data-validation error paths and grid boundaries directly ([9c3d0fc](https://github.com/ExaDev/documents.js/commit/9c3d0fc523642b7644fc7170ef199adf1d94f51d))
* **xls-codec:** cover decryptWorkbookRecords' FilePass and record-dispatch edges ([db2e2ce](https://github.com/ExaDev/documents.js/commit/db2e2ce6a260c4da0247f43684b476b74e38c741))
* **xls-codec:** cover defined-name length, scope, and grid boundaries ([5baf12c](https://github.com/ExaDev/documents.js/commit/5baf12c71938d4af7a5de97c6a40677cf1bfcba5))
* **xls-codec:** cover drawing-read geometry, guard isolation, and pairing edges ([b085a54](https://github.com/ExaDev/documents.js/commit/b085a54dcf83d80d78f1845d6d222b3b1491a5fa))
* **xls-codec:** cover drawing-write geometry, placement, and record byte layout ([7d33f6f](https://github.com/ExaDev/documents.js/commit/7d33f6f039f4ef5608e789bfe3da1f21a0795513))
* **xls-codec:** cover globals-writer records this package's own reader ignores ([8357f08](https://github.com/ExaDev/documents.js/commit/8357f08b0b66d83c93dbdb14ac5f9a5859d7772e))
* **xls-codec:** cover layoutMetadataToSummaryInformation's date validation ([bf2a0e9](https://github.com/ExaDev/documents.js/commit/bf2a0e971c4d6d7e902555cc66763566ee0d4e44))
* **xls-codec:** cover MD4's padding boundary and drop its dead-code guards ([890d775](https://github.com/ExaDev/documents.js/commit/890d775a65139a88abf8368462d1950eee2a689b))
* **xls-codec:** cover Obj record byte layout, sequential ids, and cross-sheet spids ([2686329](https://github.com/ExaDev/documents.js/commit/2686329573506aedf8077bfcc89ea089dfefb546))
* **xls-codec:** cover own-sheet fallback and range boundary edges ([89e007c](https://github.com/ExaDev/documents.js/commit/89e007c3c1d3f8e2c78610a223f1291b47665b78))
* **xls-codec:** cover readDv's recoverFromFormatError call against a real bug ([e877c78](https://github.com/ExaDev/documents.js/commit/e877c78652857ee058b2c80b9195b4a1e64d6c3f))
* **xls-codec:** cover readEmbeddedObjectPackage's own rejection paths ([c5a4f7d](https://github.com/ExaDev/documents.js/commit/c5a4f7d6a54d5e562f7f7ef7913213f7cead3ae6))
* **xls-codec:** cover readObjPictFmlaStorageId's own sub-record walk ([644682a](https://github.com/ExaDev/documents.js/commit/644682af9d576b7f7fe09387d30a103856335351))
* **xls-codec:** cover readWorkbookStreams and isXlsFile directly ([dfcb9ac](https://github.com/ExaDev/documents.js/commit/dfcb9ac70a651ac8575d81d780b0a9413b42ccf1))
* **xls-codec:** cover sheet-writer grid, merge, and formula cached-value gaps ([5c6a696](https://github.com/ExaDev/documents.js/commit/5c6a696dea4c26f6c54318f8310770434338e8b8))
* **xls-codec:** cover storage reuse and header fields no round trip proves ([8cf2aaf](https://github.com/ExaDev/documents.js/commit/8cf2aaf4cfd7dbcc3453750db7e6c56c9867dc07))
* **xls-codec:** cover test-support/biff's own string and XF-trailer packing ([da24330](https://github.com/ExaDev/documents.js/commit/da24330343db2566c48a920f4cff2c94fb0fffb2))
* **xls-codec:** distinguish CFEx's fIsCF12 guard from a coincidental undefined ([963c22f](https://github.com/ExaDev/documents.js/commit/963c22fcf64542ec9588853f7698bd29bd15f7db))
* **xls-codec:** give the 65535-comment boundary test an explicit timeout ([600c0f8](https://github.com/ExaDev/documents.js/commit/600c0f87d455232b50a6e00ec66e8fcd8ea6f373))
* **xls-codec:** isolate cfb.ts's own size-classification and same-name storage edges ([4dd2f27](https://github.com/ExaDev/documents.js/commit/4dd2f27a26acf31f57b0c6a882e97037e01fc802))
* **xls-codec:** isolate DgContainer's kind check and pib's exact opid from a same-shaped bypass ([c6a6ea0](https://github.com/ExaDev/documents.js/commit/c6a6ea09aa96c2109b4fc508b8ea0d2b3653b4ba))
* **xls-codec:** isolate every branch of cellCarriesFormatting/writesCellRecord ([e6cf0e3](https://github.com/ExaDev/documents.js/commit/e6cf0e3837ac1715a7f32ddc18b23ed6e82d4cc5))
* **xls-codec:** isolate every earlier guard and array-class Ptg in readLbl/parsePrintAreas ([65e6179](https://github.com/ExaDev/documents.js/commit/65e6179af653b7e48761def6259855253c65030e))
* **xls-codec:** isolate the plain-column check's own leading anchor from its trailing one ([fd53e9b](https://github.com/ExaDev/documents.js/commit/fd53e9b8a4c282493abdfc138c0371b386dd6376))
* **xls-codec:** pin every Escher framing refusal's exact message and cover firstChild directly ([8de76b1](https://github.com/ExaDev/documents.js/commit/8de76b1f29f1c1fba94d8320eece2f3526b786fd))
* **xls-codec:** pin every Ftab entry's name and fixed arity independently ([2ec29dd](https://github.com/ExaDev/documents.js/commit/2ec29ddd9a1d3e0f628f56e7467733b2debdd4b3))
* **xls-codec:** pin fontNameBytes' exact write length and the dyHeight/fontName refusal messages ([0073246](https://github.com/ExaDev/documents.js/commit/0073246cc7cca65ef771127738b57923ad42e7e3))
* **xls-codec:** pin writeSheetComments' record ordering and object ids ([bcd0c96](https://github.com/ExaDev/documents.js/commit/bcd0c9677f2a1f587f892eb5b022816c2c8ed9ab))
* **xls-codec:** reach genuine mutation coverage on defined-names.ts ([27ed7f1](https://github.com/ExaDev/documents.js/commit/27ed7f1d4830866d531f30ec1a8384c2afb954e3))
* **xls-codec:** reach mutation coverage on conditional-format-write.ts ([13ad98b](https://github.com/ExaDev/documents.js/commit/13ad98b0e24d8f0d74d5dd8a47c731fcba566741))
* **xls-codec:** reach mutation coverage on globals.ts's SupBook/XTI resolution ([bc4368f](https://github.com/ExaDev/documents.js/commit/bc4368f8bd057b1146c572f17973cb45cdda3fa1))
* **xls-codec:** reach mutation coverage on sheet.ts's record dispatch ([b3cb452](https://github.com/ExaDev/documents.js/commit/b3cb4521e4139f049e00c8ca542e1e10b9ef3518))
* **xls-codec:** reach mutation coverage on write.ts's workbook-wide plans ([f3bd5f7](https://github.com/ExaDev/documents.js/commit/f3bd5f77a30f1809ae1f666eabdf284b30effe22))
* **xls-codec:** use a genuinely valid Package stream in embeddedObjectFromObjRecord's guard tests ([03029ab](https://github.com/ExaDev/documents.js/commit/03029ab45c5e897b9f7525dee10f44d31b1bf0a7))

### Miscellaneous Chores

* **xls-codec:** raise the mutation break threshold to 100 ([7f6c424](https://github.com/ExaDev/documents.js/commit/7f6c42422a914b736eac8fe240a7514378e556bb))

## [4.15.6](https://github.com/ExaDev/documents.js/compare/xls-codec%404.15.5...xls-codec%404.15.6) (2026-09-14)

### Miscellaneous Chores

* bump pinned pnpm to 12.4.1 across the workspace ([4e81c2d](https://github.com/ExaDev/documents.js/commit/4e81c2dfdb08fff226c20a0f267baffa87758e0f))
* **lint:** except each package's own measured eslint-config 2.12.1 debt ([11c35bc](https://github.com/ExaDev/documents.js/commit/11c35bc61db74c68b4be725c34452509fba00c2a))


### Dependencies

- Updated document-schema.js to 7.11.3
- Updated excel-number-format to 1.2.4
- Updated archive-codec to 1.11.4

## [4.15.5](https://github.com/ExaDev/documents.js/compare/xls-codec%404.15.4...xls-codec%404.15.5) (2026-09-13)


### Dependencies

- Updated archive-codec to 1.11.3

## [4.15.4](https://github.com/ExaDev/documents.js/compare/xls-codec%404.15.3...xls-codec%404.15.4) (2026-09-13)


### Dependencies

- Updated document-schema.js to 7.11.2
- Updated archive-codec to 1.11.2

## [4.15.3](https://github.com/ExaDev/documents.js/compare/xls-codec%404.15.2...xls-codec%404.15.3) (2026-09-12)


### Dependencies

- Updated excel-number-format to 1.2.3

## [4.15.2](https://github.com/ExaDev/documents.js/compare/xls-codec%404.15.1...xls-codec%404.15.2) (2026-09-11)


### Dependencies

- Updated excel-number-format to 1.2.2

## [4.15.1](https://github.com/ExaDev/documents.js/compare/xls-codec%404.15.0...xls-codec%404.15.1) (2026-09-11)

### Code Refactoring

* load stryker.config.ts directly instead of a jiti .mjs bootstrap ([4221520](https://github.com/ExaDev/documents.js/commit/42215205caa1c8fc6368ed38729d15836bdd613b))


### Dependencies

- Updated document-schema.js to 7.11.1
- Updated excel-number-format to 1.2.1
- Updated archive-codec to 1.11.1

## [4.15.0](https://github.com/ExaDev/documents.js/compare/xls-codec%404.14.0...xls-codec%404.15.0) (2026-09-11)

### Features

* **xls-codec:** chain an oversized MsoDrawing/MsoDrawingGroup record onto Continue ([758a634](https://github.com/ExaDev/documents.js/commit/758a63455a82c804ee9e026e56ea70977def826d))
* **xls-codec:** write a sheet's own images and embedded objects ([30d02ef](https://github.com/ExaDev/documents.js/commit/30d02ef43872bf6e682c9a40b641f4cba0bc2fb4))
* **xls-codec:** write the CF12-era conditional-format rules ([71ffc90](https://github.com/ExaDev/documents.js/commit/71ffc90bd083201e7732ca8b5e161da62c97826b))

### Bug Fixes

* **xls-codec:** concatenate every Continue-chained Escher block, not just the first ([aaffc1f](https://github.com/ExaDev/documents.js/commit/aaffc1f73b26eb79ed77d318915964fbb234d780))

### Documentation

* **xls-codec:** describe the image and embedded-object writer ([f98493d](https://github.com/ExaDev/documents.js/commit/f98493d29b06473fe1da7bde8aacb9d0b1f4526f))

### Tests

* **xls-codec:** round-trip a sheet's own images and embedded objects ([e0458cd](https://github.com/ExaDev/documents.js/commit/e0458cd03707d720f36382fd27c35fc5a4d1fca9))

## [4.14.0](https://github.com/ExaDev/documents.js/compare/xls-codec%404.13.0...xls-codec%404.14.0) (2026-09-11)

### Features

* **ci:** gate each measured package on its first CI mutation baseline ([9f8fa69](https://github.com/ExaDev/documents.js/commit/9f8fa6947795b2089bed03c936691893643ce2ae))


### Dependencies

- Updated document-schema.js to 7.11.0
- Updated excel-number-format to 1.2.0
- Updated archive-codec to 1.11.0

## [4.13.0](https://github.com/ExaDev/documents.js/compare/xls-codec%404.12.6...xls-codec%404.13.0) (2026-09-11)

### Features

* **xls-codec:** carry a currency cell's ISO code through the format bracket ([76f98c1](https://github.com/ExaDev/documents.js/commit/76f98c1135710d1e36b83c0be44dbc90582b925c))
* **xls-codec:** read a cell's own font from its XF's font table entry ([9b261b0](https://github.com/ExaDev/documents.js/commit/9b261b0a4ce3726aeb9ded56d138b414e93c85cd))
* **xls-codec:** read the workbook's defined names onto the document ([57a75fc](https://github.com/ExaDev/documents.js/commit/57a75fc9307c21efbd4530e8a9c6269426730cca))
* **xls-codec:** write per-cell fonts through an interned font table ([a24b611](https://github.com/ExaDev/documents.js/commit/a24b61153ae8bffcfc18702919b292bd7f2408c1))
* **xls-codec:** write the document's defined names as Lbl records ([741116e](https://github.com/ExaDev/documents.js/commit/741116e912e6c847a51d1fd4622e463ada340ab5))

### Documentation

* **xls-codec:** state the per-cell font, defined-name, and currency-code scope ([7a87cc0](https://github.com/ExaDev/documents.js/commit/7a87cc007f398fc3890096637b0ed213fd2d472a))


### Dependencies

- Updated document-schema.js to 7.10.0
- Updated archive-codec to 1.10.8

## [4.12.6](https://github.com/ExaDev/documents.js/compare/xls-codec%404.12.5...xls-codec%404.12.6) (2026-09-11)


### Dependencies

- Updated document-schema.js to 7.9.1
- Updated archive-codec to 1.10.7

## [4.12.5](https://github.com/ExaDev/documents.js/compare/xls-codec%404.12.4...xls-codec%404.12.5) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.9.0
- Updated archive-codec to 1.10.6

## [4.12.4](https://github.com/ExaDev/documents.js/compare/xls-codec%404.12.3...xls-codec%404.12.4) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.8.0
- Updated archive-codec to 1.10.5

## [4.12.3](https://github.com/ExaDev/documents.js/compare/xls-codec%404.12.2...xls-codec%404.12.3) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.7.0
- Updated archive-codec to 1.10.4

## [4.12.2](https://github.com/ExaDev/documents.js/compare/xls-codec%404.12.1...xls-codec%404.12.2) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.6.1
- Updated archive-codec to 1.10.3

## [4.12.1](https://github.com/ExaDev/documents.js/compare/xls-codec%404.12.0...xls-codec%404.12.1) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.6.0
- Updated archive-codec to 1.10.2

## [4.12.0](https://github.com/ExaDev/documents.js/compare/xls-codec%404.11.1...xls-codec%404.12.0) (2026-09-10)

### Features

* **xls-codec:** write data validations and cellIs conditional formats ([dbc0e59](https://github.com/ExaDev/documents.js/commit/dbc0e593125390179a219750d6d8242fd1a3e70d))

## [4.11.1](https://github.com/ExaDev/documents.js/compare/xls-codec%404.11.0...xls-codec%404.11.1) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.5.1
- Updated archive-codec to 1.10.1

## [4.11.0](https://github.com/ExaDev/documents.js/compare/xls-codec%404.10.0...xls-codec%404.11.0) (2026-09-08)

### Features

* **xls-codec:** compile same-sheet formula text into Formula records ([80f5d2b](https://github.com/ExaDev/documents.js/commit/80f5d2b2cb08740230d15da32b5893ecc5f62629))
* **xls-codec:** wire formula and comment records into the worksheet writer ([818b910](https://github.com/ExaDev/documents.js/commit/818b910c82cfc059fc2c71423477c309edc296f2))
* **xls-codec:** write a cell comment back to its Note/Obj/Txo triple ([6576360](https://github.com/ExaDev/documents.js/commit/65763606c1b895595128f240e8f8bb3f0289fb04))

### Documentation

* **xls-codec:** document formula writing and cell comment writing ([08fa385](https://github.com/ExaDev/documents.js/commit/08fa385769b5026b2a6c719fe269d3eff494c399))

## [4.10.0](https://github.com/ExaDev/documents.js/compare/xls-codec%404.9.0...xls-codec%404.10.0) (2026-09-08)

### Features

* **xls-codec:** decrypt XOR-obfuscated workbooks ([02e9ea7](https://github.com/ExaDev/documents.js/commit/02e9ea76fa106459e70f85a603262bf9f22ad455))


### Dependencies

- Updated archive-codec to 1.10.0

## [4.9.0](https://github.com/ExaDev/documents.js/compare/xls-codec%404.8.0...xls-codec%404.9.0) (2026-09-08)

### Features

* **xls-codec:** extract a formula's first literal string operand without rendering it whole ([e2a212d](https://github.com/ExaDev/documents.js/commit/e2a212d2fdee79eb6d0600d42af8f594c21133b9))
* **xls-codec:** map containsText-family CF12/CFEx rules onto the shared schema ([37c457c](https://github.com/ExaDev/documents.js/commit/37c457cd84e2f769b7603c1170257dfc10dc56b1))
* **xls-codec:** parse CF12 containsText/notContainsText/beginsWith/endsWith rules ([6139b13](https://github.com/ExaDev/documents.js/commit/6139b138af28507a923420684ee9f91244032dd1))
* **xls-codec:** read CFEx records extending a legacy CF with containsText metadata ([3447916](https://github.com/ExaDev/documents.js/commit/344791632950c72d9eba5f5688b90823dddde4c5))

### Bug Fixes

* **xls-codec:** bound BlockCursor.take() against remaining record bytes before allocating ([bdfbe85](https://github.com/ExaDev/documents.js/commit/bdfbe8521a96a6e299f208e69eacb137ca3bf384))

### Code Refactoring

* **xls-codec:** expose CondFmt's own nID and each CF's raw operand ([aa25fd2](https://github.com/ExaDev/documents.js/commit/aa25fd24b1dc2617caf93253801c9fb29fb4060c))

### Documentation

* **xls-codec:** document containsText and CFEx conditional-format coverage ([25dbbc7](https://github.com/ExaDev/documents.js/commit/25dbbc749c8a93e7402112d7019a1395e4cee933))

## [4.8.0](https://github.com/ExaDev/documents.js/compare/xls-codec%404.7.6...xls-codec%404.8.0) (2026-09-08)

### Features

* **xls-codec:** add record type constants for drawings and charts ([af20572](https://github.com/ExaDev/documents.js/commit/af205724bf8d2a3e0492d0c314d46f1f41efe765))
* **xls-codec:** read charts, drawings, and images into ContentSheet ([8ae17b3](https://github.com/ExaDev/documents.js/commit/8ae17b3cd353cd2cb481303fab82bcef7c078d0f))
* **xls-codec:** read embedded chart series data from its own substream ([716498d](https://github.com/ExaDev/documents.js/commit/716498dea93fcab56706f6b5ac0ff0c7312b3902))
* **xls-codec:** read MS-ODRAW Escher shapes and the workbook Blip Store ([85dedf5](https://github.com/ExaDev/documents.js/commit/85dedf5c509c0e56ef5dcd11010ebc95cb6e676e))

### Bug Fixes

* **xls-codec:** nest a chart substream inside the worksheet substream that anchors it ([652e410](https://github.com/ExaDev/documents.js/commit/652e4102c9aa3d540b9e9fb4789f0091b1257193))
* **xls-codec:** write a chart's shared category column once, not once per series ([4aec960](https://github.com/ExaDev/documents.js/commit/4aec960aaf484234e64c16acf77889f878b31c6c))

### Documentation

* **xls-codec:** document charts, drawings, and images support ([06e69d9](https://github.com/ExaDev/documents.js/commit/06e69d913f22e41726b22f88716ced0e45fe870c))

## [4.7.6](https://github.com/ExaDev/documents.js/compare/xls-codec%404.7.5...xls-codec%404.7.6) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.5.0
- Updated archive-codec to 1.9.2

## [4.7.5](https://github.com/ExaDev/documents.js/compare/xls-codec%404.7.4...xls-codec%404.7.5) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.4.0
- Updated archive-codec to 1.9.1

## [4.7.4](https://github.com/ExaDev/documents.js/compare/xls-codec%404.7.3...xls-codec%404.7.4) (2026-09-08)


### Dependencies

- Updated archive-codec to 1.9.0

## [4.7.3](https://github.com/ExaDev/documents.js/compare/xls-codec%404.7.2...xls-codec%404.7.3) (2026-09-08)


### Dependencies

- Updated archive-codec to 1.8.0

## [4.7.2](https://github.com/ExaDev/documents.js/compare/xls-codec%404.7.1...xls-codec%404.7.2) (2026-09-08)


### Dependencies

- Updated archive-codec to 1.7.2

## [4.7.1](https://github.com/ExaDev/documents.js/compare/xls-codec%404.7.0...xls-codec%404.7.1) (2026-09-08)

### Bug Fixes

* **hooks:** remove stale per-package lint-staged fields ([1b85b5a](https://github.com/ExaDev/documents.js/commit/1b85b5a545fb9762879310ed4ea73b68fa73d00d))

### Miscellaneous Chores

* **deps:** pin every workspace dependency to an exact fixed version ([6a38142](https://github.com/ExaDev/documents.js/commit/6a38142facc043dfa499573f37431d3b32ff602e))


### Dependencies

- Updated document-schema.js to 7.3.1
- Updated excel-number-format to 1.1.1
- Updated archive-codec to 1.7.1

## [4.7.0](https://github.com/ExaDev/documents.js/compare/xls-codec%404.6.0...xls-codec%404.7.0) (2026-09-08)

### Features

* **xls-codec:** decrypt RC4-encrypted workbooks given a password ([e655deb](https://github.com/ExaDev/documents.js/commit/e655deb89a13dc7fdb9921e4ee6b156223706a24))

### Documentation

* document RC4 decryption for encrypted xls workbooks ([268cbd3](https://github.com/ExaDev/documents.js/commit/268cbd342b080a0d23754d5b78e4fa87ebf17acf))


### Dependencies

- Updated archive-codec to ^1.7.0

## [4.6.0](https://github.com/ExaDev/documents.js/compare/xls-codec%404.5.0...xls-codec%404.6.0) (2026-09-08)

### Features

* **xls-codec:** read BIFF8 CF12 top10, aboveAverage, and other filter-dispatched rules ([ed1056c](https://github.com/ExaDev/documents.js/commit/ed1056cfecb7675a101a168448fefaeeb5c69189))

### Bug Fixes

* **xls-codec:** preserve DXFN12 styles and reject a zero top10 rank ([40713fa](https://github.com/ExaDev/documents.js/commit/40713fa9fb9586c67c53321ba14abdc06ef046b6))

### Documentation

* **xls-codec:** correct a stale claim about ct 0x05's own DXFN12 scope ([1241bc6](https://github.com/ExaDev/documents.js/commit/1241bc6573efad4b705d00a83460cf0b68e733c1))

## [4.5.0](https://github.com/ExaDev/documents.js/compare/xls-codec%404.4.0...xls-codec%404.5.0) (2026-09-08)

### Features

* **xls-codec:** add Excel's TintAndShade colour model to xf-colors ([47738ba](https://github.com/ExaDev/documents.js/commit/47738ba352644cfcdf57c8c8644341cda5ff25a4)), references [getTint/#setTint](https://github.com/ExaDev/documents.js/issues/setTint)
* **xls-codec:** read BIFF8 CF12 colour scale, data bar, and icon set rules ([da8be8e](https://github.com/ExaDev/documents.js/commit/da8be8eb8b09f4aa9137e75a75fe1ad2d3080005))

### Bug Fixes

* **xls-codec:** correct CF12 icon-set byte order and join ContinueFrt12 continuations ([5e7bc7d](https://github.com/ExaDev/documents.js/commit/5e7bc7d64d1b184330b10859156891c869953047))

## [4.4.0](https://github.com/ExaDev/documents.js/compare/xls-codec%404.3.0...xls-codec%404.4.0) (2026-09-07)

### Features

* **xls-codec:** read BIFF8 CondFmt/CF records into ContentSheet.conditionalFormats ([aa65310](https://github.com/ExaDev/documents.js/commit/aa65310c05fc78e6f5646b95aa55bb70e65e83fa))

## [4.3.0](https://github.com/ExaDev/documents.js/compare/xls-codec%404.2.3...xls-codec%404.3.0) (2026-09-07)

### Features

* **xls-codec:** read BIFF8 Dv/DVal records into ContentSheet.dataValidations ([1a99e61](https://github.com/ExaDev/documents.js/commit/1a99e61f028600b96f13bc1c5be11a9793d13e39))

## [4.2.3](https://github.com/ExaDev/documents.js/compare/xls-codec%404.2.2...xls-codec%404.2.3) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.3.0
- Updated archive-codec to ^1.6.8

## [4.2.2](https://github.com/ExaDev/documents.js/compare/xls-codec%404.2.1...xls-codec%404.2.2) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.2.0
- Updated archive-codec to ^1.6.7

## [4.2.1](https://github.com/ExaDev/documents.js/compare/xls-codec%404.2.0...xls-codec%404.2.1) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.1.0
- Updated archive-codec to ^1.6.6

## [4.2.0](https://github.com/ExaDev/documents.js/compare/xls-codec%404.1.6...xls-codec%404.2.0) (2026-09-07)

### Features

* **xls-codec:** read cell comments (Note/Obj/Txo) ([e9accbe](https://github.com/ExaDev/documents.js/commit/e9accbecefc474fcbc39202115df8c82d6c8fe00))

## [4.1.6](https://github.com/ExaDev/documents.js/compare/xls-codec%404.1.5...xls-codec%404.1.6) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.0.0
- Updated archive-codec to ^1.6.5

## [4.1.5](https://github.com/ExaDev/documents.js/compare/xls-codec%404.1.4...xls-codec%404.1.5) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.3
- Updated archive-codec to ^1.6.4

## [4.1.4](https://github.com/ExaDev/documents.js/compare/xls-codec%404.1.3...xls-codec%404.1.4) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.2
- Updated archive-codec to ^1.6.3

## [4.1.3](https://github.com/ExaDev/documents.js/compare/xls-codec%404.1.2...xls-codec%404.1.3) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.1
- Updated archive-codec to ^1.6.2

## [4.1.2](https://github.com/ExaDev/documents.js/compare/xls-codec%404.1.1...xls-codec%404.1.2) (2026-09-06)


### Dependencies

- Updated document-schema.js to ^6.2.0
- Updated archive-codec to ^1.6.1

## [4.1.1](https://github.com/ExaDev/documents.js/compare/xls-codec%404.1.0...xls-codec%404.1.1) (2026-09-06)


### Dependencies

- Updated archive-codec to ^1.6.0

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
