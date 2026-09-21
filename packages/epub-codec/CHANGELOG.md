## [5.0.0](https://github.com/ExaDev/documents.js/compare/epub-codec%404.0.0...epub-codec%405.0.0) (2026-09-21)

### ⚠ BREAKING CHANGES

* **epub-codec:** a th cell's text no longer reads as bold runs, and a
  row carrying isHeader writes th cells where every row previously wrote
  td. A table whose rows state no header flag writes as before.

### Features

* **epub-codec:** read and write a table row's header-ness as th cells ([c7b3ba5](https://github.com/ExaDev/documents.js/commit/c7b3ba52fd21911a39eb68992329ab112b9bf4bd)), references [#1377](https://github.com/ExaDev/documents.js/issues/1377)


### Dependencies

- Updated byte-codec to 1.8.0
- Updated document-schema.js to 7.14.0

## [4.0.0](https://github.com/ExaDev/documents.js/compare/epub-codec%403.0.1...epub-codec%404.0.0) (2026-09-21)

### ⚠ BREAKING CHANGES

* **epub-codec:** a ContentTable violating the grid rule stated on ContentTableCell
  is now refused rather than written with the offending content silently dropped. A
  caller building a table by hand must give every row one cell per grid column, keep
  a merged region's content on its anchor, and state each span once, on the anchor.

### Bug Fixes

* **epub-codec:** refuse a table that breaks the grid rule rather than writing past it ([eac3212](https://github.com/ExaDev/documents.js/commit/eac32120ccca53200af3586244d26758ae73bf90))


### Dependencies

- Updated document-schema.js to 7.13.0

## [3.0.1](https://github.com/ExaDev/documents.js/compare/epub-codec%403.0.0...epub-codec%403.0.1) (2026-09-21)


### Dependencies

- Updated byte-codec to 1.7.0

## [3.0.0](https://github.com/ExaDev/documents.js/compare/epub-codec%402.0.1...epub-codec%403.0.0) (2026-09-21)

### ⚠ BREAKING CHANGES

* **epub-codec:** an XHTML table read by this package now has one ContentTableCell
  per grid column in every row, and columnWidthsPt states the real grid width rather
  than the widest row's cell count.

### Bug Fixes

* **epub-codec:** place XHTML table cells on the grid their spans imply ([03b740d](https://github.com/ExaDev/documents.js/commit/03b740dd9e6071b16685aa390dc097179a8bfbed))


### Dependencies

- Updated document-schema.js to 7.12.0

## [2.0.1](https://github.com/ExaDev/documents.js/compare/epub-codec%402.0.0...epub-codec%402.0.1) (2026-09-20)

### Documentation

* make a hand-typed scoped mutation run find its package's Stryker config ([ed3297b](https://github.com/ExaDev/documents.js/commit/ed3297b6aa71b2d94913519e6960537ca5ac0f61))


### Dependencies

- Updated byte-codec to 1.6.3
- Updated document-schema.js to 7.11.5

## [2.0.0](https://github.com/ExaDev/documents.js/compare/epub-codec%401.5.8...epub-codec%402.0.0) (2026-09-20)

### ⚠ BREAKING CHANGES

* **epub-codec:** The epub-codec/util/base64 deep import is removed,
  along with its entry in the smoke suite's deep-module list.
  bytesToBase64 and base64ToBytes come from byte-codec now, and are
  still on this package's own barrel as well. The removal already
  shipped, unmarked, in 1.5.8.

### Documentation

* **epub-codec:** state that base64 moved out of src/util ([a3c820d](https://github.com/ExaDev/documents.js/commit/a3c820d0c409e5f019a9c4a9b711336ec484ea9d))


### Dependencies

- Updated byte-codec to 1.6.2

## [1.5.8](https://github.com/ExaDev/documents.js/compare/epub-codec%401.5.7...epub-codec%401.5.8) (2026-09-20)

### Code Refactoring

* **epub-codec:** encode and decode base64 through byte-codec ([ef2b72c](https://github.com/ExaDev/documents.js/commit/ef2b72c0b34de0399cf9bfc7fadd804242ef64d4))


### Dependencies

- Updated byte-codec to 1.6.1

## [1.5.7](https://github.com/ExaDev/documents.js/compare/epub-codec%401.5.6...epub-codec%401.5.7) (2026-09-20)


### Dependencies

- Updated document-schema.js to 7.11.4

## [1.5.6](https://github.com/ExaDev/documents.js/compare/epub-codec%401.5.5...epub-codec%401.5.6) (2026-09-16)

### Miscellaneous Chores

* **epub-codec:** raise the mutation break threshold to 100 ([64ea8c2](https://github.com/ExaDev/documents.js/commit/64ea8c2069ccaf6ad9abaee4d0e4dc254e1eb69b))

## [1.5.5](https://github.com/ExaDev/documents.js/compare/epub-codec%401.5.4...epub-codec%401.5.5) (2026-09-14)

### Code Refactoring

* **epub-codec:** check only the highest byte in the zip helpers' truncation guards ([82b4f3d](https://github.com/ExaDev/documents.js/commit/82b4f3d402c47668ade0791531ddfeb98b29ae08))
* **epub-codec:** collapse redundant XHTML block-read branches and guards ([e82ce9c](https://github.com/ExaDev/documents.js/commit/e82ce9cab0144064c47f4071cf54b519d8cb8a50))
* **epub-codec:** decode base64 into a plain array, not a pre-sized buffer ([1014a5d](https://github.com/ExaDev/documents.js/commit/1014a5d3439d9fb2cb548dfa332422986839fa56))
* **epub-codec:** drop a redundant empty-href guard in resolveHrefTarget ([e6bd9ee](https://github.com/ExaDev/documents.js/commit/e6bd9ee2687d9233a8301e5e7992b90c57bff176))
* **epub-codec:** drop a redundant itemId-run bound in xhtml/write ([dfc9d0c](https://github.com/ExaDev/documents.js/commit/dfc9d0cb3a7535feb4da249e5bea9fa28ef17b60))
* **epub-codec:** drop bounds checks looksLikeXml's own comparisons subsume ([5bafe34](https://github.com/ExaDev/documents.js/commit/5bafe34a05ae6ba88cafce8fecde4488472b6653))
* **epub-codec:** drop bounds checks the undefined-index comparisons already cover ([22ccb8a](https://github.com/ExaDev/documents.js/commit/22ccb8a5f415dbb9e448378fa4e0ba12c4c9ce66))
* **epub-codec:** drop dead exhaustiveness branch and redundant bounds checks in xhtml/write ([9f48327](https://github.com/ExaDev/documents.js/commit/9f48327769cb70ebd2e6a25c0b1f1f7e74d5e133))
* **epub-codec:** drop redundant stray-content filters in xhtml/read ([6792346](https://github.com/ExaDev/documents.js/commit/6792346d8e5985ab8de1dafc060ed2c8fb52ebad))
* **epub-codec:** drop styledRun's own dead hyperlink parameter and the redundant span case ([7a806b7](https://github.com/ExaDev/documents.js/commit/7a806b7a66f2a0df67edfa68a796a573220e65f2))
* **epub-codec:** drop the last redundant inert-element guard in a table cell loop ([519b92f](https://github.com/ExaDev/documents.js/commit/519b92f81eccda5061ac3aa8db7de8a0fa69fed4))
* **epub-codec:** match epub:type toc via word-boundary regex in nav3 ([3f66995](https://github.com/ExaDev/documents.js/commit/3f66995490d9c4f2d1d9c233a86eaad10e568669))
* **epub-codec:** replace length-bound loops with their own undefined-read termination ([26b34f8](https://github.com/ExaDev/documents.js/commit/26b34f875a5a16f28d957fb1174ecfc2ba60f34a))
* **epub-codec:** stop building writeEpubContent's own zip entries as dead ZipEntry objects ([6c8cbb3](https://github.com/ExaDev/documents.js/commit/6c8cbb378aa4a6022d7345f15a493db277899ff1)), references [ExaDev/documents.js#963](https://github.com/ExaDev/documents.js/issues/963)
* **epub-codec:** stop constructing pi/declaration text fast-xml-parser drops ([c7d6e6b](https://github.com/ExaDev/documents.js/commit/c7d6e6b696a427a2a2a045397be3457850889f15))
* **epub-codec:** test epub:type substrings without splitting into tokens ([518fe88](https://github.com/ExaDev/documents.js/commit/518fe887af6b67dc84aa4d182c258eada31cc151))
* **epub-codec:** use undefined for a pi/declaration node's own ignored builder value ([1e53cfe](https://github.com/ExaDev/documents.js/commit/1e53cfe44ac7986c283aa663936e35988d025e3e))

### Tests

* **epub-codec:** add buildXml's first dedicated test file ([314a866](https://github.com/ExaDev/documents.js/commit/314a8668f2630c4dd2beaa530a335687f005f408))
* **epub-codec:** add footnote.ts's first dedicated test file ([5347e4c](https://github.com/ExaDev/documents.js/commit/5347e4c952e007c5f1f187165f2ba52ac2f8193b))
* **epub-codec:** add isXmlNode's first dedicated test file ([179581e](https://github.com/ExaDev/documents.js/commit/179581e5fb657a86be558c2631c0b108f21ffa04))
* **epub-codec:** add resolveHrefTarget's first dedicated test file ([85d31ea](https://github.com/ExaDev/documents.js/commit/85d31eabab216dc909d3592a128f8fd5b686ba12))
* **epub-codec:** assert every diagnostic error class's own name and message ([a0c8fc7](https://github.com/ExaDev/documents.js/commit/a0c8fc7a50ba05a5e13d763a22e6d2bed005f48d))
* **epub-codec:** assert parseOpf's error messages and its item-filtering gates ([7c1fa4f](https://github.com/ExaDev/documents.js/commit/7c1fa4f653ba1706551879d845cd855439bca2bd))
* **epub-codec:** assert resolveOpfPath's own error messages ([c753ec3](https://github.com/ExaDev/documents.js/commit/c753ec3256383ea658f8edc5f0fcb8df40143c4f))
* **epub-codec:** assert writeNav3Document's own tree structurally ([acf90b0](https://github.com/ExaDev/documents.js/commit/acf90b0bdcaf095c3e2fa051e82610eb05da75d2))
* **epub-codec:** assert writeOpf's own tree structurally ([91758fb](https://github.com/ExaDev/documents.js/commit/91758fb685835eea35c73bb18d95309cf7738f5e))
* **epub-codec:** cover base64ToBytes' padding-position and whitespace stripping ([c0c27e9](https://github.com/ExaDev/documents.js/commit/c0c27e95905177d220f1b80324c5522704cc9c40))
* **epub-codec:** cover isXmlNode's own type-guard boundary conditions ([3a57f1c](https://github.com/ExaDev/documents.js/commit/3a57f1c4b4ef073c36c10c12f936cabf1db9d24a))
* **epub-codec:** cover list grouping, bookmarks, and run-node edges in xhtml/write ([bab3bf0](https://github.com/ExaDev/documents.js/commit/bab3bf0ee30c102015564a11377a958d9c7d816e))
* **epub-codec:** cover metadata trimming and dcterms:modified variants in opf/parse ([6165eca](https://github.com/ExaDev/documents.js/commit/6165ecaf3c1e6bd0670e0c40a0dee700d97f13a7))
* **epub-codec:** cover parseNode/parseAttributes/scalarText's own shape checks ([bb1efb1](https://github.com/ExaDev/documents.js/commit/bb1efb1c9591ed2f17838fb1aaf56fab1e5ccec4))
* **epub-codec:** cover readEpubContent/readEpub's own error and diagnostic message paths ([9a1df9f](https://github.com/ExaDev/documents.js/commit/9a1df9f1e7717d1c7b920ddd1d779746514aa699))
* **epub-codec:** cover table span/caption edges and non-footnote asides in xhtml/read ([866414e](https://github.com/ExaDev/documents.js/commit/866414e41ee9c5e74176e5afadf3c6c00f323309))
* **epub-codec:** cover the legacy pre heuristic and link construct edges in xhtml/write ([18c6d46](https://github.com/ExaDev/documents.js/commit/18c6d46fc844e8b7778479ae77376c3fcbcf66d4))
* **epub-codec:** cover the local-file-header readers' own truncation guards ([46f1982](https://github.com/ExaDev/documents.js/commit/46f1982214032c33e539cd99fe254ff7d0330c2d))
* **epub-codec:** cover the remaining single/few-mutant survivors across nine small modules ([72fa092](https://github.com/ExaDev/documents.js/commit/72fa09284fd98bd165947fc49854d0c2419754c6))
* **epub-codec:** cover the scheme regex boundary and dot/empty path segments ([865164b](https://github.com/ExaDev/documents.js/commit/865164bbe632ce572b9b5546c02180e63d4f57d1))
* **epub-codec:** cover xhtml/read anchor, style-residue, and pre/table edge cases ([66d176e](https://github.com/ExaDev/documents.js/commit/66d176e64cbe7a63eb4f9c8f02096943023abafe))
* **epub-codec:** exercise packageFromEntries' BOM and whitespace classification ([b190748](https://github.com/ExaDev/documents.js/commit/b190748e6016f7177f850a0ce83950ae8faefcbb))
* **epub-codec:** exercise PNG IHDR boundaries and JPEG marker-walking edge cases ([936df51](https://github.com/ExaDev/documents.js/commit/936df516e7c7e601f0dd5e6659804b6e6624c1a1))
* **epub-codec:** parse comment, cdata, and processing-instruction nodes ([00f7d9b](https://github.com/ExaDev/documents.js/commit/00f7d9b8fd541020b8a30af8263e847375fad27b))
* **epub-codec:** pin dcterms:modified matching and absent-key semantics in opf/parse ([bf3d975](https://github.com/ExaDev/documents.js/commit/bf3d975485a84476da46543e403f8d0e8a930bcf))
* **epub-codec:** reject an epub:type token that merely starts with "toc" ([523797c](https://github.com/ExaDev/documents.js/commit/523797c7c50ee8aed0f8e3352e72cc4ec53a4487))
* **epub-codec:** split manifest item properties on a single whitespace char ([a3e4d2a](https://github.com/ExaDev/documents.js/commit/a3e4d2aef0fafae16263a85e6a4eaa94e5717b26))
* **epub-codec:** stop using Object.assign in isXmlNode's function-masquerade fixture ([f2e1b54](https://github.com/ExaDev/documents.js/commit/f2e1b54d5a0d3a04a98ec5419e705688edf426be))
* **epub-codec:** verify the hand-authored fixtures' own real byte content ([1edfbf1](https://github.com/ExaDev/documents.js/commit/1edfbf1003d652c16d67aa2099aa55097a605f53))

## [1.5.4](https://github.com/ExaDev/documents.js/compare/epub-codec%401.5.3...epub-codec%401.5.4) (2026-09-14)

### Miscellaneous Chores

* bump pinned pnpm to 12.4.1 across the workspace ([4e81c2d](https://github.com/ExaDev/documents.js/commit/4e81c2dfdb08fff226c20a0f267baffa87758e0f))
* **lint:** except each package's own measured eslint-config 2.12.1 debt ([11c35bc](https://github.com/ExaDev/documents.js/commit/11c35bc61db74c68b4be725c34452509fba00c2a))


### Dependencies

- Updated document-schema.js to 7.11.3

## [1.5.3](https://github.com/ExaDev/documents.js/compare/epub-codec%401.5.2...epub-codec%401.5.3) (2026-09-13)


### Dependencies

- Updated document-schema.js to 7.11.2

## [1.5.2](https://github.com/ExaDev/documents.js/compare/epub-codec%401.5.1...epub-codec%401.5.2) (2026-09-11)

### Bug Fixes

* **epub-codec:** keep the pinned zip entry mtime inside fflate's valid DOS-date range ([d9e8586](https://github.com/ExaDev/documents.js/commit/d9e858618f483505087659f88fbccd3828e961cb))

## [1.5.1](https://github.com/ExaDev/documents.js/compare/epub-codec%401.5.0...epub-codec%401.5.1) (2026-09-11)

### Code Refactoring

* load stryker.config.ts directly instead of a jiti .mjs bootstrap ([4221520](https://github.com/ExaDev/documents.js/commit/42215205caa1c8fc6368ed38729d15836bdd613b))


### Dependencies

- Updated document-schema.js to 7.11.1

## [1.5.0](https://github.com/ExaDev/documents.js/compare/epub-codec%401.4.0...epub-codec%401.5.0) (2026-09-11)

### Features

* **ci:** gate each measured package on its first CI mutation baseline ([9f8fa69](https://github.com/ExaDev/documents.js/commit/9f8fa6947795b2089bed03c936691893643ce2ae))


### Dependencies

- Updated document-schema.js to 7.11.0

## [1.4.0](https://github.com/ExaDev/documents.js/compare/epub-codec%401.3.9...epub-codec%401.4.0) (2026-09-11)

### Features

* **epub-codec:** map sub/sup onto ContentRun.verticalAlign in both directions ([33b5256](https://github.com/ExaDev/documents.js/commit/33b525691246ea1fbb7c686dcc3b28227ea96c67))
* **epub-codec:** map the XHTML dir attribute onto paragraph and run direction ([8d7a3f4](https://github.com/ExaDev/documents.js/commit/8d7a3f4f8f77b5e501a16cac90fccc6eded4fed7))


### Dependencies

- Updated document-schema.js to 7.10.0

## [1.3.9](https://github.com/ExaDev/documents.js/compare/epub-codec%401.3.8...epub-codec%401.3.9) (2026-09-11)


### Dependencies

- Updated document-schema.js to 7.9.1

## [1.3.8](https://github.com/ExaDev/documents.js/compare/epub-codec%401.3.7...epub-codec%401.3.8) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.9.0

## [1.3.7](https://github.com/ExaDev/documents.js/compare/epub-codec%401.3.6...epub-codec%401.3.7) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.8.0

## [1.3.6](https://github.com/ExaDev/documents.js/compare/epub-codec%401.3.5...epub-codec%401.3.6) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.7.0

## [1.3.5](https://github.com/ExaDev/documents.js/compare/epub-codec%401.3.4...epub-codec%401.3.5) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.6.1

## [1.3.4](https://github.com/ExaDev/documents.js/compare/epub-codec%401.3.3...epub-codec%401.3.4) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.6.0

## [1.3.3](https://github.com/ExaDev/documents.js/compare/epub-codec%401.3.2...epub-codec%401.3.3) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.5.1

## [1.3.2](https://github.com/ExaDev/documents.js/compare/epub-codec%401.3.1...epub-codec%401.3.2) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.5.0

## [1.3.1](https://github.com/ExaDev/documents.js/compare/epub-codec%401.3.0...epub-codec%401.3.1) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.4.0

## [1.3.0](https://github.com/ExaDev/documents.js/compare/epub-codec%401.2.12...epub-codec%401.3.0) (2026-09-08)

### Features

* **epub-codec:** add a lossless byte-level Package model ([5c28859](https://github.com/ExaDev/documents.js/commit/5c28859e5d8603a3abc44b6680122bc851b0df49))
* **epub-codec:** build the internal-target link construct for same- and cross-document hrefs ([934baec](https://github.com/ExaDev/documents.js/commit/934baec99f22b2ac4dbeeb65d8d2f56597113753))
* **epub-codec:** recognise a footnote whose body lives in a different spine document ([7fd6907](https://github.com/ExaDev/documents.js/commit/7fd6907d5242c50f3e1c1ac129f0aa3d18030afe))

## [1.2.12](https://github.com/ExaDev/documents.js/compare/epub-codec%401.2.11...epub-codec%401.2.12) (2026-09-08)

### Bug Fixes

* **hooks:** remove stale per-package lint-staged fields ([1b85b5a](https://github.com/ExaDev/documents.js/commit/1b85b5a545fb9762879310ed4ea73b68fa73d00d))

### Miscellaneous Chores

* **deps:** pin every workspace dependency to an exact fixed version ([6a38142](https://github.com/ExaDev/documents.js/commit/6a38142facc043dfa499573f37431d3b32ff602e))


### Dependencies

- Updated document-schema.js to 7.3.1

## [1.2.11](https://github.com/ExaDev/documents.js/compare/epub-codec%401.2.10...epub-codec%401.2.11) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.3.0

## [1.2.10](https://github.com/ExaDev/documents.js/compare/epub-codec%401.2.9...epub-codec%401.2.10) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.2.0

## [1.2.9](https://github.com/ExaDev/documents.js/compare/epub-codec%401.2.8...epub-codec%401.2.9) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.1.0

## [1.2.8](https://github.com/ExaDev/documents.js/compare/epub-codec%401.2.7...epub-codec%401.2.8) (2026-09-07)

### Tests

* **epub-codec:** pin the corrected footnote-after-list output ([5c9fc92](https://github.com/ExaDev/documents.js/commit/5c9fc925cb12469f697824a1a030ce7bead8b12a)), closes [ExaDev/document-schema.js#1022](https://github.com/ExaDev/document-schema.js/issues/1022)


### Dependencies

- Updated document-schema.js to ^7.0.0

## [1.2.7](https://github.com/ExaDev/documents.js/compare/epub-codec%401.2.6...epub-codec%401.2.7) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.3

## [1.2.6](https://github.com/ExaDev/documents.js/compare/epub-codec%401.2.5...epub-codec%401.2.6) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.2

## [1.2.5](https://github.com/ExaDev/documents.js/compare/epub-codec%401.2.4...epub-codec%401.2.5) (2026-09-07)

### Bug Fixes

* **epub-codec:** rebase nested construct offsets in appendNested/appendAnchor ([7231101](https://github.com/ExaDev/documents.js/commit/7231101c595bc3465e1c81a13d90d079d86d7d43))

## [1.2.4](https://github.com/ExaDev/documents.js/compare/epub-codec%401.2.3...epub-codec%401.2.4) (2026-09-07)

### Bug Fixes

* **epub-codec:** recognise block content inside caption/dt/dd/figcaption/td/th ([5389557](https://github.com/ExaDev/documents.js/commit/53895573e2b67eda73a0561578c0cbfee300e4df)), closes [ExaDev/documents.js#1023](https://github.com/ExaDev/documents.js/issues/1023)

## [1.2.3](https://github.com/ExaDev/documents.js/compare/epub-codec%401.2.2...epub-codec%401.2.3) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.1

## [1.2.2](https://github.com/ExaDev/documents.js/compare/epub-codec%401.2.1...epub-codec%401.2.2) (2026-09-07)

### Bug Fixes

* **epub-codec:** report a run-level bookmark/endnote/comment anchor ([09f27ad](https://github.com/ExaDev/documents.js/commit/09f27ad9a0883db3fc55d51a0ee47593ae35dc50)), closes [ExaDev/documents.js#1025](https://github.com/ExaDev/documents.js/issues/1025)

## [1.2.1](https://github.com/ExaDev/documents.js/compare/epub-codec%401.2.0...epub-codec%401.2.1) (2026-09-07)

### Bug Fixes

* **epub-codec:** decode numeric and HTML named character references ([e465959](https://github.com/ExaDev/documents.js/commit/e4659599c1388dad3f4ef17fc376edf4d62596ea)), closes [ExaDev/documents.js#1010](https://github.com/ExaDev/documents.js/issues/1010), references [#160](https://github.com/ExaDev/documents.js/issues/160) [#x2014](https://github.com/ExaDev/documents.js/issues/x2014)

### Tests

* **epub-codec:** update decodedTextContent fixture for full entity decoding ([6b8aa81](https://github.com/ExaDev/documents.js/commit/6b8aa81643370155c96f4dddbe328a9775f2dbd3)), references [pre-#1010](https://github.com/pre-/issues/1010) [#233](https://github.com/ExaDev/documents.js/issues/233) [#233](https://github.com/ExaDev/documents.js/issues/233)

## [1.2.0](https://github.com/ExaDev/documents.js/compare/epub-codec%401.1.0...epub-codec%401.2.0) (2026-09-06)

### Features

* **epub-codec:** report epub/noscript-content-skipped wherever a <noscript> subtree is dropped ([13ae06e](https://github.com/ExaDev/documents.js/commit/13ae06eed433d238a557d4c5060ac5369c36662f))

### Bug Fixes

* **epub-codec:** collect every run-level construct sharing a startRun, not just the first ([509f463](https://github.com/ExaDev/documents.js/commit/509f463dffe64cffaff35b3bcfe84141fda11c41))
* **epub-codec:** correct a stale reachability claim in list stray-content recovery's own comment ([f976994](https://github.com/ExaDev/documents.js/commit/f976994825f87fba216ce2b3b379640c38fd4734))
* **epub-codec:** correct elementsWithTag caller attribution in comment ([63a40d3](https://github.com/ExaDev/documents.js/commit/63a40d3bbb16f4f5bf3014c4c9466e02eaba3b1c))
* **epub-codec:** correct the same-startRun overlap diagnostic's own wording ([52cd5f4](https://github.com/ExaDev/documents.js/commit/52cd5f453cf95dc40b594d73d5aed7bf4ee9b6bb))
* **epub-codec:** correct two overclaims about list stray-content recovery ([4ad3fc7](https://github.com/ExaDev/documents.js/commit/4ad3fc766742e618bf3a943036af412e0c3ebb69))
* **epub-codec:** drop an empty or whitespace-only table caption on read ([af5804b](https://github.com/ExaDev/documents.js/commit/af5804bd04e1df4e0d3a18552389a57ee3cc5a06))
* **epub-codec:** group a list item's own consecutive blocks by itemId, not one <li> each ([741b756](https://github.com/ExaDev/documents.js/commit/741b756e6ea7845b3f4f626bd89da093e222f71a)), references [ExaDev/documents.js#1022](https://github.com/ExaDev/documents.js/issues/1022)
* **epub-codec:** keep a construct-only inline segment between block siblings ([7c025b7](https://github.com/ExaDev/documents.js/commit/7c025b7582d3cbcaf82eeaae6ce401219343acbf))
* **epub-codec:** keep a table caption's construct when its own text is empty ([7fcee9c](https://github.com/ExaDev/documents.js/commit/7fcee9ccb90353e3001b5a4f630d57ca22bd056c))
* **epub-codec:** map a <br> inside a <pre> to a literal newline ([5913e72](https://github.com/ExaDev/documents.js/commit/5913e72cf0ebe5a75445bf90441ac096551cba0e)), references [#994](https://github.com/ExaDev/documents.js/issues/994)
* **epub-codec:** preserve a footnote-reference construct carried by inline content inside a <pre> ([39fe7be](https://github.com/ExaDev/documents.js/commit/39fe7bec2b9de6bdcdf0651ebcb6b7a28caefb54))
* **epub-codec:** preserve a zero-run construct and a point anchor's own run on write ([bd91336](https://github.com/ExaDev/documents.js/commit/bd913360b215dd8525ef19ee3d24a16c1ba5fceb))
* **epub-codec:** preserve real whitespace in stray list content ([2600d6d](https://github.com/ExaDev/documents.js/commit/2600d6d91ff5bb194fdea865172bf86738e544b2))
* **epub-codec:** preserve run-level constructs carried by a table caption ([001618f](https://github.com/ExaDev/documents.js/commit/001618fe085e84fa7f71b0d85ae10b23860fba03))
* **epub-codec:** preserve run-level constructs on every paragraph built directly from inline content ([ff64725](https://github.com/ExaDev/documents.js/commit/ff647257711f458006b0573a580f4f5aac33a4d5))
* **epub-codec:** read a CDATA section exactly like a text node across the XHTML reading path ([13587bc](https://github.com/ExaDev/documents.js/commit/13587bc86ea909a394d24e0d040c6a71883429a3))
* **epub-codec:** recover stray content inside a <colgroup> outside any <col> ([f71e34c](https://github.com/ExaDev/documents.js/commit/f71e34cd12ba97f52bc5be2a427889bfadb73adf))
* **epub-codec:** recover stray content inside a table row group outside any <tr> ([bcdf277](https://github.com/ExaDev/documents.js/commit/bcdf2779c3f095562ed46079396b2ced6822f9bd))
* **epub-codec:** recover stray content inside a table's rows and outside them ([390a0e2](https://github.com/ExaDev/documents.js/commit/390a0e267ccd9f95983910b21ca54dee62e377ed))
* **epub-codec:** recover stray content sitting outside dt/dd in a definition list ([f77ad3c](https://github.com/ExaDev/documents.js/commit/f77ad3c6d29444840141309bc3729b7c0fed743d)), references [ExaDev/documents.js#994](https://github.com/ExaDev/documents.js/issues/994)
* **epub-codec:** recover stray list content sitting before a list's first <li> ([8c27793](https://github.com/ExaDev/documents.js/commit/8c27793635ccac3ce293385560e993575a3ed7a8))
* **epub-codec:** report a range footnote extent starting at the run count ([472a77f](https://github.com/ExaDev/documents.js/commit/472a77fb0f5e95fd13512688870e82c63291a5c1))
* **epub-codec:** round-trip a <pre> or <hr> nested directly inside a list item ([8b41daa](https://github.com/ExaDev/documents.js/commit/8b41daa0e77c1986e1745a3e7525b7192d9d53ab))
* **epub-codec:** round-trip a <pre> paragraph via its own preformatted flag, not run count ([3cee6a7](https://github.com/ExaDev/documents.js/commit/3cee6a73aa308a39cc545d5ca3ba0a6b590f19fe))
* **epub-codec:** skip <script>/<template> subtrees when scanning for headings and ids ([2e6aa75](https://github.com/ExaDev/documents.js/commit/2e6aa759574cae5b12e516e189244705592d3110))
* **epub-codec:** skip <style>/<noscript> in body content like <script>/<template> ([873520f](https://github.com/ExaDev/documents.js/commit/873520f6920c4cced01a9c8ff44e97bb7f04506d))
* **epub-codec:** skip script/template content inside a pre block too ([b0374ad](https://github.com/ExaDev/documents.js/commit/b0374ad96ab800825dcc5f0d69b0e4260dc13f58))
* **epub-codec:** skip whitespace and script-supporting elements in stray list content ([3583313](https://github.com/ExaDev/documents.js/commit/358331362359ce91466a21fcd22b781e8ea65451))
* **epub-codec:** stop dropping a footnote extent nested inside a winning run range ([f814058](https://github.com/ExaDev/documents.js/commit/f814058ca2989136582c75efaadede848b164f69))
* **epub-codec:** stop dropping stray list content whose text projection is empty ([ae15cee](https://github.com/ExaDev/documents.js/commit/ae15ceec5cd872829f14dc3a9ecc8b8a5c6d3e12))
* **epub-codec:** stop four XHTML container readers from silently dropping content ([0329bae](https://github.com/ExaDev/documents.js/commit/0329baef34cd72d562a097a4dac972e0feb36d2b))
* **epub-codec:** stop script/template content leaking into inline runs ([cd8364d](https://github.com/ExaDev/documents.js/commit/cd8364ddae15834780a98abdadae0fbef4a6c30e))
* **epub-codec:** stop textContent from silently changing its decode contract ([7d60840](https://github.com/ExaDev/documents.js/commit/7d6084041d5376605aed6099763228467ff96239))
* **epub-codec:** stop writeList fusing a multi-block list item's paragraphs ([736d5e2](https://github.com/ExaDev/documents.js/commit/736d5e2cf51299c8be609aa62147343a96ab7ba7))
* **epub-codec:** write a heading's runs directly, not via the paragraph dispatcher ([455dcf0](https://github.com/ExaDev/documents.js/commit/455dcf06717a4f0c3ae32673e0e1e665c0e84cc1))

### Code Refactoring

* **epub-codec:** deduplicate the script/template inert-element predicate ([b41700a](https://github.com/ExaDev/documents.js/commit/b41700a71c2b37bf0c963ead363f02c47f33a999))

### Documentation

* **epub-codec:** correct constructsField's own pre-existing-callers count ([8067b32](https://github.com/ExaDev/documents.js/commit/8067b322b0154ed8487b654eea6f3e756370d6cc))
* **epub-codec:** correct flushListStrayContent's browser-depth comment ([7e63157](https://github.com/ExaDev/documents.js/commit/7e63157cfb3ee95badd8932529e24025bc048068))
* **epub-codec:** correct the <colgroup> content model's spec citation ([877e1c9](https://github.com/ExaDev/documents.js/commit/877e1c99a2835d04edb1b1205a997e299c67156b)), references [html.spec.whatwg.org/multipage/tables.html#the-colgroup-element](https://github.com/html.spec.whatwg.org/multipage/tables.html/issues/the-colgroup-element)
* **epub-codec:** correct the <pre> content model claim to phrasing content ([f19171c](https://github.com/ExaDev/documents.js/commit/f19171c0a081f6403b9b9d25aa74489e83ce3678)), references [html.spec.whatwg.org/multipage/grouping-content.html#the-pre-element](https://github.com/html.spec.whatwg.org/multipage/grouping-content.html/issues/the-pre-element)
* **epub-codec:** correct the docx run-level marker function's name in a comment ([679a12b](https://github.com/ExaDev/documents.js/commit/679a12b4f29723e71a6893724a12bf20fac2dbf7))
* **epub-codec:** correct the image-pre-unsupported diagnostic's actual trigger ([4465991](https://github.com/ExaDev/documents.js/commit/4465991ec79fac44ad1ad97e4b59cceb9b455e67))
* **epub-codec:** describe the caption empty-drop and construct-preservation behaviour ([5bf6569](https://github.com/ExaDev/documents.js/commit/5bf6569fb0d86c0507d224efbd00db0b43f0dd8b))
* **epub-codec:** drop review-round pointer from textContent's docstring ([fea901c](https://github.com/ExaDev/documents.js/commit/fea901c861511f25cb4564f76afeacc92842b89c))
* **epub-codec:** name <colgroup> as a location this diagnostic covers ([afa044d](https://github.com/ExaDev/documents.js/commit/afa044d6467ab74fc25306294b8dd951eb9ee8c1))
* **epub-codec:** note the run-level construct walk's own footnote-only scope ([04fffcc](https://github.com/ExaDev/documents.js/commit/04fffcc5cabd5086b23ed6d54729f6a7e6342bf3))
* **epub-codec:** reference tracked issue for unrebased nested inline construct offsets ([19c2509](https://github.com/ExaDev/documents.js/commit/19c2509593662052951840f9d4a67e191911bd46)), references [ExaDev/documents.js#1038](https://github.com/ExaDev/documents.js/issues/1038)
* **epub-codec:** stop flushListStrayContent overclaiming an insulation guarantee ([6e0afe3](https://github.com/ExaDev/documents.js/commit/6e0afe39935b60dec61e1fa9b6db967f72892670))
* **epub-codec:** stop the unrepresented-footnote diagnostic asserting one absolute cause ([311a283](https://github.com/ExaDev/documents.js/commit/311a283c2c84726ced89dfeb78410b1545461ebb))
* **epub-codec:** update the gotchas bullet for the four gaps [#994](https://github.com/ExaDev/documents.js/issues/994) closed ([8275131](https://github.com/ExaDev/documents.js/commit/8275131c4ce1d2640bafe683ff43edd3648f8714))

### Tests

* **epub-codec:** add regression coverage for a heading's own footnote-reference construct ([96a1510](https://github.com/ExaDev/documents.js/commit/96a1510ad1b50a7a5feff0408b0cff96bb9a7a48))
* **epub-codec:** cover the four recovered content-drop shapes from [#994](https://github.com/ExaDev/documents.js/issues/994) ([6504158](https://github.com/ExaDev/documents.js/commit/65041585a2ae26fec00688f278f6094ef6440d50))
* **epub-codec:** cover writeTable dropping a stray cell's own construct marker ([6f54532](https://github.com/ExaDev/documents.js/commit/6f5453218eda25eb69df676dc130867956f64aab))


### Dependencies

- Updated document-schema.js to ^6.2.0

## [1.1.0](https://github.com/ExaDev/documents.js/compare/epub-codec%401.0.5...epub-codec%401.1.0) (2026-09-06)

### Features

* **workspace:** add per-package Stryker mutation testing configuration ([ff3eacc](https://github.com/ExaDev/documents.js/commit/ff3eacc124577b163a1c13a63b83484d9611ae5a))

### Bug Fixes

* **workspace:** drop the unused per-package @stryker-mutator/api dependency ([69270b6](https://github.com/ExaDev/documents.js/commit/69270b6e7ad7163c3b76cd085f4e5f367433994c))


### Dependencies

- Updated document-schema.js to ^6.1.0

## [1.0.5](https://github.com/ExaDev/documents.js/compare/epub-codec%401.0.4...epub-codec%401.0.5) (2026-09-06)

### Bug Fixes

* **epub-codec:** degrade a nested <img> in inline markup to alt text instead of dropping it ([0af341a](https://github.com/ExaDev/documents.js/commit/0af341aa72080f1c6ffa99fc735f908972699e1c))
* **epub-codec:** describe the inline-image diagnostic without a false cause ([e78b832](https://github.com/ExaDev/documents.js/commit/e78b832f2f0b1f3aaa4f3d092617ec74ad01436e))
* **epub-codec:** stop the inline-image diagnostic asserting a false cause and fabricating a src ([ec3c6c0](https://github.com/ExaDev/documents.js/commit/ec3c6c0ac1dfbe5550c061ddf9b9b12735f37065))

### Documentation

* **epub-codec:** broaden the direct-image-split gotcha to every non-container context ([712dd95](https://github.com/ExaDev/documents.js/commit/712dd955cff31608f475baaae1294f66468948b0))
* **epub-codec:** describe the nested-<img> degrade instead of the old silent-drop gap ([e4efd8e](https://github.com/ExaDev/documents.js/commit/e4efd8e97d65ae45af82bd5c48d2bb7b39f8a74e))
* **epub-codec:** name every container the direct-image split actually covers ([b2a4989](https://github.com/ExaDev/documents.js/commit/b2a4989db6fa869c25703f1b620ff5f04a5f6f0e))
* **epub-codec:** name readList's nested-list drop as a fourth silent gap ([b8b4295](https://github.com/ExaDev/documents.js/commit/b8b429582fccbb951ce7e01dff72d9231fbe3bf1))
* **epub-codec:** stop claiming the image-inline-unsupported diagnostic is universal ([3d1fc2f](https://github.com/ExaDev/documents.js/commit/3d1fc2ff8739f811bf5f985f6cbfd92426897965))

### Tests

* **epub-codec:** cover an <img> nested inside inline markup ([ee9dacd](https://github.com/ExaDev/documents.js/commit/ee9dacd4473d3551ba557d2722d7515aedf4cd77))

### Build System

* typecheck test/workers across every package where it is currently clean ([f340428](https://github.com/ExaDev/documents.js/commit/f340428b51a669010c0c4e5edb4310fe6ea4789a)), closes [#1021](https://github.com/ExaDev/documents.js/issues/1021)


### Dependencies

- Updated document-schema.js to ^6.0.0

## [1.0.4](https://github.com/ExaDev/documents.js/compare/epub-codec%401.0.3...epub-codec%401.0.4) (2026-09-05)

### Continuous Integration

* add the missing _test:coverage script to nine packages ([bc658d0](https://github.com/ExaDev/documents.js/commit/bc658d094b6ffbd0616cc225c57d5c0595374172))

## [1.0.3](https://github.com/ExaDev/documents.js/compare/epub-codec%401.0.2...epub-codec%401.0.3) (2026-09-05)

### Bug Fixes

* handle ContentImageBlock's widened svg/gif formats across every consumer ([875b10b](https://github.com/ExaDev/documents.js/commit/875b10b3281ca1ab598abc97230d82f8ff5cdaae))


### Dependencies

- Updated document-schema.js to ^5.6.0

## [1.0.2](https://github.com/ExaDev/documents.js/compare/epub-codec%401.0.1...epub-codec%401.0.2) (2026-09-04)


### Dependencies

- Updated document-schema.js to ^5.5.1

## [1.0.1](https://github.com/ExaDev/documents.js/compare/epub-codec%401.0.0...epub-codec%401.0.1) (2026-09-03)


### Dependencies

- Updated document-schema.js to ^5.5.0

## 1.0.0 (2026-09-02)

### Features

* **epub-codec:** add EPUB 3 nav / EPUB 2 NCX reconciliation and nav writing ([252244c](https://github.com/ExaDev/documents.js/commit/252244c20631b051ff15f7beeedb016715889eac))
* **epub-codec:** add epubCodec/epubContentCodec z.codec() pair ([00cb91a](https://github.com/ExaDev/documents.js/commit/00cb91a83fdf3c2c1bd1d50f2098cdf867ee5927))
* **epub-codec:** add image dimension detection and base64 codec ([d91d30d](https://github.com/ExaDev/documents.js/commit/d91d30da08ba45bc0f8efc3159ae6b789eb6a8f6))
* **epub-codec:** add lossless XML parse/build/query layer ([ad54d70](https://github.com/ExaDev/documents.js/commit/ad54d70b1d3bff39e3014f7774a2faf3f7ac0b73))
* **epub-codec:** add OCF container and OPF package parsing ([b1a8a82](https://github.com/ExaDev/documents.js/commit/b1a8a82e5c8721dcefdd2e6aa88be7b91edc33d6))
* **epub-codec:** add OCF ZIP container read/write ([0e078c7](https://github.com/ExaDev/documents.js/commit/0e078c7901f5dcd130055415d1d05553e87ce3c0))
* **epub-codec:** add three-tier read/write diagnostic policy ([30db0ac](https://github.com/ExaDev/documents.js/commit/30db0acaaac0c949ef059a1a69d138338a16baf2))
* **epub-codec:** add top-level readEpub(Content)/writeEpub(Content) ([6f15d29](https://github.com/ExaDev/documents.js/commit/6f15d295be0807c40435e53caf1822757ba71528))
* **epub-codec:** encode list marker type into the minted numId ([32e2924](https://github.com/ExaDev/documents.js/commit/32e2924cf74f9ad02d63373fcdb39b76658730b8))
* **epub-codec:** map XHTML content documents to ContentBlock[] ([e080e9a](https://github.com/ExaDev/documents.js/commit/e080e9a63bfec1bdbe8be1b73810021cf9a401bc))
* **epub-codec:** quarantine CSS as residue and close diagnostic gaps ([4994b8e](https://github.com/ExaDev/documents.js/commit/4994b8eb0b5645541f2ea9789eb7acd1e36ac607))
* **epub-codec:** scaffold new package ([416d176](https://github.com/ExaDev/documents.js/commit/416d176caa6bf3607f0f2c11f53465b7eb446ba8))
* **epub-codec:** write ContentBlock[] back to XHTML content documents ([152c305](https://github.com/ExaDev/documents.js/commit/152c305b416ad0a7e1cea2c9b1f1cac1a3b35af2))
* **epub-codec:** write the OPF package document ([872217c](https://github.com/ExaDev/documents.js/commit/872217c01191492a59c45e2da5009fabb6b36dd0))

### Bug Fixes

* **epub-codec:** drop whitespace-only phrasing content on read ([d1f521a](https://github.com/ExaDev/documents.js/commit/d1f521abddc85dc78b5cc5811eff59b49659843e))

### Documentation

* **epub-codec:** write the package README ([01224c5](https://github.com/ExaDev/documents.js/commit/01224c5da66696e2fbb0e310e4c64de0ad5fd83a)), references [ExaDev/documents.js#801](https://github.com/ExaDev/documents.js/issues/801)

### Tests

* **epub-codec:** add workerd and built-dist smoke test suites ([80eb9a2](https://github.com/ExaDev/documents.js/commit/80eb9a254709c76ba0ca5fed2e44fdf43d4a0c77))

### Miscellaneous Chores

* **deps:** bump document-schema.js to ^5.4.0 in epub-codec [skip ci] ([ef9886c](https://github.com/ExaDev/documents.js/commit/ef9886cf6d0c5029a7fb5a495ff595fda7d5bde7))


### Dependencies

- Updated document-schema.js to ^5.4.0
