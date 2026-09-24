## [1.11.15](https://github.com/ExaDev/documents.js/compare/archive-codec%401.11.14...archive-codec%401.11.15) (2026-09-24)

### Bug Fixes

* **archive-codec:** rename the recursive directory-record builder ([e3cb65b](https://github.com/ExaDev/documents.js/commit/e3cb65b152a64d8ae8749231e741a8c37a0cb0e6))

## [1.11.14](https://github.com/ExaDev/documents.js/compare/archive-codec%401.11.13...archive-codec%401.11.14) (2026-09-24)

### Bug Fixes

* **archive-codec:** give two exhaustive switches an explicit trailing throw ([14e79ca](https://github.com/ExaDev/documents.js/commit/14e79ca898afb56121717053e266ac6761b85083))

## [1.11.13](https://github.com/ExaDev/documents.js/compare/archive-codec%401.11.12...archive-codec%401.11.13) (2026-09-24)

### Bug Fixes

* **archive-codec:** give a numeric sort its own comparator ([aec778e](https://github.com/ExaDev/documents.js/commit/aec778e9a6f5faf9f41fa6b25ad67f34f28c6182))
* **archive-codec:** satisfy prefer-numeric-sort-compare at the same site ([c409f32](https://github.com/ExaDev/documents.js/commit/c409f326ead522cdcaad947ec0f1fca0c94afddd))

## [1.11.12](https://github.com/ExaDev/documents.js/compare/archive-codec%401.11.11...archive-codec%401.11.12) (2026-09-22)


### Dependencies

- Updated document-schema.js to 7.15.0

## [1.11.11](https://github.com/ExaDev/documents.js/compare/archive-codec%401.11.10...archive-codec%401.11.11) (2026-09-22)

### Bug Fixes

* **workspace:** replace the spaced double-hyphen dash substitute with a real em-dash workspace-wide ([c42a9c7](https://github.com/ExaDev/documents.js/commit/c42a9c7e0bc7cd87456ca72204a5ac423a7ca341))


### Dependencies

- Updated document-schema.js to 7.14.1

## [1.11.10](https://github.com/ExaDev/documents.js/compare/archive-codec%401.11.9...archive-codec%401.11.10) (2026-09-21)


### Dependencies

- Updated document-schema.js to 7.14.0

## [1.11.9](https://github.com/ExaDev/documents.js/compare/archive-codec%401.11.8...archive-codec%401.11.9) (2026-09-21)


### Dependencies

- Updated document-schema.js to 7.13.0

## [1.11.8](https://github.com/ExaDev/documents.js/compare/archive-codec%401.11.7...archive-codec%401.11.8) (2026-09-21)


### Dependencies

- Updated document-schema.js to 7.12.0

## [1.11.7](https://github.com/ExaDev/documents.js/compare/archive-codec%401.11.6...archive-codec%401.11.7) (2026-09-20)

### Documentation

* make a hand-typed scoped mutation run find its package's Stryker config ([ed3297b](https://github.com/ExaDev/documents.js/commit/ed3297b6aa71b2d94913519e6960537ca5ac0f61))


### Dependencies

- Updated document-schema.js to 7.11.5

## [1.11.6](https://github.com/ExaDev/documents.js/compare/archive-codec%401.11.5...archive-codec%401.11.6) (2026-09-20)

### Tests

* **archive-codec:** shrink the zip-bomb walk test to a size that costs nothing ([66586d9](https://github.com/ExaDev/documents.js/commit/66586d9ba8ed4177a347b3e050a8ec3906315c1e))

## [1.11.5](https://github.com/ExaDev/documents.js/compare/archive-codec%401.11.4...archive-codec%401.11.5) (2026-09-20)


### Dependencies

- Updated document-schema.js to 7.11.4

## [1.11.4](https://github.com/ExaDev/documents.js/compare/archive-codec%401.11.3...archive-codec%401.11.4) (2026-09-14)

### Documentation

* reword stryker.config.ts comments to avoid the banned phrase ([1553892](https://github.com/ExaDev/documents.js/commit/1553892fb68ddce9bcb7eee7ebebc31e1f9cdc79))

### Miscellaneous Chores

* bump pinned pnpm to 12.4.1 across the workspace ([4e81c2d](https://github.com/ExaDev/documents.js/commit/4e81c2dfdb08fff226c20a0f267baffa87758e0f))
* **lint:** except each package's own measured eslint-config 2.12.1 debt ([11c35bc](https://github.com/ExaDev/documents.js/commit/11c35bc61db74c68b4be725c34452509fba00c2a))


### Dependencies

- Updated document-schema.js to 7.11.3

## [1.11.3](https://github.com/ExaDev/documents.js/compare/archive-codec%401.11.2...archive-codec%401.11.3) (2026-09-13)

### Bug Fixes

* **archive-codec:** build the DIFAT fixture inside each test, not a shared beforeAll ([745c43e](https://github.com/ExaDev/documents.js/commit/745c43e79252ce8aad5e8d55b994aba54ed1d009))
* **archive-codec:** stop asciiZeroTerminated's loop bound hiding an equivalent mutant ([e8cf240](https://github.com/ExaDev/documents.js/commit/e8cf240e0d69787ab63f53b752c47afd76ccabed))
* **archive-codec:** stop writeGuid's Data4 byte extraction discarding wrong slices ([f62d0d1](https://github.com/ExaDev/documents.js/commit/f62d0d1de5277778ccc0251516bd46f496bae8d2))

### Code Refactoring

* **archive-codec:** detect FAT and mini-FAT cycles by visited-set membership ([496a34c](https://github.com/ExaDev/documents.js/commit/496a34c3c1df71c92a4ae2797e2d472d694e8da7))
* **archive-codec:** drop bytesEqual's dead length check in RC4 CryptoAPI verifier ([7d83619](https://github.com/ExaDev/documents.js/commit/7d836190bf404e41905f11808f0356da855c3053))
* **archive-codec:** drop equivalent zero-padding writes in the OLEPS writer ([20ada32](https://github.com/ExaDev/documents.js/commit/20ada3220dd22fb7c681948749a404c6ebee9b96))
* **archive-codec:** drop remaining equivalent zero-padding write in test-support/oleps.ts ([c538529](https://github.com/ExaDev/documents.js/commit/c53852982b58cce817445f4fd57145c666dfeacc))
* **archive-codec:** drop startsWithMagic's redundant length pre-check ([b307766](https://github.com/ExaDev/documents.js/commit/b3077663fc963e62e88786df3d80fcf98839a648))
* **archive-codec:** drop the writer's redundant DIFAT-count convergence check ([528386b](https://github.com/ExaDev/documents.js/commit/528386b12f53abfcfa2af9bb59e4265419610e5c))
* **archive-codec:** iterate a DIFAT sector's own entries by bounded index list ([aae8832](https://github.com/ExaDev/documents.js/commit/aae88325a8c6a0adc4e52566daafb54c12977cdb))
* **archive-codec:** link compoundFile's directory siblings from record()'s own return values ([b21c433](https://github.com/ExaDev/documents.js/commit/b21c433c093fb58251082db740f41f2a75d1b2c0))
* **archive-codec:** remove compoundFile's redundant mini-FAT zero-sector guard ([02edfe5](https://github.com/ExaDev/documents.js/commit/02edfe551ccb136d1280fbb2e7a56e2119dbd455))
* **archive-codec:** remove fatEntry's dead negative-offset guard ([8622dc6](https://github.com/ExaDev/documents.js/commit/8622dc6055fb9b55b20b9f29e83bfb964b458c75))
* **archive-codec:** remove requireBytes' dead negative-offset guard and redundant default case ([003ca90](https://github.com/ExaDev/documents.js/commit/003ca907d497186b6e0f185f9bfec56952820371))
* **archive-codec:** remove test-support/cfb.ts's redundant array-index fallbacks ([a0d4220](https://github.com/ExaDev/documents.js/commit/a0d4220719e04b6c4176eaf687745dd0f777d80c))
* **archive-codec:** remove write.ts's dead surrogate case-mapping guard ([47ef426](https://github.com/ExaDev/documents.js/commit/47ef42602a4e6fae19d6093f3b7a650ca848b30a))
* **archive-codec:** simplify the OLEPS property-set writer's byte writes ([62b711a](https://github.com/ExaDev/documents.js/commit/62b711a1366574e0d1ae52877eb7aeb243fdde13))
* **archive-codec:** store each directory record's own child link directly ([3655470](https://github.com/ExaDev/documents.js/commit/36554701b92820c2d3d6983825eb8b962861bdae))
* **archive-codec:** use indexOf and DataView writes in the OLE Package codec ([f493e6e](https://github.com/ExaDev/documents.js/commit/f493e6e398e2c7ebc865c051111ec7a4d785d3ed))
* **archive-codec:** write RC4 password bytes through a DataView ([b8e929a](https://github.com/ExaDev/documents.js/commit/b8e929a106138395cf958b2f36f18ff950af1dc3))
* **archive-codec:** write XOR obfuscation bytes through DataViews ([f6435f2](https://github.com/ExaDev/documents.js/commit/f6435f2bc356acbec061a66357bf3c13e69840c2))

### Tests

* **archive-codec:** add direct coverage for the compoundFile test-fixture builder ([611f33f](https://github.com/ExaDev/documents.js/commit/611f33f3de1a8a7b85e407ba9e1dddbd5b11bc27))
* **archive-codec:** add multi-sector and validation coverage for readCompoundFile ([7a26724](https://github.com/ExaDev/documents.js/commit/7a26724960e90bafeb6304c773b6869e478ad259))
* **archive-codec:** assert DIFAT tail padding and unallocated size fields stay untouched ([35fc3f6](https://github.com/ExaDev/documents.js/commit/35fc3f68b95f6a7429cb045055c2e7efa5ebbcd7))
* **archive-codec:** assert exact messages across readCompoundFile's structural checks ([b435796](https://github.com/ExaDev/documents.js/commit/b4357969fb1455ea9b65849f8ac3653dc4684b15))
* **archive-codec:** assert exact requireBytes boundary messages throughout the OLEPS reader ([c1faca7](https://github.com/ExaDev/documents.js/commit/c1faca7be4e631204b6b328e728473bd93cff8a9))
* **archive-codec:** assert exact SummaryInformation error messages and add gap coverage ([3d0a597](https://github.com/ExaDev/documents.js/commit/3d0a5970603e22216f8f7150557c55f0765e0289))
* **archive-codec:** assert exact writeCompoundFile error messages and DIFAT/size boundaries ([147cc31](https://github.com/ExaDev/documents.js/commit/147cc31124b71f97f2993b19fdc656193fea97a9))
* **archive-codec:** build the header/sector-layout fixture per test, not once per describe block ([9491015](https://github.com/ExaDev/documents.js/commit/9491015c3173f09fc524c3d528f989b66de91f05))
* **archive-codec:** cover writeCompoundFile's sector-arithmetic and case-mapping boundaries ([a7d5876](https://github.com/ExaDev/documents.js/commit/a7d58766c120b274c4434f81d906b4901b8f6836))
* **archive-codec:** drop endian-invariant writes and add direct OLEPS wire tests ([0db9aa2](https://github.com/ExaDev/documents.js/commit/0db9aa2d5d15149b3045468bb82339f979c2b088))
* **archive-codec:** expose md5's 64-bit bit-length split for direct boundary coverage ([b5aa382](https://github.com/ExaDev/documents.js/commit/b5aa382f17ce7f896f03e43ae8441a9dcc4a2c1f))
* **archive-codec:** fix walkArchive's ancestor-chain order assertion ([5897e8d](https://github.com/ExaDev/documents.js/commit/5897e8d61be7c5cd528f0fa11e63b2d7dba0585c))
* **archive-codec:** give sha1's million-repetition vector a generous timeout ([8c463a9](https://github.com/ExaDev/documents.js/commit/8c463a96869b5e259e57562221e4ea4322ddc6d5))
* **archive-codec:** give the multi-FAT-sector fixture a generous timeout ([51c1acc](https://github.com/ExaDev/documents.js/commit/51c1acc2bfbf92ecddfb7c48858d8e2d73ce166e))
* **archive-codec:** make md5's 64-bit length write's high half directly testable ([d47199a](https://github.com/ExaDev/documents.js/commit/d47199a8d596dfbf52427505ffdede3c33b9a3f3))
* **archive-codec:** move the DIFAT fixture into beforeAll for correct mutant coverage ([d55690a](https://github.com/ExaDev/documents.js/commit/d55690a7153d6dcff5f130c4898604334f390c82))
* **archive-codec:** prove localHeaderCompressionMethod stops at a signature mismatch ([3c6fa18](https://github.com/ExaDev/documents.js/commit/3c6fa18dfb8e78d4d296b680d987be853b92618e))
* **archive-codec:** raise the mutation break threshold to 100 ([903f376](https://github.com/ExaDev/documents.js/commit/903f376c62b5828f27d6a56da83ef1182b3386d5))
* **archive-codec:** read zip test-support integers through DataView ([2f96544](https://github.com/ExaDev/documents.js/commit/2f96544db476ec7842a28e2917b49dc52f111b6c))

## [1.11.2](https://github.com/ExaDev/documents.js/compare/archive-codec%401.11.1...archive-codec%401.11.2) (2026-09-13)


### Dependencies

- Updated document-schema.js to 7.11.2

## [1.11.1](https://github.com/ExaDev/documents.js/compare/archive-codec%401.11.0...archive-codec%401.11.1) (2026-09-11)

### Code Refactoring

* load stryker.config.ts directly instead of a jiti .mjs bootstrap ([4221520](https://github.com/ExaDev/documents.js/commit/42215205caa1c8fc6368ed38729d15836bdd613b))


### Dependencies

- Updated document-schema.js to 7.11.1

## [1.11.0](https://github.com/ExaDev/documents.js/compare/archive-codec%401.10.8...archive-codec%401.11.0) (2026-09-11)

### Features

* **ci:** gate each measured package on its first CI mutation baseline ([9f8fa69](https://github.com/ExaDev/documents.js/commit/9f8fa6947795b2089bed03c936691893643ce2ae))


### Dependencies

- Updated document-schema.js to 7.11.0

## [1.10.8](https://github.com/ExaDev/documents.js/compare/archive-codec%401.10.7...archive-codec%401.10.8) (2026-09-11)


### Dependencies

- Updated document-schema.js to 7.10.0

## [1.10.7](https://github.com/ExaDev/documents.js/compare/archive-codec%401.10.6...archive-codec%401.10.7) (2026-09-11)


### Dependencies

- Updated document-schema.js to 7.9.1

## [1.10.6](https://github.com/ExaDev/documents.js/compare/archive-codec%401.10.5...archive-codec%401.10.6) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.9.0

## [1.10.5](https://github.com/ExaDev/documents.js/compare/archive-codec%401.10.4...archive-codec%401.10.5) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.8.0

## [1.10.4](https://github.com/ExaDev/documents.js/compare/archive-codec%401.10.3...archive-codec%401.10.4) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.7.0

## [1.10.3](https://github.com/ExaDev/documents.js/compare/archive-codec%401.10.2...archive-codec%401.10.3) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.6.1

## [1.10.2](https://github.com/ExaDev/documents.js/compare/archive-codec%401.10.1...archive-codec%401.10.2) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.6.0

## [1.10.1](https://github.com/ExaDev/documents.js/compare/archive-codec%401.10.0...archive-codec%401.10.1) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.5.1

## [1.10.0](https://github.com/ExaDev/documents.js/compare/archive-codec%401.9.2...archive-codec%401.10.0) (2026-09-08)

### Features

* **archive-codec:** add XOR obfuscation primitives for legacy Excel/Word encryption ([64cb442](https://github.com/ExaDev/documents.js/commit/64cb442029be7f5293b90c6fd07d0f637488e564))

## [1.9.2](https://github.com/ExaDev/documents.js/compare/archive-codec%401.9.1...archive-codec%401.9.2) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.5.0

## [1.9.1](https://github.com/ExaDev/documents.js/compare/archive-codec%401.9.0...archive-codec%401.9.1) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.4.0

## [1.9.0](https://github.com/ExaDev/documents.js/compare/archive-codec%401.8.0...archive-codec%401.9.0) (2026-09-08)

### Features

* **archive-codec:** add SHA-1 and RC4 CryptoAPI key derivation ([f6e48a0](https://github.com/ExaDev/documents.js/commit/f6e48a0a7795e618907ccd14f0da20d0e0e8b7a8))

## [1.8.0](https://github.com/ExaDev/documents.js/compare/archive-codec%401.7.2...archive-codec%401.8.0) (2026-09-08)

### Features

* **archive-codec:** make decryptOfficeRc4's re-keying interval configurable ([21acaa2](https://github.com/ExaDev/documents.js/commit/21acaa2cda103cb6630d27d527dd36191f86b96b))

## [1.7.2](https://github.com/ExaDev/documents.js/compare/archive-codec%401.7.1...archive-codec%401.7.2) (2026-09-08)

### Bug Fixes

* **archive-codec:** use the full 128-bit RC4 key, not a 40-bit truncation ([b26a737](https://github.com/ExaDev/documents.js/commit/b26a737313369123481f87ae5fb8cd0a6df383d8))

## [1.7.1](https://github.com/ExaDev/documents.js/compare/archive-codec%401.7.0...archive-codec%401.7.1) (2026-09-08)

### Bug Fixes

* **hooks:** remove stale per-package lint-staged fields ([1b85b5a](https://github.com/ExaDev/documents.js/commit/1b85b5a545fb9762879310ed4ea73b68fa73d00d))

### Miscellaneous Chores

* **deps:** pin every workspace dependency to an exact fixed version ([6a38142](https://github.com/ExaDev/documents.js/commit/6a38142facc043dfa499573f37431d3b32ff602e))


### Dependencies

- Updated document-schema.js to 7.3.1

## [1.7.0](https://github.com/ExaDev/documents.js/compare/archive-codec%401.6.8...archive-codec%401.7.0) (2026-09-08)

### Features

* **archive-codec:** add RC4/MD5 primitives for legacy Office encryption ([8f4ee3d](https://github.com/ExaDev/documents.js/commit/8f4ee3de5bb3b66972473efd40d88a9c27fc4c89))

### Documentation

* document RC4 decryption for encrypted xls workbooks ([268cbd3](https://github.com/ExaDev/documents.js/commit/268cbd342b080a0d23754d5b78e4fa87ebf17acf))

## [1.6.8](https://github.com/ExaDev/documents.js/compare/archive-codec%401.6.7...archive-codec%401.6.8) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.3.0

## [1.6.7](https://github.com/ExaDev/documents.js/compare/archive-codec%401.6.6...archive-codec%401.6.7) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.2.0

## [1.6.6](https://github.com/ExaDev/documents.js/compare/archive-codec%401.6.5...archive-codec%401.6.6) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.1.0

## [1.6.5](https://github.com/ExaDev/documents.js/compare/archive-codec%401.6.4...archive-codec%401.6.5) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.0.0

## [1.6.4](https://github.com/ExaDev/documents.js/compare/archive-codec%401.6.3...archive-codec%401.6.4) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.3

## [1.6.3](https://github.com/ExaDev/documents.js/compare/archive-codec%401.6.2...archive-codec%401.6.3) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.2

## [1.6.2](https://github.com/ExaDev/documents.js/compare/archive-codec%401.6.1...archive-codec%401.6.2) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.1

## [1.6.1](https://github.com/ExaDev/documents.js/compare/archive-codec%401.6.0...archive-codec%401.6.1) (2026-09-06)


### Dependencies

- Updated document-schema.js to ^6.2.0

## [1.6.0](https://github.com/ExaDev/documents.js/compare/archive-codec%401.5.0...archive-codec%401.6.0) (2026-09-06)

### Features

* **archive-codec:** add writeOlePackage, the mirror of readOlePackage ([ed1e771](https://github.com/ExaDev/documents.js/commit/ed1e7714fd0ec506bceaeb0de1c5f941a3d81fdb))

### Bug Fixes

* **archive-codec:** reject an embedded NUL byte in a Package stream string field ([96181b1](https://github.com/ExaDev/documents.js/commit/96181b148c2a362e9c5c5b5c98443971341ad2ea))

## [1.5.0](https://github.com/ExaDev/documents.js/compare/archive-codec%401.4.3...archive-codec%401.5.0) (2026-09-06)

### Features

* **workspace:** add per-package Stryker mutation testing configuration ([ff3eacc](https://github.com/ExaDev/documents.js/commit/ff3eacc124577b163a1c13a63b83484d9611ae5a))

### Bug Fixes

* **workspace:** drop the unused per-package @stryker-mutator/api dependency ([69270b6](https://github.com/ExaDev/documents.js/commit/69270b6e7ad7163c3b76cd085f4e5f367433994c))


### Dependencies

- Updated document-schema.js to ^6.1.0

## [1.4.3](https://github.com/ExaDev/documents.js/compare/archive-codec%401.4.2...archive-codec%401.4.3) (2026-09-06)

### Build System

* typecheck test/workers across every package where it is currently clean ([f340428](https://github.com/ExaDev/documents.js/commit/f340428b51a669010c0c4e5edb4310fe6ea4789a)), closes [#1021](https://github.com/ExaDev/documents.js/issues/1021)


### Dependencies

- Updated document-schema.js to ^6.0.0

## [1.4.2](https://github.com/ExaDev/documents.js/compare/archive-codec%401.4.1...archive-codec%401.4.2) (2026-09-05)

### Continuous Integration

* add the missing _test:coverage script to nine packages ([bc658d0](https://github.com/ExaDev/documents.js/commit/bc658d094b6ffbd0616cc225c57d5c0595374172))

## [1.4.1](https://github.com/ExaDev/documents.js/compare/archive-codec%401.4.0...archive-codec%401.4.1) (2026-09-05)


### Dependencies

- Updated document-schema.js to ^5.6.0

## [1.4.0](https://github.com/ExaDev/documents.js/compare/archive-codec%401.3.0...archive-codec%401.4.0) (2026-09-04)

### Features

* **archive-codec:** add MS-OLEPS Property Set Stream read/write support ([6752d07](https://github.com/ExaDev/documents.js/commit/6752d07db60580413da5a12b82275dd74d6ded19))
* **archive-codec:** add the LayoutMetadata <-> SummaryInformationProperties mapping ([3061c09](https://github.com/ExaDev/documents.js/commit/3061c09604286ceb8fd39706c0d42b5cd4553859))

### Bug Fixes

* **archive-codec:** skip undecodable property-set values instead of aborting the whole read ([d088848](https://github.com/ExaDev/documents.js/commit/d088848483b6cbf41176312be4a3b173cf8da6df))


### Dependencies

- Updated document-schema.js to ^5.5.1

## [1.3.0](https://github.com/ExaDev/documents.js/compare/archive-codec%401.2.0...archive-codec%401.3.0) (2026-09-03)

### Features

* **archive-codec:** write conformant [MS-CFB] compound files ([46724ab](https://github.com/ExaDev/documents.js/commit/46724abb37993fbbf4a9a3f7d89aef1a01eeb517))

### Documentation

* **archive-codec:** describe the compound-file write path ([4ed88db](https://github.com/ExaDev/documents.js/commit/4ed88db5264ebb0ae30601d868c1c0ddac06aefb))

## [1.2.0](https://github.com/ExaDev/documents.js/compare/archive-codec%401.1.2...archive-codec%401.2.0) (2026-08-24)

### Features

* **eslint:** lint JSON, Markdown, and YAML alongside the TypeScript ([016b127](https://github.com/ExaDev/documents.js/commit/016b127119733c50aa7694bad6265e9bc26bb215))

### Code Refactoring

* **archive-codec:** narrow the CFB stream partitions with a type predicate ([a979387](https://github.com/ExaDev/documents.js/commit/a979387b254b992e3e063ddcef78ec92db3f9a11))
* clear what strictTypeChecked's non-deviated rules found ([92a9fc9](https://github.com/ExaDev/documents.js/commit/92a9fc98f76244fca3a42ff0a12312ab0ce1a79b))
* **eslint:** put type-aware linting on the last six packages ([384e3be](https://github.com/ExaDev/documents.js/commit/384e3be118c912ba811bb9b00767ef689417deab))
* **tsconfig:** share the strict compiler options through one base config ([43af382](https://github.com/ExaDev/documents.js/commit/43af382f726d7d42754ac0b6bf6d91b0ae302e25))

### Styles

* format the workspace with prettier ([56c3a1d](https://github.com/ExaDev/documents.js/commit/56c3a1dd1b0f05fbeccfc9b5e8b1d27ca97486b4))

### Build System

* **deps-dev:** take @exadev/eslint-config 2.1.2 and re-enable its alias rule ([8ecd6de](https://github.com/ExaDev/documents.js/commit/8ecd6de0290c472038fbfe0ec7e47d055cd5d24b))

### Miscellaneous Chores

* **deps:** drop the dependencies each package no longer uses ([80094aa](https://github.com/ExaDev/documents.js/commit/80094aa6db412392ef6e6457014d5963a5e910a7))

## [1.1.2](https://github.com/ExaDev/documents.js/compare/archive-codec@1.1.1...archive-codec@1.1.2) (2026-08-23)

## [1.1.1](https://github.com/ExaDev/documents.js/compare/archive-codec@1.1.0...archive-codec@1.1.1) (2026-08-21)


### Bug Fixes

* **build:** build one dist file per src module so the advertised deep imports resolve ([bbaae2d](https://github.com/ExaDev/documents.js/commit/bbaae2d603eb0b5890bd682dbf9b1d480a8aa3b1)), closes [#745](https://github.com/ExaDev/documents.js/issues/745)

# [1.1.0](https://github.com/ExaDev/documents.js/compare/archive-codec@1.0.2...archive-codec@1.1.0) (2026-08-20)


### Bug Fixes

* read version-4 CFB sectors at (n + 1) * sectorSize ([2576f5d](https://github.com/ExaDev/documents.js/commit/2576f5d9b91a2d4ae3a046f0f8af585054239e81))


### Features

* add a bounded [MS-CFB] compound-file reader with mini-FAT and guard rails ([294d6e7](https://github.com/ExaDev/documents.js/commit/294d6e7ff7463af5e0df4e37a0b56fff3c62a2a8))
* detect the classic OLE compound-file signature alongside ZIP ([2c4065c](https://github.com/ExaDev/documents.js/commit/2c4065c03c2c9593cbe7f870a9df7ab5652c1d0d))
* unwrap the OLE Package stream packaging inside a compound-file embed ([758727a](https://github.com/ExaDev/documents.js/commit/758727ab2d0a667eb863332b5d1b5f692396c137))

## [1.0.2](https://github.com/ExaDev/documents.js/compare/archive-codec@1.0.1...archive-codec@1.0.2) (2026-08-20)

## [1.0.1](https://github.com/ExaDev/documents.js/compare/archive-codec@1.0.0...archive-codec@1.0.1) (2026-08-20)
