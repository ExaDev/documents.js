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
