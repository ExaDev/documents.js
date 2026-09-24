## [12.2.11](https://github.com/ExaDev/documents.js/compare/ooxml.js%4012.2.10...ooxml.js%4012.2.11) (2026-09-24)


### Dependencies

- Updated archive-codec to 1.11.15

## [12.2.10](https://github.com/ExaDev/documents.js/compare/ooxml.js%4012.2.9...ooxml.js%4012.2.10) (2026-09-24)


### Dependencies

- Updated archive-codec to 1.11.14

## [12.2.9](https://github.com/ExaDev/documents.js/compare/ooxml.js%4012.2.8...ooxml.js%4012.2.9) (2026-09-24)


### Dependencies

- Updated byte-codec to 2.0.0
- Updated archive-codec to 1.11.13

## [12.2.8](https://github.com/ExaDev/documents.js/compare/ooxml.js%4012.2.7...ooxml.js%4012.2.8) (2026-09-23)

### Code Refactoring

* **ooxml.js:** route docx read.ts's discovery-order counter through one function ([4f50b0b](https://github.com/ExaDev/documents.js/commit/4f50b0bc00628766139987939133e3519ac25d28))

## [12.2.7](https://github.com/ExaDev/documents.js/compare/ooxml.js%4012.2.6...ooxml.js%4012.2.7) (2026-09-23)

### Tests

* **ooxml.js:** pin a solid fill's colours and a styled border edge's colour, isolated per test ([923cf70](https://github.com/ExaDev/documents.js/commit/923cf70a2abee1db57b0d16f03d9d6cce814e328))
* **ooxml.js:** pin xl/styles.xml and docProps facts inside isolated per-test xlsx builds ([e70fe82](https://github.com/ExaDev/documents.js/commit/e70fe822986addbb1cc1f8b298e3da61a1e63b7a))

## [12.2.6](https://github.com/ExaDev/documents.js/compare/ooxml.js%4012.2.5...ooxml.js%4012.2.6) (2026-09-23)

### Code Refactoring

* **ooxml.js:** compute top10's rank directly from Number(rankRaw) ([443b78c](https://github.com/ExaDev/documents.js/commit/443b78c7aad301abdb369870df1c8f1e17e015be))
* **ooxml.js:** drop three dead mutation opportunities in conditional-format.ts ([52f7004](https://github.com/ExaDev/documents.js/commit/52f7004bd24e36c022aea270cf581314ad91d5ce))
* **ooxml.js:** drop two fallback string literals pptx/read.ts never observably needed ([905da31](https://github.com/ExaDev/documents.js/commit/905da31f1f7e705ae3547124faf559130162ae8f))
* **ooxml.js:** fold xlsx/comments.ts's guid case through an ASCII offset ([cdcbb1a](https://github.com/ExaDev/documents.js/commit/cdcbb1a5dd8726203d29d135eca87054d3c38455))
* **ooxml.js:** remove redundant dedup-signature guards in xlsx/styles.ts ([8c4269f](https://github.com/ExaDev/documents.js/commit/8c4269f42fedd11f76433c3bb5bd0547db504036))
* **ooxml.js:** remove three redundant guards in pptx/read.ts ([10887ca](https://github.com/ExaDev/documents.js/commit/10887caa7452e79ce00e163e4610698ef506dd84))
* **ooxml.js:** remove xlsx/content.ts's equivalent-mutation opportunities ([9262756](https://github.com/ExaDev/documents.js/commit/92627562c1a051bdc910e73b6bfc241a32c29990))
* **ooxml.js:** remove xlsx/drawings.ts's equivalent-mutation opportunities ([2a1f19e](https://github.com/ExaDev/documents.js/commit/2a1f19e8ec78776245c877dbfb1e2e7a565b7e40))

### Documentation

* **ooxml.js:** record two failed restructurings of drawingml.ts's 180deg shift ([7d84b83](https://github.com/ExaDev/documents.js/commit/7d84b83c1f17e4f2c4218e284d9b801e5502d2e3))

### Tests

* **ooxml.js:** cover xlsx/content.ts's missing-worksheet-part fallback ([2530899](https://github.com/ExaDev/documents.js/commit/2530899c21b6351f5d7534064d40490dc0e5e818))
* **ooxml.js:** pin conditional-format.ts's absent-key and malformed-residue edge cases ([c2f5c4c](https://github.com/ExaDev/documents.js/commit/c2f5c4c8ec69f009b49ce1bc8c500e7a7ce7e0d4))
* **ooxml.js:** pin pptx/read.ts's a:pattFill colour spread and graphic-frame uri dispatch ([684a7e0](https://github.com/ExaDev/documents.js/commit/684a7e0e6fc7cd9c9e142a4cf549abaaf71e22bb))
* **ooxml.js:** pin pptx/read.ts's boundary and fallback behaviour ([7c97e81](https://github.com/ExaDev/documents.js/commit/7c97e81744b03f1a07a142377c50607eebf73374))
* **ooxml.js:** pin xlsx/styles.ts's italic/underline font declarations ([0af3075](https://github.com/ExaDev/documents.js/commit/0af30750d908d6406c0ec0db5760ab11436cab9d))
* **ooxml.js:** pin xlsx/styles.ts's numberFormatCode absence for an unresolvable numFmtId ([e18aa7b](https://github.com/ExaDev/documents.js/commit/e18aa7bc34d38319ed216fc827bf96f30ee02118))

## [12.2.5](https://github.com/ExaDev/documents.js/compare/ooxml.js%4012.2.4...ooxml.js%4012.2.5) (2026-09-23)


### Dependencies

- Updated byte-codec to 1.10.1

## [12.2.4](https://github.com/ExaDev/documents.js/compare/ooxml.js%4012.2.3...ooxml.js%4012.2.4) (2026-09-23)

### Bug Fixes

* **ooxml.js:** stop a nested formatChange from inheriting its outer change's wrapper ([4c29db8](https://github.com/ExaDev/documents.js/commit/4c29db8ec7cfdba23e2774a3a317a6869c61048f))

### Code Refactoring

* **ooxml.js:** remove two unobservable branches in docx/write.ts interleaving ([9ed828a](https://github.com/ExaDev/documents.js/commit/9ed828afebb05130957794b8ebed3580738a1c3c))
* **ooxml.js:** remove unreachable branches in xlsx/build.ts cell formatting ([6d38e4e](https://github.com/ExaDev/documents.js/commit/6d38e4e82709b722c8e5fbef7fe9425d81179d2c))
* **ooxml.js:** share the leading/trailing content-position test with read.ts ([a327cb6](https://github.com/ExaDev/documents.js/commit/a327cb6e90d63f09fcf71424e628845271f4695c))

## [12.2.3](https://github.com/ExaDev/documents.js/compare/ooxml.js%4012.2.2...ooxml.js%4012.2.3) (2026-09-23)


### Dependencies

- Updated excel-number-format to 1.2.7

## [12.2.2](https://github.com/ExaDev/documents.js/compare/ooxml.js%4012.2.1...ooxml.js%4012.2.2) (2026-09-23)


### Dependencies

- Updated byte-codec to 1.10.0

## [12.2.1](https://github.com/ExaDev/documents.js/compare/ooxml.js%4012.2.0...ooxml.js%4012.2.1) (2026-09-23)


### Dependencies

- Updated byte-codec to 1.9.0

## [12.2.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%4012.1.0...ooxml.js%4012.2.0) (2026-09-23)

### Features

* **ooxml.js:** export buildNumberingElement ([a2bdbb5](https://github.com/ExaDev/documents.js/commit/a2bdbb53db3f70a824765978081a25cb2b5739b7))

## [12.1.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%4012.0.2...ooxml.js%4012.1.0) (2026-09-23)

### Features

* **ooxml.js:** report a dropped docx header column via onDiagnostic ([444d085](https://github.com/ExaDev/documents.js/commit/444d08514f91167b14041260a0cfeadfef1724b9))

### Bug Fixes

* **ooxml.js:** read a pptx table cell border's double stroke style via [@cmpd](https://github.com/cmpd) ([e6a621c](https://github.com/ExaDev/documents.js/commit/e6a621c5e1c3580a700607ddf236123168fdd5ce))

## [12.0.2](https://github.com/ExaDev/documents.js/compare/ooxml.js%4012.0.1...ooxml.js%4012.0.2) (2026-09-22)

### Code Refactoring

* **ooxml.js:** migrate docx and pptx tables to ContentTable.columns ([b14fb74](https://github.com/ExaDev/documents.js/commit/b14fb743f0c66538be24eb28f31c9426da1d12c0))


### Dependencies

- Updated document-schema.js to 7.15.0
- Updated archive-codec to 1.11.12

## [12.0.1](https://github.com/ExaDev/documents.js/compare/ooxml.js%4012.0.0...ooxml.js%4012.0.1) (2026-09-22)

### Bug Fixes

* **workspace:** replace the spaced double-hyphen dash substitute with a real em-dash workspace-wide ([c42a9c7](https://github.com/ExaDev/documents.js/commit/c42a9c7e0bc7cd87456ca72204a5ac423a7ca341))


### Dependencies

- Updated byte-codec to 1.8.1
- Updated document-schema.js to 7.14.1
- Updated excel-number-format to 1.2.6
- Updated archive-codec to 1.11.11

## [12.0.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%4011.1.0...ooxml.js%4012.0.0) (2026-09-21)

### ⚠ BREAKING CHANGES

* **ooxml.js:** a docx row carrying isHeader now writes a w:trPr
  holding w:tblHeader, where a row carrying no heightPt previously wrote
  no w:trPr at all. A table whose rows state no header flag writes byte
  identically to before.

### Features

* **ooxml.js:** read and write a docx row's w:tblHeader ([b81c56b](https://github.com/ExaDev/documents.js/commit/b81c56beb0d557fb74a14ec94ec8d0036f686c79)), references [#1377](https://github.com/ExaDev/documents.js/issues/1377)

### Tests

* **ooxml.js:** type a table fixture row's own header flag ([9ca72f5](https://github.com/ExaDev/documents.js/commit/9ca72f55b95d81c00b3c38c78082ef3020e17f5a)), references [#1377](https://github.com/ExaDev/documents.js/issues/1377)


### Dependencies

- Updated byte-codec to 1.8.0
- Updated document-schema.js to 7.14.0
- Updated archive-codec to 1.11.10

## [11.1.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%4011.0.0...ooxml.js%4011.1.0) (2026-09-21)

### Features

* **ooxml.js:** read a pptx table cell's vertical alignment from a:tcPr/[@anchor](https://github.com/anchor) ([368667d](https://github.com/ExaDev/documents.js/commit/368667dc8cba8a308a88369cbfc1ba1d49664378))

## [11.0.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%4010.0.2...ooxml.js%4011.0.0) (2026-09-21)

### ⚠ BREAKING CHANGES

* **ooxml.js:** a ContentTable violating the grid rule stated on ContentTableCell
  is now refused rather than written with the offending content silently dropped. A
  caller building a table by hand must give every row one cell per grid column, keep
  a merged region's content on its anchor, and state each span once, on the anchor.

### Bug Fixes

* **ooxml.js:** refuse a table that breaks the grid rule rather than writing past it ([186198d](https://github.com/ExaDev/documents.js/commit/186198d9c8e8ad689f49d4111ca681eaf310b4ad))


### Dependencies

- Updated document-schema.js to 7.13.0
- Updated archive-codec to 1.11.9

## [10.0.2](https://github.com/ExaDev/documents.js/compare/ooxml.js%4010.0.1...ooxml.js%4010.0.2) (2026-09-21)

### Bug Fixes

* **ooxml.js:** keep a merged-away pptx cell's own fill and borders ([41be60b](https://github.com/ExaDev/documents.js/commit/41be60bfecb2f2f79fcf9055857e2450533f72f3))

## [10.0.1](https://github.com/ExaDev/documents.js/compare/ooxml.js%4010.0.0...ooxml.js%4010.0.1) (2026-09-21)


### Dependencies

- Updated byte-codec to 1.7.0

## [10.0.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%409.1.2...ooxml.js%4010.0.0) (2026-09-21)

### ⚠ BREAKING CHANGES

* **ooxml.js:** a docx table read by readDocxContent now has one ContentTableCell
  per grid column in every row. A consumer that padded colSpan - 1 placeholders of its
  own, or that counted a row's cells to find the column count, must stop padding and
  read the array directly.

### Bug Fixes

* **ooxml.js:** give a docx table one cell per grid column in both directions ([8e86558](https://github.com/ExaDev/documents.js/commit/8e8655830553e1e8c006d10fced4868a4557dae9))


### Dependencies

- Updated document-schema.js to 7.12.0
- Updated archive-codec to 1.11.8

## [9.1.2](https://github.com/ExaDev/documents.js/compare/ooxml.js%409.1.1...ooxml.js%409.1.2) (2026-09-20)

### Documentation

* make a hand-typed scoped mutation run find its package's Stryker config ([ed3297b](https://github.com/ExaDev/documents.js/commit/ed3297b6aa71b2d94913519e6960537ca5ac0f61))


### Dependencies

- Updated byte-codec to 1.6.3
- Updated document-schema.js to 7.11.5
- Updated excel-number-format to 1.2.5
- Updated archive-codec to 1.11.7

## [9.1.1](https://github.com/ExaDev/documents.js/compare/ooxml.js%409.1.0...ooxml.js%409.1.1) (2026-09-20)

### Bug Fixes

* **ooxml.js:** read and patch the core properties part the package names ([1ccb412](https://github.com/ExaDev/documents.js/commit/1ccb41209705c1b1e9e2e4365bb32691b1083291)), references [#1340](https://github.com/ExaDev/documents.js/issues/1340)

### Tests

* **ooxml.js:** cover the part-resolution branches a conventional package never exercises ([4766943](https://github.com/ExaDev/documents.js/commit/4766943ac7f276e763293e7379bb03678437597f))

## [9.1.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%409.0.0...ooxml.js%409.1.0) (2026-09-20)

### Features

* **ooxml.js:** resolve a package's main part from its officeDocument relationship ([b23be37](https://github.com/ExaDev/documents.js/commit/b23be37b370375ee78b40122fa6cfc285dcd22ee))

### Bug Fixes

* **ooxml.js:** name the lossy xlsx reader's sheets from the resolved workbook part ([ad01140](https://github.com/ExaDev/documents.js/commit/ad0114052534331b7a6d36a0e23bdf52e55543ff)), references [#1314](https://github.com/ExaDev/documents.js/issues/1314)
* **ooxml.js:** read the docx body from the part the package names, not word/document.xml ([a26c217](https://github.com/ExaDev/documents.js/commit/a26c217d9b9137a9feaf5a8a5c60307b861a1e1d)), references [#1314](https://github.com/ExaDev/documents.js/issues/1314)
* **ooxml.js:** read the xlsx and pptx main part from the part the package names ([2a281a4](https://github.com/ExaDev/documents.js/commit/2a281a4649fbe630b1d2f038c4b1f690e0e74212)), references [#1314](https://github.com/ExaDev/documents.js/issues/1314)

## [9.0.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.14.11...ooxml.js%409.0.0) (2026-09-20)

### ⚠ BREAKING CHANGES

* **ooxml.js:** The ooxml.js/util/base64 deep import is removed.
  bytesToBase64 and base64ToBytes come from byte-codec now, and are
  still on this package's own barrel as well. The removal already
  shipped, unmarked, in 8.14.11.

### Documentation

* **ooxml.js:** state that base64 moved out of src/util ([ea6fbb9](https://github.com/ExaDev/documents.js/commit/ea6fbb9c183928d93cd787963b8035c47f285e72))


### Dependencies

- Updated byte-codec to 1.6.2

## [8.14.11](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.14.10...ooxml.js%408.14.11) (2026-09-20)

### Code Refactoring

* **ooxml.js:** encode and decode base64 through byte-codec ([d3343a7](https://github.com/ExaDev/documents.js/commit/d3343a7df4789980f223881f3ef85fc9ddd718fd))


### Dependencies

- Updated byte-codec to 1.6.1
- Updated archive-codec to 1.11.6

## [8.14.10](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.14.9...ooxml.js%408.14.10) (2026-09-20)


### Dependencies

- Updated document-schema.js to 7.11.4
- Updated archive-codec to 1.11.5

## [8.14.9](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.14.8...ooxml.js%408.14.9) (2026-09-20)

### Bug Fixes

* **ooxml.js:** correct a stale comment about the removed magic-byte gate ([6c56f89](https://github.com/ExaDev/documents.js/commit/6c56f89d7c5563da58d690a4eef0b131e0d54409))
* **ooxml.js:** match the docx write tests' fixtures to the content schema ([c5123da](https://github.com/ExaDev/documents.js/commit/c5123dab074bc5bcc37c03a6693ca9efa0d52c27))
* **ooxml.js:** pin isBlockScopedHalf's own leading/trailing boundary tests ([d3fde0d](https://github.com/ExaDev/documents.js/commit/d3fde0d18a1954b6babd05a783954c86c3c8995d))
* **ooxml.js:** populate the required displayText field on every test cell ([653c332](https://github.com/ExaDev/documents.js/commit/653c3324dc8c86b03cf5ad95c451a16c158c9f64))

### Code Refactoring

* **ooxml.js:** drop applyGroupTransform's redundant identity shortcut ([638f699](https://github.com/ExaDev/documents.js/commit/638f699ad958f22f7ee8b008fe7fba93aa7d9fcc))
* **ooxml.js:** drop comments' redundant presence guards before assignment ([7bf4d73](https://github.com/ExaDev/documents.js/commit/7bf4d738d970062f36f4d376a7815c4af6c866e4))
* **ooxml.js:** drop constructs.ts's three redundant guards ([7897f19](https://github.com/ExaDev/documents.js/commit/7897f1998ffcbd5b0ad4ddc7ce1d2f4d10b7be3e))
* **ooxml.js:** drop defined-names' redundant guards and regex reparse ([7bdec14](https://github.com/ExaDev/documents.js/commit/7bdec146abe608a79b0c8965f101197d578d0aee))
* **ooxml.js:** drop docx read.ts's provably-redundant guards ([463bb39](https://github.com/ExaDev/documents.js/commit/463bb39a4f0a75893d36a12a4917211fd8e1c74c))
* **ooxml.js:** drop docx write.ts's links-empty early return ([b98419c](https://github.com/ExaDev/documents.js/commit/b98419c6cbb3fe1e90dd1b1d7d36f329aad8cb03))
* **ooxml.js:** drop docx write.ts's stale index-space link-overlap guard ([b21ebc9](https://github.com/ExaDev/documents.js/commit/b21ebc9da6aa1a21ecc1be702a4fda1b48f60250))
* **ooxml.js:** drop drawings.ts's redundant column/row validity checks ([90a2d9b](https://github.com/ExaDev/documents.js/commit/90a2d9b88a27c77fc0755a6e8dbd31daa8b917e2))
* **ooxml.js:** drop drawings.ts's remaining redundant NaN-fallback ternaries ([fccd2ef](https://github.com/ExaDev/documents.js/commit/fccd2efe8cb6b70278c8522e79249930e04e56b3))
* **ooxml.js:** drop isoDateTimeToSerial's redundant no-separator guard ([83cb30b](https://github.com/ExaDev/documents.js/commit/83cb30b440b5ca77abd4a8bb36daa6cbd6c0431c))
* **ooxml.js:** drop localName's unreachable no-colon branch ([10e7283](https://github.com/ExaDev/documents.js/commit/10e72836f622da20e64e1a6f0f265dffe9d6f864))
* **ooxml.js:** drop looksLikeSvg's redundant Math.min against bytes.length ([fa2d0b9](https://github.com/ExaDev/documents.js/commit/fa2d0b911e23fbaa72a920b1cefbde88f51b8468))
* **ooxml.js:** drop oleObjectBin's three redundant zero-valued header writes ([36d345a](https://github.com/ExaDev/documents.js/commit/36d345a9f3869e2ec80b326a2f149d403534aa17))
* **ooxml.js:** drop parseSqref's redundant empty-token skip ([a1fbeec](https://github.com/ExaDev/documents.js/commit/a1fbeec15f7c0d47524aff7efe77f5e4f55b8c21))
* **ooxml.js:** drop print-settings' redundant scale-presence guard ([856e1f7](https://github.com/ExaDev/documents.js/commit/856e1f745bf85a7cd09e48f8a8e4f18239948637))
* **ooxml.js:** drop reading-order's provably redundant cut guards ([0b76772](https://github.com/ExaDev/documents.js/commit/0b7677293136395bba9fe314d9f38fec0a0cd286))
* **ooxml.js:** drop readToggle's redundant absent-value guard ([a23b6ca](https://github.com/ExaDev/documents.js/commit/a23b6caa3a1000a5012f5780dc868831b9e8d814))
* **ooxml.js:** drop xlsx build's dead print-titles presence guard ([c0eb0da](https://github.com/ExaDev/documents.js/commit/c0eb0dafdeb2827c93d98c8ebd6e53bed3bdb4c0))
* **ooxml.js:** drop xlsx build's dead worksheet-extras fallbacks ([5499581](https://github.com/ExaDev/documents.js/commit/54995814e6042314196fec8653af8926db681695))
* **ooxml.js:** hoist buildXml's ignored pi/declaration child array ([711774c](https://github.com/ExaDev/documents.js/commit/711774c412e2fb006b9ef49cf7db162540beff3a))
* **ooxml.js:** read docx marker halves' [@w](https://github.com/w):name unconditionally ([3f41089](https://github.com/ExaDev/documents.js/commit/3f410898bf2487048f043cd733a6882ae43e2738))
* **ooxml.js:** remove docx read.ts's behaviourally-dead guard expressions ([eb491e8](https://github.com/ExaDev/documents.js/commit/eb491e8f74a49dcb10facd193faebf560ca1e759))
* **ooxml.js:** rewrite oleObjectBin's fixed-array copy loops as forEach ([b28d576](https://github.com/ExaDev/documents.js/commit/b28d576afb8676e6f236f6494905fce3a80f0b34))
* **ooxml.js:** spell the trailing-run hyperlink exclusion once in docx write.ts ([0691188](https://github.com/ExaDev/documents.js/commit/069118847c19ff204b2a430b889f2ae8c86c06b5))

### Documentation

* **ooxml.js:** document canonicalizeGroupRotation's irreducible +180 mutant ([585c721](https://github.com/ExaDev/documents.js/commit/585c721ee3b7274a49f2fd6cc6c777e5e6bfb676))
* **ooxml.js:** raise the mutation break threshold to the ([c4a12c5](https://github.com/ExaDev/documents.js/commit/c4a12c53af2fb116e0158275b65be3703e4f8338))
* **ooxml.js:** record build.ts's re-measured mutation score and a Stryker reporting anomaly ([b5ee80a](https://github.com/ExaDev/documents.js/commit/b5ee80ae87ac9e5b60c4c5b5075fff7c93882a4d))
* **ooxml.js:** record docx read.ts's protocol-verified 99.40% mutation floor ([044c24c](https://github.com/ExaDev/documents.js/commit/044c24c8467bb6acc4f64f8891e5ae746a9ac3f4))
* **ooxml.js:** record docx read.ts's re-measured mutation score ([eb44b43](https://github.com/ExaDev/documents.js/commit/eb44b439cbb63c2cefdabc5243c1098da732512a))
* **ooxml.js:** record docx write.ts's protocol-verified 99.45% mutation floor ([bc90bc5](https://github.com/ExaDev/documents.js/commit/bc90bc57832d3264b686601b726b4933a91c9db1))
* **ooxml.js:** record docx write.ts's re-measured 83.95% mutation score ([88547e2](https://github.com/ExaDev/documents.js/commit/88547e2849f91f4c8ec68bb770c139ce507e9d7b))
* **ooxml.js:** record docx write.ts's re-measured mutation score ([dbf424a](https://github.com/ExaDev/documents.js/commit/dbf424a2e1dd4b6cd615a628d2ad1cd219906dc2))
* **ooxml.js:** record xlsx build.ts's triaged 87.66% floor and its verified equivalents ([9956348](https://github.com/ExaDev/documents.js/commit/99563482b4230480954ffada0a665fd1fb62c4af))

### Tests

* **ooxml.js:** add byte-level coverage for oleObjectBin's remaining structure ([54bdca6](https://github.com/ExaDev/documents.js/commit/54bdca6bb913ba744dba1a6de493da25f0328735))
* **ooxml.js:** add conditional-format.ts's own direct unit suite ([e78dbe8](https://github.com/ExaDev/documents.js/commit/e78dbe8d3e5981a73a463d38894e86b3fe7a0ca4))
* **ooxml.js:** add direct coverage for the tree-walk/attr/rels helpers ([8c170d0](https://github.com/ExaDev/documents.js/commit/8c170d097dd26ee79c6305020afd1a71281c04ff))
* **ooxml.js:** add direct structural coverage for buildDrawing and fixed package-scaffolding XML ([59b0193](https://github.com/ExaDev/documents.js/commit/59b019380882c83fb59ea4a6588871679616326a))
* **ooxml.js:** add direct structural coverage for chart cache reading ([66ed3be](https://github.com/ExaDev/documents.js/commit/66ed3be04f9aa99ec0949e6ccb8f3d9f5959b524))
* **ooxml.js:** add direct structural coverage for diagram text walking ([dfe000e](https://github.com/ExaDev/documents.js/commit/dfe000e2a234c3d19e7311a5a922c1a7160306e0))
* **ooxml.js:** add direct structural coverage for oleObjectBin ([de58bb1](https://github.com/ExaDev/documents.js/commit/de58bb1abdeda7f4ed1dc70202b7a8b1d5f4e5c6))
* **ooxml.js:** add direct structural coverage for the embedded-fixture builders ([f3f8208](https://github.com/ExaDev/documents.js/commit/f3f8208184af7135268411b428081fb481c00a7b))
* **ooxml.js:** add direct structural coverage for xlsx table/name definitions writing ([cccfd09](https://github.com/ExaDev/documents.js/commit/cccfd0981ef42edc165f2c388298ddf66920ece9))
* **ooxml.js:** add drawings-write.ts's own direct unit suite ([8a4fa8b](https://github.com/ExaDev/documents.js/commit/8a4fa8bd6601cebfc8eceb72af81873bca2a43ac))
* **ooxml.js:** assert docx write.ts's optional part emission and link wrap precedence exactly ([7c18b62](https://github.com/ExaDev/documents.js/commit/7c18b62b3e5568cffadc5e6172de60744062ac62))
* **ooxml.js:** assert docx write.ts's run content, styles, notes, and control XML exactly ([258b1ef](https://github.com/ExaDev/documents.js/commit/258b1ef634204a304dd2b504b86fb8be8b7b9a1a))
* **ooxml.js:** assert italic is also undefined for an rPr with no attrs ([3a4e370](https://github.com/ExaDev/documents.js/commit/3a4e37071acf136512647386dca0301c60fa72f6))
* **ooxml.js:** assert the derived Print_Area definedName's own text content ([d912266](https://github.com/ExaDev/documents.js/commit/d91226602b48d9bc4f7857eccb46c4dfe2b27a04))
* **ooxml.js:** assert xlsx build's carried-name and derived print-name reconciliation ([bba6820](https://github.com/ExaDev/documents.js/commit/bba6820ad6234a7f2c7fba548bf381e7b97e3303))
* **ooxml.js:** assert xlsx build's part roots, scope-keyed suppression, and row/cell edges ([15a4a60](https://github.com/ExaDev/documents.js/commit/15a4a60cc5b851e1c8466e35559af93a508bdcbc))
* **ooxml.js:** assert xlsx build's workbook, dimension, merges, and scaffolding XML exactly ([7e10855](https://github.com/ExaDev/documents.js/commit/7e1085551bd61c88370498b0077121f5747e1af0))
* **ooxml.js:** close color.ts's HSL boundary and gamma-threshold gaps ([c65d4b6](https://github.com/ExaDev/documents.js/commit/c65d4b6854763c016a6ef333a24c3e7be356972b))
* **ooxml.js:** close comments.ts's relationship-type, local-name, and thread-ordering gaps ([0f98b33](https://github.com/ExaDev/documents.js/commit/0f98b33183824a800435d13331c8f68bcadb686c))
* **ooxml.js:** close conditional-format's operator, boundary, and residue gaps ([97e9ea6](https://github.com/ExaDev/documents.js/commit/97e9ea6714d9598fe29cf8ebfd88529d6fbb36ec))
* **ooxml.js:** close constructs.ts's paragraph-index, checkbox, and pairing gaps ([3876a54](https://github.com/ExaDev/documents.js/commit/3876a547a359ca3b57ab08984aa341389f518756))
* **ooxml.js:** close content.ts's row/column, span, and residue mutation gaps ([1a3f8cb](https://github.com/ExaDev/documents.js/commit/1a3f8cbd9b2a60b179c88233748749867a905d69))
* **ooxml.js:** close drawingml's per-field, theme-fallback, and transform gaps ([fe75595](https://github.com/ExaDev/documents.js/commit/fe755953a7a72ccbbfed851197e023197f2bfd34))
* **ooxml.js:** close drawings-write's remaining chart-counter and sparse-cell gaps ([1454e73](https://github.com/ExaDev/documents.js/commit/1454e73b9b589423861fe0ed0453e83b30f39a48))
* **ooxml.js:** close drawings.ts's remaining chart-frame and marker gaps ([eb71c30](https://github.com/ExaDev/documents.js/commit/eb71c304c3415311bd2153a684631326b3202985))
* **ooxml.js:** close metadata's blank-value, keyword-parsing, and per-field gaps ([5a87623](https://github.com/ExaDev/documents.js/commit/5a8762397847608a68303926dfa83839af7f93c6))
* **ooxml.js:** close reading-order's touching-boundary and gap-arithmetic gaps ([318fd6f](https://github.com/ExaDev/documents.js/commit/318fd6fca02148f6a76f8cc1849a36c2bcf6312e))
* **ooxml.js:** close style-cascade gaps in type discrimination and merge ([e3e09dd](https://github.com/ExaDev/documents.js/commit/e3e09dd9df9082bf0144c441adfdbdf39e09f7f6))
* **ooxml.js:** close styles.ts's decoration key-presence and ([9e75b79](https://github.com/ExaDev/documents.js/commit/9e75b79a11169a854b31e03010d983f6c60ada9c))
* **ooxml.js:** close xlsx.ts's rels-correlation and sheet-ordering gaps ([2dbfa3a](https://github.com/ExaDev/documents.js/commit/2dbfa3a369a10eb39a572787e0c8e17bd2859b04))
* **ooxml.js:** cover base64 encode/decode boundaries and simplify decode buffer sizing ([54a4afa](https://github.com/ExaDev/documents.js/commit/54a4afa61ce42fe9482cfadc32a1af821df0615b))
* **ooxml.js:** cover borderToXlsxStyle's double/dotted tokens ([1d63f83](https://github.com/ExaDev/documents.js/commit/1d63f8399f9afc3fbc0e7c4d8f0b5db47987d3e1))
* **ooxml.js:** cover build.ts's dimension, cols, row/cell assembly, and merge output exactly ([a094f2b](https://github.com/ExaDev/documents.js/commit/a094f2b812da82931eb74768c4bdbfba09219aa6))
* **ooxml.js:** cover build.ts's exact package-scaffolding output ([e625861](https://github.com/ExaDev/documents.js/commit/e625861de3bd09f3d701615e49b4d3809dcecd94))
* **ooxml.js:** cover build.ts's page margins, page setup, and manual breaks exactly ([2cc336d](https://github.com/ExaDev/documents.js/commit/2cc336db1cf69ea0f8c1b64d9bd54f7330d69b15))
* **ooxml.js:** cover build.ts's per-sheet table filtering and relationship numbering exactly ([6ccef7b](https://github.com/ExaDev/documents.js/commit/6ccef7b33e6926ff963d1e33b82b1434c1bc93ab))
* **ooxml.js:** cover build.ts's styles-part and docProps output exactly ([2ddcce2](https://github.com/ExaDev/documents.js/commit/2ddcce2f6d014de00d64f3602ab28bf34c0a2aaa))
* **ooxml.js:** cover buildCellShading's unrecognised-kind default branch ([c5fa5d3](https://github.com/ExaDev/documents.js/commit/c5fa5d3e487a73632046171fd675c76545728df3))
* **ooxml.js:** cover buildXml's node kinds and drop unobservable builder scaffolding ([5ebd0da](https://github.com/ExaDev/documents.js/commit/5ebd0da79579e0615b9d4d36fc1cdd1bddb9bde2))
* **ooxml.js:** cover captureResidualAttributes/residualAttributesFor directly ([4f5c2fd](https://github.com/ExaDev/documents.js/commit/4f5c2fda4a96b4440d214453739493c5b9a11e18))
* **ooxml.js:** cover consecutive images with no candidate paragraph at all ([2a9c3db](https://github.com/ExaDev/documents.js/commit/2a9c3db86daf7bda280f347b3ff40cc3138defad))
* **ooxml.js:** cover data-validation's read/build attribute branches ([49130c0](https://github.com/ExaDev/documents.js/commit/49130c01d2df380a1022532d18d36a9363c4cea9))
* **ooxml.js:** cover defined-names' print-area/titles parse and build pair ([c16b2b6](https://github.com/ExaDev/documents.js/commit/c16b2b64695c134af23885261570a7c15b6d5b3f))
* **ooxml.js:** cover docx read.ts's construct tie-breaks, header joins, and anchor offsets ([549b0a3](https://github.com/ExaDev/documents.js/commit/549b0a3624cf63acccc064190fee13f88a3b50c8))
* **ooxml.js:** cover docx read.ts's page geometry, toggles, and field/border fallbacks ([ed47736](https://github.com/ExaDev/documents.js/commit/ed47736df87cd579157c8e0dae4058452742d873))
* **ooxml.js:** cover docx read.ts's run-walk guards, tracked-change carry, and crossing extents ([a33ebcc](https://github.com/ExaDev/documents.js/commit/a33ebccec3f5d5d43b7b158773e1f8a6e21006c0))
* **ooxml.js:** cover docx read.ts's split-run reindexing and border-absent edge cases ([c826ad8](https://github.com/ExaDev/documents.js/commit/c826ad853efdd59f4066bd5e90f1bb10791652fe))
* **ooxml.js:** cover docx write.ts's boundary shapes, media, and exact part XML ([c10c57a](https://github.com/ExaDev/documents.js/commit/c10c57a623c84e749912671bc3e37ca70d8c00e7))
* **ooxml.js:** cover docx write.ts's cross-part sharing, minting order, and property edges ([dc97949](https://github.com/ExaDev/documents.js/commit/dc979498c21af60ca75d583f6b5f94c3d5bb0c06))
* **ooxml.js:** cover docx write.ts's table, link, and scaffolding XML exactly ([bff8948](https://github.com/ExaDev/documents.js/commit/bff894833450961b47a500266e8167bc8c509ece))
* **ooxml.js:** cover embedded-object root-entry precedence, Package lookup ([37f9a86](https://github.com/ExaDev/documents.js/commit/37f9a863bc070fe1ecf1d41d487c9ba1bfc9366f))
* **ooxml.js:** cover every sniffed image signature and drop a redundant bounds check ([f7c8ff9](https://github.com/ExaDev/documents.js/commit/f7c8ff9c3c9cb251d1c0d1253ff176baf5a5d719))
* **ooxml.js:** cover every ST_DataValidationOperator vocabulary member ([42389cf](https://github.com/ExaDev/documents.js/commit/42389cfe8c73dbe84748b98ffb7ec0834b131ed6))
* **ooxml.js:** cover figure-captions' image gate, join separator ([4e97b14](https://github.com/ExaDev/documents.js/commit/4e97b14e928923b81e62a4515f92a8110b4b346f))
* **ooxml.js:** cover flavour detection's own precondition directly ([f7a16b0](https://github.com/ExaDev/documents.js/commit/f7a16b09c1948c55d1b8f17c415e5dd0360acdc8))
* **ooxml.js:** cover inherit's rel-type filter, placeholder fallback, style clamp ([2fad461](https://github.com/ExaDev/documents.js/commit/2fad461157ddad1834797d03557ee9fe90ee61bd))
* **ooxml.js:** cover isCompactXmlNode's full type-code truth table directly ([756c55d](https://github.com/ExaDev/documents.js/commit/756c55da19b7fcd5f8c47ba4432246429622c01c))
* **ooxml.js:** cover isXmlNode's full truth table across every node variant ([49c81ba](https://github.com/ExaDev/documents.js/commit/49c81ba16a1a00e0154f3a186ab5e035d643452d))
* **ooxml.js:** cover loadSharedStrings and SharedStringTable directly ([72ccc6e](https://github.com/ExaDev/documents.js/commit/72ccc6e34b82bccbb15579bd58cec86fbeca95d6))
* **ooxml.js:** cover looksLikeXml's BOM/whitespace skip and drop a redundant bounds check ([5f7b8de](https://github.com/ExaDev/documents.js/commit/5f7b8de75451329ea40a6df07a54f7761dab33b1))
* **ooxml.js:** cover numbering's non-canonical ilvl/numId sort, undefined level ([d4df30b](https://github.com/ExaDev/documents.js/commit/d4df30b3b0b644780c2b30d8332225cc643aa48d))
* **ooxml.js:** cover numbering's overridden-level guard, namespace, and numeric level ordering ([856f069](https://github.com/ExaDev/documents.js/commit/856f069983e8641766d20c27808a3e4162a871ce))
* **ooxml.js:** cover page-size tolerance's exact boundary and remove a dead type-narrowing check ([a481fb7](https://github.com/ExaDev/documents.js/commit/a481fb7c4a93201ae513cafaf821c880447e6f4d))
* **ooxml.js:** cover parseXml's internal validation helpers directly ([93be8e4](https://github.com/ExaDev/documents.js/commit/93be8e4e9bc8d164c29c0198d27c92debd498ae4))
* **ooxml.js:** cover pptx read's slide-size fallback, alignment, and underline/strike tokens ([86661e6](https://github.com/ExaDev/documents.js/commit/86661e6ffee94c7d5d77fd8661362ee66e39a405))
* **ooxml.js:** cover print-settings' margins, breaks, and fit/scale gate ([e662507](https://github.com/ExaDev/documents.js/commit/e662507a6db199ee543c071bc498adf66cbb910c))
* **ooxml.js:** cover reading-order's axis-tie, recursion, and extent math ([cc7290d](https://github.com/ExaDev/documents.js/commit/cc7290d7ce160bfcb4925ce8a34f3309a3c56019))
* **ooxml.js:** cover readWorkbookDefinitions' relationship filtering directly ([4ce12dd](https://github.com/ExaDev/documents.js/commit/4ce12dd297547f1b18442f507b8539f1221686d3))
* **ooxml.js:** cover relsPathFor/resolveRelTarget's path arithmetic ([ff29439](https://github.com/ExaDev/documents.js/commit/ff294396bbd20b37ce4fca1ac6ddc7830056f618))
* **ooxml.js:** cover serial.ts's date/time boundaries and remove two redundant date checks ([39d2ac8](https://github.com/ExaDev/documents.js/commit/39d2ac8589ed3be9f5e305aea8810d85bcff000b))
* **ooxml.js:** cover shading's "none" colour tokens and single-colour patterns' own absent key ([8573ed8](https://github.com/ExaDev/documents.js/commit/8573ed8cdf2bf75927f43ec67aa70e64f33a7fae))
* **ooxml.js:** cover SheetGridGeometry's column/row lookups and editAs sizing ([d06d9d8](https://github.com/ExaDev/documents.js/commit/d06d9d83ff671607c659bab12f3d13c0266f269a))
* **ooxml.js:** cover sqref parsing/formatting and simplify its whitespace split ([9e490a4](https://github.com/ExaDev/documents.js/commit/9e490a4a955c81269f8185c5f1c5234784e23d76))
* **ooxml.js:** cover textContent's cdata concatenation, simplify relsPathFor ([eb8ed65](https://github.com/ExaDev/documents.js/commit/eb8ed65813e096e09f277b6268db2ed5745bb983))
* **ooxml.js:** cover threaded-comment id formatting, counter increment, and reply linkage ([51e3526](https://github.com/ExaDev/documents.js/commit/51e3526db4b1b01a183f74f47c027c3f0c8a7bf5))
* **ooxml.js:** cover xlsx build's bottom-aligned default and exact minimal override set ([50d631a](https://github.com/ExaDev/documents.js/commit/50d631a9de65b401972228388672b516cd964cbf))
* **ooxml.js:** distinguish a multi-level cache's last level from its second ([35f0bc5](https://github.com/ExaDev/documents.js/commit/35f0bc5445701a30885c9709740d2aecb19ae381))
* **ooxml.js:** distinguish extentAlong's true earliest start from its latest ([346bdf7](https://github.com/ExaDev/documents.js/commit/346bdf79f8b03c42a92ac222aceba7f052b4ede7))
* **ooxml.js:** fix build.test.ts's own type errors under Node typecheck ([3bbeae7](https://github.com/ExaDev/documents.js/commit/3bbeae7bf3587fbb2e5067113d18d838869c5cc2))
* **ooxml.js:** fix drawings-write test coverage attribution ([822c724](https://github.com/ExaDev/documents.js/commit/822c724fef34ade18ca08cf6b65d7018d93e2f95))
* **ooxml.js:** fix two border-signature tests that could not ([723c295](https://github.com/ExaDev/documents.js/commit/723c295ca5ec92da1c52fa28ad9f7dc9e4ff93ad))
* **ooxml.js:** pick a non-coincidental (l, s) pair for the 1/6 hue boundary ([0d16aa6](https://github.com/ExaDev/documents.js/commit/0d16aa68287a7dae327ed0189a2db395b36bd1d8))
* **ooxml.js:** pin docx write.ts's lifted-image run alignment and note body XML ([35b3682](https://github.com/ExaDev/documents.js/commit/35b3682d91f7016a9e67a3cee9645292be8c29ee))
* **ooxml.js:** prove a reply's own counter increment never runs backwards ([dded213](https://github.com/ExaDev/documents.js/commit/dded21323d462bf49ae878dba5fc678f58c4c8d6))
* **ooxml.js:** prove a startOverride with no w:val leaves startAt alone ([6e7192b](https://github.com/ExaDev/documents.js/commit/6e7192b08af0ca28eb332228991027550242b22b))
* **ooxml.js:** prove a table relationship is filtered by its own type ([9f979fe](https://github.com/ExaDev/documents.js/commit/9f979febea73f11421cb6476cdd367b84dcfe2db))
* **ooxml.js:** prove an unrecognised asciiTheme resolves to no font ([4a853be](https://github.com/ExaDev/documents.js/commit/4a853be54823974b1ada9ec30f8e046eb4188201))
* **ooxml.js:** prove an unrecognised paragraph child contributes no run ([34fe2eb](https://github.com/ExaDev/documents.js/commit/34fe2eb1f984936bfabc6d77d4a7dce68536681b))
* **ooxml.js:** prove isXmlNode's element branch gates on type, not shape ([a0ff242](https://github.com/ExaDev/documents.js/commit/a0ff242f799b63b16ca3606df311d2c1a176bd63))
* **ooxml.js:** prove readXlsx omits the definitions key when there are no tables ([3eccca7](https://github.com/ExaDev/documents.js/commit/3eccca77673a44f28d0e05eb0cc6ae2c18bbf9b4))
* **ooxml.js:** prove residualAttributesFor rejects a matching-first-tag multi-element residue ([b2c229f](https://github.com/ExaDev/documents.js/commit/b2c229fea3b19a778f293ae9c470ea59a91aed59))
* **ooxml.js:** reach content.ts's genuine mutation ceiling ([f405af0](https://github.com/ExaDev/documents.js/commit/f405af0e963076f66932873c48af237952b411b3))
* **ooxml.js:** reach styles.ts's genuine mutation ceiling ([43461d6](https://github.com/ExaDev/documents.js/commit/43461d656e92d36ee937afe8fb5c1ee174c2872e))

### Miscellaneous Chores

* **ooxml.js:** raise the mutation break threshold to 95 ([5e011e3](https://github.com/ExaDev/documents.js/commit/5e011e3932d1558cfb5b9614278ec00249793626))

## [8.14.8](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.14.7...ooxml.js%408.14.8) (2026-09-19)

### Performance Improvements

* **ooxml.js:** encode base64 in chunks of character codes ([be61ddd](https://github.com/ExaDev/documents.js/commit/be61ddd8e4b9c52e0fa8ba7016f5a5bf84caf432))

### Tests

* **ooxml.js:** check bytesToBase64 against a naive reference and Buffer ([98c7d18](https://github.com/ExaDev/documents.js/commit/98c7d18b1dabf3c2e5a335d9382f4d4b84ab6383))

## [8.14.7](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.14.6...ooxml.js%408.14.7) (2026-09-14)

### Miscellaneous Chores

* bump pinned pnpm to 12.4.1 across the workspace ([4e81c2d](https://github.com/ExaDev/documents.js/commit/4e81c2dfdb08fff226c20a0f267baffa87758e0f))
* **lint:** except each package's own measured eslint-config 2.12.1 debt ([11c35bc](https://github.com/ExaDev/documents.js/commit/11c35bc61db74c68b4be725c34452509fba00c2a))


### Dependencies

- Updated document-schema.js to 7.11.3
- Updated excel-number-format to 1.2.4
- Updated archive-codec to 1.11.4

## [8.14.6](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.14.5...ooxml.js%408.14.6) (2026-09-13)


### Dependencies

- Updated archive-codec to 1.11.3

## [8.14.5](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.14.4...ooxml.js%408.14.5) (2026-09-13)


### Dependencies

- Updated document-schema.js to 7.11.2
- Updated archive-codec to 1.11.2

## [8.14.4](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.14.3...ooxml.js%408.14.4) (2026-09-12)


### Dependencies

- Updated excel-number-format to 1.2.3

## [8.14.3](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.14.2...ooxml.js%408.14.3) (2026-09-11)


### Dependencies

- Updated excel-number-format to 1.2.2

## [8.14.2](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.14.1...ooxml.js%408.14.2) (2026-09-11)

### Bug Fixes

* **ooxml.js:** keep the pinned zip entry mtime inside fflate's valid DOS-date range ([b593da8](https://github.com/ExaDev/documents.js/commit/b593da83b1f5bdbad900ccdde909240a3f8664ac))

## [8.14.1](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.14.0...ooxml.js%408.14.1) (2026-09-11)

### Code Refactoring

* load stryker.config.ts directly instead of a jiti .mjs bootstrap ([4221520](https://github.com/ExaDev/documents.js/commit/42215205caa1c8fc6368ed38729d15836bdd613b))


### Dependencies

- Updated document-schema.js to 7.11.1
- Updated excel-number-format to 1.2.1
- Updated archive-codec to 1.11.1

## [8.14.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.13.0...ooxml.js%408.14.0) (2026-09-11)

### Features

* **ooxml.js:** carry xlsx defined names on the ContentDocument both ways ([d7d5078](https://github.com/ExaDev/documents.js/commit/d7d5078c8cae491cb670a7302d29d3f2ab571715))
* **ooxml.js:** read and write docx vertAlign, rtl, and bidi ([b5d8d86](https://github.com/ExaDev/documents.js/commit/b5d8d86e8ae10cec41db6f9f082ea9b3b6cc237b))
* **ooxml.js:** read and write the xlsx per-cell font through the font table ([9b020af](https://github.com/ExaDev/documents.js/commit/9b020affb320432c448efb62426d6cafc41f209e))
* **ooxml.js:** record where each lifted docx image sat in its run stream ([e45b1a7](https://github.com/ExaDev/documents.js/commit/e45b1a7c1f8dd7d5bccec75c5cb69b768b1833f7))
* **ooxml.js:** state chart and diagram origin on the content nodes ([6a6f8e3](https://github.com/ExaDev/documents.js/commit/6a6f8e38215a385ee096a541cefe06360e2f337b))

### Documentation

* **ooxml.js:** state the per-cell font, defined names, direction, origin, and anchor coverage ([c5bec41](https://github.com/ExaDev/documents.js/commit/c5bec41b41f87026bd1e96ede1bd84f388833189))

## [8.13.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.12.0...ooxml.js%408.13.0) (2026-09-11)

### Features

* **ci:** gate each measured package on its first CI mutation baseline ([9f8fa69](https://github.com/ExaDev/documents.js/commit/9f8fa6947795b2089bed03c936691893643ce2ae))


### Dependencies

- Updated document-schema.js to 7.11.0
- Updated excel-number-format to 1.2.0
- Updated archive-codec to 1.11.0

## [8.12.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.11.1...ooxml.js%408.12.0) (2026-09-11)

### Features

* **document-schema.js:** record what a node's content was in the source ([f4b4901](https://github.com/ExaDev/documents.js/commit/f4b490195831f1d3557da18d5c3a1bbab08fa0a4)), references [#1197](https://github.com/ExaDev/documents.js/issues/1197)
* **ooxml.js:** add an opt-in reading-order projection for pptx slides ([94859e7](https://github.com/ExaDev/documents.js/commit/94859e75afd482ab9e9f4822783d529fd53db7b9))
* **ooxml.js:** record a pptx slide's reading order as a rank per shape ([cd93541](https://github.com/ExaDev/documents.js/commit/cd93541b8467dc679097472c997f86bd020b9ece))


### Dependencies

- Updated document-schema.js to 7.10.0
- Updated archive-codec to 1.10.8

## [8.11.1](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.11.0...ooxml.js%408.11.1) (2026-09-11)


### Dependencies

- Updated document-schema.js to 7.9.1
- Updated archive-codec to 1.10.7

## [8.11.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.10.3...ooxml.js%408.11.0) (2026-09-10)

### Features

* **ooxml.js:** associate a docx Caption paragraph with the figure it describes ([fd7811e](https://github.com/ExaDev/documents.js/commit/fd7811e59fe16ce9f2104387e1fcf2920ec9d60a)), references [#1197](https://github.com/ExaDev/documents.js/issues/1197)


### Dependencies

- Updated document-schema.js to 7.9.0
- Updated archive-codec to 1.10.6

## [8.10.3](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.10.2...ooxml.js%408.10.3) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.8.0
- Updated archive-codec to 1.10.5

## [8.10.2](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.10.1...ooxml.js%408.10.2) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.7.0
- Updated archive-codec to 1.10.4

## [8.10.1](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.10.0...ooxml.js%408.10.1) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.6.1
- Updated archive-codec to 1.10.3

## [8.10.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.9.1...ooxml.js%408.10.0) (2026-09-10)

### Features

* **ooxml.js:** verify xlsx drawing anchors against a real-producer corpus ([3e024df](https://github.com/ExaDev/documents.js/commit/3e024df1204af12bc3678d4f10c631cc367dcc72))

### Miscellaneous Chores

* **ooxml.js:** drop a duplicated points-per-centimetre constant from the corpus generator ([420aca3](https://github.com/ExaDev/documents.js/commit/420aca38880e61e1f93f18193da6f6a93bdd0977))

## [8.9.1](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.9.0...ooxml.js%408.9.1) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.6.0
- Updated archive-codec to 1.10.2

## [8.9.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.8.0...ooxml.js%408.9.0) (2026-09-09)

### Features

* **ooxml.js:** write a real drawing layer for xlsx charts and pictures ([70c2ea8](https://github.com/ExaDev/documents.js/commit/70c2ea83eb9a3e889c100cc73dea6950c2eabacc))
* **ooxml.js:** write a workbook's definitions table for xlsx ([c6a4f1c](https://github.com/ExaDev/documents.js/commit/c6a4f1cc5d4226d719928500708c4787c8328a3b))

### Bug Fixes

* **ooxml.js:** accept only internal A1 ranges as xlsx defined-name refersTo ([2198c7a](https://github.com/ExaDev/documents.js/commit/2198c7a2d1557e8a1cd352e80bb9516fe2955657))
* **ooxml.js:** drop a duplicated test opener in the chart round-trip suite ([9fb8e2e](https://github.com/ExaDev/documents.js/commit/9fb8e2ef4b6d6fb3986051cf22103227d5c2fcf9))

## [8.8.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.7.0...ooxml.js%408.8.0) (2026-09-08)

### Features

* **ooxml.js:** write real word/numbering.xml abstractNum/num definitions ([e6ea610](https://github.com/ExaDev/documents.js/commit/e6ea610dcc960e91e2f7d27446d4331213c14856))
* **ooxml.js:** write styles, comments, footnotes, endnotes, and headers/footers in docx ([f9014a2](https://github.com/ExaDev/documents.js/commit/f9014a2004ed781f95508787c5f7b97066605b8d))

### Bug Fixes

* **ooxml.js:** share one docx media file per payload across all parts ([28e61e5](https://github.com/ExaDev/documents.js/commit/28e61e58e59a800c6c3ca0a3fcdaa6c88af4d2ae))

## [8.7.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.6.10...ooxml.js%408.7.0) (2026-09-08)

### Features

* **ooxml.js:** add readDiagramResidue for SmartArt drawing parts ([efa5b2b](https://github.com/ExaDev/documents.js/commit/efa5b2b07cb72ceb40933028eef083eb52a75997))
* **ooxml.js:** quarantine pptx chart and SmartArt parts as residue ([4be3cd8](https://github.com/ExaDev/documents.js/commit/4be3cd8e2826e3ce75aa596b3b1a07eb48116b6c))
* **ooxml.js:** quarantine xlsx chart parts as residue on read ([ee4786a](https://github.com/ExaDev/documents.js/commit/ee4786a9ebbd1d3cd2faef9a049f74f5d6f2b563))

### Bug Fixes

* **ooxml.js:** cache chart and diagram residue serialisation by root identity ([a4d2fba](https://github.com/ExaDev/documents.js/commit/a4d2fba97689c895f5df8c19fc4f407c2a6a021e))

### Documentation

* **ooxml.js:** document chart and SmartArt residue quarantining ([1c83bd8](https://github.com/ExaDev/documents.js/commit/1c83bd8f138988ddb086758357af4b3eb1daa479))

## [8.6.10](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.6.9...ooxml.js%408.6.10) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.5.1
- Updated archive-codec to 1.10.1

## [8.6.9](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.6.8...ooxml.js%408.6.9) (2026-09-08)


### Dependencies

- Updated archive-codec to 1.10.0

## [8.6.8](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.6.7...ooxml.js%408.6.8) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.5.0
- Updated archive-codec to 1.9.2

## [8.6.7](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.6.6...ooxml.js%408.6.7) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.4.0
- Updated archive-codec to 1.9.1

## [8.6.6](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.6.5...ooxml.js%408.6.6) (2026-09-08)


### Dependencies

- Updated archive-codec to 1.9.0

## [8.6.5](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.6.4...ooxml.js%408.6.5) (2026-09-08)


### Dependencies

- Updated archive-codec to 1.8.0

## [8.6.4](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.6.3...ooxml.js%408.6.4) (2026-09-08)


### Dependencies

- Updated archive-codec to 1.7.2

## [8.6.3](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.6.2...ooxml.js%408.6.3) (2026-09-08)

### Bug Fixes

* **deps:** pin @vitest/coverage-v8 to match its vitest runner ([6912e0e](https://github.com/ExaDev/documents.js/commit/6912e0e5c602f0c21d9df12d2dc9899422bf5bd2))

### Miscellaneous Chores

* **deps:** pin every workspace dependency to an exact fixed version ([6a38142](https://github.com/ExaDev/documents.js/commit/6a38142facc043dfa499573f37431d3b32ff602e))


### Dependencies

- Updated document-schema.js to 7.3.1
- Updated excel-number-format to 1.1.1
- Updated archive-codec to 1.7.1

## [8.6.2](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.6.1...ooxml.js%408.6.2) (2026-09-08)


### Dependencies

- Updated archive-codec to ^1.7.0

## [8.6.1](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.6.0...ooxml.js%408.6.1) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.3.0
- Updated archive-codec to ^1.6.8

## [8.6.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.5.0...ooxml.js%408.6.0) (2026-09-07)

### Features

* **ooxml.js:** read wp:anchor's own floating position into ContentImageBlock ([ef73e0d](https://github.com/ExaDev/documents.js/commit/ef73e0d7eaa8b556235dc58929d7073c09b8c0d4))


### Dependencies

- Updated document-schema.js to ^7.2.0
- Updated archive-codec to ^1.6.7

## [8.5.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.4.0...ooxml.js%408.5.0) (2026-09-07)

### Features

* **ooxml.js:** split a docx paragraph at a mid-run page-type w:br ([902b235](https://github.com/ExaDev/documents.js/commit/902b2355e3ac1b172e2722fe609823bdb96b58d4))

## [8.4.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.3.0...ooxml.js%408.4.0) (2026-09-07)

### Features

* **ooxml.js:** read w:pBdr into ContentParagraph.borders for docx ([1c0b93c](https://github.com/ExaDev/documents.js/commit/1c0b93c18a2b7990400ae848e48218a564b775c4))


### Dependencies

- Updated document-schema.js to ^7.1.0
- Updated archive-codec to ^1.6.6

## [8.3.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.2.0...ooxml.js%408.3.0) (2026-09-07)

### Features

* **ooxml.js:** export readCoreProperties from the public API ([bff268e](https://github.com/ExaDev/documents.js/commit/bff268e716b5238ca588053eee089edf0bf9cc8e)), references [ExaDev/documents.js#933](https://github.com/ExaDev/documents.js/issues/933)

## [8.2.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.1.0...ooxml.js%408.2.0) (2026-09-07)

### Features

* **ooxml.js:** apply w:themeShade/w:themeTint to a resolved theme colour ([1ca08ad](https://github.com/ExaDev/documents.js/commit/1ca08ad2853f898400bf548b90dd34efc492b6a6))

### Documentation

* **ooxml.js:** remove a stale claim about run boolean properties reading back false ([2bdc29e](https://github.com/ExaDev/documents.js/commit/2bdc29e83df6d80bc3bf449ecdf2a75e3a60a40b))

## [8.1.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.0.1...ooxml.js%408.1.0) (2026-09-07)

### Features

* **ooxml.js:** write cell comments as xlsx threaded comments ([bb4cc65](https://github.com/ExaDev/documents.js/commit/bb4cc658329ef50ea83c05b9a9b78a71e0f39659))

### Bug Fixes

* **ooxml.js:** decode XML entities in a threaded comment's inline author name ([c7160bb](https://github.com/ExaDev/documents.js/commit/c7160bbb5b59fe10c879d78a40dea1c93f02543f))

## [8.0.1](https://github.com/ExaDev/documents.js/compare/ooxml.js%408.0.0...ooxml.js%408.0.1) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.0.0
- Updated archive-codec to ^1.6.5

## [8.0.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%407.1.6...ooxml.js%408.0.0) (2026-09-07)

### ⚠ BREAKING CHANGES

* **ooxml.js:** resolve pptx table cell a:pattFill to a real pattern fill

### Features

* **ooxml.js:** resolve pptx table cell a:pattFill to a real pattern fill ([fd2d558](https://github.com/ExaDev/documents.js/commit/fd2d5589013eb95ae656b5887c37cf36d891f4c7))

## [7.1.6](https://github.com/ExaDev/documents.js/compare/ooxml.js%407.1.5...ooxml.js%407.1.6) (2026-09-07)

### Bug Fixes

* **workspace:** narrow discriminated unions and Uint8Array generics in worker tests ([54e92fa](https://github.com/ExaDev/documents.js/commit/54e92fad8aabe767b3f8a33423de819468fb1b54))


### Dependencies

- Updated document-schema.js to ^6.2.3
- Updated archive-codec to ^1.6.4

## [7.1.5](https://github.com/ExaDev/documents.js/compare/ooxml.js%407.1.4...ooxml.js%407.1.5) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.2
- Updated archive-codec to ^1.6.3

## [7.1.4](https://github.com/ExaDev/documents.js/compare/ooxml.js%407.1.3...ooxml.js%407.1.4) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.1
- Updated archive-codec to ^1.6.2

## [7.1.3](https://github.com/ExaDev/documents.js/compare/ooxml.js%407.1.2...ooxml.js%407.1.3) (2026-09-07)

### Bug Fixes

* **ooxml.js:** set options: [] for a dropdown/combo field with no items ([657b513](https://github.com/ExaDev/documents.js/commit/657b5132b73f38575c2576592830401d76ad4d8f))

## [7.1.2](https://github.com/ExaDev/documents.js/compare/ooxml.js%407.1.1...ooxml.js%407.1.2) (2026-09-06)


### Dependencies

- Updated document-schema.js to ^6.2.0
- Updated archive-codec to ^1.6.1

## [7.1.1](https://github.com/ExaDev/documents.js/compare/ooxml.js%407.1.0...ooxml.js%407.1.1) (2026-09-06)


### Dependencies

- Updated archive-codec to ^1.6.0

## [7.1.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%407.0.0...ooxml.js%407.1.0) (2026-09-06)

### Features

* **workspace:** add per-package Stryker mutation testing configuration ([ff3eacc](https://github.com/ExaDev/documents.js/commit/ff3eacc124577b163a1c13a63b83484d9611ae5a))

### Bug Fixes

* **workspace:** drop the unused per-package @stryker-mutator/api dependency ([69270b6](https://github.com/ExaDev/documents.js/commit/69270b6e7ad7163c3b76cd085f4e5f367433994c))


### Dependencies

- Updated document-schema.js to ^6.1.0
- Updated excel-number-format to ^1.1.0
- Updated archive-codec to ^1.5.0

## [7.0.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%406.3.7...ooxml.js%407.0.0) (2026-09-06)

### ⚠ BREAKING CHANGES

* **ooxml.js:** readDocxContent/readXlsxContent's ContentTableCell/
  ContentSheetCell.background is now a discriminated ContentCellFill
  rather than a bare Color, matching document-schema.js's own breaking
  change to the shared schema. buildDocxPackageFromContent/
  buildXlsxPackageFromContent's cell background parameter changes the
  same way. A caller reading a solid background as a Color directly, or
  constructing one, must wrap/unwrap it as { kind: 'solid', color }.

### Features

* **ooxml.js:** export readCellShading for consumers reading raw docx XML directly ([ee360ff](https://github.com/ExaDev/documents.js/commit/ee360ffdf31d955dc1799a6cb722f34d4440f846))
* **ooxml.js:** patch docProps/core.xml in place without a full rebuild ([cb22eec](https://github.com/ExaDev/documents.js/commit/cb22eec3507aa772c54a80218fdfbcac119ed322))
* **ooxml.js:** read and write real pattern fills for docx and xlsx table cells ([d2cc5fb](https://github.com/ExaDev/documents.js/commit/d2cc5fbda71d05e811d200bbf024c7ee8e713aa0))

### Bug Fixes

* **ooxml.js:** clamp xlsx column-width characters to a non-negative floor ([4516716](https://github.com/ExaDev/documents.js/commit/451671658e46567fdc527cb2c2392b9c353baaab))
* **ooxml.js:** declare xmlns when patching creates a new core-properties element ([4fb8268](https://github.com/ExaDev/documents.js/commit/4fb826850648ef6f06bd0cd8eee061befb571ba7))
* **ooxml.js:** read pptx table cell a:lnL/a:lnR/a:lnT/a:lnB borders ([9564498](https://github.com/ExaDev/documents.js/commit/9564498ccc6b26ef360b8460b2c5cbbc72e21a92))
* **ooxml.js:** round xlsx column widths up so writes converge to a fixed point ([65cad4a](https://github.com/ExaDev/documents.js/commit/65cad4a93536176348df67fd41463c45a34b50e8))
* **ooxml.js:** switch exhaustively on cell-fill kind instead of if/else ([e24a864](https://github.com/ExaDev/documents.js/commit/e24a8646e9862f42423475295e606a56bfa1e159))
* **ooxml.js:** switch exhaustively on cell-fill kind instead of if/else ([ec7ab70](https://github.com/ExaDev/documents.js/commit/ec7ab703a7df296c610662bd34883bf19333fccb))
* **ooxml.js:** treat a pptx cell border edge's zero or non-numeric width as no border ([94b5bfb](https://github.com/ExaDev/documents.js/commit/94b5bfb3373ae406950dd4b877fb896b80ea2277))

### Code Refactoring

* **document-schema.js:** host unrecognizedFillKind for every cell-fill writer ([855121a](https://github.com/ExaDev/documents.js/commit/855121a58523e0ad8f332e28be8def3454918bc7))
* **ooxml.js:** extract unrecognizedFillKind to a shared cell-fill module ([1f6dd55](https://github.com/ExaDev/documents.js/commit/1f6dd55e70ba0cc3fb9c69bb145fc7eac2f6c008))

### Documentation

* **ooxml.js:** cite the correct ECMA-376 section for w:shd ([ff8e549](https://github.com/ExaDev/documents.js/commit/ff8e5499119e4321c3cb29df4b63eb73cb242256))
* **ooxml.js:** describe xlsx column widths as settling to a fixed point ([ccca3d0](https://github.com/ExaDev/documents.js/commit/ccca3d0921dff26e53e12e1ddd3ece7cb04046db))
* **ooxml.js:** fix fabricated docx precedent in border width guard comment ([4d4228a](https://github.com/ExaDev/documents.js/commit/4d4228a87907b117b52c8580384c1aed60a70e1f))
* **ooxml.js:** split two comment paragraphs above readSectionHeaderFooters back apart ([c570fae](https://github.com/ExaDev/documents.js/commit/c570faef5caf57dc6b6dfe10ee6a35bf79998ff9))

### Tests

* **ooxml.js:** assert xlsx column-width read/write reaches a fixed point ([868ce2a](https://github.com/ExaDev/documents.js/commit/868ce2a975639ba100a389fd5daacf5caa51ad44))
* **ooxml.js:** assert XML-encoding against serialized output, not the decoder ([72eac77](https://github.com/ExaDev/documents.js/commit/72eac77b4fd09e5f13b3733a6d4543c528306da1))
* **ooxml.js:** cover a pptx cell border edge with a non-numeric width ([ac47b89](https://github.com/ExaDev/documents.js/commit/ac47b89462b790fe3e8f7520d00d4c89a8c457eb))
* **ooxml.js:** cover pptx cell borders with unresolvable or zero-width edges ([14d0f87](https://github.com/ExaDev/documents.js/commit/14d0f87c50c053e70c52505e1d441ac3fd73e6c0))
* **ooxml.js:** cover xlsx column-width convergence through the full write/read pipeline ([71cb2e3](https://github.com/ExaDev/documents.js/commit/71cb2e3119eb1e776078fa91964ed68002c6e67f))
* **ooxml.js:** quantize xlsx column-width convergence checks at write precision ([f42eb0e](https://github.com/ExaDev/documents.js/commit/f42eb0e5dd4d3411baaabe5bfba573784fa95670))
* **ooxml.js:** use genuinely drifting widths in the xlsx build regression test ([0b6e418](https://github.com/ExaDev/documents.js/commit/0b6e4183b19cae8458ce88866d7f02a551a4938c))


### Dependencies

- Updated document-schema.js to ^6.0.0
- Updated excel-number-format to ^1.0.2
- Updated archive-codec to ^1.4.3

## [6.3.7](https://github.com/ExaDev/documents.js/compare/ooxml.js%406.3.6...ooxml.js%406.3.7) (2026-09-05)


### Dependencies

- Updated excel-number-format to ^1.0.1
- Updated archive-codec to ^1.4.2

## [6.3.6](https://github.com/ExaDev/documents.js/compare/ooxml.js%406.3.5...ooxml.js%406.3.6) (2026-09-05)

### Bug Fixes

* handle ContentImageBlock's widened svg/gif formats across every consumer ([875b10b](https://github.com/ExaDev/documents.js/commit/875b10b3281ca1ab598abc97230d82f8ff5cdaae))


### Dependencies

- Updated document-schema.js to ^5.6.0
- Updated archive-codec to ^1.4.1

## [6.3.5](https://github.com/ExaDev/documents.js/compare/ooxml.js%406.3.4...ooxml.js%406.3.5) (2026-09-05)

### Bug Fixes

* **ooxml.js:** read pptx picture alt text from p:cNvPr/[@descr](https://github.com/descr) ([0168895](https://github.com/ExaDev/documents.js/commit/01688955037817ead265c5898a5d6baa5a20e325))

## [6.3.4](https://github.com/ExaDev/documents.js/compare/ooxml.js%406.3.3...ooxml.js%406.3.4) (2026-09-04)

### Code Refactoring

* **ooxml.js,xls-codec:** consume the shared excel-number-format classifier ([8b6cab4](https://github.com/ExaDev/documents.js/commit/8b6cab443a7e2c18ae8057c48c4448f67310c80c))
* **ooxml.js:** resolve xlsx border weights through the shared quantisation ([579e11a](https://github.com/ExaDev/documents.js/commit/579e11ac2dfb7742de3a5634800209ae0bea4601))


### Dependencies

- Updated document-schema.js to ^5.5.1
- Updated excel-number-format to ^1.0.0
- Updated archive-codec to ^1.4.0

## [6.3.3](https://github.com/ExaDev/documents.js/compare/ooxml.js%406.3.2...ooxml.js%406.3.3) (2026-09-03)


### Dependencies

- Updated document-schema.js to ^5.5.0

## [6.3.2](https://github.com/ExaDev/documents.js/compare/ooxml.js%406.3.1...ooxml.js%406.3.2) (2026-09-03)


### Dependencies

- Updated archive-codec to ^1.3.0

## [6.3.1](https://github.com/ExaDev/documents.js/compare/ooxml.js%406.3.0...ooxml.js%406.3.1) (2026-09-02)

### Miscellaneous Chores

* **deps:** bump document-schema.js to ^5.4.0 in ooxml.js [skip ci] ([e511ca7](https://github.com/ExaDev/documents.js/commit/e511ca72f2004afea2434a0c36d3c7d616eb39ad))


### Dependencies

- Updated document-schema.js to ^5.4.0

## [6.3.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%406.2.0...ooxml.js%406.3.0) (2026-09-02)

### Features

* **document-schema.js:** carry a sheet cell's own raw number-format code ([8b51a80](https://github.com/ExaDev/documents.js/commit/8b51a80eb50f0e02841f5ac194f7c1b1a3ff790f))

### Miscellaneous Chores

* **deps:** bump document-schema.js to ^5.3.0 in ooxml.js [skip ci] ([87d9f10](https://github.com/ExaDev/documents.js/commit/87d9f10ac1b737f5a34634b6666eb56ffb65ebdd))


### Dependencies

- Updated document-schema.js to ^5.3.0

## [6.2.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%406.1.0...ooxml.js%406.2.0) (2026-09-02)

### Features

* **ooxml.js:** read and write xlsx dataValidation/conditionalFormatting rules ([82e92b7](https://github.com/ExaDev/documents.js/commit/82e92b71d6ec056b6833d99464f50e35f16f2f0a))

### Documentation

* **ooxml.js:** describe real dataValidation/conditionalFormatting support ([d60d354](https://github.com/ExaDev/documents.js/commit/d60d354b7c550538ccabf506524da059da641c71))

### Tests

* **ooxml.js:** add real LibreOffice-produced xlsx fixtures for validation/conditional-format rules ([0d74408](https://github.com/ExaDev/documents.js/commit/0d74408a6a1254af0be39a913cc14a186c95b25d))
* **ooxml.js:** cover xlsx dataValidation/conditionalFormatting rules ([75aaee5](https://github.com/ExaDev/documents.js/commit/75aaee55ef5d9851a75e86a877e653561269a1fb))

### Miscellaneous Chores

* **deps:** bump document-schema.js to ^5.2.0 in ooxml.js [skip ci] ([5d7f11f](https://github.com/ExaDev/documents.js/commit/5d7f11f3f7328822480e65bf9b98845d89bf3e4d))


### Dependencies

- Updated document-schema.js to ^5.2.0

## [6.1.0](https://github.com/ExaDev/documents.js/compare/ooxml.js%406.0.0...ooxml.js%406.1.0) (2026-08-24)

### Features

* **eslint:** enable strictTypeChecked across the workspace ([67eec04](https://github.com/ExaDev/documents.js/commit/67eec04a380b25142f5d1afd11cb9906ff2cfd5f))
* **eslint:** lint JSON, Markdown, and YAML alongside the TypeScript ([016b127](https://github.com/ExaDev/documents.js/commit/016b127119733c50aa7694bad6265e9bc26bb215))

### Code Refactoring

* clear what strictTypeChecked's non-deviated rules found ([92a9fc9](https://github.com/ExaDev/documents.js/commit/92a9fc98f76244fca3a42ff0a12312ab0ce1a79b))
* **eslint:** move the seven preset-using packages onto the shared config ([f91e3a5](https://github.com/ExaDev/documents.js/commit/f91e3a5d8708424963f10ebb7f2db07a11b5ff45))
* **tsconfig:** share the strict compiler options through one base config ([43af382](https://github.com/ExaDev/documents.js/commit/43af382f726d7d42754ac0b6bf6d91b0ae302e25))

### Styles

* format the workspace with prettier ([56c3a1d](https://github.com/ExaDev/documents.js/commit/56c3a1dd1b0f05fbeccfc9b5e8b1d27ca97486b4))

### Miscellaneous Chores

* **deps:** bump archive-codec to ^1.2.0 in ooxml.js [skip ci] ([c1bda42](https://github.com/ExaDev/documents.js/commit/c1bda42876eabd029635a7fb9b6954a2fb343314))
* **deps:** bump document-schema.js to ^5.1.0 in ooxml.js [skip ci] ([4bc0fd4](https://github.com/ExaDev/documents.js/commit/4bc0fd4b99e52f38989054c0266e99852c0f779e))
* **deps:** drop the dependencies each package no longer uses ([80094aa](https://github.com/ExaDev/documents.js/commit/80094aa6db412392ef6e6457014d5963a5e910a7))


### Dependencies

- Updated document-schema.js to ^5.1.0
- Updated archive-codec to ^1.2.0

# [6.0.0](https://github.com/ExaDev/documents.js/compare/ooxml.js@5.0.2...ooxml.js@6.0.0) (2026-08-23)


* refactor(ooxml)!: rename DocumentPackage to DocumentTree ([7455cf5](https://github.com/ExaDev/documents.js/commit/7455cf5d637ce4eec948e45503ccf6d074335683)), closes [#661](https://github.com/ExaDev/documents.js/issues/661)


### BREAKING CHANGES

* every DocumentPackage-rooted export this package
re-exports or returns (DocumentTree, TreeNode/Group/Leaf/BlockLeaf and
siblings, assembleTree, flattenTree) tracks document-schema.js 5.0.0's
rename. The deep-import path typed/document-package moves to
typed/document-tree.


### Dependencies

- Updated document-schema.js to ^5.0.0

## [5.0.2](https://github.com/ExaDev/documents.js/compare/ooxml.js@5.0.1...ooxml.js@5.0.2) (2026-08-23)


### Dependencies

- Updated document-schema.js to ^4.10.0

## [5.0.1](https://github.com/ExaDev/documents.js/compare/ooxml.js@5.0.0...ooxml.js@5.0.1) (2026-08-23)


### Dependencies

- Updated document-schema.js to ^4.9.1
- Updated archive-codec to ^1.1.2

# [5.0.0](https://github.com/ExaDev/documents.js/compare/ooxml.js@4.7.0...ooxml.js@5.0.0) (2026-08-22)


* refactor(ooxml)!: drop the flat headers/footers text arrays from DocxDocument ([3cb1377](https://github.com/ExaDev/documents.js/commit/3cb137776699a1b85afeeee40b6e62f7de203e96))


### Features

* **ooxml:** read unreferenced header/footer parts into headerFooterParts ([4355b02](https://github.com/ExaDev/documents.js/commit/4355b02c4a8df35f36b041597648173db8d9b6b2))


### BREAKING CHANGES

* DocxDocument no longer carries headers/footers string
arrays — the structural headerFooterParts/sectionHeaderFooters model
(which also carries unreferenced parts) replaces them.

# [4.7.0](https://github.com/ExaDev/documents.js/compare/ooxml.js@4.6.0...ooxml.js@4.7.0) (2026-08-22)


### Features

* **ooxml:** read xdr:absoluteAnchor worksheet drawings ([3866939](https://github.com/ExaDev/documents.js/commit/386693930e7353533e13e5b5073e4fef1d467cf3))
* **ooxml:** read xdr:oneCellAnchor worksheet drawings ([1bd4f75](https://github.com/ExaDev/documents.js/commit/1bd4f752b7293b3e16b332d2abca189efc46edf3))

# [4.6.0](https://github.com/ExaDev/documents.js/compare/ooxml.js@4.5.2...ooxml.js@4.6.0) (2026-08-22)


### Bug Fixes

* **docx:** type the embedded-presentation port's bytes as Uint8Array<ArrayBuffer> ([756070e](https://github.com/ExaDev/documents.js/commit/756070e57371411013586cda18d527911fd9e900))


### Features

* **docx:** serialise an embedded presentation through an injected port ([5b41485](https://github.com/ExaDev/documents.js/commit/5b414855ad4c56f9fb9843b359f903a467316547)), closes [#742](https://github.com/ExaDev/documents.js/issues/742)

## [4.5.2](https://github.com/ExaDev/documents.js/compare/ooxml.js@4.5.1...ooxml.js@4.5.2) (2026-08-22)


### Dependencies

- Updated document-schema.js to ^4.9.0

## [4.5.1](https://github.com/ExaDev/documents.js/compare/ooxml.js@4.5.0...ooxml.js@4.5.1) (2026-08-22)

# [4.5.0](https://github.com/ExaDev/documents.js/compare/ooxml.js@4.4.4...ooxml.js@4.5.0) (2026-08-21)


### Features

* **ooxml:** read a worksheet drawing's pictures into ContentSheet.images ([9628330](https://github.com/ExaDev/documents.js/commit/962833088212e182252e662cc12032f28c5c71b1))

## [4.4.4](https://github.com/ExaDev/documents.js/compare/ooxml.js@4.4.3...ooxml.js@4.4.4) (2026-08-21)


### Dependencies

- Updated archive-codec to ^1.1.1

## [4.4.3](https://github.com/ExaDev/documents.js/compare/ooxml.js@4.4.2...ooxml.js@4.4.3) (2026-08-21)


### Bug Fixes

* **ooxml:** pin zip entry mtimes so encodePackage is byte-deterministic ([9ce5791](https://github.com/ExaDev/documents.js/commit/9ce579145cecce2141178ed9baaf39140af24fe6))

## [4.4.2](https://github.com/ExaDev/documents.js/compare/ooxml.js@4.4.1...ooxml.js@4.4.2) (2026-08-21)


### Dependencies

- Updated document-schema.js to ^4.8.0

## [4.4.1](https://github.com/ExaDev/documents.js/compare/ooxml.js@4.4.0...ooxml.js@4.4.1) (2026-08-21)


### Dependencies

- Updated document-schema.js to ^4.7.0

# [4.4.0](https://github.com/ExaDev/documents.js/compare/ooxml.js@4.3.0...ooxml.js@4.4.0) (2026-08-21)


### Bug Fixes

* **xlsx:** read table columns through the CT_Table tableColumns wrapper ([c1e665f](https://github.com/ExaDev/documents.js/commit/c1e665f5750553d2b1273fa415b339db88bc2532))


### Features

* **docx:** read header/footer parts as block flow with per-section references ([ec2a633](https://github.com/ExaDev/documents.js/commit/ec2a633c57a1c25359ff29c0ff0beab642310eba))
* **docx:** read the [#750](https://github.com/ExaDev/documents.js/issues/750) run-level construct rows plus w:ffData form fields ([47b737e](https://github.com/ExaDev/documents.js/commit/47b737ece262f87ef00b00aab205ad9015c2ec57))
* **docx:** read w:sectPr/w:type onto ContentSection.breakType and write it back ([822e156](https://github.com/ExaDev/documents.js/commit/822e1561761d68bf80bbadb770d037cbdc51274a))
* **pptx:** read a:fld dynamic fields as field run constructs ([8b2f4f1](https://github.com/ExaDev/documents.js/commit/8b2f4f13c2ce584f366a7f9e4e135edf2029f6fe))
* **pptx:** read internal slide-jump links as link run constructs ([f337de9](https://github.com/ExaDev/documents.js/commit/f337de98da02da5c10fe9f46c1bd57241347a51f))
* **xlsx:** quarantine dataValidation and conditionalFormatting as anchor-cell residue ([a8179e8](https://github.com/ExaDev/documents.js/commit/a8179e88f32a5f7225b429bfa3f1560ca06b663f))
* **xlsx:** read chart graphic frames as embedded chart objects ([4d2a9ce](https://github.com/ExaDev/documents.js/commit/4d2a9ceaf9adb8ccc5e6f3e0f3c31d399f8e050d))
* **xlsx:** read general defined names and table objects into the tree definitions table ([8d01e18](https://github.com/ExaDev/documents.js/commit/8d01e180fa498f1588e95b22f257b551c8ff255d))


### Dependencies

- Updated document-schema.js to ^4.6.0

# [4.3.0](https://github.com/ExaDev/documents.js/compare/ooxml.js@4.2.0...ooxml.js@4.3.0) (2026-08-21)


### Bug Fixes

* emit a point bookmark extent's halves as a start-then-end pair, not an inverted one ([55b9b2d](https://github.com/ExaDev/documents.js/commit/55b9b2d8e977271478802783223ce42e22a2bffd))


### Features

* read and write mid-paragraph docx bookmarks through run-level construct extents ([1d2079b](https://github.com/ExaDev/documents.js/commit/1d2079b0ecd0ad36ad011c1d5c295ec6bf01d38e))


### Dependencies

- Updated document-schema.js to ^4.5.0

# [4.2.0](https://github.com/ExaDev/documents.js/compare/ooxml.js@4.1.1...ooxml.js@4.2.0) (2026-08-20)


### Bug Fixes

* **ooxml:** gate gallery-residue restoration on the richText controlType that mints it ([d89230f](https://github.com/ExaDev/documents.js/commit/d89230f15dcba0e3665497372c7ea7b3d18a8293))


### Features

* **ooxml:** carry a non-TOC docx SDT gallery in residue and restore it on write ([cc4b9be](https://github.com/ExaDev/documents.js/commit/cc4b9becd728cee1334e4c438f26d638d1bb71ce))
* recover classic OLE compound-file .bin embedded payloads ([2c731fe](https://github.com/ExaDev/documents.js/commit/2c731fe49e39fd6a3f48f6c8bf85aff1c924bb50)), closes [#737](https://github.com/ExaDev/documents.js/issues/737)
* write recovered embedded OOXML objects back out as w:object OLE markup ([710f283](https://github.com/ExaDev/documents.js/commit/710f28300d12ea4bdc1879111451a1791c7a8788))


### Dependencies

- Updated archive-codec to ^1.1.0

## [4.1.1](https://github.com/ExaDev/documents.js/compare/ooxml.js@4.1.0...ooxml.js@4.1.1) (2026-08-20)

# [4.1.0](https://github.com/ExaDev/documents.js/compare/ooxml.js@4.0.12...ooxml.js@4.1.0) (2026-08-20)


### Bug Fixes

* bound the embedded-payload inflate through archive-codec's walk guards ([5a56114](https://github.com/ExaDev/documents.js/commit/5a561144dbf9238185be57e7b42bc2f4474d3c25))
* degrade non-numeric docx object and image geometry to no block ([20fa8b9](https://github.com/ExaDev/documents.js/commit/20fa8b921b83daab33cc884fb0a4e01043e5fc0f))
* degrade undecodable embedded OLE payloads instead of failing the host read ([94cfced](https://github.com/ExaDev/documents.js/commit/94cfcedd7ac003ae7a927ad932a8e7453203dd50))


### Features

* recover embedded OOXML objects from docx w:object markup ([b0198c3](https://github.com/ExaDev/documents.js/commit/b0198c380a6727546d96de2c8fb0a5483f2136d8))
* recover ZIP-payload OLE objects in pptx as embedded content documents ([24c237b](https://github.com/ExaDev/documents.js/commit/24c237b1d4263a6841fa1438ff315c58808ecc4b)), closes [#734](https://github.com/ExaDev/documents.js/issues/734)


### Performance Improvements

* decode an embeddings part shared by OLE frames once per read ([eb4d1b2](https://github.com/ExaDev/documents.js/commit/eb4d1b2ad33ad781ff1e5d22617aaf31d3ab4b8d))


### Dependencies

- Updated archive-codec to ^1.0.2

## [4.0.12](https://github.com/ExaDev/documents.js/compare/ooxml.js@4.0.11...ooxml.js@4.0.12) (2026-08-20)


### Dependencies

- Updated document-schema.js to ^4.3.7

## [4.0.11](https://github.com/ExaDev/documents.js/compare/ooxml.js@4.0.10...ooxml.js@4.0.11) (2026-08-20)


### Dependencies

- Updated document-schema.js to ^4.3.6

## [4.0.10](https://github.com/ExaDev/documents.js/compare/ooxml.js@4.0.9...ooxml.js@4.0.10) (2026-08-20)


### Bug Fixes

* point package homepage and bugs URLs at the monorepo, not the old standalone repos ([1b605e8](https://github.com/ExaDev/documents.js/commit/1b605e846393f417001227758a8606347c04e219))


### Dependencies

- Updated document-schema.js to ^4.3.5

## [4.0.9](https://github.com/ExaDev/documents.js/compare/ooxml.js@4.0.8...ooxml.js@4.0.9) (2026-08-20)


### Dependencies

- Updated document-schema.js to ^4.3.4

## [4.0.6](https://github.com/ExaDev/ooxml.js/compare/v4.0.5...v4.0.6) (2026-08-19)

## [4.0.5](https://github.com/ExaDev/ooxml.js/compare/v4.0.4...v4.0.5) (2026-08-19)

## [4.0.4](https://github.com/ExaDev/ooxml.js/compare/v4.0.3...v4.0.4) (2026-08-19)

## [4.0.3](https://github.com/ExaDev/ooxml.js/compare/v4.0.2...v4.0.3) (2026-08-19)

## [4.0.2](https://github.com/ExaDev/ooxml.js/compare/v4.0.1...v4.0.2) (2026-08-19)

## [4.0.1](https://github.com/ExaDev/ooxml.js/compare/v4.0.0...v4.0.1) (2026-08-19)

# [4.0.0](https://github.com/ExaDev/ooxml.js/compare/v3.1.1...v4.0.0) (2026-08-19)


* feat!: give each format a DocumentPackage-native reader and writer ([b092969](https://github.com/ExaDev/ooxml.js/commit/b0929697de91316971deaacbd6671c6743927ca7))


### Features

* re-export document-schema.js's style-resolution helpers from the barrel ([2f47b40](https://github.com/ExaDev/ooxml.js/commit/2f47b409b89c1683a5f85e91aee4f3a5a30251c8))


### BREAKING CHANGES

* readDocx, readPptx, and readXlsx keep their signatures but
return a DocumentPackage instead of DocxDocument, PptxDocument, and
XlsxWorkbook; buildDocxPackage and buildXlsxPackage take a DocumentPackage
instead of DocxContent and ContentDocument. Callers wanting the previous
behaviour move to readDocxContent, readPptxContent, readXlsxWorkbook,
buildDocxPackageFromContent, and buildXlsxPackageFromContent respectively.

## [3.1.1](https://github.com/ExaDev/ooxml.js/compare/v3.1.0...v3.1.1) (2026-08-19)

# [3.1.0](https://github.com/ExaDev/ooxml.js/compare/v3.0.1...v3.1.0) (2026-08-18)


### Bug Fixes

* **docx:** descend into a trailing construct wrapper to find a section break's paragraph ([9b9c01b](https://github.com/ExaDev/ooxml.js/commit/9b9c01becbb388497e6e27a4608b41d08389aaf5))
* **docx:** keep a pending page break attached to its paragraph through a construct, table, or image ([29780a3](https://github.com/ExaDev/ooxml.js/commit/29780a3c24567d27f25786152814d85f9d7578fd))
* **docx:** wrap a tracked change around a paragraph's own runs, never the paragraph ([2a230a6](https://github.com/ExaDev/ooxml.js/commit/2a230a6c45c098fd01c48659382c942f18b84ba5))
* **docx:** write a construct with no block-level docx element as plain content ([a7e6b02](https://github.com/ExaDev/ooxml.js/commit/a7e6b0233474ce7b0bc847cec0916debd2af5f01))
* **typed:** decode a relationship target's XML entities when resolving it ([6b04db9](https://github.com/ExaDev/ooxml.js/commit/6b04db9c70f9ef90d891e96c65afea15aa1ff149))


### Features

* **docx:** add buildDocxPackage, the write side of readDocx's sections ([b161ad9](https://github.com/ExaDev/ooxml.js/commit/b161ad90c963f21837da99e920f0e372e49a2629))
* **docx:** read block-scoped fields, bookmarks, SDTs, and tracked changes as construct markers ([48f3ef7](https://github.com/ExaDev/ooxml.js/commit/48f3ef74750a1a710b5d9dfb9af441064c7a4f48))

## [3.0.1](https://github.com/ExaDev/ooxml.js/compare/v3.0.0...v3.0.1) (2026-08-18)

# [3.0.0](https://github.com/ExaDev/ooxml.js/compare/v2.17.0...v3.0.0) (2026-08-18)


* feat!: drop ContentDocument formatVersion for document-schema.js 4.0.0 ([ae81880](https://github.com/ExaDev/ooxml.js/commit/ae8188057ea6d9066c3ca53c3cd405698acaf164)), closes [ExaDev/document-schema.js#20](https://github.com/ExaDev/document-schema.js/issues/20)


### BREAKING CHANGES

* readXlsxContent's emitted ContentDocument no longer
carries formatVersion and the CONTENT_FORMAT_VERSION barrel export is
removed; dependents must move to document-schema.js ^4.0.0 in
lockstep.

# [2.17.0](https://github.com/ExaDev/ooxml.js/compare/v2.16.1...v2.17.0) (2026-08-17)


### Features

* emit pptx paragraph outline levels from a:pPr/[@lvl](https://github.com/lvl) ([686252c](https://github.com/ExaDev/ooxml.js/commit/686252c3d02335c21393cc900158cd94d2524b1e))

## [2.16.1](https://github.com/ExaDev/ooxml.js/compare/v2.16.0...v2.16.1) (2026-08-17)

# [2.16.0](https://github.com/ExaDev/ooxml.js/compare/v2.15.0...v2.16.0) (2026-08-17)


### Features

* read pptx OLE graphic frames' fallback picture as an image block ([d5f5a30](https://github.com/ExaDev/ooxml.js/commit/d5f5a3013b052c08ecdde1a8771a3690dd5b1ef1))

# [2.15.0](https://github.com/ExaDev/ooxml.js/compare/v2.14.0...v2.15.0) (2026-08-17)


### Features

* read pptx SmartArt graphic frames' node text in diagram order ([1d54192](https://github.com/ExaDev/ooxml.js/commit/1d5419264b7180d6c1204f078eae927439f09f46))

# [2.14.0](https://github.com/ExaDev/ooxml.js/compare/v2.13.1...v2.14.0) (2026-08-17)


### Features

* read pptx chart graphic frames' cached series/category model as a table block ([4572909](https://github.com/ExaDev/ooxml.js/commit/4572909263e5bba01e852b2c49326888e56de461))

## [2.13.1](https://github.com/ExaDev/ooxml.js/compare/v2.13.0...v2.13.1) (2026-08-17)

# [2.13.0](https://github.com/ExaDev/ooxml.js/compare/v2.12.2...v2.13.0) (2026-08-17)


### Features

* read xlsx cell comments into ContentSheetCell.comment ([fcea960](https://github.com/ExaDev/ooxml.js/commit/fcea9606e24d0bfc7ff8c498effb5b7821fa7708))

## [2.12.2](https://github.com/ExaDev/ooxml.js/compare/v2.12.1...v2.12.2) (2026-08-17)

## [2.12.1](https://github.com/ExaDev/ooxml.js/compare/v2.12.0...v2.12.1) (2026-08-17)

# [2.12.0](https://github.com/ExaDev/ooxml.js/compare/v2.11.33...v2.12.0) (2026-08-17)


### Features

* resolve docx headingLevel from w:outlineLvl through the style cascade ([d46fab7](https://github.com/ExaDev/ooxml.js/commit/d46fab7de87cf000119b9031379a53b3eef791a7))

## [2.11.33](https://github.com/ExaDev/ooxml.js/compare/v2.11.32...v2.11.33) (2026-08-17)

## [2.11.32](https://github.com/ExaDev/ooxml.js/compare/v2.11.31...v2.11.32) (2026-08-17)

## [2.11.31](https://github.com/ExaDev/ooxml.js/compare/v2.11.30...v2.11.31) (2026-08-17)

## [2.11.30](https://github.com/ExaDev/ooxml.js/compare/v2.11.29...v2.11.30) (2026-08-17)

## [2.11.29](https://github.com/ExaDev/ooxml.js/compare/v2.11.28...v2.11.29) (2026-08-17)

## [2.11.28](https://github.com/ExaDev/ooxml.js/compare/v2.11.27...v2.11.28) (2026-08-14)

## [2.11.27](https://github.com/ExaDev/ooxml.js/compare/v2.11.26...v2.11.27) (2026-08-13)

## [2.11.26](https://github.com/ExaDev/ooxml.js/compare/v2.11.25...v2.11.26) (2026-08-13)

## [2.11.25](https://github.com/ExaDev/ooxml.js/compare/v2.11.24...v2.11.25) (2026-08-12)

## [2.11.24](https://github.com/ExaDev/ooxml.js/compare/v2.11.23...v2.11.24) (2026-08-12)

## [2.11.23](https://github.com/ExaDev/ooxml.js/compare/v2.11.22...v2.11.23) (2026-08-12)

## [2.11.22](https://github.com/ExaDev/ooxml.js/compare/v2.11.21...v2.11.22) (2026-08-12)

## [2.11.21](https://github.com/ExaDev/ooxml.js/compare/v2.11.20...v2.11.21) (2026-08-12)

## [2.11.20](https://github.com/ExaDev/ooxml.js/compare/v2.11.19...v2.11.20) (2026-08-12)

## [2.11.19](https://github.com/ExaDev/ooxml.js/compare/v2.11.18...v2.11.19) (2026-08-12)

## [2.11.18](https://github.com/ExaDev/ooxml.js/compare/v2.11.17...v2.11.18) (2026-08-12)


### Bug Fixes

* ignore dependabot commits in commitlint body-length check ([527e6f3](https://github.com/ExaDev/ooxml.js/commit/527e6f388028ce5fa2b9748fc638ca67ba48eee3))

## [2.11.17](https://github.com/ExaDev/ooxml.js/compare/v2.11.16...v2.11.17) (2026-08-12)

## [2.11.16](https://github.com/ExaDev/ooxml.js/compare/v2.11.15...v2.11.16) (2026-08-12)

## [2.11.15](https://github.com/ExaDev/ooxml.js/compare/v2.11.14...v2.11.15) (2026-08-12)

## [2.11.14](https://github.com/ExaDev/ooxml.js/compare/v2.11.13...v2.11.14) (2026-08-12)

## [2.11.13](https://github.com/ExaDev/ooxml.js/compare/v2.11.12...v2.11.13) (2026-08-12)

## [2.11.12](https://github.com/ExaDev/ooxml.js/compare/v2.11.11...v2.11.12) (2026-08-10)

## [2.11.11](https://github.com/ExaDev/ooxml.js/compare/v2.11.10...v2.11.11) (2026-08-10)

## [2.11.10](https://github.com/ExaDev/ooxml.js/compare/v2.11.9...v2.11.10) (2026-08-08)

## [2.11.9](https://github.com/ExaDev/ooxml.js/compare/v2.11.8...v2.11.9) (2026-08-08)

## [2.11.8](https://github.com/ExaDev/ooxml.js/compare/v2.11.7...v2.11.8) (2026-08-07)

## [2.11.7](https://github.com/ExaDev/ooxml.js/compare/v2.11.6...v2.11.7) (2026-08-07)

## [2.11.6](https://github.com/ExaDev/ooxml.js/compare/v2.11.5...v2.11.6) (2026-08-07)

## [2.11.5](https://github.com/ExaDev/ooxml.js/compare/v2.11.4...v2.11.5) (2026-08-07)

## [2.11.4](https://github.com/ExaDev/ooxml.js/compare/v2.11.3...v2.11.4) (2026-08-07)

## [2.11.3](https://github.com/ExaDev/ooxml.js/compare/v2.11.2...v2.11.3) (2026-08-07)

## [2.11.2](https://github.com/ExaDev/ooxml.js/compare/v2.11.1...v2.11.2) (2026-08-07)

## [2.11.1](https://github.com/ExaDev/ooxml.js/compare/v2.11.0...v2.11.1) (2026-08-07)

# [2.11.0](https://github.com/ExaDev/ooxml.js/compare/v2.10.3...v2.11.0) (2026-08-07)


### Features

* add an autofix to the split-statement re-export rule ([17d820e](https://github.com/ExaDev/ooxml.js/commit/17d820e176f6ae77315904dc34ba079685a3db64))

## [2.10.3](https://github.com/ExaDev/ooxml.js/compare/v2.10.2...v2.10.3) (2026-08-07)

## [2.10.2](https://github.com/ExaDev/ooxml.js/compare/v2.10.1...v2.10.2) (2026-08-07)


### Bug Fixes

* render literal braces correctly and catch split-statement default re-exports ([98cd285](https://github.com/ExaDev/ooxml.js/commit/98cd2850f9dd69a418bc3d33300232f68cbad6a5))

## [2.10.1](https://github.com/ExaDev/ooxml.js/compare/v2.10.0...v2.10.1) (2026-08-07)

# [2.10.0](https://github.com/ExaDev/ooxml.js/compare/v2.9.5...v2.10.0) (2026-08-07)


### Features

* **lint:** ban a re-export split across an import and a bare export ([207a1fa](https://github.com/ExaDev/ooxml.js/commit/207a1faa898374b14b40f9fd2cf8516c4c343b4a))

## [2.9.5](https://github.com/ExaDev/ooxml.js/compare/v2.9.4...v2.9.5) (2026-08-06)

## [2.9.4](https://github.com/ExaDev/ooxml.js/compare/v2.9.3...v2.9.4) (2026-08-06)

## [2.9.3](https://github.com/ExaDev/ooxml.js/compare/v2.9.2...v2.9.3) (2026-08-06)

## [2.9.2](https://github.com/ExaDev/ooxml.js/compare/v2.9.1...v2.9.2) (2026-08-06)

## [2.9.1](https://github.com/ExaDev/ooxml.js/compare/v2.9.0...v2.9.1) (2026-08-06)

# [2.9.0](https://github.com/ExaDev/ooxml.js/compare/v2.8.19...v2.9.0) (2026-08-06)


### Features

* cache typecheck/lint/test/build tasks with turbo ([e725735](https://github.com/ExaDev/ooxml.js/commit/e725735d8da77fffd327d6b01e9ada41337687e2))

## [2.8.19](https://github.com/ExaDev/ooxml.js/compare/v2.8.18...v2.8.19) (2026-08-06)

## [2.8.18](https://github.com/ExaDev/ooxml.js/compare/v2.8.17...v2.8.18) (2026-08-06)

## [2.8.17](https://github.com/ExaDev/ooxml.js/compare/v2.8.16...v2.8.17) (2026-08-06)

## [2.8.16](https://github.com/ExaDev/ooxml.js/compare/v2.8.15...v2.8.16) (2026-08-06)

## [2.8.15](https://github.com/ExaDev/ooxml.js/compare/v2.8.14...v2.8.15) (2026-08-06)

## [2.8.14](https://github.com/ExaDev/ooxml.js/compare/v2.8.13...v2.8.14) (2026-08-06)

## [2.8.13](https://github.com/ExaDev/ooxml.js/compare/v2.8.12...v2.8.13) (2026-08-06)

## [2.8.12](https://github.com/ExaDev/ooxml.js/compare/v2.8.11...v2.8.12) (2026-08-06)

## [2.8.11](https://github.com/ExaDev/ooxml.js/compare/v2.8.10...v2.8.11) (2026-08-06)

## [2.8.10](https://github.com/ExaDev/ooxml.js/compare/v2.8.9...v2.8.10) (2026-08-06)

## [2.8.9](https://github.com/ExaDev/ooxml.js/compare/v2.8.8...v2.8.9) (2026-08-06)

## [2.8.8](https://github.com/ExaDev/ooxml.js/compare/v2.8.7...v2.8.8) (2026-08-06)

## [2.8.7](https://github.com/ExaDev/ooxml.js/compare/v2.8.6...v2.8.7) (2026-08-05)

## [2.8.6](https://github.com/ExaDev/ooxml.js/compare/v2.8.5...v2.8.6) (2026-08-05)

## [2.8.5](https://github.com/ExaDev/ooxml.js/compare/v2.8.4...v2.8.5) (2026-08-05)

## [2.8.4](https://github.com/ExaDev/ooxml.js/compare/v2.8.3...v2.8.4) (2026-08-05)

## [2.8.3](https://github.com/ExaDev/ooxml.js/compare/v2.8.2...v2.8.3) (2026-08-05)

## [2.8.2](https://github.com/ExaDev/ooxml.js/compare/v2.8.1...v2.8.2) (2026-08-05)

## [2.8.1](https://github.com/ExaDev/ooxml.js/compare/v2.8.0...v2.8.1) (2026-08-05)

# [2.8.0](https://github.com/ExaDev/ooxml.js/compare/v2.7.0...v2.8.0) (2026-08-05)


### Features

* read w:trHeight into ContentTableRow.heightPt ([b6aaecd](https://github.com/ExaDev/ooxml.js/commit/b6aaecdbec6accd86dc606bdeffb2c4684ff829c))

# [2.7.0](https://github.com/ExaDev/ooxml.js/compare/v2.6.19...v2.7.0) (2026-08-05)


### Features

* read and write per-cell decoration (background/borders/alignment) in xlsx ([f3cd652](https://github.com/ExaDev/ooxml.js/commit/f3cd652c30411de752d98104c6667828bae91939))

## [2.6.19](https://github.com/ExaDev/ooxml.js/compare/v2.6.18...v2.6.19) (2026-08-04)

## [2.6.18](https://github.com/ExaDev/ooxml.js/compare/v2.6.17...v2.6.18) (2026-08-04)

## [2.6.17](https://github.com/ExaDev/ooxml.js/compare/v2.6.16...v2.6.17) (2026-08-04)

## [2.6.16](https://github.com/ExaDev/ooxml.js/compare/v2.6.15...v2.6.16) (2026-08-04)

## [2.6.15](https://github.com/ExaDev/ooxml.js/compare/v2.6.14...v2.6.15) (2026-08-04)

## [2.6.14](https://github.com/ExaDev/ooxml.js/compare/v2.6.13...v2.6.14) (2026-08-04)

## [2.6.13](https://github.com/ExaDev/ooxml.js/compare/v2.6.12...v2.6.13) (2026-08-04)


### Bug Fixes

* **ci:** self-heal stranded sibling-dependency PRs after they fall behind main ([871eb4b](https://github.com/ExaDev/ooxml.js/commit/871eb4b041c65fd09a218ec0393b500315176a26))

## [2.6.12](https://github.com/ExaDev/ooxml.js/compare/v2.6.11...v2.6.12) (2026-08-04)

## [2.6.11](https://github.com/ExaDev/ooxml.js/compare/v2.6.10...v2.6.11) (2026-08-04)

## [2.6.10](https://github.com/ExaDev/ooxml.js/compare/v2.6.9...v2.6.10) (2026-08-03)

## [2.6.9](https://github.com/ExaDev/ooxml.js/compare/v2.6.8...v2.6.9) (2026-08-03)


### Bug Fixes

* **ci:** use pull_request_target so dependabot auto-merge can read secrets ([ce64ee5](https://github.com/ExaDev/ooxml.js/commit/ce64ee5d1cbd774695c5a65506c34fc0e5cf9d4a))

## [2.6.8](https://github.com/ExaDev/ooxml.js/compare/v2.6.7...v2.6.8) (2026-08-03)


### Bug Fixes

* **ci:** wait for a real check-run to register before requesting auto-merge ([af8b755](https://github.com/ExaDev/ooxml.js/commit/af8b755a789bbb6c32963579cc24375bdd920d0c))

## [2.6.7](https://github.com/ExaDev/ooxml.js/compare/v2.6.6...v2.6.7) (2026-08-03)


### Bug Fixes

* **ci:** use the GitHub App token for the branch push and PR creation too ([1072f1d](https://github.com/ExaDev/ooxml.js/commit/1072f1db3f366c32345641e32d1cf397f2bb5f5e))

## [2.6.6](https://github.com/ExaDev/ooxml.js/compare/v2.6.5...v2.6.6) (2026-08-03)


### Bug Fixes

* **ci:** wrap the sibling-bump commit body onto two lines under commitlint's limit ([dacd602](https://github.com/ExaDev/ooxml.js/commit/dacd602b81738dbe0c56c4423edc8d4ada232a0e))

## [2.6.5](https://github.com/ExaDev/ooxml.js/compare/v2.6.4...v2.6.5) (2026-08-03)

## [2.6.4](https://github.com/ExaDev/ooxml.js/compare/v2.6.3...v2.6.4) (2026-08-03)

## [2.6.3](https://github.com/ExaDev/ooxml.js/compare/v2.6.2...v2.6.3) (2026-08-03)

## [2.6.2](https://github.com/ExaDev/ooxml.js/compare/v2.6.1...v2.6.2) (2026-08-03)

## [2.6.1](https://github.com/ExaDev/ooxml.js/compare/v2.6.0...v2.6.1) (2026-08-02)

# [2.6.0](https://github.com/ExaDev/ooxml.js/compare/v2.5.2...v2.6.0) (2026-08-02)


### Features

* compose pptx shape rotation through rotated/flipped ancestor groups ([df654b5](https://github.com/ExaDev/ooxml.js/commit/df654b599f782dc4eced03e8cc5108d542d47fd4))
* **docx:** model word/numbering.xml abstractNum/num level definitions ([9720b6d](https://github.com/ExaDev/ooxml.js/commit/9720b6d02c165152fcced15d0f32be0621cad9f1))
* **docx:** read table cell borders; wire numbering into readDocx ([5f73bef](https://github.com/ExaDev/ooxml.js/commit/5f73bef21c065c0a162355c5e7d25d1a55f9338c))
* **docx:** resolve w:themeColor run colours against the theme scheme ([34fd0fc](https://github.com/ExaDev/ooxml.js/commit/34fd0fcf56a9812900767e26905b64417ad31a76))
* read docx inline and floating images into ContentImageBlock ([017e764](https://github.com/ExaDev/ooxml.js/commit/017e76407907be43b36ef9809b88ff161fdb5a9c))
* read xlsx number formats into percentage/currency/date/time cell kinds ([bfab9f9](https://github.com/ExaDev/ooxml.js/commit/bfab9f9087c03ed6f637996a3ce2273768503820))
* write real xlsx number formats for percentage/currency/date/time/boolean cells ([abb25d6](https://github.com/ExaDev/ooxml.js/commit/abb25d62d84b1a388f122cf3fd1630c2146529fc))

## [2.5.2](https://github.com/ExaDev/ooxml.js/compare/v2.5.1...v2.5.2) (2026-08-02)


### Bug Fixes

* adapt xlsx read/write to document-schema.js's breaking schema changes ([03c3155](https://github.com/ExaDev/ooxml.js/commit/03c3155edf4be51b8a0c8bc842ac078ede4c0e9d))

## [2.5.1](https://github.com/ExaDev/ooxml.js/compare/v2.5.0...v2.5.1) (2026-08-02)

# [2.5.0](https://github.com/ExaDev/ooxml.js/compare/v2.4.1...v2.5.0) (2026-08-02)


### Features

* build one file per module, add wildcard deep-import exports ([f9d6cb6](https://github.com/ExaDev/ooxml.js/commit/f9d6cb6fda3ea193c5d9b98bc679740f597f389c))

## [2.4.1](https://github.com/ExaDev/ooxml.js/compare/v2.4.0...v2.4.1) (2026-08-02)

# [2.4.0](https://github.com/ExaDev/ooxml.js/compare/v2.3.1...v2.4.0) (2026-08-02)


### Features

* ban anything but re-exports in src/index.ts ([6ada89f](https://github.com/ExaDev/ooxml.js/commit/6ada89fc6bb2815b75780ccd7a41d521c752db7f))

## [2.3.1](https://github.com/ExaDev/ooxml.js/compare/v2.3.0...v2.3.1) (2026-08-02)


### Bug Fixes

* don't flag or fix an alias whose source is mutated elsewhere ([84eaa69](https://github.com/ExaDev/ooxml.js/commit/84eaa6939411372654c7be50e94abe5973a77013))

# [2.3.0](https://github.com/ExaDev/ooxml.js/compare/v2.2.5...v2.3.0) (2026-08-02)


### Features

* add custom pointless-reassignment autofix rule, ban re-exports outside src/index.ts ([266cb37](https://github.com/ExaDev/ooxml.js/commit/266cb3785946d3c16f60683c0316b8bc6eb247af))

## [2.2.5](https://github.com/ExaDev/ooxml.js/compare/v2.2.4...v2.2.5) (2026-08-02)

## [2.2.4](https://github.com/ExaDev/ooxml.js/compare/v2.2.3...v2.2.4) (2026-08-01)

## [2.2.3](https://github.com/ExaDev/ooxml.js/compare/v2.2.2...v2.2.3) (2026-08-01)

## [2.2.2](https://github.com/ExaDev/ooxml.js/compare/v2.2.1...v2.2.2) (2026-08-01)

## [2.2.1](https://github.com/ExaDev/ooxml.js/compare/v2.2.0...v2.2.1) (2026-08-01)

# [2.2.0](https://github.com/ExaDev/ooxml.js/compare/v2.1.1...v2.2.0) (2026-08-01)


### Features

* add buildXlsxPackage, the first xlsx writer in this ecosystem ([bfa9473](https://github.com/ExaDev/ooxml.js/commit/bfa9473c17b9e244f093147d5cd78c90f36642e2))
* add readXlsxContent, a geometry-and-print-settings-rich xlsx reader ([102f1f9](https://github.com/ExaDev/ooxml.js/commit/102f1f943105465f5932877317d562ebe04a88fe))
* export readXlsxContent/buildXlsxPackage from the public API ([bfe282b](https://github.com/ExaDev/ooxml.js/commit/bfe282b85f08dc38e149af27c3969b7b35ccaa0b))

## [2.1.1](https://github.com/ExaDev/ooxml.js/compare/v2.1.0...v2.1.1) (2026-07-31)

# [2.1.0](https://github.com/ExaDev/ooxml.js/compare/v2.0.4...v2.1.0) (2026-07-31)


### Features

* assign sourcePath on readDocx/readPptx content in document order ([536ee59](https://github.com/ExaDev/ooxml.js/commit/536ee59efbf1cdc333fb7e4fb358dd7f2d9f874c))

## [2.0.4](https://github.com/ExaDev/ooxml.js/compare/v2.0.3...v2.0.4) (2026-07-31)

## [2.0.3](https://github.com/ExaDev/ooxml.js/compare/v2.0.2...v2.0.3) (2026-07-31)

## [2.0.2](https://github.com/ExaDev/ooxml.js/compare/v2.0.1...v2.0.2) (2026-07-31)

## [2.0.1](https://github.com/ExaDev/ooxml.js/compare/v2.0.0...v2.0.1) (2026-07-31)

# [2.0.0](https://github.com/ExaDev/ooxml.js/compare/v1.3.1...v2.0.0) (2026-07-31)


* feat!: resolve style/theme cascades into readDocx sections and readPptx shapes ([e37fb03](https://github.com/ExaDev/ooxml.js/commit/e37fb0342e0b432e70d9ae6ab24d13929024217a))


### Bug Fixes

* update smoke test to readDocx's sections/blocks shape ([da798d9](https://github.com/ExaDev/ooxml.js/commit/da798d913a6b7e11b96b08fbf9afe875b48bd554))


### Features

* add shared OOXML content model and geometry/colour/unit primitives ([8d032f0](https://github.com/ExaDev/ooxml.js/commit/8d032f04dc3c0a37fa3a091df498af46f887b09d))


### BREAKING CHANGES

* DocxDocument's shape changes from
{ paragraphs, tables, hyperlinks, comments, footnotes, headers, footers }
to { metadata, sections, comments, footnotes, headers, footers } --
sections' ordered ContentBlock[] supersedes the separate paragraphs/
tables arrays, and each run's own resolved hyperlink field supersedes
the flat hyperlinks array. PptxPresentation is renamed PptxDocument and
its shape changes from { slides: [{ index, text, shapes: [{ text }],
tables, notes }] } to { metadata, slides: [{ size, shapes: [{ name,
frame, rotationDeg, insets, blocks }], notes }] } — array position
supersedes the old index field, and each shape's own blocks (paragraphs/
tables/images) supersedes the separate flat shapes/tables arrays.

## [1.3.1](https://github.com/ExaDev/ooxml.js/compare/v1.3.0...v1.3.1) (2026-07-30)


### Bug Fixes

* stop readDocx paragraphs from duplicating table-cell paragraphs ([3215be4](https://github.com/ExaDev/ooxml.js/commit/3215be4f8ac8562655496e9f4878c2b37b3397f8))

# [1.3.0](https://github.com/ExaDev/ooxml.js/compare/v1.2.1...v1.3.0) (2026-07-30)


### Features

* export XML query helpers from typed/util for downstream packages ([5c39e48](https://github.com/ExaDev/ooxml.js/commit/5c39e48837ec7a192e2285bafd6c75994f31a17d))

## [1.2.1](https://github.com/ExaDev/ooxml.js/compare/v1.2.0...v1.2.1) (2026-07-30)


### Bug Fixes

* use the angular preset for release-notes-generator ([0ead019](https://github.com/ExaDev/ooxml.js/commit/0ead019e2e457d2d6cc0656e90d0d4c8af95294b))

# [1.2.0](https://github.com/ExaDev/ooxml.js/compare/v1.1.0...v1.2.0) (2026-07-30)


### Bug Fixes

* publish the GitHub Packages alias to its own registry ([c025b03](https://github.com/ExaDev/ooxml.js/commit/c025b03b7e0a22b2ca698609070dc04eb699fee1))


### Features

* derive commitlint's type-enum from release.config's commit types ([254f91c](https://github.com/ExaDev/ooxml.js/commit/254f91cf05e0def15f1542d49ecaf94f2b79e65e))

# [1.1.0](https://github.com/ExaDev/ooxml.js/compare/v1.0.0...v1.1.0) (2026-07-30)


### Features

* add ESLint and typescript-eslint, downgrading TypeScript to 6.x ([ea41494](https://github.com/ExaDev/ooxml.js/commit/ea4149448adb2c63479466207716492d027c7112))
* gate releases on a CI lint job ([482afd5](https://github.com/ExaDev/ooxml.js/commit/482afd5290eafc6e6765910aa1106661d40aed8d))

# 1.0.0 (2026-07-30)


### Bug Fixes

* load release config as plain JS, not TypeScript ([2e41a07](https://github.com/ExaDev/ooxml.js/commit/2e41a07f3f0985422b17ac775e822e93eae57cc0))
* preserve significant text whitespace in the XML parser ([3da5be1](https://github.com/ExaDev/ooxml.js/commit/3da5be1583a90c9bba96d655ccb30ea1e902e6f8))
* resolve CJS package types and add an ESM/CJS smoke test ([5d25ed2](https://github.com/ExaDev/ooxml.js/commit/5d25ed2d11f75fccbbc1338530f7f0fcd06c6284))


### Features

* add a direct bytes <-> CompactPackage codec ([d8e2336](https://github.com/ExaDev/ooxml.js/commit/d8e233600072300ebc218f4e3b094f8dbc488e4a))
* add CI workflow for release, GitHub Packages, and attestations ([1b396ae](https://github.com/ExaDev/ooxml.js/commit/1b396aef01fd5d48130f0aaad2bbde9595ae86e9))
* add lossless generic OOXML<->JSON package codec ([6913eb5](https://github.com/ExaDev/ooxml.js/commit/6913eb5daabc860c04ceb760cfd42da98966fd77))
* add the ooxml.js format (compact-JSON codec layer) ([8a03ce6](https://github.com/ExaDev/ooxml.js/commit/8a03ce6a1d8c76c13247e418c700c6c9cee3b744))
* automate releases and npm publishing with semantic-release ([a146766](https://github.com/ExaDev/ooxml.js/commit/a146766f876d5ac43c6c8af05ae96d6675d74515))
* **docx:** add docx typed projection reader ([5508daf](https://github.com/ExaDev/ooxml.js/commit/5508dafab6e69eaca2892f4a58cd9bc70ded1148))
* **docx:** expand typed reader with tables, hyperlinks, and metadata ([dbe4cec](https://github.com/ExaDev/ooxml.js/commit/dbe4cec226bfc5a73211d583a3dfac8224f4da49))
* export the expanded typed schemas and refresh the README ([ab10d3b](https://github.com/ExaDev/ooxml.js/commit/ab10d3b76ae49bc4f8dc3ad4b272a0c0f56d82a1))
* export typed readers from the package barrel ([20a8d6b](https://github.com/ExaDev/ooxml.js/commit/20a8d6bc59ef871dfa28fed1949f41d67c717a96))
* **pptx:** add pptx typed projection reader ([bc45fa3](https://github.com/ExaDev/ooxml.js/commit/bc45fa352278ca243141e1e7746f8b7f7af54ee5))
* **pptx:** expand typed reader with shapes, tables, and notes ([f4f18db](https://github.com/ExaDev/ooxml.js/commit/f4f18db46764d020831e187a7aa32258d97539e7))
* **test:** migrate smoke test to Vitest project ([f9ca35c](https://github.com/ExaDev/ooxml.js/commit/f9ca35c1f684d918ae66417b22c08e1f09d28428))
* **typed:** add a shared relationship resolver ([ffd3c74](https://github.com/ExaDev/ooxml.js/commit/ffd3c7456fd9aad2360a26a9b3a24d81fad50f80))
* **xlsx:** add xlsx typed projection reader ([b7293bb](https://github.com/ExaDev/ooxml.js/commit/b7293bb8f005e7e5f4927403aa9949c63f91f081))
* **xlsx:** expand typed reader with formulas, merges, and defined names ([a650a48](https://github.com/ExaDev/ooxml.js/commit/a650a48d135982cf1f90dc4f3da4d26766633e85))
