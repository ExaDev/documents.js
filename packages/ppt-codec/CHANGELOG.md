## [2.0.0](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.7.13...ppt-codec%402.0.0) (2026-09-20)

### ⚠ BREAKING CHANGES

* **ppt-codec:** The ppt-codec/base64 deep import is removed.
  bytesToBase64 and base64ToBytes come from byte-codec now, and are
  still on this package's own barrel as well. The removal already
  shipped, unmarked, in 1.7.12.

### Documentation

* **ppt-codec:** state that base64 moved out of src/base64.ts ([5be6861](https://github.com/ExaDev/documents.js/commit/5be68610b4c976fedbbf2f799ef33b450d51e4bd))


### Dependencies

- Updated byte-codec to 1.6.2

## [1.7.13](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.7.12...ppt-codec%401.7.13) (2026-09-20)


### Dependencies

- Updated byte-codec to 1.6.1
- Updated archive-codec to 1.11.6

## [1.7.12](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.7.11...ppt-codec%401.7.12) (2026-09-20)

### Code Refactoring

* **ppt-codec:** encode and decode base64 through byte-codec ([a53828b](https://github.com/ExaDev/documents.js/commit/a53828bed889a819136a160808053cbda64bce80))

## [1.7.11](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.7.10...ppt-codec%401.7.11) (2026-09-20)


### Dependencies

- Updated document-schema.js to 7.11.4
- Updated archive-codec to 1.11.5

## [1.7.10](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.7.9...ppt-codec%401.7.10) (2026-09-20)


### Dependencies

- Updated byte-codec to 1.6.0

## [1.7.9](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.7.8...ppt-codec%401.7.9) (2026-09-20)


### Dependencies

- Updated byte-codec to 1.5.8

## [1.7.8](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.7.7...ppt-codec%401.7.8) (2026-09-20)


### Dependencies

- Updated byte-codec to 1.5.7

## [1.7.7](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.7.6...ppt-codec%401.7.7) (2026-09-20)


### Dependencies

- Updated byte-codec to 1.5.6

## [1.7.6](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.7.5...ppt-codec%401.7.6) (2026-09-14)

### Documentation

* reword stryker.config.ts comments to avoid the banned phrase ([1553892](https://github.com/ExaDev/documents.js/commit/1553892fb68ddce9bcb7eee7ebebc31e1f9cdc79))

### Miscellaneous Chores

* bump pinned pnpm to 12.4.1 across the workspace ([4e81c2d](https://github.com/ExaDev/documents.js/commit/4e81c2dfdb08fff226c20a0f267baffa87758e0f))
* **lint:** except each package's own measured eslint-config 2.12.1 debt ([11c35bc](https://github.com/ExaDev/documents.js/commit/11c35bc61db74c68b4be725c34452509fba00c2a))


### Dependencies

- Updated byte-codec to 1.5.5
- Updated document-schema.js to 7.11.3
- Updated archive-codec to 1.11.4

## [1.7.5](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.7.4...ppt-codec%401.7.5) (2026-09-13)

### Bug Fixes

* **ppt-codec:** move writeFbse's cbName byte to its own real position ([6702568](https://github.com/ExaDev/documents.js/commit/6702568e54dc759fe836213e91e1dd40019224ab))
* **ppt-codec:** resolve a font family used only inside a table cell ([bedf4d3](https://github.com/ExaDev/documents.js/commit/bedf4d39557fcb4d5e37fe154606ebe7487f555c))
* **ppt-codec:** supply widthPt/heightPt on the picture-inset test's image block ([558cb46](https://github.com/ExaDev/documents.js/commit/558cb46d0948b4f033a02bc467f8b0e140d67aad))

### Code Refactoring

* **ppt-codec:** build asciiBytes via Uint8Array.from instead of a bounds-checked loop ([ec4c823](https://github.com/ExaDev/documents.js/commit/ec4c823762672d14cac04b241996526ff19bdd49))
* **ppt-codec:** capture buildPersistDirectory's current edit directly, not via edits[0] ([79d4386](https://github.com/ExaDev/documents.js/commit/79d4386a83f8d9d33aa2a53f9d20135269e37449))
* **ppt-codec:** clamp the master-style level take-count on indentLevel, not levels.length ([797bc41](https://github.com/ExaDev/documents.js/commit/797bc4190f9d64fe5f9e688f6657b61abd519973))
* **ppt-codec:** drop blipForPib's redundant non-positive-pib guard ([7295a1d](https://github.com/ExaDev/documents.js/commit/7295a1dfeea4e08348cfb1b9ce1b64cbd0d96640))
* **ppt-codec:** drop bytesToBase64's redundant length-gated fallbacks ([b2cac9d](https://github.com/ExaDev/documents.js/commit/b2cac9dc1c1842804f94814eacb257227213d4a3))
* **ppt-codec:** drop orderedMasterLevels' redundant empty check ([b509f7a](https://github.com/ExaDev/documents.js/commit/b509f7aae5fc0e33ee031e7ffbc9bcefa0a90ae4))
* **ppt-codec:** drop table row sort and heightPt fallback that no consumer can observe ([b88f6f7](https://github.com/ExaDev/documents.js/commit/b88f6f7ef5b4056e1b3998316ff5836e13a7cd95))
* **ppt-codec:** drop the redundant explicit recInstance in writeSlideListWithText ([f3a9369](https://github.com/ExaDev/documents.js/commit/f3a9369b34677faaec5682c02def222bbe0c40d7))
* **ppt-codec:** drop the redundant lenUserName guard on the Unicode username read ([7605f49](https://github.com/ExaDev/documents.js/commit/7605f491637492c66a202427669a507bd120fad0))
* **ppt-codec:** drop three cross-checked invariants in shapes-write ([a11ae49](https://github.com/ExaDev/documents.js/commit/a11ae490e2bf7f31380c8498ce4c2343e7ec6a1b))
* **ppt-codec:** export the master's own colour scheme for direct byte comparison ([07deb2c](https://github.com/ExaDev/documents.js/commit/07deb2c70fd2ba2d84b9eb3f452fb68eb798896a))
* **ppt-codec:** let readFontNames accept a possibly-absent Environment record ([b5d9ed9](https://github.com/ExaDev/documents.js/commit/b5d9ed967ce4ed8bf64035b95dcc8f9c180e271e))
* **ppt-codec:** move drop-message location prefixing off the context ([5901a79](https://github.com/ExaDev/documents.js/commit/5901a798cbb10f02f56f36f5aaf3e884c12736ff))
* **ppt-codec:** pair each master placeholder with its own frame ([6880dfc](https://github.com/ExaDev/documents.js/commit/6880dfc6c64bd9abef46368dca841bebab0c76d6))
* **ppt-codec:** pair each paragraph with its own body text in buildTextBody ([b616774](https://github.com/ExaDev/documents.js/commit/b616774048624697495b9d203d53aef0b175de0e))
* **ppt-codec:** read colour-scheme slot bytes via DataView, not indexed access ([49f00df](https://github.com/ExaDev/documents.js/commit/49f00df6b89277cb4bc7bf673c551b81b4d44345))
* **ppt-codec:** remove three no-op zero-fills from compoundFile ([6cbc0e3](https://github.com/ExaDev/documents.js/commit/6cbc0e3aad38809cb760d25028899b916096fb8a))

### Tests

* **ppt-codec:** add a base64 test suite covering every padding remainder ([a5fa126](https://github.com/ExaDev/documents.js/commit/a5fa126e9c76b3f5a72ecce6e77d3e19612b3f87))
* **ppt-codec:** add coverage for readExternalOleEmbeds and the OLE embed writer ([076f346](https://github.com/ExaDev/documents.js/commit/076f346fe4657b7b438237717352fdbd65fcdd4b))
* **ppt-codec:** add direct byte-level coverage for compoundFile ([187c414](https://github.com/ExaDev/documents.js/commit/187c4140491b2be79ea645c694a36185a4d1402b))
* **ppt-codec:** add direct unit tests for the byte-primitive writers ([8c25d03](https://github.com/ExaDev/documents.js/commit/8c25d03b4d47c8609c0310895d5c60349dccae20))
* **ppt-codec:** add master-write.ts test coverage for placeholder geometry ([ff96b91](https://github.com/ExaDev/documents.js/commit/ff96b91f8e9efce79699de34ff19310210081ec9))
* **ppt-codec:** add readDocumentAtom and readFontNames test coverage ([3d0cb92](https://github.com/ExaDev/documents.js/commit/3d0cb92c138771335ed4fa8b9951b6d773ce5d1e))
* **ppt-codec:** add readSlideListWithText, readTextHeaderAtom, and writeEnvironment coverage ([e8aba81](https://github.com/ExaDev/documents.js/commit/e8aba81e4ffb3c6cfb5b6a7dc6ab2ff6f2408e92))
* **ppt-codec:** add writeNotesAtom/writeNotesContainer test coverage ([f2fd4e6](https://github.com/ExaDev/documents.js/commit/f2fd4e6b442a9010fd16e228a6126851005860bc))
* **ppt-codec:** add writeSlideDrawing test coverage for insets, rotation, pib and patriarch framing ([c721edb](https://github.com/ExaDev/documents.js/commit/c721edb5f7cfba9c5faee72ae712c10909c35c3d))
* **ppt-codec:** assert exact remaining-byte counts in readRecordHeader errors ([9277b4b](https://github.com/ExaDev/documents.js/commit/9277b4bd26cc6302906dc8c98edacdfaabc5aac3))
* **ppt-codec:** cover each error class's own name and inherited Error shape ([3f68659](https://github.com/ExaDev/documents.js/commit/3f68659c1a187435db7979bad8e52166f2dd0551))
* **ppt-codec:** cover every readDocumentEncryptionAtom/decryptPptDocumentStream rejection path ([99d1567](https://github.com/ExaDev/documents.js/commit/99d15674e516502dd9fd39551a58ecc30e349a64))
* **ppt-codec:** cover IMsoArray under-supply and fBid's raw bit ([6b900a4](https://github.com/ExaDev/documents.js/commit/6b900a4a9fc89824c50c5e262984367e1ec77e10))
* **ppt-codec:** cover mapAlignment's left/right cases and the lineSpacing-0 boundary ([ef82007](https://github.com/ExaDev/documents.js/commit/ef82007eb3b4c6824f08ef5185550fc99447db69))
* **ppt-codec:** cover readDrawingShapes' rejection paths and rotation boundary ([91d6e1a](https://github.com/ExaDev/documents.js/commit/91d6e1ac36d86b1dfacf4263b699aa86a7780135))
* **ppt-codec:** cover readPptStreams' malformed-input rejection paths ([f81dba2](https://github.com/ExaDev/documents.js/commit/f81dba22e2e5f07e487f6b30f494a7e3598d860b))
* **ppt-codec:** cover readTextPFException/readTextCFException's unprojected skip fields ([f419cfa](https://github.com/ExaDev/documents.js/commit/f419cfa54a7a6584559e2f1fdf11606102c29471))
* **ppt-codec:** cover shapes.ts' own record-type and identity guards ([6976f3c](https://github.com/ExaDev/documents.js/commit/6976f3c15828e40888fa5c6d0e22c4cc9d0f3e82))
* **ppt-codec:** cover writeDocumentAtom's recVer stamp and mirrored notes size ([8ddff43](https://github.com/ExaDev/documents.js/commit/8ddff4357ac9cd376ef37d05e4ae6fbfbccc308b))
* **ppt-codec:** cover writeTableGroup's row-height distribution and span diagnostics ([1ad027d](https://github.com/ExaDev/documents.js/commit/1ad027de37645587d3e6905ff541f87dbb996128))
* **ppt-codec:** exercise cRefIsZero's four bytes through the delay-stream path ([4dac428](https://github.com/ExaDev/documents.js/commit/4dac4289f9c89ed680a8e2e102eefbd4278c59c9))
* **ppt-codec:** extend the synthetic presentation fixture with malformed-input options ([c95ccda](https://github.com/ExaDev/documents.js/commit/c95ccda35cdf67e5cadbfc1d49f533a33bd4518f))
* **ppt-codec:** pin buildParagraphs' cross-paragraph run slicing ([3c37839](https://github.com/ExaDev/documents.js/commit/3c378396b7d6a67b679a8d8ad3f992f3bac997aa))
* **ppt-codec:** pin CF_POSITION's skip and the explicit-level boundary ([9082948](https://github.com/ExaDev/documents.js/commit/908294867a318cb52465ee17aa5bf233edb7febb))
* **ppt-codec:** pin DocumentEncryptionAtom's own length boundaries ([cf23692](https://github.com/ExaDev/documents.js/commit/cf23692793bb6eda55807f2a757f1d59c976f2ce))
* **ppt-codec:** pin every default value and empty-branch fallback the fixture states ([3bbb855](https://github.com/ExaDev/documents.js/commit/3bbb855e231bdef844114e003c53d907ab57c8f4))
* **ppt-codec:** pin persist directory error messages and offsets ([b294e7c](https://github.com/ExaDev/documents.js/commit/b294e7ca2d069265a19e64e1c8f2e20022a587ed))
* **ppt-codec:** pin PptUnsupportedContentError messages for malformed dates ([82c0cb0](https://github.com/ExaDev/documents.js/commit/82c0cb034e81ba7acf399e39895ea675433b9aa9))
* **ppt-codec:** pin readNotesAtom/readNotesContainerAtom error messages ([f96cf00](https://github.com/ExaDev/documents.js/commit/f96cf00d2ee5742bfebf84a9b10fb1ea1f18ad6c))
* **ppt-codec:** pin readNotesListWithText's error messages and sibling-skip ([d15ab2d](https://github.com/ExaDev/documents.js/commit/d15ab2d7fdbd14613129fa4b7b18be4231bafd00))
* **ppt-codec:** pin readRecordAt/readRecordSequence error message text ([767fd96](https://github.com/ExaDev/documents.js/commit/767fd96c6d3be1af0d6ea42c814f20f8d9cca817))
* **ppt-codec:** pin readShapeProperties/readIMsoArray error text and byte order ([7f24e3b](https://github.com/ExaDev/documents.js/commit/7f24e3bc6670622b69c6d3d269299285e6f2e500))
* **ppt-codec:** pin syntheticPresentation's own byte-level fidelity ([2ccf566](https://github.com/ExaDev/documents.js/commit/2ccf56696396ab7251a2bdb70e52a38b0c09e69f))
* **ppt-codec:** pin the absence of rotationDeg, not just its presence ([c9bf6ad](https://github.com/ExaDev/documents.js/commit/c9bf6ad11bd58a9b74425794585fc06c54d190a9))
* **ppt-codec:** pin the exact masterIdRef a mismatched slide rejects on ([ecf0497](https://github.com/ExaDev/documents.js/commit/ecf0497676afa80cdf588689f882de7b0ce4745c))
* **ppt-codec:** prove an empty notes body contributes no separator ([6a798de](https://github.com/ExaDev/documents.js/commit/6a798de211e9842eb75d6ab1b1009718af7ecedb))
* **ppt-codec:** prove OLE embed lookups filter by record identity ([fb99668](https://github.com/ExaDev/documents.js/commit/fb99668c8c9603d48ab6a6506c1a7c656133b45a))
* **ppt-codec:** prove readFontNames skips by record type, not length ([34078e9](https://github.com/ExaDev/documents.js/commit/34078e986ade2704109ff8660f1d0a771da1761e))
* **ppt-codec:** round-trip explicit-false character flags and scheme colour ([7751b54](https://github.com/ExaDev/documents.js/commit/7751b5430999a7d9e747aec8e5b3bf33057602d5))

### Miscellaneous Chores

* **ppt-codec:** raise the mutation break threshold to 100 ([889fb9d](https://github.com/ExaDev/documents.js/commit/889fb9d714674213b0993f2e76c91d29f59cb29b))


### Dependencies

- Updated archive-codec to 1.11.3

## [1.7.4](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.7.3...ppt-codec%401.7.4) (2026-09-13)


### Dependencies

- Updated byte-codec to 1.5.4

## [1.7.3](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.7.2...ppt-codec%401.7.3) (2026-09-13)


### Dependencies

- Updated byte-codec to 1.5.3
- Updated document-schema.js to 7.11.2
- Updated archive-codec to 1.11.2

## [1.7.2](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.7.1...ppt-codec%401.7.2) (2026-09-12)


### Dependencies

- Updated byte-codec to 1.5.2

## [1.7.1](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.7.0...ppt-codec%401.7.1) (2026-09-11)

### Code Refactoring

* load stryker.config.ts directly instead of a jiti .mjs bootstrap ([4221520](https://github.com/ExaDev/documents.js/commit/42215205caa1c8fc6368ed38729d15836bdd613b))


### Dependencies

- Updated byte-codec to 1.5.1
- Updated document-schema.js to 7.11.1
- Updated archive-codec to 1.11.1

## [1.7.0](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.6.0...ppt-codec%401.7.0) (2026-09-11)

### Features

* **ppt-codec:** let a caller opt into throwing on an unwritable block ([505e1a9](https://github.com/ExaDev/documents.js/commit/505e1a98618943f115b49445f601322e1ae7d6f3))
* **ppt-codec:** read and write per-shape text insets and OLE-embedded objects ([e73cdcc](https://github.com/ExaDev/documents.js/commit/e73cdccd6a205b912b32361aedef64f4f7539fae))

### Documentation

* **ppt-codec:** describe per-shape insets and OLE-embedding support ([83e8835](https://github.com/ExaDev/documents.js/commit/83e8835fbe8cba426e4534598f0b1aadadd001e2))
* **ppt-codec:** describe the onUnwritableBlock throw-vs-drop option ([d8aaaaf](https://github.com/ExaDev/documents.js/commit/d8aaaaf432f4118a3c8ea948ae5b00f927ccd731))

## [1.6.0](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.5.0...ppt-codec%401.6.0) (2026-09-11)

### Features

* **ppt-codec:** read and write table shapes through the drawing group's own cell grid ([b7db809](https://github.com/ExaDev/documents.js/commit/b7db8098c2579924d047451fec433dec590cb102))
* **ppt-codec:** read picture shapes and rotation through the drawing property tables ([2dac65e](https://github.com/ExaDev/documents.js/commit/2dac65e3a44cecaabefe60e9231a8daa98f9b875))
* **ppt-codec:** write pictures and rotation back through the drawing property tables ([5e65818](https://github.com/ExaDev/documents.js/commit/5e658187b1bd34d2af35b7db23ba95dc63014871))

### Bug Fixes

* **ppt-codec:** match the slide scheme colour atom by its own recInstance ([ed8d8ef](https://github.com/ExaDev/documents.js/commit/ed8d8ef46709773b0bfaf96a03e6922d3a2373cb))

### Documentation

* **ppt-codec:** describe the picture, table, and rotation read/write paths ([61013dd](https://github.com/ExaDev/documents.js/commit/61013dd7cdfdbd542e6bc6561a7096a4fd00e61d))

## [1.5.0](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.4.11...ppt-codec%401.5.0) (2026-09-11)

### Features

* **ci:** gate each measured package on its first CI mutation baseline ([9f8fa69](https://github.com/ExaDev/documents.js/commit/9f8fa6947795b2089bed03c936691893643ce2ae))


### Dependencies

- Updated document-schema.js to 7.11.0
- Updated archive-codec to 1.11.0

## [1.4.11](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.4.10...ppt-codec%401.4.11) (2026-09-11)


### Dependencies

- Updated document-schema.js to 7.10.0
- Updated archive-codec to 1.10.8

## [1.4.10](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.4.9...ppt-codec%401.4.10) (2026-09-11)


### Dependencies

- Updated document-schema.js to 7.9.1
- Updated archive-codec to 1.10.7

## [1.4.9](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.4.8...ppt-codec%401.4.9) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.9.0
- Updated archive-codec to 1.10.6

## [1.4.8](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.4.7...ppt-codec%401.4.8) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.8.0
- Updated archive-codec to 1.10.5

## [1.4.7](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.4.6...ppt-codec%401.4.7) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.7.0
- Updated archive-codec to 1.10.4

## [1.4.6](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.4.5...ppt-codec%401.4.6) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.6.1
- Updated archive-codec to 1.10.3

## [1.4.5](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.4.4...ppt-codec%401.4.5) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.6.0
- Updated archive-codec to 1.10.2

## [1.4.4](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.4.3...ppt-codec%401.4.4) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.5.1
- Updated archive-codec to 1.10.1

## [1.4.3](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.4.2...ppt-codec%401.4.3) (2026-09-08)


### Dependencies

- Updated archive-codec to 1.10.0

## [1.4.2](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.4.1...ppt-codec%401.4.2) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.5.0
- Updated archive-codec to 1.9.2

## [1.4.1](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.4.0...ppt-codec%401.4.1) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.4.0
- Updated archive-codec to 1.9.1

## [1.4.0](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.3.0...ppt-codec%401.4.0) (2026-09-08)

### Features

* **ppt-codec:** resolve text formatting through the master style cascade ([71fe59d](https://github.com/ExaDev/documents.js/commit/71fe59d41d9ad5b4f6a635b9e2b65d2d6a53e6e4))

## [1.3.0](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.2.13...ppt-codec%401.3.0) (2026-09-08)

### Features

* **ppt-codec:** decrypt RC4 CryptoAPI-encrypted presentations ([3d7a8df](https://github.com/ExaDev/documents.js/commit/3d7a8dfe3fad55f0caa0e2439e1f61e5a8a75e0f))


### Dependencies

- Updated archive-codec to 1.9.0

## [1.2.13](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.2.12...ppt-codec%401.2.13) (2026-09-08)


### Dependencies

- Updated archive-codec to 1.8.0

## [1.2.12](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.2.11...ppt-codec%401.2.12) (2026-09-08)


### Dependencies

- Updated archive-codec to 1.7.2

## [1.2.11](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.2.10...ppt-codec%401.2.11) (2026-09-08)

### Bug Fixes

* **hooks:** remove stale per-package lint-staged fields ([1b85b5a](https://github.com/ExaDev/documents.js/commit/1b85b5a545fb9762879310ed4ea73b68fa73d00d))

### Miscellaneous Chores

* **deps:** pin every workspace dependency to an exact fixed version ([6a38142](https://github.com/ExaDev/documents.js/commit/6a38142facc043dfa499573f37431d3b32ff602e))


### Dependencies

- Updated document-schema.js to 7.3.1
- Updated archive-codec to 1.7.1

## [1.2.10](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.2.9...ppt-codec%401.2.10) (2026-09-08)


### Dependencies

- Updated archive-codec to ^1.7.0

## [1.2.9](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.2.8...ppt-codec%401.2.9) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.3.0
- Updated archive-codec to ^1.6.8

## [1.2.8](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.2.7...ppt-codec%401.2.8) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.2.0
- Updated archive-codec to ^1.6.7

## [1.2.7](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.2.6...ppt-codec%401.2.7) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.1.0
- Updated archive-codec to ^1.6.6

## [1.2.6](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.2.5...ppt-codec%401.2.6) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.0.0
- Updated archive-codec to ^1.6.5

## [1.2.5](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.2.4...ppt-codec%401.2.5) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.3
- Updated archive-codec to ^1.6.4

## [1.2.4](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.2.3...ppt-codec%401.2.4) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.2
- Updated archive-codec to ^1.6.3

## [1.2.3](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.2.2...ppt-codec%401.2.3) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.1
- Updated archive-codec to ^1.6.2

## [1.2.2](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.2.1...ppt-codec%401.2.2) (2026-09-06)


### Dependencies

- Updated document-schema.js to ^6.2.0
- Updated archive-codec to ^1.6.1

## [1.2.1](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.2.0...ppt-codec%401.2.1) (2026-09-06)


### Dependencies

- Updated archive-codec to ^1.6.0

## [1.2.0](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.1.3...ppt-codec%401.2.0) (2026-09-06)

### Features

* **workspace:** add per-package Stryker mutation testing configuration ([ff3eacc](https://github.com/ExaDev/documents.js/commit/ff3eacc124577b163a1c13a63b83484d9611ae5a))

### Bug Fixes

* **workspace:** drop the unused per-package @stryker-mutator/api dependency ([69270b6](https://github.com/ExaDev/documents.js/commit/69270b6e7ad7163c3b76cd085f4e5f367433994c))


### Dependencies

- Updated document-schema.js to ^6.1.0
- Updated archive-codec to ^1.5.0

## [1.1.3](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.1.2...ppt-codec%401.1.3) (2026-09-06)

### Build System

* typecheck test/workers across every package where it is currently clean ([f340428](https://github.com/ExaDev/documents.js/commit/f340428b51a669010c0c4e5edb4310fe6ea4789a)), closes [#1021](https://github.com/ExaDev/documents.js/issues/1021)


### Dependencies

- Updated document-schema.js to ^6.0.0
- Updated archive-codec to ^1.4.3

## [1.1.2](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.1.1...ppt-codec%401.1.2) (2026-09-05)

### Continuous Integration

* add the missing _test:coverage script to nine packages ([bc658d0](https://github.com/ExaDev/documents.js/commit/bc658d094b6ffbd0616cc225c57d5c0595374172))


### Dependencies

- Updated archive-codec to ^1.4.2

## [1.1.1](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.1.0...ppt-codec%401.1.1) (2026-09-05)


### Dependencies

- Updated document-schema.js to ^5.6.0
- Updated archive-codec to ^1.4.1

## [1.1.0](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.0.2...ppt-codec%401.1.0) (2026-09-04)

### Features

* **ppt-codec:** read a slide's speaker notes from its NotesContainer ([80ae154](https://github.com/ExaDev/documents.js/commit/80ae15452307a74ab6227ca8d77669796f94075f))
* **ppt-codec:** read and write a paragraph's spacing and margins ([cb34950](https://github.com/ExaDev/documents.js/commit/cb34950571e689df8294b40840bf047548499a14))
* **ppt-codec:** read and write document metadata via SummaryInformation ([a43b8af](https://github.com/ExaDev/documents.js/commit/a43b8afbbbf8106950f3172842c7668a6dbeaf08))
* **ppt-codec:** write real MS-PPT presentations ([891de82](https://github.com/ExaDev/documents.js/commit/891de82c54da6eb756e078570a26ea788873c9df))
* **ppt-codec:** write speaker notes, and the master slide their linkage needs ([72d22aa](https://github.com/ExaDev/documents.js/commit/72d22aa1198b7613a3d73142cb00c7b2560f700a))

### Bug Fixes

* **ppt-codec:** give a written notes slide the colour scheme its NotesAtom says it does not inherit ([1ce0e6e](https://github.com/ExaDev/documents.js/commit/1ce0e6e60438a18f596819d85f5e67981606ce03))
* **ppt-codec:** reject a malformed createdIso/modifiedIso before the FILETIME conversion ([28c987a](https://github.com/ExaDev/documents.js/commit/28c987a0e5d098331cdf8bbb9283418566c7ae50))

### Code Refactoring

* **ppt-codec:** consume archive-codec's shared LayoutMetadata mapping ([7d0c81d](https://github.com/ExaDev/documents.js/commit/7d0c81d4842979eddf3a5ab0dc6e3201c390565a))
* **ppt-codec:** move record byte builders into a production module ([aedc0ee](https://github.com/ExaDev/documents.js/commit/aedc0eef38a6f4fe06008c247b6a8279c9849d17))

### Documentation

* **ppt-codec:** describe the speaker-notes records and how they were verified ([01bd292](https://github.com/ExaDev/documents.js/commit/01bd29286d9fa4bc31eaff982f5fd554d1502a01))
* **ppt-codec:** describe the write path and its scope ([582233e](https://github.com/ExaDev/documents.js/commit/582233e21624e9e5b34831f15ff051e1ab833525))
* **ppt-codec:** document paragraph spacing and margins as read and written ([f1fe832](https://github.com/ExaDev/documents.js/commit/f1fe8326fe2bd18695a8876b20cab76243db1aae))

### Tests

* **ppt-codec:** cover paragraph spacing and margins, fixing paragraph-property fixtures ([46c7eef](https://github.com/ExaDev/documents.js/commit/46c7eef3553140fba9559a4d3852de5d0797737c))
* **ppt-codec:** pin slide id minting below the MasterId sentinel range ([ec54e67](https://github.com/ExaDev/documents.js/commit/ec54e6709818da41bda77168d6f31de0c5b5fcc1))


### Dependencies

- Updated document-schema.js to ^5.5.1
- Updated archive-codec to ^1.4.0

## [1.0.2](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.0.1...ppt-codec%401.0.2) (2026-09-03)


### Dependencies

- Updated document-schema.js to ^5.5.0

## [1.0.1](https://github.com/ExaDev/documents.js/compare/ppt-codec%401.0.0...ppt-codec%401.0.1) (2026-09-03)


### Dependencies

- Updated archive-codec to ^1.3.0

## 1.0.0 (2026-09-03)

### Features

* **ppt-codec:** map a .ppt file onto the shared presentation content model ([33a56d3](https://github.com/ExaDev/documents.js/commit/33a56d3e81756df3b7a915e5480f0775e9b2dcec))
* **ppt-codec:** read slide text bodies and their character-run formatting ([5596b9b](https://github.com/ExaDev/documents.js/commit/5596b9b8c3aee9ec68501e790da5f022b2624e80))
* **ppt-codec:** read the [MS-PPT] record tree and its shared 8-byte header ([27df443](https://github.com/ExaDev/documents.js/commit/27df443702c8d781c0293cd7fb82f9c93f0b3de3))
* **ppt-codec:** read the document container's slide list, size and fonts ([8c1b61c](https://github.com/ExaDev/documents.js/commit/8c1b61c3ff59ad07420823de9ca09bd6529f6c0c))
* **ppt-codec:** resolve shape anchors through nested group coordinate systems ([d65e260](https://github.com/ExaDev/documents.js/commit/d65e26039a35e1ab41cbb8b617b4896ee10ec230))
* **ppt-codec:** resolve the live user edit through the persist directory ([e044ca3](https://github.com/ExaDev/documents.js/commit/e044ca3e20335d2215544c17d298c55c5b04089d))

### Code Refactoring

* **ppt-codec:** read a shape's identity and flags as one pair ([d22072f](https://github.com/ExaDev/documents.js/commit/d22072f4fece074007927dfa00bb0d8875111fdc))

### Documentation

* **ppt-codec:** point AGENTS.md and CLAUDE.md at the package README ([719edbf](https://github.com/ExaDev/documents.js/commit/719edbfaf37a1b0df8efcb544af6c0fb52836465))
* **ppt-codec:** state the read path's coverage and its remaining gaps ([29efcfa](https://github.com/ExaDev/documents.js/commit/29efcfae4d381bee3d769a8c2ef3646956892cb3))

### Tests

* **ppt-codec:** parse the reader's output against the shared schemas ([55e2f42](https://github.com/ExaDev/documents.js/commit/55e2f42fa2623edc68d246d5f71dca41c328c62f))

### Build System

* **ppt-codec:** ignore the package's own build output ([a464d92](https://github.com/ExaDev/documents.js/commit/a464d92f5ce7250d4327483221fa87e22766843f))
