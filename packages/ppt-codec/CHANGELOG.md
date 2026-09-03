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
