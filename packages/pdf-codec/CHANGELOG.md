## [5.2.17](https://github.com/ExaDev/documents.js/compare/pdf-codec%405.2.16...pdf-codec%405.2.17) (2026-09-24)

### Code Refactoring

* **pdf-codec:** let the real-nibble chain's final branch be an else ([8252fe7](https://github.com/ExaDev/documents.js/commit/8252fe76775e2a50fb0a3994873d98f5553b83fd)), references [#1306](https://github.com/ExaDev/documents.js/issues/1306)

### Tests

* **pdf-codec:** close cff.ts's mutation gap from 63 to 98 ([7e324b8](https://github.com/ExaDev/documents.js/commit/7e324b887386d739861a87c1b034908210ab89c2)), references [#1306](https://github.com/ExaDev/documents.js/issues/1306)

## [5.2.16](https://github.com/ExaDev/documents.js/compare/pdf-codec%405.2.15...pdf-codec%405.2.16) (2026-09-24)

### Tests

* **pdf-codec:** close write.ts's mutation gap from 85.8 to 98.3 ([a6969e9](https://github.com/ExaDev/documents.js/commit/a6969e9ed5c7d916968dcb62c4b9b6593e973518))

## [5.2.15](https://github.com/ExaDev/documents.js/compare/pdf-codec%405.2.14...pdf-codec%405.2.15) (2026-09-24)

### Code Refactoring

* **pdf-codec:** drop cff-bounds guards that duplicate what their callees already check ([986f17a](https://github.com/ExaDev/documents.js/commit/986f17aa827cc68be37549213957a9c8ed9a4e4b)), references [#1306](https://github.com/ExaDev/documents.js/issues/1306)

### Tests

* **pdf-codec:** close cff-bounds.ts's mutation gap from 83 to 93 ([cd1f5dc](https://github.com/ExaDev/documents.js/commit/cd1f5dc2bef90ad512f79f4f434995af9f6516e2)), references [#1306](https://github.com/ExaDev/documents.js/issues/1306)

## [5.2.14](https://github.com/ExaDev/documents.js/compare/pdf-codec%405.2.13...pdf-codec%405.2.14) (2026-09-23)

### Code Refactoring

* **pdf-codec:** remove equivalent-mutant shapes from the tier-2 packet decoder ([85865d8](https://github.com/ExaDev/documents.js/commit/85865d89e40b3ec9eff32827827757881f81deb9)), references [#1306](https://github.com/ExaDev/documents.js/issues/1306)

### Tests

* **pdf-codec:** close jpeg2000-t2.ts's mutation gap from 70 to 100 ([76e608f](https://github.com/ExaDev/documents.js/commit/76e608f42a8cf819118db9e161a4ab187b5882c8)), references [#1306](https://github.com/ExaDev/documents.js/issues/1306)

## [5.2.13](https://github.com/ExaDev/documents.js/compare/pdf-codec%405.2.12...pdf-codec%405.2.13) (2026-09-23)

### Tests

* **pdf-codec:** cover read.ts's header search, residue and keyword-parsing gaps ([a821fb6](https://github.com/ExaDev/documents.js/commit/a821fb6178a06bb4fddac41716bba8178306550e)), references [#1306](https://github.com/ExaDev/documents.js/issues/1306)

## [5.2.12](https://github.com/ExaDev/documents.js/compare/pdf-codec%405.2.11...pdf-codec%405.2.12) (2026-09-23)

### Tests

* **pdf-codec:** cover images-read.ts's colour-space, sample-unpacking and boundary gaps ([88efab1](https://github.com/ExaDev/documents.js/commit/88efab1c928203f184876cf74ea705a35546eeaa)), references [#1306](https://github.com/ExaDev/documents.js/issues/1306)

## [5.2.11](https://github.com/ExaDev/documents.js/compare/pdf-codec%405.2.10...pdf-codec%405.2.11) (2026-09-23)

### Tests

* **pdf-codec:** cover gsub-table.ts's malformed-table and glyph-skip gaps ([ca933b6](https://github.com/ExaDev/documents.js/commit/ca933b6bd78bec12c4a763404512a991e0a4bae5)), references [#1306](https://github.com/ExaDev/documents.js/issues/1306)

## [5.2.10](https://github.com/ExaDev/documents.js/compare/pdf-codec%405.2.9...pdf-codec%405.2.10) (2026-09-23)


### Dependencies

- Updated byte-codec to 1.10.1

## [5.2.9](https://github.com/ExaDev/documents.js/compare/pdf-codec%405.2.8...pdf-codec%405.2.9) (2026-09-23)

### Tests

* **pdf-codec:** cover interpret.ts's colour, marked-content and shape-boundary gaps ([30d5997](https://github.com/ExaDev/documents.js/commit/30d599794221fb7be6ff0d5d66fede088bde7968)), references [#1306](https://github.com/ExaDev/documents.js/issues/1306)

## [5.2.8](https://github.com/ExaDev/documents.js/compare/pdf-codec%405.2.7...pdf-codec%405.2.8) (2026-09-23)


### Dependencies

- Updated byte-codec to 1.10.0

## [5.2.7](https://github.com/ExaDev/documents.js/compare/pdf-codec%405.2.6...pdf-codec%405.2.7) (2026-09-23)


### Dependencies

- Updated byte-codec to 1.9.0

## [5.2.6](https://github.com/ExaDev/documents.js/compare/pdf-codec%405.2.5...pdf-codec%405.2.6) (2026-09-22)


### Dependencies

- Updated document-schema.js to 7.15.0

## [5.2.5](https://github.com/ExaDev/documents.js/compare/pdf-codec%405.2.4...pdf-codec%405.2.5) (2026-09-22)

### Bug Fixes

* **workspace:** replace the spaced double-hyphen dash substitute with a real em-dash workspace-wide ([c42a9c7](https://github.com/ExaDev/documents.js/commit/c42a9c7e0bc7cd87456ca72204a5ac423a7ca341))


### Dependencies

- Updated byte-codec to 1.8.1
- Updated document-schema.js to 7.14.1

## [5.2.4](https://github.com/ExaDev/documents.js/compare/pdf-codec%405.2.3...pdf-codec%405.2.4) (2026-09-21)


### Dependencies

- Updated byte-codec to 1.8.0
- Updated document-schema.js to 7.14.0

## [5.2.3](https://github.com/ExaDev/documents.js/compare/pdf-codec%405.2.2...pdf-codec%405.2.3) (2026-09-21)


### Dependencies

- Updated document-schema.js to 7.13.0

## [5.2.2](https://github.com/ExaDev/documents.js/compare/pdf-codec%405.2.1...pdf-codec%405.2.2) (2026-09-21)


### Dependencies

- Updated byte-codec to 1.7.0

## [5.2.1](https://github.com/ExaDev/documents.js/compare/pdf-codec%405.2.0...pdf-codec%405.2.1) (2026-09-21)


### Dependencies

- Updated document-schema.js to 7.12.0

## [5.2.0](https://github.com/ExaDev/documents.js/compare/pdf-codec%405.1.0...pdf-codec%405.2.0) (2026-09-20)

### Features

* **pdf-codec:** read vertical writing mode from a composite font's CMap ([1b6fd6b](https://github.com/ExaDev/documents.js/commit/1b6fd6be2db00b2fd035f0bccb48216e8790a603))

### Tests

* **pdf-codec:** check a vertical glyph's vector against an absolute position ([71ca7ee](https://github.com/ExaDev/documents.js/commit/71ca7eefc64b97ed97a2041c5b5fe5e9c7eff677))
* **pdf-codec:** measure a vertical run's advance rather than only its sign ([09d6684](https://github.com/ExaDev/documents.js/commit/09d66846ad1b19a9236d1034a5e17ca751de77b2))
* **pdf-codec:** pin a vertical glyph's own position vector and TJ axis ([9b03579](https://github.com/ExaDev/documents.js/commit/9b0357999678bfeb009d7653cdeca95f87f2f1c2))
* **pdf-codec:** pin a vertical glyph's position vector along both axes ([33d21bb](https://github.com/ExaDev/documents.js/commit/33d21bb0370275eb16afb392ae32402e16da4740))
* **pdf-codec:** pin the vertical metric parse and the CID-glyph identity ([3c14731](https://github.com/ExaDev/documents.js/commit/3c1473106dd0328b8469ee7d849e7e4d3aa3df2f))
* **pdf-codec:** tell a vertical column from a line that merely runs downward ([c5ec33b](https://github.com/ExaDev/documents.js/commit/c5ec33be2c061b66133c34b70294e1137ce670dc))

## [5.1.0](https://github.com/ExaDev/documents.js/compare/pdf-codec%405.0.1...pdf-codec%405.1.0) (2026-09-20)

### Features

* **pdf-codec:** group positioned text runs into lines and words ([d991845](https://github.com/ExaDev/documents.js/commit/d9918458c9aefeaf660c35fc306fb92dd861ec3d))

### Bug Fixes

* **documents.js:** take PDF baseline tolerance and word gaps from pdf-codec ([32ec324](https://github.com/ExaDev/documents.js/commit/32ec3246f7c1c9cc6d335507b77382f14e9bbbcd))

### Code Refactoring

* **pdf-codec:** derive line clustering from runsShareBaseline itself ([41fa96e](https://github.com/ExaDev/documents.js/commit/41fa96e696780e4fce25f9e2580d7dc40f0107ff))
* **pdf-codec:** drop the unreachable branches in text-run grouping ([0101116](https://github.com/ExaDev/documents.js/commit/0101116c3179dfbb5cee1647f57f027d2588d323))

### Documentation

* **pdf-codec:** document how text runs group into lines and words ([88c56aa](https://github.com/ExaDev/documents.js/commit/88c56aac8488fde1702b5cf571a6d94dd4d31cc0))

### Tests

* **pdf-codec:** group text runs recovered from a real written PDF ([e9b2257](https://github.com/ExaDev/documents.js/commit/e9b22570a12ae795e60fb932c44c7d4cfc78a594))
* **pdf-codec:** pin the baseline tolerance override and the anchor choice ([c10197c](https://github.com/ExaDev/documents.js/commit/c10197cfdf9cd718681857cb56a873dbb52b7fba))

## [5.0.1](https://github.com/ExaDev/documents.js/compare/pdf-codec%405.0.0...pdf-codec%405.0.1) (2026-09-20)

### Documentation

* make a hand-typed scoped mutation run find its package's Stryker config ([ed3297b](https://github.com/ExaDev/documents.js/commit/ed3297b6aa71b2d94913519e6960537ca5ac0f61))


### Dependencies

- Updated byte-codec to 1.6.3
- Updated document-schema.js to 7.11.5

## [5.0.0](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.8.17...pdf-codec%405.0.0) (2026-09-20)

### ⚠ BREAKING CHANGES

* **pdf-codec:** The pdf-codec/util/base64 deep import is removed.
  bytesToBase64 and base64ToBytes come from byte-codec now, and are
  still on this package's own barrel as well. The removal already
  shipped, unmarked, in 4.8.15.

### Documentation

* **pdf-codec:** state that base64 moved out of src/util ([22f352b](https://github.com/ExaDev/documents.js/commit/22f352b0e56ca07b5d3c63692fa3b8b894c2258d))


### Dependencies

- Updated byte-codec to 1.6.2

## [4.8.17](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.8.16...pdf-codec%404.8.17) (2026-09-20)

### Documentation

* **pdf-codec:** stop describing a base64 copy src/util/ no longer holds ([7ed643f](https://github.com/ExaDev/documents.js/commit/7ed643fb2bac56ac02ce86b380c3ffd12cfc63ce))

## [4.8.16](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.8.15...pdf-codec%404.8.16) (2026-09-20)

### Documentation

* **pdf-codec:** state the mutation threshold's method, not its measurement ([0e41539](https://github.com/ExaDev/documents.js/commit/0e41539cb528e69ff81ae1310042570bcc054224)), references [#1306](https://github.com/ExaDev/documents.js/issues/1306) [#1294](https://github.com/ExaDev/documents.js/issues/1294)


### Dependencies

- Updated byte-codec to 1.6.1

## [4.8.15](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.8.14...pdf-codec%404.8.15) (2026-09-20)

### Code Refactoring

* **pdf-codec:** encode and decode base64 through byte-codec ([03c9353](https://github.com/ExaDev/documents.js/commit/03c935326d354775c33f6d1365792dd0e842e602))

## [4.8.14](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.8.13...pdf-codec%404.8.14) (2026-09-20)


### Dependencies

- Updated document-schema.js to 7.11.4

## [4.8.13](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.8.12...pdf-codec%404.8.13) (2026-09-20)


### Dependencies

- Updated byte-codec to 1.6.0

## [4.8.12](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.8.11...pdf-codec%404.8.12) (2026-09-20)

### Bug Fixes

* **pdf-codec:** compute cffIndex's own offSize instead of hardcoding it to 1 ([6c9cd30](https://github.com/ExaDev/documents.js/commit/6c9cd309ac5216982ad81c492cb9c18649343037))
* **pdf-codec:** drop requiredRepeatCount's redundant empty-extenders guard ([04137e4](https://github.com/ExaDev/documents.js/commit/04137e4ad8a60deb8f48682cc00e60d21acc8020))
* **pdf-codec:** drop xmp's unreachable absent-capturing-group fallback ([2a28075](https://github.com/ExaDev/documents.js/commit/2a2807548342cbfb22c70eac0cf8f740d4a2ad77))
* **pdf-codec:** scope annotation subtype sets to readPageAnnotations and cover every branch ([fedcf29](https://github.com/ExaDev/documents.js/commit/fedcf29e6052d7a1b170f326ff9ebd8f1c9c8082))
* **pdf-codec:** scope font-style's subset-tag pattern and suffix list to their one caller ([d507b26](https://github.com/ExaDev/documents.js/commit/d507b2698bc4d2893cf7a23bce5e95eee5b7d639))
* **pdf-codec:** stop buildGsubTable racing a markFilteringSet write against its own subtable write ([84e7b66](https://github.com/ExaDev/documents.js/commit/84e7b66a25982e5772f94c64651ab00c2a50e694))

### Code Refactoring

* **pdf-codec:** build jp2-boxes' colour-space lookup inside the function that reads it ([bba666a](https://github.com/ExaDev/documents.js/commit/bba666abf405252e2347c8616ff0d6c1539c54fb))
* **pdf-codec:** build the 9-7 lifting constants inside inverse97Filter ([55a4a6a](https://github.com/ExaDev/documents.js/commit/55a4a6a57c7a84ed4719f4b3394dbf2029845449))
* **pdf-codec:** build the progression-order table inside readCodingDefaults ([90445eb](https://github.com/ExaDev/documents.js/commit/90445eb0675703c44e100edadf2595f9ffa38ee6))
* **pdf-codec:** drop inverseDwt53Level/97Level's own non-positive-dimension guard ([fee5ad4](https://github.com/ExaDev/documents.js/commit/fee5ad41c394b95fdb9f440cd5b4f26ef6eab0e5))
* **pdf-codec:** drop jp2-boxes guards that duplicate a later bounds check ([0c6ccc2](https://github.com/ExaDev/documents.js/commit/0c6ccc2e39f2a482797c52693e1b10df97f39dac))
* **pdf-codec:** drop mirrorIndex's redundant absolute-position round-trip ([dec2d9c](https://github.com/ExaDev/documents.js/commit/dec2d9c2ed02d2179f18ef5007dfdbfdd830718b))
* **pdf-codec:** drop trimTrailingEoc's own redundant length guard ([d8f0d03](https://github.com/ExaDev/documents.js/commit/d8f0d03c7bd96fec6e9b35d9157059752a5eab83))
* **pdf-codec:** drop widthForWidthsArray's dead zero-width branch ([02b794b](https://github.com/ExaDev/documents.js/commit/02b794b10bddf7f4d84fc6d365dfb9e84e8ec2ee))
* **pdf-codec:** expose interleave, mirrorIndex and synthesiseLine for testing ([1beb026](https://github.com/ExaDev/documents.js/commit/1beb026f2c2c09948f5b6dd80b4f087336af5169))
* **pdf-codec:** expose MarkerCursor and drop a redundant code-block-size check ([e473019](https://github.com/ExaDev/documents.js/commit/e47301954988a8f583edc4de930272ba2097a26e))
* **pdf-codec:** extract inverseDwt53Level/97Level's row loop into a testable primitive ([362b989](https://github.com/ExaDev/documents.js/commit/362b98915a29d9adf037aca9a34a7f5fe29e9331))

### Documentation

* **pdf-codec:** describe the unit timeout's real cost multiplier, not the old cipher cost ([dc931fe](https://github.com/ExaDev/documents.js/commit/dc931fe8f9ec91b4f7ae4dd71ef71d07daa998cb))

### Tests

* **pdf-codec:** add direct byte-level coverage for the MATH table parser ([1b1854e](https://github.com/ExaDev/documents.js/commit/1b1854efec145f1ea813b7973b4030d60a710be4))
* **pdf-codec:** add direct coverage for decodePdfString and parsePdfDate ([b53bb47](https://github.com/ExaDev/documents.js/commit/b53bb47c9bb2e133a7e38b2ffdf714f83d682113))
* **pdf-codec:** assert Jpeg2000ParseError/UnsupportedError carry their own name ([c427def](https://github.com/ExaDev/documents.js/commit/c427def7f0cde591c31c1f26b0dc8a5e54dadcdf))
* **pdf-codec:** assert randomBytes actually fills its buffer from the CSPRNG ([428c5bc](https://github.com/ExaDev/documents.js/commit/428c5bcd2a42017872b9efa70c174f5b258388e7))
* **pdf-codec:** cover a checkbox's own /V export-value derivation ([aa67372](https://github.com/ExaDev/documents.js/commit/aa673721b36f39a1aed7c58567f5a9560503e1d8))
* **pdf-codec:** cover CFF charset/encoding formats 1/2 and Type 1's PFB form ([b32c3cc](https://github.com/ExaDev/documents.js/commit/b32c3cccb789c6d679cf21bb6076e828e26ee239))
* **pdf-codec:** cover cffIndex's offSize boundaries and the two sfnt/CFF-table guards ([b3eadea](https://github.com/ExaDev/documents.js/commit/b3eadea2d6d79e19e41bea43c494e46fd2b19a5a))
* **pdf-codec:** cover decodeJpeg2000CodeBlock's unsupported code-block style rejection ([e1863f5](https://github.com/ExaDev/documents.js/commit/e1863f59bcee86d73bca078f518d59bfa30b1a2a))
* **pdf-codec:** cover endchar's own bare-width and width-plus-seac arities ([ad0dd02](https://github.com/ExaDev/documents.js/commit/ad0dd02ab6befc8b5798edd218342ffcdb6fce1d))
* **pdf-codec:** cover every internal-link destination view type ([51ba7b6](https://github.com/ExaDev/documents.js/commit/51ba7b69b8e44e10f827cde146d045740015c8dc))
* **pdf-codec:** cover every SEMANTIC_SUBTYPES entry in readPageAnnotations ([f35cdfc](https://github.com/ExaDev/documents.js/commit/f35cdfc97f1b4e4303b96b5d874e1917655fe01e))
* **pdf-codec:** cover every ToUnicode CMap error and boundary path ([f7d64d9](https://github.com/ExaDev/documents.js/commit/f7d64d951c45d7fb5a9557b94dca4d8f1d07a34d))
* **pdf-codec:** cover format 12 cmap subtables and the subtable-preference ranking ([449dc56](https://github.com/ExaDev/documents.js/commit/449dc5671884967355df80002b660d0c803268e5))
* **pdf-codec:** cover Info dict metadata, font flags, JPEG colour space, and embedded formulas ([a4b91f0](https://github.com/ExaDev/documents.js/commit/a4b91f0e580cd989fcc87ced8593a744462dce3e))
* **pdf-codec:** cover jpeg2000-codestream.ts's header-segment and cursor edge cases ([1e0406b](https://github.com/ExaDev/documents.js/commit/1e0406b2fd80c31671ac53b5eb06a9d80bea1d6c))
* **pdf-codec:** cover jpeg2000-codestream.ts's remaining header-segment boundaries ([d5ccf33](https://github.com/ExaDev/documents.js/commit/d5ccf3390cbbbf89ada788709b46152f3e75818b))
* **pdf-codec:** cover jpeg2000-dwt.ts's filter loop bounds and remaining edges ([1c22d88](https://github.com/ExaDev/documents.js/commit/1c22d8876a0056a2bbef81ed122cb4e4d0d46b07))
* **pdf-codec:** cover jpeg2000-dwt.ts's zero-size, boundary and index-arithmetic cases ([e972163](https://github.com/ExaDev/documents.js/commit/e9721630e4de2d73599c8fb52dbb70c66c443b1d))
* **pdf-codec:** cover loadMathFont's broken-parse guards ([d00b467](https://github.com/ExaDev/documents.js/commit/d00b467898974c758c9ee9b00beca272ab52be7f))
* **pdf-codec:** cover outline dict keys, attachment Desc, and AcroForm /FT and /Ff ([a182218](https://github.com/ExaDev/documents.js/commit/a182218907d22b15fbfdb89eee8b674cee3091d1))
* **pdf-codec:** cover parseFormat4's header and segment-count guards ([0185d5b](https://github.com/ExaDev/documents.js/commit/0185d5b72b97491f4622c0be4852988bfbcd2a15))
* **pdf-codec:** cover readOptionalContent's unresolved-OCG and layer-naming gaps ([ee58651](https://github.com/ExaDev/documents.js/commit/ee58651346d962de46bb4ba36d0b4548aa852f34))
* **pdf-codec:** cover remaining jpeg2000-codestream.ts header-segment cases ([3c9322e](https://github.com/ExaDev/documents.js/commit/3c9322ed1c3c3b755b4da0d114df4ab15af8cb69))
* **pdf-codec:** cover rmoveto/hmoveto/vmoveto width-shift and cubic-axis extrema ([f905dc7](https://github.com/ExaDev/documents.js/commit/f905dc79758fc487fbb1a16bc9f221e2afa6b5d8))
* **pdf-codec:** cover SCALED_COMPONENT_OFFSET applied to a component's own placement offset ([0befe4b](https://github.com/ExaDev/documents.js/commit/0befe4b4fce8d903d3cd6808b757665880aa2db0))
* **pdf-codec:** cover structure element dict keys and the /Lang attribute ([93e7126](https://github.com/ExaDev/documents.js/commit/93e7126be40b1d90107d97191f51f98f6295028b))
* **pdf-codec:** cover times() directly and pin inverse97Filter's F-12/F-13 boundaries ([b9520b4](https://github.com/ExaDev/documents.js/commit/b9520b4b7177b1c4e6f413b03c3c88e44c17b212))
* **pdf-codec:** draw after each interpreter-limit boundary to make success observable ([475affa](https://github.com/ExaDev/documents.js/commit/475affa4ca082c990eeaca61e0e99ad03f490083))
* **pdf-codec:** drive cff-bounds's interpreter through its untested operators ([84929f6](https://github.com/ExaDev/documents.js/commit/84929f6959ea946023853a37b4f94a26c5bad07f))
* **pdf-codec:** exercise widthOfCode's missing-AFM-width guard directly ([664110d](https://github.com/ExaDev/documents.js/commit/664110d0d0126419b89fb0b33d0c247b9b3c491a))
* **pdf-codec:** gate the package on its measured mutation score ([1ae1cd4](https://github.com/ExaDev/documents.js/commit/1ae1cd4aeeb50e618f82320d770403a517789999))
* **pdf-codec:** key the vendored-face cache by its own base64 constant ([e0954c7](https://github.com/ExaDev/documents.js/commit/e0954c71db1f5b7d26affb6dc0f9acdc1dfe9b03))
* **pdf-codec:** kill jp2-boxes.ts mutants left over from the JPEG 2000 decoder ([5477af1](https://github.com/ExaDev/documents.js/commit/5477af1439e781b365dc5159393e6f4d584219e1))
* **pdf-codec:** pin decodeUtf16BEString's odd-length trailing-byte boundary ([4ea6d07](https://github.com/ExaDev/documents.js/commit/4ea6d079fa9b94b140ffe2c444ae8dec7d01e425))
* **pdf-codec:** pin dict-key names, sort order, and empty-collection boundaries ([38e9e3a](https://github.com/ExaDev/documents.js/commit/38e9e3a961a98dbefecc01d0d8bb7fa6e0cff254))
* **pdf-codec:** pin flushWord's no-op guard for a whitespace-only run ([dd467dd](https://github.com/ExaDev/documents.js/commit/dd467ddb0913cd4160122958b1c34690d4c5625d))
* **pdf-codec:** pin passthrough image headers and destination-lookup-by-name ([5be8f05](https://github.com/ExaDev/documents.js/commit/5be8f058a0b96e2f843e0014ab8747229beadfd6))
* **pdf-codec:** pin readChunks' exact end-of-file chunk-header boundary ([14f9864](https://github.com/ExaDev/documents.js/commit/14f9864e0cc797bb0cd93a56e02c869b68e264b7))
* **pdf-codec:** pin subrBias's switch from the small to the medium bias ([2bfe027](https://github.com/ExaDev/documents.js/commit/2bfe027c5f4cb5cc68974bb555e144861d168276))
* **pdf-codec:** pin SUBSET_TAG_PATTERN's anchor and exact letter count ([a5ae2c7](https://github.com/ExaDev/documents.js/commit/a5ae2c7033071c3bedc173b7a88af37b773161c5))
* **pdf-codec:** pin widthOfCode's short-circuit for a monospace face ([7d86c8e](https://github.com/ExaDev/documents.js/commit/7d86c8eafcbcdbbefdb6de9d9da73a07e3544f1a))
* **pdf-codec:** update mirrorIndex/synthesiseLine tests for the offset-from-i0 signature ([5487580](https://github.com/ExaDev/documents.js/commit/54875805207a98279c45a6c4d7cd350fd6b92ff0))
* **pdf-codec:** verify assemblePdf's own byte structure directly ([e667048](https://github.com/ExaDev/documents.js/commit/e66704884caea536ba9f6847e8f3fb8d041be0a6))

## [4.8.11](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.8.10...pdf-codec%404.8.11) (2026-09-20)

### Bug Fixes

* **pdf-codec:** cover formatNumber's epsilon guard and escapeName's boundaries ([ecacab1](https://github.com/ExaDev/documents.js/commit/ecacab1a2eb0e9efeee438a429d6434162bf8411))
* **pdf-codec:** remove probeCff's redundant empty-Name-INDEX check ([3f860f8](https://github.com/ExaDev/documents.js/commit/3f860f87f65706b84ece100ee741ca9aef351ba4))

### Code Refactoring

* **pdf-codec:** build jpeg2000FixtureSamples' planes by length-mapping ([f81e995](https://github.com/ExaDev/documents.js/commit/f81e995d9a8363b7f621ce6253a719f587f69f54))
* **pdf-codec:** build rc4's initial state array by index-mapping ([b56640e](https://github.com/ExaDev/documents.js/commit/b56640ec6684a31f72e3583eec053626bde8e863))
* **pdf-codec:** build utf16BeWithBom's bytes by appending, not by computed offset ([52dd361](https://github.com/ExaDev/documents.js/commit/52dd3618786073c49a93653208a5db5ec07137f3))
* **pdf-codec:** compare parities directly in the checker8 fixture ([0f71a60](https://github.com/ExaDev/documents.js/commit/0f71a608569bc03575ce468ab37e62508f5ef941))
* **pdf-codec:** dedupe pdf.ts fixture builder's boilerplate literals ([131767a](https://github.com/ExaDev/documents.js/commit/131767a71f72d3158f579350d0c1f253930a4ae4))
* **pdf-codec:** drive rc4's keystream loop from data.forEach ([4861fe9](https://github.com/ExaDev/documents.js/commit/4861fe9191db63c74f331975bc5372e96a370554))
* **pdf-codec:** drop dead outline-face fields and a redundant length guard ([c05510f](https://github.com/ExaDev/documents.js/commit/c05510fd022410611afeff29c4b1e14d85a622a1))
* **pdf-codec:** drop padBigEndian's unreachable early-exit guard ([a9f2db4](https://github.com/ExaDev/documents.js/commit/a9f2db4513089e9281bb8a154e5225994122e39c))
* **pdf-codec:** eliminate sha256's round-expansion length equivalent mutant ([a357123](https://github.com/ExaDev/documents.js/commit/a357123562caa8aa534b992113eea5a564f27c3e))
* **pdf-codec:** eliminate two more redundant bounds guards ([18157e3](https://github.com/ExaDev/documents.js/commit/18157e36a6016684a50dde7bad862888110c01b3))
* **pdf-codec:** extract drawGlyphOutline for direct coverage of its own empty-subpaths branch ([7dbeecc](https://github.com/ExaDev/documents.js/commit/7dbeecc1e41015a56e9b59a99bf99214e06074f2))
* **pdf-codec:** narrow applyEncryptMethod off the unused identity method ([f3dab75](https://github.com/ExaDev/documents.js/commit/f3dab75a8bd39635aa14713b00cce7c2886ae803))
* **pdf-codec:** remove drawTextRun's dead glyphAdvance fallback ([3befa86](https://github.com/ExaDev/documents.js/commit/3befa86523c62b43d27c67b55eb42eed0051b765))
* **pdf-codec:** remove drawTextRun's redundant empty-contours check ([05cdcc1](https://github.com/ExaDev/documents.js/commit/05cdcc1c0386c63886befa389e82c7e137fef75b))
* **pdf-codec:** remove escapeName's dead whole-name safety check ([163cd0b](https://github.com/ExaDev/documents.js/commit/163cd0b727de489e8cae2fd3662688b85c2430a3))
* **pdf-codec:** remove formatNumber's unreachable -0 normalisation ([8e26233](https://github.com/ExaDev/documents.js/commit/8e2623323cbc70762e5d3fa122650704f0f4e511))
* **pdf-codec:** remove glyphOutlineSubpaths' redundant segment-count guard ([a1518e1](https://github.com/ExaDev/documents.js/commit/a1518e1a2b342737774afa846cbafb9d8ef89d32))
* **pdf-codec:** remove sfnt fixture builder's equivalent-mutant surface ([1e2af23](https://github.com/ExaDev/documents.js/commit/1e2af2326ffcccda98f1ce6d3860282cf00ddb92))
* **pdf-codec:** remove sha256's fixed-size-array equivalent mutants ([99f5e41](https://github.com/ExaDev/documents.js/commit/99f5e41147ed16823286754c93f714da177b7660))
* **pdf-codec:** remove the unreachable duplicate-name check in the /Dests dictionary loop ([95813be](https://github.com/ExaDev/documents.js/commit/95813be7726c5d7df4c3b507d4de370592227f34))
* **pdf-codec:** stop computing an unread MediaBox width/height for the rotation matrix ([4727b77](https://github.com/ExaDev/documents.js/commit/4727b77785b0067e42da798c9e7adc261cf121ce))
* **pdf-codec:** stop writing object 0's xref-stream row as a literal ([bdc55a2](https://github.com/ExaDev/documents.js/commit/bdc55a2fd43509e757c81e1b85f256a39185cc71))

### Tests

* **pdf-codec:** add a dedicated suite for parseHmtx ([cf12f67](https://github.com/ExaDev/documents.js/commit/cf12f671345447250c8d107f7809f3f2e84150cb))
* **pdf-codec:** add a dedicated suite for readXmpMetadata ([f7ea7aa](https://github.com/ExaDev/documents.js/commit/f7ea7aa28141e513aeaa8f516dfe63e8ce89becc))
* **pdf-codec:** add a direct test file for jbig2-generic.ts ([50abfe4](https://github.com/ExaDev/documents.js/commit/50abfe4d2b230fb32a33742eec2693e95d9bf54f))
* **pdf-codec:** align the too-small-headerSize fixture's own byte offsets ([a2f5d5d](https://github.com/ExaDev/documents.js/commit/a2f5d5db4107c23d8cfb16b0f714919bc249ed27))
* **pdf-codec:** assert every MATH constant field metricsAt exposes ([4cec514](https://github.com/ExaDev/documents.js/commit/4cec514c8c63f674f95cac01d6ea1fe05d806606))
* **pdf-codec:** assert the raw XMP residue matches byte-for-byte ([e72a6fb](https://github.com/ExaDev/documents.js/commit/e72a6fb45e433ae04c0c078857b014177f9de063))
* **pdf-codec:** assert throwIfAborted's DOMException name and message ([93b386b](https://github.com/ExaDev/documents.js/commit/93b386b7accf181bab306868150b2203c18df1c2))
* **pdf-codec:** close pdf.ts fixture-consumer gaps around vacuous negatives ([374ca5c](https://github.com/ExaDev/documents.js/commit/374ca5c385c04eb54f984e75519d5e0a02a79231))
* **pdf-codec:** close renderPdfPage's own boundary and geometry gaps ([be7b83a](https://github.com/ExaDev/documents.js/commit/be7b83a59ba08f94e72e1fca7a1640a555d84ba3))
* **pdf-codec:** close sfnt.ts's remaining coverage and equivalent-mutant gaps ([f3737a4](https://github.com/ExaDev/documents.js/commit/f3737a4250d33ca5062a94f8c229ce0260bad518))
* **pdf-codec:** cover buildSimpleFont/buildCompositeFont's BaseFont fallback ([d7d7b06](https://github.com/ExaDev/documents.js/commit/d7d7b06398cb8383f1909cdac2b5d554bbff4c54))
* **pdf-codec:** cover CIDToGIDMap's own trailing-unpaired-byte bound ([027701f](https://github.com/ExaDev/documents.js/commit/027701f4c42da41483f1c30f3d2f55243827d670))
* **pdf-codec:** cover computeFlags' FLAG_ITALIC bit ([f364845](https://github.com/ExaDev/documents.js/commit/f364845a70ba90b541e7f6c8294059b54e07bf89))
* **pdf-codec:** cover deflate's level option and inflate's size guard ([afde8d2](https://github.com/ExaDev/documents.js/commit/afde8d2ecbdf44fdbd65bc474775752d16283fef))
* **pdf-codec:** cover embedded-font-write's serif flag, subset tag arithmetic, and dict keys ([f6016cd](https://github.com/ExaDev/documents.js/commit/f6016cd0e2ec9c9d79f4d36649d846c27fc9be74))
* **pdf-codec:** cover encodeCcittFax's degenerate-geometry guard ([954ac33](https://github.com/ExaDev/documents.js/commit/954ac336c261ade25261f2844da5a32dab7ca0ee))
* **pdf-codec:** cover flattenCubic's max-distance and exact-tolerance boundaries ([3d35bde](https://github.com/ExaDev/documents.js/commit/3d35bdeb1f6c7f06ff1e047b4c6b21e95d69721e))
* **pdf-codec:** cover math-font-write's descriptor scaling, W array, and ToUnicode filtering ([0931722](https://github.com/ExaDev/documents.js/commit/093172247f7d9674b50fdfd041d2b9e0d33c1af5))
* **pdf-codec:** cover parseDestination's view types and the outline cycle guard ([e4bf177](https://github.com/ExaDev/documents.js/commit/e4bf17763f91311699125e61b296c0a379192250))
* **pdf-codec:** cover renderPdfPage's Type0/CIDFontType2 font-refusal branches ([f015bb6](https://github.com/ExaDev/documents.js/commit/f015bb668dd4ce8019769f75843bf127c068d7a5))
* **pdf-codec:** cover the empty-glyph skip, unstated descendant subtype, and header search window ([4c55431](https://github.com/ExaDev/documents.js/commit/4c55431b671f96150be0523d2945d85722af09f9))
* **pdf-codec:** cover the stroke branch of drawRect, drawEllipse, and drawPath ([9e8e1c8](https://github.com/ExaDev/documents.js/commit/9e8e1c8c3900ec759d104f013e3f91d7c3dd6637))
* **pdf-codec:** cover writeDoublePath's fill rule and zero-bisector case ([54744ec](https://github.com/ExaDev/documents.js/commit/54744ec6eeab5587cc27b794808b9ebd00a62a77))
* **pdf-codec:** cover writeFormulaContentStream's glyph-run, rule, and stroke items ([a0652a8](https://github.com/ExaDev/documents.js/commit/a0652a837ff378809951bb110b1a7db4db75275c))
* **pdf-codec:** distinguish isTrueTypeCollection's own two guards ([00602f4](https://github.com/ExaDev/documents.js/commit/00602f4cc569ef4c9cc14f5c40d6bff42503d6fe))
* **pdf-codec:** drive cff-bounds.ts's charstring interpreter with hand-built programs ([599b864](https://github.com/ExaDev/documents.js/commit/599b86459f4dac526af73d1ec186b3088313177d))
* **pdf-codec:** drive glyf-contours.ts's simple-glyph decoding with a fake GlyfTable ([26b4405](https://github.com/ExaDev/documents.js/commit/26b4405ee47456cfe3e9f45334af4a2c104f033f))
* **pdf-codec:** pick characters that actually distinguish math-content-write's byte packing ([8f32f8b](https://github.com/ExaDev/documents.js/commit/8f32f8b624ca6b4f297e279c73513291694be4a0))
* **pdf-codec:** pin drawPath's own dotted-stroke width scaling ([7b0e37a](https://github.com/ExaDev/documents.js/commit/7b0e37ad6a559b5529da14623f2409247aebb484))
* **pdf-codec:** pin equalCropBoxPdf's own declared CropBox bytes ([535bc6c](https://github.com/ExaDev/documents.js/commit/535bc6c33d13943fe453e451766940ec1c90621f))
* **pdf-codec:** pin FixtureBuilder's own byte-level mechanics directly ([d1dafe8](https://github.com/ExaDev/documents.js/commit/d1dafe8f891628a0ccb8d155775fa290a6cf0624))
* **pdf-codec:** pin flattenCubic's own subdivision arithmetic directly ([696614f](https://github.com/ExaDev/documents.js/commit/696614f88bbcd0e144906deaa60ad1cf5d0c78d6))
* **pdf-codec:** pin glyphOutlineSubpaths' contour walk directly ([4a7a52f](https://github.com/ExaDev/documents.js/commit/4a7a52fa438fd50f2010cc4b9d2f823b8b0d7abc))
* **pdf-codec:** pin header()'s default version and the first xref revision's own byte layout ([2503491](https://github.com/ExaDev/documents.js/commit/25034912dcaa9f54c9cfca790091dc396eae5d84))
* **pdf-codec:** pin parentTreeMissingEntryPdf's own struct element ([5685ede](https://github.com/ExaDev/documents.js/commit/5685edec9ecc43e746c06ac543808188cff7deb8))
* **pdf-codec:** pin renderPdfPage's abort checks, clip boundaries, and error codes ([7221cf3](https://github.com/ExaDev/documents.js/commit/7221cf3ce6a983b8c18571f02eb68087632346fd))
* **pdf-codec:** pin sfnt.ts fixture builders' own byte layout directly ([dd048d7](https://github.com/ExaDev/documents.js/commit/dd048d79d06380cffdbbb143fb1959f23eacb23b))
* **pdf-codec:** pin taggedFormPdf's struct elements and both fixtures' raw MCID spans ([c8137f3](https://github.com/ExaDev/documents.js/commit/c8137f3b5b789b8c4677a51bb9398eea36fd7369))
* **pdf-codec:** pin the /Contents array's own inter-chunk separator byte ([9663a12](https://github.com/ExaDev/documents.js/commit/9663a12c88a29ece32d24f073e4d81c0428bdd9a))
* **pdf-codec:** pin the dedup annotation's own parse and the manifest stream's bytes ([ede9b93](https://github.com/ExaDev/documents.js/commit/ede9b93d63fc9274c272b979614ac71847457a89))
* **pdf-codec:** pin the outline-refusal diagnostic's own face-name fallback ([3a834f5](https://github.com/ExaDev/documents.js/commit/3a834f515eba1a1286cf1b615a6b7a8c9f1361fa))
* **pdf-codec:** raise the unit suite's test timeout to absorb shared-machine contention ([0dbe1a0](https://github.com/ExaDev/documents.js/commit/0dbe1a0e4a0a60581edba960df64782d8d2b9add))
* **pdf-codec:** read a pageless document on the unaborted path ([4ccbca2](https://github.com/ExaDev/documents.js/commit/4ccbca28adaac56e0851313ea7b8328706cf78b8))
* **pdf-codec:** read the metadata fixture's own page alongside its metadata ([763b5cb](https://github.com/ExaDev/documents.js/commit/763b5cb3225b51f27fa9286b73b584da3cd66954))
* **pdf-codec:** refuse a font whose hhea declares zero horizontal metrics ([dba9eeb](https://github.com/ExaDev/documents.js/commit/dba9eebd79e581cb57611f8cf432eb5014119a26))
* **pdf-codec:** reject a non-1 major version whose body parses cleanly ([5d31080](https://github.com/ExaDev/documents.js/commit/5d31080d18793f66d5c4c8f90f0d79f43325f2b7))
* **pdf-codec:** round-trip a form array through LayoutDocumentSchema ([3e3b2a8](https://github.com/ExaDev/documents.js/commit/3e3b2a89a4da92b0771b434d6c1fc11d6bcffe6a))
* **pdf-codec:** serialize Stryker's own worker processes to one at a time ([b5e1a21](https://github.com/ExaDev/documents.js/commit/b5e1a218b8bd201e4c5e1d50ffde7226d3b48465))
* **pdf-codec:** share the write-side PDF fixture and assert CIDSystemInfo fields ([2611922](https://github.com/ExaDev/documents.js/commit/26119221801b662d9dfdc85bcab38c032d61e40e))
* **pdf-codec:** warn on a filespec whose /EF has no /F or /UF stream ([d25d929](https://github.com/ExaDev/documents.js/commit/d25d9295dfd6d8f0d38147076f871468a5fb1aa4))

## [4.8.10](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.8.9...pdf-codec%404.8.10) (2026-09-20)


### Dependencies

- Updated byte-codec to 1.5.8

## [4.8.9](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.8.8...pdf-codec%404.8.9) (2026-09-20)


### Dependencies

- Updated byte-codec to 1.5.7

## [4.8.8](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.8.7...pdf-codec%404.8.8) (2026-09-20)


### Dependencies

- Updated byte-codec to 1.5.6

## [4.8.7](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.8.6...pdf-codec%404.8.7) (2026-09-19)

### Performance Improvements

* **pdf-codec:** compute SHA-384 and SHA-512 on pairs of 32-bit words, not BigInt ([d3eadb7](https://github.com/ExaDev/documents.js/commit/d3eadb73a7f90d2de2c8647081af2f4d15904152))

### Code Refactoring

* **pdf-codec:** mask BigInt values with BigInt.asUintN instead of a mask constant ([137f5f0](https://github.com/ExaDev/documents.js/commit/137f5f01abe777818a12db57b8a85d090260f45c))

### Tests

* **pdf-codec:** check SHA-384 and SHA-512 against a BigInt reference and Node's hashes ([e1aa944](https://github.com/ExaDev/documents.js/commit/e1aa94460b1585c459fa8365b40619a0d8cfbfd1))

## [4.8.6](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.8.5...pdf-codec%404.8.6) (2026-09-19)

### Performance Improvements

* **pdf-codec:** run AES rounds from lookup tables instead of per-byte field arithmetic ([facc6ca](https://github.com/ExaDev/documents.js/commit/facc6caf40115effb7436ff03401d5b9a3065200))

### Tests

* **pdf-codec:** check AES-CBC against Node's crypto and an independent reference ([cb4aab0](https://github.com/ExaDev/documents.js/commit/cb4aab0ad4fa7106915f261ce7794d10a7eea153))
* **pdf-codec:** keep the AES differential tests inside the default timeout ([90b355e](https://github.com/ExaDev/documents.js/commit/90b355e2afb25c435fa903744d3b868c3603d313))

## [4.8.5](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.8.4...pdf-codec%404.8.5) (2026-09-14)

### Miscellaneous Chores

* bump pinned pnpm to 12.4.1 across the workspace ([4e81c2d](https://github.com/ExaDev/documents.js/commit/4e81c2dfdb08fff226c20a0f267baffa87758e0f))
* **lint:** except each package's own measured eslint-config 2.12.1 debt ([11c35bc](https://github.com/ExaDev/documents.js/commit/11c35bc61db74c68b4be725c34452509fba00c2a))


### Dependencies

- Updated byte-codec to 1.5.5
- Updated document-schema.js to 7.11.3

## [4.8.4](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.8.3...pdf-codec%404.8.4) (2026-09-13)


### Dependencies

- Updated byte-codec to 1.5.4

## [4.8.3](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.8.2...pdf-codec%404.8.3) (2026-09-13)


### Dependencies

- Updated byte-codec to 1.5.3
- Updated document-schema.js to 7.11.2

## [4.8.2](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.8.1...pdf-codec%404.8.2) (2026-09-12)


### Dependencies

- Updated byte-codec to 1.5.2

## [4.8.1](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.8.0...pdf-codec%404.8.1) (2026-09-11)

### Code Refactoring

* load stryker.config.ts directly instead of a jiti .mjs bootstrap ([4221520](https://github.com/ExaDev/documents.js/commit/42215205caa1c8fc6368ed38729d15836bdd613b))


### Dependencies

- Updated byte-codec to 1.5.1
- Updated document-schema.js to 7.11.1

## [4.8.0](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.7.0...pdf-codec%404.8.0) (2026-09-11)

### Features

* **pdf-codec:** define a PageRasteriser port and renderPdfPage over the read machinery ([847d8a8](https://github.com/ExaDev/documents.js/commit/847d8a8fcf60226901e495b2a7afcf6f4619d4c0))

## [4.7.0](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.6.0...pdf-codec%404.7.0) (2026-09-11)

### Features

* **pdf-codec:** re-embed a source's own JBIG2/JPX streams verbatim ([fc540d1](https://github.com/ExaDev/documents.js/commit/fc540d10ac64ea8331892fe61061287d42e8e3c1))

### Bug Fixes

* **pdf-codec:** budget the mutation dry run for the instrumented STIX test ([2c1dc98](https://github.com/ExaDev/documents.js/commit/2c1dc98cc7655778a2f9f018e7ea7682e9d3681e))


### Dependencies

- Updated byte-codec to 1.5.0
- Updated document-schema.js to 7.11.0

## [4.6.0](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.5.6...pdf-codec%404.6.0) (2026-09-11)

### Features

* **pdf-codec:** apply calt and clig through GSUB contextual lookups over GDEF glyph classes ([aa547b7](https://github.com/ExaDev/documents.js/commit/aa547b796f1cee00000cae6b5d56b5496776e8dd))
* **pdf-codec:** list each form-field widget in its page's /Annots array ([a6e96a9](https://github.com/ExaDev/documents.js/commit/a6e96a92ab5cfe1752ee50ce9b4de6419f8ffd46))


### Dependencies

- Updated document-schema.js to 7.10.0

## [4.5.6](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.5.5...pdf-codec%404.5.6) (2026-09-11)


### Dependencies

- Updated document-schema.js to 7.9.1

## [4.5.5](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.5.4...pdf-codec%404.5.5) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.9.0

## [4.5.4](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.5.3...pdf-codec%404.5.4) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.8.0

## [4.5.3](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.5.2...pdf-codec%404.5.3) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.7.0

## [4.5.2](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.5.1...pdf-codec%404.5.2) (2026-09-10)

### Documentation

* state the npm aliases as registered and republishing ([8bb4de8](https://github.com/ExaDev/documents.js/commit/8bb4de80a954b7dc728776a761cf63a344eb6f71))


### Dependencies

- Updated byte-codec to 1.4.2
- Updated document-schema.js to 7.6.1

## [4.5.1](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.5.0...pdf-codec%404.5.1) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.6.0

## [4.5.0](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.4.0...pdf-codec%404.5.0) (2026-09-10)

### Features

* **pdf-codec:** re-encode bilevel images as CCITT Group 4 on write ([a713d56](https://github.com/ExaDev/documents.js/commit/a713d56f7f7b546293e21f6a4e11ca6b0c585fe4))

### Bug Fixes

* **pdf-codec:** bound the g4 candidate against the flate size it competes with ([bc1a862](https://github.com/ExaDev/documents.js/commit/bc1a862955ba41c45a58d1b847b90a122bd07961))

## [4.4.0](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.3.0...pdf-codec%404.4.0) (2026-09-09)

### Features

* **pdf-codec:** write the document-level surfaces the reader extracts ([2a2ac6b](https://github.com/ExaDev/documents.js/commit/2a2ac6b91036bb1508bbc28ae995eb352c6e7fe2))

### Bug Fixes

* **pdf-codec:** never restore the source /OpenAction row on rewrite ([d2c4de4](https://github.com/ExaDev/documents.js/commit/d2c4de4e4213e909c0117a50ed5ae6df42869281))

## [4.3.0](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.2.0...pdf-codec%404.3.0) (2026-09-09)

### Features

* **pdf-codec:** apply GSUB default ligatures when shaping embedded text ([573eb45](https://github.com/ExaDev/documents.js/commit/573eb45a4758b72c444b236645d13a6a950d37e7)), closes [ExaDev/documents.js#960](https://github.com/ExaDev/documents.js/issues/960)

## [4.2.0](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.1.0...pdf-codec%404.2.0) (2026-09-09)

### Features

* **pdf-codec:** write embedded-file attachments through a Names tree ([5bb4a4f](https://github.com/ExaDev/documents.js/commit/5bb4a4f90356c107109e2b5a385f2334eb584b8a))
* **pdf-codec:** write the outline through an /Outlines tree ([8480758](https://github.com/ExaDev/documents.js/commit/8480758b7898308c413d8332918b6fb24b59caea))

## [4.1.0](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.0.13...pdf-codec%404.1.0) (2026-09-08)

### Features

* **pdf-codec:** add a portable CSPRNG helper for encryption salts and IVs ([f46aae7](https://github.com/ExaDev/documents.js/commit/f46aae71eb2d0ce3e08e5a3d09d0474893fe5d76))
* **pdf-codec:** implement standard security handler encryption for writePdf ([d924ccb](https://github.com/ExaDev/documents.js/commit/d924ccbf240603f636d2bcb659940ae07e889523))
* **pdf-codec:** wire an encryption option into writePdf ([707ac20](https://github.com/ExaDev/documents.js/commit/707ac2022f570ebec1cb68c895708aa0db4e93fd))

### Code Refactoring

* **pdf-codec:** export the standard security handler's shared primitives ([4ffd976](https://github.com/ExaDev/documents.js/commit/4ffd9760de12f600bcffd7b506ba82429def36db))

### Documentation

* **pdf-codec:** document writePdf's encryption option ([fe96807](https://github.com/ExaDev/documents.js/commit/fe968076ece2765e5c14bee56ce7d4d2ae386318))

### Tests

* **pdf-codec:** give the hardened-KDF write tests a 60s timeout ([94fe722](https://github.com/ExaDev/documents.js/commit/94fe722fbdcc3038499d4287f9060da39703e390))

## [4.0.13](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.0.12...pdf-codec%404.0.13) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.5.1

## [4.0.12](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.0.11...pdf-codec%404.0.12) (2026-09-08)

### Bug Fixes

* **pdf-codec:** recover dashed and dotted stroke styles from the d operator ([735063f](https://github.com/ExaDev/documents.js/commit/735063fb59de402842c9ec21d435d5179512d74f))

### Documentation

* **pdf-codec:** correct the Gotchas claim that stroke style never reads back ([39498e0](https://github.com/ExaDev/documents.js/commit/39498e0d59f0593b3bf864179de81b1955402b56))

### Tests

* **pdf-codec:** cover dash-array stroke-style recovery ([e861b88](https://github.com/ExaDev/documents.js/commit/e861b88bf4dc29ee935aacfacd82e6d30e19ee95))

## [4.0.11](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.0.10...pdf-codec%404.0.11) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.5.0

## [4.0.10](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.0.9...pdf-codec%404.0.10) (2026-09-08)

### Documentation

* **pdf-codec:** note document-outline.js as a LayoutPage consumer ([aa73489](https://github.com/ExaDev/documents.js/commit/aa73489c59ebb30114c3ffce2452953ac27f0382))


### Dependencies

- Updated document-schema.js to 7.4.0

## [4.0.9](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.0.8...pdf-codec%404.0.9) (2026-09-08)

### Bug Fixes

* **deps:** pin @vitest/coverage-v8 to match its vitest runner ([6912e0e](https://github.com/ExaDev/documents.js/commit/6912e0e5c602f0c21d9df12d2dc9899422bf5bd2))

### Miscellaneous Chores

* **deps:** pin every workspace dependency to an exact fixed version ([6a38142](https://github.com/ExaDev/documents.js/commit/6a38142facc043dfa499573f37431d3b32ff602e))


### Dependencies

- Updated byte-codec to 1.4.1
- Updated document-schema.js to 7.3.1

## [4.0.8](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.0.7...pdf-codec%404.0.8) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.3.0

## [4.0.7](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.0.6...pdf-codec%404.0.7) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.2.0

## [4.0.6](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.0.5...pdf-codec%404.0.6) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.1.0

## [4.0.5](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.0.4...pdf-codec%404.0.5) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.0.0

## [4.0.4](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.0.3...pdf-codec%404.0.4) (2026-09-07)

### Bug Fixes

* **workspace:** narrow discriminated unions and Uint8Array generics in worker tests ([54e92fa](https://github.com/ExaDev/documents.js/commit/54e92fad8aabe767b3f8a33423de819468fb1b54))


### Dependencies

- Updated document-schema.js to ^6.2.3

## [4.0.3](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.0.2...pdf-codec%404.0.3) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.2

## [4.0.2](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.0.1...pdf-codec%404.0.2) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.1

## [4.0.1](https://github.com/ExaDev/documents.js/compare/pdf-codec%404.0.0...pdf-codec%404.0.1) (2026-09-06)


### Dependencies

- Updated document-schema.js to ^6.2.0

## [4.0.0](https://github.com/ExaDev/documents.js/compare/pdf-codec%403.7.0...pdf-codec%404.0.0) (2026-09-06)

### ⚠ BREAKING CHANGES

* **pdf-codec:** the pdf-codec/image/png-encode subpath no longer
  exists. Import encodePng (and PngEncodeOptions) from byte-codec
  directly, or from pdf-codec's own root export, which already re-exports
  the same function.

### Bug Fixes

* **pdf-codec:** bound the JPXDecode read path's own dimensions before encodePng ([5e98a1f](https://github.com/ExaDev/documents.js/commit/5e98a1f5e9f2bb3af1b6c9a61b267f234560d7ac))
* **pdf-codec:** mirror encodePng's dimension and pixel-count ceilings ([6b2655a](https://github.com/ExaDev/documents.js/commit/6b2655a85bbd3c2ae6e68ffeaa3fb12c9ef967f0))
* **pdf-codec:** re-encode extracted images through byte-codec's own encodePng ([955b139](https://github.com/ExaDev/documents.js/commit/955b13992721c328a0a10f3ec61354f5deba00d5))
* **pdf-codec:** reject a fractional or NaN image /Width or /Height ([2cb8104](https://github.com/ExaDev/documents.js/commit/2cb8104a3205b4392a00beb4a88b678583c0b6a3))
* **pdf-codec:** reject an oversized JPXDecode canvas before decodeJpeg2000 allocates it ([7b6ebfc](https://github.com/ExaDev/documents.js/commit/7b6ebfc527e121dd5ad55819018ced31a199f843))

### Code Refactoring

* **pdf-codec:** remove its own duplicate PNG encoder in favour of byte-codec's ([dfe053d](https://github.com/ExaDev/documents.js/commit/dfe053d1907063d8afe850316d02e12c9943737c))


### Dependencies

- Updated byte-codec to ^1.4.0

## [3.7.0](https://github.com/ExaDev/documents.js/compare/pdf-codec%403.6.6...pdf-codec%403.7.0) (2026-09-06)

### Features

* **workspace:** add per-package Stryker mutation testing configuration ([ff3eacc](https://github.com/ExaDev/documents.js/commit/ff3eacc124577b163a1c13a63b83484d9611ae5a))

### Bug Fixes

* **workspace:** drop the unused per-package @stryker-mutator/api dependency ([69270b6](https://github.com/ExaDev/documents.js/commit/69270b6e7ad7163c3b76cd085f4e5f367433994c))


### Dependencies

- Updated byte-codec to ^1.3.0
- Updated document-schema.js to ^6.1.0

## [3.6.6](https://github.com/ExaDev/documents.js/compare/pdf-codec%403.6.5...pdf-codec%403.6.6) (2026-09-06)

### Tests

* **pdf-codec:** raise CI-flaky timeouts with real headroom over observed worst case ([d5742bb](https://github.com/ExaDev/documents.js/commit/d5742bbaf310e8b8c20af9d56bb18692e490d73d)), references [ExaDev/documents.js#1002](https://github.com/ExaDev/documents.js/issues/1002)

### Build System

* drop document-schema.js and pdf-codec from the test/workers typecheck fix ([6eb3f27](https://github.com/ExaDev/documents.js/commit/6eb3f2785e006481677cb73f6b802c5fd4bc3f53)), closes [#1021](https://github.com/ExaDev/documents.js/issues/1021), references [#1021](https://github.com/ExaDev/documents.js/issues/1021)
* typecheck test/workers across every package where it is currently clean ([f340428](https://github.com/ExaDev/documents.js/commit/f340428b51a669010c0c4e5edb4310fe6ea4789a)), closes [#1021](https://github.com/ExaDev/documents.js/issues/1021)


### Dependencies

- Updated byte-codec to ^1.2.2
- Updated document-schema.js to ^6.0.0

## [3.6.5](https://github.com/ExaDev/documents.js/compare/pdf-codec%403.6.4...pdf-codec%403.6.5) (2026-09-05)


### Dependencies

- Updated byte-codec to ^1.2.1

## [3.6.4](https://github.com/ExaDev/documents.js/compare/pdf-codec%403.6.3...pdf-codec%403.6.4) (2026-09-05)


### Dependencies

- Updated document-schema.js to ^5.6.0

## [3.6.3](https://github.com/ExaDev/documents.js/compare/pdf-codec%403.6.2...pdf-codec%403.6.3) (2026-09-04)


### Dependencies

- Updated document-schema.js to ^5.5.1

## [3.6.2](https://github.com/ExaDev/documents.js/compare/pdf-codec%403.6.1...pdf-codec%403.6.2) (2026-09-03)


### Dependencies

- Updated document-schema.js to ^5.5.0

## [3.6.1](https://github.com/ExaDev/documents.js/compare/pdf-codec%403.6.0...pdf-codec%403.6.1) (2026-09-03)

### Tests

* **pdf-codec:** cover BT's identity reset and a full readPdf pass for [#851](https://github.com/ExaDev/documents.js/issues/851) ([380d38d](https://github.com/ExaDev/documents.js/commit/380d38d92a078c9829ce99b4a8483289f3086d73))

## [3.6.0](https://github.com/ExaDev/documents.js/compare/pdf-codec%403.5.4...pdf-codec%403.6.0) (2026-09-03)

### Features

* **pdf-codec:** add the MacRoman and Standard encoding tables ([c41b3f9](https://github.com/ExaDev/documents.js/commit/c41b3f95f74bf45aab1133a98d5f085442d95cba))
* **pdf-codec:** expose every cmap subtable, and read format 0 ([656ffd2](https://github.com/ExaDev/documents.js/commit/656ffd22850542e6b1aff007f95f5c1811dce16f))
* **pdf-codec:** read a font's built-in encoding from its embedded program ([5a7ee19](https://github.com/ExaDev/documents.js/commit/5a7ee199742a474a20d7ef472cd1171b88652e73))
* **pdf-codec:** read glyph names out of a font's post table ([291070b](https://github.com/ExaDev/documents.js/commit/291070b38ab7157f0de4f5cadd023a5c9daffae1))
* **pdf-codec:** resolve a CFF SID to the glyph name it stands for ([5ad15ab](https://github.com/ExaDev/documents.js/commit/5ad15ab035f8ac04248dc6f9e79dda18730ee6e1))

### Bug Fixes

* **pdf-codec:** decode a glyph through the font's own built-in encoding ([844e185](https://github.com/ExaDev/documents.js/commit/844e1851654adc7bae2ce115087f4f894094e955)), closes [#834](https://github.com/ExaDev/documents.js/issues/834)
* **pdf-codec:** hold the text state parameters in the graphics state ([7efccd7](https://github.com/ExaDev/documents.js/commit/7efccd7cfd9b0da9d0e2cc75ed5a8ece9e2a3206))
* **pdf-codec:** keep the selected font across a BT with no Tf of its own ([0fd14da](https://github.com/ExaDev/documents.js/commit/0fd14da54211401fabe61017527d22df75d82042)), closes [#851](https://github.com/ExaDev/documents.js/issues/851)

### Performance Improvements

* **pdf-codec:** open an embedded font program only when a code needs it ([0245330](https://github.com/ExaDev/documents.js/commit/0245330e03f0de59b5a9ed89123ceb1297467b39))

## [3.5.4](https://github.com/ExaDev/documents.js/compare/pdf-codec%403.5.3...pdf-codec%403.5.4) (2026-09-02)

### Miscellaneous Chores

* **deps:** bump document-schema.js to ^5.4.0 in pdf-codec [skip ci] ([b1641cd](https://github.com/ExaDev/documents.js/commit/b1641cd3b42bb9c87387c29d22c4a4c7cf3326b8))


### Dependencies

- Updated document-schema.js to ^5.4.0

## [3.5.3](https://github.com/ExaDev/documents.js/compare/pdf-codec%403.5.2...pdf-codec%403.5.3) (2026-09-02)

### Miscellaneous Chores

* **deps:** bump document-schema.js to ^5.3.0 in pdf-codec [skip ci] ([212b078](https://github.com/ExaDev/documents.js/commit/212b07819c2c34997c2905c0eb5246ef41b72ee7))


### Dependencies

- Updated document-schema.js to ^5.3.0

## [3.5.2](https://github.com/ExaDev/documents.js/compare/pdf-codec%403.5.1...pdf-codec%403.5.2) (2026-09-02)

### Bug Fixes

* **pdf-codec:** stop guessing WinAnsi glyphs for symbolic simple fonts ([dabebe1](https://github.com/ExaDev/documents.js/commit/dabebe18022226a9a11536a0b0955d853b9e2465))

## [3.5.1](https://github.com/ExaDev/documents.js/compare/pdf-codec%403.5.0...pdf-codec%403.5.1) (2026-09-02)

### Miscellaneous Chores

* **deps:** bump document-schema.js to ^5.2.0 in pdf-codec [skip ci] ([67fb2fe](https://github.com/ExaDev/documents.js/commit/67fb2fecf9cad3796a3db5e52388dd5e893b909b))


### Dependencies

- Updated document-schema.js to ^5.2.0

## [3.5.0](https://github.com/ExaDev/documents.js/compare/pdf-codec%403.4.4...pdf-codec%403.5.0) (2026-08-24)

### Features

* **eslint:** enable strictTypeChecked across the workspace ([67eec04](https://github.com/ExaDev/documents.js/commit/67eec04a380b25142f5d1afd11cb9906ff2cfd5f))
* **eslint:** lint JSON, Markdown, and YAML alongside the TypeScript ([016b127](https://github.com/ExaDev/documents.js/commit/016b127119733c50aa7694bad6265e9bc26bb215))
* **prettier:** enforce formatting through eslint-plugin-prettier ([8c878dd](https://github.com/ExaDev/documents.js/commit/8c878ddd2eb6b3bdd42ac9eee61f10ae4f45b3aa))

### Code Refactoring

* clear what strictTypeChecked's non-deviated rules found ([92a9fc9](https://github.com/ExaDev/documents.js/commit/92a9fc98f76244fca3a42ff0a12312ab0ce1a79b))
* **eslint:** move the seven preset-using packages onto the shared config ([f91e3a5](https://github.com/ExaDev/documents.js/commit/f91e3a5d8708424963f10ebb7f2db07a11b5ff45))
* **tsconfig:** share the strict compiler options through one base config ([43af382](https://github.com/ExaDev/documents.js/commit/43af382f726d7d42754ac0b6bf6d91b0ae302e25))

### Styles

* format the workspace with prettier ([56c3a1d](https://github.com/ExaDev/documents.js/commit/56c3a1dd1b0f05fbeccfc9b5e8b1d27ca97486b4))

### Miscellaneous Chores

* **deps:** bump byte-codec to ^1.2.0 in pdf-codec [skip ci] ([feea6ed](https://github.com/ExaDev/documents.js/commit/feea6ede655524b89045e3e631d3c64b8ecc8d12))
* **deps:** bump document-schema.js to ^5.1.0 in pdf-codec [skip ci] ([b588b3c](https://github.com/ExaDev/documents.js/commit/b588b3cc2c22844e40d681d6c7551ef63fe65b1d))
* **deps:** drop the dependencies each package no longer uses ([80094aa](https://github.com/ExaDev/documents.js/commit/80094aa6db412392ef6e6457014d5963a5e910a7))


### Dependencies

- Updated document-schema.js to ^5.1.0
- Updated byte-codec to ^1.2.0

## [3.4.4](https://github.com/ExaDev/documents.js/compare/pdf-codec@3.4.3...pdf-codec@3.4.4) (2026-08-23)


### Dependencies

- Updated document-schema.js to ^5.0.0

## [3.4.3](https://github.com/ExaDev/documents.js/compare/pdf-codec@3.4.2...pdf-codec@3.4.3) (2026-08-23)

## [3.4.2](https://github.com/ExaDev/documents.js/compare/pdf-codec@3.4.1...pdf-codec@3.4.2) (2026-08-23)


### Dependencies

- Updated document-schema.js to ^4.10.0

## [3.4.1](https://github.com/ExaDev/documents.js/compare/pdf-codec@3.4.0...pdf-codec@3.4.1) (2026-08-23)


### Dependencies

- Updated document-schema.js to ^4.9.1

# [3.4.0](https://github.com/ExaDev/documents.js/compare/pdf-codec@3.3.1...pdf-codec@3.4.0) (2026-08-22)


### Bug Fixes

* **pdf:** carry an enclosing page MCID into form XObject content that numbers none of its own ([5593550](https://github.com/ExaDev/documents.js/commit/55935508f1c3e2bbd9cf1e0f158d116b5325a617))
* **pdf:** key marked-content ownership by each page's /StructParents, not its index ([8c2c773](https://github.com/ExaDev/documents.js/commit/8c2c77314891f2c2e12d354c2894305794438ad9))


### Features

* **pdf:** read the tagged-PDF structure tree and its marked-content ownership ([a558c07](https://github.com/ExaDev/documents.js/commit/a558c07b543cb3ebe49331140b82d59658ee5875))

## [3.3.1](https://github.com/ExaDev/documents.js/compare/pdf-codec@3.3.0...pdf-codec@3.3.1) (2026-08-22)


### Dependencies

- Updated document-schema.js to ^4.9.0

# [3.3.0](https://github.com/ExaDev/documents.js/compare/pdf-codec@3.2.0...pdf-codec@3.3.0) (2026-08-21)


### Features

* **pdf:** read the crop box as the visible page region ([2f444b5](https://github.com/ExaDev/documents.js/commit/2f444b5b75f04477c14010684123b4dcdcd509a3)), closes [#759](https://github.com/ExaDev/documents.js/issues/759)

# [3.2.0](https://github.com/ExaDev/documents.js/compare/pdf-codec@3.1.4...pdf-codec@3.2.0) (2026-08-21)


### Bug Fixes

* **pdf:** realign the read-entry smoke surface with the pdf-text split ([72a8b2e](https://github.com/ExaDev/documents.js/commit/72a8b2e266e5c23d1da54321f58046425952776c))


### Features

* **pdf:** read document language, mirror XMP Dublin Core, and quarantine package-level residue rows ([26b9f14](https://github.com/ExaDev/documents.js/commit/26b9f14edbaf48d7ed978bcfed7e294ac448ee1d))
* **pdf:** read embedded files from the name tree, file attachments, and /AF ([531b27c](https://github.com/ExaDev/documents.js/commit/531b27c1a1a58e62672b8b47c8fab67ca8c3ad56))
* **pdf:** read named destinations, the outline tree, and internal link annotations ([6c837bd](https://github.com/ExaDev/documents.js/commit/6c837bd1949fba55ceca2e71c3e004376b69d0ae)), closes [#721](https://github.com/ExaDev/documents.js/issues/721)
* **pdf:** read optional-content groups and stamp /OC membership on extracted items ([b4f3e71](https://github.com/ExaDev/documents.js/commit/b4f3e713e575d1f9bf5e13bb9e0626ab9ae5b475))
* **pdf:** read page annotations — sticky notes, FreeText, markup, and residue for the opaque kinds ([ce91db2](https://github.com/ExaDev/documents.js/commit/ce91db22aa1371dab9decdc1b7c55731868a9bf8))
* **pdf:** read the AcroForm field tree with types, values, flags, and widget placements ([1d2c0ec](https://github.com/ExaDev/documents.js/commit/1d2c0eca00afc58881ce8d810aad75c39d119547))


### Dependencies

- Updated document-schema.js to ^4.8.0

## [3.1.4](https://github.com/ExaDev/documents.js/compare/pdf-codec@3.1.3...pdf-codec@3.1.4) (2026-08-21)


### Dependencies

- Updated document-schema.js to ^4.7.0

## [3.1.3](https://github.com/ExaDev/documents.js/compare/pdf-codec@3.1.2...pdf-codec@3.1.3) (2026-08-21)


### Dependencies

- Updated document-schema.js to ^4.6.0

## [3.1.2](https://github.com/ExaDev/documents.js/compare/pdf-codec@3.1.1...pdf-codec@3.1.2) (2026-08-21)


### Bug Fixes

* **read:** honour an aborted signal before the document-open phase runs ([f8ee39c](https://github.com/ExaDev/documents.js/commit/f8ee39cfb895ae123dab2a5c190fd60559f2c6ae))

## [3.1.1](https://github.com/ExaDev/documents.js/compare/pdf-codec@3.1.0...pdf-codec@3.1.1) (2026-08-21)


### Dependencies

- Updated document-schema.js to ^4.5.0

# [3.1.0](https://github.com/ExaDev/documents.js/compare/pdf-codec@3.0.12...pdf-codec@3.1.0) (2026-08-20)


### Bug Fixes

* stop the pdf read pipeline statically importing the write path ([a178c97](https://github.com/ExaDev/documents.js/commit/a178c97d09ed20537f9dfb44a8d9832f004f9ef0))


### Features

* declare pdf-codec/read as the read-only entry point ([6a1b029](https://github.com/ExaDev/documents.js/commit/6a1b029d388eb88688bff7bae8526fb847bc511f))

## [3.0.12](https://github.com/ExaDev/documents.js/compare/pdf-codec@3.0.11...pdf-codec@3.0.12) (2026-08-20)


### Dependencies

- Updated document-schema.js to ^4.3.7
- Updated byte-codec to ^1.1.13

## [3.0.11](https://github.com/ExaDev/documents.js/compare/pdf-codec@3.0.10...pdf-codec@3.0.11) (2026-08-20)


### Dependencies

- Updated document-schema.js to ^4.3.6
- Updated byte-codec to ^1.1.12

## [3.0.10](https://github.com/ExaDev/documents.js/compare/pdf-codec@3.0.9...pdf-codec@3.0.10) (2026-08-20)


### Bug Fixes

* point package homepage and bugs URLs at the monorepo, not the old standalone repos ([1b605e8](https://github.com/ExaDev/documents.js/commit/1b605e846393f417001227758a8606347c04e219))


### Dependencies

- Updated document-schema.js to ^4.3.5
- Updated byte-codec to ^1.1.11

## [3.0.9](https://github.com/ExaDev/documents.js/compare/pdf-codec@3.0.8...pdf-codec@3.0.9) (2026-08-20)


### Dependencies

- Updated document-schema.js to ^4.3.4

## [3.0.4](https://github.com/ExaDev/pdf-codec/compare/v3.0.3...v3.0.4) (2026-08-19)

## [3.0.3](https://github.com/ExaDev/pdf-codec/compare/v3.0.2...v3.0.3) (2026-08-19)

## [3.0.2](https://github.com/ExaDev/pdf-codec/compare/v3.0.1...v3.0.2) (2026-08-18)

## [3.0.1](https://github.com/ExaDev/pdf-codec/compare/v3.0.0...v3.0.1) (2026-08-18)

# [3.0.0](https://github.com/ExaDev/pdf-codec/compare/v2.2.36...v3.0.0) (2026-08-18)


* feat!: own the Layout item family in src/layout.ts ([2193d71](https://github.com/ExaDev/pdf-codec/commit/2193d71dd3bdeb31e7471d53465feaa9e80693e9))


### BREAKING CHANGES

* the Layout item family (LayoutDocument, LayoutItem,
every item/page/image-asset schema and type, LAYOUT_FORMAT_VERSION)
is no longer exported by document-schema.js and now lives in
pdf-codec; import the same names from pdf-codec. This requires
document-schema.js ^4.0.0, whose own major also reshaped
ContentDocument and DocumentPackage.

## [2.2.36](https://github.com/ExaDev/pdf-codec/compare/v2.2.35...v2.2.36) (2026-08-17)

## [2.2.35](https://github.com/ExaDev/pdf-codec/compare/v2.2.34...v2.2.35) (2026-08-17)

## [2.2.34](https://github.com/ExaDev/pdf-codec/compare/v2.2.33...v2.2.34) (2026-08-17)

## [2.2.33](https://github.com/ExaDev/pdf-codec/compare/v2.2.32...v2.2.33) (2026-08-17)

## [2.2.32](https://github.com/ExaDev/pdf-codec/compare/v2.2.31...v2.2.32) (2026-08-17)

## [2.2.31](https://github.com/ExaDev/pdf-codec/compare/v2.2.30...v2.2.31) (2026-08-17)

## [2.2.30](https://github.com/ExaDev/pdf-codec/compare/v2.2.29...v2.2.30) (2026-08-17)

## [2.2.29](https://github.com/ExaDev/pdf-codec/compare/v2.2.28...v2.2.29) (2026-08-17)

## [2.2.28](https://github.com/ExaDev/pdf-codec/compare/v2.2.27...v2.2.28) (2026-08-17)

## [2.2.27](https://github.com/ExaDev/pdf-codec/compare/v2.2.26...v2.2.27) (2026-08-17)

## [2.2.26](https://github.com/ExaDev/pdf-codec/compare/v2.2.25...v2.2.26) (2026-08-13)

## [2.2.25](https://github.com/ExaDev/pdf-codec/compare/v2.2.24...v2.2.25) (2026-08-13)

## [2.2.24](https://github.com/ExaDev/pdf-codec/compare/v2.2.23...v2.2.24) (2026-08-13)

## [2.2.23](https://github.com/ExaDev/pdf-codec/compare/v2.2.22...v2.2.23) (2026-08-12)

## [2.2.22](https://github.com/ExaDev/pdf-codec/compare/v2.2.21...v2.2.22) (2026-08-12)

## [2.2.21](https://github.com/ExaDev/pdf-codec/compare/v2.2.20...v2.2.21) (2026-08-12)

## [2.2.20](https://github.com/ExaDev/pdf-codec/compare/v2.2.19...v2.2.20) (2026-08-12)

## [2.2.19](https://github.com/ExaDev/pdf-codec/compare/v2.2.18...v2.2.19) (2026-08-12)

## [2.2.18](https://github.com/ExaDev/pdf-codec/compare/v2.2.17...v2.2.18) (2026-08-12)

## [2.2.17](https://github.com/ExaDev/pdf-codec/compare/v2.2.16...v2.2.17) (2026-08-12)


### Bug Fixes

* **commitlint:** exempt dependabot commits from body-max-line-length ([d0b1474](https://github.com/ExaDev/pdf-codec/commit/d0b1474ba2c39c5995ce646925f59402a0462765))

## [2.2.16](https://github.com/ExaDev/pdf-codec/compare/v2.2.15...v2.2.16) (2026-08-12)

## [2.2.15](https://github.com/ExaDev/pdf-codec/compare/v2.2.14...v2.2.15) (2026-08-12)

## [2.2.14](https://github.com/ExaDev/pdf-codec/compare/v2.2.13...v2.2.14) (2026-08-12)

## [2.2.13](https://github.com/ExaDev/pdf-codec/compare/v2.2.12...v2.2.13) (2026-08-12)

## [2.2.12](https://github.com/ExaDev/pdf-codec/compare/v2.2.11...v2.2.12) (2026-08-12)

## [2.2.11](https://github.com/ExaDev/pdf-codec/compare/v2.2.10...v2.2.11) (2026-08-12)

## [2.2.10](https://github.com/ExaDev/pdf-codec/compare/v2.2.9...v2.2.10) (2026-08-10)

## [2.2.9](https://github.com/ExaDev/pdf-codec/compare/v2.2.8...v2.2.9) (2026-08-10)

## [2.2.8](https://github.com/ExaDev/pdf-codec/compare/v2.2.7...v2.2.8) (2026-08-10)

## [2.2.7](https://github.com/ExaDev/pdf-codec/compare/v2.2.6...v2.2.7) (2026-08-08)

## [2.2.6](https://github.com/ExaDev/pdf-codec/compare/v2.2.5...v2.2.6) (2026-08-07)

## [2.2.5](https://github.com/ExaDev/pdf-codec/compare/v2.2.4...v2.2.5) (2026-08-07)

## [2.2.4](https://github.com/ExaDev/pdf-codec/compare/v2.2.3...v2.2.4) (2026-08-07)

## [2.2.3](https://github.com/ExaDev/pdf-codec/compare/v2.2.2...v2.2.3) (2026-08-07)

## [2.2.2](https://github.com/ExaDev/pdf-codec/compare/v2.2.1...v2.2.2) (2026-08-07)

## [2.2.1](https://github.com/ExaDev/pdf-codec/compare/v2.2.0...v2.2.1) (2026-08-07)

# [2.2.0](https://github.com/ExaDev/pdf-codec/compare/v2.1.4...v2.2.0) (2026-08-07)


### Features

* ban split-statement import-then-export re-exports ([d7b14c4](https://github.com/ExaDev/pdf-codec/commit/d7b14c4ecc01c70ed61983770ff7564e37c84c9a))

## [2.1.4](https://github.com/ExaDev/pdf-codec/compare/v2.1.3...v2.1.4) (2026-08-07)

## [2.1.3](https://github.com/ExaDev/pdf-codec/compare/v2.1.2...v2.1.3) (2026-08-07)

## [2.1.2](https://github.com/ExaDev/pdf-codec/compare/v2.1.1...v2.1.2) (2026-08-06)

## [2.1.1](https://github.com/ExaDev/pdf-codec/compare/v2.1.0...v2.1.1) (2026-08-06)

# [2.1.0](https://github.com/ExaDev/pdf-codec/compare/v2.0.10...v2.1.0) (2026-08-06)


### Features

* cache typecheck/lint/test/build tasks with turbo ([9609c3f](https://github.com/ExaDev/pdf-codec/commit/9609c3fee641685ae18810816d84f1d0ec69620b))

## [2.0.10](https://github.com/ExaDev/pdf-codec/compare/v2.0.9...v2.0.10) (2026-08-06)

## [2.0.9](https://github.com/ExaDev/pdf-codec/compare/v2.0.8...v2.0.9) (2026-08-06)

## [2.0.8](https://github.com/ExaDev/pdf-codec/compare/v2.0.7...v2.0.8) (2026-08-06)

## [2.0.7](https://github.com/ExaDev/pdf-codec/compare/v2.0.6...v2.0.7) (2026-08-06)

## [2.0.6](https://github.com/ExaDev/pdf-codec/compare/v2.0.5...v2.0.6) (2026-08-06)

## [2.0.5](https://github.com/ExaDev/pdf-codec/compare/v2.0.4...v2.0.5) (2026-08-06)

## [2.0.4](https://github.com/ExaDev/pdf-codec/compare/v2.0.3...v2.0.4) (2026-08-06)

## [2.0.3](https://github.com/ExaDev/pdf-codec/compare/v2.0.2...v2.0.3) (2026-08-06)

## [2.0.2](https://github.com/ExaDev/pdf-codec/compare/v2.0.1...v2.0.2) (2026-08-06)

## [2.0.1](https://github.com/ExaDev/pdf-codec/compare/v2.0.0...v2.0.1) (2026-08-06)


### Bug Fixes

* use npx in husky hooks instead of pnpm exec + .npmrc ([367395c](https://github.com/ExaDev/pdf-codec/commit/367395cd147d5853b299dcbaffc5f07aa4ef755e))

# [2.0.0](https://github.com/ExaDev/pdf-codec/compare/v1.11.11...v2.0.0) (2026-08-05)


* refactor!: drop wrapRunsToWidth and rotatePointAboutCenter from the public API ([6aa5c99](https://github.com/ExaDev/pdf-codec/commit/6aa5c990b9eef7509d49b87be0d46bda3856e889))


### Bug Fixes

* update smoke export-parity check and README for the dropped primitives ([2475e33](https://github.com/ExaDev/pdf-codec/commit/2475e330d402414e63123bf79d99f6aea6448768))


### BREAKING CHANGES

* wrapRunsToWidth and rotatePointAboutCenter are no
longer exported from pdf-codec. Import them from documents.js (or copy
the ~5-line rotatePointAboutCenter) instead.

## [1.11.11](https://github.com/ExaDev/pdf-codec/compare/v1.11.10...v1.11.11) (2026-08-05)

## [1.11.10](https://github.com/ExaDev/pdf-codec/compare/v1.11.9...v1.11.10) (2026-08-05)

## [1.11.9](https://github.com/ExaDev/pdf-codec/compare/v1.11.8...v1.11.9) (2026-08-05)

## [1.11.8](https://github.com/ExaDev/pdf-codec/compare/v1.11.7...v1.11.8) (2026-08-04)

## [1.11.7](https://github.com/ExaDev/pdf-codec/compare/v1.11.6...v1.11.7) (2026-08-04)

## [1.11.6](https://github.com/ExaDev/pdf-codec/compare/v1.11.5...v1.11.6) (2026-08-04)

## [1.11.5](https://github.com/ExaDev/pdf-codec/compare/v1.11.4...v1.11.5) (2026-08-04)

## [1.11.4](https://github.com/ExaDev/pdf-codec/compare/v1.11.3...v1.11.4) (2026-08-04)

## [1.11.3](https://github.com/ExaDev/pdf-codec/compare/v1.11.2...v1.11.3) (2026-08-04)


### Bug Fixes

* **ci:** self-heal sibling-dependency-update PRs stranded by CONFLICTING status ([173b086](https://github.com/ExaDev/pdf-codec/commit/173b086bcd81709cca9471cc52ec996959d61b6d))

## [1.11.2](https://github.com/ExaDev/pdf-codec/compare/v1.11.1...v1.11.2) (2026-08-04)

## [1.11.1](https://github.com/ExaDev/pdf-codec/compare/v1.11.0...v1.11.1) (2026-08-04)

# [1.11.0](https://github.com/ExaDev/pdf-codec/compare/v1.10.10...v1.11.0) (2026-08-04)


### Features

* export readFontFace for inspecting standalone font files ([3b3db77](https://github.com/ExaDev/pdf-codec/commit/3b3db773e23e2bc7130307adc5e822527470a94d))

## [1.10.10](https://github.com/ExaDev/pdf-codec/compare/v1.10.9...v1.10.10) (2026-08-03)

## [1.10.9](https://github.com/ExaDev/pdf-codec/compare/v1.10.8...v1.10.9) (2026-08-03)


### Bug Fixes

* **ci:** use pull_request_target so dependabot auto-merge can read secrets ([44bb5c4](https://github.com/ExaDev/pdf-codec/commit/44bb5c40c4a4a2a3fae5b50c946d4067dfd70b71))

## [1.10.8](https://github.com/ExaDev/pdf-codec/compare/v1.10.7...v1.10.8) (2026-08-03)


### Bug Fixes

* **ci:** wait for a real check-run to register before requesting auto-merge ([531f352](https://github.com/ExaDev/pdf-codec/commit/531f352ccf4542de6535768997afdfd2d6b3cbbf))

## [1.10.7](https://github.com/ExaDev/pdf-codec/compare/v1.10.6...v1.10.7) (2026-08-03)


### Bug Fixes

* **ci:** use the GitHub App token for the branch push and PR creation too ([7264c24](https://github.com/ExaDev/pdf-codec/commit/7264c245ff11ee46064105093e2e2537562d5a02))

## [1.10.6](https://github.com/ExaDev/pdf-codec/compare/v1.10.5...v1.10.6) (2026-08-03)


### Bug Fixes

* **ci:** wrap the sibling-bump commit body onto two lines under commitlint's limit ([e94d873](https://github.com/ExaDev/pdf-codec/commit/e94d873fbf4150a53f6b7e63b802d84d4f39af31))

## [1.10.5](https://github.com/ExaDev/pdf-codec/compare/v1.10.4...v1.10.5) (2026-08-03)


### Bug Fixes

* **ci:** use single-quoted string literals in workflow if-conditions ([9a1395f](https://github.com/ExaDev/pdf-codec/commit/9a1395f57f5aca7c294749fc9690614b6cd66d7c))

## [1.10.4](https://github.com/ExaDev/pdf-codec/compare/v1.10.3...v1.10.4) (2026-08-03)

## [1.10.3](https://github.com/ExaDev/pdf-codec/compare/v1.10.2...v1.10.3) (2026-08-03)

## [1.10.2](https://github.com/ExaDev/pdf-codec/compare/v1.10.1...v1.10.2) (2026-08-03)

## [1.10.1](https://github.com/ExaDev/pdf-codec/compare/v1.10.0...v1.10.1) (2026-08-03)

# [1.10.0](https://github.com/ExaDev/pdf-codec/compare/v1.9.0...v1.10.0) (2026-08-03)


### Features

* draw dashed, dotted, and double line/path strokes ([a5d5d42](https://github.com/ExaDev/pdf-codec/commit/a5d5d422d7d332e465e790f457c7c55d8c70e3ac))

# [1.9.0](https://github.com/ExaDev/pdf-codec/compare/v1.8.0...v1.9.0) (2026-08-03)


### Features

* apply real pair kerning during embedded-font text layout ([49e1e31](https://github.com/ExaDev/pdf-codec/commit/49e1e314e4eaf2d2880c6eea3f758ee286f09c6d))
* read pair kerning from a font's own GPOS table ([2c14f2d](https://github.com/ExaDev/pdf-codec/commit/2c14f2da8e69c212b74330774f373c19ff36d515))

# [1.8.0](https://github.com/ExaDev/pdf-codec/compare/v1.7.0...v1.8.0) (2026-08-03)


### Features

* draw stretchy glyph constructions by glyph ID ([7d1aa09](https://github.com/ExaDev/pdf-codec/commit/7d1aa091106628086647311e622930fc56c1a24e))

# [1.7.0](https://github.com/ExaDev/pdf-codec/compare/v1.6.0...v1.7.0) (2026-08-03)


### Features

* add a hand-written JBIG2 decoder for ITU-T T.88 embedded streams ([edca3f1](https://github.com/ExaDev/pdf-codec/commit/edca3f13f1680261d5dff7a5d114a4c77391c93e))
* add a hand-written JPEG 2000 decoder for ISO/IEC 15444-1 codestreams ([dd8c107](https://github.com/ExaDev/pdf-codec/commit/dd8c107f6446a06fd0fb5323408fae0a7220c700))
* compute real glyph ink-tight bounding boxes from outline data ([d48a17a](https://github.com/ExaDev/pdf-codec/commit/d48a17a528c0de0d82cd0e4ade1caab9c06b4a78))
* decode JBIG2Decode image streams instead of skipping them ([6ccbfe7](https://github.com/ExaDev/pdf-codec/commit/6ccbfe7b5f07eeaaefb2a60a72f07559db124bd8))
* decode JPXDecode image streams instead of skipping them ([c7bb2bc](https://github.com/ExaDev/pdf-codec/commit/c7bb2bcbd0156ef920c8bbf3445ef1f16fd3b70a))
* parse MathVariants and assemble stretchy glyph constructions ([21aa48e](https://github.com/ExaDev/pdf-codec/commit/21aa48e2fd1f02d7b544e868e2c4bddd381866e3))

# [1.6.0](https://github.com/ExaDev/pdf-codec/compare/v1.5.0...v1.6.0) (2026-08-03)


### Bug Fixes

* separate the subset-tag hash inputs with a space, not a NUL byte ([cf11e8f](https://github.com/ExaDev/pdf-codec/commit/cf11e8fe6fb4c6aec886901c351b2f0a660bf502))
* split ToUnicode CMap entries into blocks of at most 100 ([d62991a](https://github.com/ExaDev/pdf-codec/commit/d62991a4671f6aa5dfa3c2bb5ea1476e61b741ab))


### Features

* add a FontRegistry with source/caller/vendored/standard-14 resolution precedence ([162b24c](https://github.com/ExaDev/pdf-codec/commit/162b24c08108def11bcb7861f69d60b0b44c8a27))
* add a GID-preserving TrueType font subsetter ([16ed0dc](https://github.com/ExaDev/pdf-codec/commit/16ed0dc9fe2392239f201801c88a507eefb8c397))
* add head/maxp/OS-2/post/name and glyf/loca table parsers; generalize cmap/hmtx ([8a80ecf](https://github.com/ExaDev/pdf-codec/commit/8a80ecff0474954ac39c91703ba07f46975fc97b))
* build the Type0/CIDFontType2 PDF object group for embedded TrueType fonts ([8ceabaa](https://github.com/ExaDev/pdf-codec/commit/8ceabaa8b496668b7935b4ef236b43fdab3f1de9))
* detect a CID-keyed CFF font program ([c4823b1](https://github.com/ExaDev/pdf-codec/commit/c4823b14b08fe1bdf6de5e7cefef2f8aaf775640))
* vendor Carlito and Caladea TrueType font assets ([d8f4287](https://github.com/ExaDev/pdf-codec/commit/d8f42870b0d7e8c0eff31f156c2b14c95e5b0dc0))
* wire embedded font resolution into measurement and PDF text writing ([44e6ed9](https://github.com/ExaDev/pdf-codec/commit/44e6ed97fc9f7a52ed29a42c46596bacbd606bd9))

# [1.5.0](https://github.com/ExaDev/pdf-codec/compare/v1.4.2...v1.5.0) (2026-08-02)


### Features

* decode CCITT Group 4 fax-encoded images ([15c9dfd](https://github.com/ExaDev/pdf-codec/commit/15c9dfd7de56bbed3b8f944b28a853da2974d8e7))
* decrypt PDFs with an empty user password (standard security handler) ([62cb7ee](https://github.com/ExaDev/pdf-codec/commit/62cb7eea95ce8cc9ac0c91a521a757713176e2fd))
* detect stroked rects, ellipses, and lines on general vector-path read ([57d9e5a](https://github.com/ExaDev/pdf-codec/commit/57d9e5aec2587d52b00584c7a412381c6567480c))

## [1.4.2](https://github.com/ExaDev/pdf-codec/compare/v1.4.1...v1.4.2) (2026-08-02)

## [1.4.1](https://github.com/ExaDev/pdf-codec/compare/v1.4.0...v1.4.1) (2026-08-02)

# [1.4.0](https://github.com/ExaDev/pdf-codec/compare/v1.3.1...v1.4.0) (2026-08-02)


### Features

* build one file per module, add wildcard deep-import exports ([afdd1c8](https://github.com/ExaDev/pdf-codec/commit/afdd1c875b11581bc75deaa6293162cc36d924c1))

## [1.3.1](https://github.com/ExaDev/pdf-codec/compare/v1.3.0...v1.3.1) (2026-08-02)

# [1.3.0](https://github.com/ExaDev/pdf-codec/compare/v1.2.1...v1.3.0) (2026-08-02)


### Features

* ban anything but re-exports in src/index.ts ([c502d3c](https://github.com/ExaDev/pdf-codec/commit/c502d3c44d3b0332cfbbea1dba9cf35f65caeeb4))

## [1.2.1](https://github.com/ExaDev/pdf-codec/compare/v1.2.0...v1.2.1) (2026-08-02)


### Bug Fixes

* don't flag or fix an alias whose source is mutated elsewhere ([3115925](https://github.com/ExaDev/pdf-codec/commit/31159259b4a6250c96921bcc5c076b9e4c0100a9))

# [1.2.0](https://github.com/ExaDev/pdf-codec/compare/v1.1.6...v1.2.0) (2026-08-02)


### Features

* add custom pointless-reassignment autofix rule, ban re-exports outside src/index.ts ([d5ba949](https://github.com/ExaDev/pdf-codec/commit/d5ba949e390d5bd81517d401d8c030122d2dab6e))

## [1.1.6](https://github.com/ExaDev/pdf-codec/compare/v1.1.5...v1.1.6) (2026-08-02)

## [1.1.5](https://github.com/ExaDev/pdf-codec/compare/v1.1.4...v1.1.5) (2026-08-02)

## [1.1.4](https://github.com/ExaDev/pdf-codec/compare/v1.1.3...v1.1.4) (2026-08-01)

## [1.1.3](https://github.com/ExaDev/pdf-codec/compare/v1.1.2...v1.1.3) (2026-08-01)

## [1.1.2](https://github.com/ExaDev/pdf-codec/compare/v1.1.1...v1.1.2) (2026-08-01)

## [1.1.1](https://github.com/ExaDev/pdf-codec/compare/v1.1.0...v1.1.1) (2026-08-01)

# [1.1.0](https://github.com/ExaDev/pdf-codec/compare/v1.0.0...v1.1.0) (2026-08-01)


### Features

* publish pdf-codec.js and pdf-parser.js as additional npm aliases ([8ffefe3](https://github.com/ExaDev/pdf-codec/commit/8ffefe38cc25d241d9baf8c120bd86edb9c3ca25))

# 1.0.0 (2026-08-01)


### Features

* extract hand-written PDF codec into standalone pdf-codec package ([a6aec06](https://github.com/ExaDev/pdf-codec/commit/a6aec06f87facfd74dd377ab93d0314d99b1d49c))
