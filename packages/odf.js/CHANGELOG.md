## [6.2.1](https://github.com/ExaDev/documents.js/compare/odf.js%406.2.0...odf.js%406.2.1) (2026-09-03)


### Dependencies

- Updated document-schema.js to ^5.5.0

## [6.2.0](https://github.com/ExaDev/documents.js/compare/odf.js%406.1.3...odf.js%406.2.0) (2026-09-02)

### Features

* **odf.js:** add the OpenOffice.org 1.x namespace and media-type tables ([204ff67](https://github.com/ExaDev/documents.js/commit/204ff67f53d9ca2f00256c85534c566678470b59))
* **odf.js:** read sxw, sxc, sxi and sxd through the ODF readers ([d1ae5d6](https://github.com/ExaDev/documents.js/commit/d1ae5d641808b00b05ed06ceca56101915304c4d))
* **odf.js:** rewrite an OpenOffice.org 1.x package into the ODF shape ([cf7c120](https://github.com/ExaDev/documents.js/commit/cf7c12073acfa0df1f01105ad9a3367f8931ddbe))
* **odf.js:** split OpenOffice.org 1.x style:properties into ODF's typed elements ([2a388a3](https://github.com/ExaDev/documents.js/commit/2a388a330487f31766ec866018986a6710394720))

### Code Refactoring

* **odf.js:** drop office:class where every other attribute is handled ([777777d](https://github.com/ExaDev/documents.js/commit/777777d9d1640dd4e9ab7bea1ee8d182594eebdc))

### Documentation

* **odf.js:** document the OpenOffice.org 1.x reading path ([4855885](https://github.com/ExaDev/documents.js/commit/485588530995f9de76a78c1b156ab2148232a5e4))

### Tests

* **odf.js:** assert the OpenOffice.org 1.x surface against the built artifact ([75e7237](https://github.com/ExaDev/documents.js/commit/75e7237211145e542ab2fd276a0252ac91f4bf52))

## [6.1.3](https://github.com/ExaDev/documents.js/compare/odf.js%406.1.2...odf.js%406.1.3) (2026-09-02)

### Miscellaneous Chores

* **deps:** bump document-schema.js to ^5.4.0 in odf.js [skip ci] ([700ae37](https://github.com/ExaDev/documents.js/commit/700ae37e7ccef25e6056c95ad4026c3d527e5f93))


### Dependencies

- Updated document-schema.js to ^5.4.0

## [6.1.2](https://github.com/ExaDev/documents.js/compare/odf.js%406.1.1...odf.js%406.1.2) (2026-09-02)

### Miscellaneous Chores

* **deps:** bump document-schema.js to ^5.3.0 in odf.js [skip ci] ([4dfdc42](https://github.com/ExaDev/documents.js/commit/4dfdc42e81a542348269fd741c297383019092f0))


### Dependencies

- Updated document-schema.js to ^5.3.0

## [6.1.1](https://github.com/ExaDev/documents.js/compare/odf.js%406.1.0...odf.js%406.1.1) (2026-09-02)

### Miscellaneous Chores

* **deps:** bump document-schema.js to ^5.2.0 in odf.js [skip ci] ([fc16209](https://github.com/ExaDev/documents.js/commit/fc16209982f4abe3a5c1a7f261b75855df774cf5))


### Dependencies

- Updated document-schema.js to ^5.2.0

## [6.1.0](https://github.com/ExaDev/documents.js/compare/odf.js%406.0.0...odf.js%406.1.0) (2026-08-24)

### Features

* **eslint:** enable strictTypeChecked across the workspace ([67eec04](https://github.com/ExaDev/documents.js/commit/67eec04a380b25142f5d1afd11cb9906ff2cfd5f))
* **eslint:** lint JSON, Markdown, and YAML alongside the TypeScript ([016b127](https://github.com/ExaDev/documents.js/commit/016b127119733c50aa7694bad6265e9bc26bb215))

### Code Refactoring

* clear what strictTypeChecked's non-deviated rules found ([92a9fc9](https://github.com/ExaDev/documents.js/commit/92a9fc98f76244fca3a42ff0a12312ab0ce1a79b))
* **eslint:** move the seven preset-using packages onto the shared config ([f91e3a5](https://github.com/ExaDev/documents.js/commit/f91e3a5d8708424963f10ebb7f2db07a11b5ff45))
* **tsconfig:** share the strict compiler options through one base config ([43af382](https://github.com/ExaDev/documents.js/commit/43af382f726d7d42754ac0b6bf6d91b0ae302e25))

### Styles

* format the workspace with prettier ([56c3a1d](https://github.com/ExaDev/documents.js/commit/56c3a1dd1b0f05fbeccfc9b5e8b1d27ca97486b4))

### Miscellaneous Chores

* **deps:** bump document-schema.js to ^5.1.0 in odf.js [skip ci] ([394906a](https://github.com/ExaDev/documents.js/commit/394906a92de863a4eee499db2897e935cc12070e))
* **deps:** drop the dependencies each package no longer uses ([80094aa](https://github.com/ExaDev/documents.js/commit/80094aa6db412392ef6e6457014d5963a5e910a7))


### Dependencies

- Updated document-schema.js to ^5.1.0

# [6.0.0](https://github.com/ExaDev/documents.js/compare/odf.js@5.5.2...odf.js@6.0.0) (2026-08-23)


* refactor(odf)!: rename DocumentPackage to DocumentTree, land division's text:filter-name residue ([8c5e0b0](https://github.com/ExaDev/documents.js/commit/8c5e0b0cec3bbde2066a3042381d8a12b56603bc)), closes [#719](https://github.com/ExaDev/documents.js/issues/719) [#661](https://github.com/ExaDev/documents.js/issues/661) [#743](https://github.com/ExaDev/documents.js/issues/743)


### BREAKING CHANGES

* every DocumentPackage-rooted export this package
re-exports or returns (DocumentTree, TreeNode/Group/Leaf/BlockLeaf and
siblings) tracks document-schema.js 5.0.0's rename. A division
construct's external-chapter link is read from `linked`, not `source`;
`source` now carries text:filter-name residue when present.


### Dependencies

- Updated document-schema.js to ^5.0.0

## [5.5.2](https://github.com/ExaDev/documents.js/compare/odf.js@5.5.1...odf.js@5.5.2) (2026-08-23)


### Dependencies

- Updated document-schema.js to ^4.10.0

## [5.5.1](https://github.com/ExaDev/documents.js/compare/odf.js@5.5.0...odf.js@5.5.1) (2026-08-23)


### Dependencies

- Updated document-schema.js to ^4.9.1

# [5.5.0](https://github.com/ExaDev/documents.js/compare/odf.js@5.4.0...odf.js@5.5.0) (2026-08-22)


### Features

* **odf:** read text:h table-cell children with full heading identity ([a8277e9](https://github.com/ExaDev/documents.js/commit/a8277e9b6279ab99bf42f71ecee6cd0f69335ed8))

# [5.4.0](https://github.com/ExaDev/documents.js/compare/odf.js@5.3.0...odf.js@5.4.0) (2026-08-22)


### Features

* **odf:** read cross-reference marks and displays as run-level constructs ([008d4d8](https://github.com/ExaDev/documents.js/commit/008d4d8f1744e75bdade70ad8fcc52dd23defef5))

# [5.3.0](https://github.com/ExaDev/documents.js/compare/odf.js@5.2.0...odf.js@5.3.0) (2026-08-22)


### Bug Fixes

* **odf:** quarantine ods vendor extensions inside each table:table where Calc writes them ([5fcbdf1](https://github.com/ExaDev/documents.js/commit/5fcbdf1ba081c8e713fdfa9fe5c5ffb8412105ca))
* **odf:** read odp slide transitions off the drawing-page style, both odf spellings ([2765aa7](https://github.com/ExaDev/documents.js/commit/2765aa71c554ff18c3934a71b70b9857a46ce534))
* **odf:** read only a ruby's base text as flow content, never its gloss ([0b70189](https://github.com/ExaDev/documents.js/commit/0b70189d86f08363bee6bc70ee0049356b7a7df1))
* **odf:** resolve the construct-rows rebase against the embedded dispatch ([76377cd](https://github.com/ExaDev/documents.js/commit/76377cd6caba01b02743bd4a15d1d065fe76bbba))


### Features

* **odf:** map every master page, split sections at page-style switches ([45b3a16](https://github.com/ExaDev/documents.js/commit/45b3a167121424a69c5c52c384be357a40b7341f))
* **odf:** quarantine the ods/odp/odg residue rows ([31624d0](https://github.com/ExaDev/documents.js/commit/31624d0a5867a7162e519fa16060238cc89562f1))
* **odf:** quarantine the odt residue rows through the package-tier channel ([3cfd7af](https://github.com/ExaDev/documents.js/commit/3cfd7af3c640f3d8f0eecf53413079c6f697ef90))
* **odf:** quarantine vendor-extension elements at the ods spreadsheet level ([470ba98](https://github.com/ExaDev/documents.js/commit/470ba98121d4c0ee7e972833e728a24eec031505))
* **odf:** read fo:break-before/after through the cascade onto paragraph page-break flags ([0e495a1](https://github.com/ExaDev/documents.js/commit/0e495a1bd94edae479cb79cfe6b8d008455e8831))


### Dependencies

- Updated document-schema.js to ^4.9.0

# [5.2.0](https://github.com/ExaDev/documents.js/compare/odf.js@5.1.2...odf.js@5.2.0) (2026-08-22)


### Features

* **odf:** read a spreadsheet embedded in an odt through a shared embedded-document dispatch ([f2233b1](https://github.com/ExaDev/documents.js/commit/f2233b10033c2721e367eeb49350139e7eb09a71))

## [5.1.2](https://github.com/ExaDev/documents.js/compare/odf.js@5.1.1...odf.js@5.1.2) (2026-08-21)


### Bug Fixes

* **odf:** pin zip entry mtimes so the byte layout is fully deterministic ([49d9e59](https://github.com/ExaDev/documents.js/commit/49d9e59aa0ff7ebb498c48a4209e164a438b88b6))

## [5.1.1](https://github.com/ExaDev/documents.js/compare/odf.js@5.1.0...odf.js@5.1.1) (2026-08-21)


### Dependencies

- Updated document-schema.js to ^4.8.0

# [5.1.0](https://github.com/ExaDev/documents.js/compare/odf.js@5.0.9...odf.js@5.1.0) (2026-08-21)


### Bug Fixes

* **odf:** assemble annotation bodies through the ordered body walk, not paragraphs-then-lists ([8249a6c](https://github.com/ExaDev/documents.js/commit/8249a6ca97edc04967c573bde7643450c2067931))
* **odf:** cover a trailing marker half's extent over the frames lifted before it ([79dd0b5](https://github.com/ExaDev/documents.js/commit/79dd0b5140d608a20801656e80834fe5f7ea8038))
* **odf:** index nested wrapper extents against the flat block list, not the recursive local array ([77d9e03](https://github.com/ExaDev/documents.js/commit/77d9e03bc38acfc37313cc3b3c11dca11fc412ad))
* **odf:** mint note and annotation body list numIds from the document-wide counter ([990a1e4](https://github.com/ExaDev/documents.js/commit/990a1e401b4d2b034852a254f9b1cf2d77f5cf01))


### Features

* **odf:** gate the odt frame lift behind a frames option, with documents.js opting out ([f3e63a1](https://github.com/ExaDev/documents.js/commit/f3e63a1176d3c4f99d8224152dc5a5e3091a0fb4))
* **odf:** quarantine unmodellable style properties and read data styles and font declarations ([b21d448](https://github.com/ExaDev/documents.js/commit/b21d4488b93ffb3208aa97204c076851a9ecd104))
* **odf:** read anchored frames in odt text flow and resolve embedded charts ([21bcc3e](https://github.com/ExaDev/documents.js/commit/21bcc3e8e79516c09e69c339b664912e9d54358f))
* **odf:** read footnotes, endnotes, and annotations as anchors with definitions ([da224cd](https://github.com/ExaDev/documents.js/commit/da224cd30bebc7e28bc74ee8178dc9d6bc18825d))
* **odf:** read inline fields and bookmarks as run-level construct extents ([e156221](https://github.com/ExaDev/documents.js/commit/e15622187ae43537389d205d224d2f9faa6fb9ab))
* **odf:** read ods named expressions into a definitions table ([4502f69](https://github.com/ExaDev/documents.js/commit/4502f695150bbe62f72ea4a9b814318e293e38bf))
* **odf:** read office:forms in ordinary text documents as content controls ([b943076](https://github.com/ExaDev/documents.js/commit/b943076f95356f2f6b3aa8a175f09a7655f8ddda))
* **odf:** read text:section as a division and index wrappers as content controls ([3a56883](https://github.com/ExaDev/documents.js/commit/3a568830ed4cfc5ad47488fb344c9b9b1374c550)), closes [#743](https://github.com/ExaDev/documents.js/issues/743)
* **odf:** read tracked changes as provenance and pair block-scope markers ([4a82b88](https://github.com/ExaDev/documents.js/commit/4a82b88548825d5d140784eee4df005877511917))


### Dependencies

- Updated document-schema.js to ^4.7.0

## [5.0.9](https://github.com/ExaDev/documents.js/compare/odf.js@5.0.8...odf.js@5.0.9) (2026-08-21)


### Bug Fixes

* **odf:** state the unreachable chart arm in the embedded-object dispatch ([168809e](https://github.com/ExaDev/documents.js/commit/168809eba52203e4c8887f62107402d08e3a4113))


### Dependencies

- Updated document-schema.js to ^4.6.0

## [5.0.8](https://github.com/ExaDev/documents.js/compare/odf.js@5.0.7...odf.js@5.0.8) (2026-08-21)


### Dependencies

- Updated document-schema.js to ^4.5.0

## [5.0.7](https://github.com/ExaDev/documents.js/compare/odf.js@5.0.6...odf.js@5.0.7) (2026-08-20)


### Dependencies

- Updated document-schema.js to ^4.3.7

## [5.0.6](https://github.com/ExaDev/documents.js/compare/odf.js@5.0.5...odf.js@5.0.6) (2026-08-20)


### Dependencies

- Updated document-schema.js to ^4.3.6

## [5.0.5](https://github.com/ExaDev/documents.js/compare/odf.js@5.0.4...odf.js@5.0.5) (2026-08-20)


### Bug Fixes

* point package homepage and bugs URLs at the monorepo, not the old standalone repos ([1b605e8](https://github.com/ExaDev/documents.js/commit/1b605e846393f417001227758a8606347c04e219))


### Dependencies

- Updated document-schema.js to ^4.3.5

## [5.0.4](https://github.com/ExaDev/documents.js/compare/odf.js@5.0.3...odf.js@5.0.4) (2026-08-20)


### Dependencies

- Updated document-schema.js to ^4.3.4

# [5.0.0](https://github.com/ExaDev/odf.js/compare/v4.0.3...v5.0.0) (2026-08-19)


### Features

* read every ODF content format into a DocumentPackage ([668f046](https://github.com/ExaDev/odf.js/commit/668f0468a322d202806a90af22ab93310f7623ee))


### BREAKING CHANGES

* the flat typed readers move to *Content names, freeing
the bare names for the DocumentPackage-native readers: readOdt ->
readOdtContent, readOdp -> readOdpContent, readOdg -> readOdgContent,
readOds -> readOdsContent, readOdfFormulaDocument ->
readOdfFormulaContent, and readOdfFormula -> readOdfFormulaMathMl.
Behaviour is unchanged in every case; each new bare name returns a
DocumentPackage, which is assignable to none of the old return types, so
an unmigrated call site fails to compile rather than changing meaning
silently.

## [4.0.3](https://github.com/ExaDev/odf.js/compare/v4.0.2...v4.0.3) (2026-08-19)

## [4.0.2](https://github.com/ExaDev/odf.js/compare/v4.0.1...v4.0.2) (2026-08-18)

## [4.0.1](https://github.com/ExaDev/odf.js/compare/v4.0.0...v4.0.1) (2026-08-18)

# [4.0.0](https://github.com/ExaDev/odf.js/compare/v3.1.0...v4.0.0) (2026-08-18)


* feat!: stop stamping formatVersion on ContentDocument for schema 4.0.0 ([282e275](https://github.com/ExaDev/odf.js/commit/282e27541c035998f655d2de98e741f0979d0a78))


### BREAKING CHANGES

* every ContentDocument odf.js produces now omits
formatVersion, and the package requires document-schema.js ^4.0.0.

# [3.1.0](https://github.com/ExaDev/odf.js/compare/v3.0.2...v3.1.0) (2026-08-17)


### Features

* read text:list content in odp slide text frames into ContentParagraph.list ([48c3ffa](https://github.com/ExaDev/odf.js/commit/48c3ffacc984db6341660b0027ac29aa12bf2a5b))

## [3.0.2](https://github.com/ExaDev/odf.js/compare/v3.0.1...v3.0.2) (2026-08-17)

## [3.0.1](https://github.com/ExaDev/odf.js/compare/v3.0.0...v3.0.1) (2026-08-17)

# [3.0.0](https://github.com/ExaDev/odf.js/compare/v2.7.23...v3.0.0) (2026-08-17)


* build!: bump document-schema.js to ^3.0.0 ([afe2894](https://github.com/ExaDev/odf.js/commit/afe2894f32c7b84e5d57b50de080d9ebdf901d37))


### Features

* read odt heading outline levels as headingLevel alongside styleId ([cf21f55](https://github.com/ExaDev/odf.js/commit/cf21f55d82a1a9ac6e967d54bddccec2533b4ff2))


### BREAKING CHANGES

* odf.js's emitted ContentDocuments now carry
formatVersion 3, from document-schema.js 3.0.0's CONTENT_FORMAT_VERSION;
consumers still validating odf.js output against document-schema.js 2
will reject the new documents.

## [2.7.23](https://github.com/ExaDev/odf.js/compare/v2.7.22...v2.7.23) (2026-08-17)

## [2.7.22](https://github.com/ExaDev/odf.js/compare/v2.7.21...v2.7.22) (2026-08-17)

## [2.7.21](https://github.com/ExaDev/odf.js/compare/v2.7.20...v2.7.21) (2026-08-17)

## [2.7.20](https://github.com/ExaDev/odf.js/compare/v2.7.19...v2.7.20) (2026-08-17)

## [2.7.19](https://github.com/ExaDev/odf.js/compare/v2.7.18...v2.7.19) (2026-08-17)

## [2.7.18](https://github.com/ExaDev/odf.js/compare/v2.7.17...v2.7.18) (2026-08-17)

## [2.7.17](https://github.com/ExaDev/odf.js/compare/v2.7.16...v2.7.17) (2026-08-17)

## [2.7.16](https://github.com/ExaDev/odf.js/compare/v2.7.15...v2.7.16) (2026-08-17)

## [2.7.15](https://github.com/ExaDev/odf.js/compare/v2.7.14...v2.7.15) (2026-08-17)

## [2.7.14](https://github.com/ExaDev/odf.js/compare/v2.7.13...v2.7.14) (2026-08-13)

## [2.7.13](https://github.com/ExaDev/odf.js/compare/v2.7.12...v2.7.13) (2026-08-13)

## [2.7.12](https://github.com/ExaDev/odf.js/compare/v2.7.11...v2.7.12) (2026-08-12)

## [2.7.11](https://github.com/ExaDev/odf.js/compare/v2.7.10...v2.7.11) (2026-08-12)

## [2.7.10](https://github.com/ExaDev/odf.js/compare/v2.7.9...v2.7.10) (2026-08-12)

## [2.7.9](https://github.com/ExaDev/odf.js/compare/v2.7.8...v2.7.9) (2026-08-12)

## [2.7.8](https://github.com/ExaDev/odf.js/compare/v2.7.7...v2.7.8) (2026-08-12)

## [2.7.7](https://github.com/ExaDev/odf.js/compare/v2.7.6...v2.7.7) (2026-08-12)

## [2.7.6](https://github.com/ExaDev/odf.js/compare/v2.7.5...v2.7.6) (2026-08-12)


### Bug Fixes

* **ci:** skip commitlint for dependabot commits to avoid body-max-line-length failures ([5257b81](https://github.com/ExaDev/odf.js/commit/5257b812c9a7b4a09c32947c8cdb4e6cefdd1626))

## [2.7.5](https://github.com/ExaDev/odf.js/compare/v2.7.4...v2.7.5) (2026-08-12)

## [2.7.4](https://github.com/ExaDev/odf.js/compare/v2.7.3...v2.7.4) (2026-08-12)

## [2.7.3](https://github.com/ExaDev/odf.js/compare/v2.7.2...v2.7.3) (2026-08-12)

## [2.7.2](https://github.com/ExaDev/odf.js/compare/v2.7.1...v2.7.2) (2026-08-12)

## [2.7.1](https://github.com/ExaDev/odf.js/compare/v2.7.0...v2.7.1) (2026-08-12)

# [2.7.0](https://github.com/ExaDev/odf.js/compare/v2.6.12...v2.7.0) (2026-08-11)


### Features

* resolve ODF list ordered-vs-bullet from text:list-style definitions ([40a52b5](https://github.com/ExaDev/odf.js/commit/40a52b589d3c323c33d042903f38df7f88399535))

## [2.6.12](https://github.com/ExaDev/odf.js/compare/v2.6.11...v2.6.12) (2026-08-10)

## [2.6.11](https://github.com/ExaDev/odf.js/compare/v2.6.10...v2.6.11) (2026-08-10)

## [2.6.10](https://github.com/ExaDev/odf.js/compare/v2.6.9...v2.6.10) (2026-08-08)

## [2.6.9](https://github.com/ExaDev/odf.js/compare/v2.6.8...v2.6.9) (2026-08-08)

## [2.6.8](https://github.com/ExaDev/odf.js/compare/v2.6.7...v2.6.8) (2026-08-08)


### Bug Fixes

* default unstyled ods column/row dimensions to positive values ([f347c73](https://github.com/ExaDev/odf.js/commit/f347c73ed5335b8076c3cf0c53401520776ef37c))

## [2.6.7](https://github.com/ExaDev/odf.js/compare/v2.6.6...v2.6.7) (2026-08-07)

## [2.6.6](https://github.com/ExaDev/odf.js/compare/v2.6.5...v2.6.6) (2026-08-07)

## [2.6.5](https://github.com/ExaDev/odf.js/compare/v2.6.4...v2.6.5) (2026-08-07)

## [2.6.4](https://github.com/ExaDev/odf.js/compare/v2.6.3...v2.6.4) (2026-08-07)

## [2.6.3](https://github.com/ExaDev/odf.js/compare/v2.6.2...v2.6.3) (2026-08-07)

## [2.6.2](https://github.com/ExaDev/odf.js/compare/v2.6.1...v2.6.2) (2026-08-07)

## [2.6.1](https://github.com/ExaDev/odf.js/compare/v2.6.0...v2.6.1) (2026-08-07)

# [2.6.0](https://github.com/ExaDev/odf.js/compare/v2.5.3...v2.6.0) (2026-08-07)


### Features

* add an autofix to the split-statement re-export rule ([028c845](https://github.com/ExaDev/odf.js/commit/028c8459ec4815216053f2b9f89c38e5a51a7c29))

## [2.5.3](https://github.com/ExaDev/odf.js/compare/v2.5.2...v2.5.3) (2026-08-07)

## [2.5.2](https://github.com/ExaDev/odf.js/compare/v2.5.1...v2.5.2) (2026-08-07)


### Bug Fixes

* render literal braces correctly and catch split-statement default re-exports ([22b149d](https://github.com/ExaDev/odf.js/commit/22b149dae15bf60cb943f1741d51a95055db3bc1))

## [2.5.1](https://github.com/ExaDev/odf.js/compare/v2.5.0...v2.5.1) (2026-08-07)

# [2.5.0](https://github.com/ExaDev/odf.js/compare/v2.4.23...v2.5.0) (2026-08-07)


### Features

* ban split-statement import-then-export re-exports ([a3ac637](https://github.com/ExaDev/odf.js/commit/a3ac6379211d1121ddba0a7941bf441ebd9c8e31))

## [2.4.23](https://github.com/ExaDev/odf.js/compare/v2.4.22...v2.4.23) (2026-08-06)

## [2.4.22](https://github.com/ExaDev/odf.js/compare/v2.4.21...v2.4.22) (2026-08-06)

## [2.4.21](https://github.com/ExaDev/odf.js/compare/v2.4.20...v2.4.21) (2026-08-06)

## [2.4.20](https://github.com/ExaDev/odf.js/compare/v2.4.19...v2.4.20) (2026-08-06)

## [2.4.19](https://github.com/ExaDev/odf.js/compare/v2.4.18...v2.4.19) (2026-08-06)

## [2.4.18](https://github.com/ExaDev/odf.js/compare/v2.4.17...v2.4.18) (2026-08-06)

## [2.4.17](https://github.com/ExaDev/odf.js/compare/v2.4.16...v2.4.17) (2026-08-06)

## [2.4.16](https://github.com/ExaDev/odf.js/compare/v2.4.15...v2.4.16) (2026-08-06)

## [2.4.15](https://github.com/ExaDev/odf.js/compare/v2.4.14...v2.4.15) (2026-08-06)

## [2.4.14](https://github.com/ExaDev/odf.js/compare/v2.4.13...v2.4.14) (2026-08-06)

## [2.4.13](https://github.com/ExaDev/odf.js/compare/v2.4.12...v2.4.13) (2026-08-06)

## [2.4.12](https://github.com/ExaDev/odf.js/compare/v2.4.11...v2.4.12) (2026-08-06)

## [2.4.11](https://github.com/ExaDev/odf.js/compare/v2.4.10...v2.4.11) (2026-08-06)

## [2.4.10](https://github.com/ExaDev/odf.js/compare/v2.4.9...v2.4.10) (2026-08-06)

## [2.4.9](https://github.com/ExaDev/odf.js/compare/v2.4.8...v2.4.9) (2026-08-06)

## [2.4.8](https://github.com/ExaDev/odf.js/compare/v2.4.7...v2.4.8) (2026-08-06)

## [2.4.7](https://github.com/ExaDev/odf.js/compare/v2.4.6...v2.4.7) (2026-08-05)

## [2.4.6](https://github.com/ExaDev/odf.js/compare/v2.4.5...v2.4.6) (2026-08-05)

## [2.4.5](https://github.com/ExaDev/odf.js/compare/v2.4.4...v2.4.5) (2026-08-05)

## [2.4.4](https://github.com/ExaDev/odf.js/compare/v2.4.3...v2.4.4) (2026-08-05)

## [2.4.3](https://github.com/ExaDev/odf.js/compare/v2.4.2...v2.4.3) (2026-08-05)

## [2.4.2](https://github.com/ExaDev/odf.js/compare/v2.4.1...v2.4.2) (2026-08-05)

## [2.4.1](https://github.com/ExaDev/odf.js/compare/v2.4.0...v2.4.1) (2026-08-05)

# [2.4.0](https://github.com/ExaDev/odf.js/compare/v2.3.9...v2.4.0) (2026-08-05)


### Features

* read text:a hyperlink elements into ContentRun.hyperlink ([6eac555](https://github.com/ExaDev/odf.js/commit/6eac555e5558003d3bdf66f1c967402c5d74c06f))

## [2.3.9](https://github.com/ExaDev/odf.js/compare/v2.3.8...v2.3.9) (2026-08-04)

## [2.3.8](https://github.com/ExaDev/odf.js/compare/v2.3.7...v2.3.8) (2026-08-04)

## [2.3.7](https://github.com/ExaDev/odf.js/compare/v2.3.6...v2.3.7) (2026-08-04)

## [2.3.6](https://github.com/ExaDev/odf.js/compare/v2.3.5...v2.3.6) (2026-08-04)

## [2.3.5](https://github.com/ExaDev/odf.js/compare/v2.3.4...v2.3.5) (2026-08-04)

## [2.3.4](https://github.com/ExaDev/odf.js/compare/v2.3.3...v2.3.4) (2026-08-04)

## [2.3.3](https://github.com/ExaDev/odf.js/compare/v2.3.2...v2.3.3) (2026-08-04)

## [2.3.2](https://github.com/ExaDev/odf.js/compare/v2.3.1...v2.3.2) (2026-08-04)

## [2.3.1](https://github.com/ExaDev/odf.js/compare/v2.3.0...v2.3.1) (2026-08-04)

# [2.3.0](https://github.com/ExaDev/odf.js/compare/v2.2.10...v2.3.0) (2026-08-03)


### Features

* export readDrawImageBlock for sibling packages ([d1c6121](https://github.com/ExaDev/odf.js/commit/d1c6121e391162bbaccc717cff037f1307c8eafd))

## [2.2.10](https://github.com/ExaDev/odf.js/compare/v2.2.9...v2.2.10) (2026-08-03)

## [2.2.9](https://github.com/ExaDev/odf.js/compare/v2.2.8...v2.2.9) (2026-08-03)


### Bug Fixes

* **ci:** use pull_request_target so dependabot auto-merge can read secrets ([f0cce44](https://github.com/ExaDev/odf.js/commit/f0cce441d901636f1ca43038742b74cfaa002bd7))

## [2.2.8](https://github.com/ExaDev/odf.js/compare/v2.2.7...v2.2.8) (2026-08-03)


### Bug Fixes

* **ci:** wait for a real check-run to register before requesting auto-merge ([8180b8c](https://github.com/ExaDev/odf.js/commit/8180b8c1b91dae41dffbdcb5f692b4c7069e93f8))

## [2.2.7](https://github.com/ExaDev/odf.js/compare/v2.2.6...v2.2.7) (2026-08-03)

## [2.2.6](https://github.com/ExaDev/odf.js/compare/v2.2.5...v2.2.6) (2026-08-03)


### Bug Fixes

* **ci:** use the GitHub App token for the branch push and PR creation too ([ffe0e6d](https://github.com/ExaDev/odf.js/commit/ffe0e6deb90e7914c74bb305156e0cd5f395c4b3))

## [2.2.5](https://github.com/ExaDev/odf.js/compare/v2.2.4...v2.2.5) (2026-08-03)


### Bug Fixes

* **ci:** wrap the sibling-bump commit body onto two lines under commitlint's limit ([b256dcc](https://github.com/ExaDev/odf.js/commit/b256dcc52471bb3ff5ff4ec19cdc011df3b39821))

## [2.2.4](https://github.com/ExaDev/odf.js/compare/v2.2.3...v2.2.4) (2026-08-03)

## [2.2.3](https://github.com/ExaDev/odf.js/compare/v2.2.2...v2.2.3) (2026-08-03)

## [2.2.2](https://github.com/ExaDev/odf.js/compare/v2.2.1...v2.2.2) (2026-08-03)

## [2.2.1](https://github.com/ExaDev/odf.js/compare/v2.2.0...v2.2.1) (2026-08-03)

# [2.2.0](https://github.com/ExaDev/odf.js/compare/v2.1.0...v2.2.0) (2026-08-03)


### Features

* read an embedded formula object and its cell anchor from a spreadsheet ([62399e7](https://github.com/ExaDev/odf.js/commit/62399e7e6789ad8f2f5920bb2c9b73b3149bed8a))

# [2.1.0](https://github.com/ExaDev/odf.js/compare/v2.0.0...v2.1.0) (2026-08-03)


### Features

* read cell- and page-anchored drawings from a spreadsheet ([425bec3](https://github.com/ExaDev/odf.js/commit/425bec3b7bc04e146e31481954ede5e25b873f6d))

# [2.0.0](https://github.com/ExaDev/odf.js/compare/v1.13.2...v2.0.0) (2026-08-02)


* feat!: read .odb form and report structure from their own ODF sub-documents ([6b31d67](https://github.com/ExaDev/odf.js/commit/6b31d67885d10cf3da0abc53c721b264b26d0f09))


### Features

* add readOdfFormulaDocument producing a real ContentDocument formula kind ([1f45d01](https://github.com/ExaDev/odf.js/commit/1f45d01d00b44327f1449f9df9463e26997bf508))
* read rotationDeg for draw:rect/ellipse/path/custom-shape vectors ([26d42a8](https://github.com/ExaDev/odf.js/commit/26d42a876cdbbdeb3d6c00452360a04ec9de726b))
* read sheet and table cell background/borders/alignment from the ODF style cascade ([a6b80a9](https://github.com/ExaDev/odf.js/commit/a6b80a9c7c593c16e63bf8988f8629c68d8ed96c))
* read svg:fill-rule and map draw:stroke to ContentStrokeSchema style ([d28155f](https://github.com/ExaDev/odf.js/commit/d28155f23de252915c2a721c20215a7c6461d520))
* register the rpt: (Report Builder) ODF namespace ([503d92f](https://github.com/ExaDev/odf.js/commit/503d92f9bab2f08b2e34600e98d9e7e862ed7463))
* stamp resolved paintOrder onto every ContentShape/ContentVector ([925ddb0](https://github.com/ExaDev/odf.js/commit/925ddb03b1cea07d1ea8a18aa173c226cbd50bb1))


### BREAKING CHANGES

* OdbInventory.forms and .reports are now OdbComponentInfo[]
({ name, href, asTemplate? }) rather than string[], and their names come from
content.xml's db:forms/db:reports registry rather than from manifest part paths.
A form's or report's storage directory is named after an opaque persistent name
(forms/Obj11), not after the form or report, so deriving names from part paths
returned "Obj11" on real output instead of "SalesForm"; db:component is the only
place the user-visible name exists, and it carries the href alongside it.

All of this is grounded in a new real fixture,
src/typed/odb/fixtures/form-and-report.odb: an embedded-Firebird .odb with a
live SALES table, a saved query, a bound form with a label, a list box and a
nested sub-form, and a Report Builder report with two nested groups, per-group
SUM footers and a grand total. It was generated through LibreOffice's own
in-process UNO API and never hand-edited, then reopened from disk by LibreOffice
to confirm it reads back correctly.

Two shapes in it contradict what the schema alone suggests, and both would have
been got wrong by assumption: rpt:detail is nested inside the innermost
rpt:group rather than sitting beside the other bands, and a group's key is a
formula (rpt:HASCHANGED("REGION")) rather than a bare column name, with
prefix-character grouping expressed through a generated report-level
rpt:function instead of any group attribute.

## [1.13.2](https://github.com/ExaDev/odf.js/compare/v1.13.1...v1.13.2) (2026-08-02)


### Bug Fixes

* rename ContentSheetPrintSettings.scale to scalePercent for document-schema.js 2.0.0 ([7a5bc58](https://github.com/ExaDev/odf.js/commit/7a5bc585c19dd1f18fdd739d85b606cbf3c54832))

## [1.13.1](https://github.com/ExaDev/odf.js/compare/v1.13.0...v1.13.1) (2026-08-02)

# [1.13.0](https://github.com/ExaDev/odf.js/compare/v1.12.1...v1.13.0) (2026-08-02)


### Features

* build one file per module, add wildcard deep-import exports ([90e16ad](https://github.com/ExaDev/odf.js/commit/90e16ad46c11192d64da5b6c65e9655c80b2570d))

## [1.12.1](https://github.com/ExaDev/odf.js/compare/v1.12.0...v1.12.1) (2026-08-02)

# [1.12.0](https://github.com/ExaDev/odf.js/compare/v1.11.1...v1.12.0) (2026-08-02)


### Features

* ban anything but re-exports in src/index.ts ([058ec10](https://github.com/ExaDev/odf.js/commit/058ec10b3dee943b57ef6311709ef02ddd366cc8))

## [1.11.1](https://github.com/ExaDev/odf.js/compare/v1.11.0...v1.11.1) (2026-08-02)


### Bug Fixes

* don't flag or fix an alias whose source is mutated elsewhere ([2908f46](https://github.com/ExaDev/odf.js/commit/2908f465255481f5a641b78e6b1c6c43ba2fd265))

# [1.11.0](https://github.com/ExaDev/odf.js/compare/v1.10.5...v1.11.0) (2026-08-02)


### Features

* add custom pointless-reassignment autofix rule, ban re-exports outside src/index.ts ([9c7ca19](https://github.com/ExaDev/odf.js/commit/9c7ca199cf6c616680749994444f9d985f4e0780))

## [1.10.5](https://github.com/ExaDev/odf.js/compare/v1.10.4...v1.10.5) (2026-08-02)

## [1.10.4](https://github.com/ExaDev/odf.js/compare/v1.10.3...v1.10.4) (2026-08-01)

## [1.10.3](https://github.com/ExaDev/odf.js/compare/v1.10.2...v1.10.3) (2026-08-01)

## [1.10.2](https://github.com/ExaDev/odf.js/compare/v1.10.1...v1.10.2) (2026-08-01)

## [1.10.1](https://github.com/ExaDev/odf.js/compare/v1.10.0...v1.10.1) (2026-08-01)

# [1.10.0](https://github.com/ExaDev/odf.js/compare/v1.9.0...v1.10.0) (2026-08-01)


### Features

* add readOdbInventory, a typed reader for ODF database package inventories ([89fb54a](https://github.com/ExaDev/odf.js/commit/89fb54a3a700635a234af160a3913481340ab305))

# [1.9.0](https://github.com/ExaDev/odf.js/compare/v1.8.0...v1.9.0) (2026-08-01)


### Features

* add readOdm, a typed reader for ODF master documents ([43ea51b](https://github.com/ExaDev/odf.js/commit/43ea51b5b1acbd3ed06c31ba40e3cae0464adae4))

# [1.8.0](https://github.com/ExaDev/odf.js/compare/v1.7.0...v1.8.0) (2026-07-31)


### Features

* add readOdfFormula, surfacing raw MathML and StarMath annotations ([f3fd726](https://github.com/ExaDev/odf.js/commit/f3fd726eb707191823cf0958d5d39890a26343b2))

# [1.7.0](https://github.com/ExaDev/odf.js/compare/v1.6.0...v1.7.0) (2026-07-31)


### Features

* add readOds, a geometry-and-print-settings-rich spreadsheet reader ([55f8eae](https://github.com/ExaDev/odf.js/commit/55f8eae3990e0d710f49c45020661e5fc96acd00))

# [1.6.0](https://github.com/ExaDev/odf.js/compare/v1.5.0...v1.6.0) (2026-07-31)


### Bug Fixes

* **deps:** lower minimumReleaseAge for CI's frozen-lockfile install ([a264433](https://github.com/ExaDev/odf.js/commit/a26443324e3b8e6d7540fa732277ad0f4789fb4a)), closes [pnpm/pnpm#10361](https://github.com/pnpm/pnpm/issues/10361) [#9997](https://github.com/ExaDev/odf.js/issues/9997) [#10438](https://github.com/ExaDev/odf.js/issues/10438)


### Features

* add an ODF path-data and points-list grammar parser ([cb4e7d8](https://github.com/ExaDev/odf.js/commit/cb4e7d8a7b047a4087d57fc8d6dab6ad7f9a541c))
* add readOdg and extend the shared shape vocabulary with vector primitives ([14b4ef9](https://github.com/ExaDev/odf.js/commit/14b4ef999c978b3b4d765bfd942d1ae939ad9a61))

# [1.5.0](https://github.com/ExaDev/odf.js/compare/v1.4.0...v1.5.0) (2026-07-31)


### Features

* add readOdt, the first end-to-end ODF content reader ([c156e7f](https://github.com/ExaDev/odf.js/commit/c156e7ff61631af7c33a7abd57699267f5d46519))

# [1.4.0](https://github.com/ExaDev/odf.js/compare/v1.3.1...v1.4.0) (2026-07-31)


### Features

* add a deep descendant-element search to the ODF XML query helpers ([d94cf2f](https://github.com/ExaDev/odf.js/commit/d94cf2fcc70242368860d26f679d79b09dcba4cc))
* add readOdp and the shared odp/odg shape vocabulary ([a11f95a](https://github.com/ExaDev/odf.js/commit/a11f95adb17f662bb7c91072c4ad94a20f08026c))
* split cascade.ts's style-chain walk from its property extraction ([0b1444e](https://github.com/ExaDev/odf.js/commit/0b1444e25aa7c94a66f3f79bdaf83fc3cedc69bc))

## [1.3.1](https://github.com/ExaDev/odf.js/compare/v1.3.0...v1.3.1) (2026-07-31)

# [1.3.0](https://github.com/ExaDev/odf.js/compare/v1.2.0...v1.3.0) (2026-07-31)


### Features

* add ODF shared typed primitives (units, a1, colour, geometry, text, cascade, metadata) ([0580e8c](https://github.com/ExaDev/odf.js/commit/0580e8ccb39852a0f311c497dff393e02c1bed8e))

# [1.2.0](https://github.com/ExaDev/odf.js/compare/v1.1.0...v1.2.0) (2026-07-31)


### Features

* add ODF style interning (StyleRegistry, property serialization, span splitting) ([7d5d541](https://github.com/ExaDev/odf.js/commit/7d5d5415818040eeb05c92a136660e0d3db6a9e2))

# [1.1.0](https://github.com/ExaDev/odf.js/compare/v1.0.0...v1.1.0) (2026-07-31)


### Features

* add ODF namespaces, media types, mimetype part, and manifest read/write ([01a39e6](https://github.com/ExaDev/odf.js/commit/01a39e65dc56895e61290b1f14d50c36731d437a))

# 1.0.0 (2026-07-31)


### Features

* scaffold odf.js and build the lossless ZIP-of-XML core ([4c2794a](https://github.com/ExaDev/odf.js/commit/4c2794a88b6ad2adc054535a95272b9a86512983))
