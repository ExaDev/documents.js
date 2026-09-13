## [1.0.4](https://github.com/ExaDev/documents.js/compare/pdf-raster-cpu%401.0.3...pdf-raster-cpu%401.0.4) (2026-09-13)


### Dependencies

- Updated byte-codec to 1.5.3
- Updated pdf-codec to 4.8.3

## [1.0.3](https://github.com/ExaDev/documents.js/compare/pdf-raster-cpu%401.0.2...pdf-raster-cpu%401.0.3) (2026-09-12)

### Code Refactoring

* **pdf-raster-cpu:** expose join-wedge boundary decisions for direct testing ([fc28add](https://github.com/ExaDev/documents.js/commit/fc28add302053248a23ffa0ccbbb20499fedf67c))
* **pdf-raster-cpu:** share subsample-range arithmetic in CoverageMask ([2e8f499](https://github.com/ExaDev/documents.js/commit/2e8f499266e37205140b000902ac1ad030154bf7))
* **pdf-raster-cpu:** walk CoverageMask's own marked range instead of a computed bbox ([6db7eea](https://github.com/ExaDev/documents.js/commit/6db7eeaa7a1b7b2bd7ab837a9dccf1d4715f039c))

### Documentation

* **pdf-raster-cpu:** describe the 100% mutation gate without disable comments ([051de82](https://github.com/ExaDev/documents.js/commit/051de82a7bd4b56abadf13ead03810e49ed973c1))

## [1.0.2](https://github.com/ExaDev/documents.js/compare/pdf-raster-cpu%401.0.1...pdf-raster-cpu%401.0.2) (2026-09-12)

### Tests

* **pdf-raster-cpu:** reach a 100% mutation score ([4717f16](https://github.com/ExaDev/documents.js/commit/4717f16e909e8dd77613805dcc08c97e0283b18c))


### Dependencies

- Updated byte-codec to 1.5.2
- Updated pdf-codec to 4.8.2

## [1.0.1](https://github.com/ExaDev/documents.js/compare/pdf-raster-cpu%401.0.0...pdf-raster-cpu%401.0.1) (2026-09-11)

### Code Refactoring

* load stryker.config.ts directly instead of a jiti .mjs bootstrap ([4221520](https://github.com/ExaDev/documents.js/commit/42215205caa1c8fc6368ed38729d15836bdd613b))


### Dependencies

- Updated byte-codec to 1.5.1
- Updated pdf-codec to 4.8.1

## 1.0.0 (2026-09-11)

### Features

* **pdf-raster-cpu:** add the pure-software PageRasteriser backend ([e254ec8](https://github.com/ExaDev/documents.js/commit/e254ec80f3c0a13e44a8112913bf5345a14f5268))

### Bug Fixes

* **pdf-raster-cpu:** drop the unused typescript-eslint devDependency ([54d1319](https://github.com/ExaDev/documents.js/commit/54d1319d7778d45931aa65c0bf375ef72c89aefb))
* **pdf-raster-cpu:** narrow renderPdfPage's async-capable return type ([f5bf039](https://github.com/ExaDev/documents.js/commit/f5bf039f908c3d826b3ac70cba81818c27a2b700))


### Dependencies

- Updated pdf-codec to 4.8.0
