## [1.1.2](https://github.com/ExaDev/documents.js/compare/rtf-codec%401.1.1...rtf-codec%401.1.2) (2026-09-05)

### Bug Fixes

* handle ContentImageBlock's widened svg/gif formats across every consumer ([875b10b](https://github.com/ExaDev/documents.js/commit/875b10b3281ca1ab598abc97230d82f8ff5cdaae))


### Dependencies

- Updated document-schema.js to ^5.6.0

## [1.1.1](https://github.com/ExaDev/documents.js/compare/rtf-codec%401.1.0...rtf-codec%401.1.1) (2026-09-04)


### Dependencies

- Updated document-schema.js to ^5.5.1

## [1.1.0](https://github.com/ExaDev/documents.js/compare/rtf-codec%401.0.0...rtf-codec%401.1.0) (2026-09-03)

### Features

* **rtf-codec:** apply listoverridetable's own \lfolevel level overrides ([88e5291](https://github.com/ExaDev/documents.js/commit/88e5291834804dd98f96b9a6865c6fff1f9109b1))
* **rtf-codec:** map bookmarks onto the anchor construct vocabulary ([06c2920](https://github.com/ExaDev/documents.js/commit/06c29202f9f7deb3131d0a1bc9ff361584dd0e8f)), references [#PCDATA](https://github.com/ExaDev/documents.js/issues/PCDATA)
* **rtf-codec:** map revision marks onto the provenance construct vocabulary ([6a0dba5](https://github.com/ExaDev/documents.js/commit/6a0dba55aa289598416c7804047d5bf26ab1ceda))
* **rtf-codec:** read and write cell borders, shading, and both merge directions ([8beecb5](https://github.com/ExaDev/documents.js/commit/8beecb5715867cdc60f81f5d711639f2841e2111))
* **rtf-codec:** read and write multiple sections ([fd7c8d0](https://github.com/ExaDev/documents.js/commit/fd7c8d0597b8b3653c37f8ea07a697ec77e0fa96))

### Documentation

* **rtf-codec:** restate the scope tables for what the codec now carries ([c90f453](https://github.com/ExaDev/documents.js/commit/c90f453f547e81c6bfe10b62b701ea4d89103259))


### Dependencies

- Updated document-schema.js to ^5.5.0

## 1.0.0 (2026-09-03)

### Features

* **rtf-codec:** add the RTF byte tokenizer and diagnostic tiers ([f47a34f](https://github.com/ExaDev/documents.js/commit/f47a34fd6f9b6cd1ef01c09baf04282bbabbd36d))
* **rtf-codec:** read and write Rich Text Format against the content pivot ([d4dfe94](https://github.com/ExaDev/documents.js/commit/d4dfe94480ea2b818d21a55c29d62e3204f20415))
* **rtf-codec:** report every content destination the reader discards ([69d5b16](https://github.com/ExaDev/documents.js/commit/69d5b16761a09fb1ced56807f95098564a7c8029))

### Bug Fixes

* **rtf-codec:** stop reporting skipped destinations that lose nothing ([73a1fef](https://github.com/ExaDev/documents.js/commit/73a1fef29d7f3c31cb2e18daa869dbfe7c9f768e))
* **rtf-codec:** stop spreading byte runs into argument lists ([a7a89b2](https://github.com/ExaDev/documents.js/commit/a7a89b2325ba044dacceb8877d019e6cf3485b48))

### Code Refactoring

* **rtf-codec:** name a diagnostic position for what it actually is ([bd528cd](https://github.com/ExaDev/documents.js/commit/bd528cdccbde346b7cf29bc876ca4dff2cce5cc3))

### Documentation

* **rtf-codec:** point the engine-wiring gap at its tracking issue ([8eb245d](https://github.com/ExaDev/documents.js/commit/8eb245dc9e7eabb43af1f6837a76ea83555b38f4))
