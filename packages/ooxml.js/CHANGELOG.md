## [2.0.3](https://github.com/ExaDev/ooxml.js/compare/v2.0.2...v2.0.3) (2026-07-31)

## [2.0.2](https://github.com/ExaDev/ooxml.js/compare/v2.0.1...v2.0.2) (2026-07-31)

## [2.0.1](https://github.com/ExaDev/ooxml.js/compare/v2.0.0...v2.0.1) (2026-07-31)

# [2.0.0](https://github.com/ExaDev/ooxml.js/compare/v1.3.1...v2.0.0) (2026-07-31)


* feat!: resolve style/theme cascades into readDocx sections and readPptx shapes ([e37fb03](https://github.com/ExaDev/ooxml.js/commit/e37fb0342e0b432e70d9ae6ab24d13929024217a))


### Bug Fixes

* update smoke test to readDocx's sections/blocks shape ([da798d9](https://github.com/ExaDev/ooxml.js/commit/da798d913a6b7e11b96b08fbf9afe875b48bd554))


### Features

* add shared OOXML content model and geometry/colour/unit primitives ([8d032f0](https://github.com/ExaDev/ooxml.js/commit/8d032f04dc3c0a37fa3a091df498af46f887b09d))


### BREAKING CHANGES

* DocxDocument's shape changes from
{ paragraphs, tables, hyperlinks, comments, footnotes, headers, footers }
to { metadata, sections, comments, footnotes, headers, footers } --
sections' ordered ContentBlock[] supersedes the separate paragraphs/
tables arrays, and each run's own resolved hyperlink field supersedes
the flat hyperlinks array. PptxPresentation is renamed PptxDocument and
its shape changes from { slides: [{ index, text, shapes: [{ text }],
tables, notes }] } to { metadata, slides: [{ size, shapes: [{ name,
frame, rotationDeg, insets, blocks }], notes }] } -- array position
supersedes the old index field, and each shape's own blocks (paragraphs/
tables/images) supersedes the separate flat shapes/tables arrays.

## [1.3.1](https://github.com/ExaDev/ooxml.js/compare/v1.3.0...v1.3.1) (2026-07-30)


### Bug Fixes

* stop readDocx paragraphs from duplicating table-cell paragraphs ([3215be4](https://github.com/ExaDev/ooxml.js/commit/3215be4f8ac8562655496e9f4878c2b37b3397f8))

# [1.3.0](https://github.com/ExaDev/ooxml.js/compare/v1.2.1...v1.3.0) (2026-07-30)


### Features

* export XML query helpers from typed/util for downstream packages ([5c39e48](https://github.com/ExaDev/ooxml.js/commit/5c39e48837ec7a192e2285bafd6c75994f31a17d))

## [1.2.1](https://github.com/ExaDev/ooxml.js/compare/v1.2.0...v1.2.1) (2026-07-30)


### Bug Fixes

* use the angular preset for release-notes-generator ([0ead019](https://github.com/ExaDev/ooxml.js/commit/0ead019e2e457d2d6cc0656e90d0d4c8af95294b))

# [1.2.0](https://github.com/ExaDev/ooxml.js/compare/v1.1.0...v1.2.0) (2026-07-30)


### Bug Fixes

* publish the GitHub Packages alias to its own registry ([c025b03](https://github.com/ExaDev/ooxml.js/commit/c025b03b7e0a22b2ca698609070dc04eb699fee1))


### Features

* derive commitlint's type-enum from release.config's commit types ([254f91c](https://github.com/ExaDev/ooxml.js/commit/254f91cf05e0def15f1542d49ecaf94f2b79e65e))

# [1.1.0](https://github.com/ExaDev/ooxml.js/compare/v1.0.0...v1.1.0) (2026-07-30)


### Features

* add ESLint and typescript-eslint, downgrading TypeScript to 6.x ([ea41494](https://github.com/ExaDev/ooxml.js/commit/ea4149448adb2c63479466207716492d027c7112))
* gate releases on a CI lint job ([482afd5](https://github.com/ExaDev/ooxml.js/commit/482afd5290eafc6e6765910aa1106661d40aed8d))

# 1.0.0 (2026-07-30)


### Bug Fixes

* load release config as plain JS, not TypeScript ([2e41a07](https://github.com/ExaDev/ooxml.js/commit/2e41a07f3f0985422b17ac775e822e93eae57cc0))
* preserve significant text whitespace in the XML parser ([3da5be1](https://github.com/ExaDev/ooxml.js/commit/3da5be1583a90c9bba96d655ccb30ea1e902e6f8))
* resolve CJS package types and add an ESM/CJS smoke test ([5d25ed2](https://github.com/ExaDev/ooxml.js/commit/5d25ed2d11f75fccbbc1338530f7f0fcd06c6284))


### Features

* add a direct bytes <-> CompactPackage codec ([d8e2336](https://github.com/ExaDev/ooxml.js/commit/d8e233600072300ebc218f4e3b094f8dbc488e4a))
* add CI workflow for release, GitHub Packages, and attestations ([1b396ae](https://github.com/ExaDev/ooxml.js/commit/1b396aef01fd5d48130f0aaad2bbde9595ae86e9))
* add lossless generic OOXML<->JSON package codec ([6913eb5](https://github.com/ExaDev/ooxml.js/commit/6913eb5daabc860c04ceb760cfd42da98966fd77))
* add the ooxml.js format (compact-JSON codec layer) ([8a03ce6](https://github.com/ExaDev/ooxml.js/commit/8a03ce6a1d8c76c13247e418c700c6c9cee3b744))
* automate releases and npm publishing with semantic-release ([a146766](https://github.com/ExaDev/ooxml.js/commit/a146766f876d5ac43c6c8af05ae96d6675d74515))
* **docx:** add docx typed projection reader ([5508daf](https://github.com/ExaDev/ooxml.js/commit/5508dafab6e69eaca2892f4a58cd9bc70ded1148))
* **docx:** expand typed reader with tables, hyperlinks, and metadata ([dbe4cec](https://github.com/ExaDev/ooxml.js/commit/dbe4cec226bfc5a73211d583a3dfac8224f4da49))
* export the expanded typed schemas and refresh the README ([ab10d3b](https://github.com/ExaDev/ooxml.js/commit/ab10d3b76ae49bc4f8dc3ad4b272a0c0f56d82a1))
* export typed readers from the package barrel ([20a8d6b](https://github.com/ExaDev/ooxml.js/commit/20a8d6bc59ef871dfa28fed1949f41d67c717a96))
* **pptx:** add pptx typed projection reader ([bc45fa3](https://github.com/ExaDev/ooxml.js/commit/bc45fa352278ca243141e1e7746f8b7f7af54ee5))
* **pptx:** expand typed reader with shapes, tables, and notes ([f4f18db](https://github.com/ExaDev/ooxml.js/commit/f4f18db46764d020831e187a7aa32258d97539e7))
* **test:** migrate smoke test to Vitest project ([f9ca35c](https://github.com/ExaDev/ooxml.js/commit/f9ca35c1f684d918ae66417b22c08e1f09d28428))
* **typed:** add a shared relationship resolver ([ffd3c74](https://github.com/ExaDev/ooxml.js/commit/ffd3c7456fd9aad2360a26a9b3a24d81fad50f80))
* **xlsx:** add xlsx typed projection reader ([b7293bb](https://github.com/ExaDev/ooxml.js/commit/b7293bb8f005e7e5f4927403aa9949c63f91f081))
* **xlsx:** expand typed reader with formulas, merges, and defined names ([a650a48](https://github.com/ExaDev/ooxml.js/commit/a650a48d135982cf1f90dc4f3da4d26766633e85))
