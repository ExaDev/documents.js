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
