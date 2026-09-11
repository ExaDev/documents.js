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
* **pdf:** read page annotations -- sticky notes, FreeText, markup, and residue for the opaque kinds ([ce91db2](https://github.com/ExaDev/documents.js/commit/ce91db22aa1371dab9decdc1b7c55731868a9bf8))
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
