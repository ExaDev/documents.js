## [3.5.2](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.5.1...wpd-codec%403.5.2) (2026-09-12)

### Bug Fixes

* **wpd-codec:** drop an unused IIFE return field that broke the workspace typecheck ([c7a813d](https://github.com/ExaDev/documents.js/commit/c7a813d6240a31004f3279f6600c93ecb2accb5d))
* **wpd-codec:** strip a table cell formula's own length-word framing ([c1a92e3](https://github.com/ExaDev/documents.js/commit/c1a92e39a719c3f15e5b0a5652db68261c9a1227))
* **wpd-codec:** type compoundFileWithStream's return as ArrayBuffer-backed ([273235e](https://github.com/ExaDev/documents.js/commit/273235e887654b1f8d598d89051e0bfcf57a1d78))
* **wpd-codec:** type genericHeaderBytes' return as ArrayBuffer-backed ([5d56ed2](https://github.com/ExaDev/documents.js/commit/5d56ed2d81d5c8fe9c2a0160027d2b2723050156))

### Code Refactoring

* **wpd-codec:** add UNBOUNDED_WORDS for ole.ts's unbounded word-string read ([cee0fcb](https://github.com/ExaDev/documents.js/commit/cee0fcb0c896178838abc11a66562d72501e5771))
* **wpd-codec:** close wpg.ts's remaining mutation gaps ([5d65c4d](https://github.com/ExaDev/documents.js/commit/5d65c4d8f03b55b12fc708bf02125280d64b3ea8))
* **wpd-codec:** compute documentAreaEnd's upper bound with Math.min ([52808ea](https://github.com/ExaDev/documents.js/commit/52808eab9f3d48272b1f9eb3cd95e052291765e0))
* **wpd-codec:** drop box.ts's redundant position-override room guards ([cdd2a11](https://github.com/ExaDev/documents.js/commit/cdd2a1192167235bd1a956369efa2d7219a7b022))
* **wpd-codec:** extract passwordByteAt with its own dedicated test ([9e445b4](https://github.com/ExaDev/documents.js/commit/9e445b47ce5befa99448512a884bb7abca236bb7))
* **wpd-codec:** make image.ts's signature scan throw on out-of-range reads ([52e647d](https://github.com/ExaDev/documents.js/commit/52e647d4896687839bd39340c08aca75c5dee740))
* **wpd-codec:** make the character-decode fallback a real assertion ([16f6c78](https://github.com/ExaDev/documents.js/commit/16f6c7888e3d5ef5c54ad0a095f287512457dd50))
* **wpd-codec:** rely on the read-time throw for style.ts's PID-count guard ([957d439](https://github.com/ExaDev/documents.js/commit/957d439d85e7ff03f0b694a3024e2bd3b18d583b))
* **wpd-codec:** rely on the read-time throw for summary.ts's group header guard ([8a983d8](https://github.com/ExaDev/documents.js/commit/8a983d8511906f184c6dea791c65029f2fbf9072))
* **wpd-codec:** remove equivalent-mutant boundary checks from image scanner ([7304b39](https://github.com/ExaDev/documents.js/commit/7304b39a0f0a90ab56ef2d8612ec29ccb9974e46))
* **wpd-codec:** remove equivalent-mutant boundary checks from wpg.ts ([6987413](https://github.com/ExaDev/documents.js/commit/698741337656b6b5a28108473977068ea141da8b))
* **wpd-codec:** remove equivalent-mutant patterns from compound-file fixture ([1b8594e](https://github.com/ExaDev/documents.js/commit/1b8594e6bc2aa42f8ac32f1c07b6e49e39655665))
* **wpd-codec:** remove equivalent-mutant patterns from formula.ts ([2b48ad0](https://github.com/ExaDev/documents.js/commit/2b48ad0f8ccfa7db7dca010305fa46ee8b89b845))
* **wpd-codec:** remove prefix.ts's redundant text-block and typeface guards ([c16e20a](https://github.com/ExaDev/documents.js/commit/c16e20a9b6ee6636726983e3269a0880f7de71ac))
* **wpd-codec:** remove three redundant final-case returns in read.ts ([ba7ba0e](https://github.com/ExaDev/documents.js/commit/ba7ba0e7c7d6b282571f48c521b4631e2158d141))
* **wpd-codec:** simplify pendingListLevel's guard and add depth-boundary tests ([6535640](https://github.com/ExaDev/documents.js/commit/6535640f5590e86997e597c50f3c9b15359836d5))
* **wpd-codec:** stop writing an unread name for compound-file.ts's root entry ([aeda8f2](https://github.com/ExaDev/documents.js/commit/aeda8f232e5abde29d0ddb0e91f84cd340848305))

### Styles

* **wpd-codec:** apply formatting to table.ts ([1eb6702](https://github.com/ExaDev/documents.js/commit/1eb67029d7edb875c753bdabac4045faa66d23b9))

### Tests

* **wpd-codec:** close a first batch of read.ts mutation gaps ([1fe7e66](https://github.com/ExaDev/documents.js/commit/1fe7e660f9841a13c563e692baa7179470aaf68c))
* **wpd-codec:** close box content-type and frame-resolution gaps ([ab3559a](https://github.com/ExaDev/documents.js/commit/ab3559a6ad9e2f8ad65555d881146d346f0b8722))
* **wpd-codec:** close font-size, colour, and character-group gaps ([3ecc02f](https://github.com/ExaDev/documents.js/commit/3ecc02ff588caabd2a66778a149f151255455743))
* **wpd-codec:** close mutation gaps in stream/box ([a87b6d5](https://github.com/ExaDev/documents.js/commit/a87b6d50a158cb16e63541d9444feeb5b49a0839))
* **wpd-codec:** close mutation gaps in stream/characters, ole, style, table, tokenise ([55fa74b](https://github.com/ExaDev/documents.js/commit/55fa74be17959d0bec2bc62ddc8a9d56cc99f88d))
* **wpd-codec:** close mutation gaps in the container package ([5f98dda](https://github.com/ExaDev/documents.js/commit/5f98ddaae2422eb00439a8a5da2bef6305bbc44a))
* **wpd-codec:** close note-marker, merge-field, and plainTextOf gaps ([afa6e31](https://github.com/ExaDev/documents.js/commit/afa6e31cd8de0a8d36bd8882176795a99c98b19c))
* **wpd-codec:** close read.ts style, table, page-geometry, and font gaps ([577f1bd](https://github.com/ExaDev/documents.js/commit/577f1bd680c7aee0a5d956258050534cd07cac7b))
* **wpd-codec:** close readWpd, summary, and table end-of-stream gaps ([6a36d30](https://github.com/ExaDev/documents.js/commit/6a36d306e3d267ae3f80d33a304f105916f05911))
* **wpd-codec:** close WPG box-embedding mutation gaps ([1c01be0](https://github.com/ExaDev/documents.js/commit/1c01be0982c8fbd9fe87cdd220677f4d6158e6b7))
* **wpd-codec:** confirm readWpd's tree section omits absent furniture keys ([dfd853a](https://github.com/ExaDev/documents.js/commit/dfd853a60fd42f9034ad67e2315403129f658f4f))
* **wpd-codec:** cover formula.ts's untested token codes and image.ts's JPEG scanner ([3ac6100](https://github.com/ExaDev/documents.js/commit/3ac6100eceaf41f48f83d8ff418a51be9e30699e))
* **wpd-codec:** cover previously untested leaf modules directly ([c7f66ef](https://github.com/ExaDev/documents.js/commit/c7f66ef9f220ce8c744c01cb2bef0a2291481b0c))
* **wpd-codec:** cover read.ts's attribute, note, style, and furniture gaps ([dbb984a](https://github.com/ExaDev/documents.js/commit/dbb984a526e39fffc5815849443a47985db83dec))
* **wpd-codec:** cover the beginning-of-file EOL mapping and five single-byte formatting functions ([155f44f](https://github.com/ExaDev/documents.js/commit/155f44fad729a2119806279b24fcbe4ce2cd3a94))
* **wpd-codec:** cover the box-embedded WPG graphic lift, previously untested ([24d0a95](https://github.com/ExaDev/documents.js/commit/24d0a95dd67d5e2f373138d4f8bb887bf3b8f92c))
* **wpd-codec:** cover wpg/formula/image boundary and dispatch branches ([89e71b4](https://github.com/ExaDev/documents.js/commit/89e71b4a2bec2eb3bf4e1abead322bb3dabd0aa3))
* **wpd-codec:** fix mutants that survived because frame requires both width and height ([0567b12](https://github.com/ExaDev/documents.js/commit/0567b12255217209f1d200bd9d07e51a347f290d))
* **wpd-codec:** mark proven-equivalent boundary mutants in image/compound-file ([65cafef](https://github.com/ExaDev/documents.js/commit/65cafefed5cdefadbe82f271d5d6f43380071664))
* **wpd-codec:** mark wpg.ts's characterization-boundary ties as equivalent ([e56d43b](https://github.com/ExaDev/documents.js/commit/e56d43b0c0e70bc2306626b9fc598b8241ddf029))
* **wpd-codec:** prove nearestPercentType's out-of-range throw is real ([5722e6e](https://github.com/ExaDev/documents.js/commit/5722e6e56ae7df7fe01221adc202ae57e44d8925))
* **wpd-codec:** prove the attribute-code gate against a live attribute ([e35fdfb](https://github.com/ExaDev/documents.js/commit/e35fdfb4cfcb963e341c42f8d6926c9b71003fe7))

## [3.5.1](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.5.0...wpd-codec%403.5.1) (2026-09-11)

### Code Refactoring

* load stryker.config.ts directly instead of a jiti .mjs bootstrap ([4221520](https://github.com/ExaDev/documents.js/commit/42215205caa1c8fc6368ed38729d15836bdd613b))


### Dependencies

- Updated document-schema.js to 7.11.1
- Updated archive-codec to 1.11.1

## [3.5.0](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.4.6...wpd-codec%403.5.0) (2026-09-11)

### Features

* **ci:** gate each measured package on its first CI mutation baseline ([9f8fa69](https://github.com/ExaDev/documents.js/commit/9f8fa6947795b2089bed03c936691893643ce2ae))
* **wpd-codec:** decode WPG vector graphics into the shared drawing vocabulary ([dd9c166](https://github.com/ExaDev/documents.js/commit/dd9c16658923e22c8333c2e59c903c1c62d9b172))
* **wpd-codec:** lift D6 watermarks into ContentSection.watermarks ([e84c7f0](https://github.com/ExaDev/documents.js/commit/e84c7f032f8c38bccc69d0199aca2f859d97d507))
* **wpd-codec:** recover native OLE object bytes as tree-form attachments ([f496ca1](https://github.com/ExaDev/documents.js/commit/f496ca15efdcf2b2ae455b62c4740dc209943731))

### Documentation

* **wpd-codec:** state the box-graphics scope this branch lands ([b573a52](https://github.com/ExaDev/documents.js/commit/b573a52687bbaab8beec197bbbdd0bf542c8c070))


### Dependencies

- Updated document-schema.js to 7.11.0
- Updated archive-codec to 1.11.0

## [3.4.6](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.4.5...wpd-codec%403.4.6) (2026-09-11)


### Dependencies

- Updated document-schema.js to 7.10.0
- Updated archive-codec to 1.10.8

## [3.4.5](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.4.4...wpd-codec%403.4.5) (2026-09-11)


### Dependencies

- Updated document-schema.js to 7.9.1
- Updated archive-codec to 1.10.7

## [3.4.4](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.4.3...wpd-codec%403.4.4) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.9.0
- Updated archive-codec to 1.10.6

## [3.4.3](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.4.2...wpd-codec%403.4.3) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.8.0
- Updated archive-codec to 1.10.5

## [3.4.2](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.4.1...wpd-codec%403.4.2) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.7.0
- Updated archive-codec to 1.10.4

## [3.4.1](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.4.0...wpd-codec%403.4.1) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.6.1
- Updated archive-codec to 1.10.3

## [3.4.0](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.3.0...wpd-codec%403.4.0) (2026-09-10)

### Features

* **wpd-codec:** lift image boxes carrying PNG or JPEG payloads ([79da2f3](https://github.com/ExaDev/documents.js/commit/79da2f37044137b11948aebff47f4fde1e8a4d32))
* **wpd-codec:** lift page furniture and note bodies ([42d133c](https://github.com/ExaDev/documents.js/commit/42d133c6df99de7ab87d9f05156b031b8f405ce7))


### Dependencies

- Updated document-schema.js to 7.6.0
- Updated archive-codec to 1.10.2

## [3.3.0](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.2.2...wpd-codec%403.3.0) (2026-09-09)

### Features

* **wpd-codec:** decrypt standard-mode encrypted documents with a password ([44a7d2e](https://github.com/ExaDev/documents.js/commit/44a7d2edda47c7248b84fe045c45660135e21f53))

## [3.2.2](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.2.1...wpd-codec%403.2.2) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.5.1
- Updated archive-codec to 1.10.1

## [3.2.1](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.2.0...wpd-codec%403.2.1) (2026-09-08)


### Dependencies

- Updated archive-codec to 1.10.0

## [3.2.0](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.1.1...wpd-codec%403.2.0) (2026-09-08)

### Features

* **wpd-codec:** decode a table cell's New Cell Formula into its own text ([3f7f544](https://github.com/ExaDev/documents.js/commit/3f7f544c6f2d6064a064bb660ce737bc7f2cbfe0))
* **wpd-codec:** fold style, merge field, formula, and box content into the read ([d1d347f](https://github.com/ExaDev/documents.js/commit/d1d347f0bb0026dc5c5116554a90686a06695593))
* **wpd-codec:** resolve a box's own content type, prefix ID, and frame ([b623b2c](https://github.com/ExaDev/documents.js/commit/b623b2c59a25c4d12fd28d82493f0ec6333c6f93))
* **wpd-codec:** resolve a style packet's own begin block ([721c162](https://github.com/ExaDev/documents.js/commit/721c1627d6b6fad3379eca59f9c130ce1614b531))

### Documentation

* **wpd-codec:** describe the lifted style, merge, formula, and box scope ([3e5d412](https://github.com/ExaDev/documents.js/commit/3e5d41251cd4cef6da2f784f6d8fcdc579abe9eb))


### Dependencies

- Updated document-schema.js to 7.5.0
- Updated archive-codec to 1.9.2

## [3.1.1](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.1.0...wpd-codec%403.1.1) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.4.0
- Updated archive-codec to 1.9.1

## [3.1.0](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.0.9...wpd-codec%403.1.0) (2026-09-08)

### Features

* **wpd-codec:** map WordPerfect character sets 1-14 to Unicode ([8d79f00](https://github.com/ExaDev/documents.js/commit/8d79f00a95f761d058c847f133547077da186d80))

### Documentation

* **wpd-codec:** document the closed character-set fidelity gap ([549c567](https://github.com/ExaDev/documents.js/commit/549c567781db0efa3023d7b41ee43a93f4759525))

## [3.0.9](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.0.8...wpd-codec%403.0.9) (2026-09-08)


### Dependencies

- Updated archive-codec to 1.9.0

## [3.0.8](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.0.7...wpd-codec%403.0.8) (2026-09-08)


### Dependencies

- Updated archive-codec to 1.8.0

## [3.0.7](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.0.6...wpd-codec%403.0.7) (2026-09-08)


### Dependencies

- Updated archive-codec to 1.7.2

## [3.0.6](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.0.5...wpd-codec%403.0.6) (2026-09-08)

### Bug Fixes

* **deps:** pin @vitest/coverage-v8 to match its vitest runner ([6912e0e](https://github.com/ExaDev/documents.js/commit/6912e0e5c602f0c21d9df12d2dc9899422bf5bd2))

### Miscellaneous Chores

* **deps:** pin every workspace dependency to an exact fixed version ([6a38142](https://github.com/ExaDev/documents.js/commit/6a38142facc043dfa499573f37431d3b32ff602e))


### Dependencies

- Updated document-schema.js to 7.3.1
- Updated archive-codec to 1.7.1

## [3.0.5](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.0.4...wpd-codec%403.0.5) (2026-09-08)


### Dependencies

- Updated archive-codec to ^1.7.0

## [3.0.4](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.0.3...wpd-codec%403.0.4) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.3.0
- Updated archive-codec to ^1.6.8

## [3.0.3](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.0.2...wpd-codec%403.0.3) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.2.0
- Updated archive-codec to ^1.6.7

## [3.0.2](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.0.1...wpd-codec%403.0.2) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.1.0
- Updated archive-codec to ^1.6.6

## [3.0.1](https://github.com/ExaDev/documents.js/compare/wpd-codec%403.0.0...wpd-codec%403.0.1) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.0.0
- Updated archive-codec to ^1.6.5

## [3.0.0](https://github.com/ExaDev/documents.js/compare/wpd-codec%402.1.5...wpd-codec%403.0.0) (2026-09-07)

### ⚠ BREAKING CHANGES

* **wpd-codec:** resolve partially-shaded cell fills to real pattern fills

### Features

* **wpd-codec:** resolve partially-shaded cell fills to real pattern fills ([ab0ad52](https://github.com/ExaDev/documents.js/commit/ab0ad52721d76e1ff7c17fe1500d051fc920909c))

## [2.1.5](https://github.com/ExaDev/documents.js/compare/wpd-codec%402.1.4...wpd-codec%402.1.5) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.3
- Updated archive-codec to ^1.6.4

## [2.1.4](https://github.com/ExaDev/documents.js/compare/wpd-codec%402.1.3...wpd-codec%402.1.4) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.2
- Updated archive-codec to ^1.6.3

## [2.1.3](https://github.com/ExaDev/documents.js/compare/wpd-codec%402.1.2...wpd-codec%402.1.3) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.1
- Updated archive-codec to ^1.6.2

## [2.1.2](https://github.com/ExaDev/documents.js/compare/wpd-codec%402.1.1...wpd-codec%402.1.2) (2026-09-06)


### Dependencies

- Updated document-schema.js to ^6.2.0
- Updated archive-codec to ^1.6.1

## [2.1.1](https://github.com/ExaDev/documents.js/compare/wpd-codec%402.1.0...wpd-codec%402.1.1) (2026-09-06)


### Dependencies

- Updated archive-codec to ^1.6.0

## [2.1.0](https://github.com/ExaDev/documents.js/compare/wpd-codec%402.0.0...wpd-codec%402.1.0) (2026-09-06)

### Features

* **workspace:** add per-package Stryker mutation testing configuration ([ff3eacc](https://github.com/ExaDev/documents.js/commit/ff3eacc124577b163a1c13a63b83484d9611ae5a))

### Bug Fixes

* **workspace:** drop the unused per-package @stryker-mutator/api dependency ([69270b6](https://github.com/ExaDev/documents.js/commit/69270b6e7ad7163c3b76cd085f4e5f367433994c))


### Dependencies

- Updated document-schema.js to ^6.1.0
- Updated archive-codec to ^1.5.0

## [2.0.0](https://github.com/ExaDev/documents.js/compare/wpd-codec%401.1.3...wpd-codec%402.0.0) (2026-09-06)

### ⚠ BREAKING CHANGES

* **wpd-codec:** readWpdContent's ContentTableCell.background is now a
  discriminated ContentCellFill rather than a bare Color, matching
  document-schema.js's own breaking change to the shared schema. A
  caller reading a background as a Color directly must switch on .kind
  and read .color for the 'solid' fill this reader always produces.

### Bug Fixes

* **wpd-codec:** adapt cell background to the new discriminated fill shape ([f3d17ae](https://github.com/ExaDev/documents.js/commit/f3d17aee3cd6c7af203372b70d372fd4ea474bf0)), references [ExaDev/documents.js#951](https://github.com/ExaDev/documents.js/issues/951)

### Build System

* typecheck test/workers across every package where it is currently clean ([f340428](https://github.com/ExaDev/documents.js/commit/f340428b51a669010c0c4e5edb4310fe6ea4789a)), closes [#1021](https://github.com/ExaDev/documents.js/issues/1021)


### Dependencies

- Updated document-schema.js to ^6.0.0
- Updated archive-codec to ^1.4.3

## [1.1.3](https://github.com/ExaDev/documents.js/compare/wpd-codec%401.1.2...wpd-codec%401.1.3) (2026-09-05)


### Dependencies

- Updated archive-codec to ^1.4.2

## [1.1.2](https://github.com/ExaDev/documents.js/compare/wpd-codec%401.1.1...wpd-codec%401.1.2) (2026-09-05)


### Dependencies

- Updated document-schema.js to ^5.6.0
- Updated archive-codec to ^1.4.1

## [1.1.1](https://github.com/ExaDev/documents.js/compare/wpd-codec%401.1.0...wpd-codec%401.1.1) (2026-09-04)


### Dependencies

- Updated document-schema.js to ^5.5.1
- Updated archive-codec to ^1.4.0

## [1.1.0](https://github.com/ExaDev/documents.js/compare/wpd-codec%401.0.2...wpd-codec%401.1.0) (2026-09-03)

### Features

* **wpd-codec:** decode the page, table, style, and summary structures ([ea82b66](https://github.com/ExaDev/documents.js/commit/ea82b66d99d5603d1360a0154fa0ee6545823277))
* **wpd-codec:** fold the document's own page, tables, headings, and metadata into the content ([f4b07e5](https://github.com/ExaDev/documents.js/commit/f4b07e596e712cbe1ee563781318a956ed4cfc1b))
* **wpd-codec:** read the Tab group, so columns of text stop running together ([b1c42f7](https://github.com/ExaDev/documents.js/commit/b1c42f793722aa3d001b2647c0a37c72287c8d7e))

### Documentation

* **wpd-codec:** record what a real WordPerfect corpus settles and what it does not ([8762fca](https://github.com/ExaDev/documents.js/commit/8762fca195ec3b8ceb20f8402af0d6e2121b1bae))
* **wpd-codec:** state what the reader now lifts and why each remaining gap is one ([e8909d4](https://github.com/ExaDev/documents.js/commit/e8909d4a9c61d898653109d51308105caf1ee0b3))

## [1.0.2](https://github.com/ExaDev/documents.js/compare/wpd-codec%401.0.1...wpd-codec%401.0.2) (2026-09-03)


### Dependencies

- Updated document-schema.js to ^5.5.0

## [1.0.1](https://github.com/ExaDev/documents.js/compare/wpd-codec%401.0.0...wpd-codec%401.0.1) (2026-09-03)


### Dependencies

- Updated archive-codec to ^1.3.0

## 1.0.0 (2026-09-03)

### Features

* **wpd-codec:** accept both the bare and OLE-wrapped containers ([a2f8b16](https://github.com/ExaDev/documents.js/commit/a2f8b16e5ede6d2dec7d27bfe38a19e50b1654ea))
* **wpd-codec:** decode the End-of-Line group and character attributes ([ce6454b](https://github.com/ExaDev/documents.js/commit/ce6454bbbbc9b8dc4f2b7b0e10c2ae0944cb45cc))
* **wpd-codec:** expose the public barrel, ContentCodec entry, and proof suites ([52609db](https://github.com/ExaDev/documents.js/commit/52609db4a7a33ec0138c491aadd94245de6023ba))
* **wpd-codec:** fold the token stream into a ContentDocument ([db0ff01](https://github.com/ExaDev/documents.js/commit/db0ff01b66e4f5b70bfcaedcc27a0bc6c1073226))
* **wpd-codec:** read the prefix index area and its packets ([4a03442](https://github.com/ExaDev/documents.js/commit/4a03442640f16a95175d08988fecf17bd77b79f4))
* **wpd-codec:** read the WordPerfect file header ([fd8d6e3](https://github.com/ExaDev/documents.js/commit/fd8d6e396d469f9ee54056949a933fdd10993fa8))
* **wpd-codec:** tokenise the document area's function-code stream ([9a883a9](https://github.com/ExaDev/documents.js/commit/9a883a91d1c1bf674f542e448b5516a9920e227c))

### Documentation

* **wpd-codec:** document the format, the sources, and the limits of the evidence ([cea938a](https://github.com/ExaDev/documents.js/commit/cea938a2d90819592545f4f741cf9cf8957b0603))

### Miscellaneous Chores

* **wpd-codec:** ignore build output and link the agent-facing README aliases ([0dc87ed](https://github.com/ExaDev/documents.js/commit/0dc87ede305863a571806c80204ff4790b175686))
* **wpd-codec:** scaffold the package's build, lint, and test configuration ([0712399](https://github.com/ExaDev/documents.js/commit/07123996b8f48dc7bcb8e3175f33d67c36403d8a))
