## [1.11.2](https://github.com/ExaDev/document-cli/compare/v1.11.1...v1.11.2) (2026-08-04)

## [1.11.1](https://github.com/ExaDev/document-cli/compare/v1.11.0...v1.11.1) (2026-08-04)

# [1.11.0](https://github.com/ExaDev/document-cli/compare/v1.10.0...v1.11.0) (2026-08-04)


### Features

* **tui:** add markdown open diagnostics and the :view-source command ([ec13b7c](https://github.com/ExaDev/document-cli/commit/ec13b7c347cf52a97ba31a4626b9b892ed0f2869))
* **tui:** replace markdown line-editor state with a live-view MarkdownEditor ([c2be6f1](https://github.com/ExaDev/document-cli/commit/c2be6f1d0313391e25fc8f9e307d13c7779e086c))
* **tui:** wire markdown into the shared paragraph/run/table screens ([85547b5](https://github.com/ExaDev/document-cli/commit/85547b57a77be825624ac534f16e5a163d992f6a))

# [1.10.0](https://github.com/ExaDev/document-cli/compare/v1.9.0...v1.10.0) (2026-08-04)


### Features

* give pdf documents a real live-view editor in the TUI ([e8d57c3](https://github.com/ExaDev/document-cli/commit/e8d57c3006786a02d1f3378540dd0dc3862243db))

# [1.9.0](https://github.com/ExaDev/document-cli/compare/v1.8.0...v1.9.0) (2026-08-04)


### Features

* **tui:** add cell formula editing and floating image insertion to ods ([3a176e4](https://github.com/ExaDev/document-cli/commit/3a176e446f867fb3b325cc7f95c5f58ca509286b))
* **tui:** add list/vector-host/formula/image/font-styling actions ([7b58296](https://github.com/ExaDev/document-cli/commit/7b58296f498174cff00c0d92a50cde44744d9f71))
* **tui:** add odp vector-primitive creation to the slide-detail screen ([5fac7c0](https://github.com/ExaDev/document-cli/commit/5fac7c07c48df8e36a43966b8b7555f7e626bb36))
* **tui:** add run font family and size editing to paragraph-detail ([7732487](https://github.com/ExaDev/document-cli/commit/77324876eb9b3652b1c104efc2c1efe62c5ce3aa))
* **tui:** create a new odt list from the body list screen ([8bc4f28](https://github.com/ExaDev/document-cli/commit/8bc4f289d7fe206864e9a5fc441baf0b8a18287e))

# [1.8.0](https://github.com/ExaDev/document-cli/compare/v1.7.0...v1.8.0) (2026-08-04)


### Features

* **tui:** add a formula preset library and shared formula picker ([e8d50c9](https://github.com/ExaDev/document-cli/commit/e8d50c9239ca8ea201ab855a7583f16c7c74acb9))
* **tui:** insert images and formulas into docx/odt paragraphs ([3d2ab25](https://github.com/ExaDev/document-cli/commit/3d2ab25bc5f828f59fa62ad8718fa61cd2c66e4a))

# [1.7.0](https://github.com/ExaDev/document-cli/compare/v1.6.0...v1.7.0) (2026-08-04)


### Features

* **docx,odt:** merge table cells at creation and retrofit, add table wizard ([0ab41a4](https://github.com/ExaDev/document-cli/commit/0ab41a4a3a3014cd8c306925ef2b81383ce17249))
* **ods:** merge spreadsheet cells via a range-select-then-merge grid flow ([4b081cd](https://github.com/ExaDev/document-cli/commit/4b081cd07dcb29b56d4cb335577c3b83b6f0a972))
* **pptx,odp:** browse and merge cells in a slide's own tables ([ad44d1f](https://github.com/ExaDev/document-cli/commit/ad44d1f3fe7d4b2afc13b1faa15b7b96ce4ac0d1))
* **state:** add cell-merge actions for ods sheets, docx/odt tables, slide tables ([867093d](https://github.com/ExaDev/document-cli/commit/867093d8d5a7f86172bf31130ff2faa2838a384a))

# [1.6.0](https://github.com/ExaDev/document-cli/compare/v1.5.0...v1.6.0) (2026-08-04)


### Features

* **tui:** edit an odg vector's fill and stroke through the live editor ([17f794e](https://github.com/ExaDev/document-cli/commit/17f794eed2c3a4f9e21ba3d7ff1c69a0984946a6))
* **tui:** rotate pptx shapes and edit real odt list-item text ([7f2762a](https://github.com/ExaDev/document-cli/commit/7f2762a7d19aa640d452b7b2c57bc0a941aa38a0))
* **tui:** wire the built-in UNDO action up to Ctrl+Z and :undo ([617e17b](https://github.com/ExaDev/document-cli/commit/617e17bb5983857063f9a64f233da2fd1611a39d))

# [1.5.0](https://github.com/ExaDev/document-cli/compare/v1.4.0...v1.5.0) (2026-08-04)


### Features

* add a read-only metadata screen to the TUI ([0bbb80b](https://github.com/ExaDev/document-cli/commit/0bbb80bfd5c51d910c2d0fc1125af4a9848664a2))
* add metadata and set-metadata commands ([d85312a](https://github.com/ExaDev/document-cli/commit/d85312af70745cee96fd65cfc4f02e3fcc884b91))

# [1.4.0](https://github.com/ExaDev/document-cli/compare/v1.3.0...v1.4.0) (2026-08-04)


### Bug Fixes

* **pdf-inspect:** tag --full dump with $schema for round-tripping ([a6c838f](https://github.com/ExaDev/document-cli/commit/a6c838f007fad7e1148f4264ce994e85da20351b))


### Features

* **docx-extras:** add a command and TUI screen for docx-only extras ([0e4651f](https://github.com/ExaDev/document-cli/commit/0e4651fffb3eb00e5e61aa93b6d508a51a3e1d58))
* **fonts:** add a command listing source-embedded font faces ([a6f8734](https://github.com/ExaDev/document-cli/commit/a6f873434b0df6e9d8fa0b831b6de78a6babb687))

# [1.3.0](https://github.com/ExaDev/document-cli/compare/v1.2.11...v1.3.0) (2026-08-03)


### Features

* add odb-query and odb-render-report commands ([0035d3c](https://github.com/ExaDev/document-cli/commit/0035d3c27268ba980fc43bdf38faa3fd7ff1c2c4))
* wire report rendering into the odb TUI's report detail screen ([c92b15f](https://github.com/ExaDev/document-cli/commit/c92b15fc23a6a5473eefe44d1ed91098cb1565a6))

## [1.2.11](https://github.com/ExaDev/document-cli/compare/v1.2.10...v1.2.11) (2026-08-03)

## [1.2.10](https://github.com/ExaDev/document-cli/compare/v1.2.9...v1.2.10) (2026-08-03)


### Bug Fixes

* **ci:** use pull_request_target so dependabot auto-merge can read secrets ([69b612d](https://github.com/ExaDev/document-cli/commit/69b612ddaa05de57ed153bb2e32479e6be75ecaa))

## [1.2.9](https://github.com/ExaDev/document-cli/compare/v1.2.8...v1.2.9) (2026-08-03)


### Bug Fixes

* **ci:** wait for a real check-run to register before requesting auto-merge ([e1b83dc](https://github.com/ExaDev/document-cli/commit/e1b83dcc2699e28a2c1de642dc2e03b87a853b58))

## [1.2.8](https://github.com/ExaDev/document-cli/compare/v1.2.7...v1.2.8) (2026-08-03)


### Bug Fixes

* **ci:** use the GitHub App token for the branch push and PR creation too ([7348c1e](https://github.com/ExaDev/document-cli/commit/7348c1e1e8cc9d08bfe6af2f99fe8cfaa90ec966))

## [1.2.7](https://github.com/ExaDev/document-cli/compare/v1.2.6...v1.2.7) (2026-08-03)


### Bug Fixes

* **ci:** wrap the sibling-bump commit body onto two lines under commitlint's limit ([9e0c467](https://github.com/ExaDev/document-cli/commit/9e0c4671ad72031415d7de197ae276bbc8ac9846))

## [1.2.6](https://github.com/ExaDev/document-cli/compare/v1.2.5...v1.2.6) (2026-08-03)

## [1.2.5](https://github.com/ExaDev/document-cli/compare/v1.2.4...v1.2.5) (2026-08-03)

## [1.2.4](https://github.com/ExaDev/document-cli/compare/v1.2.3...v1.2.4) (2026-08-03)

## [1.2.3](https://github.com/ExaDev/document-cli/compare/v1.2.2...v1.2.3) (2026-08-03)

## [1.2.2](https://github.com/ExaDev/document-cli/compare/v1.2.1...v1.2.2) (2026-08-03)

## [1.2.1](https://github.com/ExaDev/document-cli/compare/v1.2.0...v1.2.1) (2026-08-03)

# [1.2.0](https://github.com/ExaDev/document-cli/compare/v1.1.0...v1.2.0) (2026-08-03)


### Bug Fixes

* list odb-forms, odb-reports, and from-package in the formats command's pointer ([c53b850](https://github.com/ExaDev/document-cli/commit/c53b850e4c47efb1c06f394ee2d4058524764c2b))


### Features

* add a command to convert from a previously-dumped DocumentPackage ([8fde4b0](https://github.com/ExaDev/document-cli/commit/8fde4b09ca8056f54089e37dd06d9cf7d3f7f427))
* add odb-forms and odb-reports commands ([7fe6572](https://github.com/ExaDev/document-cli/commit/7fe6572a54fe815e4b1d22faace21e0431e22aae))
* embed caller-supplied fonts in every pdf-producing conversion ([35e384f](https://github.com/ExaDev/document-cli/commit/35e384fc847cb1992d635a58d9d5fa0d8b63098c))
* **tui:** browse .odb forms and reports alongside its tables ([628cbdf](https://github.com/ExaDev/document-cli/commit/628cbdf73c50a7752f54c82fddc3c58c6dc44b37))
* **tui:** create a table on the current pptx/odp slide ([f2292ad](https://github.com/ExaDev/document-cli/commit/f2292ade73471c27b628db57a34bf80962f63305))
* **tui:** expose speaker notes editing for pptx slides too ([15858b2](https://github.com/ExaDev/document-cli/commit/15858b2e1e7754fc8ddd5c6f2ec11737ef621e7b))
* **tui:** open .xlsx as a read-only PDF preview instead of a dead end ([528aff0](https://github.com/ExaDev/document-cli/commit/528aff0df9387352b7a75479302830639756100f))
* **tui:** pick local font files before exporting to PDF ([b1ea6ab](https://github.com/ExaDev/document-cli/commit/b1ea6abfd0ab348c5301d084f32f65f144301b61))

# [1.1.0](https://github.com/ExaDev/document-cli/compare/v1.0.1...v1.1.0) (2026-08-02)


### Bug Fixes

* allowlist markdown-codec's prepare script for this project too ([cf0e6fa](https://github.com/ExaDev/document-cli/commit/cf0e6fa0658bf2010a8d16804df26678cad66efe))


### Features

* add a markdown line editor and writable-format save/export support ([0444a1e](https://github.com/ExaDev/document-cli/commit/0444a1e37d540dfa963849ee9b9cf4b9a19caddf))

## [1.0.1](https://github.com/ExaDev/document-cli/compare/v1.0.0...v1.0.1) (2026-08-02)

# 1.0.0 (2026-08-02)


### Features

* implement the CLI and Ink TUI ([58c6842](https://github.com/ExaDev/document-cli/commit/58c684262e6a5e9580fd2d3388d05745a1fe7056))
