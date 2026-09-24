## [6.1.6](https://github.com/ExaDev/documents.js/compare/doc-codec%406.1.5...doc-codec%406.1.6) (2026-09-24)


### Dependencies

- Updated archive-codec to 1.11.15

## [6.1.5](https://github.com/ExaDev/documents.js/compare/doc-codec%406.1.4...doc-codec%406.1.5) (2026-09-24)

### Bug Fixes

* **doc-codec:** rename two shadowed test-support identifiers ([582fd4f](https://github.com/ExaDev/documents.js/commit/582fd4f869dd16d32513c92ed5f86ae7395bfb57))
* **doc-codec:** wrap five bare TSDoc-special character sequences in backticks ([4f6a874](https://github.com/ExaDev/documents.js/commit/4f6a87402d2f32854ebd6d58264127ffd4a60c9a))


### Dependencies

- Updated archive-codec to 1.11.14

## [6.1.4](https://github.com/ExaDev/documents.js/compare/doc-codec%406.1.3...doc-codec%406.1.4) (2026-09-24)


### Dependencies

- Updated byte-codec to 2.0.0
- Updated archive-codec to 1.11.13

## [6.1.3](https://github.com/ExaDev/documents.js/compare/doc-codec%406.1.2...doc-codec%406.1.3) (2026-09-23)


### Dependencies

- Updated byte-codec to 1.10.1

## [6.1.2](https://github.com/ExaDev/documents.js/compare/doc-codec%406.1.1...doc-codec%406.1.2) (2026-09-23)


### Dependencies

- Updated byte-codec to 1.10.0

## [6.1.1](https://github.com/ExaDev/documents.js/compare/doc-codec%406.1.0...doc-codec%406.1.1) (2026-09-23)


### Dependencies

- Updated byte-codec to 1.9.0

## [6.1.0](https://github.com/ExaDev/documents.js/compare/doc-codec%406.0.3...doc-codec%406.1.0) (2026-09-23)

### Features

* **doc-codec:** report a dropped header column via onWarning ([b06f6d4](https://github.com/ExaDev/documents.js/commit/b06f6d46e848d768e0eacd026a56999c666f3e36))

## [6.0.3](https://github.com/ExaDev/documents.js/compare/doc-codec%406.0.2...doc-codec%406.0.3) (2026-09-22)

### Code Refactoring

* **doc-codec,wpd-codec:** migrate tables to ContentTable.columns ([8505d87](https://github.com/ExaDev/documents.js/commit/8505d87af5710c70b5780b3842e06140c9ceb46c))


### Dependencies

- Updated document-schema.js to 7.15.0
- Updated archive-codec to 1.11.12

## [6.0.2](https://github.com/ExaDev/documents.js/compare/doc-codec%406.0.1...doc-codec%406.0.2) (2026-09-22)

### Bug Fixes

* **workspace:** replace the spaced double-hyphen dash substitute with a real em-dash workspace-wide ([c42a9c7](https://github.com/ExaDev/documents.js/commit/c42a9c7e0bc7cd87456ca72204a5ac423a7ca341))


### Dependencies

- Updated byte-codec to 1.8.1
- Updated document-schema.js to 7.14.1
- Updated archive-codec to 1.11.11

## [6.0.1](https://github.com/ExaDev/documents.js/compare/doc-codec%406.0.0...doc-codec%406.0.1) (2026-09-21)

### Tests

* **doc-codec:** pin a table row's header flag through a write/read round trip ([74717a3](https://github.com/ExaDev/documents.js/commit/74717a38a14ddba3aad48571f762396da34432da))

## [6.0.0](https://github.com/ExaDev/documents.js/compare/doc-codec%405.0.0...doc-codec%406.0.0) (2026-09-21)

### ⚠ BREAKING CHANGES

* **doc-codec:** a doc row carrying isHeader now writes a
  sprmTTableHeader into its row-ending mark's own grpprl, where nothing
  was written before. A table whose rows state no header flag writes
  byte identically to before.

### Features

* **doc-codec:** read and write a table row's sprmTTableHeader ([7f1a6af](https://github.com/ExaDev/documents.js/commit/7f1a6af72473a53057896cd696345fabdff7992c)), references [#1377](https://github.com/ExaDev/documents.js/issues/1377)


### Dependencies

- Updated byte-codec to 1.8.0
- Updated document-schema.js to 7.14.0
- Updated archive-codec to 1.11.10

## [5.0.0](https://github.com/ExaDev/documents.js/compare/doc-codec%404.0.1...doc-codec%405.0.0) (2026-09-21)

### ⚠ BREAKING CHANGES

* **doc-codec:** a ContentTable violating the grid rule stated on ContentTableCell
  is now refused rather than written with the offending content silently dropped. A
  caller building a table by hand must give every row one cell per grid column, keep
  a merged region's content on its anchor, and state each span once, on the anchor.

### Bug Fixes

* **doc-codec:** refuse a table that breaks the grid rule rather than writing past it ([4cb1d99](https://github.com/ExaDev/documents.js/commit/4cb1d999982a0daa05b7f0386d5e76708c3fd428))


### Dependencies

- Updated document-schema.js to 7.13.0
- Updated archive-codec to 1.11.9

## [4.0.1](https://github.com/ExaDev/documents.js/compare/doc-codec%404.0.0...doc-codec%404.0.1) (2026-09-21)


### Dependencies

- Updated byte-codec to 1.7.0

## [4.0.0](https://github.com/ExaDev/documents.js/compare/doc-codec%403.0.1...doc-codec%404.0.0) (2026-09-21)

### ⚠ BREAKING CHANGES

* **doc-codec:** a .doc table read by this package now has one ContentTableCell per
  grid column in every row. A consumer that padded colSpan - 1 placeholders of its own
  must stop padding and read the array directly.

### Bug Fixes

* **doc-codec:** give a .doc table one cell per grid column in both directions ([e28aa07](https://github.com/ExaDev/documents.js/commit/e28aa07101c9e30af58eeb7ce4de031832bd7f9d))


### Dependencies

- Updated document-schema.js to 7.12.0
- Updated archive-codec to 1.11.8

## [3.0.1](https://github.com/ExaDev/documents.js/compare/doc-codec%403.0.0...doc-codec%403.0.1) (2026-09-20)

### Documentation

* make a hand-typed scoped mutation run find its package's Stryker config ([ed3297b](https://github.com/ExaDev/documents.js/commit/ed3297b6aa71b2d94913519e6960537ca5ac0f61))


### Dependencies

- Updated byte-codec to 1.6.3
- Updated document-schema.js to 7.11.5
- Updated archive-codec to 1.11.7

## [3.0.0](https://github.com/ExaDev/documents.js/compare/doc-codec%402.12.4...doc-codec%403.0.0) (2026-09-20)

### ⚠ BREAKING CHANGES

* **doc-codec:** The doc-codec/base64 deep import is removed.
  bytesToBase64 and base64ToBytes come from byte-codec now, and are
  still on this package's own barrel as well. The removal already
  shipped, unmarked, in 2.12.4.

### Documentation

* **doc-codec:** state that base64 moved out of src/base64.ts ([8bf0b1e](https://github.com/ExaDev/documents.js/commit/8bf0b1e54c40956fc08a1cef3d9f84e127334596))


### Dependencies

- Updated byte-codec to 1.6.2

## [2.12.4](https://github.com/ExaDev/documents.js/compare/doc-codec%402.12.3...doc-codec%402.12.4) (2026-09-20)

### Code Refactoring

* **doc-codec:** encode and decode base64 through byte-codec ([af616d0](https://github.com/ExaDev/documents.js/commit/af616d0fd3b3c1f5921000bb99e61c17e013e1eb))


### Dependencies

- Updated byte-codec to 1.6.1
- Updated archive-codec to 1.11.6

## [2.12.3](https://github.com/ExaDev/documents.js/compare/doc-codec%402.12.2...doc-codec%402.12.3) (2026-09-20)


### Dependencies

- Updated document-schema.js to 7.11.4
- Updated archive-codec to 1.11.5

## [2.12.2](https://github.com/ExaDev/documents.js/compare/doc-codec%402.12.1...doc-codec%402.12.2) (2026-09-19)

### Performance Improvements

* **doc-codec:** encode base64 in chunks of character codes ([2dd3123](https://github.com/ExaDev/documents.js/commit/2dd3123fb800c70340b8a6272c6e3f0e7268db35))

### Tests

* **doc-codec:** check bytesToBase64 against a naive reference and Buffer ([aba3bf1](https://github.com/ExaDev/documents.js/commit/aba3bf14196353b9a05b70cce7abfcf1a62fc173))

## [2.12.1](https://github.com/ExaDev/documents.js/compare/doc-codec%402.12.0...doc-codec%402.12.1) (2026-09-14)

### Documentation

* reword stryker.config.ts comments to avoid the banned phrase ([1553892](https://github.com/ExaDev/documents.js/commit/1553892fb68ddce9bcb7eee7ebebc31e1f9cdc79))

### Miscellaneous Chores

* bump pinned pnpm to 12.4.1 across the workspace ([4e81c2d](https://github.com/ExaDev/documents.js/commit/4e81c2dfdb08fff226c20a0f267baffa87758e0f))
* **lint:** except each package's own measured eslint-config 2.12.1 debt ([11c35bc](https://github.com/ExaDev/documents.js/commit/11c35bc61db74c68b4be725c34452509fba00c2a))


### Dependencies

- Updated document-schema.js to 7.11.3
- Updated archive-codec to 1.11.4

## [2.12.0](https://github.com/ExaDev/documents.js/compare/doc-codec%402.11.1...doc-codec%402.12.0) (2026-09-14)

### Features

* **doc-codec:** add assertDefined, a narrowing assertion for writer-side invariants ([13cdc5e](https://github.com/ExaDev/documents.js/commit/13cdc5e92ec9b15b5d3cfe434ae3f69336bfa7cc))
* **doc-codec:** add Plc.keyAt, a bounds-checked key accessor ([1eaac56](https://github.com/ExaDev/documents.js/commit/1eaac56e1314ea4cbe6122147e42ae8c4ccb04ef))

### Bug Fixes

* **doc-codec:** derive test's merged-cell index from the table's own width count ([ed5ad61](https://github.com/ExaDev/documents.js/commit/ed5ad6198c4422b870337804d261ace608c59a0c))

### Code Refactoring

* **doc-codec:** derive nearestIcoColor from a shared palette search ([5a19d84](https://github.com/ExaDev/documents.js/commit/5a19d843f7901d5706e0c01cc3859df061f992f0))
* **doc-codec:** drop buildFib's own unreachable wIdent self-check ([6b16a0b](https://github.com/ExaDev/documents.js/commit/6b16a0b3a767ceb9d3b9d49fbda820be9c821fc4))
* **doc-codec:** drop buildPlcfSed's own redundant zero write for sed.fn ([b2688b8](https://github.com/ExaDev/documents.js/commit/b2688b84b2371af8b55d54735651a193584ab25a))
* **doc-codec:** drop buildTextClx's own unreachable shape self-check ([34f66e3](https://github.com/ExaDev/documents.js/commit/34f66e37fe340d340e952d4b7ed0000547279e6f))
* **doc-codec:** drop cellReachesTableBottom's own redundant fast paths ([92cbdd1](https://github.com/ExaDev/documents.js/commit/92cbdd18e8940a03c7c0843122e160156083c314))
* **doc-codec:** drop int16's own redundant negative-to-unsigned conversion ([5ba7425](https://github.com/ExaDev/documents.js/commit/5ba7425f6a806da4c8c18fbdeed186ac8de4a897))
* **doc-codec:** drop int16's own redundant negative-to-unsigned conversion ([8167ced](https://github.com/ExaDev/documents.js/commit/8167ced71db6d973297649b54af5723f26a61528))
* **doc-codec:** drop Plc.element's own unreachable slice bounds check ([193123c](https://github.com/ExaDev/documents.js/commit/193123c14df5ca17d57a1606b57ac35561ecdc29))
* **doc-codec:** drop resolveStyleFormatting's unreachable style guard ([31b60d9](https://github.com/ExaDev/documents.js/commit/31b60d9e1c9ad23c615233f085dfec24a1e4a372))
* **doc-codec:** drop the pointless endianness on Sed's own always-symmetric fields ([f306dc2](https://github.com/ExaDev/documents.js/commit/f306dc219abb5d786564baec713527bebcf0ee81))
* **doc-codec:** drop the redundant break from three sprm switches' own last default clause ([a43685a](https://github.com/ExaDev/documents.js/commit/a43685a21bc4e67bd6605208b3fbf5a1ecdb25fc))
* **doc-codec:** drop the redundant left-edge filter in splitAtLostBoundaries ([8b5a591](https://github.com/ExaDev/documents.js/commit/8b5a5916cb70200175985d695cddf628823efd56))
* **doc-codec:** drop three redundant capacity guards in FKP page-splitting ([2cab669](https://github.com/ExaDev/documents.js/commit/2cab669e8e66202624cb926798ade46907ad615d))
* **doc-codec:** drop three redundant no-border/no-shading guards ([ae69f4f](https://github.com/ExaDev/documents.js/commit/ae69f4fbb6172dac5be67bd7d0e05b74361828ca))
* **doc-codec:** drop three unreachable STSHI/STD pad-byte checks ([3d08e21](https://github.com/ExaDev/documents.js/commit/3d08e210cc6c5730f239ef1c02ad8b7318da9477))
* **doc-codec:** drop two unreachable bounds checks in subdocument reading ([e105fa7](https://github.com/ExaDev/documents.js/commit/e105fa75d29ff27a5650e769d941fb0115f6b9f8))
* **doc-codec:** drop verifyPassword's own unreachable hash-length check ([e5ae04a](https://github.com/ExaDev/documents.js/commit/e5ae04a87b17ec28c62cf25cc3c08208b6166e1a))
* **doc-codec:** extract createFontIndexMinter out of writeDocContent's own body ([c41f1fd](https://github.com/ExaDev/documents.js/commit/c41f1fd95040a25b7925b511bdefa267258b88f0))
* **doc-codec:** extract doc.ts's own internal helpers for direct testing ([c700ac1](https://github.com/ExaDev/documents.js/commit/c700ac1d33e16aa8e66eaca7e98b8a22369d8e3f))
* **doc-codec:** extract groupAt, cover read.ts's own bounds labels ([13f6dc0](https://github.com/ExaDev/documents.js/commit/13f6dc0f73a613ca3e0aafdb9af53253265509e4))
* **doc-codec:** extract mintStyleIstds out of writeDocContent's own body ([842626e](https://github.com/ExaDev/documents.js/commit/842626eda031b9aa1c78d800d8d13ab77280589f))
* **doc-codec:** extract skipPicName, drop findBlipRecord's own redundant length check ([2ca3242](https://github.com/ExaDev/documents.js/commit/2ca3242ccd113cb4b4b071b24d30dc4f8f0ff9f2))
* **doc-codec:** extract text-layout and Chpx-merge logic out of writeDocContent ([9c3404e](https://github.com/ExaDev/documents.js/commit/9c3404ea13ef8fd77a95d0f2df4bc3dc0a0aab04))
* **doc-codec:** iterate SLOT_ORDER as pairs, cover its section boundary ([5c051f7](https://github.com/ExaDev/documents.js/commit/5c051f7dea540f90824251edb5109f341e289826))
* **doc-codec:** map code units one at a time instead of chunking ([b3cac9a](https://github.com/ExaDev/documents.js/commit/b3cac9a7126dc3659236a3682d212cdf07cdcb6a))
* **doc-codec:** merge PropertyBinTable's page lookups, drop its unreachable page-number check ([2ec584e](https://github.com/ExaDev/documents.js/commit/2ec584e8490c768f7fd14aa4044e0d0e7e8e5e73)), references [#pageBytes](https://github.com/ExaDev/documents.js/issues/pageBytes) [#pageNumberFor](https://github.com/ExaDev/documents.js/issues/pageNumberFor) [#resolvePage](https://github.com/ExaDev/documents.js/issues/resolvePage) [#pageNumbers](https://github.com/ExaDev/documents.js/issues/pageNumbers)
* **doc-codec:** read EncryptionHeader's own three fields unchecked ([87dabc7](https://github.com/ExaDev/documents.js/commit/87dabc746b5c023a6af5b44b93e6b4cde6d1f205))
* **doc-codec:** remove an arithmetic mutant in the table writer's lost-boundary split ([25b9731](https://github.com/ExaDev/documents.js/commit/25b973127b549ecd43c0dcf989902f637d87f772))
* **doc-codec:** remove base64's unobservable bounds checks and capacity guess ([3ccabd3](https://github.com/ExaDev/documents.js/commit/3ccabd32ea21382a0bd1f2867d8a878004a39575))
* **doc-codec:** remove readStoryPlexKeys' unreachable negative-key clause ([7842124](https://github.com/ExaDev/documents.js/commit/7842124496e751e718aae304ae4e680f8bd85577))
* **doc-codec:** remove three genuinely-equivalent loop/guard AST nodes in table writer ([ac642bb](https://github.com/ExaDev/documents.js/commit/ac642bbcabafde235d5c1d19c9c3be57c6762e5e))
* **doc-codec:** restate parseFib's blob-size guard as whole 4-byte pairs ([b4351dd](https://github.com/ExaDev/documents.js/commit/b4351dda685def18d4e02d9a8bcfcaa5edba1f20))
* **doc-codec:** simplify readStoryPlexKeys' key-count check, drop the boundaryLcb guard ([ffec8a5](https://github.com/ExaDev/documents.js/commit/ffec8a5cea6f9f9e4675e3844681c6b028396071))
* **doc-codec:** state findBlipRecord's own scan bound as a byte count, not arithmetic ([cf54141](https://github.com/ExaDev/documents.js/commit/cf5414129457b217a2f320cbc9626f0bf660fef1))
* **doc-codec:** tighten findBlipRecord's own scan bound to the smallest a real find can need ([eb76de4](https://github.com/ExaDev/documents.js/commit/eb76de4968983b8895cf0c7420dda55f68a6545e))
* **doc-codec:** use assertDefined for buildChpxPages/buildPapxPages' own refit checks ([8f14743](https://github.com/ExaDev/documents.js/commit/8f147431351441c0c1e5efd954534382f12fd3d9))
* **doc-codec:** use Plc.keyAt in parseClx, remove its own dead guards ([1e58463](https://github.com/ExaDev/documents.js/commit/1e58463efcac1c5dfa8aa61148c0871e5d0fe554))
* **doc-codec:** walk UTF-16 code units via split(""), not a bounded loop, when writing text ([def81d1](https://github.com/ExaDev/documents.js/commit/def81d125854774b96534398d2c5aaf307965795))

### Documentation

* **doc-codec:** re-derive breakThreshold's own comment from the current measured score ([afd905d](https://github.com/ExaDev/documents.js/commit/afd905dafdc62cf9458c26bf3aac3c7b07cbf22f))

### Tests

* **doc-codec:** add tap.test.ts, direct coverage for applyTableSprms ([d07fcb0](https://github.com/ExaDev/documents.js/commit/d07fcb093f80406a058818ac7552cec3e7a0c6ab))
* **doc-codec:** assert the diagonal-cross fill's own absent colour keys ([c1e47d6](https://github.com/ExaDev/documents.js/commit/c1e47d6b2e1b7b1c5d16b0af8ba81977e63d50a5))
* **doc-codec:** close the remaining survived mutants after a full run ([506475e](https://github.com/ExaDev/documents.js/commit/506475e563f894d04389cdec8cf82dfd1e1ffde3))
* **doc-codec:** cover applyCharacterSprms/characterIstdFromGrpprl and chp-write directly ([4ce24a0](https://github.com/ExaDev/documents.js/commit/4ce24a0596cba258c85620a5de478b98ac1da488))
* **doc-codec:** cover applyParagraphSprms and encodeParagraphGrpprl directly ([d80d7c1](https://github.com/ExaDev/documents.js/commit/d80d7c1db3e4f528d9b98cabf8496b9c829b802d))
* **doc-codec:** cover applySectionSprms/readAllSectionProperties and sep-write directly ([bace6de](https://github.com/ExaDev/documents.js/commit/bace6decc72cddbd437cf8b58206c50b689f58af))
* **doc-codec:** cover base64, bytes, color, and special-character helpers directly ([acdf00d](https://github.com/ExaDev/documents.js/commit/acdf00dffb149d2032ad7a745cf1c2ad5b50bc2c))
* **doc-codec:** cover buildBinTable with more than one page number ([237e05c](https://github.com/ExaDev/documents.js/commit/237e05ccbf93776d626ec56c0ff7b1b933b1de98))
* **doc-codec:** cover buildDoc's independent subdocument branches ([c144ec3](https://github.com/ExaDev/documents.js/commit/c144ec36c0aed7e2f591e7b1830114df80083a91))
* **doc-codec:** cover buildDoc's text/piece/style/subdocument branches directly ([77d571b](https://github.com/ExaDev/documents.js/commit/77d571bf766918954580c5c0d869ddb899d935b3))
* **doc-codec:** cover buildFib's own nFibBack byte order ([40d25e4](https://github.com/ExaDev/documents.js/commit/40d25e4d22fe750dbe9968cfbfbb825c4a0e3920))
* **doc-codec:** cover buildFib's pair-write boundary directly ([43f8f7c](https://github.com/ExaDev/documents.js/commit/43f8f7c8ff0c454edf7ff393893cad974a2f87a2))
* **doc-codec:** cover buildInlinePicture directly ([2841b98](https://github.com/ExaDev/documents.js/commit/2841b982eaa22f98169262ef1d332efb0695cee6))
* **doc-codec:** cover buildInlinePicture's own MFPF.mm byte order ([d3bdc7a](https://github.com/ExaDev/documents.js/commit/d3bdc7ae96f4c9105f626378e808f76832ee0499))
* **doc-codec:** cover buildInlinePicture's raw record-header bytes ([287dec5](https://github.com/ExaDev/documents.js/commit/287dec5a7afad6674206b75fd79198194b5616db))
* **doc-codec:** cover DocFormatError/DocUnsupportedError and metadata date validation ([c8e9feb](https://github.com/ExaDev/documents.js/commit/c8e9feb2d8d1a2e53a4926f7d5f6616fc53889f8))
* **doc-codec:** cover encodeTableRowGrpprl directly ([f05aa8e](https://github.com/ExaDev/documents.js/commit/f05aa8e1f0d9e561c22865d498741a5a897d8dfe))
* **doc-codec:** cover findBlipRecord's own scan bound one byte past its minimum ([f7c685b](https://github.com/ExaDev/documents.js/commit/f7c685b122641741673ba213dcdfcf278aa3a5d3))
* **doc-codec:** cover FKP page parsing boundary conditions directly ([3a540fb](https://github.com/ExaDev/documents.js/commit/3a540fbd75ffa3a3aa3ae3d84a2422d5c6a37356))
* **doc-codec:** cover FKP page-splitting and bin-table encoding directly ([01350c8](https://github.com/ExaDev/documents.js/commit/01350c8d41285c6418796d19dfea3b0885fb94b0))
* **doc-codec:** cover fontFamily's own guard and the sprm switch's default case ([e5a4529](https://github.com/ExaDev/documents.js/commit/e5a4529f70ba56a2097673bbb27b05ffcef098bc))
* **doc-codec:** cover gatherListUsage and buildNumberingTables edge cases ([96e8617](https://github.com/ExaDev/documents.js/commit/96e8617dc839bb38e42a32727dca8f6a95718f5a))
* **doc-codec:** cover isDocBytes/notes/headers-footers, drop a redundant signature check ([3217c88](https://github.com/ExaDev/documents.js/commit/3217c881746116242f46fcc487594d461a602a3f))
* **doc-codec:** cover LSPD's own max boundary and the sprm switch's default case ([c811976](https://github.com/ExaDev/documents.js/commit/c81197651208b948c591071c1ee157f4002edddb))
* **doc-codec:** cover numbering.ts and numbering-write.ts's own arithmetic ([137c29b](https://github.com/ExaDev/documents.js/commit/137c29b3c3312e2ffb9f82f94d28494f84460d16))
* **doc-codec:** cover operandSize's spra boundaries and cb sentinel guard ([66ca41d](https://github.com/ExaDev/documents.js/commit/66ca41d277b6c1a4cf8f0aeec36291710f6e2ab7))
* **doc-codec:** cover parseFib's own validation boundaries and fib/write.ts directly ([7cd47ef](https://github.com/ExaDev/documents.js/commit/7cd47ef613de4faec2fa2b3a2841e87f07f33fa6))
* **doc-codec:** cover parseFontTable/buildFontTable directly ([004a53d](https://github.com/ExaDev/documents.js/commit/004a53d326cd7b4951c03634f5f434c408747bd2))
* **doc-codec:** cover parsePlc's own size/order validation and sprm operand sizing ([dc3d883](https://github.com/ExaDev/documents.js/commit/dc3d883ee8f38ab3f22beb3e209c000a85c59f09))
* **doc-codec:** cover RC4 CryptoAPI rejection and a short EncryptionHeader ([54d8857](https://github.com/ExaDev/documents.js/commit/54d88577237a9883e4c3ff84da993d15a8c08ca8))
* **doc-codec:** cover readFfnName's own length boundary and slice label ([31c2c72](https://github.com/ExaDev/documents.js/commit/31c2c72f07c540a5356713e664be8315329bd783))
* **doc-codec:** cover readNumberingDefinitions' own malformed-input paths ([88d0a77](https://github.com/ExaDev/documents.js/commit/88d0a7747966e8ee255b6ffb972a937549c1b5a3))
* **doc-codec:** cover readStoryPlexKeys leniency and storyText directly ([8fdee9e](https://github.com/ExaDev/documents.js/commit/8fdee9e2f64c3072713b0006e16988282478d718))
* **doc-codec:** cover readTextRange's own validation and parseClx/buildTextClx boundaries ([64ebe56](https://github.com/ExaDev/documents.js/commit/64ebe566005c7463782d0b69c2799b45ebcc9fd8))
* **doc-codec:** cover splitEntriesByBoundaries directly ([f43d8f6](https://github.com/ExaDev/documents.js/commit/f43d8f6819742454f9764b116ef2f9f3e736aa02))
* **doc-codec:** cover subdocument-write.ts's plex and story assembly ([566dde7](https://github.com/ExaDev/documents.js/commit/566dde73898fa4509d00be4284c79cc29c8155d1))
* **doc-codec:** cover the bin-table's own whole-element-count throw and section-boundary exclusion ([2a7aae2](https://github.com/ExaDev/documents.js/commit/2a7aae2a59c66e431b84451dcf2d2cd7e64586df))
* **doc-codec:** cover the comment/endnote/header empty-array guards and slot-key boundary ([5170e20](https://github.com/ExaDev/documents.js/commit/5170e20b1b2be4ed4850b3476b37dec86d39a101))
* **doc-codec:** cover the red colour channel in sameBorder's own grouping check ([0016e08](https://github.com/ExaDev/documents.js/commit/0016e084a4813b4baa403930d8cc56e2386c730b))
* **doc-codec:** cover the section-sprm switch's default case and error labels ([fb28d42](https://github.com/ExaDev/documents.js/commit/fb28d4272c3aa2253a1d31e7a7c95a4ff473d408))
* **doc-codec:** cover the slice-overflow labels in ChpxFkp/PapxFkp/PropertyBinTable ([f78f1a2](https://github.com/ExaDev/documents.js/commit/f78f1a2d24d42e508d5c9c31e10e9eadd31a8766))
* **doc-codec:** cover the validated-blip signature mismatch path ([f29a039](https://github.com/ExaDev/documents.js/commit/f29a0398c110f19ed08ce1d7ca023cf759a85a4b))
* **doc-codec:** decode table row marks directly to pin vertMerge and horzMerge ([0ec7085](https://github.com/ExaDev/documents.js/commit/0ec7085ec9b7c7edba6f4f3d97fecb72c110c3d7))
* **doc-codec:** kill dead-code and masked mutants in table/read.ts ([37a7f02](https://github.com/ExaDev/documents.js/commit/37a7f025fc5cbd60956086d3b05021164b3ec8c0))
* **doc-codec:** name PlfLst and PlfLfo in their own past-end-of-Table rejections ([8907e44](https://github.com/ExaDev/documents.js/commit/8907e44315b4b76cf476ab38b978d6c5f6736003))
* **doc-codec:** name the actual byte count in the cbRgFcLcb rejection ([e276557](https://github.com/ExaDev/documents.js/commit/e276557e8052533d12e9f8c45a69a733c01f853d))
* **doc-codec:** narrow readNoteBodies to a Fib subset, cover its own boundary labels ([1660692](https://github.com/ExaDev/documents.js/commit/1660692c0b738796d1f02e51d82abf77cbbdf584))
* **doc-codec:** pin an ordinary cell's own zero-valued vertMerge and horzMerge ([8808bf0](https://github.com/ExaDev/documents.js/commit/8808bf0487d187fac69ad0970062889b9ab709cd))
* **doc-codec:** pin doc.ts's own exported internal helpers directly ([2d57c2a](https://github.com/ExaDev/documents.js/commit/2d57c2ad66303a5333fa2ae96ae7ed5544f5bbe1))
* **doc-codec:** pin lost-boundary and MAX_TABLE_ROW_CELLS behaviour in table/write.ts ([566c5c2](https://github.com/ExaDev/documents.js/commit/566c5c27fdd57e5b04fbe8195f9e3551b3fdd2d6))
* **doc-codec:** pin table-writer merge, boundary, and field-error behaviour ([9c53142](https://github.com/ExaDev/documents.js/commit/9c531420a72d1406b644d8872bfb67e54b911cca))
* **doc-codec:** reach a 100% mutation score for test-support/cfb.ts ([4545f55](https://github.com/ExaDev/documents.js/commit/4545f551d37249d6a6e4c7c88cb1bd4adbb2189e))
* **doc-codec:** reach a 100% mutation score for text/paragraphs.ts ([cedca89](https://github.com/ExaDev/documents.js/commit/cedca89f3f621fed0d60701a4ff6f2f24978d9b4))
* **doc-codec:** remove unreachable defensive guards from the CFB test fixture writer ([b87483b](https://github.com/ExaDev/documents.js/commit/b87483bc6da33ac4f6c566062bb815cd5d56a74f))

### Miscellaneous Chores

* **doc-codec:** raise the mutation break threshold to 81 ([748ea5c](https://github.com/ExaDev/documents.js/commit/748ea5c9f3ed2659bd242f8fed8e90b82550e836))
* **doc-codec:** raise the mutation break threshold to genuine 100% ([ceed7ea](https://github.com/ExaDev/documents.js/commit/ceed7ea3309eb15c654abb13074e3410f14a0d57))

## [2.11.1](https://github.com/ExaDev/documents.js/compare/doc-codec%402.11.0...doc-codec%402.11.1) (2026-09-13)


### Dependencies

- Updated archive-codec to 1.11.3

## [2.11.0](https://github.com/ExaDev/documents.js/compare/doc-codec%402.10.2...doc-codec%402.11.0) (2026-09-13)

### Features

* **doc-codec:** write hyperlinks as HYPERLINK fields, and read them back ([bee0160](https://github.com/ExaDev/documents.js/commit/bee01603eb4870748154d15e0a5b04227c6ebb0b))

### Documentation

* **doc-codec:** state hyperlink fields as read and written ([b8252c5](https://github.com/ExaDev/documents.js/commit/b8252c5cb93f27680ea3adabf0287636a3e2701d))

## [2.10.2](https://github.com/ExaDev/documents.js/compare/doc-codec%402.10.1...doc-codec%402.10.2) (2026-09-13)


### Dependencies

- Updated document-schema.js to 7.11.2
- Updated archive-codec to 1.11.2

## [2.10.1](https://github.com/ExaDev/documents.js/compare/doc-codec%402.10.0...doc-codec%402.10.1) (2026-09-11)

### Code Refactoring

* load stryker.config.ts directly instead of a jiti .mjs bootstrap ([4221520](https://github.com/ExaDev/documents.js/commit/42215205caa1c8fc6368ed38729d15836bdd613b))


### Dependencies

- Updated document-schema.js to 7.11.1
- Updated archive-codec to 1.11.1

## [2.10.0](https://github.com/ExaDev/documents.js/compare/doc-codec%402.9.0...doc-codec%402.10.0) (2026-09-11)

### Features

* **doc-codec:** add a genuine Word-produced corpus alongside the LibreOffice one ([59206e8](https://github.com/ExaDev/documents.js/commit/59206e8ebdcea6bdf3a578530caa1f558d153826))
* **doc-codec:** follow sprmPHugePapx into the Data stream ([8335020](https://github.com/ExaDev/documents.js/commit/8335020039a605cfe5e2ae69f21be982c746fa18))

### Bug Fixes

* **doc-codec:** drop the unused readFileSync import in fetch-word-corpus.mjs ([5498c49](https://github.com/ExaDev/documents.js/commit/5498c4957422b288bc1866129ac9959b7eeede02))
* **doc-codec:** normalise a Plcfhdd's out-of-specification placeholder CPs ([e34c1c5](https://github.com/ExaDev/documents.js/commit/e34c1c5cd452f98e96a9d8d73218add666e2c938))
* **doc-codec:** read an in-table run with no row mark as plain paragraphs ([1ee07a3](https://github.com/ExaDev/documents.js/commit/1ee07a37b9d3551e40a70bbc96a9ea56ac526ba1))
* **doc-codec:** read an out-of-table LVLF.nfc as decimal, not a refusal ([ba79898](https://github.com/ExaDev/documents.js/commit/ba79898f8d7e43de266d6a53a757811159151bfe))

### Documentation

* **doc-codec:** describe the genuine-Word corpus and what it fixed ([750dde6](https://github.com/ExaDev/documents.js/commit/750dde6411d206fb4aa63c34778a70bd7afd4adb))
* **doc-codec:** pad the sprmPTableProps README table row to match prettier's column width ([dbb6a69](https://github.com/ExaDev/documents.js/commit/dbb6a6901cc916a3088a9bb134ee019c3bf8f795))

## [2.9.0](https://github.com/ExaDev/documents.js/compare/doc-codec%402.8.6...doc-codec%402.9.0) (2026-09-11)

### Features

* **ci:** gate each measured package on its first CI mutation baseline ([9f8fa69](https://github.com/ExaDev/documents.js/commit/9f8fa6947795b2089bed03c936691893643ce2ae))
* **doc-codec:** read and write manual page breaks as the 0x000C mid-section spelling ([ba87509](https://github.com/ExaDev/documents.js/commit/ba87509358201c61fd812624077a6944a92f8355))
* **doc-codec:** write footnote, header, comment, and endnote stories ([873d1b7](https://github.com/ExaDev/documents.js/commit/873d1b79bb0374a211b021d7c9c389f2f97fac30))

### Bug Fixes

* **doc-codec:** stop dropping a note story's last paragraph when no guard follows it ([d22beb8](https://github.com/ExaDev/documents.js/commit/d22beb809c85eb79c148fd27dae767336bee3e80))

### Documentation

* **doc-codec:** state the hyperlinks/fields write gap by its real blockers ([649f5a6](https://github.com/ExaDev/documents.js/commit/649f5a6aac402dbf5bba150c34c31392438cd648))


### Dependencies

- Updated document-schema.js to 7.11.0
- Updated archive-codec to 1.11.0

## [2.8.6](https://github.com/ExaDev/documents.js/compare/doc-codec%402.8.5...doc-codec%402.8.6) (2026-09-11)


### Dependencies

- Updated document-schema.js to 7.10.0
- Updated archive-codec to 1.10.8

## [2.8.5](https://github.com/ExaDev/documents.js/compare/doc-codec%402.8.4...doc-codec%402.8.5) (2026-09-11)


### Dependencies

- Updated document-schema.js to 7.9.1
- Updated archive-codec to 1.10.7

## [2.8.4](https://github.com/ExaDev/documents.js/compare/doc-codec%402.8.3...doc-codec%402.8.4) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.9.0
- Updated archive-codec to 1.10.6

## [2.8.3](https://github.com/ExaDev/documents.js/compare/doc-codec%402.8.2...doc-codec%402.8.3) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.8.0
- Updated archive-codec to 1.10.5

## [2.8.2](https://github.com/ExaDev/documents.js/compare/doc-codec%402.8.1...doc-codec%402.8.2) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.7.0
- Updated archive-codec to 1.10.4

## [2.8.1](https://github.com/ExaDev/documents.js/compare/doc-codec%402.8.0...doc-codec%402.8.1) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.6.1
- Updated archive-codec to 1.10.3

## [2.8.0](https://github.com/ExaDev/documents.js/compare/doc-codec%402.7.2...doc-codec%402.8.0) (2026-09-10)

### Features

* **doc-codec:** add a LibreOffice-produced real-doc corpus layer ([89dd56e](https://github.com/ExaDev/documents.js/commit/89dd56e05f60207be1b325f90b35e5f0016ea7a5))

## [2.7.2](https://github.com/ExaDev/documents.js/compare/doc-codec%402.7.1...doc-codec%402.7.2) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.6.0
- Updated archive-codec to 1.10.2

## [2.7.1](https://github.com/ExaDev/documents.js/compare/doc-codec%402.7.0...doc-codec%402.7.1) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.5.1
- Updated archive-codec to 1.10.1

## [2.7.0](https://github.com/ExaDev/documents.js/compare/doc-codec%402.6.0...doc-codec%402.7.0) (2026-09-08)

### Features

* **doc-codec:** write inline PNG/JPEG pictures and every section's own page geometry ([c29fd04](https://github.com/ExaDev/documents.js/commit/c29fd040037fd3a8e428a552cb4636f2758ed1ed))

### Code Refactoring

* **doc-codec:** extract a shared isomorphic base64 codec ([5d8424d](https://github.com/ExaDev/documents.js/commit/5d8424dcf2a929820ae0063213c87be7947e78dc))

### Documentation

* **doc-codec:** document multi-section and inline-picture writing ([a92df55](https://github.com/ExaDev/documents.js/commit/a92df55c0c5a0291e8ed9f8fa7a4bf8231b4892a))

## [2.6.0](https://github.com/ExaDev/documents.js/compare/doc-codec%402.5.0...doc-codec%402.6.0) (2026-09-08)

### Features

* **doc-codec:** decrypt XOR-obfuscated documents ([b93cbbc](https://github.com/ExaDev/documents.js/commit/b93cbbc8797703e752e61643bb118e28e244a037))


### Dependencies

- Updated archive-codec to 1.10.0

## [2.5.0](https://github.com/ExaDev/documents.js/compare/doc-codec%402.4.3...doc-codec%402.5.0) (2026-09-08)

### Features

* **doc-codec:** read every section's own page size and margins ([cf6d5fd](https://github.com/ExaDev/documents.js/commit/cf6d5fdf72611c41b7fa2db866f2458a939ed542))
* **doc-codec:** read footnotes, endnotes, comments, headers, and footers ([5747a21](https://github.com/ExaDev/documents.js/commit/5747a219fac8611a48f02aa50ee318cf6ede2c06))
* **doc-codec:** read inline picture bytes from the Data stream ([7bf75bd](https://github.com/ExaDev/documents.js/commit/7bf75bd5ffcaa0a8f6c75c87170dfae8abda3a0e))
* **doc-codec:** recurse into tables nested inside a table cell ([154241a](https://github.com/ExaDev/documents.js/commit/154241a11e8b4f99b73e65690ddc9858d73c9f27))

### Bug Fixes

* **doc-codec:** update smoke test's export manifest for readAllSectionProperties ([c8843ef](https://github.com/ExaDev/documents.js/commit/c8843ef3582ec810a4d79c8d2f6a65229545eee0))

### Documentation

* **doc-codec:** document nested table, section, note, and image reading ([cfcaa66](https://github.com/ExaDev/documents.js/commit/cfcaa66f0b4e90ab974eb73594281b48b35fa623))

## [2.4.3](https://github.com/ExaDev/documents.js/compare/doc-codec%402.4.2...doc-codec%402.4.3) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.5.0
- Updated archive-codec to 1.9.2

## [2.4.2](https://github.com/ExaDev/documents.js/compare/doc-codec%402.4.1...doc-codec%402.4.2) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.4.0
- Updated archive-codec to 1.9.1

## [2.4.1](https://github.com/ExaDev/documents.js/compare/doc-codec%402.4.0...doc-codec%402.4.1) (2026-09-08)


### Dependencies

- Updated archive-codec to 1.9.0

## [2.4.0](https://github.com/ExaDev/documents.js/compare/doc-codec%402.3.7...doc-codec%402.4.0) (2026-09-08)

### Features

* **doc-codec:** decrypt RC4-encrypted documents given a password ([7ca8998](https://github.com/ExaDev/documents.js/commit/7ca899874900d53daa151c3c4bdb43b0bd728afa))


### Dependencies

- Updated archive-codec to 1.8.0

## [2.3.7](https://github.com/ExaDev/documents.js/compare/doc-codec%402.3.6...doc-codec%402.3.7) (2026-09-08)


### Dependencies

- Updated archive-codec to 1.7.2

## [2.3.6](https://github.com/ExaDev/documents.js/compare/doc-codec%402.3.5...doc-codec%402.3.6) (2026-09-08)

### Bug Fixes

* **hooks:** remove stale per-package lint-staged fields ([1b85b5a](https://github.com/ExaDev/documents.js/commit/1b85b5a545fb9762879310ed4ea73b68fa73d00d))

### Miscellaneous Chores

* **deps:** pin every workspace dependency to an exact fixed version ([6a38142](https://github.com/ExaDev/documents.js/commit/6a38142facc043dfa499573f37431d3b32ff602e))


### Dependencies

- Updated document-schema.js to 7.3.1
- Updated archive-codec to 1.7.1

## [2.3.5](https://github.com/ExaDev/documents.js/compare/doc-codec%402.3.4...doc-codec%402.3.5) (2026-09-08)


### Dependencies

- Updated archive-codec to ^1.7.0

## [2.3.4](https://github.com/ExaDev/documents.js/compare/doc-codec%402.3.3...doc-codec%402.3.4) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.3.0
- Updated archive-codec to ^1.6.8

## [2.3.3](https://github.com/ExaDev/documents.js/compare/doc-codec%402.3.2...doc-codec%402.3.3) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.2.0
- Updated archive-codec to ^1.6.7

## [2.3.2](https://github.com/ExaDev/documents.js/compare/doc-codec%402.3.1...doc-codec%402.3.2) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.1.0
- Updated archive-codec to ^1.6.6

## [2.3.1](https://github.com/ExaDev/documents.js/compare/doc-codec%402.3.0...doc-codec%402.3.1) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.0.0
- Updated archive-codec to ^1.6.5

## [2.3.0](https://github.com/ExaDev/documents.js/compare/doc-codec%402.2.5...doc-codec%402.3.0) (2026-09-07)

### Features

* **doc-codec:** round-trip a paragraph's styleId/headingLevel through a real STSH entry ([c99a3a6](https://github.com/ExaDev/documents.js/commit/c99a3a6dced3037ab12a5b3824f11dec23b37c00))

### Documentation

* **doc-codec:** document styleId/headingLevel round-tripping through the style sheet ([86b78e1](https://github.com/ExaDev/documents.js/commit/86b78e1d0a67df1880e0d8ca382f63fe03edb185)), references [#1059](https://github.com/ExaDev/documents.js/issues/1059)

### Tests

* **doc-codec:** cover styleId/headingLevel round-tripping through a real STSH entry ([6a67003](https://github.com/ExaDev/documents.js/commit/6a67003f6c1a0a335376101e5c3a5be7b5ff86ca))

## [2.2.5](https://github.com/ExaDev/documents.js/compare/doc-codec%402.2.4...doc-codec%402.2.5) (2026-09-07)

### Bug Fixes

* **doc-codec:** resolve a style's own inherited formatting on read ([6cbbb18](https://github.com/ExaDev/documents.js/commit/6cbbb18873906cad0e594f670655f48b1e32a3ba))

### Documentation

* **doc-codec:** document style-inherited formatting resolution and split the write-side gap ([38a6575](https://github.com/ExaDev/documents.js/commit/38a657569315364be88719e96312a984703a16a3)), references [#1005](https://github.com/ExaDev/documents.js/issues/1005) [ExaDev/documents.js#1059](https://github.com/ExaDev/documents.js/issues/1059)

### Tests

* **doc-codec:** cover style formatting resolution, including inheritance precedence ([f87e27d](https://github.com/ExaDev/documents.js/commit/f87e27dd9f14ddeff53744773d97e0ac911d003b))

## [2.2.4](https://github.com/ExaDev/documents.js/compare/doc-codec%402.2.3...doc-codec%402.2.4) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.3
- Updated archive-codec to ^1.6.4

## [2.2.3](https://github.com/ExaDev/documents.js/compare/doc-codec%402.2.2...doc-codec%402.2.3) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.2
- Updated archive-codec to ^1.6.3

## [2.2.2](https://github.com/ExaDev/documents.js/compare/doc-codec%402.2.1...doc-codec%402.2.2) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.1
- Updated archive-codec to ^1.6.2

## [2.2.1](https://github.com/ExaDev/documents.js/compare/doc-codec%402.2.0...doc-codec%402.2.1) (2026-09-07)

### Documentation

* **doc-codec:** correct numbering.ts's [MS-DOC] 2.9.x structure citations ([613957b](https://github.com/ExaDev/documents.js/commit/613957b42cd28012e92b80127edc829b4b7085af)), closes [ExaDev/documents.js#1027](https://github.com/ExaDev/documents.js/issues/1027)
* **doc-codec:** correct swapped [MS-DOC] 2.6.1/2.6.2 property citations ([17e5602](https://github.com/ExaDev/documents.js/commit/17e5602a195a6c98a1d331d595282ba0d0c7da89)), closes [ExaDev/documents.js#1042](https://github.com/ExaDev/documents.js/issues/1042)

## [2.2.0](https://github.com/ExaDev/documents.js/compare/doc-codec%402.1.1...doc-codec%402.2.0) (2026-09-06)

### Features

* **doc-codec:** write real PlfLst/PlfLfo numbering tables for list membership ([cb12d68](https://github.com/ExaDev/documents.js/commit/cb12d68477e67bf986bd92fccd167a8e584fbde6))
* **doc-codec:** write sprmPDxaRight for paragraph right indent ([f18d988](https://github.com/ExaDev/documents.js/commit/f18d9888d90cfa0d0095930a5d5672a6481cfcb6))

### Bug Fixes

* **doc-codec:** reject numbering definition keys that collide once numeric ([02ae8a5](https://github.com/ExaDev/documents.js/commit/02ae8a5e5c2463345e10ffdc98c5631e018eeba9))


### Dependencies

- Updated document-schema.js to ^6.2.0
- Updated archive-codec to ^1.6.1

## [2.1.1](https://github.com/ExaDev/documents.js/compare/doc-codec%402.1.0...doc-codec%402.1.1) (2026-09-06)


### Dependencies

- Updated archive-codec to ^1.6.0

## [2.1.0](https://github.com/ExaDev/documents.js/compare/doc-codec%402.0.0...doc-codec%402.1.0) (2026-09-06)

### Features

* **workspace:** add per-package Stryker mutation testing configuration ([ff3eacc](https://github.com/ExaDev/documents.js/commit/ff3eacc124577b163a1c13a63b83484d9611ae5a))

### Bug Fixes

* **workspace:** drop the unused per-package @stryker-mutator/api dependency ([69270b6](https://github.com/ExaDev/documents.js/commit/69270b6e7ad7163c3b76cd085f4e5f367433994c))


### Dependencies

- Updated document-schema.js to ^6.1.0
- Updated archive-codec to ^1.5.0

## [2.0.0](https://github.com/ExaDev/documents.js/compare/doc-codec%401.1.2...doc-codec%402.0.0) (2026-09-06)

### ⚠ BREAKING CHANGES

* **doc-codec:** readDocContent's ContentTableCell.background is now a
  discriminated ContentCellFill rather than a bare Color, matching
  document-schema.js's own breaking change to the shared schema.
  writeDocContent's cell background parameter changes the same way. A
  caller reading a solid background as a Color directly, or constructing
  one, must wrap/unwrap it as { kind: 'solid', color }.

### Features

* **doc-codec:** add fitsAloneOnPapxPage to predict a lone paragraph's PapxFkp fit ([cf17003](https://github.com/ExaDev/documents.js/commit/cf17003686023d16f675e964b4541cc0397a0c1a))
* **doc-codec:** read and write real pattern fills instead of dropping them ([c668c33](https://github.com/ExaDev/documents.js/commit/c668c33e5ceab7c18b12f9f479bf71f35b7c2431))

### Bug Fixes

* **doc-codec:** apply the rounding-aware write ceiling to dptLineWidthFor, not just its floor ([033ab54](https://github.com/ExaDev/documents.js/commit/033ab54fe9b5ee8d6ba0249bdbb4370b95e5543b))
* **doc-codec:** apply the rounding-aware write floor to every border style, not double alone ([ea5f7d0](https://github.com/ExaDev/documents.js/commit/ea5f7d0d2b370547be83c5548e66c2156670949b))
* **doc-codec:** assign each lost table boundary to one row instead of splitting every row ([b2daa42](https://github.com/ExaDev/documents.js/commit/b2daa4200c650273d0cc8fc75d54ee1f01a23b19)), references [#992](https://github.com/ExaDev/documents.js/issues/992)
* **doc-codec:** capture sprmTTableBorders(80) and read sprmTSetShdTable ([8f3573f](https://github.com/ExaDev/documents.js/commit/8f3573fd10d1c457014629e3eaeb2c00a6b56bf8))
* **doc-codec:** cascade row/table-level borders onto cells with none ([5b5f62a](https://github.com/ExaDev/documents.js/commit/5b5f62a13605cd4a560fef1ac6be33bcdf7be289))
* **doc-codec:** cite TCGRF's own horzMerge value for a lost-boundary continuation cell ([322edca](https://github.com/ExaDev/documents.js/commit/322edca22ac6037cb3f93c1a115add196131fb78))
* **doc-codec:** correct the lost-boundary trim comment's monotonicity claim ([11f386e](https://github.com/ExaDev/documents.js/commit/11f386e3c50aa7110177327e2276f8b416772b71))
* **doc-codec:** fall back per row when a lost-boundary split overflows its PapxInFkp budget ([e3169f4](https://github.com/ExaDev/documents.js/commit/e3169f43df1f905ffc368e1aacc9af060d2b8db2)), references [#992](https://github.com/ExaDev/documents.js/issues/992) [#992](https://github.com/ExaDev/documents.js/issues/992) [pre-#992](https://github.com/pre-/issues/992) [#992](https://github.com/ExaDev/documents.js/issues/992)
* **doc-codec:** give a ragged table's exposed non-merged cell the table's real bottom border ([cea5163](https://github.com/ExaDev/documents.js/commit/cea516309c9a230792072ab55e97cb04de02be34))
* **doc-codec:** give a vertically merged anchor the table's real bottom border ([f6d6ed4](https://github.com/ExaDev/documents.js/commit/f6d6ed4cbf543583976d4272363b1d53720071a4))
* **doc-codec:** let a double border's own width dip below the single-line minimum on write ([3ea18ad](https://github.com/ExaDev/documents.js/commit/3ea18ad3a8209615e3d3c04de896fe40b3e15d03))
* **doc-codec:** name the degraded table in the lost-boundary onWarning message ([b29275b](https://github.com/ExaDev/documents.js/commit/b29275baf31dbe5d6b4c02b3176b8ebd9750110b))
* **doc-codec:** parse TableBordersOperand and TableBordersOperand80 ([0cd6dc9](https://github.com/ExaDev/documents.js/commit/0cd6dc95adec8f80db997bd7a98c233ca2d4ade4))
* **doc-codec:** preserve an explicit sprmTSetBrc border clear through the row cascade ([ea8661f](https://github.com/ExaDev/documents.js/commit/ea8661f0522405880c5b8ec5c089944c906be3a1))
* **doc-codec:** read a vertically merged anchor's bottom border from the table's real last row ([5af9b94](https://github.com/ExaDev/documents.js/commit/5af9b945caec53d20a40cb1763e3010776737894))
* **doc-codec:** read sprmTSetBrc80 into the row's per-cell border-clear path ([79beefa](https://github.com/ExaDev/documents.js/commit/79beefaaf8303938acdb095db015c8bdb81c6225))
* **doc-codec:** recover colSpan and columnWidthsPt across a table-wide merged boundary ([a9639f0](https://github.com/ExaDev/documents.js/commit/a9639f0516f11c5442f70d06cae4005536c8e44a))
* **doc-codec:** resolve a vertMerge chain's own last row before checking ragged-table coverage ([df82100](https://github.com/ExaDev/documents.js/commit/df82100530d13ecd6757415f0b8ae3f8686ddd4f))
* **doc-codec:** state the true rounding-aware write floor for a double border's own width ([434d440](https://github.com/ExaDev/documents.js/commit/434d440dccaf281f53b64393b12c5a94b3dd2a18))
* **doc-codec:** stop the per-row trim warning overclaiming a same-row, immediate throw ([99eb630](https://github.com/ExaDev/documents.js/commit/99eb6304c1ba370d21af63912b1bd8a1e80c3cb1))
* **doc-codec:** stop the unsplit-fallback warning claiming success it can't guarantee ([96a5a2b](https://github.com/ExaDev/documents.js/commit/96a5a2b71c7572084476c3579374e905a1b83f04))
* **doc-codec:** switch exhaustively on cell-fill kind instead of if/else ([dee6786](https://github.com/ExaDev/documents.js/commit/dee6786f4539646e7c596f2623dcf05351c1bf7c))
* **doc-codec:** trim a row's lost-boundary split to what fits both format ceilings ([4e5859e](https://github.com/ExaDev/documents.js/commit/4e5859ec3ddd3f8aa8628eb257741eae3e6a7db8))
* **doc-codec:** triple dptLineWidth into widthPt for double-line cell borders ([3a4bcf2](https://github.com/ExaDev/documents.js/commit/3a4bcf21a1b733de90eb38e8cae307c0305bd31e))

### Code Refactoring

* **doc-codec:** export the table row cell-count ceiling from tap-write.ts ([c71bdea](https://github.com/ExaDev/documents.js/commit/c71bdead986ebfb6dc040c698e17f6dce1a0d5ae))
* **doc-codec:** make TapWriteRow's horzMerge required, dropping its unreachable default ([97005ee](https://github.com/ExaDev/documents.js/commit/97005eee3bf306e6c52f801433ed23b6f76f8627))
* **document-schema.js:** host unrecognizedFillKind for every cell-fill writer ([855121a](https://github.com/ExaDev/documents.js/commit/855121a58523e0ad8f332e28be8def3454918bc7))

### Documentation

* **doc-codec:** attribute the "unless modified" clause to sprmTTableBorders alone ([7abd206](https://github.com/ExaDev/documents.js/commit/7abd206077a6de3bc218915848f61338ec3fbc1d))
* **doc-codec:** attribute the grpprlTapx restriction to sprmTCellNoWrapStyle alone ([d203260](https://github.com/ExaDev/documents.js/commit/d203260d928f1b9051950637eacd1cc284944e04))
* **doc-codec:** cite all three ECMA-376 sections MS-DOC's own border-precedence text names ([10f1c11](https://github.com/ExaDev/documents.js/commit/10f1c11c130656aed9d25752940ce9458ec59a43))
* **doc-codec:** cite the correct [MS-DOC] section for NumberOfColumns's 63-cell ceiling ([1cd0f0b](https://github.com/ExaDev/documents.js/commit/1cd0f0bdf432c48f25a70dd0fe7d6ab5bbec16ca))
* **doc-codec:** cite the MS-DOC text that justifies brcBottom reaching a vertMerge anchor ([11abeb6](https://github.com/ExaDev/documents.js/commit/11abeb6e52f15cc4026be4f6254908cf3857ff2c))
* **doc-codec:** correct TableBrc80Operand's name and the TC80-alone overclaim ([00d3498](https://github.com/ExaDev/documents.js/commit/00d34981f75e80a54d1bd83e2934bd2943e8e0cb))
* **doc-codec:** correct the double-border-width note's claim about the other 23 collapsed BrcTypes ([866f3c4](https://github.com/ExaDev/documents.js/commit/866f3c4e5a612b06fd0dceca5d9a7a7394e3efc9))
* **doc-codec:** correct the lost-boundary trim's monotonicity claim ([eb0b82c](https://github.com/ExaDev/documents.js/commit/eb0b82cc2609cc17ce703ee5119761c39bc9ada5))
* **doc-codec:** correct the lost-boundary trim's unreachable non-monotonicity claim ([2cfb75e](https://github.com/ExaDev/documents.js/commit/2cfb75e6606d288d3a7c83d63625afe5242fa932))
* **doc-codec:** correct the OUTSET/INSET border-width formula and the double-floor unit claim ([1f794fb](https://github.com/ExaDev/documents.js/commit/1f794fb80bcad838ba03352cbe63ac8d647d5799))
* **doc-codec:** correct the per-row 15-fixed-byte ceiling's own breakdown ([7dfc7a6](https://github.com/ExaDev/documents.js/commit/7dfc7a6c47d159087f49968083eefe4cfa5d5191))
* **doc-codec:** correct the per-row column ceiling to 21 and document the budget fallback ([2e9a971](https://github.com/ExaDev/documents.js/commit/2e9a971f04e89927b7299926e15a18ec0a622fac))
* **doc-codec:** describe the clearedSides fix the row-border cascade paragraph never got ([a65550c](https://github.com/ExaDev/documents.js/commit/a65550c32e6c52605fdaf218febee2014a5647bf))
* **doc-codec:** describe the row-border cascade's real bottom-edge rule ([ab973c0](https://github.com/ExaDev/documents.js/commit/ab973c041759e1b1e1565a69c74364a31b5ec3e2))
* **doc-codec:** describe the trimmed, dual-ceiling lost-boundary fallback ([87d837d](https://github.com/ExaDev/documents.js/commit/87d837db67c46f23befe912a3d3899d77c218bbc))
* **doc-codec:** document the lost-boundary merge fallback and its LibreOffice trade-off ([3a1090b](https://github.com/ExaDev/documents.js/commit/3a1090bc5bb48f06a4fed5e250faabf53f533236))
* **doc-codec:** document the row/table border cascade ([a721713](https://github.com/ExaDev/documents.js/commit/a721713218b7733fb12aed3212150f579e928bdc))
* **doc-codec:** drop the false sprmTCellShdStyle/sprmTSetShdTable adjacency claim ([967b36e](https://github.com/ExaDev/documents.js/commit/967b36ef4aa66ff8eed706e0d4f343e50b422532))
* **doc-codec:** drop the false sprmTCellVertAlignStyle adjacency claim ([3426b64](https://github.com/ExaDev/documents.js/commit/3426b6458162dc2fad67d19a8091962846ad8f98))
* **doc-codec:** fix a self-quoting reference that pointed 'above' at content actually below it ([2b3714e](https://github.com/ExaDev/documents.js/commit/2b3714ec4952a2a6f140e085633e543889416166))
* **doc-codec:** fix cellReachesTableBottom's self-contradictory ragged-cell claim ([10b5c95](https://github.com/ExaDev/documents.js/commit/10b5c957dfd25bf5a83717ec98d8dd354fa4c57f))
* **doc-codec:** fix ipatPctNew* count in IPAT_TO_PATTERN_TYPE's doc comment ([3fe0e8f](https://github.com/ExaDev/documents.js/commit/3fe0e8f99cdff5848f4ae87d3c0110a98f3782ba))
* **doc-codec:** fix ipatPctNew* mapped-range upper bound in README ([f3f86b3](https://github.com/ExaDev/documents.js/commit/f3f86b326aa9b04ce9111165094423f72d597799))
* **doc-codec:** fix the vertically-merged-cells quote's misattribution to Figure 2's own caption ([f084a47](https://github.com/ExaDev/documents.js/commit/f084a47d7929cf4c7fb16ee0bfaf254a4aec3844))
* **doc-codec:** link the style-inherited-formatting gap to its own issue ([e9939ab](https://github.com/ExaDev/documents.js/commit/e9939aba9ec2ab171ddf37cc1f4a1dc9772bdf45)), references [ExaDev/documents.js#1005](https://github.com/ExaDev/documents.js/issues/1005)
* **doc-codec:** name the writer's own trim fallback as a source of unrecoverable column boundaries ([74054e3](https://github.com/ExaDev/documents.js/commit/74054e3eb944a58399b902d5f221e5360fa8bc96)), references [#1013](https://github.com/ExaDev/documents.js/issues/1013)
* **doc-codec:** narrow brcBottom's clause to the two paths cellReachesTableBottom actually checks ([2bdfd39](https://github.com/ExaDev/documents.js/commit/2bdfd39517b1c3fce0681eb9cce6870f7d0abaf9))
* **doc-codec:** narrow the TC80-alone border-clear claim to cover sprmTSetBrc80 too ([c70f626](https://github.com/ExaDev/documents.js/commit/c70f6269b72dafc79e5b7463380a6069772850aa))
* **doc-codec:** point the lost-boundary comments at the README's real per-row arithmetic ([fcf6997](https://github.com/ExaDev/documents.js/commit/fcf6997eabf69da917b36d8650f69844850c1d9f))
* **doc-codec:** point two remaining self-references at their real targets ([97eef83](https://github.com/ExaDev/documents.js/commit/97eef833e4d9d44f350900a4e9bc396eae1cd3de))
* **doc-codec:** restore the ragged-table bottom-border path's real non-continuation scope ([1808e94](https://github.com/ExaDev/documents.js/commit/1808e94284c1733254c02522431942cc15e8b16b))
* **doc-codec:** restore the sprmTMerge lost-boundary-fallback nuance lost in a rebase ([b8e44dd](https://github.com/ExaDev/documents.js/commit/b8e44dd1868b5ba47f093dcb1e0d5d15d847b8f2)), references [992/#1013](https://github.com/ExaDev/documents.js/issues/1013)
* **doc-codec:** state sprmTSetShdTable's actual shading scope as per-row ([9feedba](https://github.com/ExaDev/documents.js/commit/9feedba0e446949e5c9f48cab02671dd9042736c))
* **doc-codec:** state the ragged-table check's own start-grid-index scope ([3e60833](https://github.com/ExaDev/documents.js/commit/3e60833eafffed5ea6d807c9850854ad41227f50))
* **doc-codec:** state the row-border cascade's real bcBottom rule everywhere it was described ([f926539](https://github.com/ExaDev/documents.js/commit/f926539b130b64949e5bb30186a88b89ed242b93))
* **doc-codec:** state the true rounding-aware write ceiling, not the naive top value ([c86925e](https://github.com/ExaDev/documents.js/commit/c86925e323431b94cd6086283a831a70ed3c365d))
* **doc-codec:** stop promising onWarning never precedes a hard failure ([f42ee75](https://github.com/ExaDev/documents.js/commit/f42ee754b02cdc5a59421494f88a993c61caa043))
* **doc-codec:** trim trailing whitespace from the style-inherited-formatting table row ([5317c1f](https://github.com/ExaDev/documents.js/commit/5317c1fd192b30dec819b3c8b10cf3d8b839aa4e))
* **doc-codec:** update TableBordersSet's stale brcBottom description ([f7453a8](https://github.com/ExaDev/documents.js/commit/f7453a8de93f4e244716618dcab843dbadf9f607))
* **doc-codec:** update the double-line border width note to match the fix ([996d35b](https://github.com/ExaDev/documents.js/commit/996d35b3c65bb61e45aaa2783b37e63215ec1610))

### Tests

* **doc-codec:** correct the 64-cell test's NumberOfColumns citation ([e855d65](https://github.com/ExaDev/documents.js/commit/e855d65eacbe95696c6bd93d9e14acc013779290))
* **doc-codec:** cover readShd80's packed ipat field against the new pattern entries ([8151ddd](https://github.com/ExaDev/documents.js/commit/8151ddd01985fe52907ffbb905ff57efa92915c0))
* **doc-codec:** cover the 63-cell ceiling and partial-boundary-trim fallback paths ([f3ce882](https://github.com/ExaDev/documents.js/commit/f3ce882151e120f48c5912ee2e1e339e8361f8e4))
* **doc-codec:** cover the per-row lost-boundary budget fallback and its degradation reporting ([3c18558](https://github.com/ExaDev/documents.js/commit/3c18558d5212ead62f815624cae21af30dfb70aa))
* **doc-codec:** exercise cross-row grid resolution in the vertMerge bottom-border cascade ([ffd0948](https://github.com/ExaDev/documents.js/commit/ffd09480d03a27520130ad56c8b254bac1676792))
* **doc-codec:** expect ContentCellFill's discriminated shape in the ([b993776](https://github.com/ExaDev/documents.js/commit/b993776c0444f938e9a77e8adaedea68ec2d2322)), references [#951](https://github.com/ExaDev/documents.js/issues/951) [#945](https://github.com/ExaDev/documents.js/issues/945)
* **doc-codec:** fix two cell objects the rebase's textual merge left type-broken ([356794c](https://github.com/ExaDev/documents.js/commit/356794c885e67e86079d773de38c747265c0dc2f))
* **doc-codec:** pin that a 0.5pt double border reads back as 0.75pt, not 0.5pt ([34b1c93](https://github.com/ExaDev/documents.js/commit/34b1c939fadde841827dd7ddd271d2866c553f21))
* **doc-codec:** pin the corrected 0.1875pt write floor for both border-width branches ([083494d](https://github.com/ExaDev/documents.js/commit/083494d84b915242bfcab994b1c5a75005bd8aa1))

### Build System

* typecheck test/workers across every package where it is currently clean ([f340428](https://github.com/ExaDev/documents.js/commit/f340428b51a669010c0c4e5edb4310fe6ea4789a)), closes [#1021](https://github.com/ExaDev/documents.js/issues/1021)


### Dependencies

- Updated document-schema.js to ^6.0.0
- Updated archive-codec to ^1.4.3

## [1.1.2](https://github.com/ExaDev/documents.js/compare/doc-codec%401.1.1...doc-codec%401.1.2) (2026-09-05)

### Continuous Integration

* add the missing _test:coverage script to nine packages ([bc658d0](https://github.com/ExaDev/documents.js/commit/bc658d094b6ffbd0616cc225c57d5c0595374172))


### Dependencies

- Updated archive-codec to ^1.4.2

## [1.1.1](https://github.com/ExaDev/documents.js/compare/doc-codec%401.1.0...doc-codec%401.1.1) (2026-09-05)


### Dependencies

- Updated document-schema.js to ^5.6.0
- Updated archive-codec to ^1.4.1

## [1.1.0](https://github.com/ExaDev/documents.js/compare/doc-codec%401.0.2...doc-codec%401.1.0) (2026-09-04)

### Features

* **doc-codec:** add a genuine MS-DOC structure writer ([40d52d2](https://github.com/ExaDev/documents.js/commit/40d52d205ead14dd4222d1bf210f120714ad8864))
* **doc-codec:** encode a table row's own TAP as sprmTDefTable/sprmTMerge ([fd39211](https://github.com/ExaDev/documents.js/commit/fd39211de7c19d5dd5418ba3fdd469d5514379d5))
* **doc-codec:** fold a table row's own sgc-5 grpprl into its TAP ([afc92b0](https://github.com/ExaDev/documents.js/commit/afc92b0d2d353e26f76aeaa4fb072328ff476df0))
* **doc-codec:** parse sprmPItap and the nested-table paragraph marks ([9aaacdb](https://github.com/ExaDev/documents.js/commit/9aaacdb550fbf2889be900457aefdc56eb85b69d))
* **doc-codec:** read a paragraph's own numbering definitions from PlfLst/PlfLfo ([2bc0011](https://github.com/ExaDev/documents.js/commit/2bc00119a68ea699ef16d058321459465e363b69))
* **doc-codec:** read a run of table-depth paragraphs as a real ContentTable ([f0ed5a4](https://github.com/ExaDev/documents.js/commit/f0ed5a42123f2b21b5f69a30f79e0a9b1c768f17))
* **doc-codec:** read a vertical merge stated through sprmTVertMerge ([6430420](https://github.com/ExaDev/documents.js/commit/643042078b58bd8c7ada308e157648c404c16186))
* **doc-codec:** read and write a section's own page size and margins ([c70d9d1](https://github.com/ExaDev/documents.js/commit/c70d9d135a92467e75cc4a61cef49b8297f42d71))
* **doc-codec:** read and write a table cell's borders and background shading ([bc9db2c](https://github.com/ExaDev/documents.js/commit/bc9db2c287a64bf0ffe94d5775a8d56aabd3f5be)), references [#892](https://github.com/ExaDev/documents.js/issues/892) [#895](https://github.com/ExaDev/documents.js/issues/895)
* **doc-codec:** read and write document metadata via SummaryInformation ([824ff8e](https://github.com/ExaDev/documents.js/commit/824ff8e1feca0a8a964f2d187e8537bdf078c539))
* **doc-codec:** write a ContentTable as real physical-cell paragraphs ([e2b1dc4](https://github.com/ExaDev/documents.js/commit/e2b1dc434a270d0e98022e293086da19f9147b38))

### Bug Fixes

* **doc-codec:** append a trailing paragraph mark when a table ends the section ([d456ed2](https://github.com/ExaDev/documents.js/commit/d456ed282c51e69f2009d2d695b9c1386e3a872f)), references [#892](https://github.com/ExaDev/documents.js/issues/892)
* **doc-codec:** clamp the column-boundary tolerance below a real narrow column ([cd02428](https://github.com/ExaDev/documents.js/commit/cd02428c1ead856ef42103c09abf28504064ce2e))
* **doc-codec:** correct an overclaim about byte-level LibreOffice parity ([6893a96](https://github.com/ExaDev/documents.js/commit/6893a962d9d91f418c5fc58c8c0b3792b753bbbe))
* **doc-codec:** degrade an unresolvable table row to flat paragraphs ([c76ef1c](https://github.com/ExaDev/documents.js/commit/c76ef1ca96fdbbd64d43b2dbe48d64add041236b))
* **doc-codec:** fold sprmTMerge/sprmTVertMerge regardless of grpprl order ([abb690d](https://github.com/ExaDev/documents.js/commit/abb690d654fee1040777bc5153f0b58e656908b2))
* **doc-codec:** preserve a vertical continuation's own colSpan on read ([ea26639](https://github.com/ExaDev/documents.js/commit/ea26639239dbc3a7924ac0cc450e0db60354f404))
* **doc-codec:** reject a malformed createdIso/modifiedIso before the FILETIME conversion ([e64d748](https://github.com/ExaDev/documents.js/commit/e64d748a20522611f8919a6681d8c50179a2f224))
* **doc-codec:** resolve an out-of-range decorative Ico byte to automatic, not a thrown error ([9f24edc](https://github.com/ExaDev/documents.js/commit/9f24edc874651435f439e9fd896593d3c664814b))
* **doc-codec:** snap table column boundaries within a point when unioning rows into one grid ([f300c11](https://github.com/ExaDev/documents.js/commit/f300c11e63d23536e6203f50f4ac26f3f861df03))
* **doc-codec:** track vertical merges by column, not blank cells, on write ([7c69277](https://github.com/ExaDev/documents.js/commit/7c69277c3044c197304cd9e8778c1f58ed2cc62c))
* **doc-codec:** write and read a horizontal merge through a row's own physical cell layout ([d9a7137](https://github.com/ExaDev/documents.js/commit/d9a713740b62fb6fa64af7d61562331f2fa1b56e))

### Code Refactoring

* **doc-codec:** consume archive-codec's shared LayoutMetadata mapping ([e5d3c06](https://github.com/ExaDev/documents.js/commit/e5d3c06b4663ce63ef19d0e15b72c659b05bf866))
* **doc-codec:** lift the Ico palette and COLORREF codec into a shared module ([f4dd141](https://github.com/ExaDev/documents.js/commit/f4dd14178f4c1049a3784be9b27c86b1832df745))
* **ppt-codec:** consume archive-codec's shared LayoutMetadata mapping ([7d0c81d](https://github.com/ExaDev/documents.js/commit/7d0c81d4842979eddf3a5ab0dc6e3201c390565a))

### Documentation

* **doc-codec:** confirm the horizontal-merge fix against real LibreOffice ([760d884](https://github.com/ExaDev/documents.js/commit/760d884e32b93d3b5e9cf0ab8addfbfc3e0660e5))
* **doc-codec:** correct a comment overclaiming round-trip-alone verification ([15f58bd](https://github.com/ExaDev/documents.js/commit/15f58bdb0e3097babe84a95063a9415c55a37f21)), references [#892](https://github.com/ExaDev/documents.js/issues/892)
* **doc-codec:** correct nine wrong [MS-DOC] section numbers in the decoration citations ([4ffb571](https://github.com/ExaDev/documents.js/commit/4ffb5713379bb7dcb6d1e2d4a4d6b7dec55d292a))
* **doc-codec:** correct the drift-tolerance changeover's own attribution ([3aa01b2](https://github.com/ExaDev/documents.js/commit/3aa01b24d8590310f05c3da2ae8518079c2a65b0))
* **doc-codec:** correct the false claim that LibreOffice recognises a written table ([54600ed](https://github.com/ExaDev/documents.js/commit/54600ed3b315c203ce20a5986865ff6a6e1ea59e)), references [#892](https://github.com/ExaDev/documents.js/issues/892)
* **doc-codec:** describe cell decoration and what verified it ([ac5d15c](https://github.com/ExaDev/documents.js/commit/ac5d15c1dc407c3730ba7edaff2c7c75f1ec24b0))
* **doc-codec:** document a section's page size and margins as read and written ([3ab55ac](https://github.com/ExaDev/documents.js/commit/3ab55acfc2292ae563dfc74c36a859f586dbc5c3))
* **doc-codec:** document doc-codec's new write support ([8775a1c](https://github.com/ExaDev/documents.js/commit/8775a1ca28efee6431ac5150874ed539ae63ea27))
* **doc-codec:** document numbering definitions as built and shipped ([3cbf214](https://github.com/ExaDev/documents.js/commit/3cbf214657083413dbf6b126e8b99cc6f59fbd6d))
* **doc-codec:** document table read/write scope and the merge caveat ([426a026](https://github.com/ExaDev/documents.js/commit/426a026489f6c43cdc1f1f808cbf142f0df8c819))
* **doc-codec:** document the confirmed root cause of the table-recognition regression ([b2aae6c](https://github.com/ExaDev/documents.js/commit/b2aae6c0f367afc10965994b4629c8e153e7a30f)), references [#892](https://github.com/ExaDev/documents.js/issues/892) [#892](https://github.com/ExaDev/documents.js/issues/892)
* **doc-codec:** document the merge-tracking and degrade fixes ([27bae01](https://github.com/ExaDev/documents.js/commit/27bae01897bd07e61e74b725dacf865dc26fa12f))
* **doc-codec:** fix a test description left stale by table support ([6c5849a](https://github.com/ExaDev/documents.js/commit/6c5849a3d855658955aef4ef2d376a826d0c354d))
* **doc-codec:** state the column-grid tolerance and the missing table indent in the Tables section ([ae42750](https://github.com/ExaDev/documents.js/commit/ae42750c203da78a2a1a44f2a380a02053908ce4))

### Styles

* **doc-codec:** fix table column padding in the README's scope table ([e97219f](https://github.com/ExaDev/documents.js/commit/e97219f8b07472b044aac45246f9a67f0c490498))

### Tests

* **doc-codec:** cover numbering definitions with hand-built PlfLst/PlfLfo fixtures ([d49d83c](https://github.com/ExaDev/documents.js/commit/d49d83c0669e1efd4e496222a07070dbfdee601c))
* **doc-codec:** cover section page size and margins, both YAS margin forms ([596899c](https://github.com/ExaDev/documents.js/commit/596899cc95603f2ddca75328ba7e1be02dc4a5bd))
* **doc-codec:** exercise the column-grid union directly, not via round trips ([4cff689](https://github.com/ExaDev/documents.js/commit/4cff689d593228fd1b74a2c4ffb79d96d781e8cc))
* **doc-codec:** hand-assemble table bytes independently of the writer ([5a09acf](https://github.com/ExaDev/documents.js/commit/5a09acfdfb73ca4e8b2431e62d7fed7f754797f3))
* **doc-codec:** pin the narrow-column clamp against the drift tolerance ([5b4e903](https://github.com/ExaDev/documents.js/commit/5b4e903624fb4fddf7a85c7d1d9857d99f6485ca))
* **doc-codec:** verify writeDocContent by reading its own output back ([31ef85a](https://github.com/ExaDev/documents.js/commit/31ef85a894957acbddbeeccb9dafa4230c853df0))


### Dependencies

- Updated document-schema.js to ^5.5.1
- Updated archive-codec to ^1.4.0

## [1.0.2](https://github.com/ExaDev/documents.js/compare/doc-codec%401.0.1...doc-codec%401.0.2) (2026-09-03)


### Dependencies

- Updated document-schema.js to ^5.5.0

## [1.0.1](https://github.com/ExaDev/documents.js/compare/doc-codec%401.0.0...doc-codec%401.0.1) (2026-09-03)


### Dependencies

- Updated archive-codec to ^1.3.0

## 1.0.0 (2026-09-03)

### Features

* **doc-codec:** add bounds-checked readers and the PLC container shape ([b75682f](https://github.com/ExaDev/documents.js/commit/b75682fb21771516d8c5580313b36042b573fd00))
* **doc-codec:** convert a .doc to a ContentDocument ([8cd7e3a](https://github.com/ExaDev/documents.js/commit/8cd7e3a118421cd96c67ebc5471d01bd5d5ee4cc))
* **doc-codec:** parse the File Information Block ([c4e5430](https://github.com/ExaDev/documents.js/commit/c4e5430df77626373a12972625b03579474536d1))
* **doc-codec:** read style identity from the style sheet ([7bff98e](https://github.com/ExaDev/documents.js/commit/7bff98e2514f27df8f7bf595e42ea6496fef9c0c))
* **doc-codec:** reconstruct logical text through the piece table ([45fc59f](https://github.com/ExaDev/documents.js/commit/45fc59fb4ba1a38352cbfcc0a76a94510bc35a6b))
* **doc-codec:** resolve character and paragraph formatting exceptions ([38b044f](https://github.com/ExaDev/documents.js/commit/38b044fbc93bdca019e9e720376abf87bc62ba99))

### Bug Fixes

* **doc-codec:** keep an outer field's result text after a nested field ends ([5a0e8a3](https://github.com/ExaDev/documents.js/commit/5a0e8a383ffe2e59f0fa955d696012ad597513b0))

### Performance Improvements

* **doc-codec:** cache folded character properties across the whole read ([04fdf5f](https://github.com/ExaDev/documents.js/commit/04fdf5f25c3c4ebd249ad21c61e0ff416be54f95))

### Documentation

* **doc-codec:** state what the reader covers and what it does not ([a7a092f](https://github.com/ExaDev/documents.js/commit/a7a092f297ff41b115f87dd3e50d2b8ae76e9c03))

### Tests

* **doc-codec:** exercise a Chpx run spanning several paragraphs ([256a8cb](https://github.com/ExaDev/documents.js/commit/256a8cb921e16f72755286dae7beb6109687c1b3))

### Miscellaneous Chores

* **doc-codec:** ignore the package's own build output ([afafd01](https://github.com/ExaDev/documents.js/commit/afafd0162e7a1b21baec726f2d1d3a0bd2067289))
* **doc-codec:** scaffold the .doc reader package ([2dca70e](https://github.com/ExaDev/documents.js/commit/2dca70e2154f3c7219299b9d0e7549a655711449))
