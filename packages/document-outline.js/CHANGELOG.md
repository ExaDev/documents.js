## [1.0.3](https://github.com/ExaDev/documents.js/compare/document-outline.js@1.0.2...document-outline.js@1.0.3) (2026-08-20)


### Dependencies

- Updated document-schema.js to ^4.3.6

## [1.0.2](https://github.com/ExaDev/documents.js/compare/document-outline.js@1.0.1...document-outline.js@1.0.2) (2026-08-20)


### Bug Fixes

* point package homepage and bugs URLs at the monorepo, not the old standalone repos ([1b605e8](https://github.com/ExaDev/documents.js/commit/1b605e846393f417001227758a8606347c04e219))


### Dependencies

- Updated document-schema.js to ^4.3.5

## [1.0.1](https://github.com/ExaDev/documents.js/compare/document-outline.js@1.0.0...document-outline.js@1.0.1) (2026-08-20)


### Bug Fixes

* **document-outline.js:** project and resolve construct groups ([0f286d1](https://github.com/ExaDev/documents.js/commit/0f286d1480c3dc5d5ea88564039b87a5f9459f04))


### Dependencies

- Updated document-schema.js to ^4.3.4

# 1.0.0 (2026-08-19)


* feat!: re-charter around document-schema.js 4.0.0's tree-form DocumentPackage ([8ee22bc](https://github.com/ExaDev/document-outline.js/commit/8ee22bc975a1ec0012999e5ca2b066a32758e637))


### Bug Fixes

* depend on document-schema.js by its canonical name, not the npm alias ([e9661f7](https://github.com/ExaDev/document-outline.js/commit/e9661f74847c1b8b8c612368dce27ffd91335d9a))


### Features

* add flatten, leaf-text, and stable content-hash outline helpers ([35ca77c](https://github.com/ExaDev/document-outline.js/commit/35ca77cfbbe99a2830eef528397fbf8791cf5c2c))
* add the effective-property resolution seam for package trees ([16893cf](https://github.com/ExaDev/document-outline.js/commit/16893cfe63f0a045712513559bf89d94f7bd7889))
* build per-kind outlines over every ContentDocument kind ([3779e3e](https://github.com/ExaDev/document-outline.js/commit/3779e3eb2252f872325c5e7c4fac142fa3e110ef))
* decompose a DocumentPackage into per-container PackageNode groups ([db0133e](https://github.com/ExaDev/document-outline.js/commit/db0133e63ec0a12c58defc2aba001d99bba59a55))
* define the PackageNode tree types with hand-written structural guards ([bba5776](https://github.com/ExaDev/document-outline.js/commit/bba57761f6b28245ac10639a4807c6270ec38f6d)), closes [document-outline.js#2](https://github.com/document-outline.js/issues/2)
* define the recursive OutlineNode schema with a hand-written zod guard ([4d7d5b6](https://github.com/ExaDev/document-outline.js/commit/4d7d5b6778c9419452c7df237681c53705346e34))
* flatten a package tree back into its exact source ContentDocument ([1656aab](https://github.com/ExaDev/document-outline.js/commit/1656aabb4da281e09835c3e74e296490511033e2))


### BREAKING CHANGES

* removes decompose, flatten, documentEnvelope, the
DocumentEnvelope type, the PackageNode type family with
PackageNodeSchema and its guards, and effective/effectiveTree. The
lossless tree <-> flat transform now lives in documents.js's package
boundary; tree node types (PackageNode, PackageGroup, SectionGroupNode,
and the rest) import from document-schema.js, which this package now
requires at ^4.0.0.
