## [2.1.1](https://github.com/ExaDev/documents.js/compare/document-outline.js@2.1.0...document-outline.js@2.1.1) (2026-08-23)


### Dependencies

- Updated document-schema.js to ^4.9.1

# [2.1.0](https://github.com/ExaDev/documents.js/compare/document-outline.js@2.0.0...document-outline.js@2.1.0) (2026-08-22)


### Features

* **outline:** mint order keys beyond either end of a sibling list ([7effc2e](https://github.com/ExaDev/documents.js/commit/7effc2e2071701c1bc3ab2506b7ae8283b74b212))

# [2.0.0](https://github.com/ExaDev/documents.js/compare/document-outline.js@1.1.0...document-outline.js@2.0.0) (2026-08-22)


* feat(outline)!: harden the property graph for use as a persistent store ([cc4566a](https://github.com/ExaDev/documents.js/commit/cc4566ad53cb4b3b2cb59dc615db8951dd49642f)), closes [ExaDev/documents.js#660](https://github.com/ExaDev/documents.js/issues/660)


### Features

* **outline:** add fractional order keys for graph edges ([19dc62a](https://github.com/ExaDev/documents.js/commit/19dc62a9b5ab55062bbcc2ec24d1494e5d38c7bd))


### BREAKING CHANGES

* GraphEdge.order (number) is replaced by
GraphEdge.orderKey (string). A consumer sorting or comparing edges by
the old dense integer must switch to lexicographic string comparison
on orderKey.

# [1.1.0](https://github.com/ExaDev/documents.js/compare/document-outline.js@1.0.10...document-outline.js@1.1.0) (2026-08-22)


### Bug Fixes

* **outline:** build the cross-document footnote fixture through its builder ([f9552d6](https://github.com/ExaDev/documents.js/commit/f9552d61ebf8584bc317f5b74784939675972b4d))
* **outline:** emit graph table-entry nodes in content-id order ([3180475](https://github.com/ExaDev/documents.js/commit/31804753ccf4b3dde085e22114b87cecf7c8019e))
* **outline:** harden the graph projection's identity edges and input refusal ([631b484](https://github.com/ExaDev/documents.js/commit/631b48401a5275e7776d171a21afa174c8a7b25e))
* **outline:** read definition refs only on anchor descriptors and refuse entry cycles ([ff7d52a](https://github.com/ExaDev/documents.js/commit/ff7d52a698ee5910254a29e969cfbb53ebe42bc7))


### Features

* **outline:** project definitions tables with DEFINED_BY edges and a pluggable extraction policy ([0d9111d](https://github.com/ExaDev/documents.js/commit/0d9111d9c783d1e42f12ac29cea2da85bccad1fc))
* **outline:** project DocumentPackage into a content-addressed property graph ([bf08e9c](https://github.com/ExaDev/documents.js/commit/bf08e9c6be380729b7963312b79cdc6cb23031fc))

## [1.0.10](https://github.com/ExaDev/documents.js/compare/document-outline.js@1.0.9...document-outline.js@1.0.10) (2026-08-22)


### Dependencies

- Updated document-schema.js to ^4.9.0

## [1.0.9](https://github.com/ExaDev/documents.js/compare/document-outline.js@1.0.8...document-outline.js@1.0.9) (2026-08-21)


### Dependencies

- Updated document-schema.js to ^4.8.0

## [1.0.8](https://github.com/ExaDev/documents.js/compare/document-outline.js@1.0.7...document-outline.js@1.0.8) (2026-08-21)


### Dependencies

- Updated document-schema.js to ^4.7.0

## [1.0.7](https://github.com/ExaDev/documents.js/compare/document-outline.js@1.0.6...document-outline.js@1.0.7) (2026-08-21)


### Dependencies

- Updated document-schema.js to ^4.6.0

## [1.0.6](https://github.com/ExaDev/documents.js/compare/document-outline.js@1.0.5...document-outline.js@1.0.6) (2026-08-21)


### Dependencies

- Updated document-schema.js to ^4.5.0

## [1.0.5](https://github.com/ExaDev/documents.js/compare/document-outline.js@1.0.4...document-outline.js@1.0.5) (2026-08-20)


### Dependencies

- Updated document-schema.js to ^4.4.0

## [1.0.4](https://github.com/ExaDev/documents.js/compare/document-outline.js@1.0.3...document-outline.js@1.0.4) (2026-08-20)


### Dependencies

- Updated document-schema.js to ^4.3.7

## [1.0.3](https://github.com/ExaDev/documents.js/compare/document-outline.js@1.0.2...document-outline.js@1.0.3) (2026-08-20)


### Dependencies

- Updated document-schema.js to ^4.3.6

## [1.0.2](https://github.com/ExaDev/documents.js/compare/document-outline.js@1.0.1...document-outline.js@1.0.2) (2026-08-20)


### Bug Fixes

* point package homepage and bugs URLs at the monorepo, not the old standalone repos ([bb0a875](https://github.com/ExaDev/documents.js/commit/bb0a8752dcac584660f21979540bc06bbda41110))


### Dependencies

- Updated document-schema.js to ^4.3.5

## [1.0.1](https://github.com/ExaDev/documents.js/compare/document-outline.js@1.0.0...document-outline.js@1.0.1) (2026-08-20)


### Bug Fixes

* **document-outline.js:** project and resolve construct groups ([f3112ef](https://github.com/ExaDev/documents.js/commit/f3112ef6f6cc5281275054d08f0478df5e1a30ed))


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
