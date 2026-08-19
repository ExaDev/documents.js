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
