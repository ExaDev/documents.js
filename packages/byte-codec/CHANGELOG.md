## [1.4.1](https://github.com/ExaDev/documents.js/compare/byte-codec%401.4.0...byte-codec%401.4.1) (2026-09-08)

### Bug Fixes

* **hooks:** remove stale per-package lint-staged fields ([1b85b5a](https://github.com/ExaDev/documents.js/commit/1b85b5a545fb9762879310ed4ea73b68fa73d00d))

### Miscellaneous Chores

* **deps:** pin every workspace dependency to an exact fixed version ([6a38142](https://github.com/ExaDev/documents.js/commit/6a38142facc043dfa499573f37431d3b32ff602e))

## [1.4.0](https://github.com/ExaDev/documents.js/compare/byte-codec%401.3.0...byte-codec%401.4.0) (2026-09-06)

### Features

* **byte-codec:** encode indexed-colour PNGs when the palette is small enough ([3693ff9](https://github.com/ExaDev/documents.js/commit/3693ff917d80d73409a07a57e17aefb31c8c023e))

### Bug Fixes

* **byte-codec:** bound encodePng's pixel count, not just each dimension ([fcd60a9](https://github.com/ExaDev/documents.js/commit/fcd60a96d22c5f09fa3a70ddb5a57c072cd12b6c))
* **byte-codec:** default a missing PNG sample to 0 in detectPalette, matching writeTruecolorPng ([dd08e0b](https://github.com/ExaDev/documents.js/commit/dd08e0bcd28cdfeedae855bdc9da07652c8b8932))
* **byte-codec:** encode both indexed and truecolour, keep whichever is smaller ([2e56095](https://github.com/ExaDev/documents.js/commit/2e560954dbd7a2377f8fdf548669413979157582))
* **byte-codec:** reject a PNG width or height at or above 2^31 ([6b1d6f9](https://github.com/ExaDev/documents.js/commit/6b1d6f9d64a2215b38cfe19faed7d9a168159bfe))
* **byte-codec:** reject a zero-dimension image outright instead of an invalid truecolour fallback ([c956c70](https://github.com/ExaDev/documents.js/commit/c956c70685381eb82029feff49d1875b7ac1ecf3))
* **byte-codec:** reject NaN and fractional PNG dimensions, not just non-positive ones ([6f38a41](https://github.com/ExaDev/documents.js/commit/6f38a41f5df187d4891edc2fd3ba5723b84b6547))
* **byte-codec:** reject the indexed path for a zero-dimension image ([6128620](https://github.com/ExaDev/documents.js/commit/6128620963d6a60463eef7880f9fffc2a65ea1f2))
* **byte-codec:** stop encodePng emitting an invalid zero-length tRNS chunk ([c89d64f](https://github.com/ExaDev/documents.js/commit/c89d64f8a9b1df1b385d17302bd0a10839b61f9a))

### Documentation

* **byte-codec:** cite libpng's real source instead of an in-file verification that doesn't exist ([7268133](https://github.com/ExaDev/documents.js/commit/7268133c42e08f7e4c6117b3a9d67d561d9aeb54))
* **byte-codec:** correct PNG_MAX_PIXELS comment's sensor and timing claims ([00a6dec](https://github.com/ExaDev/documents.js/commit/00a6dec2a404be6547462d15769bc682a326f362))
* **byte-codec:** describe encodePng's indexed-colour output ([66f175f](https://github.com/ExaDev/documents.js/commit/66f175f1a8780c3a1e704c6f8295c7da72a08eef))
* **byte-codec:** document encodePng's throw-on-invalid-dimensions behaviour ([b507acd](https://github.com/ExaDev/documents.js/commit/b507acd7d90ea9ff93ccd614030d464bd73de4ef))
* **byte-codec:** fix a fabricated libpng quote and a PNG-spec misattribution ([6105940](https://github.com/ExaDev/documents.js/commit/6105940508fe506c6c1437410a5c73aa1839ac7d))
* **byte-codec:** fix a reintroduced IHDR spec-section citation ([96b3759](https://github.com/ExaDev/documents.js/commit/96b37591252d6ecf4f3cda9b9b35bd22e2296a25))
* **byte-codec:** note encodePng's double-encode cost for indexed-eligible images ([d55c978](https://github.com/ExaDev/documents.js/commit/d55c978eae981c0b67fc3233fd24370bd3833cb8))

### Tests

* **byte-codec:** cover a short data or alpha plane through the indexed PNG path ([62d3334](https://github.com/ExaDev/documents.js/commit/62d3334c43caf06e7ded0f7f2966099feb15c81a))
* **byte-codec:** cover generic PNG round-trips and cross-check IDAT against Node's own zlib ([e57fca0](https://github.com/ExaDev/documents.js/commit/e57fca091a2554029616122b924b4913869783a9))
* **byte-codec:** cover NaN and fractional dimensions in the invalid-dimension regression test ([491dc18](https://github.com/ExaDev/documents.js/commit/491dc185e392b2a18d748f75497d7a12ff849667))
* **byte-codec:** give the 256-colour indexed-selection test a longer timeout ([a9d2eb8](https://github.com/ExaDev/documents.js/commit/a9d2eb84f4fe03ac38177c7f162aeb2e746676fc))

## [1.3.0](https://github.com/ExaDev/documents.js/compare/byte-codec%401.2.2...byte-codec%401.3.0) (2026-09-06)

### Features

* **workspace:** add per-package Stryker mutation testing configuration ([ff3eacc](https://github.com/ExaDev/documents.js/commit/ff3eacc124577b163a1c13a63b83484d9611ae5a))

### Bug Fixes

* **workspace:** drop the unused per-package @stryker-mutator/api dependency ([69270b6](https://github.com/ExaDev/documents.js/commit/69270b6e7ad7163c3b76cd085f4e5f367433994c))

## [1.2.2](https://github.com/ExaDev/documents.js/compare/byte-codec%401.2.1...byte-codec%401.2.2) (2026-09-06)

### Build System

* typecheck test/workers across every package where it is currently clean ([f340428](https://github.com/ExaDev/documents.js/commit/f340428b51a669010c0c4e5edb4310fe6ea4789a)), closes [#1021](https://github.com/ExaDev/documents.js/issues/1021)

## [1.2.1](https://github.com/ExaDev/documents.js/compare/byte-codec%401.2.0...byte-codec%401.2.1) (2026-09-05)

### Continuous Integration

* add the missing _test:coverage script to nine packages ([bc658d0](https://github.com/ExaDev/documents.js/commit/bc658d094b6ffbd0616cc225c57d5c0595374172))

## [1.2.0](https://github.com/ExaDev/documents.js/compare/byte-codec%401.1.13...byte-codec%401.2.0) (2026-08-24)

### Features

* **eslint:** enable strictTypeChecked across the workspace ([67eec04](https://github.com/ExaDev/documents.js/commit/67eec04a380b25142f5d1afd11cb9906ff2cfd5f))
* **eslint:** lint JSON, Markdown, and YAML alongside the TypeScript ([016b127](https://github.com/ExaDev/documents.js/commit/016b127119733c50aa7694bad6265e9bc26bb215))

### Code Refactoring

* clear what strictTypeChecked's non-deviated rules found ([92a9fc9](https://github.com/ExaDev/documents.js/commit/92a9fc98f76244fca3a42ff0a12312ab0ce1a79b))
* **eslint:** put type-aware linting on the last six packages ([384e3be](https://github.com/ExaDev/documents.js/commit/384e3be118c912ba811bb9b00767ef689417deab))
* **tsconfig:** share the strict compiler options through one base config ([43af382](https://github.com/ExaDev/documents.js/commit/43af382f726d7d42754ac0b6bf6d91b0ae302e25))

### Styles

* format the workspace with prettier ([56c3a1d](https://github.com/ExaDev/documents.js/commit/56c3a1dd1b0f05fbeccfc9b5e8b1d27ca97486b4))

### Miscellaneous Chores

* **deps:** drop the dependencies each package no longer uses ([80094aa](https://github.com/ExaDev/documents.js/commit/80094aa6db412392ef6e6457014d5963a5e910a7))

## [1.1.13](https://github.com/ExaDev/documents.js/compare/byte-codec@1.1.12...byte-codec@1.1.13) (2026-08-20)

## [1.1.12](https://github.com/ExaDev/documents.js/compare/byte-codec@1.1.11...byte-codec@1.1.12) (2026-08-20)

## [1.1.11](https://github.com/ExaDev/documents.js/compare/byte-codec@1.1.10...byte-codec@1.1.11) (2026-08-20)


### Bug Fixes

* point package homepage and bugs URLs at the monorepo, not the old standalone repos ([1b605e8](https://github.com/ExaDev/documents.js/commit/1b605e846393f417001227758a8606347c04e219))

## [1.1.10](https://github.com/ExaDev/documents.js/compare/byte-codec@1.1.9...byte-codec@1.1.10) (2026-08-20)

## [1.1.9](https://github.com/ExaDev/byte-codec/compare/v1.1.8...v1.1.9) (2026-08-12)

## [1.1.8](https://github.com/ExaDev/byte-codec/compare/v1.1.7...v1.1.8) (2026-08-12)

## [1.1.7](https://github.com/ExaDev/byte-codec/compare/v1.1.6...v1.1.7) (2026-08-12)

## [1.1.6](https://github.com/ExaDev/byte-codec/compare/v1.1.5...v1.1.6) (2026-08-12)

## [1.1.5](https://github.com/ExaDev/byte-codec/compare/v1.1.4...v1.1.5) (2026-08-12)

## [1.1.4](https://github.com/ExaDev/byte-codec/compare/v1.1.3...v1.1.4) (2026-08-09)

## [1.1.3](https://github.com/ExaDev/byte-codec/compare/v1.1.2...v1.1.3) (2026-08-06)

## [1.1.2](https://github.com/ExaDev/byte-codec/compare/v1.1.1...v1.1.2) (2026-08-06)

## [1.1.1](https://github.com/ExaDev/byte-codec/compare/v1.1.0...v1.1.1) (2026-08-06)

# [1.1.0](https://github.com/ExaDev/byte-codec/compare/v1.0.10...v1.1.0) (2026-08-06)


### Features

* cache typecheck/lint/test/build tasks with turbo ([ea8abe8](https://github.com/ExaDev/byte-codec/commit/ea8abe89f568bc8a3682bc3b7405ee0e4c83463c))

## [1.0.10](https://github.com/ExaDev/byte-codec/compare/v1.0.9...v1.0.10) (2026-08-06)

## [1.0.9](https://github.com/ExaDev/byte-codec/compare/v1.0.8...v1.0.9) (2026-08-06)

## [1.0.8](https://github.com/ExaDev/byte-codec/compare/v1.0.7...v1.0.8) (2026-08-06)

## [1.0.7](https://github.com/ExaDev/byte-codec/compare/v1.0.6...v1.0.7) (2026-08-06)

## [1.0.6](https://github.com/ExaDev/byte-codec/compare/v1.0.5...v1.0.6) (2026-08-06)

## [1.0.5](https://github.com/ExaDev/byte-codec/compare/v1.0.4...v1.0.5) (2026-08-06)

## [1.0.4](https://github.com/ExaDev/byte-codec/compare/v1.0.3...v1.0.4) (2026-08-05)

## [1.0.3](https://github.com/ExaDev/byte-codec/compare/v1.0.2...v1.0.3) (2026-08-05)


### Bug Fixes

* make sibling-notification dispatch resilient ([eb7b3e7](https://github.com/ExaDev/byte-codec/commit/eb7b3e77d619148ca43afe21d546e25a0142022e))

## [1.0.2](https://github.com/ExaDev/byte-codec/compare/v1.0.1...v1.0.2) (2026-08-05)


### Bug Fixes

* remove unused imports in rename-dts script ([f5f358c](https://github.com/ExaDev/byte-codec/commit/f5f358c130687bfa366ad2f6508ddc02db183f28))
* rename hashed dts files in build step for tsdown 0.12 compat ([5a055bd](https://github.com/ExaDev/byte-codec/commit/5a055bdf7a834d9876a096a3ad3d69c3d8e3e813))
* upgrade tsdown to 0.22 for clean declaration filenames ([3e5c3e4](https://github.com/ExaDev/byte-codec/commit/3e5c3e4913e4a17c756b4d9a152630633c3ae8a5))

## [1.0.1](https://github.com/ExaDev/byte-codec/compare/v1.0.0...v1.0.1) (2026-08-05)


### Bug Fixes

* add files field and prepublishOnly build step ([ab5a6bb](https://github.com/ExaDev/byte-codec/commit/ab5a6bb071591b040e53a090201371b949c64dcd))

# 1.0.0 (2026-08-05)


### Bug Fixes

* ci test and smoke steps for byte-codec's script set ([a64531d](https://github.com/ExaDev/byte-codec/commit/a64531df7cec8969ffe2f99cb4b100020b549ad4))
* ci yaml — remove stray key, fix job name, correct alias ([c1c6291](https://github.com/ExaDev/byte-codec/commit/c1c629166831899be2b07f761fafdd130babbe78))


### Features

* initial byte-codec package — generic byte/image utilities ([698c6ab](https://github.com/ExaDev/byte-codec/commit/698c6abd755e72e40759569a3ffa6b0f2f5d9f21))
