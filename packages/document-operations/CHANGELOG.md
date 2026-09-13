## [1.1.7](https://github.com/ExaDev/documents.js/compare/document-operations%401.1.6...document-operations%401.1.7) (2026-09-13)

### Code Refactoring

* **document-operations:** drop unreachable math/font diagnostics wiring ([e263c9f](https://github.com/ExaDev/documents.js/commit/e263c9faabf606d5cbf92398e99e5783f0cbbf43))
* **document-operations:** hoist convertDocumentOperation's diagnostics flag ([da4ea4f](https://github.com/ExaDev/documents.js/commit/da4ea4f16259355a4b6049b9f17b8a0bf3745f77))
* **document-operations:** simplify the standalone-formula test fixture ([70b9f15](https://github.com/ExaDev/documents.js/commit/70b9f152ba12a1f3855a02c4bce0ef3bdf24c8e3))

### Tests

* **document-operations:** anchor the no-saved-queries error assertion ([4fef5b9](https://github.com/ExaDev/documents.js/commit/4fef5b99962a38c1fa3da83a24a1cba7558308a3))
* **document-operations:** assert DOCUMENT_OPERATIONS lists every operation exactly once ([fa4b638](https://github.com/ExaDev/documents.js/commit/fa4b638f57bf964332103eaebfe69c1f42bb184f))
* **document-operations:** cover convert_document's font substitution, images map, and output path ([22bb033](https://github.com/ExaDev/documents.js/commit/22bb0334313aa00cfeb5ab0b6070c3598cb4d358))
* **document-operations:** cover describe_font_file's path-based input branch ([c585e9a](https://github.com/ExaDev/documents.js/commit/c585e9a3de90455125cbb7856a0975ce1b81807c))
* **document-operations:** cover from_package's path input and its two schema-validation rejections ([864ada1](https://github.com/ExaDev/documents.js/commit/864ada1a418862a8006f83698b4a2577dcfba479))
* **document-operations:** cover inferFormatFromExtension and resolveDocumentInput directly ([127c65e](https://github.com/ExaDev/documents.js/commit/127c65e1010e3e7e5bcfecdadec898605a6eb142))
* **document-operations:** cover inferFormatFromExtension's no-dot edge cases ([14c37c3](https://github.com/ExaDev/documents.js/commit/14c37c329147814f837b0ebb227d5ac211daf514))
* **document-operations:** cover odb_query's saved-query resolution and path-based inputs ([d2820ee](https://github.com/ExaDev/documents.js/commit/d2820ee9737c83b7ca9f34c67a7796cf09e89997))
* **document-operations:** cover odb_render_report's pdf branch and a real char substitution ([a3ae36a](https://github.com/ExaDev/documents.js/commit/a3ae36a80ea9826bf72e1a95689a4b53324bb69f))
* **document-operations:** cover odm_to_pdf's path input and chaptersDir resolution ([3b59a04](https://github.com/ExaDev/documents.js/commit/3b59a04588000d9e3072b522ca7ef8f184b940d5))
* **document-operations:** cover outline_document's standalone embedded-object leaf ([bd7c623](https://github.com/ExaDev/documents.js/commit/bd7c62333fc735660033bb45bc348c1cb7a014db))
* **document-operations:** cover resolveDocumentOutput's write/inline and large-result paths ([1785ca4](https://github.com/ExaDev/documents.js/commit/1785ca42d90d89b181c5ac30628af2976c0dbf1c))
* **document-operations:** drop odm-fixture's unread mimetype entries ([bcf97b3](https://github.com/ExaDev/documents.js/commit/bcf97b3a672812e9cae415db51267e859ccef6dd))
* **document-operations:** pare the char-substitution manifest to what readOdbTables needs ([ee04a6a](https://github.com/ExaDev/documents.js/commit/ee04a6aef66bbafc2f83a709d2ab5c3835b68688))
* **document-operations:** propagate an aborted signal through compute_formula ([70ba273](https://github.com/ExaDev/documents.js/commit/70ba2739027212a244201ac7b05680e686e8934a))
* **document-operations:** prove abort-signal tests fail on signal, not fs ([ee17752](https://github.com/ExaDev/documents.js/commit/ee1775288a9e5e45fdb48e7132ef6692f3ec20aa))
* **document-operations:** verify describeFontFile's inline-bytes error label ([7e17bbd](https://github.com/ExaDev/documents.js/commit/7e17bbdec6ac01f409cbd22d57d94d79db5d34f2))
* **document-operations:** verify editor writers produce genuine per-format output ([66275ad](https://github.com/ExaDev/documents.js/commit/66275ad72e9c97d12a4106ed1df5c764793d4428))
* **document-operations:** verify every editor field actually lands on the decoded document ([ad1c053](https://github.com/ExaDev/documents.js/commit/ad1c0532ed61d0a267dbcd0699c423fcbd9edad4))
* **document-operations:** verify fromPackageOperation's raw decode and cause ([66313e0](https://github.com/ExaDev/documents.js/commit/66313e007097ee11b6c4ce1aca8f8f27cbf3ff45))
* **document-operations:** verify odbRenderReportOperation's own bytes and abort ([e7c330e](https://github.com/ExaDev/documents.js/commit/e7c330ee9d83f8fc0415580d7b8e5a833f79f19c))
* **document-operations:** verify outline group/leaf structure and a real formula leaf ([e6742bc](https://github.com/ExaDev/documents.js/commit/e6742bc1c563f45c299eb69861021522fe729308))
* **document-operations:** verify pdf_inspect's histogram content and full: true ([f7620ca](https://github.com/ExaDev/documents.js/commit/f7620caf954c98b985f16b802e1a245326c5ca0f))
* **document-operations:** verify the saved-query "Available" name list ([e8d8bca](https://github.com/ExaDev/documents.js/commit/e8d8bca5a8daa23f3ccf7b6f01915bf8cf670882))

### Miscellaneous Chores

* **document-operations:** set the mutation break threshold to 100 ([41afbd7](https://github.com/ExaDev/documents.js/commit/41afbd7d4d2e065526233cbb75a723ecdaa231fe))


### Dependencies

- Updated document-schema.js to 7.11.2
- Updated odf.js to 7.25.3
- Updated document-outline.js to 3.8.0
- Updated documents.js to 7.20.7
- Updated document-compute.js to 1.5.10

## [1.1.6](https://github.com/ExaDev/documents.js/compare/document-operations%401.1.5...document-operations%401.1.6) (2026-09-12)


### Dependencies

- Updated documents.js to 7.20.6
- Updated document-compute.js to 1.5.9

## [1.1.5](https://github.com/ExaDev/documents.js/compare/document-operations%401.1.4...document-operations%401.1.5) (2026-09-12)


### Dependencies

- Updated documents.js to 7.20.5
- Updated document-compute.js to 1.5.8

## [1.1.4](https://github.com/ExaDev/documents.js/compare/document-operations%401.1.3...document-operations%401.1.4) (2026-09-12)


### Dependencies

- Updated document-outline.js to 3.7.3
- Updated documents.js to 7.20.4
- Updated document-compute.js to 1.5.7

## [1.1.3](https://github.com/ExaDev/documents.js/compare/document-operations%401.1.2...document-operations%401.1.3) (2026-09-11)


### Dependencies

- Updated document-compute.js to 1.5.6

## [1.1.2](https://github.com/ExaDev/documents.js/compare/document-operations%401.1.1...document-operations%401.1.2) (2026-09-11)


### Dependencies

- Updated documents.js to 7.20.3
- Updated document-compute.js to 1.5.5

## [1.1.1](https://github.com/ExaDev/documents.js/compare/document-operations%401.1.0...document-operations%401.1.1) (2026-09-11)


### Dependencies

- Updated odf.js to 7.25.2
- Updated documents.js to 7.20.2
- Updated document-compute.js to 1.5.4

## [1.1.0](https://github.com/ExaDev/documents.js/compare/document-operations%401.0.0...document-operations%401.1.0) (2026-09-11)

### Features

* **document-rest:** add a plain REST API server over document-operations ([5f6e748](https://github.com/ExaDev/documents.js/commit/5f6e7481a731f80e30a584a1a1614b42b0a956fe))

## 1.0.0 (2026-09-11)

### Features

* **document-operations:** add the canonical document-mcp operation registry ([06c310f](https://github.com/ExaDev/documents.js/commit/06c310f4077164b9fe21258d12dd52fa560fd3fd))
