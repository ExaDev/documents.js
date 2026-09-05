## [1.4.2](https://github.com/ExaDev/documents.js/compare/archive-codec%401.4.1...archive-codec%401.4.2) (2026-09-05)

### Continuous Integration

* add the missing _test:coverage script to nine packages ([bc658d0](https://github.com/ExaDev/documents.js/commit/bc658d094b6ffbd0616cc225c57d5c0595374172))

## [1.4.1](https://github.com/ExaDev/documents.js/compare/archive-codec%401.4.0...archive-codec%401.4.1) (2026-09-05)


### Dependencies

- Updated document-schema.js to ^5.6.0

## [1.4.0](https://github.com/ExaDev/documents.js/compare/archive-codec%401.3.0...archive-codec%401.4.0) (2026-09-04)

### Features

* **archive-codec:** add MS-OLEPS Property Set Stream read/write support ([6752d07](https://github.com/ExaDev/documents.js/commit/6752d07db60580413da5a12b82275dd74d6ded19))
* **archive-codec:** add the LayoutMetadata <-> SummaryInformationProperties mapping ([3061c09](https://github.com/ExaDev/documents.js/commit/3061c09604286ceb8fd39706c0d42b5cd4553859))

### Bug Fixes

* **archive-codec:** skip undecodable property-set values instead of aborting the whole read ([d088848](https://github.com/ExaDev/documents.js/commit/d088848483b6cbf41176312be4a3b173cf8da6df))


### Dependencies

- Updated document-schema.js to ^5.5.1

## [1.3.0](https://github.com/ExaDev/documents.js/compare/archive-codec%401.2.0...archive-codec%401.3.0) (2026-09-03)

### Features

* **archive-codec:** write conformant [MS-CFB] compound files ([46724ab](https://github.com/ExaDev/documents.js/commit/46724abb37993fbbf4a9a3f7d89aef1a01eeb517))

### Documentation

* **archive-codec:** describe the compound-file write path ([4ed88db](https://github.com/ExaDev/documents.js/commit/4ed88db5264ebb0ae30601d868c1c0ddac06aefb))

## [1.2.0](https://github.com/ExaDev/documents.js/compare/archive-codec%401.1.2...archive-codec%401.2.0) (2026-08-24)

### Features

* **eslint:** lint JSON, Markdown, and YAML alongside the TypeScript ([016b127](https://github.com/ExaDev/documents.js/commit/016b127119733c50aa7694bad6265e9bc26bb215))

### Code Refactoring

* **archive-codec:** narrow the CFB stream partitions with a type predicate ([a979387](https://github.com/ExaDev/documents.js/commit/a979387b254b992e3e063ddcef78ec92db3f9a11))
* clear what strictTypeChecked's non-deviated rules found ([92a9fc9](https://github.com/ExaDev/documents.js/commit/92a9fc98f76244fca3a42ff0a12312ab0ce1a79b))
* **eslint:** put type-aware linting on the last six packages ([384e3be](https://github.com/ExaDev/documents.js/commit/384e3be118c912ba811bb9b00767ef689417deab))
* **tsconfig:** share the strict compiler options through one base config ([43af382](https://github.com/ExaDev/documents.js/commit/43af382f726d7d42754ac0b6bf6d91b0ae302e25))

### Styles

* format the workspace with prettier ([56c3a1d](https://github.com/ExaDev/documents.js/commit/56c3a1dd1b0f05fbeccfc9b5e8b1d27ca97486b4))

### Build System

* **deps-dev:** take @exadev/eslint-config 2.1.2 and re-enable its alias rule ([8ecd6de](https://github.com/ExaDev/documents.js/commit/8ecd6de0290c472038fbfe0ec7e47d055cd5d24b))

### Miscellaneous Chores

* **deps:** drop the dependencies each package no longer uses ([80094aa](https://github.com/ExaDev/documents.js/commit/80094aa6db412392ef6e6457014d5963a5e910a7))

## [1.1.2](https://github.com/ExaDev/documents.js/compare/archive-codec@1.1.1...archive-codec@1.1.2) (2026-08-23)

## [1.1.1](https://github.com/ExaDev/documents.js/compare/archive-codec@1.1.0...archive-codec@1.1.1) (2026-08-21)


### Bug Fixes

* **build:** build one dist file per src module so the advertised deep imports resolve ([bbaae2d](https://github.com/ExaDev/documents.js/commit/bbaae2d603eb0b5890bd682dbf9b1d480a8aa3b1)), closes [#745](https://github.com/ExaDev/documents.js/issues/745)

# [1.1.0](https://github.com/ExaDev/documents.js/compare/archive-codec@1.0.2...archive-codec@1.1.0) (2026-08-20)


### Bug Fixes

* read version-4 CFB sectors at (n + 1) * sectorSize ([2576f5d](https://github.com/ExaDev/documents.js/commit/2576f5d9b91a2d4ae3a046f0f8af585054239e81))


### Features

* add a bounded [MS-CFB] compound-file reader with mini-FAT and guard rails ([294d6e7](https://github.com/ExaDev/documents.js/commit/294d6e7ff7463af5e0df4e37a0b56fff3c62a2a8))
* detect the classic OLE compound-file signature alongside ZIP ([2c4065c](https://github.com/ExaDev/documents.js/commit/2c4065c03c2c9593cbe7f870a9df7ab5652c1d0d))
* unwrap the OLE Package stream packaging inside a compound-file embed ([758727a](https://github.com/ExaDev/documents.js/commit/758727ab2d0a667eb863332b5d1b5f692396c137))

## [1.0.2](https://github.com/ExaDev/documents.js/compare/archive-codec@1.0.1...archive-codec@1.0.2) (2026-08-20)

## [1.0.1](https://github.com/ExaDev/documents.js/compare/archive-codec@1.0.0...archive-codec@1.0.1) (2026-08-20)
