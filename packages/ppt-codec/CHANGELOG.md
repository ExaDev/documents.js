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
