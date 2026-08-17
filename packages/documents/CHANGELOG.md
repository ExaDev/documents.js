## [1.23.32](https://github.com/ExaDev/documents/compare/v1.23.31...v1.23.32) (2026-08-17)

## [1.23.31](https://github.com/ExaDev/documents/compare/v1.23.30...v1.23.31) (2026-08-17)

## [1.23.30](https://github.com/ExaDev/documents/compare/v1.23.29...v1.23.30) (2026-08-17)

## [1.23.29](https://github.com/ExaDev/documents/compare/v1.23.28...v1.23.29) (2026-08-17)

## [1.23.28](https://github.com/ExaDev/documents/compare/v1.23.27...v1.23.28) (2026-08-17)

## [1.23.27](https://github.com/ExaDev/documents/compare/v1.23.26...v1.23.27) (2026-08-17)

## [1.23.26](https://github.com/ExaDev/documents/compare/v1.23.25...v1.23.26) (2026-08-17)

## [1.23.25](https://github.com/ExaDev/documents/compare/v1.23.24...v1.23.25) (2026-08-17)

## [1.23.24](https://github.com/ExaDev/documents/compare/v1.23.23...v1.23.24) (2026-08-17)

## [1.23.23](https://github.com/ExaDev/documents/compare/v1.23.22...v1.23.23) (2026-08-17)

## [1.23.22](https://github.com/ExaDev/documents/compare/v1.23.21...v1.23.22) (2026-08-17)

## [1.23.21](https://github.com/ExaDev/documents/compare/v1.23.20...v1.23.21) (2026-08-17)

## [1.23.20](https://github.com/ExaDev/documents/compare/v1.23.19...v1.23.20) (2026-08-14)

## [1.23.19](https://github.com/ExaDev/documents/compare/v1.23.18...v1.23.19) (2026-08-14)

## [1.23.18](https://github.com/ExaDev/documents/compare/v1.23.17...v1.23.18) (2026-08-14)

## [1.23.17](https://github.com/ExaDev/documents/compare/v1.23.16...v1.23.17) (2026-08-14)

## [1.23.16](https://github.com/ExaDev/documents/compare/v1.23.15...v1.23.16) (2026-08-14)

## [1.23.15](https://github.com/ExaDev/documents/compare/v1.23.14...v1.23.15) (2026-08-13)

## [1.23.14](https://github.com/ExaDev/documents/compare/v1.23.13...v1.23.14) (2026-08-13)

## [1.23.13](https://github.com/ExaDev/documents/compare/v1.23.12...v1.23.13) (2026-08-13)

## [1.23.12](https://github.com/ExaDev/documents/compare/v1.23.11...v1.23.12) (2026-08-13)

## [1.23.11](https://github.com/ExaDev/documents/compare/v1.23.10...v1.23.11) (2026-08-13)

## [1.23.10](https://github.com/ExaDev/documents/compare/v1.23.9...v1.23.10) (2026-08-13)

## [1.23.9](https://github.com/ExaDev/documents/compare/v1.23.8...v1.23.9) (2026-08-13)

## [1.23.8](https://github.com/ExaDev/documents/compare/v1.23.7...v1.23.8) (2026-08-13)

## [1.23.7](https://github.com/ExaDev/documents/compare/v1.23.6...v1.23.7) (2026-08-13)

## [1.23.6](https://github.com/ExaDev/documents/compare/v1.23.5...v1.23.6) (2026-08-13)

## [1.23.5](https://github.com/ExaDev/documents/compare/v1.23.4...v1.23.5) (2026-08-12)

## [1.23.4](https://github.com/ExaDev/documents/compare/v1.23.3...v1.23.4) (2026-08-12)

## [1.23.3](https://github.com/ExaDev/documents/compare/v1.23.2...v1.23.3) (2026-08-12)

## [1.23.2](https://github.com/ExaDev/documents/compare/v1.23.1...v1.23.2) (2026-08-12)


### Bug Fixes

* bump on every conventional-commit type, not just feat/fix/perf ([1bd442d](https://github.com/ExaDev/documents/commit/1bd442df299d6ca2a34d8d68514caacbf7056a85))

## [1.23.1](https://github.com/ExaDev/documents/compare/v1.23.0...v1.23.1) (2026-08-12)


### Bug Fixes

* remove odf content-read fallback now that documents.js forwards onDocument ([828f7ab](https://github.com/ExaDev/documents/commit/828f7ab64069124338172ea64bbc2f515ac53563))

# [1.23.0](https://github.com/ExaDev/documents/compare/v1.22.0...v1.23.0) (2026-08-11)


### Bug Fixes

* simulate double stroke style in SVG vector rendering ([768bb43](https://github.com/ExaDev/documents/commit/768bb432933a11caa95b8106beb00ef46273f82d))


### Features

* add content.read RPC endpoint for direct ContentDocument reads ([c700131](https://github.com/ExaDev/documents/commit/c70013109d5edccd90412799cf1c283004336dce))
* detect blockquotes, code blocks, and docx list kinds in normalization ([d4c5a11](https://github.com/ExaDev/documents/commit/d4c5a11d9cf630ba0219cb7bc4c83e4e945c5236))
* render blockquotes, code blocks, and ordered lists natively ([4cc5b2b](https://github.com/ExaDev/documents/commit/4cc5b2b34bc792859d05484bf02a39dc652b1d48))

# [1.22.0](https://github.com/ExaDev/documents/compare/v1.21.0...v1.22.0) (2026-08-11)


### Features

* preview odg drawings natively instead of through a PDF rendition ([d596f2f](https://github.com/ExaDev/documents/commit/d596f2f94d5a9d37bc8de84f8fd981116f9cc575))

# [1.21.0](https://github.com/ExaDev/documents/compare/v1.20.0...v1.21.0) (2026-08-11)


### Bug Fixes

* populate formula content for odf sources at the RPC boundary ([d42dc9c](https://github.com/ExaDev/documents/commit/d42dc9c47361de902695ee9d82ee5e8e70c6b5ab))


### Features

* add native formula preview for odf ([8059efb](https://github.com/ExaDev/documents/commit/8059efb5b971bd62c1e0f5bae8b772c47a9dfd35))

# [1.20.0](https://github.com/ExaDev/documents/compare/v1.19.0...v1.20.0) (2026-08-11)


### Features

* add native presentation preview for pptx and odp ([9f62e55](https://github.com/ExaDev/documents/commit/9f62e5588a16cf66e352c178d60ff98998e86c39))

# [1.19.0](https://github.com/ExaDev/documents/compare/v1.18.0...v1.19.0) (2026-08-11)


### Bug Fixes

* avoid materializing full base64 strings in structure tree leaves ([68c9d1d](https://github.com/ExaDev/documents/commit/68c9d1def2163fed888f0295fea3b5d76bcf2eb3))


### Features

* add native wordprocessing preview for docx and odt ([2766962](https://github.com/ExaDev/documents/commit/2766962dafe690d045aab54750540c84a62c2f05))
* add variant-aware content summary for structure inspection ([169ef27](https://github.com/ExaDev/documents/commit/169ef275af20ca5a753f192e857609ec29513f7e))
* branch structure inspection on PDF vs content backing ([e55df1f](https://github.com/ExaDev/documents/commit/e55df1f54c732a61d5f5a8dca6de172631fa9c2f))
* normalize wordprocessing heading styleIds at the RPC boundary ([fa4e01e](https://github.com/ExaDev/documents/commit/fa4e01e9300ec29fdc83db3ec1c10b47adb25e10))

# [1.18.0](https://github.com/ExaDev/documents/compare/v1.17.0...v1.18.0) (2026-08-10)


### Bug Fixes

* default spreadsheet cell vertical alignment to bottom, matching its schema ([9f5e711](https://github.com/ExaDev/documents/commit/9f5e711f7b758638a4a84341cfd12f17c9d7ed8e))
* surface the creator metadata field dropped at the RPC boundary ([1c5e793](https://github.com/ExaDev/documents/commit/1c5e79354dbb0f4b8f92f18b737783d9fcc97700))


### Features

* add generic JSON-to-tree-data adapter for structured data views ([9b463f1](https://github.com/ExaDev/documents/commit/9b463f118edd75bac1300a0d229a298fdd98c757))
* return sanitized document structure from pdf.inspect ([578b1d2](https://github.com/ExaDev/documents/commit/578b1d21ecc566cb0bb6f6d03bbd3768cc5764ef))
* show document structure tree in Inspect panel ([9e21d4b](https://github.com/ExaDev/documents/commit/9e21d4bad2351a17ed64136a874ea811ca0f20f2))

# [1.17.0](https://github.com/ExaDev/documents/compare/v1.16.1...v1.17.0) (2026-08-10)


### Features

* generalize Inspect page to support every document format ([01c679d](https://github.com/ExaDev/documents/commit/01c679def33a0c0e46783d3c23c5ed954cfc06e7))
* show document structure alongside Convert page previews ([897d724](https://github.com/ExaDev/documents/commit/897d724895866fe9853b00cb78469d05501fc5ff))

## [1.16.1](https://github.com/ExaDev/documents/compare/v1.16.0...v1.16.1) (2026-08-09)


### Bug Fixes

* scale convert page previews with viewport instead of a fixed cap ([678e6f8](https://github.com/ExaDev/documents/commit/678e6f8131dafbe4458384385f73a81d94e30c54))

# [1.16.0](https://github.com/ExaDev/documents/compare/v1.15.0...v1.16.0) (2026-08-09)


### Features

* widen convert page container so previews use more screen width ([51cbf42](https://github.com/ExaDev/documents/commit/51cbf42459f828168ee1386c9afdab2127ef7a85))

# [1.15.0](https://github.com/ExaDev/documents/compare/v1.14.0...v1.15.0) (2026-08-09)


### Features

* preview spreadsheets as a data grid instead of PDF ([6322e57](https://github.com/ExaDev/documents/commit/6322e57e5cfaf82f8f273f6f55c24603b4b78a81))

# [1.14.0](https://github.com/ExaDev/documents/compare/v1.13.0...v1.14.0) (2026-08-09)


### Features

* preview markdown as rendered HTML instead of PDF ([4bdad4d](https://github.com/ExaDev/documents/commit/4bdad4dc30ab53b178fbfbc2d1fb98e40e24c55f))

# [1.13.0](https://github.com/ExaDev/documents/compare/v1.12.0...v1.13.0) (2026-08-09)


### Features

* show time since release or commit on the sidebar version link ([9ca6804](https://github.com/ExaDev/documents/commit/9ca68042878f657427cf208c5b0b4f5a91af8bbf))

# [1.12.0](https://github.com/ExaDev/documents/compare/v1.11.0...v1.12.0) (2026-08-09)


### Features

* link to the running version or commit at the bottom of the sidebar ([0fed9d3](https://github.com/ExaDev/documents/commit/0fed9d3e566a48ce52575db48ed818ea47e78592))

# [1.11.0](https://github.com/ExaDev/documents/compare/v1.10.0...v1.11.0) (2026-08-09)


### Features

* cycle color scheme with a single click instead of a dropdown ([7875aaa](https://github.com/ExaDev/documents/commit/7875aaa62128aee16eb5255087762b9e62324c81))

# [1.10.0](https://github.com/ExaDev/documents/compare/v1.9.0...v1.10.0) (2026-08-08)


### Features

* add a System option to the color scheme switcher ([67c9008](https://github.com/ExaDev/documents/commit/67c900819657b4c895fe84f1ec3607e4551cf0d6))

# [1.9.0](https://github.com/ExaDev/documents/compare/v1.8.0...v1.9.0) (2026-08-08)


### Features

* preview original and converted documents side by side ([61b80fd](https://github.com/ExaDev/documents/commit/61b80fde58520be30222ba6d789be87b0ca73339))

# [1.8.0](https://github.com/ExaDev/documents/compare/v1.7.0...v1.8.0) (2026-08-08)


### Features

* auto-detect source format and disable incompatible targets ([651bb9d](https://github.com/ExaDev/documents/commit/651bb9d8f0247b5dd6481fb1f5d92221be67fac8))

# [1.7.0](https://github.com/ExaDev/documents/compare/v1.6.0...v1.7.0) (2026-08-08)


### Features

* add a dark mode toggle ([58e82bb](https://github.com/ExaDev/documents/commit/58e82bb6404d1aa26c71b65d5e0bfc68caa5cb33))

# [1.6.0](https://github.com/ExaDev/documents/compare/v1.5.0...v1.6.0) (2026-08-08)


### Features

* add a Recent Files page with reopen-in-Convert ([c88b4d8](https://github.com/ExaDev/documents/commit/c88b4d8dd0f8a4e08d551cdaec74a714773c88a0))

# [1.5.0](https://github.com/ExaDev/documents/compare/v1.4.0...v1.5.0) (2026-08-08)


### Features

* add toast notifications and a shared diagnostics panel ([212f73d](https://github.com/ExaDev/documents/commit/212f73df642b55664c5e920ba48067de8bc6edde))
* wire toast notifications into the four tool routes ([76c2790](https://github.com/ExaDev/documents/commit/76c2790d24fece108c72fbc5ca8ca1e3f807012d))

# [1.4.0](https://github.com/ExaDev/documents/compare/v1.3.0...v1.4.0) (2026-08-08)


### Features

* add drag-and-drop upload, shared across every tool ([e57e8e1](https://github.com/ExaDev/documents/commit/e57e8e141af3b954eab38a4419464a310c03169a))

# [1.3.0](https://github.com/ExaDev/documents/compare/v1.2.0...v1.3.0) (2026-08-08)


### Features

* redesign convert as a layout route with searchable dropdowns ([1739101](https://github.com/ExaDev/documents/commit/17391016961c454aa45b826640211440e7368681))
* replace the header-only nav with a persistent sidebar shell ([54d345b](https://github.com/ExaDev/documents/commit/54d345bfe63786eb8d5f27f68f27428cf0409694))

# [1.2.0](https://github.com/ExaDev/documents/compare/v1.1.0...v1.2.0) (2026-08-08)


### Features

* make the app installable as a PWA ([fc4564e](https://github.com/ExaDev/documents/commit/fc4564eb8ab9aff8584c45cb60eea041521ed8ba))
* switch from hash routing to clean browser-history URLs ([f96cd23](https://github.com/ExaDev/documents/commit/f96cd237ee6d2667dd74a1f65ce3fef2fd283b99))


### Reverts

* Revert "feat: switch from hash routing to clean browser-history URLs" ([8f0ab54](https://github.com/ExaDev/documents/commit/8f0ab542955c655fe743375bed24ba25c4485275))

# [1.1.0](https://github.com/ExaDev/documents/compare/v1.0.0...v1.1.0) (2026-08-08)


### Bug Fixes

* clone Uint8Array before transfer so callers can reuse source bytes ([b25fbf4](https://github.com/ExaDev/documents/commit/b25fbf4a1a795147c4f0a8934b3011d8d8ad64f6))


### Features

* add metadata, PDF inspect, and fonts tool routes ([3610c5b](https://github.com/ExaDev/documents/commit/3610c5b02549b3ab917ec7b0a79ac0f0c347e9d5))
* add pdf.inspect and fonts.extractSourceFonts procedures ([53fd8dc](https://github.com/ExaDev/documents/commit/53fd8dc46955c3cc8b2c962c1ab742e78258f8bc))

# 1.0.0 (2026-08-08)


### Features

* add Dexie schema for recent files and editor sessions ([3ceca29](https://github.com/ExaDev/documents/commit/3ceca292bfb26dd9ebbcf61c60bcb20aebc73dca))
* add document-converter and file-access ports/adapters ([f74ebc5](https://github.com/ExaDev/documents/commit/f74ebc52ca9a34871ccd25e50428cbb568f61157))
* add oRPC Worker boundary for documents.js conversions ([98ddedd](https://github.com/ExaDev/documents/commit/98ddedd012bfe8810e0d395a9fd61e9700736c0b))
* add the convert tool with hash-based routing ([fbccb2e](https://github.com/ExaDev/documents/commit/fbccb2e75239f15548400050015ff454d8776551))
