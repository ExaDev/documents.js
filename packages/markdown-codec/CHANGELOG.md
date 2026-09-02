## [6.1.2](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.1.1...markdown-codec%406.1.2) (2026-09-02)

### Miscellaneous Chores

* **deps:** bump document-schema.js to ^5.3.0 in markdown-codec [skip ci] ([996d22f](https://github.com/ExaDev/documents.js/commit/996d22f20dad985f9b7d0f52e941fddc5c4b964a))


### Dependencies

- Updated document-schema.js to ^5.3.0

## [6.1.1](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.1.0...markdown-codec%406.1.1) (2026-09-02)

### Miscellaneous Chores

* **deps:** bump document-schema.js to ^5.2.0 in markdown-codec [skip ci] ([a7df916](https://github.com/ExaDev/documents.js/commit/a7df916cb18ed97db693eec933ca5e4e5a268d0f))


### Dependencies

- Updated document-schema.js to ^5.2.0

## [6.1.0](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.0.0...markdown-codec%406.1.0) (2026-08-24)

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

* **deps:** bump document-schema.js to ^5.1.0 in markdown-codec [skip ci] ([37dd669](https://github.com/ExaDev/documents.js/commit/37dd6696707d482872e6bf05418bfe9e86136c5c))
* **deps:** drop the dependencies each package no longer uses ([80094aa](https://github.com/ExaDev/documents.js/commit/80094aa6db412392ef6e6457014d5963a5e910a7))


### Dependencies

- Updated document-schema.js to ^5.1.0

# [6.0.0](https://github.com/ExaDev/documents.js/compare/markdown-codec@5.0.3...markdown-codec@6.0.0) (2026-08-23)


* refactor(markdown-codec)!: rename DocumentPackage to DocumentTree ([23cb131](https://github.com/ExaDev/documents.js/commit/23cb131c76998410cd955e2adac767f0b2caddfd)), closes [#661](https://github.com/ExaDev/documents.js/issues/661)


### BREAKING CHANGES

* every DocumentPackage-rooted export this package
consumes or re-exports (DocumentTree, TreeNode/Group/Leaf and their
*Schema/isTreeX siblings, assembleTree, flattenTree) tracks
document-schema.js 5.0.0's rename.


### Dependencies

- Updated document-schema.js to ^5.0.0

## [5.0.3](https://github.com/ExaDev/documents.js/compare/markdown-codec@5.0.2...markdown-codec@5.0.3) (2026-08-23)


### Dependencies

- Updated document-schema.js to ^4.10.0

## [5.0.2](https://github.com/ExaDev/documents.js/compare/markdown-codec@5.0.1...markdown-codec@5.0.2) (2026-08-23)


### Dependencies

- Updated document-schema.js to ^4.9.1

## [5.0.1](https://github.com/ExaDev/documents.js/compare/markdown-codec@5.0.0...markdown-codec@5.0.1) (2026-08-22)


### Dependencies

- Updated document-schema.js to ^4.9.0

# [5.0.0](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.1.1...markdown-codec@5.0.0) (2026-08-22)

## [4.1.1](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.1.0...markdown-codec@4.1.1) (2026-08-21)

# [4.1.0](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.0.15...markdown-codec@4.1.0) (2026-08-21)


### Bug Fixes

* **documents.js:** pass construct markers through to markdown-codec's writer ([ea4c625](https://github.com/ExaDev/documents.js/commit/ea4c625c621fca63d82b37aa9527647bc99852ca))


### Features

* **markdown-codec:** blockquote container as a division construct pair ([c9d2fc0](https://github.com/ExaDev/documents.js/commit/c9d2fc0596c0ccee8406418e99d9ae859617607d))
* **markdown-codec:** carry a fence's info string as the code language plus quarantined remainder ([ee9c859](https://github.com/ExaDev/documents.js/commit/ee9c859d4eb5ae7b97d54fb52f7f1186f46fad9e))
* **markdown-codec:** carry link and image titles as link construct annotations ([579f09d](https://github.com/ExaDev/documents.js/commit/579f09dd44b7156d3d2196eb73efc9d25a608e11))
* **markdown-codec:** display math as an embedded formula document ([e4ff1d5](https://github.com/ExaDev/documents.js/commit/e4ff1d5b97df092650db3a410dbb020a6b3ea58f))
* **markdown-codec:** raw HTML restorable through quarantined markdown residue ([2a1fcb0](https://github.com/ExaDev/documents.js/commit/2a1fcb049d0c6d8548ee170c9d3332fb4f6f0a70))
* **markdown-codec:** reference definitions and front matter through the package tree ([697c4c6](https://github.com/ExaDev/documents.js/commit/697c4c68f49e00d6b9ee2d7aa8e24b1ffbc7275c))
* **markdown-codec:** task checkbox state and item identity on the list membership ([e948e4e](https://github.com/ExaDev/documents.js/commit/e948e4e66ca93de745324919fce5cac8df403a85))


### Dependencies

- Updated document-schema.js to ^4.8.0

## [4.0.15](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.0.14...markdown-codec@4.0.15) (2026-08-21)


### Dependencies

- Updated document-schema.js to ^4.7.0

## [4.0.14](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.0.13...markdown-codec@4.0.14) (2026-08-21)


### Dependencies

- Updated document-schema.js to ^4.6.0

## [4.0.13](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.0.12...markdown-codec@4.0.13) (2026-08-21)


### Dependencies

- Updated document-schema.js to ^4.5.0

## [4.0.12](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.0.11...markdown-codec@4.0.12) (2026-08-20)

## [4.0.11](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.0.10...markdown-codec@4.0.11) (2026-08-20)

## [4.0.10](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.0.9...markdown-codec@4.0.10) (2026-08-20)


### Dependencies

- Updated document-schema.js to ^4.3.7

## [4.0.9](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.0.8...markdown-codec@4.0.9) (2026-08-20)


### Dependencies

- Updated document-schema.js to ^4.3.6

## [4.0.8](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.0.7...markdown-codec@4.0.8) (2026-08-20)


### Bug Fixes

* point package homepage and bugs URLs at the monorepo, not the old standalone repos ([1b605e8](https://github.com/ExaDev/documents.js/commit/1b605e846393f417001227758a8606347c04e219))


### Dependencies

- Updated document-schema.js to ^4.3.5

## [4.0.7](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.0.6...markdown-codec@4.0.7) (2026-08-20)


### Dependencies

- Updated document-schema.js to ^4.3.4

# [4.0.0](https://github.com/ExaDev/markdown-codec/compare/v3.1.1...v4.0.0) (2026-08-19)


* feat(api)!: make readMarkdown/writeMarkdown DocumentPackage-native ([6ce1abf](https://github.com/ExaDev/markdown-codec/commit/6ce1abf840f6e1bf3620a2a283b3bf725b12fd76))


### Bug Fixes

* **write:** report dropped package tables and type flattenPackage's own errors ([4655d5e](https://github.com/ExaDev/markdown-codec/commit/4655d5e53f921287b989e98427f68883cf42c932))


### BREAKING CHANGES

* readMarkdown returns { documentPackage: DocumentPackage },
not { document: ContentDocument }; writeMarkdown accepts a DocumentPackage,
not a ContentDocument; and markdownCodec decodes to a DocumentPackage. A
caller that wants the previous flat behaviour should rename its calls to
readMarkdownContent, writeMarkdownContent, and markdownContentCodec, whose
signatures and behaviour are unchanged. The result field is documentPackage
rather than package because package is a reserved word in strict mode.

## [3.1.1](https://github.com/ExaDev/markdown-codec/compare/v3.1.0...v3.1.1) (2026-08-19)

# [3.1.0](https://github.com/ExaDev/markdown-codec/compare/v3.0.1...v3.1.0) (2026-08-18)


### Bug Fixes

* **block:** recognise a footnote definition following a still-open top-level list ([3309f63](https://github.com/ExaDev/markdown-codec/commit/3309f630de448a8b5bc8ce7c16a20cd4cc3de0a8))
* **emit:** decline to spell a footnote anchor name that would reparse as something else ([04b2e9e](https://github.com/ExaDev/markdown-codec/commit/04b2e9ec0fd433a43746ad6c4794e9898d55c7c0))


### Features

* lower a footnote definition to an anchor construct and its reference to a marked run ([afc72fe](https://github.com/ExaDev/markdown-codec/commit/afc72febdf440a8384b919d01155db4572b6d34f))
* parse GitHub footnote definitions and references ([0167c1c](https://github.com/ExaDev/markdown-codec/commit/0167c1c2a513c5217943f1638cf02ffa2143c0bb))
* render construct boundary markers back to markdown ([aa5d3b1](https://github.com/ExaDev/markdown-codec/commit/aa5d3b14d14ec728c6ec1ba2feea68be811df83c))

## [3.0.1](https://github.com/ExaDev/markdown-codec/compare/v3.0.0...v3.0.1) (2026-08-18)

# [3.0.0](https://github.com/ExaDev/markdown-codec/compare/v2.0.0...v3.0.0) (2026-08-18)


* feat!: migrate to document-schema.js 4.0.0 (formatVersion retired, depth-only list memberships) ([226463a](https://github.com/ExaDev/markdown-codec/commit/226463a7b43ba788369b50c9b0004437d623c04b))


### BREAKING CHANGES

* readMarkdown's emitted ContentDocuments no longer
carry formatVersion and validate against document-schema.js 4;
consumers still validating against schema 3 must move to 4.

# [2.0.0](https://github.com/ExaDev/markdown-codec/compare/v1.4.2...v2.0.0) (2026-08-17)


* feat!: populate canonical headingLevel on read and clamp write-side levels via the shared helper ([32bc2de](https://github.com/ExaDev/markdown-codec/commit/32bc2de55c5945356ec6375c763043f598192c0c)), closes [#-depth](https://github.com/ExaDev/markdown-codec/issues/-depth)


### BREAKING CHANGES

* readMarkdown's emitted ContentDocuments now carry
CONTENT_FORMAT_VERSION 3 and validate against document-schema.js 3;
consumers still validating against schema 2 must move to 3.

## [1.4.2](https://github.com/ExaDev/markdown-codec/compare/v1.4.1...v1.4.2) (2026-08-17)

## [1.4.1](https://github.com/ExaDev/markdown-codec/compare/v1.4.0...v1.4.1) (2026-08-17)

# [1.4.0](https://github.com/ExaDev/markdown-codec/compare/v1.3.31...v1.4.0) (2026-08-17)


### Features

* recognise $$ display math and \( \) inline math ([f21ee9b](https://github.com/ExaDev/markdown-codec/commit/f21ee9b8f774cd092b70bf26ce6f7ca17c1693d4)), closes [ExaDev/documents.js#563](https://github.com/ExaDev/documents.js/issues/563)

## [1.3.31](https://github.com/ExaDev/markdown-codec/compare/v1.3.30...v1.3.31) (2026-08-17)

## [1.3.30](https://github.com/ExaDev/markdown-codec/compare/v1.3.29...v1.3.30) (2026-08-17)

## [1.3.29](https://github.com/ExaDev/markdown-codec/compare/v1.3.28...v1.3.29) (2026-08-17)

## [1.3.28](https://github.com/ExaDev/markdown-codec/compare/v1.3.27...v1.3.28) (2026-08-17)

## [1.3.27](https://github.com/ExaDev/markdown-codec/compare/v1.3.26...v1.3.27) (2026-08-17)

## [1.3.26](https://github.com/ExaDev/markdown-codec/compare/v1.3.25...v1.3.26) (2026-08-17)

## [1.3.25](https://github.com/ExaDev/markdown-codec/compare/v1.3.24...v1.3.25) (2026-08-17)

## [1.3.24](https://github.com/ExaDev/markdown-codec/compare/v1.3.23...v1.3.24) (2026-08-17)

## [1.3.23](https://github.com/ExaDev/markdown-codec/compare/v1.3.22...v1.3.23) (2026-08-14)

## [1.3.22](https://github.com/ExaDev/markdown-codec/compare/v1.3.21...v1.3.22) (2026-08-13)

## [1.3.21](https://github.com/ExaDev/markdown-codec/compare/v1.3.20...v1.3.21) (2026-08-13)

## [1.3.20](https://github.com/ExaDev/markdown-codec/compare/v1.3.19...v1.3.20) (2026-08-12)

## [1.3.19](https://github.com/ExaDev/markdown-codec/compare/v1.3.18...v1.3.19) (2026-08-12)

## [1.3.18](https://github.com/ExaDev/markdown-codec/compare/v1.3.17...v1.3.18) (2026-08-12)

## [1.3.17](https://github.com/ExaDev/markdown-codec/compare/v1.3.16...v1.3.17) (2026-08-12)

## [1.3.16](https://github.com/ExaDev/markdown-codec/compare/v1.3.15...v1.3.16) (2026-08-12)


### Bug Fixes

* **ci:** exempt dependabot commits from commitlint body-line-length ([f34e8c4](https://github.com/ExaDev/markdown-codec/commit/f34e8c47dafd49fe399eb0ca9d62a13fcaff6a3c))

## [1.3.15](https://github.com/ExaDev/markdown-codec/compare/v1.3.14...v1.3.15) (2026-08-12)

## [1.3.14](https://github.com/ExaDev/markdown-codec/compare/v1.3.13...v1.3.14) (2026-08-12)

## [1.3.13](https://github.com/ExaDev/markdown-codec/compare/v1.3.12...v1.3.13) (2026-08-12)

## [1.3.12](https://github.com/ExaDev/markdown-codec/compare/v1.3.11...v1.3.12) (2026-08-12)

## [1.3.11](https://github.com/ExaDev/markdown-codec/compare/v1.3.10...v1.3.11) (2026-08-12)

## [1.3.10](https://github.com/ExaDev/markdown-codec/compare/v1.3.9...v1.3.10) (2026-08-10)

## [1.3.9](https://github.com/ExaDev/markdown-codec/compare/v1.3.8...v1.3.9) (2026-08-10)

## [1.3.8](https://github.com/ExaDev/markdown-codec/compare/v1.3.7...v1.3.8) (2026-08-08)

## [1.3.7](https://github.com/ExaDev/markdown-codec/compare/v1.3.6...v1.3.7) (2026-08-08)

## [1.3.6](https://github.com/ExaDev/markdown-codec/compare/v1.3.5...v1.3.6) (2026-08-07)

## [1.3.5](https://github.com/ExaDev/markdown-codec/compare/v1.3.4...v1.3.5) (2026-08-07)

## [1.3.4](https://github.com/ExaDev/markdown-codec/compare/v1.3.3...v1.3.4) (2026-08-07)

## [1.3.3](https://github.com/ExaDev/markdown-codec/compare/v1.3.2...v1.3.3) (2026-08-07)

## [1.3.2](https://github.com/ExaDev/markdown-codec/compare/v1.3.1...v1.3.2) (2026-08-07)

## [1.3.1](https://github.com/ExaDev/markdown-codec/compare/v1.3.0...v1.3.1) (2026-08-07)

# [1.3.0](https://github.com/ExaDev/markdown-codec/compare/v1.2.5...v1.3.0) (2026-08-07)


### Features

* ban split-statement import-then-export re-exports ([38e01cb](https://github.com/ExaDev/markdown-codec/commit/38e01cb8667c57d2b6d5d301be57cd2cdb5c0d5a))

## [1.2.5](https://github.com/ExaDev/markdown-codec/compare/v1.2.4...v1.2.5) (2026-08-07)

## [1.2.4](https://github.com/ExaDev/markdown-codec/compare/v1.2.3...v1.2.4) (2026-08-07)

## [1.2.3](https://github.com/ExaDev/markdown-codec/compare/v1.2.2...v1.2.3) (2026-08-06)

## [1.2.2](https://github.com/ExaDev/markdown-codec/compare/v1.2.1...v1.2.2) (2026-08-06)

## [1.2.1](https://github.com/ExaDev/markdown-codec/compare/v1.2.0...v1.2.1) (2026-08-06)

# [1.2.0](https://github.com/ExaDev/markdown-codec/compare/v1.1.25...v1.2.0) (2026-08-06)


### Features

* cache typecheck/lint/test/build tasks with turbo ([14e9604](https://github.com/ExaDev/markdown-codec/commit/14e9604c6abaf486d07897402c4a962822ce8f39))

## [1.1.25](https://github.com/ExaDev/markdown-codec/compare/v1.1.24...v1.1.25) (2026-08-06)

## [1.1.24](https://github.com/ExaDev/markdown-codec/compare/v1.1.23...v1.1.24) (2026-08-06)

## [1.1.23](https://github.com/ExaDev/markdown-codec/compare/v1.1.22...v1.1.23) (2026-08-06)

## [1.1.22](https://github.com/ExaDev/markdown-codec/compare/v1.1.21...v1.1.22) (2026-08-06)

## [1.1.21](https://github.com/ExaDev/markdown-codec/compare/v1.1.20...v1.1.21) (2026-08-06)

## [1.1.20](https://github.com/ExaDev/markdown-codec/compare/v1.1.19...v1.1.20) (2026-08-06)

## [1.1.19](https://github.com/ExaDev/markdown-codec/compare/v1.1.18...v1.1.19) (2026-08-06)

## [1.1.18](https://github.com/ExaDev/markdown-codec/compare/v1.1.17...v1.1.18) (2026-08-06)

## [1.1.17](https://github.com/ExaDev/markdown-codec/compare/v1.1.16...v1.1.17) (2026-08-06)

## [1.1.16](https://github.com/ExaDev/markdown-codec/compare/v1.1.15...v1.1.16) (2026-08-06)

## [1.1.15](https://github.com/ExaDev/markdown-codec/compare/v1.1.14...v1.1.15) (2026-08-06)

## [1.1.14](https://github.com/ExaDev/markdown-codec/compare/v1.1.13...v1.1.14) (2026-08-05)

## [1.1.13](https://github.com/ExaDev/markdown-codec/compare/v1.1.12...v1.1.13) (2026-08-05)

## [1.1.12](https://github.com/ExaDev/markdown-codec/compare/v1.1.11...v1.1.12) (2026-08-05)

## [1.1.11](https://github.com/ExaDev/markdown-codec/compare/v1.1.10...v1.1.11) (2026-08-05)

## [1.1.10](https://github.com/ExaDev/markdown-codec/compare/v1.1.9...v1.1.10) (2026-08-05)

## [1.1.9](https://github.com/ExaDev/markdown-codec/compare/v1.1.8...v1.1.9) (2026-08-05)

## [1.1.8](https://github.com/ExaDev/markdown-codec/compare/v1.1.7...v1.1.8) (2026-08-05)

## [1.1.7](https://github.com/ExaDev/markdown-codec/compare/v1.1.6...v1.1.7) (2026-08-04)

## [1.1.6](https://github.com/ExaDev/markdown-codec/compare/v1.1.5...v1.1.6) (2026-08-04)

## [1.1.5](https://github.com/ExaDev/markdown-codec/compare/v1.1.4...v1.1.5) (2026-08-04)

## [1.1.4](https://github.com/ExaDev/markdown-codec/compare/v1.1.3...v1.1.4) (2026-08-04)

## [1.1.3](https://github.com/ExaDev/markdown-codec/compare/v1.1.2...v1.1.3) (2026-08-04)

## [1.1.2](https://github.com/ExaDev/markdown-codec/compare/v1.1.1...v1.1.2) (2026-08-04)

## [1.1.1](https://github.com/ExaDev/markdown-codec/compare/v1.1.0...v1.1.1) (2026-08-04)

# [1.1.0](https://github.com/ExaDev/markdown-codec/compare/v1.0.10...v1.1.0) (2026-08-03)


### Features

* export internal style-constants and list-id vocabulary for sibling packages ([a9c2fac](https://github.com/ExaDev/markdown-codec/commit/a9c2fac1897b9731a4928d57ee5b0ae68af2b087))

## [1.0.10](https://github.com/ExaDev/markdown-codec/compare/v1.0.9...v1.0.10) (2026-08-03)

## [1.0.9](https://github.com/ExaDev/markdown-codec/compare/v1.0.8...v1.0.9) (2026-08-03)


### Bug Fixes

* **ci:** use pull_request_target so dependabot auto-merge can read secrets ([f0dfce7](https://github.com/ExaDev/markdown-codec/commit/f0dfce773c5715e60c00b07525b8cb5bad7fa6fc))

## [1.0.8](https://github.com/ExaDev/markdown-codec/compare/v1.0.7...v1.0.8) (2026-08-03)


### Bug Fixes

* **ci:** wait for a real check-run to register before requesting auto-merge ([bdd906d](https://github.com/ExaDev/markdown-codec/commit/bdd906d31a16c2eaaf68bbee1d63e44fa638098b))

## [1.0.7](https://github.com/ExaDev/markdown-codec/compare/v1.0.6...v1.0.7) (2026-08-03)


### Bug Fixes

* **ci:** use the GitHub App token for the branch push and PR creation too ([8f536da](https://github.com/ExaDev/markdown-codec/commit/8f536dae04c3e2c4f1bc349b5d1e00b4b17e0f88))

## [1.0.6](https://github.com/ExaDev/markdown-codec/compare/v1.0.5...v1.0.6) (2026-08-03)


### Bug Fixes

* **ci:** wrap the sibling-bump commit body onto two lines under commitlint's limit ([a8dfc97](https://github.com/ExaDev/markdown-codec/commit/a8dfc97750a8ae4cc1b1232ce85c25e5540b3eb7))

## [1.0.5](https://github.com/ExaDev/markdown-codec/compare/v1.0.4...v1.0.5) (2026-08-03)


### Bug Fixes

* **ci:** use single-quoted string literals in workflow if-conditions ([e6d5bf1](https://github.com/ExaDev/markdown-codec/commit/e6d5bf184e1894d6770925cf345e4e5a10714887))

## [1.0.4](https://github.com/ExaDev/markdown-codec/compare/v1.0.3...v1.0.4) (2026-08-03)

## [1.0.3](https://github.com/ExaDev/markdown-codec/compare/v1.0.2...v1.0.3) (2026-08-03)

## [1.0.2](https://github.com/ExaDev/markdown-codec/compare/v1.0.1...v1.0.2) (2026-08-03)

## [1.0.1](https://github.com/ExaDev/markdown-codec/compare/v1.0.0...v1.0.1) (2026-08-03)

# 1.0.0 (2026-08-03)


### Bug Fixes

* force tsdown's unrun config loader in the prepare script ([1134222](https://github.com/ExaDev/markdown-codec/commit/11342229e6e6b7c0a773af199b1d0352611c9c6b))
* recognise ftp:// extended autolinks and reject email addresses ending in - or _ ([873b900](https://github.com/ExaDev/markdown-codec/commit/873b900152f727c8df7307eb07b30a499b179d8e))
* ship a prebuilt dist to make git-dependency consumption reliable ([beda0a8](https://github.com/ExaDev/markdown-codec/commit/beda0a89d92fffd153d5dcd05d767b404b721cda))


### Features

* add CommonMark-HTML conformance oracle ([1c3dec4](https://github.com/ExaDev/markdown-codec/commit/1c3dec4669fdd48dd82c7cb2dfea3b3939e278b3))
* add L0 primitives (diagnostics, ast, options, scan, image, entity table) ([bbed266](https://github.com/ExaDev/markdown-codec/commit/bbed266f929deec6927a7d1cc0df10257d62119f))
* implement block phase (containers, lists, tables, setext headings) ([09b2b5a](https://github.com/ExaDev/markdown-codec/commit/09b2b5a367a1db31aa0d9be4a2d3ab630742df6c))
* implement inline phase (emphasis, links, autolinks, entities) ([20d41f4](https://github.com/ExaDev/markdown-codec/commit/20d41f41586fd36b48e7d2afecc9ff3d052220ee))
* map AST to and from ContentDocument ([6740d83](https://github.com/ExaDev/markdown-codec/commit/6740d83bcc7e397af4696b896f4560b5fd2a386b))
* wire public readMarkdown/writeMarkdown API and pass CommonMark+GFM conformance ([d9afdb6](https://github.com/ExaDev/markdown-codec/commit/d9afdb68887c51b07e38137b1d83e846e07d80d0))
