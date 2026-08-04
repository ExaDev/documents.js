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
