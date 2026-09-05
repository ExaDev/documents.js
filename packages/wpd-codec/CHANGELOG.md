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
