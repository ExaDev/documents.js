## [2.8.4](https://github.com/ExaDev/documents.js/compare/doc-codec%402.8.3...doc-codec%402.8.4) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.9.0
- Updated archive-codec to 1.10.6

## [2.8.3](https://github.com/ExaDev/documents.js/compare/doc-codec%402.8.2...doc-codec%402.8.3) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.8.0
- Updated archive-codec to 1.10.5

## [2.8.2](https://github.com/ExaDev/documents.js/compare/doc-codec%402.8.1...doc-codec%402.8.2) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.7.0
- Updated archive-codec to 1.10.4

## [2.8.1](https://github.com/ExaDev/documents.js/compare/doc-codec%402.8.0...doc-codec%402.8.1) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.6.1
- Updated archive-codec to 1.10.3

## [2.8.0](https://github.com/ExaDev/documents.js/compare/doc-codec%402.7.2...doc-codec%402.8.0) (2026-09-10)

### Features

* **doc-codec:** add a LibreOffice-produced real-doc corpus layer ([89dd56e](https://github.com/ExaDev/documents.js/commit/89dd56e05f60207be1b325f90b35e5f0016ea7a5))

## [2.7.2](https://github.com/ExaDev/documents.js/compare/doc-codec%402.7.1...doc-codec%402.7.2) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.6.0
- Updated archive-codec to 1.10.2

## [2.7.1](https://github.com/ExaDev/documents.js/compare/doc-codec%402.7.0...doc-codec%402.7.1) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.5.1
- Updated archive-codec to 1.10.1

## [2.7.0](https://github.com/ExaDev/documents.js/compare/doc-codec%402.6.0...doc-codec%402.7.0) (2026-09-08)

### Features

* **doc-codec:** write inline PNG/JPEG pictures and every section's own page geometry ([c29fd04](https://github.com/ExaDev/documents.js/commit/c29fd040037fd3a8e428a552cb4636f2758ed1ed))

### Code Refactoring

* **doc-codec:** extract a shared isomorphic base64 codec ([5d8424d](https://github.com/ExaDev/documents.js/commit/5d8424dcf2a929820ae0063213c87be7947e78dc))

### Documentation

* **doc-codec:** document multi-section and inline-picture writing ([a92df55](https://github.com/ExaDev/documents.js/commit/a92df55c0c5a0291e8ed9f8fa7a4bf8231b4892a))

## [2.6.0](https://github.com/ExaDev/documents.js/compare/doc-codec%402.5.0...doc-codec%402.6.0) (2026-09-08)

### Features

* **doc-codec:** decrypt XOR-obfuscated documents ([b93cbbc](https://github.com/ExaDev/documents.js/commit/b93cbbc8797703e752e61643bb118e28e244a037))


### Dependencies

- Updated archive-codec to 1.10.0

## [2.5.0](https://github.com/ExaDev/documents.js/compare/doc-codec%402.4.3...doc-codec%402.5.0) (2026-09-08)

### Features

* **doc-codec:** read every section's own page size and margins ([cf6d5fd](https://github.com/ExaDev/documents.js/commit/cf6d5fdf72611c41b7fa2db866f2458a939ed542))
* **doc-codec:** read footnotes, endnotes, comments, headers, and footers ([5747a21](https://github.com/ExaDev/documents.js/commit/5747a219fac8611a48f02aa50ee318cf6ede2c06))
* **doc-codec:** read inline picture bytes from the Data stream ([7bf75bd](https://github.com/ExaDev/documents.js/commit/7bf75bd5ffcaa0a8f6c75c87170dfae8abda3a0e))
* **doc-codec:** recurse into tables nested inside a table cell ([154241a](https://github.com/ExaDev/documents.js/commit/154241a11e8b4f99b73e65690ddc9858d73c9f27))

### Bug Fixes

* **doc-codec:** update smoke test's export manifest for readAllSectionProperties ([c8843ef](https://github.com/ExaDev/documents.js/commit/c8843ef3582ec810a4d79c8d2f6a65229545eee0))

### Documentation

* **doc-codec:** document nested table, section, note, and image reading ([cfcaa66](https://github.com/ExaDev/documents.js/commit/cfcaa66f0b4e90ab974eb73594281b48b35fa623))

## [2.4.3](https://github.com/ExaDev/documents.js/compare/doc-codec%402.4.2...doc-codec%402.4.3) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.5.0
- Updated archive-codec to 1.9.2

## [2.4.2](https://github.com/ExaDev/documents.js/compare/doc-codec%402.4.1...doc-codec%402.4.2) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.4.0
- Updated archive-codec to 1.9.1

## [2.4.1](https://github.com/ExaDev/documents.js/compare/doc-codec%402.4.0...doc-codec%402.4.1) (2026-09-08)


### Dependencies

- Updated archive-codec to 1.9.0

## [2.4.0](https://github.com/ExaDev/documents.js/compare/doc-codec%402.3.7...doc-codec%402.4.0) (2026-09-08)

### Features

* **doc-codec:** decrypt RC4-encrypted documents given a password ([7ca8998](https://github.com/ExaDev/documents.js/commit/7ca899874900d53daa151c3c4bdb43b0bd728afa))


### Dependencies

- Updated archive-codec to 1.8.0

## [2.3.7](https://github.com/ExaDev/documents.js/compare/doc-codec%402.3.6...doc-codec%402.3.7) (2026-09-08)


### Dependencies

- Updated archive-codec to 1.7.2

## [2.3.6](https://github.com/ExaDev/documents.js/compare/doc-codec%402.3.5...doc-codec%402.3.6) (2026-09-08)

### Bug Fixes

* **hooks:** remove stale per-package lint-staged fields ([1b85b5a](https://github.com/ExaDev/documents.js/commit/1b85b5a545fb9762879310ed4ea73b68fa73d00d))

### Miscellaneous Chores

* **deps:** pin every workspace dependency to an exact fixed version ([6a38142](https://github.com/ExaDev/documents.js/commit/6a38142facc043dfa499573f37431d3b32ff602e))


### Dependencies

- Updated document-schema.js to 7.3.1
- Updated archive-codec to 1.7.1

## [2.3.5](https://github.com/ExaDev/documents.js/compare/doc-codec%402.3.4...doc-codec%402.3.5) (2026-09-08)


### Dependencies

- Updated archive-codec to ^1.7.0

## [2.3.4](https://github.com/ExaDev/documents.js/compare/doc-codec%402.3.3...doc-codec%402.3.4) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.3.0
- Updated archive-codec to ^1.6.8

## [2.3.3](https://github.com/ExaDev/documents.js/compare/doc-codec%402.3.2...doc-codec%402.3.3) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.2.0
- Updated archive-codec to ^1.6.7

## [2.3.2](https://github.com/ExaDev/documents.js/compare/doc-codec%402.3.1...doc-codec%402.3.2) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.1.0
- Updated archive-codec to ^1.6.6

## [2.3.1](https://github.com/ExaDev/documents.js/compare/doc-codec%402.3.0...doc-codec%402.3.1) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.0.0
- Updated archive-codec to ^1.6.5

## [2.3.0](https://github.com/ExaDev/documents.js/compare/doc-codec%402.2.5...doc-codec%402.3.0) (2026-09-07)

### Features

* **doc-codec:** round-trip a paragraph's styleId/headingLevel through a real STSH entry ([c99a3a6](https://github.com/ExaDev/documents.js/commit/c99a3a6dced3037ab12a5b3824f11dec23b37c00))

### Documentation

* **doc-codec:** document styleId/headingLevel round-tripping through the style sheet ([86b78e1](https://github.com/ExaDev/documents.js/commit/86b78e1d0a67df1880e0d8ca382f63fe03edb185)), references [#1059](https://github.com/ExaDev/documents.js/issues/1059)

### Tests

* **doc-codec:** cover styleId/headingLevel round-tripping through a real STSH entry ([6a67003](https://github.com/ExaDev/documents.js/commit/6a67003f6c1a0a335376101e5c3a5be7b5ff86ca))

## [2.2.5](https://github.com/ExaDev/documents.js/compare/doc-codec%402.2.4...doc-codec%402.2.5) (2026-09-07)

### Bug Fixes

* **doc-codec:** resolve a style's own inherited formatting on read ([6cbbb18](https://github.com/ExaDev/documents.js/commit/6cbbb18873906cad0e594f670655f48b1e32a3ba))

### Documentation

* **doc-codec:** document style-inherited formatting resolution and split the write-side gap ([38a6575](https://github.com/ExaDev/documents.js/commit/38a657569315364be88719e96312a984703a16a3)), references [#1005](https://github.com/ExaDev/documents.js/issues/1005) [ExaDev/documents.js#1059](https://github.com/ExaDev/documents.js/issues/1059)

### Tests

* **doc-codec:** cover style formatting resolution, including inheritance precedence ([f87e27d](https://github.com/ExaDev/documents.js/commit/f87e27dd9f14ddeff53744773d97e0ac911d003b))

## [2.2.4](https://github.com/ExaDev/documents.js/compare/doc-codec%402.2.3...doc-codec%402.2.4) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.3
- Updated archive-codec to ^1.6.4

## [2.2.3](https://github.com/ExaDev/documents.js/compare/doc-codec%402.2.2...doc-codec%402.2.3) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.2
- Updated archive-codec to ^1.6.3

## [2.2.2](https://github.com/ExaDev/documents.js/compare/doc-codec%402.2.1...doc-codec%402.2.2) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.1
- Updated archive-codec to ^1.6.2

## [2.2.1](https://github.com/ExaDev/documents.js/compare/doc-codec%402.2.0...doc-codec%402.2.1) (2026-09-07)

### Documentation

* **doc-codec:** correct numbering.ts's [MS-DOC] 2.9.x structure citations ([613957b](https://github.com/ExaDev/documents.js/commit/613957b42cd28012e92b80127edc829b4b7085af)), closes [ExaDev/documents.js#1027](https://github.com/ExaDev/documents.js/issues/1027)
* **doc-codec:** correct swapped [MS-DOC] 2.6.1/2.6.2 property citations ([17e5602](https://github.com/ExaDev/documents.js/commit/17e5602a195a6c98a1d331d595282ba0d0c7da89)), closes [ExaDev/documents.js#1042](https://github.com/ExaDev/documents.js/issues/1042)

## [2.2.0](https://github.com/ExaDev/documents.js/compare/doc-codec%402.1.1...doc-codec%402.2.0) (2026-09-06)

### Features

* **doc-codec:** write real PlfLst/PlfLfo numbering tables for list membership ([cb12d68](https://github.com/ExaDev/documents.js/commit/cb12d68477e67bf986bd92fccd167a8e584fbde6))
* **doc-codec:** write sprmPDxaRight for paragraph right indent ([f18d988](https://github.com/ExaDev/documents.js/commit/f18d9888d90cfa0d0095930a5d5672a6481cfcb6))

### Bug Fixes

* **doc-codec:** reject numbering definition keys that collide once numeric ([02ae8a5](https://github.com/ExaDev/documents.js/commit/02ae8a5e5c2463345e10ffdc98c5631e018eeba9))


### Dependencies

- Updated document-schema.js to ^6.2.0
- Updated archive-codec to ^1.6.1

## [2.1.1](https://github.com/ExaDev/documents.js/compare/doc-codec%402.1.0...doc-codec%402.1.1) (2026-09-06)


### Dependencies

- Updated archive-codec to ^1.6.0

## [2.1.0](https://github.com/ExaDev/documents.js/compare/doc-codec%402.0.0...doc-codec%402.1.0) (2026-09-06)

### Features

* **workspace:** add per-package Stryker mutation testing configuration ([ff3eacc](https://github.com/ExaDev/documents.js/commit/ff3eacc124577b163a1c13a63b83484d9611ae5a))

### Bug Fixes

* **workspace:** drop the unused per-package @stryker-mutator/api dependency ([69270b6](https://github.com/ExaDev/documents.js/commit/69270b6e7ad7163c3b76cd085f4e5f367433994c))


### Dependencies

- Updated document-schema.js to ^6.1.0
- Updated archive-codec to ^1.5.0

## [2.0.0](https://github.com/ExaDev/documents.js/compare/doc-codec%401.1.2...doc-codec%402.0.0) (2026-09-06)

### ⚠ BREAKING CHANGES

* **doc-codec:** readDocContent's ContentTableCell.background is now a
  discriminated ContentCellFill rather than a bare Color, matching
  document-schema.js's own breaking change to the shared schema.
  writeDocContent's cell background parameter changes the same way. A
  caller reading a solid background as a Color directly, or constructing
  one, must wrap/unwrap it as { kind: 'solid', color }.

### Features

* **doc-codec:** add fitsAloneOnPapxPage to predict a lone paragraph's PapxFkp fit ([cf17003](https://github.com/ExaDev/documents.js/commit/cf17003686023d16f675e964b4541cc0397a0c1a))
* **doc-codec:** read and write real pattern fills instead of dropping them ([c668c33](https://github.com/ExaDev/documents.js/commit/c668c33e5ceab7c18b12f9f479bf71f35b7c2431))

### Bug Fixes

* **doc-codec:** apply the rounding-aware write ceiling to dptLineWidthFor, not just its floor ([033ab54](https://github.com/ExaDev/documents.js/commit/033ab54fe9b5ee8d6ba0249bdbb4370b95e5543b))
* **doc-codec:** apply the rounding-aware write floor to every border style, not double alone ([ea5f7d0](https://github.com/ExaDev/documents.js/commit/ea5f7d0d2b370547be83c5548e66c2156670949b))
* **doc-codec:** assign each lost table boundary to one row instead of splitting every row ([b2daa42](https://github.com/ExaDev/documents.js/commit/b2daa4200c650273d0cc8fc75d54ee1f01a23b19)), references [#992](https://github.com/ExaDev/documents.js/issues/992)
* **doc-codec:** capture sprmTTableBorders(80) and read sprmTSetShdTable ([8f3573f](https://github.com/ExaDev/documents.js/commit/8f3573fd10d1c457014629e3eaeb2c00a6b56bf8))
* **doc-codec:** cascade row/table-level borders onto cells with none ([5b5f62a](https://github.com/ExaDev/documents.js/commit/5b5f62a13605cd4a560fef1ac6be33bcdf7be289))
* **doc-codec:** cite TCGRF's own horzMerge value for a lost-boundary continuation cell ([322edca](https://github.com/ExaDev/documents.js/commit/322edca22ac6037cb3f93c1a115add196131fb78))
* **doc-codec:** correct the lost-boundary trim comment's monotonicity claim ([11f386e](https://github.com/ExaDev/documents.js/commit/11f386e3c50aa7110177327e2276f8b416772b71))
* **doc-codec:** fall back per row when a lost-boundary split overflows its PapxInFkp budget ([e3169f4](https://github.com/ExaDev/documents.js/commit/e3169f43df1f905ffc368e1aacc9af060d2b8db2)), references [#992](https://github.com/ExaDev/documents.js/issues/992) [#992](https://github.com/ExaDev/documents.js/issues/992) [pre-#992](https://github.com/pre-/issues/992) [#992](https://github.com/ExaDev/documents.js/issues/992)
* **doc-codec:** give a ragged table's exposed non-merged cell the table's real bottom border ([cea5163](https://github.com/ExaDev/documents.js/commit/cea516309c9a230792072ab55e97cb04de02be34))
* **doc-codec:** give a vertically merged anchor the table's real bottom border ([f6d6ed4](https://github.com/ExaDev/documents.js/commit/f6d6ed4cbf543583976d4272363b1d53720071a4))
* **doc-codec:** let a double border's own width dip below the single-line minimum on write ([3ea18ad](https://github.com/ExaDev/documents.js/commit/3ea18ad3a8209615e3d3c04de896fe40b3e15d03))
* **doc-codec:** name the degraded table in the lost-boundary onWarning message ([b29275b](https://github.com/ExaDev/documents.js/commit/b29275baf31dbe5d6b4c02b3176b8ebd9750110b))
* **doc-codec:** parse TableBordersOperand and TableBordersOperand80 ([0cd6dc9](https://github.com/ExaDev/documents.js/commit/0cd6dc95adec8f80db997bd7a98c233ca2d4ade4))
* **doc-codec:** preserve an explicit sprmTSetBrc border clear through the row cascade ([ea8661f](https://github.com/ExaDev/documents.js/commit/ea8661f0522405880c5b8ec5c089944c906be3a1))
* **doc-codec:** read a vertically merged anchor's bottom border from the table's real last row ([5af9b94](https://github.com/ExaDev/documents.js/commit/5af9b945caec53d20a40cb1763e3010776737894))
* **doc-codec:** read sprmTSetBrc80 into the row's per-cell border-clear path ([79beefa](https://github.com/ExaDev/documents.js/commit/79beefaaf8303938acdb095db015c8bdb81c6225))
* **doc-codec:** recover colSpan and columnWidthsPt across a table-wide merged boundary ([a9639f0](https://github.com/ExaDev/documents.js/commit/a9639f0516f11c5442f70d06cae4005536c8e44a))
* **doc-codec:** resolve a vertMerge chain's own last row before checking ragged-table coverage ([df82100](https://github.com/ExaDev/documents.js/commit/df82100530d13ecd6757415f0b8ae3f8686ddd4f))
* **doc-codec:** state the true rounding-aware write floor for a double border's own width ([434d440](https://github.com/ExaDev/documents.js/commit/434d440dccaf281f53b64393b12c5a94b3dd2a18))
* **doc-codec:** stop the per-row trim warning overclaiming a same-row, immediate throw ([99eb630](https://github.com/ExaDev/documents.js/commit/99eb6304c1ba370d21af63912b1bd8a1e80c3cb1))
* **doc-codec:** stop the unsplit-fallback warning claiming success it can't guarantee ([96a5a2b](https://github.com/ExaDev/documents.js/commit/96a5a2b71c7572084476c3579374e905a1b83f04))
* **doc-codec:** switch exhaustively on cell-fill kind instead of if/else ([dee6786](https://github.com/ExaDev/documents.js/commit/dee6786f4539646e7c596f2623dcf05351c1bf7c))
* **doc-codec:** trim a row's lost-boundary split to what fits both format ceilings ([4e5859e](https://github.com/ExaDev/documents.js/commit/4e5859ec3ddd3f8aa8628eb257741eae3e6a7db8))
* **doc-codec:** triple dptLineWidth into widthPt for double-line cell borders ([3a4bcf2](https://github.com/ExaDev/documents.js/commit/3a4bcf21a1b733de90eb38e8cae307c0305bd31e))

### Code Refactoring

* **doc-codec:** export the table row cell-count ceiling from tap-write.ts ([c71bdea](https://github.com/ExaDev/documents.js/commit/c71bdead986ebfb6dc040c698e17f6dce1a0d5ae))
* **doc-codec:** make TapWriteRow's horzMerge required, dropping its unreachable default ([97005ee](https://github.com/ExaDev/documents.js/commit/97005eee3bf306e6c52f801433ed23b6f76f8627))
* **document-schema.js:** host unrecognizedFillKind for every cell-fill writer ([855121a](https://github.com/ExaDev/documents.js/commit/855121a58523e0ad8f332e28be8def3454918bc7))

### Documentation

* **doc-codec:** attribute the "unless modified" clause to sprmTTableBorders alone ([7abd206](https://github.com/ExaDev/documents.js/commit/7abd206077a6de3bc218915848f61338ec3fbc1d))
* **doc-codec:** attribute the grpprlTapx restriction to sprmTCellNoWrapStyle alone ([d203260](https://github.com/ExaDev/documents.js/commit/d203260d928f1b9051950637eacd1cc284944e04))
* **doc-codec:** cite all three ECMA-376 sections MS-DOC's own border-precedence text names ([10f1c11](https://github.com/ExaDev/documents.js/commit/10f1c11c130656aed9d25752940ce9458ec59a43))
* **doc-codec:** cite the correct [MS-DOC] section for NumberOfColumns's 63-cell ceiling ([1cd0f0b](https://github.com/ExaDev/documents.js/commit/1cd0f0bdf432c48f25a70dd0fe7d6ab5bbec16ca))
* **doc-codec:** cite the MS-DOC text that justifies brcBottom reaching a vertMerge anchor ([11abeb6](https://github.com/ExaDev/documents.js/commit/11abeb6e52f15cc4026be4f6254908cf3857ff2c))
* **doc-codec:** correct TableBrc80Operand's name and the TC80-alone overclaim ([00d3498](https://github.com/ExaDev/documents.js/commit/00d34981f75e80a54d1bd83e2934bd2943e8e0cb))
* **doc-codec:** correct the double-border-width note's claim about the other 23 collapsed BrcTypes ([866f3c4](https://github.com/ExaDev/documents.js/commit/866f3c4e5a612b06fd0dceca5d9a7a7394e3efc9))
* **doc-codec:** correct the lost-boundary trim's monotonicity claim ([eb0b82c](https://github.com/ExaDev/documents.js/commit/eb0b82cc2609cc17ce703ee5119761c39bc9ada5))
* **doc-codec:** correct the lost-boundary trim's unreachable non-monotonicity claim ([2cfb75e](https://github.com/ExaDev/documents.js/commit/2cfb75e6606d288d3a7c83d63625afe5242fa932))
* **doc-codec:** correct the OUTSET/INSET border-width formula and the double-floor unit claim ([1f794fb](https://github.com/ExaDev/documents.js/commit/1f794fb80bcad838ba03352cbe63ac8d647d5799))
* **doc-codec:** correct the per-row 15-fixed-byte ceiling's own breakdown ([7dfc7a6](https://github.com/ExaDev/documents.js/commit/7dfc7a6c47d159087f49968083eefe4cfa5d5191))
* **doc-codec:** correct the per-row column ceiling to 21 and document the budget fallback ([2e9a971](https://github.com/ExaDev/documents.js/commit/2e9a971f04e89927b7299926e15a18ec0a622fac))
* **doc-codec:** describe the clearedSides fix the row-border cascade paragraph never got ([a65550c](https://github.com/ExaDev/documents.js/commit/a65550c32e6c52605fdaf218febee2014a5647bf))
* **doc-codec:** describe the row-border cascade's real bottom-edge rule ([ab973c0](https://github.com/ExaDev/documents.js/commit/ab973c041759e1b1e1565a69c74364a31b5ec3e2))
* **doc-codec:** describe the trimmed, dual-ceiling lost-boundary fallback ([87d837d](https://github.com/ExaDev/documents.js/commit/87d837db67c46f23befe912a3d3899d77c218bbc))
* **doc-codec:** document the lost-boundary merge fallback and its LibreOffice trade-off ([3a1090b](https://github.com/ExaDev/documents.js/commit/3a1090bc5bb48f06a4fed5e250faabf53f533236))
* **doc-codec:** document the row/table border cascade ([a721713](https://github.com/ExaDev/documents.js/commit/a721713218b7733fb12aed3212150f579e928bdc))
* **doc-codec:** drop the false sprmTCellShdStyle/sprmTSetShdTable adjacency claim ([967b36e](https://github.com/ExaDev/documents.js/commit/967b36ef4aa66ff8eed706e0d4f343e50b422532))
* **doc-codec:** drop the false sprmTCellVertAlignStyle adjacency claim ([3426b64](https://github.com/ExaDev/documents.js/commit/3426b6458162dc2fad67d19a8091962846ad8f98))
* **doc-codec:** fix a self-quoting reference that pointed 'above' at content actually below it ([2b3714e](https://github.com/ExaDev/documents.js/commit/2b3714ec4952a2a6f140e085633e543889416166))
* **doc-codec:** fix cellReachesTableBottom's self-contradictory ragged-cell claim ([10b5c95](https://github.com/ExaDev/documents.js/commit/10b5c957dfd25bf5a83717ec98d8dd354fa4c57f))
* **doc-codec:** fix ipatPctNew* count in IPAT_TO_PATTERN_TYPE's doc comment ([3fe0e8f](https://github.com/ExaDev/documents.js/commit/3fe0e8f99cdff5848f4ae87d3c0110a98f3782ba))
* **doc-codec:** fix ipatPctNew* mapped-range upper bound in README ([f3f86b3](https://github.com/ExaDev/documents.js/commit/f3f86b326aa9b04ce9111165094423f72d597799))
* **doc-codec:** fix the vertically-merged-cells quote's misattribution to Figure 2's own caption ([f084a47](https://github.com/ExaDev/documents.js/commit/f084a47d7929cf4c7fb16ee0bfaf254a4aec3844))
* **doc-codec:** link the style-inherited-formatting gap to its own issue ([e9939ab](https://github.com/ExaDev/documents.js/commit/e9939aba9ec2ab171ddf37cc1f4a1dc9772bdf45)), references [ExaDev/documents.js#1005](https://github.com/ExaDev/documents.js/issues/1005)
* **doc-codec:** name the writer's own trim fallback as a source of unrecoverable column boundaries ([74054e3](https://github.com/ExaDev/documents.js/commit/74054e3eb944a58399b902d5f221e5360fa8bc96)), references [#1013](https://github.com/ExaDev/documents.js/issues/1013)
* **doc-codec:** narrow brcBottom's clause to the two paths cellReachesTableBottom actually checks ([2bdfd39](https://github.com/ExaDev/documents.js/commit/2bdfd39517b1c3fce0681eb9cce6870f7d0abaf9))
* **doc-codec:** narrow the TC80-alone border-clear claim to cover sprmTSetBrc80 too ([c70f626](https://github.com/ExaDev/documents.js/commit/c70f6269b72dafc79e5b7463380a6069772850aa))
* **doc-codec:** point the lost-boundary comments at the README's real per-row arithmetic ([fcf6997](https://github.com/ExaDev/documents.js/commit/fcf6997eabf69da917b36d8650f69844850c1d9f))
* **doc-codec:** point two remaining self-references at their real targets ([97eef83](https://github.com/ExaDev/documents.js/commit/97eef833e4d9d44f350900a4e9bc396eae1cd3de))
* **doc-codec:** restore the ragged-table bottom-border path's real non-continuation scope ([1808e94](https://github.com/ExaDev/documents.js/commit/1808e94284c1733254c02522431942cc15e8b16b))
* **doc-codec:** restore the sprmTMerge lost-boundary-fallback nuance lost in a rebase ([b8e44dd](https://github.com/ExaDev/documents.js/commit/b8e44dd1868b5ba47f093dcb1e0d5d15d847b8f2)), references [992/#1013](https://github.com/ExaDev/documents.js/issues/1013)
* **doc-codec:** state sprmTSetShdTable's actual shading scope as per-row ([9feedba](https://github.com/ExaDev/documents.js/commit/9feedba0e446949e5c9f48cab02671dd9042736c))
* **doc-codec:** state the ragged-table check's own start-grid-index scope ([3e60833](https://github.com/ExaDev/documents.js/commit/3e60833eafffed5ea6d807c9850854ad41227f50))
* **doc-codec:** state the row-border cascade's real bcBottom rule everywhere it was described ([f926539](https://github.com/ExaDev/documents.js/commit/f926539b130b64949e5bb30186a88b89ed242b93))
* **doc-codec:** state the true rounding-aware write ceiling, not the naive top value ([c86925e](https://github.com/ExaDev/documents.js/commit/c86925e323431b94cd6086283a831a70ed3c365d))
* **doc-codec:** stop promising onWarning never precedes a hard failure ([f42ee75](https://github.com/ExaDev/documents.js/commit/f42ee754b02cdc5a59421494f88a993c61caa043))
* **doc-codec:** trim trailing whitespace from the style-inherited-formatting table row ([5317c1f](https://github.com/ExaDev/documents.js/commit/5317c1fd192b30dec819b3c8b10cf3d8b839aa4e))
* **doc-codec:** update TableBordersSet's stale brcBottom description ([f7453a8](https://github.com/ExaDev/documents.js/commit/f7453a8de93f4e244716618dcab843dbadf9f607))
* **doc-codec:** update the double-line border width note to match the fix ([996d35b](https://github.com/ExaDev/documents.js/commit/996d35b3c65bb61e45aaa2783b37e63215ec1610))

### Tests

* **doc-codec:** correct the 64-cell test's NumberOfColumns citation ([e855d65](https://github.com/ExaDev/documents.js/commit/e855d65eacbe95696c6bd93d9e14acc013779290))
* **doc-codec:** cover readShd80's packed ipat field against the new pattern entries ([8151ddd](https://github.com/ExaDev/documents.js/commit/8151ddd01985fe52907ffbb905ff57efa92915c0))
* **doc-codec:** cover the 63-cell ceiling and partial-boundary-trim fallback paths ([f3ce882](https://github.com/ExaDev/documents.js/commit/f3ce882151e120f48c5912ee2e1e339e8361f8e4))
* **doc-codec:** cover the per-row lost-boundary budget fallback and its degradation reporting ([3c18558](https://github.com/ExaDev/documents.js/commit/3c18558d5212ead62f815624cae21af30dfb70aa))
* **doc-codec:** exercise cross-row grid resolution in the vertMerge bottom-border cascade ([ffd0948](https://github.com/ExaDev/documents.js/commit/ffd09480d03a27520130ad56c8b254bac1676792))
* **doc-codec:** expect ContentCellFill's discriminated shape in the ([b993776](https://github.com/ExaDev/documents.js/commit/b993776c0444f938e9a77e8adaedea68ec2d2322)), references [#951](https://github.com/ExaDev/documents.js/issues/951) [#945](https://github.com/ExaDev/documents.js/issues/945)
* **doc-codec:** fix two cell objects the rebase's textual merge left type-broken ([356794c](https://github.com/ExaDev/documents.js/commit/356794c885e67e86079d773de38c747265c0dc2f))
* **doc-codec:** pin that a 0.5pt double border reads back as 0.75pt, not 0.5pt ([34b1c93](https://github.com/ExaDev/documents.js/commit/34b1c939fadde841827dd7ddd271d2866c553f21))
* **doc-codec:** pin the corrected 0.1875pt write floor for both border-width branches ([083494d](https://github.com/ExaDev/documents.js/commit/083494d84b915242bfcab994b1c5a75005bd8aa1))

### Build System

* typecheck test/workers across every package where it is currently clean ([f340428](https://github.com/ExaDev/documents.js/commit/f340428b51a669010c0c4e5edb4310fe6ea4789a)), closes [#1021](https://github.com/ExaDev/documents.js/issues/1021)


### Dependencies

- Updated document-schema.js to ^6.0.0
- Updated archive-codec to ^1.4.3

## [1.1.2](https://github.com/ExaDev/documents.js/compare/doc-codec%401.1.1...doc-codec%401.1.2) (2026-09-05)

### Continuous Integration

* add the missing _test:coverage script to nine packages ([bc658d0](https://github.com/ExaDev/documents.js/commit/bc658d094b6ffbd0616cc225c57d5c0595374172))


### Dependencies

- Updated archive-codec to ^1.4.2

## [1.1.1](https://github.com/ExaDev/documents.js/compare/doc-codec%401.1.0...doc-codec%401.1.1) (2026-09-05)


### Dependencies

- Updated document-schema.js to ^5.6.0
- Updated archive-codec to ^1.4.1

## [1.1.0](https://github.com/ExaDev/documents.js/compare/doc-codec%401.0.2...doc-codec%401.1.0) (2026-09-04)

### Features

* **doc-codec:** add a genuine MS-DOC structure writer ([40d52d2](https://github.com/ExaDev/documents.js/commit/40d52d205ead14dd4222d1bf210f120714ad8864))
* **doc-codec:** encode a table row's own TAP as sprmTDefTable/sprmTMerge ([fd39211](https://github.com/ExaDev/documents.js/commit/fd39211de7c19d5dd5418ba3fdd469d5514379d5))
* **doc-codec:** fold a table row's own sgc-5 grpprl into its TAP ([afc92b0](https://github.com/ExaDev/documents.js/commit/afc92b0d2d353e26f76aeaa4fb072328ff476df0))
* **doc-codec:** parse sprmPItap and the nested-table paragraph marks ([9aaacdb](https://github.com/ExaDev/documents.js/commit/9aaacdb550fbf2889be900457aefdc56eb85b69d))
* **doc-codec:** read a paragraph's own numbering definitions from PlfLst/PlfLfo ([2bc0011](https://github.com/ExaDev/documents.js/commit/2bc00119a68ea699ef16d058321459465e363b69))
* **doc-codec:** read a run of table-depth paragraphs as a real ContentTable ([f0ed5a4](https://github.com/ExaDev/documents.js/commit/f0ed5a42123f2b21b5f69a30f79e0a9b1c768f17))
* **doc-codec:** read a vertical merge stated through sprmTVertMerge ([6430420](https://github.com/ExaDev/documents.js/commit/643042078b58bd8c7ada308e157648c404c16186))
* **doc-codec:** read and write a section's own page size and margins ([c70d9d1](https://github.com/ExaDev/documents.js/commit/c70d9d135a92467e75cc4a61cef49b8297f42d71))
* **doc-codec:** read and write a table cell's borders and background shading ([bc9db2c](https://github.com/ExaDev/documents.js/commit/bc9db2c287a64bf0ffe94d5775a8d56aabd3f5be)), references [#892](https://github.com/ExaDev/documents.js/issues/892) [#895](https://github.com/ExaDev/documents.js/issues/895)
* **doc-codec:** read and write document metadata via SummaryInformation ([824ff8e](https://github.com/ExaDev/documents.js/commit/824ff8e1feca0a8a964f2d187e8537bdf078c539))
* **doc-codec:** write a ContentTable as real physical-cell paragraphs ([e2b1dc4](https://github.com/ExaDev/documents.js/commit/e2b1dc434a270d0e98022e293086da19f9147b38))

### Bug Fixes

* **doc-codec:** append a trailing paragraph mark when a table ends the section ([d456ed2](https://github.com/ExaDev/documents.js/commit/d456ed282c51e69f2009d2d695b9c1386e3a872f)), references [#892](https://github.com/ExaDev/documents.js/issues/892)
* **doc-codec:** clamp the column-boundary tolerance below a real narrow column ([cd02428](https://github.com/ExaDev/documents.js/commit/cd02428c1ead856ef42103c09abf28504064ce2e))
* **doc-codec:** correct an overclaim about byte-level LibreOffice parity ([6893a96](https://github.com/ExaDev/documents.js/commit/6893a962d9d91f418c5fc58c8c0b3792b753bbbe))
* **doc-codec:** degrade an unresolvable table row to flat paragraphs ([c76ef1c](https://github.com/ExaDev/documents.js/commit/c76ef1ca96fdbbd64d43b2dbe48d64add041236b))
* **doc-codec:** fold sprmTMerge/sprmTVertMerge regardless of grpprl order ([abb690d](https://github.com/ExaDev/documents.js/commit/abb690d654fee1040777bc5153f0b58e656908b2))
* **doc-codec:** preserve a vertical continuation's own colSpan on read ([ea26639](https://github.com/ExaDev/documents.js/commit/ea26639239dbc3a7924ac0cc450e0db60354f404))
* **doc-codec:** reject a malformed createdIso/modifiedIso before the FILETIME conversion ([e64d748](https://github.com/ExaDev/documents.js/commit/e64d748a20522611f8919a6681d8c50179a2f224))
* **doc-codec:** resolve an out-of-range decorative Ico byte to automatic, not a thrown error ([9f24edc](https://github.com/ExaDev/documents.js/commit/9f24edc874651435f439e9fd896593d3c664814b))
* **doc-codec:** snap table column boundaries within a point when unioning rows into one grid ([f300c11](https://github.com/ExaDev/documents.js/commit/f300c11e63d23536e6203f50f4ac26f3f861df03))
* **doc-codec:** track vertical merges by column, not blank cells, on write ([7c69277](https://github.com/ExaDev/documents.js/commit/7c69277c3044c197304cd9e8778c1f58ed2cc62c))
* **doc-codec:** write and read a horizontal merge through a row's own physical cell layout ([d9a7137](https://github.com/ExaDev/documents.js/commit/d9a713740b62fb6fa64af7d61562331f2fa1b56e))

### Code Refactoring

* **doc-codec:** consume archive-codec's shared LayoutMetadata mapping ([e5d3c06](https://github.com/ExaDev/documents.js/commit/e5d3c06b4663ce63ef19d0e15b72c659b05bf866))
* **doc-codec:** lift the Ico palette and COLORREF codec into a shared module ([f4dd141](https://github.com/ExaDev/documents.js/commit/f4dd14178f4c1049a3784be9b27c86b1832df745))
* **ppt-codec:** consume archive-codec's shared LayoutMetadata mapping ([7d0c81d](https://github.com/ExaDev/documents.js/commit/7d0c81d4842979eddf3a5ab0dc6e3201c390565a))

### Documentation

* **doc-codec:** confirm the horizontal-merge fix against real LibreOffice ([760d884](https://github.com/ExaDev/documents.js/commit/760d884e32b93d3b5e9cf0ab8addfbfc3e0660e5))
* **doc-codec:** correct a comment overclaiming round-trip-alone verification ([15f58bd](https://github.com/ExaDev/documents.js/commit/15f58bdb0e3097babe84a95063a9415c55a37f21)), references [#892](https://github.com/ExaDev/documents.js/issues/892)
* **doc-codec:** correct nine wrong [MS-DOC] section numbers in the decoration citations ([4ffb571](https://github.com/ExaDev/documents.js/commit/4ffb5713379bb7dcb6d1e2d4a4d6b7dec55d292a))
* **doc-codec:** correct the drift-tolerance changeover's own attribution ([3aa01b2](https://github.com/ExaDev/documents.js/commit/3aa01b24d8590310f05c3da2ae8518079c2a65b0))
* **doc-codec:** correct the false claim that LibreOffice recognises a written table ([54600ed](https://github.com/ExaDev/documents.js/commit/54600ed3b315c203ce20a5986865ff6a6e1ea59e)), references [#892](https://github.com/ExaDev/documents.js/issues/892)
* **doc-codec:** describe cell decoration and what verified it ([ac5d15c](https://github.com/ExaDev/documents.js/commit/ac5d15c1dc407c3730ba7edaff2c7c75f1ec24b0))
* **doc-codec:** document a section's page size and margins as read and written ([3ab55ac](https://github.com/ExaDev/documents.js/commit/3ab55acfc2292ae563dfc74c36a859f586dbc5c3))
* **doc-codec:** document doc-codec's new write support ([8775a1c](https://github.com/ExaDev/documents.js/commit/8775a1ca28efee6431ac5150874ed539ae63ea27))
* **doc-codec:** document numbering definitions as built and shipped ([3cbf214](https://github.com/ExaDev/documents.js/commit/3cbf214657083413dbf6b126e8b99cc6f59fbd6d))
* **doc-codec:** document table read/write scope and the merge caveat ([426a026](https://github.com/ExaDev/documents.js/commit/426a026489f6c43cdc1f1f808cbf142f0df8c819))
* **doc-codec:** document the confirmed root cause of the table-recognition regression ([b2aae6c](https://github.com/ExaDev/documents.js/commit/b2aae6c0f367afc10965994b4629c8e153e7a30f)), references [#892](https://github.com/ExaDev/documents.js/issues/892) [#892](https://github.com/ExaDev/documents.js/issues/892)
* **doc-codec:** document the merge-tracking and degrade fixes ([27bae01](https://github.com/ExaDev/documents.js/commit/27bae01897bd07e61e74b725dacf865dc26fa12f))
* **doc-codec:** fix a test description left stale by table support ([6c5849a](https://github.com/ExaDev/documents.js/commit/6c5849a3d855658955aef4ef2d376a826d0c354d))
* **doc-codec:** state the column-grid tolerance and the missing table indent in the Tables section ([ae42750](https://github.com/ExaDev/documents.js/commit/ae42750c203da78a2a1a44f2a380a02053908ce4))

### Styles

* **doc-codec:** fix table column padding in the README's scope table ([e97219f](https://github.com/ExaDev/documents.js/commit/e97219f8b07472b044aac45246f9a67f0c490498))

### Tests

* **doc-codec:** cover numbering definitions with hand-built PlfLst/PlfLfo fixtures ([d49d83c](https://github.com/ExaDev/documents.js/commit/d49d83c0669e1efd4e496222a07070dbfdee601c))
* **doc-codec:** cover section page size and margins, both YAS margin forms ([596899c](https://github.com/ExaDev/documents.js/commit/596899cc95603f2ddca75328ba7e1be02dc4a5bd))
* **doc-codec:** exercise the column-grid union directly, not via round trips ([4cff689](https://github.com/ExaDev/documents.js/commit/4cff689d593228fd1b74a2c4ffb79d96d781e8cc))
* **doc-codec:** hand-assemble table bytes independently of the writer ([5a09acf](https://github.com/ExaDev/documents.js/commit/5a09acfdfb73ca4e8b2431e62d7fed7f754797f3))
* **doc-codec:** pin the narrow-column clamp against the drift tolerance ([5b4e903](https://github.com/ExaDev/documents.js/commit/5b4e903624fb4fddf7a85c7d1d9857d99f6485ca))
* **doc-codec:** verify writeDocContent by reading its own output back ([31ef85a](https://github.com/ExaDev/documents.js/commit/31ef85a894957acbddbeeccb9dafa4230c853df0))


### Dependencies

- Updated document-schema.js to ^5.5.1
- Updated archive-codec to ^1.4.0

## [1.0.2](https://github.com/ExaDev/documents.js/compare/doc-codec%401.0.1...doc-codec%401.0.2) (2026-09-03)


### Dependencies

- Updated document-schema.js to ^5.5.0

## [1.0.1](https://github.com/ExaDev/documents.js/compare/doc-codec%401.0.0...doc-codec%401.0.1) (2026-09-03)


### Dependencies

- Updated archive-codec to ^1.3.0

## 1.0.0 (2026-09-03)

### Features

* **doc-codec:** add bounds-checked readers and the PLC container shape ([b75682f](https://github.com/ExaDev/documents.js/commit/b75682fb21771516d8c5580313b36042b573fd00))
* **doc-codec:** convert a .doc to a ContentDocument ([8cd7e3a](https://github.com/ExaDev/documents.js/commit/8cd7e3a118421cd96c67ebc5471d01bd5d5ee4cc))
* **doc-codec:** parse the File Information Block ([c4e5430](https://github.com/ExaDev/documents.js/commit/c4e5430df77626373a12972625b03579474536d1))
* **doc-codec:** read style identity from the style sheet ([7bff98e](https://github.com/ExaDev/documents.js/commit/7bff98e2514f27df8f7bf595e42ea6496fef9c0c))
* **doc-codec:** reconstruct logical text through the piece table ([45fc59f](https://github.com/ExaDev/documents.js/commit/45fc59fb4ba1a38352cbfcc0a76a94510bc35a6b))
* **doc-codec:** resolve character and paragraph formatting exceptions ([38b044f](https://github.com/ExaDev/documents.js/commit/38b044fbc93bdca019e9e720376abf87bc62ba99))

### Bug Fixes

* **doc-codec:** keep an outer field's result text after a nested field ends ([5a0e8a3](https://github.com/ExaDev/documents.js/commit/5a0e8a383ffe2e59f0fa955d696012ad597513b0))

### Performance Improvements

* **doc-codec:** cache folded character properties across the whole read ([04fdf5f](https://github.com/ExaDev/documents.js/commit/04fdf5f25c3c4ebd249ad21c61e0ff416be54f95))

### Documentation

* **doc-codec:** state what the reader covers and what it does not ([a7a092f](https://github.com/ExaDev/documents.js/commit/a7a092f297ff41b115f87dd3e50d2b8ae76e9c03))

### Tests

* **doc-codec:** exercise a Chpx run spanning several paragraphs ([256a8cb](https://github.com/ExaDev/documents.js/commit/256a8cb921e16f72755286dae7beb6109687c1b3))

### Miscellaneous Chores

* **doc-codec:** ignore the package's own build output ([afafd01](https://github.com/ExaDev/documents.js/commit/afafd0162e7a1b21baec726f2d1d3a0bd2067289))
* **doc-codec:** scaffold the .doc reader package ([2dca70e](https://github.com/ExaDev/documents.js/commit/2dca70e2154f3c7219299b9d0e7549a655711449))
