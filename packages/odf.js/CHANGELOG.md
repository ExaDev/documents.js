## [11.0.1](https://github.com/ExaDev/documents.js/compare/odf.js%4011.0.0...odf.js%4011.0.1) (2026-09-22)

### Bug Fixes

* **workspace:** replace the spaced double-hyphen dash substitute with a real em-dash workspace-wide ([c42a9c7](https://github.com/ExaDev/documents.js/commit/c42a9c7e0bc7cd87456ca72204a5ac423a7ca341))


### Dependencies

- Updated byte-codec to 1.8.1
- Updated document-schema.js to 7.14.1

## [11.0.0](https://github.com/ExaDev/documents.js/compare/odf.js%4010.0.0...odf.js%4011.0.0) (2026-09-21)

### ⚠ BREAKING CHANGES

* **odf.js:** an odt, odp or odg table whose rows carry isHeader
  now writes a table:table-header-rows wrapper around each run of them,
  where every row was previously a direct table:table-row child of the
  table:table. A table whose rows state no header flag writes byte
  identically to before.

### Features

* **odf.js:** read and write table:table-header-rows as per-row header flags ([0dadbf5](https://github.com/ExaDev/documents.js/commit/0dadbf55092d9801ce172a35401e8e44f92fcf3f)), references [#1377](https://github.com/ExaDev/documents.js/issues/1377)


### Dependencies

- Updated byte-codec to 1.8.0
- Updated document-schema.js to 7.14.0

## [10.0.0](https://github.com/ExaDev/documents.js/compare/odf.js%409.0.0...odf.js%4010.0.0) (2026-09-21)

### ⚠ BREAKING CHANGES

* **odf.js:** a ContentTable violating the grid rule stated on ContentTableCell
  is now refused rather than written with the offending content silently dropped. A
  caller building a table by hand must give every row one cell per grid column, keep
  a merged region's content on its anchor, and state each span once, on the anchor.

### Bug Fixes

* **odf.js:** refuse a table that breaks the grid rule rather than writing past it ([f5a254c](https://github.com/ExaDev/documents.js/commit/f5a254c87a19839b918c9f9cf777aec023210f2f))


### Dependencies

- Updated document-schema.js to 7.13.0

## [9.0.0](https://github.com/ExaDev/documents.js/compare/odf.js%408.0.3...odf.js%409.0.0) (2026-09-21)

### ⚠ BREAKING CHANGES

* **odf.js:** a table whose rows or columns sit inside a header or group wrapper
  now reads back with those rows and columns present, so a consumer indexing rows or
  columnWidthsPt sees a different shape for exactly the documents that were being
  read wrongly before. Cells stating a vertical alignment now carry verticalAlign.

### Bug Fixes

* **odf.js:** read a table's grouped rows and columns, and a cell's vertical alignment ([4575ad2](https://github.com/ExaDev/documents.js/commit/4575ad25031f72abd26078497d41889e6485b2a4))

## [8.0.3](https://github.com/ExaDev/documents.js/compare/odf.js%408.0.2...odf.js%408.0.3) (2026-09-21)


### Dependencies

- Updated byte-codec to 1.7.0

## [8.0.2](https://github.com/ExaDev/documents.js/compare/odf.js%408.0.1...odf.js%408.0.2) (2026-09-21)

### Bug Fixes

* **odf.js:** derive a table's covered positions from the anchors' spans and keep their decoration ([dd2796e](https://github.com/ExaDev/documents.js/commit/dd2796eff88262df05533c5267b4871dea8cf36e))


### Dependencies

- Updated document-schema.js to 7.12.0

## [8.0.1](https://github.com/ExaDev/documents.js/compare/odf.js%408.0.0...odf.js%408.0.1) (2026-09-20)

### Documentation

* make a hand-typed scoped mutation run find its package's Stryker config ([ed3297b](https://github.com/ExaDev/documents.js/commit/ed3297b6aa71b2d94913519e6960537ca5ac0f61))


### Dependencies

- Updated byte-codec to 1.6.3
- Updated document-schema.js to 7.11.5

## [8.0.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.25.7...odf.js%408.0.0) (2026-09-20)

### ⚠ BREAKING CHANGES

* **odf.js:** The odf.js/util/base64 deep import is removed.
  bytesToBase64 and base64ToBytes come from byte-codec now, and are
  still on this package's own barrel as well. The removal already
  shipped, unmarked, in 7.25.7.

### Documentation

* **odf.js:** state that base64 moved out of src/util ([30a1fe4](https://github.com/ExaDev/documents.js/commit/30a1fe40b2aaa0098844630d1afb776719e549e1))


### Dependencies

- Updated byte-codec to 1.6.2

## [7.25.7](https://github.com/ExaDev/documents.js/compare/odf.js%407.25.6...odf.js%407.25.7) (2026-09-20)

### Code Refactoring

* **odf.js:** encode and decode base64 through byte-codec ([771392d](https://github.com/ExaDev/documents.js/commit/771392dbc945a23129dae3f90853d110517e31d0))


### Dependencies

- Updated byte-codec to 1.6.1

## [7.25.6](https://github.com/ExaDev/documents.js/compare/odf.js%407.25.5...odf.js%407.25.6) (2026-09-20)


### Dependencies

- Updated document-schema.js to 7.11.4

## [7.25.5](https://github.com/ExaDev/documents.js/compare/odf.js%407.25.4...odf.js%407.25.5) (2026-09-16)

### Bug Fixes

* **odf.js:** clamp skipExpression's index advances to text.length ([9773eed](https://github.com/ExaDev/documents.js/commit/9773eed670d64baf653cd5dd0ca1aec982dfcafa))
* **odf.js:** drop parseLineDecoration's hardcoded no-op companion placeholder ([edec55c](https://github.com/ExaDev/documents.js/commit/edec55c5fd7eb0025550b98d9c3ce2b5dcb3ac46))
* **odf.js:** materialise a cell for an embedded-object-only anchor position ([89c1356](https://github.com/ExaDev/documents.js/commit/89c1356292c16e1c167f59842a58fa8567d7f8c2))
* **odf.js:** supply the required frame field in embedded-write's own tests ([f1f0111](https://github.com/ExaDev/documents.js/commit/f1f011193c1639c3a5af7b092f43b580e5374e91))

### Code Refactoring

* **odf.js:** compute the used range's max row/column via Math.max ([75d2eee](https://github.com/ExaDev/documents.js/commit/75d2eee79091dcb38286d67d7588cc52c1f9e45e))
* **odf.js:** remove reverse-direction branches the caller's own guard already makes redundant ([1bf9e4f](https://github.com/ExaDev/documents.js/commit/1bf9e4f4f000e7b020ff3cc58f93bb525e297168))
* **odf.js:** remove two unobservable branches from draw/shapes.ts ([0f53ec7](https://github.com/ExaDev/documents.js/commit/0f53ec7893dd24bba670c53270feb2f6b58abc96))
* **odf.js:** share one file-entry parse between readManifest and validateManifest ([0d2ff35](https://github.com/ExaDev/documents.js/commit/0d2ff35889efa8a89271546b599396feac9ba95b))
* **odf.js:** simplify insertOdfConstructMarkers and export isEmbeddedObjectPart ([5ff64c4](https://github.com/ExaDev/documents.js/commit/5ff64c4eab5beadd9fc7f759bb9a7a2843e43685))
* **odf.js:** simplify transform.ts's colon check and drop a redundant self-mapping guard ([c4e8331](https://github.com/ExaDev/documents.js/commit/c4e8331e7b1127902f69c2b905a66d7946064cd7))

### Documentation

* **odf.js:** correct the mutation gap numbers to the CI-confirmed measurement ([4a4dcf6](https://github.com/ExaDev/documents.js/commit/4a4dcf65acd8f340d75131c195df4629417658d3))
* **odf.js:** note ooo1/transform.ts's zero survivors in the breakThreshold comment ([eb3a9e6](https://github.com/ExaDev/documents.js/commit/eb3a9e65eae6e449c7b3ddeca1d05182e8cc4461))
* **odf.js:** note shared/constructs.ts's zero survivors in the breakThreshold comment ([d56da80](https://github.com/ExaDev/documents.js/commit/d56da8022b9f2c44f574ecce255e0203893f4def))
* **odf.js:** raise the mutation break threshold to the re-measured floor ([d116e25](https://github.com/ExaDev/documents.js/commit/d116e25fba130421fa871fb47cbb337ded44c4db))

### Tests

* **odf.js:** add direct unit coverage for canonicalRun ([8b96fae](https://github.com/ExaDev/documents.js/commit/8b96fae267bcc1e2bc657951fd8050b0ffdf1ad4))
* **odf.js:** add direct unit coverage for typed/shared/constructs.ts ([8f50edd](https://github.com/ExaDev/documents.js/commit/8f50edd7c93cada550ade8969315e62fb9779241))
* **odf.js:** add direct XML-structure coverage for odb/write.ts ([ad23427](https://github.com/ExaDev/documents.js/commit/ad23427c417ae987af5c3ca53d85be9460793074))
* **odf.js:** add the first direct unit coverage for image/sniff.ts ([7803ff7](https://github.com/ExaDev/documents.js/commit/7803ff70cf396f14feaa667e3a3d31e12fa7e0fa))
* **odf.js:** add the first direct unit coverage for model/node.ts ([2e84335](https://github.com/ExaDev/documents.js/commit/2e84335c0aaf1a9be76d8854cd850231c80e3a20))
* **odf.js:** add the first direct unit coverage for ooo1/properties.ts ([4ac9c6b](https://github.com/ExaDev/documents.js/commit/4ac9c6bf0f3cf706fe200afd0d45b74aeacae1d3))
* **odf.js:** add the first direct unit coverage for package-io/scaffold.ts ([8362fee](https://github.com/ExaDev/documents.js/commit/8362fee970680d938deb4f38e1e64d5c2ecdb337))
* **odf.js:** add the first direct unit coverage for package-io/write.ts ([cb98149](https://github.com/ExaDev/documents.js/commit/cb98149719123d98233c34853b57299403c7a94e))
* **odf.js:** add the first direct unit coverage for typed/draw/embedded-write.ts ([bdb280c](https://github.com/ExaDev/documents.js/commit/bdb280c33b8d1e17a1188158d51e98e4c53c6644))
* **odf.js:** add the first direct unit coverage for typed/draw/write-shapes.ts ([ceb9927](https://github.com/ExaDev/documents.js/commit/ceb9927fa1662930aab0d02714c96747e28013eb))
* **odf.js:** add the first direct unit coverage for typed/draw/write-vectors.ts ([0cbf627](https://github.com/ExaDev/documents.js/commit/0cbf627e0982238a0029fc87432b88d04ba373f3))
* **odf.js:** add the first direct unit coverage for typed/shared/border.ts ([fcf7cbc](https://github.com/ExaDev/documents.js/commit/fcf7cbca02753e7461ee8b5c8cfda4b55d5d14af))
* **odf.js:** add the first direct unit coverage for typed/shared/expression.ts ([7fa6392](https://github.com/ExaDev/documents.js/commit/7fa63922835b50f55fca5fd91b50a36e983266f2))
* **odf.js:** add the first direct unit coverage for typed/shared/forms.ts ([0ac45d2](https://github.com/ExaDev/documents.js/commit/0ac45d24c78076e221ffe31005a13b48ea85b6cb))
* **odf.js:** add the first direct unit coverage for typed/shared/image.ts ([b754977](https://github.com/ExaDev/documents.js/commit/b7549778be92d0a529fead9a469b7af65228bc97))
* **odf.js:** add the first direct unit coverage for typed/shared/list.ts ([0e5628f](https://github.com/ExaDev/documents.js/commit/0e5628f79b4c8bbf4cbff998118bb588e1e11229))
* **odf.js:** add the first direct unit coverage for util/base64.ts ([733c15e](https://github.com/ExaDev/documents.js/commit/733c15e5ef9c1d1e2e04fe2d3348b0f5b5cd2692))
* **odf.js:** add the first direct unit coverage for xml/build.ts ([90adfac](https://github.com/ExaDev/documents.js/commit/90adfac37d2d903e5d994776762b44c5bc9e2073))
* **odf.js:** add the first direct unit coverage for xml/parse.ts ([a7b03f1](https://github.com/ExaDev/documents.js/commit/a7b03f132b522bd41fdca4b614e5e9850bea5f24))
* **odf.js:** cover columnLettersToIndex and TableCursor's own error text ([fa76401](https://github.com/ExaDev/documents.js/commit/fa764013822b7d1faea1e036ae2e569dbb26bf58))
* **odf.js:** cover data validation message and interning branches ([4bc2337](https://github.com/ExaDev/documents.js/commit/4bc233768074404849678e9144cba31ebe917f3b))
* **odf.js:** cover dataBar's unset showValue and an empty conditionalFormats array ([a4b1096](https://github.com/ExaDev/documents.js/commit/a4b109664bbfe52dce4b9b3e4f17981369afb729))
* **odf.js:** cover formatServerDatabaseUrl's missing db:type branch ([662c6e0](https://github.com/ExaDev/documents.js/commit/662c6e01664d40eec17a210acb6be967dcce7155))
* **odf.js:** cover ods write's used-range extension and validation deduping ([0246f7d](https://github.com/ExaDev/documents.js/commit/0246f7d20d6a9076de172bc807b60a6a3add0a0b))
* **odf.js:** cover paragraph.ts's note/annotation sequential minting ([7fc9abb](https://github.com/ExaDev/documents.js/commit/7fc9abbfbea9301533ee8d10fff59334fb1c23fd))
* **odf.js:** cover parseOdfAngleDeg, isLengthUnit and expandExponential directly ([9b5d145](https://github.com/ExaDev/documents.js/commit/9b5d145de1d3191689c200c4b524e4e521685146))
* **odf.js:** cover propertyTypesForContainer and splitStyleProperties edge cases ([dadb7d6](https://github.com/ExaDev/documents.js/commit/dadb7d66584adbdb46347050e161c625b422a5d4))
* **odf.js:** cover readOdbInventory's remaining connection/component/table gaps ([316b6f9](https://github.com/ExaDev/documents.js/commit/316b6f950ced96602c5510c6e3cc679607287138))
* **odf.js:** cover sheetCellStyle's decoration-present and no-decoration branches ([90434dc](https://github.com/ExaDev/documents.js/commit/90434dcafbbefafed1147eb159e39de3165d7aad))
* **odf.js:** cover transform.ts's carriesNoLength, href, and reverse-direction gaps ([34c8310](https://github.com/ExaDev/documents.js/commit/34c8310d9ab4b2ba17efb1b9a5320ce8fb7044b3))
* **odf.js:** cover transform.ts's classAttributeName and remaining reverse-direction gaps ([1c44b5f](https://github.com/ExaDev/documents.js/commit/1c44b5f6b19844eb7aa7e17b7c93d05128ca6ac0))
* **odf.js:** cover typed/shared/constructs.ts's remaining no-coverage branches ([07d9b4e](https://github.com/ExaDev/documents.js/commit/07d9b4e628912e8b328e7842a2153394bf31b2ac))
* **odf.js:** cover typed/shared/table.ts's read/write decoration and write-side paths ([c1367bc](https://github.com/ExaDev/documents.js/commit/c1367bc58ffefde24c631fe009f7902c47b38155))
* **odf.js:** cover unsupportedConditionalFormatReason's refusal branches ([225e5e6](https://github.com/ExaDev/documents.js/commit/225e5e64bdfa62046253459f98988cb7b6515155))
* **odf.js:** cover writeSheetEmbeddedObjectFrame's own sequential z-index ([b5812b2](https://github.com/ExaDev/documents.js/commit/b5812b22080139a8f8a87fce176d2809011b2b43))
* **odf.js:** fix ContentControlDescriptor fixture's controlType value ([573a053](https://github.com/ExaDev/documents.js/commit/573a053554efa51a3fe7030e6212b9273a435b4c))
* **odf.js:** fix invalid fixture values in canonical* unit tests ([8d21d52](https://github.com/ExaDev/documents.js/commit/8d21d52ef319e8f6c214323ee22faa6781671252))
* **odf.js:** give the BOM check its own testable function in parsePackage's XML sniff ([643b011](https://github.com/ExaDev/documents.js/commit/643b011c6620881ac497c420acc18918df04b220))
* **odf.js:** kill canonicalise.ts's undefined-key and coverage survivors ([9d30613](https://github.com/ExaDev/documents.js/commit/9d30613a1f36f76a9ffc6658bfe2212a2773a424))
* **odf.js:** kill every mutant in test-support/document-tree.ts's helpers ([b4409f2](https://github.com/ExaDev/documents.js/commit/b4409f2565dc482b674fbaf2b1c50134b8b7e534))
* **odf.js:** kill every mutant in test-support/zip.ts's LE integer readers ([f7235a5](https://github.com/ExaDev/documents.js/commit/f7235a53a110cf38984253a0707da68b800c6f65))
* **odf.js:** kill isXmlNode's unrecognised-type and typeof survivors ([5817c0d](https://github.com/ExaDev/documents.js/commit/5817c0dd06960438bb39c9c2778b65f5de314a90))
* **odf.js:** kill odb write's xlink:type and version-fallback survivors ([a068863](https://github.com/ExaDev/documents.js/commit/a068863dcef65602c7ba5ea73299eecdfe50c221))
* **odf.js:** kill ooo1/ns.ts's remaining survivors ([0b986a0](https://github.com/ExaDev/documents.js/commit/0b986a0314d0451a5368963489217b1a59db8fdc))
* **odf.js:** kill package-io/write.ts's remaining survivor ([dda34d9](https://github.com/ExaDev/documents.js/commit/dda34d9e62644964e3f0c31dbe8c3e0dd9d51d96))
* **odf.js:** kill readCondition's remaining rank-branch survivors ([354fdce](https://github.com/ExaDev/documents.js/commit/354fdced858b38b38f0ae8a48c41de2f0a935460))
* **odf.js:** kill styles/registry.ts's redundant-guard and undercovered mutants ([28cc514](https://github.com/ExaDev/documents.js/commit/28cc5146585c8b7c7c623a596cefcb7ddf9e387d))
* **odf.js:** kill styles/serialize.ts's remaining survivor ([941e4a9](https://github.com/ExaDev/documents.js/commit/941e4a9457113fb195a89e6392d0df1c5257596b))
* **odf.js:** kill styles/span.ts's redundant-guard and undercovered mutants ([9d65c82](https://github.com/ExaDev/documents.js/commit/9d65c82eff519653610885cde68b20d68794272c))
* **odf.js:** kill the last two typed/shared/transform.ts survivors ([703bcde](https://github.com/ExaDev/documents.js/commit/703bcdea1b1034d52c61ceabdb9f9df01cb9e365))
* **odf.js:** kill typed/draw/embedded.ts's remaining survivors ([ad183d1](https://github.com/ExaDev/documents.js/commit/ad183d13e5ce2c7264e01be4b652af7caabcb8a8))
* **odf.js:** kill typed/draw/shapes.ts's remaining survivors ([7a3d6a5](https://github.com/ExaDev/documents.js/commit/7a3d6a58be2056847fc97048b88214e29f51c4ca))
* **odf.js:** kill typed/formula/read.ts's remaining survivor ([5ba3798](https://github.com/ExaDev/documents.js/commit/5ba3798d73cc1739f935a243574e5200daf03703))
* **odf.js:** kill typed/formula/write.ts's remaining survivors ([66533a9](https://github.com/ExaDev/documents.js/commit/66533a921e9c1b4478d6827fd2a578f23b027724))
* **odf.js:** kill typed/odb/subdocument.ts's remaining survivor ([20ae129](https://github.com/ExaDev/documents.js/commit/20ae12987949e5eca2c493b10a749c7717937607))
* **odf.js:** kill typed/odg/read.ts's remaining survivors ([1b6cc36](https://github.com/ExaDev/documents.js/commit/1b6cc36c6decc69ad209b564df1e31b9794ebc30))
* **odf.js:** kill typed/odg/write.ts's remaining survivors ([82fbdc3](https://github.com/ExaDev/documents.js/commit/82fbdc3b73aacfe3abccba6217d3704a135b0a32))
* **odf.js:** kill typed/odm/read.ts's remaining survivor ([992383a](https://github.com/ExaDev/documents.js/commit/992383a2e963c4ef571f9d0ec6c365a9fcaf10e8))
* **odf.js:** kill typed/odm/read.ts's remaining tag-check survivor ([95a026e](https://github.com/ExaDev/documents.js/commit/95a026e24dd0dc0ff5d75b15f9d3d27153c4b7ff))
* **odf.js:** kill typed/odm/write.ts's remaining survivors ([ea578cf](https://github.com/ExaDev/documents.js/commit/ea578cfdafa83165e86d9937b2ac0ee38e234314))
* **odf.js:** kill typed/odp/read.ts's remaining survivors ([e1bba9e](https://github.com/ExaDev/documents.js/commit/e1bba9ec06393592b4b7e096b90b996b334222e4))
* **odf.js:** kill typed/shared/cascade.ts's remaining survivors ([ada6f55](https://github.com/ExaDev/documents.js/commit/ada6f55ef505bcf78cb688113ecacc1c3b9cd987))
* **odf.js:** kill typed/shared/constructs.ts's remaining survivors ([4ba0dea](https://github.com/ExaDev/documents.js/commit/4ba0dead590229d53fb6eb78deba38b64feaa180))
* **odf.js:** kill typed/shared/expression.ts's remaining survivor ([f93651f](https://github.com/ExaDev/documents.js/commit/f93651fa164dc86d0286dacd6584899c230acb36))
* **odf.js:** kill typed/shared/list.ts's remaining survivors ([b8fad19](https://github.com/ExaDev/documents.js/commit/b8fad192360e2a420e942f605ef6999412094a43))
* **odf.js:** kill typed/shared/masterpage.ts's remaining survivors ([3e8ae24](https://github.com/ExaDev/documents.js/commit/3e8ae24c3d1fab3397b4f7016472097088609ba4))
* **odf.js:** kill typed/shared/metadata.ts's remaining survivors ([7c67c03](https://github.com/ExaDev/documents.js/commit/7c67c0343036dff593bb66c4fdce9fb8e4f23b5a))
* **odf.js:** kill typed/shared/text.ts's remaining survivors ([f510294](https://github.com/ExaDev/documents.js/commit/f5102942eefc9d721a35a405c1e1c7fd682a3e15))
* **odf.js:** kill typed/shared/transform.ts's remaining survivors ([f3ca4c3](https://github.com/ExaDev/documents.js/commit/f3ca4c3a7204438a24b11ea19fe13c0f39e0e6c7))
* **odf.js:** kill typed/shared/units.ts's remaining survivors ([7988102](https://github.com/ExaDev/documents.js/commit/7988102350c177c4f14798e749ffd49eebd0952f))
* **odf.js:** kill util/base64.ts's remaining bytesToBase64 survivors ([69031fe](https://github.com/ExaDev/documents.js/commit/69031fede9b690d8255028506b1b538250b19734))
* **odf.js:** kill write-vectors.ts's stroke, height, and rotation survivors ([1a4c890](https://github.com/ExaDev/documents.js/commit/1a4c8906990025cdd8a0eebaadab5bf8efc84167))
* **odf.js:** kill xml/build.ts's remaining survivors ([8ce6335](https://github.com/ExaDev/documents.js/commit/8ce633577d91cfb4742153529bb687c5d3e7ea73))
* **odf.js:** pin columnLettersToIndex's uppercase-only guard against mixed case ([6d3d4d0](https://github.com/ExaDev/documents.js/commit/6d3d4d0320421dd6c79ff10bfebd147fa26156f8))
* **odf.js:** pin ods writer cell-run, cell-value, and canonicaliser boundaries ([c8eef6f](https://github.com/ExaDev/documents.js/commit/c8eef6ffa6b4aa21a9a87930e90b790a6c5e43d4))
* **odf.js:** pin regular-polygon/rounded-rect geometry and per-vector-kind fill fields ([b90f914](https://github.com/ExaDev/documents.js/commit/b90f914546e6d2b937a2b9901ad9a335f852104c))
* **odf.js:** pin that only the mimetype entry is stored uncompressed ([815d98d](https://github.com/ExaDev/documents.js/commit/815d98d65bd5aed256d26d5d0b673dee6e21da0f))
* **odf.js:** pin the shared canonicalise.ts helpers directly, and drop two dead closeListPlan calls ([158fd96](https://github.com/ExaDev/documents.js/commit/158fd965875ff7e7ebe0e366622dd79d975564e9))
* **odf.js:** reach 100% mutation coverage on typed/odb/report.ts ([8907cb1](https://github.com/ExaDev/documents.js/commit/8907cb1ddb6558edfc52507dcccf7c128431cced))
* **odf.js:** reach 100% mutation coverage on typed/ods/conditional-format.ts ([efb6b73](https://github.com/ExaDev/documents.js/commit/efb6b73cbd348a59583d631e5cd3ef72a7b25ece))
* **odf.js:** reach 100% mutation coverage on typed/ods/data-validation.ts ([3467090](https://github.com/ExaDev/documents.js/commit/3467090f077165bed4e05637e8a03c0facc26147))
* **odf.js:** recompute readOdbInventory fresh per test and cover its remaining branches ([c3f9b95](https://github.com/ExaDev/documents.js/commit/c3f9b95b82ac3bf09563945a24c39d4780f0a23d))
* **odf.js:** use toStrictEqual for canonicalRun/canonicalCell's own optional fields ([610157a](https://github.com/ExaDev/documents.js/commit/610157abf3db293f34a6cf839c2ac5b92d62d659))
* **odf.js:** use toStrictEqual throughout the ods canonical* helpers block ([2fa1a12](https://github.com/ExaDev/documents.js/commit/2fa1a123941e55f78a22bcf5530e3bfe0a0c1c65))

### Miscellaneous Chores

* **odf.js:** raise the mutation break threshold to the re-measured floor ([3a13fc4](https://github.com/ExaDev/documents.js/commit/3a13fc4262a276e4af1982c84e4743f814726c40))

## [7.25.4](https://github.com/ExaDev/documents.js/compare/odf.js%407.25.3...odf.js%407.25.4) (2026-09-14)

### Miscellaneous Chores

* bump pinned pnpm to 12.4.1 across the workspace ([4e81c2d](https://github.com/ExaDev/documents.js/commit/4e81c2dfdb08fff226c20a0f267baffa87758e0f))
* **lint:** except each package's own measured eslint-config 2.12.1 debt ([11c35bc](https://github.com/ExaDev/documents.js/commit/11c35bc61db74c68b4be725c34452509fba00c2a))


### Dependencies

- Updated document-schema.js to 7.11.3

## [7.25.3](https://github.com/ExaDev/documents.js/compare/odf.js%407.25.2...odf.js%407.25.3) (2026-09-13)


### Dependencies

- Updated document-schema.js to 7.11.2

## [7.25.2](https://github.com/ExaDev/documents.js/compare/odf.js%407.25.1...odf.js%407.25.2) (2026-09-11)

### Bug Fixes

* **odf.js:** keep the pinned zip entry mtime inside fflate's valid DOS-date range ([387fb31](https://github.com/ExaDev/documents.js/commit/387fb31073b21c56538ca7419a2c55f3a69942a8))

## [7.25.1](https://github.com/ExaDev/documents.js/compare/odf.js%407.25.0...odf.js%407.25.1) (2026-09-11)

### Code Refactoring

* load stryker.config.ts directly instead of a jiti .mjs bootstrap ([4221520](https://github.com/ExaDev/documents.js/commit/42215205caa1c8fc6368ed38729d15836bdd613b))


### Dependencies

- Updated document-schema.js to 7.11.1

## [7.25.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.24.5...odf.js%407.25.0) (2026-09-11)

### Features

* **ci:** gate each measured package on its first CI mutation baseline ([9f8fa69](https://github.com/ExaDev/documents.js/commit/9f8fa6947795b2089bed03c936691893643ce2ae))


### Dependencies

- Updated document-schema.js to 7.11.0

## [7.24.5](https://github.com/ExaDev/documents.js/compare/odf.js%407.24.4...odf.js%407.24.5) (2026-09-11)


### Dependencies

- Updated document-schema.js to 7.10.0

## [7.24.4](https://github.com/ExaDev/documents.js/compare/odf.js%407.24.3...odf.js%407.24.4) (2026-09-11)


### Dependencies

- Updated document-schema.js to 7.9.1

## [7.24.3](https://github.com/ExaDev/documents.js/compare/odf.js%407.24.2...odf.js%407.24.3) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.9.0

## [7.24.2](https://github.com/ExaDev/documents.js/compare/odf.js%407.24.1...odf.js%407.24.2) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.8.0

## [7.24.1](https://github.com/ExaDev/documents.js/compare/odf.js%407.24.0...odf.js%407.24.1) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.7.0

## [7.24.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.23.2...odf.js%407.24.0) (2026-09-10)

### Features

* **odf.js:** read and write embedded objects in odp and odg shapes ([d9ab9d7](https://github.com/ExaDev/documents.js/commit/d9ab9d7d000bb00f401e1aa4e53b6cd0b400d296))

## [7.23.2](https://github.com/ExaDev/documents.js/compare/odf.js%407.23.1...odf.js%407.23.2) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.6.1

## [7.23.1](https://github.com/ExaDev/documents.js/compare/odf.js%407.23.0...odf.js%407.23.1) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.6.0

## [7.23.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.22.0...odf.js%407.23.0) (2026-09-10)

### Features

* **odf.js:** write run-level construct extents in table cells and shape text ([487af6e](https://github.com/ExaDev/documents.js/commit/487af6e36a51b865a9d6749e9c234ffaf9535d8f))

## [7.22.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.21.0...odf.js%407.22.0) (2026-09-09)

### Features

* **odf.js:** write embedded sub-documents in the ods writer ([6e34bb8](https://github.com/ExaDev/documents.js/commit/6e34bb8d758e3675673be9cff8c9d9305813a3d9)), references [#1159](https://github.com/ExaDev/documents.js/issues/1159)

## [7.21.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.20.0...odf.js%407.21.0) (2026-09-09)

### Features

* **odf.js:** write block-scope comment ranges ([bb65c7c](https://github.com/ExaDev/documents.js/commit/bb65c7c89ab7d0705a1a9406fe25bb53d303297c)), references [#969](https://github.com/ExaDev/documents.js/issues/969) [#972](https://github.com/ExaDev/documents.js/issues/972)
* **odf.js:** write embedded sub-documents in the odt writer ([fe399eb](https://github.com/ExaDev/documents.js/commit/fe399eb15a86c599a9f1e9a5a927ed5060652f71)), references [#972](https://github.com/ExaDev/documents.js/issues/972) [#719](https://github.com/ExaDev/documents.js/issues/719)
* **odf.js:** write run-level construct extents in odp and odg shape text ([708f5f4](https://github.com/ExaDev/documents.js/commit/708f5f4657075940bddbd107ac9e5f3db69f645f))

## [7.20.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.19.0...odf.js%407.20.0) (2026-09-09)

### Features

* **odf.js:** write block-scope comment ranges ([627e9ce](https://github.com/ExaDev/documents.js/commit/627e9ceb466cc7ee7dc263e51f7c8111dfe4f400)), references [#969](https://github.com/ExaDev/documents.js/issues/969) [#972](https://github.com/ExaDev/documents.js/issues/972)

## [7.19.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.18.0...odf.js%407.19.0) (2026-09-09)

### Features

* **documents.js:** write non-formula embedded objects in the editors ([644d5eb](https://github.com/ExaDev/documents.js/commit/644d5ebdc6c33d0172dadb11e5d137ce03ecd7a3))
* **odf.js:** write embedded sub-documents in the odt writer ([1f72005](https://github.com/ExaDev/documents.js/commit/1f72005c6a31742c8ef5a1f25f2c3fbdece00389)), references [#972](https://github.com/ExaDev/documents.js/issues/972) [#719](https://github.com/ExaDev/documents.js/issues/719)

### Bug Fixes

* **odf.js:** drop the per-object manifest sync from the embedded writer ([5a20968](https://github.com/ExaDev/documents.js/commit/5a209685a50f160cf0b14d4140fc7fef695f225e))

### Tests

* **odf.js:** keep the embedded round-trip test beside the block-range suite after the rebase ([9571d36](https://github.com/ExaDev/documents.js/commit/9571d362f65470d9000f1af2d7c6603d987795da))

## [7.18.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.17.0...odf.js%407.18.0) (2026-09-09)

### Features

* **odf.js:** write block-scope tracked-change ranges ([d939751](https://github.com/ExaDev/documents.js/commit/d93975174bc735f48d20c941e9b57818ce6bb88d))

### Bug Fixes

* **odf.js:** encode the tracked-change author and date on write ([f26f98e](https://github.com/ExaDev/documents.js/commit/f26f98e7fb6333b1f62b8cedf6d7f96e7faf8e26))

## [7.17.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.16.0...odf.js%407.17.0) (2026-09-09)

### Features

* **odf.js:** write tracked-change extents with their region container ([1bb8b8d](https://github.com/ExaDev/documents.js/commit/1bb8b8dd0d42c81e108b8b74d68e59fa80e9e79f))

## [7.16.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.15.0...odf.js%407.16.0) (2026-09-09)

### Features

* **odf.js:** write comment anchors from their definitions bodies ([aea864b](https://github.com/ExaDev/documents.js/commit/aea864bd218a4162cd95bc0ae1f842a342557f88))

## [7.15.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.14.0...odf.js%407.15.0) (2026-09-09)

### Features

* **odf.js:** write footnote and endnote anchors from their definitions bodies ([3b0ed8b](https://github.com/ExaDev/documents.js/commit/3b0ed8becf0b9cda59d63a3bbaa51a94fc02fee1))

### Bug Fixes

* **odf.js:** refuse cyclic note definitions before recursive writes ([a1f0c35](https://github.com/ExaDev/documents.js/commit/a1f0c3574b499b9ecd193c0ec1826ab326dc3aa6))

## [7.14.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.13.0...odf.js%407.14.0) (2026-09-09)

### Features

* **odf.js:** write block-scope bookmark ranges in the odt writer ([77c45fc](https://github.com/ExaDev/documents.js/commit/77c45fc88dc837872ea888397075bc9eb9dc97ee)), references [#972](https://github.com/ExaDev/documents.js/issues/972)

## [7.13.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.12.0...odf.js%407.13.0) (2026-09-09)

### Features

* **odf.js:** write .odb database front-end definitions ([276364c](https://github.com/ExaDev/documents.js/commit/276364cb5de2b7c5b3c75bae1ab6410888f26070))

## [7.12.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.11.0...odf.js%407.12.0) (2026-09-09)

### Features

* **odf.js:** write .odf formula documents ([2162a05](https://github.com/ExaDev/documents.js/commit/2162a054962c960d2be7b309a9f4d1e2b6ac9846))
* **odf.js:** write .odm master documents ([73b5853](https://github.com/ExaDev/documents.js/commit/73b58530917e0b8eac86fe4be58bc08c28e531d5))

## [7.11.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.10.0...odf.js%407.11.0) (2026-09-08)

### Features

* **odf.js:** synthesise validation conditions and calcext values on the write side ([e9d3139](https://github.com/ExaDev/documents.js/commit/e9d3139dbca6fd9eb873d0a92d845106d5ae6d8b))
* **odf.js:** write ods data-validation and conditional-formatting rules ([a8205f6](https://github.com/ExaDev/documents.js/commit/a8205f653b297cdb409b45e0c88f544002e22d92)), references [#925](https://github.com/ExaDev/documents.js/issues/925) [#1075](https://github.com/ExaDev/documents.js/issues/1075)

### Bug Fixes

* **odf.js:** keep conditional-format ranges out of the materialised grid ([db4c961](https://github.com/ExaDev/documents.js/commit/db4c96103c828c0eb5464daebad35d711054d25e))

### Documentation

* **odf.js:** document the ods writer's validation and conditional formats ([4d89c21](https://github.com/ExaDev/documents.js/commit/4d89c2127d78e112664dc879bb2744c98a4c0058))

## [7.10.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.9.2...odf.js%407.10.0) (2026-09-08)

### Features

* **odf.js:** add write-side helpers for ODF divisions and index wrappers ([e921f75](https://github.com/ExaDev/documents.js/commit/e921f75540d4d17a79bf31bb662116c4ff676e0b))
* **odf.js:** let canonicalParagraph state run-level constructs when allowed ([00d9da2](https://github.com/ExaDev/documents.js/commit/00d9da28f0a3a93b99cdc7966a90f97e014683aa))
* **odf.js:** splice run-level field and bookmark constructs into paragraph writing ([309f0d3](https://github.com/ExaDev/documents.js/commit/309f0d38011a7dd35ff218d2a4199bdc57f1d04f))
* **odf.js:** write divisions and index wrappers from block-scope constructs ([bed1946](https://github.com/ExaDev/documents.js/commit/bed19461ff9162ce2d8a8450597e29ad11a979c3))

### Documentation

* **odf.js:** describe which odt fidelity constructs writeOdt now closes ([f85a611](https://github.com/ExaDev/documents.js/commit/f85a611c7360d4c0eec0883731b6000b59132d4e))

### Tests

* **odf.js:** cover the newly-written odt fields, bookmarks, and constructs ([dfbead7](https://github.com/ExaDev/documents.js/commit/dfbead7f523d806ff3764b47ee23017750fc845c))

## [7.9.2](https://github.com/ExaDev/documents.js/compare/odf.js%407.9.1...odf.js%407.9.2) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.5.1

## [7.9.1](https://github.com/ExaDev/documents.js/compare/odf.js%407.9.0...odf.js%407.9.1) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.5.0

## [7.9.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.8.0...odf.js%407.9.0) (2026-09-08)

### Features

* **odf.js:** read and write nested lists and tables inside a table cell ([7975e6a](https://github.com/ExaDev/documents.js/commit/7975e6ad5fe20a654b9ba1e83834e91a85c3a455))
* **odf.js:** restore quarantined non-content package parts on write ([84b0772](https://github.com/ExaDev/documents.js/commit/84b07724015e10923087b7bc86024db5b47af7c9))

### Documentation

* **odf.js:** document package residue restoration and nested table-cell content ([ca0fec2](https://github.com/ExaDev/documents.js/commit/ca0fec2e1ce08db09876aa8272bf5fecc1925cd9))

## [7.8.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.7.1...odf.js%407.8.0) (2026-09-08)

### Features

* **odf.js:** build real geometry for six more draw:custom-shape presets ([41ec326](https://github.com/ExaDev/documents.js/commit/41ec3267ba3cef2aab97d3839606c2136cb85711)), references [ExaDev/documents.js#954](https://github.com/ExaDev/documents.js/issues/954)
* **odf.js:** parse the ODF angle datatype and look up named draw resources ([4651826](https://github.com/ExaDev/documents.js/commit/465182641dad1d280a51fd227d72f123c2b6e767))
* **odf.js:** resolve non-flat vector fills, opacity, and the real dash pattern ([bc4a53a](https://github.com/ExaDev/documents.js/commit/bc4a53a1e3ef67f3088039919063f1b6d84d68bb)), references [ExaDev/documents.js#954](https://github.com/ExaDev/documents.js/issues/954)

### Documentation

* **odf.js:** document the extended vector fill/stroke/custom-shape fidelity ([4063a87](https://github.com/ExaDev/documents.js/commit/4063a8725ebd303ed5782b8df7bfb3abec4661ee)), references [ExaDev/documents.js#954](https://github.com/ExaDev/documents.js/issues/954)


### Dependencies

- Updated document-schema.js to 7.4.0

## [7.7.1](https://github.com/ExaDev/documents.js/compare/odf.js%407.7.0...odf.js%407.7.1) (2026-09-08)

### Bug Fixes

* **deps:** pin @vitest/coverage-v8 to match its vitest runner ([6912e0e](https://github.com/ExaDev/documents.js/commit/6912e0e5c602f0c21d9df12d2dc9899422bf5bd2))

### Miscellaneous Chores

* **deps:** pin every workspace dependency to an exact fixed version ([6a38142](https://github.com/ExaDev/documents.js/commit/6a38142facc043dfa499573f37431d3b32ff602e))


### Dependencies

- Updated document-schema.js to 7.3.1

## [7.7.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.6.0...odf.js%407.7.0) (2026-09-07)

### Features

* **odf.js:** read calcext:conditional-formats into ContentSheet.conditionalFormats ([dcc7f9c](https://github.com/ExaDev/documents.js/commit/dcc7f9ccc4d1dee43fa479d0f913894090724e73))

### Bug Fixes

* **odf.js:** decode XML entities in table:condition before parsing it ([fdafb3d](https://github.com/ExaDev/documents.js/commit/fdafb3d15619d9e6a56815b657f379f29911a5b4))

### Code Refactoring

* **odf.js:** extract the balanced-paren expression parser into a shared module ([8a1cf22](https://github.com/ExaDev/documents.js/commit/8a1cf229f3656569f624e51805d1b711712b6f5f))


### Dependencies

- Updated document-schema.js to ^7.3.0

## [7.6.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.5.1...odf.js%407.6.0) (2026-09-07)

### Features

* **odf.js:** read a positioned draw:frame's own svg:x/svg:y into ContentImageBlock.floatPosition ([8f331ba](https://github.com/ExaDev/documents.js/commit/8f331bac9a4b99fee2d575ee53ca91c60adc7336)), references [ExaDev/documents.js#1087](https://github.com/ExaDev/documents.js/issues/1087)

## [7.5.1](https://github.com/ExaDev/documents.js/compare/odf.js%407.5.0...odf.js%407.5.1) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.2.0

## [7.5.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.4.1...odf.js%407.5.0) (2026-09-07)

### Features

* **odf.js:** read fo:border-* into ContentParagraph.borders ([ffb1b29](https://github.com/ExaDev/documents.js/commit/ffb1b29ac1f5dad22c24f86a72bd4c9d44af4298)), references [#1082](https://github.com/ExaDev/documents.js/issues/1082)

## [7.4.1](https://github.com/ExaDev/documents.js/compare/odf.js%407.4.0...odf.js%407.4.1) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.1.0

## [7.4.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.3.0...odf.js%407.4.0) (2026-09-07)

### Features

* **odf.js:** add patchOdfMetadata/hasOdfMetadata for in-place meta.xml editing ([9477a19](https://github.com/ExaDev/documents.js/commit/9477a191cb015b889d2daf326c974931b89d342a))

## [7.3.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.2.0...odf.js%407.3.0) (2026-09-07)

### Features

* **odf.js:** read table:content-validation into ContentSheet.dataValidations ([4ab941e](https://github.com/ExaDev/documents.js/commit/4ab941e33417c51d8d40d79b0e26ae6ee5a59fb4)), closes [ExaDev/documents.js#925](https://github.com/ExaDev/documents.js/issues/925)

### Bug Fixes

* **odf.js:** drop the always-true undefined guard around readContentValidation ([71637d5](https://github.com/ExaDev/documents.js/commit/71637d57f19e1cb054d177fbae16a4d2a2d41828))

## [7.2.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.1.6...odf.js%407.2.0) (2026-09-07)

### Features

* **odf.js:** read and write cell comments (office:annotation) ([b13f2a8](https://github.com/ExaDev/documents.js/commit/b13f2a8ad568e6e61f45ddf6a7a1b7526323e8b7))

## [7.1.6](https://github.com/ExaDev/documents.js/compare/odf.js%407.1.5...odf.js%407.1.6) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.0.0

## [7.1.5](https://github.com/ExaDev/documents.js/compare/odf.js%407.1.4...odf.js%407.1.5) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.3

## [7.1.4](https://github.com/ExaDev/documents.js/compare/odf.js%407.1.3...odf.js%407.1.4) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.2

## [7.1.3](https://github.com/ExaDev/documents.js/compare/odf.js%407.1.2...odf.js%407.1.3) (2026-09-07)

### Bug Fixes

* **odf.js:** recognise and write ODF's Preformatted_20_Text paragraph style ([8b2d518](https://github.com/ExaDev/documents.js/commit/8b2d518f2df6e5aad4a59aff6a3daded4263f5db)), closes [ExaDev/documents.js#1020](https://github.com/ExaDev/documents.js/issues/1020), references [994/#996](https://github.com/ExaDev/documents.js/issues/996)


### Dependencies

- Updated document-schema.js to ^6.2.1

## [7.1.2](https://github.com/ExaDev/documents.js/compare/odf.js%407.1.1...odf.js%407.1.2) (2026-09-07)

### Bug Fixes

* **odf.js:** read a form:listbox's own option list ([519beec](https://github.com/ExaDev/documents.js/commit/519beec6cc5bd8c5d000b72e2031b2fa3e1fec28)), closes [ExaDev/documents.js#1016](https://github.com/ExaDev/documents.js/issues/1016)

## [7.1.1](https://github.com/ExaDev/documents.js/compare/odf.js%407.1.0...odf.js%407.1.1) (2026-09-06)


### Dependencies

- Updated document-schema.js to ^6.2.0

## [7.1.0](https://github.com/ExaDev/documents.js/compare/odf.js%407.0.0...odf.js%407.1.0) (2026-09-06)

### Features

* **workspace:** add per-package Stryker mutation testing configuration ([ff3eacc](https://github.com/ExaDev/documents.js/commit/ff3eacc124577b163a1c13a63b83484d9611ae5a))

### Bug Fixes

* **workspace:** drop the unused per-package @stryker-mutator/api dependency ([69270b6](https://github.com/ExaDev/documents.js/commit/69270b6e7ad7163c3b76cd085f4e5f367433994c))


### Dependencies

- Updated document-schema.js to ^6.1.0

## [7.0.0](https://github.com/ExaDev/documents.js/compare/odf.js%406.4.1...odf.js%407.0.0) (2026-09-06)

### ⚠ BREAKING CHANGES

* **odf.js:** readOdtContent/readOdsContent/readOdpContent/
  readOdgContent's ContentTableCell/ContentSheetCell.background is now a
  discriminated ContentCellFill rather than a bare Color, matching
  document-schema.js's own breaking change to the shared schema. The
  matching writeOdtContent/writeOdsContent/writeOdpContent/writeOdgContent
  cell background parameter changes the same way. A caller reading a
  background as a Color directly, or constructing one, must wrap/unwrap
  it as { kind: 'solid', color }.

### Bug Fixes

* **odf.js:** adapt cell background to the new discriminated fill shape ([e19ed21](https://github.com/ExaDev/documents.js/commit/e19ed213682c1ccdba19410cb13d4510ceab0d9f)), references [ExaDev/documents.js#951](https://github.com/ExaDev/documents.js/issues/951)

### Build System

* typecheck test/workers across every package where it is currently clean ([f340428](https://github.com/ExaDev/documents.js/commit/f340428b51a669010c0c4e5edb4310fe6ea4789a)), closes [#1021](https://github.com/ExaDev/documents.js/issues/1021)


### Dependencies

- Updated document-schema.js to ^6.0.0

## [6.4.1](https://github.com/ExaDev/documents.js/compare/odf.js%406.4.0...odf.js%406.4.1) (2026-09-05)

### Bug Fixes

* handle ContentImageBlock's widened svg/gif formats across every consumer ([875b10b](https://github.com/ExaDev/documents.js/commit/875b10b3281ca1ab598abc97230d82f8ff5cdaae))


### Dependencies

- Updated document-schema.js to ^5.6.0

## [6.4.0](https://github.com/ExaDev/documents.js/compare/odf.js%406.3.0...odf.js%406.4.0) (2026-09-04)

### Features

* **odf.js:** add a real .sxc writer for OpenOffice.org 1.x ([d54271b](https://github.com/ExaDev/documents.js/commit/d54271bb1a8892a1e85a86a76e7f7cbdfece3979))
* **odf.js:** add a real .sxi writer for OpenOffice.org 1.x presentations ([693d59f](https://github.com/ExaDev/documents.js/commit/693d59fc4a5f4ffbde2b742fee166d92e36fb992))
* **odf.js:** add the shared draw-shape writer for odp/odg ([6094c63](https://github.com/ExaDev/documents.js/commit/6094c633038a2f2bffc637fa812ea3cbb62fad15))
* **odf.js:** add writeOdp/writeOdpContent, a real .odp writer ([989b210](https://github.com/ExaDev/documents.js/commit/989b2105657cf62ab6963d0aaa8d974110f3ef81))
* **odf.js:** add writeOdsContent/writeOds, the genuine inverse of the ods reader ([3e45986](https://github.com/ExaDev/documents.js/commit/3e459861d4b9ccbbe4d63946ac081b6024ba8156))
* **odf.js:** add writeSxw/writeSxwContent, a real .sxw writer ([c54f6bd](https://github.com/ExaDev/documents.js/commit/c54f6bd2e1303c6a468efedb3c5f3718ef59abb1))
* **odf.js:** reverse the OpenOffice.org 1.x transform into an ODF-to-OOo1 rewrite ([f2b2535](https://github.com/ExaDev/documents.js/commit/f2b25359b3edc9a31bb5cafb759b282a6de43b34))
* **odf.js:** serialise a path's own subpaths into svg:d and svg:viewBox ([5b43224](https://github.com/ExaDev/documents.js/commit/5b4322443836e12abdaed496955482bfb23a93dc))
* **odf.js:** write .odg packages from the drawing content arm ([a078382](https://github.com/ExaDev/documents.js/commit/a078382af0372e57e0449ba1b9bed46958f35c0a))
* **odf.js:** write .ott/.ots/.otp/.otg templates, and their .stw/.stc/.sti/.std counterparts ([e50af49](https://github.com/ExaDev/documents.js/commit/e50af49721fb943535f2fe6d8535ce93db863f51))
* **odf.js:** write .sxd through writeOdg and the OpenOffice.org 1.x transform ([b55d43c](https://github.com/ExaDev/documents.js/commit/b55d43c8366d20d2394e22cd921423b580bd8d13))
* **odf.js:** write a shape's paint order as draw:z-index ([92608cb](https://github.com/ExaDev/documents.js/commit/92608cb4abbcb3394ce024369c4573093dc6736d))
* **odf.js:** write ContentVector rect/ellipse/line/path as draw: elements ([8b38551](https://github.com/ExaDev/documents.js/commit/8b385514c66a2f8e4a8dfed97fba95b67c0966b3))

### Bug Fixes

* **odf.js:** declare the presentation namespace prefix on every written part ([b07e712](https://github.com/ExaDev/documents.js/commit/b07e7122aaaa84a9c04f1290c3d969f9fbf80cc4))
* **odf.js:** decode XML entities in a shape's draw:name ([ec6abf2](https://github.com/ExaDev/documents.js/commit/ec6abf226a20b292718a085e18650060e7f202ad))
* **odf.js:** expand a drawing shape's rotate() angle out of exponent notation ([3b4c78e](https://github.com/ExaDev/documents.js/commit/3b4c78e5a0dad270274dd7754087e047d7ac76b0))
* **odf.js:** format an ODF length as fixed-point decimal, never exponent notation ([dd3e63b](https://github.com/ExaDev/documents.js/commit/dd3e63b850430f8932b6ac75a590baef89f9bfca))
* **odf.js:** mint a text-in-a-frame shape's own graphic style unconditionally ([05430a8](https://github.com/ExaDev/documents.js/commit/05430a8bddda90b3e854b9cef1f5f573d1d8e56c))
* **odf.js:** refuse a paintOrder beyond Number.isSafeInteger's own bound ([a988a61](https://github.com/ExaDev/documents.js/commit/a988a61e16643024b991f97a15d907272e6ae9ec))
* **odf.js:** rename a drawing style's family between the graphics and graphic spellings ([6551c71](https://github.com/ExaDev/documents.js/commit/6551c710b997a78f80b0355b241df6633d9f4d77))
* **odf.js:** write draw:z-index unconditionally on every drawing shape and vector ([5a467b0](https://github.com/ExaDev/documents.js/commit/5a467b0454a95e6c7dae72bdbf06ef7092fb20ac))

### Code Refactoring

* **odf.js:** export border-formatting and column/row default constants for reuse ([fc515db](https://github.com/ExaDev/documents.js/commit/fc515db8bdf9bc8d0624782cb62beb1e03315617))
* **odf.js:** keep the draw-shape write seam out of the published surface ([ee763d5](https://github.com/ExaDev/documents.js/commit/ee763d5db9303382f3b5e3d2b37dabd0af5b9966))
* **odf.js:** move the metadata and draw-shape canonical forms beside what they describe ([8eedaee](https://github.com/ExaDev/documents.js/commit/8eedaee048be1bf53be6807f7940d2df0a44bf95))
* **odf.js:** share write-side list-numId planning and canonical-form helpers ([d3e4c65](https://github.com/ExaDev/documents.js/commit/d3e4c65304c9892c7b35ace68f7dbdc951e765dd))
* **odf.js:** state a canonicalised shape's and vector's paint order as required ([fedc9d3](https://github.com/ExaDev/documents.js/commit/fedc9d37518e3e56e4e7c29236ee8a09c151f778))

### Documentation

* **odf.js:** document .odg write support ([71bdddc](https://github.com/ExaDev/documents.js/commit/71bdddc5ac61156433f4ac1cf334cbed24e38f57))
* **odf.js:** document odp write support and the LibreOffice verification ([4984c6a](https://github.com/ExaDev/documents.js/commit/4984c6aee85d01d8250728327d8c134459f15382))
* **odf.js:** document the .sxc writer ([6ae314f](https://github.com/ExaDev/documents.js/commit/6ae314f337261fac7f279ee47a77aaef53aebb4d))
* **odf.js:** document the .sxd writer and what its LibreOffice verification found ([3fc0453](https://github.com/ExaDev/documents.js/commit/3fc0453a9fc36adbee6bcb516529c58e123a3fad))
* **odf.js:** document the .sxi writer ([a8705a2](https://github.com/ExaDev/documents.js/commit/a8705a2801b57ee5a1f83d630fe64d29bbfe7111))
* **odf.js:** document the .sxw writer and fix the now-stale read-only claim ([380846d](https://github.com/ExaDev/documents.js/commit/380846d932006d4ef089f1365b43858656384fd3))
* **odf.js:** document the ods writer's real scope in the README ([9152ada](https://github.com/ExaDev/documents.js/commit/9152ada174dee95c815f82308a8f31b2dcd8601b))
* **odf.js:** name all five fields canonicalShape drops, not four of them ([29670de](https://github.com/ExaDev/documents.js/commit/29670de7a858e30425d09507087ac3e57dd42f11))
* **odf.js:** state that a .sx* writer produces its base media type, never its .st* template ([89d4685](https://github.com/ExaDev/documents.js/commit/89d4685cae05cb603ca9af5b86bc81440089d555))
* **odf.js:** state what the LibreOffice flat-XML check actually establishes ([2081e23](https://github.com/ExaDev/documents.js/commit/2081e23f8a790deed48b44dfd56717ba742e6f9f))
* **odf.js:** update ooo1 module comments now that a real writer exists ([897393b](https://github.com/ExaDev/documents.js/commit/897393bbdd49bb14def607190e7d13354d8467c7))

### Styles

* **odf.js:** wrap the .sxc barrel export across multiple lines ([7b1556b](https://github.com/ExaDev/documents.js/commit/7b1556b2f95b1a236c958cae818d8894090e597c))

### Tests

* **odf.js:** assert the OpenOffice.org 1.x writers' tree-form output is genuinely OOo1x ([0a34a3d](https://github.com/ExaDev/documents.js/commit/0a34a3d43e769875000a0b80ba4774c777dd7015))
* **odf.js:** audit the odg and sxi writers' namespace prefixes too ([7ceede2](https://github.com/ExaDev/documents.js/commit/7ceede25578d73a1f34b820ebb1f140bf1a7b050))
* **odf.js:** check the svg:d serializer against the parser it inverts ([37572cf](https://github.com/ExaDev/documents.js/commit/37572cfeb5528ad76b9b7511e0509c8da65b4b78))
* **odf.js:** construct the namespace audit's own fixture colours as Color objects ([19b43ad](https://github.com/ExaDev/documents.js/commit/19b43ad6a638486ba9c4c9015c6800215e59d8e6))
* **odf.js:** cover transformToOoo1Package and the .sxw round-trip law ([29808c9](https://github.com/ExaDev/documents.js/commit/29808c9213616e72fdbf95ca5e800aa34f053eb7))
* **odf.js:** cover writeOdsContent's XML shapes and its round-trip law ([498c9cb](https://github.com/ExaDev/documents.js/commit/498c9cbeaab30d73f3df5c35224d51ac4f19a32f))
* **odf.js:** pin the odg custom-shape draw:name decode against a mutation ([42c469b](https://github.com/ExaDev/documents.js/commit/42c469ba79fe9d9133a8373f53f043abceb4ef77))
* **odf.js:** pin the odg writer's XML shapes and its round-trip law ([b49c46c](https://github.com/ExaDev/documents.js/commit/b49c46c2072d4d601e261cb1871e6172b7c1e730))
* **odf.js:** verify the .sxc writer round-trips through the unmodified reader ([c60766a](https://github.com/ExaDev/documents.js/commit/c60766a62b98a2899c49c5c335a45f2b9e857398))
* **odf.js:** verify the .sxi writer round-trips through the unmodified reader ([c1b568e](https://github.com/ExaDev/documents.js/commit/c1b568eab11355d3a0295c679e31054264bd008a))
* **odf.js:** verify writeOdp's XML shapes and its own round-trip law ([98232db](https://github.com/ExaDev/documents.js/commit/98232db1974ecdd6e7c512e4ee083b7d6baeea98))


### Dependencies

- Updated document-schema.js to ^5.5.1

## [6.3.0](https://github.com/ExaDev/documents.js/compare/odf.js%406.2.1...odf.js%406.3.0) (2026-09-03)

### Features

* **odf.js:** add a typed ODT content writer, ContentDocument to package ([350249f](https://github.com/ExaDev/documents.js/commit/350249f7d3fa76891a2030f5fa8b0973c8edb993))

## [6.2.1](https://github.com/ExaDev/documents.js/compare/odf.js%406.2.0...odf.js%406.2.1) (2026-09-03)


### Dependencies

- Updated document-schema.js to ^5.5.0

## [6.2.0](https://github.com/ExaDev/documents.js/compare/odf.js%406.1.3...odf.js%406.2.0) (2026-09-02)

### Features

* **odf.js:** add the OpenOffice.org 1.x namespace and media-type tables ([204ff67](https://github.com/ExaDev/documents.js/commit/204ff67f53d9ca2f00256c85534c566678470b59))
* **odf.js:** read sxw, sxc, sxi and sxd through the ODF readers ([d1ae5d6](https://github.com/ExaDev/documents.js/commit/d1ae5d641808b00b05ed06ceca56101915304c4d))
* **odf.js:** rewrite an OpenOffice.org 1.x package into the ODF shape ([cf7c120](https://github.com/ExaDev/documents.js/commit/cf7c12073acfa0df1f01105ad9a3367f8931ddbe))
* **odf.js:** split OpenOffice.org 1.x style:properties into ODF's typed elements ([2a388a3](https://github.com/ExaDev/documents.js/commit/2a388a330487f31766ec866018986a6710394720))

### Code Refactoring

* **odf.js:** drop office:class where every other attribute is handled ([777777d](https://github.com/ExaDev/documents.js/commit/777777d9d1640dd4e9ab7bea1ee8d182594eebdc))

### Documentation

* **odf.js:** document the OpenOffice.org 1.x reading path ([4855885](https://github.com/ExaDev/documents.js/commit/485588530995f9de76a78c1b156ab2148232a5e4))

### Tests

* **odf.js:** assert the OpenOffice.org 1.x surface against the built artifact ([75e7237](https://github.com/ExaDev/documents.js/commit/75e7237211145e542ab2fd276a0252ac91f4bf52))

## [6.1.3](https://github.com/ExaDev/documents.js/compare/odf.js%406.1.2...odf.js%406.1.3) (2026-09-02)

### Miscellaneous Chores

* **deps:** bump document-schema.js to ^5.4.0 in odf.js [skip ci] ([700ae37](https://github.com/ExaDev/documents.js/commit/700ae37e7ccef25e6056c95ad4026c3d527e5f93))


### Dependencies

- Updated document-schema.js to ^5.4.0

## [6.1.2](https://github.com/ExaDev/documents.js/compare/odf.js%406.1.1...odf.js%406.1.2) (2026-09-02)

### Miscellaneous Chores

* **deps:** bump document-schema.js to ^5.3.0 in odf.js [skip ci] ([4dfdc42](https://github.com/ExaDev/documents.js/commit/4dfdc42e81a542348269fd741c297383019092f0))


### Dependencies

- Updated document-schema.js to ^5.3.0

## [6.1.1](https://github.com/ExaDev/documents.js/compare/odf.js%406.1.0...odf.js%406.1.1) (2026-09-02)

### Miscellaneous Chores

* **deps:** bump document-schema.js to ^5.2.0 in odf.js [skip ci] ([fc16209](https://github.com/ExaDev/documents.js/commit/fc16209982f4abe3a5c1a7f261b75855df774cf5))


### Dependencies

- Updated document-schema.js to ^5.2.0

## [6.1.0](https://github.com/ExaDev/documents.js/compare/odf.js%406.0.0...odf.js%406.1.0) (2026-08-24)

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

* **deps:** bump document-schema.js to ^5.1.0 in odf.js [skip ci] ([394906a](https://github.com/ExaDev/documents.js/commit/394906a92de863a4eee499db2897e935cc12070e))
* **deps:** drop the dependencies each package no longer uses ([80094aa](https://github.com/ExaDev/documents.js/commit/80094aa6db412392ef6e6457014d5963a5e910a7))


### Dependencies

- Updated document-schema.js to ^5.1.0

# [6.0.0](https://github.com/ExaDev/documents.js/compare/odf.js@5.5.2...odf.js@6.0.0) (2026-08-23)


* refactor(odf)!: rename DocumentPackage to DocumentTree, land division's text:filter-name residue ([8c5e0b0](https://github.com/ExaDev/documents.js/commit/8c5e0b0cec3bbde2066a3042381d8a12b56603bc)), closes [#719](https://github.com/ExaDev/documents.js/issues/719) [#661](https://github.com/ExaDev/documents.js/issues/661) [#743](https://github.com/ExaDev/documents.js/issues/743)


### BREAKING CHANGES

* every DocumentPackage-rooted export this package
re-exports or returns (DocumentTree, TreeNode/Group/Leaf/BlockLeaf and
siblings) tracks document-schema.js 5.0.0's rename. A division
construct's external-chapter link is read from `linked`, not `source`;
`source` now carries text:filter-name residue when present.


### Dependencies

- Updated document-schema.js to ^5.0.0

## [5.5.2](https://github.com/ExaDev/documents.js/compare/odf.js@5.5.1...odf.js@5.5.2) (2026-08-23)


### Dependencies

- Updated document-schema.js to ^4.10.0

## [5.5.1](https://github.com/ExaDev/documents.js/compare/odf.js@5.5.0...odf.js@5.5.1) (2026-08-23)


### Dependencies

- Updated document-schema.js to ^4.9.1

# [5.5.0](https://github.com/ExaDev/documents.js/compare/odf.js@5.4.0...odf.js@5.5.0) (2026-08-22)


### Features

* **odf:** read text:h table-cell children with full heading identity ([a8277e9](https://github.com/ExaDev/documents.js/commit/a8277e9b6279ab99bf42f71ecee6cd0f69335ed8))

# [5.4.0](https://github.com/ExaDev/documents.js/compare/odf.js@5.3.0...odf.js@5.4.0) (2026-08-22)


### Features

* **odf:** read cross-reference marks and displays as run-level constructs ([008d4d8](https://github.com/ExaDev/documents.js/commit/008d4d8f1744e75bdade70ad8fcc52dd23defef5))

# [5.3.0](https://github.com/ExaDev/documents.js/compare/odf.js@5.2.0...odf.js@5.3.0) (2026-08-22)


### Bug Fixes

* **odf:** quarantine ods vendor extensions inside each table:table where Calc writes them ([5fcbdf1](https://github.com/ExaDev/documents.js/commit/5fcbdf1ba081c8e713fdfa9fe5c5ffb8412105ca))
* **odf:** read odp slide transitions off the drawing-page style, both odf spellings ([2765aa7](https://github.com/ExaDev/documents.js/commit/2765aa71c554ff18c3934a71b70b9857a46ce534))
* **odf:** read only a ruby's base text as flow content, never its gloss ([0b70189](https://github.com/ExaDev/documents.js/commit/0b70189d86f08363bee6bc70ee0049356b7a7df1))
* **odf:** resolve the construct-rows rebase against the embedded dispatch ([76377cd](https://github.com/ExaDev/documents.js/commit/76377cd6caba01b02743bd4a15d1d065fe76bbba))


### Features

* **odf:** map every master page, split sections at page-style switches ([45b3a16](https://github.com/ExaDev/documents.js/commit/45b3a167121424a69c5c52c384be357a40b7341f))
* **odf:** quarantine the ods/odp/odg residue rows ([31624d0](https://github.com/ExaDev/documents.js/commit/31624d0a5867a7162e519fa16060238cc89562f1))
* **odf:** quarantine the odt residue rows through the package-tier channel ([3cfd7af](https://github.com/ExaDev/documents.js/commit/3cfd7af3c640f3d8f0eecf53413079c6f697ef90))
* **odf:** quarantine vendor-extension elements at the ods spreadsheet level ([470ba98](https://github.com/ExaDev/documents.js/commit/470ba98121d4c0ee7e972833e728a24eec031505))
* **odf:** read fo:break-before/after through the cascade onto paragraph page-break flags ([0e495a1](https://github.com/ExaDev/documents.js/commit/0e495a1bd94edae479cb79cfe6b8d008455e8831))


### Dependencies

- Updated document-schema.js to ^4.9.0

# [5.2.0](https://github.com/ExaDev/documents.js/compare/odf.js@5.1.2...odf.js@5.2.0) (2026-08-22)


### Features

* **odf:** read a spreadsheet embedded in an odt through a shared embedded-document dispatch ([f2233b1](https://github.com/ExaDev/documents.js/commit/f2233b10033c2721e367eeb49350139e7eb09a71))

## [5.1.2](https://github.com/ExaDev/documents.js/compare/odf.js@5.1.1...odf.js@5.1.2) (2026-08-21)


### Bug Fixes

* **odf:** pin zip entry mtimes so the byte layout is fully deterministic ([49d9e59](https://github.com/ExaDev/documents.js/commit/49d9e59aa0ff7ebb498c48a4209e164a438b88b6))

## [5.1.1](https://github.com/ExaDev/documents.js/compare/odf.js@5.1.0...odf.js@5.1.1) (2026-08-21)


### Dependencies

- Updated document-schema.js to ^4.8.0

# [5.1.0](https://github.com/ExaDev/documents.js/compare/odf.js@5.0.9...odf.js@5.1.0) (2026-08-21)


### Bug Fixes

* **odf:** assemble annotation bodies through the ordered body walk, not paragraphs-then-lists ([8249a6c](https://github.com/ExaDev/documents.js/commit/8249a6ca97edc04967c573bde7643450c2067931))
* **odf:** cover a trailing marker half's extent over the frames lifted before it ([79dd0b5](https://github.com/ExaDev/documents.js/commit/79dd0b5140d608a20801656e80834fe5f7ea8038))
* **odf:** index nested wrapper extents against the flat block list, not the recursive local array ([77d9e03](https://github.com/ExaDev/documents.js/commit/77d9e03bc38acfc37313cc3b3c11dca11fc412ad))
* **odf:** mint note and annotation body list numIds from the document-wide counter ([990a1e4](https://github.com/ExaDev/documents.js/commit/990a1e401b4d2b034852a254f9b1cf2d77f5cf01))


### Features

* **odf:** gate the odt frame lift behind a frames option, with documents.js opting out ([f3e63a1](https://github.com/ExaDev/documents.js/commit/f3e63a1176d3c4f99d8224152dc5a5e3091a0fb4))
* **odf:** quarantine unmodellable style properties and read data styles and font declarations ([b21d448](https://github.com/ExaDev/documents.js/commit/b21d4488b93ffb3208aa97204c076851a9ecd104))
* **odf:** read anchored frames in odt text flow and resolve embedded charts ([21bcc3e](https://github.com/ExaDev/documents.js/commit/21bcc3e8e79516c09e69c339b664912e9d54358f))
* **odf:** read footnotes, endnotes, and annotations as anchors with definitions ([da224cd](https://github.com/ExaDev/documents.js/commit/da224cd30bebc7e28bc74ee8178dc9d6bc18825d))
* **odf:** read inline fields and bookmarks as run-level construct extents ([e156221](https://github.com/ExaDev/documents.js/commit/e15622187ae43537389d205d224d2f9faa6fb9ab))
* **odf:** read ods named expressions into a definitions table ([4502f69](https://github.com/ExaDev/documents.js/commit/4502f695150bbe62f72ea4a9b814318e293e38bf))
* **odf:** read office:forms in ordinary text documents as content controls ([b943076](https://github.com/ExaDev/documents.js/commit/b943076f95356f2f6b3aa8a175f09a7655f8ddda))
* **odf:** read text:section as a division and index wrappers as content controls ([3a56883](https://github.com/ExaDev/documents.js/commit/3a568830ed4cfc5ad47488fb344c9b9b1374c550)), closes [#743](https://github.com/ExaDev/documents.js/issues/743)
* **odf:** read tracked changes as provenance and pair block-scope markers ([4a82b88](https://github.com/ExaDev/documents.js/commit/4a82b88548825d5d140784eee4df005877511917))


### Dependencies

- Updated document-schema.js to ^4.7.0

## [5.0.9](https://github.com/ExaDev/documents.js/compare/odf.js@5.0.8...odf.js@5.0.9) (2026-08-21)


### Bug Fixes

* **odf:** state the unreachable chart arm in the embedded-object dispatch ([168809e](https://github.com/ExaDev/documents.js/commit/168809eba52203e4c8887f62107402d08e3a4113))


### Dependencies

- Updated document-schema.js to ^4.6.0

## [5.0.8](https://github.com/ExaDev/documents.js/compare/odf.js@5.0.7...odf.js@5.0.8) (2026-08-21)


### Dependencies

- Updated document-schema.js to ^4.5.0

## [5.0.7](https://github.com/ExaDev/documents.js/compare/odf.js@5.0.6...odf.js@5.0.7) (2026-08-20)


### Dependencies

- Updated document-schema.js to ^4.3.7

## [5.0.6](https://github.com/ExaDev/documents.js/compare/odf.js@5.0.5...odf.js@5.0.6) (2026-08-20)


### Dependencies

- Updated document-schema.js to ^4.3.6

## [5.0.5](https://github.com/ExaDev/documents.js/compare/odf.js@5.0.4...odf.js@5.0.5) (2026-08-20)


### Bug Fixes

* point package homepage and bugs URLs at the monorepo, not the old standalone repos ([1b605e8](https://github.com/ExaDev/documents.js/commit/1b605e846393f417001227758a8606347c04e219))


### Dependencies

- Updated document-schema.js to ^4.3.5

## [5.0.4](https://github.com/ExaDev/documents.js/compare/odf.js@5.0.3...odf.js@5.0.4) (2026-08-20)


### Dependencies

- Updated document-schema.js to ^4.3.4

# [5.0.0](https://github.com/ExaDev/odf.js/compare/v4.0.3...v5.0.0) (2026-08-19)


### Features

* read every ODF content format into a DocumentPackage ([668f046](https://github.com/ExaDev/odf.js/commit/668f0468a322d202806a90af22ab93310f7623ee))


### BREAKING CHANGES

* the flat typed readers move to *Content names, freeing
the bare names for the DocumentPackage-native readers: readOdt ->
readOdtContent, readOdp -> readOdpContent, readOdg -> readOdgContent,
readOds -> readOdsContent, readOdfFormulaDocument ->
readOdfFormulaContent, and readOdfFormula -> readOdfFormulaMathMl.
Behaviour is unchanged in every case; each new bare name returns a
DocumentPackage, which is assignable to none of the old return types, so
an unmigrated call site fails to compile rather than changing meaning
silently.

## [4.0.3](https://github.com/ExaDev/odf.js/compare/v4.0.2...v4.0.3) (2026-08-19)

## [4.0.2](https://github.com/ExaDev/odf.js/compare/v4.0.1...v4.0.2) (2026-08-18)

## [4.0.1](https://github.com/ExaDev/odf.js/compare/v4.0.0...v4.0.1) (2026-08-18)

# [4.0.0](https://github.com/ExaDev/odf.js/compare/v3.1.0...v4.0.0) (2026-08-18)


* feat!: stop stamping formatVersion on ContentDocument for schema 4.0.0 ([282e275](https://github.com/ExaDev/odf.js/commit/282e27541c035998f655d2de98e741f0979d0a78))


### BREAKING CHANGES

* every ContentDocument odf.js produces now omits
formatVersion, and the package requires document-schema.js ^4.0.0.

# [3.1.0](https://github.com/ExaDev/odf.js/compare/v3.0.2...v3.1.0) (2026-08-17)


### Features

* read text:list content in odp slide text frames into ContentParagraph.list ([48c3ffa](https://github.com/ExaDev/odf.js/commit/48c3ffacc984db6341660b0027ac29aa12bf2a5b))

## [3.0.2](https://github.com/ExaDev/odf.js/compare/v3.0.1...v3.0.2) (2026-08-17)

## [3.0.1](https://github.com/ExaDev/odf.js/compare/v3.0.0...v3.0.1) (2026-08-17)

# [3.0.0](https://github.com/ExaDev/odf.js/compare/v2.7.23...v3.0.0) (2026-08-17)


* build!: bump document-schema.js to ^3.0.0 ([afe2894](https://github.com/ExaDev/odf.js/commit/afe2894f32c7b84e5d57b50de080d9ebdf901d37))


### Features

* read odt heading outline levels as headingLevel alongside styleId ([cf21f55](https://github.com/ExaDev/odf.js/commit/cf21f55d82a1a9ac6e967d54bddccec2533b4ff2))


### BREAKING CHANGES

* odf.js's emitted ContentDocuments now carry
formatVersion 3, from document-schema.js 3.0.0's CONTENT_FORMAT_VERSION;
consumers still validating odf.js output against document-schema.js 2
will reject the new documents.

## [2.7.23](https://github.com/ExaDev/odf.js/compare/v2.7.22...v2.7.23) (2026-08-17)

## [2.7.22](https://github.com/ExaDev/odf.js/compare/v2.7.21...v2.7.22) (2026-08-17)

## [2.7.21](https://github.com/ExaDev/odf.js/compare/v2.7.20...v2.7.21) (2026-08-17)

## [2.7.20](https://github.com/ExaDev/odf.js/compare/v2.7.19...v2.7.20) (2026-08-17)

## [2.7.19](https://github.com/ExaDev/odf.js/compare/v2.7.18...v2.7.19) (2026-08-17)

## [2.7.18](https://github.com/ExaDev/odf.js/compare/v2.7.17...v2.7.18) (2026-08-17)

## [2.7.17](https://github.com/ExaDev/odf.js/compare/v2.7.16...v2.7.17) (2026-08-17)

## [2.7.16](https://github.com/ExaDev/odf.js/compare/v2.7.15...v2.7.16) (2026-08-17)

## [2.7.15](https://github.com/ExaDev/odf.js/compare/v2.7.14...v2.7.15) (2026-08-17)

## [2.7.14](https://github.com/ExaDev/odf.js/compare/v2.7.13...v2.7.14) (2026-08-13)

## [2.7.13](https://github.com/ExaDev/odf.js/compare/v2.7.12...v2.7.13) (2026-08-13)

## [2.7.12](https://github.com/ExaDev/odf.js/compare/v2.7.11...v2.7.12) (2026-08-12)

## [2.7.11](https://github.com/ExaDev/odf.js/compare/v2.7.10...v2.7.11) (2026-08-12)

## [2.7.10](https://github.com/ExaDev/odf.js/compare/v2.7.9...v2.7.10) (2026-08-12)

## [2.7.9](https://github.com/ExaDev/odf.js/compare/v2.7.8...v2.7.9) (2026-08-12)

## [2.7.8](https://github.com/ExaDev/odf.js/compare/v2.7.7...v2.7.8) (2026-08-12)

## [2.7.7](https://github.com/ExaDev/odf.js/compare/v2.7.6...v2.7.7) (2026-08-12)

## [2.7.6](https://github.com/ExaDev/odf.js/compare/v2.7.5...v2.7.6) (2026-08-12)


### Bug Fixes

* **ci:** skip commitlint for dependabot commits to avoid body-max-line-length failures ([5257b81](https://github.com/ExaDev/odf.js/commit/5257b812c9a7b4a09c32947c8cdb4e6cefdd1626))

## [2.7.5](https://github.com/ExaDev/odf.js/compare/v2.7.4...v2.7.5) (2026-08-12)

## [2.7.4](https://github.com/ExaDev/odf.js/compare/v2.7.3...v2.7.4) (2026-08-12)

## [2.7.3](https://github.com/ExaDev/odf.js/compare/v2.7.2...v2.7.3) (2026-08-12)

## [2.7.2](https://github.com/ExaDev/odf.js/compare/v2.7.1...v2.7.2) (2026-08-12)

## [2.7.1](https://github.com/ExaDev/odf.js/compare/v2.7.0...v2.7.1) (2026-08-12)

# [2.7.0](https://github.com/ExaDev/odf.js/compare/v2.6.12...v2.7.0) (2026-08-11)


### Features

* resolve ODF list ordered-vs-bullet from text:list-style definitions ([40a52b5](https://github.com/ExaDev/odf.js/commit/40a52b589d3c323c33d042903f38df7f88399535))

## [2.6.12](https://github.com/ExaDev/odf.js/compare/v2.6.11...v2.6.12) (2026-08-10)

## [2.6.11](https://github.com/ExaDev/odf.js/compare/v2.6.10...v2.6.11) (2026-08-10)

## [2.6.10](https://github.com/ExaDev/odf.js/compare/v2.6.9...v2.6.10) (2026-08-08)

## [2.6.9](https://github.com/ExaDev/odf.js/compare/v2.6.8...v2.6.9) (2026-08-08)

## [2.6.8](https://github.com/ExaDev/odf.js/compare/v2.6.7...v2.6.8) (2026-08-08)


### Bug Fixes

* default unstyled ods column/row dimensions to positive values ([f347c73](https://github.com/ExaDev/odf.js/commit/f347c73ed5335b8076c3cf0c53401520776ef37c))

## [2.6.7](https://github.com/ExaDev/odf.js/compare/v2.6.6...v2.6.7) (2026-08-07)

## [2.6.6](https://github.com/ExaDev/odf.js/compare/v2.6.5...v2.6.6) (2026-08-07)

## [2.6.5](https://github.com/ExaDev/odf.js/compare/v2.6.4...v2.6.5) (2026-08-07)

## [2.6.4](https://github.com/ExaDev/odf.js/compare/v2.6.3...v2.6.4) (2026-08-07)

## [2.6.3](https://github.com/ExaDev/odf.js/compare/v2.6.2...v2.6.3) (2026-08-07)

## [2.6.2](https://github.com/ExaDev/odf.js/compare/v2.6.1...v2.6.2) (2026-08-07)

## [2.6.1](https://github.com/ExaDev/odf.js/compare/v2.6.0...v2.6.1) (2026-08-07)

# [2.6.0](https://github.com/ExaDev/odf.js/compare/v2.5.3...v2.6.0) (2026-08-07)


### Features

* add an autofix to the split-statement re-export rule ([028c845](https://github.com/ExaDev/odf.js/commit/028c8459ec4815216053f2b9f89c38e5a51a7c29))

## [2.5.3](https://github.com/ExaDev/odf.js/compare/v2.5.2...v2.5.3) (2026-08-07)

## [2.5.2](https://github.com/ExaDev/odf.js/compare/v2.5.1...v2.5.2) (2026-08-07)


### Bug Fixes

* render literal braces correctly and catch split-statement default re-exports ([22b149d](https://github.com/ExaDev/odf.js/commit/22b149dae15bf60cb943f1741d51a95055db3bc1))

## [2.5.1](https://github.com/ExaDev/odf.js/compare/v2.5.0...v2.5.1) (2026-08-07)

# [2.5.0](https://github.com/ExaDev/odf.js/compare/v2.4.23...v2.5.0) (2026-08-07)


### Features

* ban split-statement import-then-export re-exports ([a3ac637](https://github.com/ExaDev/odf.js/commit/a3ac6379211d1121ddba0a7941bf441ebd9c8e31))

## [2.4.23](https://github.com/ExaDev/odf.js/compare/v2.4.22...v2.4.23) (2026-08-06)

## [2.4.22](https://github.com/ExaDev/odf.js/compare/v2.4.21...v2.4.22) (2026-08-06)

## [2.4.21](https://github.com/ExaDev/odf.js/compare/v2.4.20...v2.4.21) (2026-08-06)

## [2.4.20](https://github.com/ExaDev/odf.js/compare/v2.4.19...v2.4.20) (2026-08-06)

## [2.4.19](https://github.com/ExaDev/odf.js/compare/v2.4.18...v2.4.19) (2026-08-06)

## [2.4.18](https://github.com/ExaDev/odf.js/compare/v2.4.17...v2.4.18) (2026-08-06)

## [2.4.17](https://github.com/ExaDev/odf.js/compare/v2.4.16...v2.4.17) (2026-08-06)

## [2.4.16](https://github.com/ExaDev/odf.js/compare/v2.4.15...v2.4.16) (2026-08-06)

## [2.4.15](https://github.com/ExaDev/odf.js/compare/v2.4.14...v2.4.15) (2026-08-06)

## [2.4.14](https://github.com/ExaDev/odf.js/compare/v2.4.13...v2.4.14) (2026-08-06)

## [2.4.13](https://github.com/ExaDev/odf.js/compare/v2.4.12...v2.4.13) (2026-08-06)

## [2.4.12](https://github.com/ExaDev/odf.js/compare/v2.4.11...v2.4.12) (2026-08-06)

## [2.4.11](https://github.com/ExaDev/odf.js/compare/v2.4.10...v2.4.11) (2026-08-06)

## [2.4.10](https://github.com/ExaDev/odf.js/compare/v2.4.9...v2.4.10) (2026-08-06)

## [2.4.9](https://github.com/ExaDev/odf.js/compare/v2.4.8...v2.4.9) (2026-08-06)

## [2.4.8](https://github.com/ExaDev/odf.js/compare/v2.4.7...v2.4.8) (2026-08-06)

## [2.4.7](https://github.com/ExaDev/odf.js/compare/v2.4.6...v2.4.7) (2026-08-05)

## [2.4.6](https://github.com/ExaDev/odf.js/compare/v2.4.5...v2.4.6) (2026-08-05)

## [2.4.5](https://github.com/ExaDev/odf.js/compare/v2.4.4...v2.4.5) (2026-08-05)

## [2.4.4](https://github.com/ExaDev/odf.js/compare/v2.4.3...v2.4.4) (2026-08-05)

## [2.4.3](https://github.com/ExaDev/odf.js/compare/v2.4.2...v2.4.3) (2026-08-05)

## [2.4.2](https://github.com/ExaDev/odf.js/compare/v2.4.1...v2.4.2) (2026-08-05)

## [2.4.1](https://github.com/ExaDev/odf.js/compare/v2.4.0...v2.4.1) (2026-08-05)

# [2.4.0](https://github.com/ExaDev/odf.js/compare/v2.3.9...v2.4.0) (2026-08-05)


### Features

* read text:a hyperlink elements into ContentRun.hyperlink ([6eac555](https://github.com/ExaDev/odf.js/commit/6eac555e5558003d3bdf66f1c967402c5d74c06f))

## [2.3.9](https://github.com/ExaDev/odf.js/compare/v2.3.8...v2.3.9) (2026-08-04)

## [2.3.8](https://github.com/ExaDev/odf.js/compare/v2.3.7...v2.3.8) (2026-08-04)

## [2.3.7](https://github.com/ExaDev/odf.js/compare/v2.3.6...v2.3.7) (2026-08-04)

## [2.3.6](https://github.com/ExaDev/odf.js/compare/v2.3.5...v2.3.6) (2026-08-04)

## [2.3.5](https://github.com/ExaDev/odf.js/compare/v2.3.4...v2.3.5) (2026-08-04)

## [2.3.4](https://github.com/ExaDev/odf.js/compare/v2.3.3...v2.3.4) (2026-08-04)

## [2.3.3](https://github.com/ExaDev/odf.js/compare/v2.3.2...v2.3.3) (2026-08-04)

## [2.3.2](https://github.com/ExaDev/odf.js/compare/v2.3.1...v2.3.2) (2026-08-04)

## [2.3.1](https://github.com/ExaDev/odf.js/compare/v2.3.0...v2.3.1) (2026-08-04)

# [2.3.0](https://github.com/ExaDev/odf.js/compare/v2.2.10...v2.3.0) (2026-08-03)


### Features

* export readDrawImageBlock for sibling packages ([d1c6121](https://github.com/ExaDev/odf.js/commit/d1c6121e391162bbaccc717cff037f1307c8eafd))

## [2.2.10](https://github.com/ExaDev/odf.js/compare/v2.2.9...v2.2.10) (2026-08-03)

## [2.2.9](https://github.com/ExaDev/odf.js/compare/v2.2.8...v2.2.9) (2026-08-03)


### Bug Fixes

* **ci:** use pull_request_target so dependabot auto-merge can read secrets ([f0cce44](https://github.com/ExaDev/odf.js/commit/f0cce441d901636f1ca43038742b74cfaa002bd7))

## [2.2.8](https://github.com/ExaDev/odf.js/compare/v2.2.7...v2.2.8) (2026-08-03)


### Bug Fixes

* **ci:** wait for a real check-run to register before requesting auto-merge ([8180b8c](https://github.com/ExaDev/odf.js/commit/8180b8c1b91dae41dffbdcb5f692b4c7069e93f8))

## [2.2.7](https://github.com/ExaDev/odf.js/compare/v2.2.6...v2.2.7) (2026-08-03)

## [2.2.6](https://github.com/ExaDev/odf.js/compare/v2.2.5...v2.2.6) (2026-08-03)


### Bug Fixes

* **ci:** use the GitHub App token for the branch push and PR creation too ([ffe0e6d](https://github.com/ExaDev/odf.js/commit/ffe0e6deb90e7914c74bb305156e0cd5f395c4b3))

## [2.2.5](https://github.com/ExaDev/odf.js/compare/v2.2.4...v2.2.5) (2026-08-03)


### Bug Fixes

* **ci:** wrap the sibling-bump commit body onto two lines under commitlint's limit ([b256dcc](https://github.com/ExaDev/odf.js/commit/b256dcc52471bb3ff5ff4ec19cdc011df3b39821))

## [2.2.4](https://github.com/ExaDev/odf.js/compare/v2.2.3...v2.2.4) (2026-08-03)

## [2.2.3](https://github.com/ExaDev/odf.js/compare/v2.2.2...v2.2.3) (2026-08-03)

## [2.2.2](https://github.com/ExaDev/odf.js/compare/v2.2.1...v2.2.2) (2026-08-03)

## [2.2.1](https://github.com/ExaDev/odf.js/compare/v2.2.0...v2.2.1) (2026-08-03)

# [2.2.0](https://github.com/ExaDev/odf.js/compare/v2.1.0...v2.2.0) (2026-08-03)


### Features

* read an embedded formula object and its cell anchor from a spreadsheet ([62399e7](https://github.com/ExaDev/odf.js/commit/62399e7e6789ad8f2f5920bb2c9b73b3149bed8a))

# [2.1.0](https://github.com/ExaDev/odf.js/compare/v2.0.0...v2.1.0) (2026-08-03)


### Features

* read cell- and page-anchored drawings from a spreadsheet ([425bec3](https://github.com/ExaDev/odf.js/commit/425bec3b7bc04e146e31481954ede5e25b873f6d))

# [2.0.0](https://github.com/ExaDev/odf.js/compare/v1.13.2...v2.0.0) (2026-08-02)


* feat!: read .odb form and report structure from their own ODF sub-documents ([6b31d67](https://github.com/ExaDev/odf.js/commit/6b31d67885d10cf3da0abc53c721b264b26d0f09))


### Features

* add readOdfFormulaDocument producing a real ContentDocument formula kind ([1f45d01](https://github.com/ExaDev/odf.js/commit/1f45d01d00b44327f1449f9df9463e26997bf508))
* read rotationDeg for draw:rect/ellipse/path/custom-shape vectors ([26d42a8](https://github.com/ExaDev/odf.js/commit/26d42a876cdbbdeb3d6c00452360a04ec9de726b))
* read sheet and table cell background/borders/alignment from the ODF style cascade ([a6b80a9](https://github.com/ExaDev/odf.js/commit/a6b80a9c7c593c16e63bf8988f8629c68d8ed96c))
* read svg:fill-rule and map draw:stroke to ContentStrokeSchema style ([d28155f](https://github.com/ExaDev/odf.js/commit/d28155f23de252915c2a721c20215a7c6461d520))
* register the rpt: (Report Builder) ODF namespace ([503d92f](https://github.com/ExaDev/odf.js/commit/503d92f9bab2f08b2e34600e98d9e7e862ed7463))
* stamp resolved paintOrder onto every ContentShape/ContentVector ([925ddb0](https://github.com/ExaDev/odf.js/commit/925ddb03b1cea07d1ea8a18aa173c226cbd50bb1))


### BREAKING CHANGES

* OdbInventory.forms and .reports are now OdbComponentInfo[]
({ name, href, asTemplate? }) rather than string[], and their names come from
content.xml's db:forms/db:reports registry rather than from manifest part paths.
A form's or report's storage directory is named after an opaque persistent name
(forms/Obj11), not after the form or report, so deriving names from part paths
returned "Obj11" on real output instead of "SalesForm"; db:component is the only
place the user-visible name exists, and it carries the href alongside it.

All of this is grounded in a new real fixture,
src/typed/odb/fixtures/form-and-report.odb: an embedded-Firebird .odb with a
live SALES table, a saved query, a bound form with a label, a list box and a
nested sub-form, and a Report Builder report with two nested groups, per-group
SUM footers and a grand total. It was generated through LibreOffice's own
in-process UNO API and never hand-edited, then reopened from disk by LibreOffice
to confirm it reads back correctly.

Two shapes in it contradict what the schema alone suggests, and both would have
been got wrong by assumption: rpt:detail is nested inside the innermost
rpt:group rather than sitting beside the other bands, and a group's key is a
formula (rpt:HASCHANGED("REGION")) rather than a bare column name, with
prefix-character grouping expressed through a generated report-level
rpt:function instead of any group attribute.

## [1.13.2](https://github.com/ExaDev/odf.js/compare/v1.13.1...v1.13.2) (2026-08-02)


### Bug Fixes

* rename ContentSheetPrintSettings.scale to scalePercent for document-schema.js 2.0.0 ([7a5bc58](https://github.com/ExaDev/odf.js/commit/7a5bc585c19dd1f18fdd739d85b606cbf3c54832))

## [1.13.1](https://github.com/ExaDev/odf.js/compare/v1.13.0...v1.13.1) (2026-08-02)

# [1.13.0](https://github.com/ExaDev/odf.js/compare/v1.12.1...v1.13.0) (2026-08-02)


### Features

* build one file per module, add wildcard deep-import exports ([90e16ad](https://github.com/ExaDev/odf.js/commit/90e16ad46c11192d64da5b6c65e9655c80b2570d))

## [1.12.1](https://github.com/ExaDev/odf.js/compare/v1.12.0...v1.12.1) (2026-08-02)

# [1.12.0](https://github.com/ExaDev/odf.js/compare/v1.11.1...v1.12.0) (2026-08-02)


### Features

* ban anything but re-exports in src/index.ts ([058ec10](https://github.com/ExaDev/odf.js/commit/058ec10b3dee943b57ef6311709ef02ddd366cc8))

## [1.11.1](https://github.com/ExaDev/odf.js/compare/v1.11.0...v1.11.1) (2026-08-02)


### Bug Fixes

* don't flag or fix an alias whose source is mutated elsewhere ([2908f46](https://github.com/ExaDev/odf.js/commit/2908f465255481f5a641b78e6b1c6c43ba2fd265))

# [1.11.0](https://github.com/ExaDev/odf.js/compare/v1.10.5...v1.11.0) (2026-08-02)


### Features

* add custom pointless-reassignment autofix rule, ban re-exports outside src/index.ts ([9c7ca19](https://github.com/ExaDev/odf.js/commit/9c7ca199cf6c616680749994444f9d985f4e0780))

## [1.10.5](https://github.com/ExaDev/odf.js/compare/v1.10.4...v1.10.5) (2026-08-02)

## [1.10.4](https://github.com/ExaDev/odf.js/compare/v1.10.3...v1.10.4) (2026-08-01)

## [1.10.3](https://github.com/ExaDev/odf.js/compare/v1.10.2...v1.10.3) (2026-08-01)

## [1.10.2](https://github.com/ExaDev/odf.js/compare/v1.10.1...v1.10.2) (2026-08-01)

## [1.10.1](https://github.com/ExaDev/odf.js/compare/v1.10.0...v1.10.1) (2026-08-01)

# [1.10.0](https://github.com/ExaDev/odf.js/compare/v1.9.0...v1.10.0) (2026-08-01)


### Features

* add readOdbInventory, a typed reader for ODF database package inventories ([89fb54a](https://github.com/ExaDev/odf.js/commit/89fb54a3a700635a234af160a3913481340ab305))

# [1.9.0](https://github.com/ExaDev/odf.js/compare/v1.8.0...v1.9.0) (2026-08-01)


### Features

* add readOdm, a typed reader for ODF master documents ([43ea51b](https://github.com/ExaDev/odf.js/commit/43ea51b5b1acbd3ed06c31ba40e3cae0464adae4))

# [1.8.0](https://github.com/ExaDev/odf.js/compare/v1.7.0...v1.8.0) (2026-07-31)


### Features

* add readOdfFormula, surfacing raw MathML and StarMath annotations ([f3fd726](https://github.com/ExaDev/odf.js/commit/f3fd726eb707191823cf0958d5d39890a26343b2))

# [1.7.0](https://github.com/ExaDev/odf.js/compare/v1.6.0...v1.7.0) (2026-07-31)


### Features

* add readOds, a geometry-and-print-settings-rich spreadsheet reader ([55f8eae](https://github.com/ExaDev/odf.js/commit/55f8eae3990e0d710f49c45020661e5fc96acd00))

# [1.6.0](https://github.com/ExaDev/odf.js/compare/v1.5.0...v1.6.0) (2026-07-31)


### Bug Fixes

* **deps:** lower minimumReleaseAge for CI's frozen-lockfile install ([a264433](https://github.com/ExaDev/odf.js/commit/a26443324e3b8e6d7540fa732277ad0f4789fb4a)), closes [pnpm/pnpm#10361](https://github.com/pnpm/pnpm/issues/10361) [#9997](https://github.com/ExaDev/odf.js/issues/9997) [#10438](https://github.com/ExaDev/odf.js/issues/10438)


### Features

* add an ODF path-data and points-list grammar parser ([cb4e7d8](https://github.com/ExaDev/odf.js/commit/cb4e7d8a7b047a4087d57fc8d6dab6ad7f9a541c))
* add readOdg and extend the shared shape vocabulary with vector primitives ([14b4ef9](https://github.com/ExaDev/odf.js/commit/14b4ef999c978b3b4d765bfd942d1ae939ad9a61))

# [1.5.0](https://github.com/ExaDev/odf.js/compare/v1.4.0...v1.5.0) (2026-07-31)


### Features

* add readOdt, the first end-to-end ODF content reader ([c156e7f](https://github.com/ExaDev/odf.js/commit/c156e7ff61631af7c33a7abd57699267f5d46519))

# [1.4.0](https://github.com/ExaDev/odf.js/compare/v1.3.1...v1.4.0) (2026-07-31)


### Features

* add a deep descendant-element search to the ODF XML query helpers ([d94cf2f](https://github.com/ExaDev/odf.js/commit/d94cf2fcc70242368860d26f679d79b09dcba4cc))
* add readOdp and the shared odp/odg shape vocabulary ([a11f95a](https://github.com/ExaDev/odf.js/commit/a11f95adb17f662bb7c91072c4ad94a20f08026c))
* split cascade.ts's style-chain walk from its property extraction ([0b1444e](https://github.com/ExaDev/odf.js/commit/0b1444e25aa7c94a66f3f79bdaf83fc3cedc69bc))

## [1.3.1](https://github.com/ExaDev/odf.js/compare/v1.3.0...v1.3.1) (2026-07-31)

# [1.3.0](https://github.com/ExaDev/odf.js/compare/v1.2.0...v1.3.0) (2026-07-31)


### Features

* add ODF shared typed primitives (units, a1, colour, geometry, text, cascade, metadata) ([0580e8c](https://github.com/ExaDev/odf.js/commit/0580e8ccb39852a0f311c497dff393e02c1bed8e))

# [1.2.0](https://github.com/ExaDev/odf.js/compare/v1.1.0...v1.2.0) (2026-07-31)


### Features

* add ODF style interning (StyleRegistry, property serialization, span splitting) ([7d5d541](https://github.com/ExaDev/odf.js/commit/7d5d5415818040eeb05c92a136660e0d3db6a9e2))

# [1.1.0](https://github.com/ExaDev/odf.js/compare/v1.0.0...v1.1.0) (2026-07-31)


### Features

* add ODF namespaces, media types, mimetype part, and manifest read/write ([01a39e6](https://github.com/ExaDev/odf.js/commit/01a39e65dc56895e61290b1f14d50c36731d437a))

# 1.0.0 (2026-07-31)


### Features

* scaffold odf.js and build the lossless ZIP-of-XML core ([4c2794a](https://github.com/ExaDev/odf.js/commit/4c2794a88b6ad2adc054535a95272b9a86512983))
