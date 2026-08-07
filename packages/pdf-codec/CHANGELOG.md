## [2.1.4](https://github.com/ExaDev/pdf-codec/compare/v2.1.3...v2.1.4) (2026-08-07)

## [2.1.3](https://github.com/ExaDev/pdf-codec/compare/v2.1.2...v2.1.3) (2026-08-07)

## [2.1.2](https://github.com/ExaDev/pdf-codec/compare/v2.1.1...v2.1.2) (2026-08-06)

## [2.1.1](https://github.com/ExaDev/pdf-codec/compare/v2.1.0...v2.1.1) (2026-08-06)

# [2.1.0](https://github.com/ExaDev/pdf-codec/compare/v2.0.10...v2.1.0) (2026-08-06)


### Features

* cache typecheck/lint/test/build tasks with turbo ([9609c3f](https://github.com/ExaDev/pdf-codec/commit/9609c3fee641685ae18810816d84f1d0ec69620b))

## [2.0.10](https://github.com/ExaDev/pdf-codec/compare/v2.0.9...v2.0.10) (2026-08-06)

## [2.0.9](https://github.com/ExaDev/pdf-codec/compare/v2.0.8...v2.0.9) (2026-08-06)

## [2.0.8](https://github.com/ExaDev/pdf-codec/compare/v2.0.7...v2.0.8) (2026-08-06)

## [2.0.7](https://github.com/ExaDev/pdf-codec/compare/v2.0.6...v2.0.7) (2026-08-06)

## [2.0.6](https://github.com/ExaDev/pdf-codec/compare/v2.0.5...v2.0.6) (2026-08-06)

## [2.0.5](https://github.com/ExaDev/pdf-codec/compare/v2.0.4...v2.0.5) (2026-08-06)

## [2.0.4](https://github.com/ExaDev/pdf-codec/compare/v2.0.3...v2.0.4) (2026-08-06)

## [2.0.3](https://github.com/ExaDev/pdf-codec/compare/v2.0.2...v2.0.3) (2026-08-06)

## [2.0.2](https://github.com/ExaDev/pdf-codec/compare/v2.0.1...v2.0.2) (2026-08-06)

## [2.0.1](https://github.com/ExaDev/pdf-codec/compare/v2.0.0...v2.0.1) (2026-08-06)


### Bug Fixes

* use npx in husky hooks instead of pnpm exec + .npmrc ([367395c](https://github.com/ExaDev/pdf-codec/commit/367395cd147d5853b299dcbaffc5f07aa4ef755e))

# [2.0.0](https://github.com/ExaDev/pdf-codec/compare/v1.11.11...v2.0.0) (2026-08-05)


* refactor!: drop wrapRunsToWidth and rotatePointAboutCenter from the public API ([6aa5c99](https://github.com/ExaDev/pdf-codec/commit/6aa5c990b9eef7509d49b87be0d46bda3856e889))


### Bug Fixes

* update smoke export-parity check and README for the dropped primitives ([2475e33](https://github.com/ExaDev/pdf-codec/commit/2475e330d402414e63123bf79d99f6aea6448768))


### BREAKING CHANGES

* wrapRunsToWidth and rotatePointAboutCenter are no
longer exported from pdf-codec. Import them from documents.js (or copy
the ~5-line rotatePointAboutCenter) instead.

## [1.11.11](https://github.com/ExaDev/pdf-codec/compare/v1.11.10...v1.11.11) (2026-08-05)

## [1.11.10](https://github.com/ExaDev/pdf-codec/compare/v1.11.9...v1.11.10) (2026-08-05)

## [1.11.9](https://github.com/ExaDev/pdf-codec/compare/v1.11.8...v1.11.9) (2026-08-05)

## [1.11.8](https://github.com/ExaDev/pdf-codec/compare/v1.11.7...v1.11.8) (2026-08-04)

## [1.11.7](https://github.com/ExaDev/pdf-codec/compare/v1.11.6...v1.11.7) (2026-08-04)

## [1.11.6](https://github.com/ExaDev/pdf-codec/compare/v1.11.5...v1.11.6) (2026-08-04)

## [1.11.5](https://github.com/ExaDev/pdf-codec/compare/v1.11.4...v1.11.5) (2026-08-04)

## [1.11.4](https://github.com/ExaDev/pdf-codec/compare/v1.11.3...v1.11.4) (2026-08-04)

## [1.11.3](https://github.com/ExaDev/pdf-codec/compare/v1.11.2...v1.11.3) (2026-08-04)


### Bug Fixes

* **ci:** self-heal sibling-dependency-update PRs stranded by CONFLICTING status ([173b086](https://github.com/ExaDev/pdf-codec/commit/173b086bcd81709cca9471cc52ec996959d61b6d))

## [1.11.2](https://github.com/ExaDev/pdf-codec/compare/v1.11.1...v1.11.2) (2026-08-04)

## [1.11.1](https://github.com/ExaDev/pdf-codec/compare/v1.11.0...v1.11.1) (2026-08-04)

# [1.11.0](https://github.com/ExaDev/pdf-codec/compare/v1.10.10...v1.11.0) (2026-08-04)


### Features

* export readFontFace for inspecting standalone font files ([3b3db77](https://github.com/ExaDev/pdf-codec/commit/3b3db773e23e2bc7130307adc5e822527470a94d))

## [1.10.10](https://github.com/ExaDev/pdf-codec/compare/v1.10.9...v1.10.10) (2026-08-03)

## [1.10.9](https://github.com/ExaDev/pdf-codec/compare/v1.10.8...v1.10.9) (2026-08-03)


### Bug Fixes

* **ci:** use pull_request_target so dependabot auto-merge can read secrets ([44bb5c4](https://github.com/ExaDev/pdf-codec/commit/44bb5c40c4a4a2a3fae5b50c946d4067dfd70b71))

## [1.10.8](https://github.com/ExaDev/pdf-codec/compare/v1.10.7...v1.10.8) (2026-08-03)


### Bug Fixes

* **ci:** wait for a real check-run to register before requesting auto-merge ([531f352](https://github.com/ExaDev/pdf-codec/commit/531f352ccf4542de6535768997afdfd2d6b3cbbf))

## [1.10.7](https://github.com/ExaDev/pdf-codec/compare/v1.10.6...v1.10.7) (2026-08-03)


### Bug Fixes

* **ci:** use the GitHub App token for the branch push and PR creation too ([7264c24](https://github.com/ExaDev/pdf-codec/commit/7264c245ff11ee46064105093e2e2537562d5a02))

## [1.10.6](https://github.com/ExaDev/pdf-codec/compare/v1.10.5...v1.10.6) (2026-08-03)


### Bug Fixes

* **ci:** wrap the sibling-bump commit body onto two lines under commitlint's limit ([e94d873](https://github.com/ExaDev/pdf-codec/commit/e94d873fbf4150a53f6b7e63b802d84d4f39af31))

## [1.10.5](https://github.com/ExaDev/pdf-codec/compare/v1.10.4...v1.10.5) (2026-08-03)


### Bug Fixes

* **ci:** use single-quoted string literals in workflow if-conditions ([9a1395f](https://github.com/ExaDev/pdf-codec/commit/9a1395f57f5aca7c294749fc9690614b6cd66d7c))

## [1.10.4](https://github.com/ExaDev/pdf-codec/compare/v1.10.3...v1.10.4) (2026-08-03)

## [1.10.3](https://github.com/ExaDev/pdf-codec/compare/v1.10.2...v1.10.3) (2026-08-03)

## [1.10.2](https://github.com/ExaDev/pdf-codec/compare/v1.10.1...v1.10.2) (2026-08-03)

## [1.10.1](https://github.com/ExaDev/pdf-codec/compare/v1.10.0...v1.10.1) (2026-08-03)

# [1.10.0](https://github.com/ExaDev/pdf-codec/compare/v1.9.0...v1.10.0) (2026-08-03)


### Features

* draw dashed, dotted, and double line/path strokes ([a5d5d42](https://github.com/ExaDev/pdf-codec/commit/a5d5d422d7d332e465e790f457c7c55d8c70e3ac))

# [1.9.0](https://github.com/ExaDev/pdf-codec/compare/v1.8.0...v1.9.0) (2026-08-03)


### Features

* apply real pair kerning during embedded-font text layout ([49e1e31](https://github.com/ExaDev/pdf-codec/commit/49e1e314e4eaf2d2880c6eea3f758ee286f09c6d))
* read pair kerning from a font's own GPOS table ([2c14f2d](https://github.com/ExaDev/pdf-codec/commit/2c14f2da8e69c212b74330774f373c19ff36d515))

# [1.8.0](https://github.com/ExaDev/pdf-codec/compare/v1.7.0...v1.8.0) (2026-08-03)


### Features

* draw stretchy glyph constructions by glyph ID ([7d1aa09](https://github.com/ExaDev/pdf-codec/commit/7d1aa091106628086647311e622930fc56c1a24e))

# [1.7.0](https://github.com/ExaDev/pdf-codec/compare/v1.6.0...v1.7.0) (2026-08-03)


### Features

* add a hand-written JBIG2 decoder for ITU-T T.88 embedded streams ([edca3f1](https://github.com/ExaDev/pdf-codec/commit/edca3f13f1680261d5dff7a5d114a4c77391c93e))
* add a hand-written JPEG 2000 decoder for ISO/IEC 15444-1 codestreams ([dd8c107](https://github.com/ExaDev/pdf-codec/commit/dd8c107f6446a06fd0fb5323408fae0a7220c700))
* compute real glyph ink-tight bounding boxes from outline data ([d48a17a](https://github.com/ExaDev/pdf-codec/commit/d48a17a528c0de0d82cd0e4ade1caab9c06b4a78))
* decode JBIG2Decode image streams instead of skipping them ([6ccbfe7](https://github.com/ExaDev/pdf-codec/commit/6ccbfe7b5f07eeaaefb2a60a72f07559db124bd8))
* decode JPXDecode image streams instead of skipping them ([c7bb2bc](https://github.com/ExaDev/pdf-codec/commit/c7bb2bcbd0156ef920c8bbf3445ef1f16fd3b70a))
* parse MathVariants and assemble stretchy glyph constructions ([21aa48e](https://github.com/ExaDev/pdf-codec/commit/21aa48e2fd1f02d7b544e868e2c4bddd381866e3))

# [1.6.0](https://github.com/ExaDev/pdf-codec/compare/v1.5.0...v1.6.0) (2026-08-03)


### Bug Fixes

* separate the subset-tag hash inputs with a space, not a NUL byte ([cf11e8f](https://github.com/ExaDev/pdf-codec/commit/cf11e8fe6fb4c6aec886901c351b2f0a660bf502))
* split ToUnicode CMap entries into blocks of at most 100 ([d62991a](https://github.com/ExaDev/pdf-codec/commit/d62991a4671f6aa5dfa3c2bb5ea1476e61b741ab))


### Features

* add a FontRegistry with source/caller/vendored/standard-14 resolution precedence ([162b24c](https://github.com/ExaDev/pdf-codec/commit/162b24c08108def11bcb7861f69d60b0b44c8a27))
* add a GID-preserving TrueType font subsetter ([16ed0dc](https://github.com/ExaDev/pdf-codec/commit/16ed0dc9fe2392239f201801c88a507eefb8c397))
* add head/maxp/OS-2/post/name and glyf/loca table parsers; generalize cmap/hmtx ([8a80ecf](https://github.com/ExaDev/pdf-codec/commit/8a80ecff0474954ac39c91703ba07f46975fc97b))
* build the Type0/CIDFontType2 PDF object group for embedded TrueType fonts ([8ceabaa](https://github.com/ExaDev/pdf-codec/commit/8ceabaa8b496668b7935b4ef236b43fdab3f1de9))
* detect a CID-keyed CFF font program ([c4823b1](https://github.com/ExaDev/pdf-codec/commit/c4823b14b08fe1bdf6de5e7cefef2f8aaf775640))
* vendor Carlito and Caladea TrueType font assets ([d8f4287](https://github.com/ExaDev/pdf-codec/commit/d8f42870b0d7e8c0eff31f156c2b14c95e5b0dc0))
* wire embedded font resolution into measurement and PDF text writing ([44e6ed9](https://github.com/ExaDev/pdf-codec/commit/44e6ed97fc9f7a52ed29a42c46596bacbd606bd9))

# [1.5.0](https://github.com/ExaDev/pdf-codec/compare/v1.4.2...v1.5.0) (2026-08-02)


### Features

* decode CCITT Group 4 fax-encoded images ([15c9dfd](https://github.com/ExaDev/pdf-codec/commit/15c9dfd7de56bbed3b8f944b28a853da2974d8e7))
* decrypt PDFs with an empty user password (standard security handler) ([62cb7ee](https://github.com/ExaDev/pdf-codec/commit/62cb7eea95ce8cc9ac0c91a521a757713176e2fd))
* detect stroked rects, ellipses, and lines on general vector-path read ([57d9e5a](https://github.com/ExaDev/pdf-codec/commit/57d9e5aec2587d52b00584c7a412381c6567480c))

## [1.4.2](https://github.com/ExaDev/pdf-codec/compare/v1.4.1...v1.4.2) (2026-08-02)

## [1.4.1](https://github.com/ExaDev/pdf-codec/compare/v1.4.0...v1.4.1) (2026-08-02)

# [1.4.0](https://github.com/ExaDev/pdf-codec/compare/v1.3.1...v1.4.0) (2026-08-02)


### Features

* build one file per module, add wildcard deep-import exports ([afdd1c8](https://github.com/ExaDev/pdf-codec/commit/afdd1c875b11581bc75deaa6293162cc36d924c1))

## [1.3.1](https://github.com/ExaDev/pdf-codec/compare/v1.3.0...v1.3.1) (2026-08-02)

# [1.3.0](https://github.com/ExaDev/pdf-codec/compare/v1.2.1...v1.3.0) (2026-08-02)


### Features

* ban anything but re-exports in src/index.ts ([c502d3c](https://github.com/ExaDev/pdf-codec/commit/c502d3c44d3b0332cfbbea1dba9cf35f65caeeb4))

## [1.2.1](https://github.com/ExaDev/pdf-codec/compare/v1.2.0...v1.2.1) (2026-08-02)


### Bug Fixes

* don't flag or fix an alias whose source is mutated elsewhere ([3115925](https://github.com/ExaDev/pdf-codec/commit/31159259b4a6250c96921bcc5c076b9e4c0100a9))

# [1.2.0](https://github.com/ExaDev/pdf-codec/compare/v1.1.6...v1.2.0) (2026-08-02)


### Features

* add custom pointless-reassignment autofix rule, ban re-exports outside src/index.ts ([d5ba949](https://github.com/ExaDev/pdf-codec/commit/d5ba949e390d5bd81517d401d8c030122d2dab6e))

## [1.1.6](https://github.com/ExaDev/pdf-codec/compare/v1.1.5...v1.1.6) (2026-08-02)

## [1.1.5](https://github.com/ExaDev/pdf-codec/compare/v1.1.4...v1.1.5) (2026-08-02)

## [1.1.4](https://github.com/ExaDev/pdf-codec/compare/v1.1.3...v1.1.4) (2026-08-01)

## [1.1.3](https://github.com/ExaDev/pdf-codec/compare/v1.1.2...v1.1.3) (2026-08-01)

## [1.1.2](https://github.com/ExaDev/pdf-codec/compare/v1.1.1...v1.1.2) (2026-08-01)

## [1.1.1](https://github.com/ExaDev/pdf-codec/compare/v1.1.0...v1.1.1) (2026-08-01)

# [1.1.0](https://github.com/ExaDev/pdf-codec/compare/v1.0.0...v1.1.0) (2026-08-01)


### Features

* publish pdf-codec.js and pdf-parser.js as additional npm aliases ([8ffefe3](https://github.com/ExaDev/pdf-codec/commit/8ffefe38cc25d241d9baf8c120bd86edb9c3ca25))

# 1.0.0 (2026-08-01)


### Features

* extract hand-written PDF codec into standalone pdf-codec package ([a6aec06](https://github.com/ExaDev/pdf-codec/commit/a6aec06f87facfd74dd377ab93d0314d99b1d49c))
