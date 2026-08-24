## [1.2.0](https://github.com/ExaDev/documents.js/compare/archive-codec%401.1.2...archive-codec%401.2.0) (2026-08-24)

### Features

* **eslint:** lint JSON, Markdown, and YAML alongside the TypeScript ([5a150be](https://github.com/ExaDev/documents.js/commit/5a150be97d9d5d84024f935fae3deff5b4266eae))

### Code Refactoring

* **archive-codec:** narrow the CFB stream partitions with a type predicate ([ca027da](https://github.com/ExaDev/documents.js/commit/ca027daed4d9e50a2707f1ee21496734aa0a478f))
* clear what strictTypeChecked's non-deviated rules found ([4a7ad62](https://github.com/ExaDev/documents.js/commit/4a7ad62ebfabddbc4c3f7cc018838448a9abd926))
* **eslint:** put type-aware linting on the last six packages ([e83df4b](https://github.com/ExaDev/documents.js/commit/e83df4b4c4781cb4ba33ae17b130a26545b459c9))
* **tsconfig:** share the strict compiler options through one base config ([e86a366](https://github.com/ExaDev/documents.js/commit/e86a3661ac30c7f304206409272141b97b4fd3ee))

### Styles

* format the workspace with prettier ([c12e740](https://github.com/ExaDev/documents.js/commit/c12e74028aaf5f62cad1c64a414d091c7ecc83db))

### Build System

* **deps-dev:** take @exadev/eslint-config 2.1.2 and re-enable its alias rule ([4b64ac4](https://github.com/ExaDev/documents.js/commit/4b64ac45c2e3baa3fdd8ccb22a6efa9866177cc2))

### Miscellaneous Chores

* **deps:** drop the dependencies each package no longer uses ([62c2108](https://github.com/ExaDev/documents.js/commit/62c2108c1e8ff3db7f24e6de012c17d65993528d))

## [1.1.2](https://github.com/ExaDev/documents.js/compare/archive-codec@1.1.1...archive-codec@1.1.2) (2026-08-23)

## [1.1.1](https://github.com/ExaDev/documents.js/compare/archive-codec@1.1.0...archive-codec@1.1.1) (2026-08-21)


### Bug Fixes

* **build:** build one dist file per src module so the advertised deep imports resolve ([782a0a0](https://github.com/ExaDev/documents.js/commit/782a0a06d8be5aba65d432d743801bf72b83cd26)), closes [#745](https://github.com/ExaDev/documents.js/issues/745)

# [1.1.0](https://github.com/ExaDev/documents.js/compare/archive-codec@1.0.2...archive-codec@1.1.0) (2026-08-20)


### Bug Fixes

* read version-4 CFB sectors at (n + 1) * sectorSize ([123e7e9](https://github.com/ExaDev/documents.js/commit/123e7e94520631cdb959b6bb97c854def951731c))


### Features

* add a bounded [MS-CFB] compound-file reader with mini-FAT and guard rails ([4904782](https://github.com/ExaDev/documents.js/commit/4904782cf6cfa1c85aaf15c7b45661a11cf08841))
* detect the classic OLE compound-file signature alongside ZIP ([3c12c94](https://github.com/ExaDev/documents.js/commit/3c12c9404a4b825bf9d8befc0c342f9a74e88d5d))
* unwrap the OLE Package stream packaging inside a compound-file embed ([30db74f](https://github.com/ExaDev/documents.js/commit/30db74f2efb9de4aad061b0d674d29935f27fd30))

## [1.0.2](https://github.com/ExaDev/documents.js/compare/archive-codec@1.0.1...archive-codec@1.0.2) (2026-08-20)

## [1.0.1](https://github.com/ExaDev/documents.js/compare/archive-codec@1.0.0...archive-codec@1.0.1) (2026-08-20)
