## [8.1.5](https://github.com/ExaDev/documents.js/compare/rtf-codec%408.1.4...rtf-codec%408.1.5) (2026-09-24)


### Dependencies

- Updated archive-codec to 1.11.14

## [8.1.4](https://github.com/ExaDev/documents.js/compare/rtf-codec%408.1.3...rtf-codec%408.1.4) (2026-09-24)


### Dependencies

- Updated byte-codec to 2.0.0
- Updated archive-codec to 1.11.13

## [8.1.3](https://github.com/ExaDev/documents.js/compare/rtf-codec%408.1.2...rtf-codec%408.1.3) (2026-09-23)


### Dependencies

- Updated byte-codec to 1.10.1

## [8.1.2](https://github.com/ExaDev/documents.js/compare/rtf-codec%408.1.1...rtf-codec%408.1.2) (2026-09-23)


### Dependencies

- Updated byte-codec to 1.10.0

## [8.1.1](https://github.com/ExaDev/documents.js/compare/rtf-codec%408.1.0...rtf-codec%408.1.1) (2026-09-23)


### Dependencies

- Updated byte-codec to 1.9.0

## [8.1.0](https://github.com/ExaDev/documents.js/compare/rtf-codec%408.0.2...rtf-codec%408.1.0) (2026-09-22)

### Features

* **rtf-codec:** report a dropped header column via a diagnostic ([2af1e5a](https://github.com/ExaDev/documents.js/commit/2af1e5abd8c4b82694dfc708570735ba8e523344))


### Dependencies

- Updated document-schema.js to 7.15.0
- Updated archive-codec to 1.11.12

## [8.0.2](https://github.com/ExaDev/documents.js/compare/rtf-codec%408.0.1...rtf-codec%408.0.2) (2026-09-22)

### Bug Fixes

* **workspace:** replace the spaced double-hyphen dash substitute with a real em-dash workspace-wide ([c42a9c7](https://github.com/ExaDev/documents.js/commit/c42a9c7e0bc7cd87456ca72204a5ac423a7ca341))


### Dependencies

- Updated byte-codec to 1.8.1
- Updated document-schema.js to 7.14.1
- Updated archive-codec to 1.11.11

## [8.0.1](https://github.com/ExaDev/documents.js/compare/rtf-codec%408.0.0...rtf-codec%408.0.1) (2026-09-21)

### Tests

* **rtf-codec:** pin a table row's isHeader default when no \trowd ever resets it ([b485bcc](https://github.com/ExaDev/documents.js/commit/b485bcc4edcac7891bf252fb153aa7e3c69f3f95))

## [8.0.0](https://github.com/ExaDev/documents.js/compare/rtf-codec%407.0.0...rtf-codec%408.0.0) (2026-09-21)

### ⚠ BREAKING CHANGES

* **rtf-codec:** an RTF row carrying isHeader now writes \trhdr into
  its own \trowd, where nothing was written before. A table whose rows
  state no header flag writes byte identically to before.

### Features

* **rtf-codec:** read and write a table row's \trhdr ([fb94b67](https://github.com/ExaDev/documents.js/commit/fb94b671f9284406dc1bcd74cb946e3b8dbae39f)), references [#1377](https://github.com/ExaDev/documents.js/issues/1377)

### Tests

* **ooxml.js:** type a table fixture row's own header flag ([9ca72f5](https://github.com/ExaDev/documents.js/commit/9ca72f55b95d81c00b3c38c78082ef3020e17f5a)), references [#1377](https://github.com/ExaDev/documents.js/issues/1377)


### Dependencies

- Updated byte-codec to 1.8.0
- Updated document-schema.js to 7.14.0
- Updated archive-codec to 1.11.10

## [7.0.0](https://github.com/ExaDev/documents.js/compare/rtf-codec%406.0.1...rtf-codec%407.0.0) (2026-09-21)

### ⚠ BREAKING CHANGES

* **rtf-codec:** a ContentTable violating the grid rule stated on ContentTableCell
  is now refused rather than written with the offending content silently dropped. A
  caller building a table by hand must give every row one cell per grid column, keep
  a merged region's content on its anchor, and state each span once, on the anchor.

### Bug Fixes

* **rtf-codec:** refuse a table that breaks the grid rule rather than writing past it ([80f3efe](https://github.com/ExaDev/documents.js/commit/80f3efe498d8d492e98fd3baa6d37e2bc6511685))


### Dependencies

- Updated document-schema.js to 7.13.0
- Updated archive-codec to 1.11.9

## [6.0.1](https://github.com/ExaDev/documents.js/compare/rtf-codec%406.0.0...rtf-codec%406.0.1) (2026-09-21)


### Dependencies

- Updated byte-codec to 1.7.0

## [6.0.0](https://github.com/ExaDev/documents.js/compare/rtf-codec%405.0.1...rtf-codec%406.0.0) (2026-09-21)

### ⚠ BREAKING CHANGES

* **rtf-codec:** an RTF table read by this package now has one ContentTableCell per
  grid column in every row. A consumer that padded colSpan - 1 placeholders of its own
  must stop padding and read the array directly.

### Bug Fixes

* **rtf-codec:** give an RTF table one cell per grid column in both directions ([c420617](https://github.com/ExaDev/documents.js/commit/c4206172db669ac444b5ef0bf7ac599a3d4ff667))


### Dependencies

- Updated document-schema.js to 7.12.0
- Updated archive-codec to 1.11.8

## [5.0.1](https://github.com/ExaDev/documents.js/compare/rtf-codec%405.0.0...rtf-codec%405.0.1) (2026-09-20)

### Documentation

* make a hand-typed scoped mutation run find its package's Stryker config ([ed3297b](https://github.com/ExaDev/documents.js/commit/ed3297b6aa71b2d94913519e6960537ca5ac0f61))


### Dependencies

- Updated byte-codec to 1.6.3
- Updated document-schema.js to 7.11.5
- Updated archive-codec to 1.11.7

## [5.0.0](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.4.7...rtf-codec%405.0.0) (2026-09-20)

### ⚠ BREAKING CHANGES

* **rtf-codec:** rtf-codec/base64 no longer exports bytesToBase64,
  which comes from byte-codec now. The module itself remains, and
  still exports this package's own base64ToBytes, which returns
  undefined rather than throwing, and its hex conversion. The
  removal already shipped, unmarked, in 4.4.7.

### Documentation

* **rtf-codec:** state that the base64 encoder moved to byte-codec ([d440556](https://github.com/ExaDev/documents.js/commit/d440556f4e450dc4ae789e7ebc92045e348933da))


### Dependencies

- Updated byte-codec to 1.6.2

## [4.4.7](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.4.6...rtf-codec%404.4.7) (2026-09-20)

### Code Refactoring

* **rtf-codec:** encode base64 through byte-codec ([84b3938](https://github.com/ExaDev/documents.js/commit/84b39382cccb4345ecc80e13aea1ec2cedf04a1c)), references [#SDATA](https://github.com/ExaDev/documents.js/issues/SDATA)


### Dependencies

- Updated byte-codec to 1.6.1
- Updated archive-codec to 1.11.6

## [4.4.6](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.4.5...rtf-codec%404.4.6) (2026-09-20)


### Dependencies

- Updated document-schema.js to 7.11.4
- Updated archive-codec to 1.11.5

## [4.4.5](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.4.4...rtf-codec%404.4.5) (2026-09-15)

### Bug Fixes

* **rtf-codec:** narrow ConstructDescriptor to its anchor member before reading name ([d50cb28](https://github.com/ExaDev/documents.js/commit/d50cb28bfc59ce484b1dfd2386e2824c54c45388))

### Code Refactoring

* **rtf-codec:** call every control-word dispatcher unconditionally, drop their boolean returns ([3d94611](https://github.com/ExaDev/documents.js/commit/3d9461126fb48f58cac8413d44d711f6d57d0bae))
* **rtf-codec:** consolidate control-word dispatchers' per-case return true ([f8a7ec1](https://github.com/ExaDev/documents.js/commit/f8a7ec1b153e542862cc268dbb90a5a07b2cf5c5))
* **rtf-codec:** count braces via matchAll instead of a strip-then-split pass ([807946c](https://github.com/ExaDev/documents.js/commit/807946c8a39aa788aea751374e6b20895d8f4903))
* **rtf-codec:** drop a second redundant objectState !== undefined guard ([cd43569](https://github.com/ExaDev/documents.js/commit/cd43569efae9324ffab145c7ad4e4ae488fb2921))
* **rtf-codec:** drop bounds checks embedded-object.ts's own reads already make redundant ([75ad175](https://github.com/ExaDev/documents.js/commit/75ad1758522c06a4e2ba579df6e9e4c05a1b37c4))
* **rtf-codec:** drop cell-format's no-op default switch case ([1d4a407](https://github.com/ExaDev/documents.js/commit/1d4a407859f78f45578410cc2768178d6d4e2d1b))
* **rtf-codec:** drop codepage.ts's dead empty-input fast path and impossible fallbacks ([48e2ead](https://github.com/ExaDev/documents.js/commit/48e2eade7093c9666ac4a968c38d6e9b24937d69))
* **rtf-codec:** drop columnWidths' own no-op slice bound ([eeee24f](https://github.com/ExaDev/documents.js/commit/eeee24fe5756deda891a895aebb034430b1c021d))
* **rtf-codec:** drop countGroupBraces' redundant length bound ([c4b6d80](https://github.com/ExaDev/documents.js/commit/c4b6d80fb926c607ff3e15dd785c895b90bfd29b))
* **rtf-codec:** drop embedded-object's redundant zero-writes ([c8a68b6](https://github.com/ExaDev/documents.js/commit/c8a68b67de55ef8f888ae3e2c63378b8adb4de0f))
* **rtf-codec:** drop finish()'s own dead zero-sections fallback ([38ffcb9](https://github.com/ExaDev/documents.js/commit/38ffcb92355227d6872fee25d6490384fa387d1d))
* **rtf-codec:** drop header.ts's redundant nameStart tracking ([61ea72b](https://github.com/ExaDev/documents.js/commit/61ea72b6611bf758d7bdb5b7381baf0a8d2695cc))
* **rtf-codec:** drop nine conditional-spread constructions in read.ts ([ca52154](https://github.com/ExaDev/documents.js/commit/ca52154b456a368917e86fd3d6c6aebfb0e061a5))
* **rtf-codec:** drop scanControlWord's redundant cursor bounds and vestigial textStart tracking ([2a77be6](https://github.com/ExaDev/documents.js/commit/2a77be6ec1ddefea2e71b5208a57d823e80d99a1))
* **rtf-codec:** drop skipUnicodeFallback's unreachable mid-token entry ([4ac70e8](https://github.com/ExaDev/documents.js/commit/4ac70e87b3e2ab12255aa5ae5de73a5ff61b3293))
* **rtf-codec:** drop takeRunConstructs' own no-op runs.length filter ([cc874a0](https://github.com/ExaDev/documents.js/commit/cc874a0734ecddb8b953534737f200d374e5418d))
* **rtf-codec:** drop the resolveRows matchIndex===-1 special case ([450134d](https://github.com/ExaDev/documents.js/commit/450134d25518d0fd4555ac74ab4f5f0985413fda))
* **rtf-codec:** drop the unreachable fallback in the single-byte codepage decode ([d7e70cf](https://github.com/ExaDev/documents.js/commit/d7e70cfbc2f221bf661842d38e3ebfbce6f5bc3b))
* **rtf-codec:** drop three redundant destination checks at group-end ([35af891](https://github.com/ExaDev/documents.js/commit/35af891c45b946e1be5c16d112023820ecc1bfb0))
* **rtf-codec:** drop three table-collection sorts that were always no-ops ([fed5385](https://github.com/ExaDev/documents.js/commit/fed5385404eb0365b612b54eb1078c1dd94c75e8))
* **rtf-codec:** drop three unreachable or redundant DTTM/form-field checks ([a4b90ba](https://github.com/ExaDev/documents.js/commit/a4b90ba99b0b11bf2d76fd08bb5630ef8501d9ff))
* **rtf-codec:** drop toggleValue's redundant undefined check ([49d0192](https://github.com/ExaDev/documents.js/commit/49d0192c0fd9223daddc9d6b5213de7822c4dc93))
* **rtf-codec:** drop tokenize's redundant CRLF-merge step and cover two boundary gaps ([253b699](https://github.com/ExaDev/documents.js/commit/253b6995b1fddd44cce528f86350c1187a3c1c53))
* **rtf-codec:** drop two more equivalent constructs in write.ts ([db5dbbc](https://github.com/ExaDev/documents.js/commit/db5dbbcc98a63f45d0bcb1ae4619a507f896159b))
* **rtf-codec:** drop two more equivalent constructs in write.ts ([c2cfe4a](https://github.com/ExaDev/documents.js/commit/c2cfe4a5eaa3d8c6f83fecf2e2d0406852bb47a9))
* **rtf-codec:** eliminate an equivalent loop-bound mutant in encodeAscii ([4d8be60](https://github.com/ExaDev/documents.js/commit/4d8be6081edb3d9b09bd75f4273913c476ff3eb3))
* **rtf-codec:** eliminate equivalent-mutant loop bounds in header.ts ([e617a8d](https://github.com/ExaDev/documents.js/commit/e617a8d9d85ced7690d5b3fd18ca2442f94152f6))
* **rtf-codec:** eliminate several irreducible-equivalent mutation opportunities in read.ts ([fc7be81](https://github.com/ExaDev/documents.js/commit/fc7be81e4ad8440d9ca68f8e7dac3f23ac695ae7))
* **rtf-codec:** eliminate three more equivalent constructs in write.ts ([ae65bc7](https://github.com/ExaDev/documents.js/commit/ae65bc7837c8b5479b9d87e4c68d6089e442d669))
* **rtf-codec:** key runs by JSON-encoded field tuple, not a delimited flag string ([20e921b](https://github.com/ExaDev/documents.js/commit/20e921bec8f5de548a4aadd9e753645856905946))
* **rtf-codec:** pass coalesceRunConstructs' entries directly instead of re-looking them up ([da7fdef](https://github.com/ExaDev/documents.js/commit/da7fdefc228e8cfdd668a514f18cb1f2a7b98c7c))
* **rtf-codec:** remove equivalent-mutant-prone guards and dead boolean returns ([ac05f21](https://github.com/ExaDev/documents.js/commit/ac05f21e2b84986b2e3bca8b828b58537afdb444))
* **rtf-codec:** remove more embedded-object.ts checks and writes that never change the result ([a7fdb16](https://github.com/ExaDev/documents.js/commit/a7fdb168702d80e3f4015329191d96b1d452fb39))
* **rtf-codec:** remove three no-op default:break clauses and a redundant surrogate offset ([ddab5b1](https://github.com/ExaDev/documents.js/commit/ddab5b11e705a0356f0a3d56b015d52b413c8305))
* **rtf-codec:** remove two more redundant range guards in write.ts ([f803b2a](https://github.com/ExaDev/documents.js/commit/f803b2af2d33427bc71495b3a7aba0d18f98ae00))
* **rtf-codec:** remove withoutInvalidSource's redundant record guard ([dc355f0](https://github.com/ExaDev/documents.js/commit/dc355f05eb42c7c9002b2c83b45eb4de3c4601de))
* **rtf-codec:** replace borderControlWords' search with a direct side-to-word lookup ([3c8152d](https://github.com/ExaDev/documents.js/commit/3c8152d16cb3b709445ee70204e34f624723052a))
* **rtf-codec:** replace brace-balance's manual escape scanner with a two-pass regex ([ed76fd9](https://github.com/ExaDev/documents.js/commit/ed76fd90ff8ce05113cfd6ab3ac19117a02f7288))
* **rtf-codec:** stop bounding two byte-loops by a comparison Uint8Array already makes redundant ([53a3aee](https://github.com/ExaDev/documents.js/commit/53a3aee497ac9bc0e955d0fa9a98c1476d3574c9))
* **rtf-codec:** stop varying decodeDbcsBytes' pair-consume step when trail is undefined ([ebcaaa1](https://github.com/ExaDev/documents.js/commit/ebcaaa105e49f59093602199a47d1fd82852e600))
* **rtf-codec:** use an unobservable-safe loop bound in matchingGroupEnd ([e2e11c0](https://github.com/ExaDev/documents.js/commit/e2e11c0f5195c8bf49e8631cf52fac7ca7f9d2e3))

### Documentation

* **rtf-codec:** document applyControlWord's own four-way dispatch fallthrough as equivalent ([8cba286](https://github.com/ExaDev/documents.js/commit/8cba28657ffac7547aa305918dffe858929df37e))
* **rtf-codec:** document six genuinely irreducible equivalent mutants ([1546c63](https://github.com/ExaDev/documents.js/commit/1546c63ba321be2fcd876d7c05007d6e297c3e40))
* **rtf-codec:** document two guards as genuinely irreducible equivalent mutants ([0c60868](https://github.com/ExaDev/documents.js/commit/0c60868cacdb1578f6ad8cd845ccce81060392f6))
* **rtf-codec:** document two more irreducible equivalents in resolveRows' own scan loop ([e1859a5](https://github.com/ExaDev/documents.js/commit/e1859a5d308ed0ffa1fce43018d03d91ec023870))

### Tests

* **rtf-codec:** add a genuine startRun-ordering case to coalesceRunConstructs' sort test ([2c9e5de](https://github.com/ExaDev/documents.js/commit/2c9e5de3fe344a3635e59d1ec95493a3a3fcc108))
* **rtf-codec:** add direct unit coverage for cell-format.ts's exported functions ([6dcd66b](https://github.com/ExaDev/documents.js/commit/6dcd66be5f6c3706407a0797a10b328b2b6c52e6))
* **rtf-codec:** add direct unit coverage for constructs.ts's exported functions ([fd7baf8](https://github.com/ExaDev/documents.js/commit/fd7baf85f7871b9b8c1ea2c87b58091b6d0ecc3d))
* **rtf-codec:** add direct unit coverage for expectBalancedBraces ([9345f21](https://github.com/ExaDev/documents.js/commit/9345f2122097100105bca8f70444dad51e36530e))
* **rtf-codec:** add direct unit coverage for the small byte/error/id utilities ([6e1ff44](https://github.com/ExaDev/documents.js/commit/6e1ff449eb1c2b1e8b5c9d8d841d75d3eaf2bad8))
* **rtf-codec:** assert applyCellDefinitionControlWord's return value and exact border output ([3dd6b2d](https://github.com/ExaDev/documents.js/commit/3dd6b2d58c3f61e520aea4c1851e2671d5f72fa8))
* **rtf-codec:** assert exact diagnostic message text for contentControl gaps ([66f0845](https://github.com/ExaDev/documents.js/commit/66f0845612cff036dc68eed699ad59c90c2b359a))
* **rtf-codec:** assert the exact package-table-dropped message and disjuncts ([4d280e4](https://github.com/ExaDev/documents.js/commit/4d280e4016809b6d969740653840f1bc5995f4c9))
* **rtf-codec:** close a genuine full-run's own real survivors in read.ts ([66ae6d5](https://github.com/ExaDev/documents.js/commit/66ae6d54c7e6ee1bae071fbf3cf02afeeb7fd167))
* **rtf-codec:** close a second round of read.ts survivors after refactoring ([a995c6e](https://github.com/ExaDev/documents.js/commit/a995c6ee392c14f04c0f7bf832bd2b354b604d50))
* **rtf-codec:** close header.ts's business-logic mutation gaps ([e3d2c4d](https://github.com/ExaDev/documents.js/commit/e3d2c4d8197cdec70727113869ce91a937da9ee1))
* **rtf-codec:** close readFontInfo/parseColorTable's remaining coverage gaps ([a56c262](https://github.com/ExaDev/documents.js/commit/a56c262276d968f391de42bfc19566427a0d18bd))
* **rtf-codec:** close resolveRows' own vertical-merge-continuation gaps ([5de7c03](https://github.com/ExaDev/documents.js/commit/5de7c03f4b723275f943aa5d7c3ebaacc5d4f8fd))
* **rtf-codec:** close two more read.ts survivors in extent ordering and bookmark deletion ([a43228f](https://github.com/ExaDev/documents.js/commit/a43228f21b9de0c20affc227f3bd6e059c441840))
* **rtf-codec:** close write.ts form-field crossing and table-collection gaps ([7f61329](https://github.com/ExaDev/documents.js/commit/7f613298e593a1699e7174c48c8a9f130d929f58))
* **rtf-codec:** close write.ts's bookmark and form-field boundary gaps ([adbdf34](https://github.com/ExaDev/documents.js/commit/adbdf344446f9c838aa07da1ec28c8de365397ed))
* **rtf-codec:** close write.ts's cell-image and picture-decode gaps ([e43e840](https://github.com/ExaDev/documents.js/commit/e43e8408b29c2d061938e7772333296cbe19d946))
* **rtf-codec:** close write.ts's last two scoped-run survivors ([1e9a86b](https://github.com/ExaDev/documents.js/commit/1e9a86b9219b37e0eb3bb149b9ebbc1e86a87690))
* **rtf-codec:** close write.ts's list-table, table-guard, and escaping gaps ([fa82929](https://github.com/ExaDev/documents.js/commit/fa829290e97628b000be93cbf1e5d7e2f70c37ca))
* **rtf-codec:** close write.ts's page-geometry and info-group gaps ([df312cc](https://github.com/ExaDev/documents.js/commit/df312cc9cd05e1fee8403c9f17137524d90d60fb))
* **rtf-codec:** close write.ts's paragraph-shell and construct-stack gaps ([64d2e43](https://github.com/ExaDev/documents.js/commit/64d2e43c4deafd6edf42c4a78be6d58708f261c1))
* **rtf-codec:** close write.ts's paragraphProperties gaps ([e0c5744](https://github.com/ExaDev/documents.js/commit/e0c5744842727239005e5563d579469a650ad219))
* **rtf-codec:** close write.ts's picture/object payload gaps ([794e4d1](https://github.com/ExaDev/documents.js/commit/794e4d164aa2d9a08bdcd5a680701aabff1873fb))
* **rtf-codec:** close write.ts's remaining scoped-run survivors ([df4a517](https://github.com/ExaDev/documents.js/commit/df4a517d3884e94a14bfd12f98bc627d3b65dd5e))
* **rtf-codec:** close write.ts's run-property and table-cell gaps ([4ebbfce](https://github.com/ExaDev/documents.js/commit/4ebbfce06febf973569004f78263b3f56492fa72))
* **rtf-codec:** cover \row's own inTable reset with no \pard following it ([dafb2e4](https://github.com/ExaDev/documents.js/commit/dafb2e412b46b838fc190f8a4cc10638442564f9))
* **rtf-codec:** cover a bare \u with no numeric parameter ([e17de48](https://github.com/ExaDev/documents.js/commit/e17de485a0e4cd85a6d4edc71d692c26f0f5580e))
* **rtf-codec:** cover a crash on a bare form-field destination outside any \field group ([7a35cae](https://github.com/ExaDev/documents.js/commit/7a35cae9ff1aa3f476e7d2d48da10dd3a48fd585))
* **rtf-codec:** cover a levelstartat trailing the listlevel's own close ([f678adb](https://github.com/ExaDev/documents.js/commit/f678adbcd8ee371b31c7b1d5f6c4209b16172907))
* **rtf-codec:** cover a nested destination inheriting a picture's own buffer ([5160873](https://github.com/ExaDev/documents.js/commit/516087361e01f14833651470203646e802fb6814))
* **rtf-codec:** cover a stray nested destination sharing bookmark/formField state by reference ([44e054e](https://github.com/ExaDev/documents.js/commit/44e054e442d90f9a78a0b34c1ec62dbfb4b3f660))
* **rtf-codec:** cover a stray non-hex byte inside objdata's SDATA text ([e45f7c5](https://github.com/ExaDev/documents.js/commit/e45f7c5985eb7c2c8a6838e68c6edf93c0c91394))
* **rtf-codec:** cover applyControlWord's own destination-specific gates against a shared reference ([0d8103a](https://github.com/ExaDev/documents.js/commit/0d8103a2e16e892ad91ff28f639c0bdc71e47b2a))
* **rtf-codec:** cover bodyStartIndex not advancing past a non-header group ([e6f6a97](https://github.com/ExaDev/documents.js/commit/e6f6a9747878584b7183bff9e9e1d51cd9522820))
* **rtf-codec:** cover bookmark-name trimming and startFormField's own destination guard ([d36dd17](https://github.com/ExaDev/documents.js/commit/d36dd17979adcf2a76e44b2d0ffd3ca1cbd6e4d6)), references [#PCDATA](https://github.com/ExaDev/documents.js/issues/PCDATA)
* **rtf-codec:** cover decodeCodepageBytes's empty input through the UTF-8 and DBCS paths too ([06782ec](https://github.com/ExaDev/documents.js/commit/06782ecd5d61ae581e1a67719aff7670317daad8))
* **rtf-codec:** cover duplicate-\result/\objdata diagnostics and their exact message text ([0654422](https://github.com/ExaDev/documents.js/commit/0654422c4a06607f53ece97db3c3135b235aaa28))
* **rtf-codec:** cover endCell's own explicit closing-bookmark flush ([5a67298](https://github.com/ExaDev/documents.js/commit/5a67298430cb7d5533d32ee51e636e05a2b27e22))
* **rtf-codec:** cover endSection's own first-section push and breakType key omission ([9c03f5c](https://github.com/ExaDev/documents.js/commit/9c03f5c0d20c0ce439fd0a3c7efafb3e30984f77))
* **rtf-codec:** cover picture/embedded-object state init on a non-picture recognised destination ([9bd0aab](https://github.com/ExaDev/documents.js/commit/9bd0aab7bed338a307ad6f60fd507807117dd5fb))
* **rtf-codec:** cover Presentation field wrong-value rejection and a missing Package stream ([a051eda](https://github.com/ExaDev/documents.js/commit/a051edad4eab0609fae7097f6f68f870758bb713))
* **rtf-codec:** cover readStyle's heading-level precedence and the no-heading case ([b22778d](https://github.com/ExaDev/documents.js/commit/b22778dc0ababe2af0502700e6365e2bf2132750))
* **rtf-codec:** cover resource limits, group dispatch, and control-word switches ([63a7c04](https://github.com/ExaDev/documents.js/commit/63a7c04c92d28528eaf8b2fd8dbd5e6f33fb2a80))
* **rtf-codec:** cover run-identity, unicode-skip, and construct-nesting gaps ([e0bb8c7](https://github.com/ExaDev/documents.js/commit/e0bb8c7d1cbd4c5d8b378e85de476640ba9c66a9))
* **rtf-codec:** cover table row/column, section, picture, and object gaps ([bd95665](https://github.com/ExaDev/documents.js/commit/bd956658017dddcf8cbd4c2104ff9053a48aa6bd))
* **rtf-codec:** cover takeRunConstructs' own sort comparator against reversed push order ([dfb246e](https://github.com/ExaDev/documents.js/commit/dfb246e8ebab9fa1659c1c2be22e0d64335bc101))
* **rtf-codec:** cover the {\info ...} group's remaining fields and a partial colour entry ([61b8bc7](https://github.com/ExaDev/documents.js/commit/61b8bc7b257964a4ae9335868215f333df70992c))
* **rtf-codec:** cover the ASCII-letter and hex-digit boundaries in tokenize.ts ([1b42967](https://github.com/ExaDev/documents.js/commit/1b429677f172bcd383c4f38a38d77089e4b9f267))
* **rtf-codec:** cover tokenize.ts's backslash-CR/LF combinations, bin0, and boundary fallbacks ([4a61e41](https://github.com/ExaDev/documents.js/commit/4a61e41c60be31941c4935cddcf5f1e1840d9ecd))
* **rtf-codec:** cover trailing-byte flush and the header assertion's own three clauses ([7f53c4c](https://github.com/ExaDev/documents.js/commit/7f53c4cd047a03066fda085eef40e600095c4b5c))
* **rtf-codec:** cover unicode-fallback boundaries and bookmark resolution timing ([7f8a7e2](https://github.com/ExaDev/documents.js/commit/7f8a7e22988e2a4efe74cc84326f84c3d8f4e472))
* **rtf-codec:** fix order-dependent header.ts survivor tests, drop a redundant +1 ([5b70403](https://github.com/ExaDev/documents.js/commit/5b70403136b7a012a68df3cca12b6f623c120846))
* **rtf-codec:** isolate addBlocks' own emptiness guard and flushRun call ([ba18a22](https://github.com/ExaDev/documents.js/commit/ba18a22f663ea2e7f5917856828b7ec42e60c8fb))
* **rtf-codec:** isolate beginResultScratch's and endResultScratch's own calls ([b7538cf](https://github.com/ExaDev/documents.js/commit/b7538cf7c6eba4c1589fde03030e2965f4fe82c0))
* **rtf-codec:** prove parseRtfListNumId's index-capture guard is real, not decorative ([f847258](https://github.com/ExaDev/documents.js/commit/f847258980b915b7ecf1a46c1eb2f4ecfac5840d))
* **rtf-codec:** reject an RTF magic prefix that shares only its opening brace ([5420833](https://github.com/ExaDev/documents.js/commit/5420833003f4237f223829f6539cbc13211a8611))
* **rtf-codec:** strengthen two vulnerable-to-merging assertions, cover \sect's own force=true ([8a2efba](https://github.com/ExaDev/documents.js/commit/8a2efbadf4bfae9e1e58cb05c699be76f16f32de))
* **rtf-codec:** verify embedded-object.ts's exact written bytes and remaining boundary checks ([83e6def](https://github.com/ExaDev/documents.js/commit/83e6def37ed0fb5a7b12b126932ef0d056dc4f5e))

### Miscellaneous Chores

* **rtf-codec:** raise the mutation break threshold to 100 ([764f5c5](https://github.com/ExaDev/documents.js/commit/764f5c5dd20e18c0d60892271c779a16fd11b6cc))

## [4.4.4](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.4.3...rtf-codec%404.4.4) (2026-09-14)

### Miscellaneous Chores

* bump pinned pnpm to 12.4.1 across the workspace ([4e81c2d](https://github.com/ExaDev/documents.js/commit/4e81c2dfdb08fff226c20a0f267baffa87758e0f))
* **lint:** except each package's own measured eslint-config 2.12.1 debt ([11c35bc](https://github.com/ExaDev/documents.js/commit/11c35bc61db74c68b4be725c34452509fba00c2a))


### Dependencies

- Updated document-schema.js to 7.11.3
- Updated archive-codec to 1.11.4

## [4.4.3](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.4.2...rtf-codec%404.4.3) (2026-09-13)


### Dependencies

- Updated archive-codec to 1.11.3

## [4.4.2](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.4.1...rtf-codec%404.4.2) (2026-09-13)


### Dependencies

- Updated document-schema.js to 7.11.2
- Updated archive-codec to 1.11.2

## [4.4.1](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.4.0...rtf-codec%404.4.1) (2026-09-11)

### Code Refactoring

* load stryker.config.ts directly instead of a jiti .mjs bootstrap ([4221520](https://github.com/ExaDev/documents.js/commit/42215205caa1c8fc6368ed38729d15836bdd613b))


### Dependencies

- Updated document-schema.js to 7.11.1
- Updated archive-codec to 1.11.1

## [4.4.0](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.3.0...rtf-codec%404.4.0) (2026-09-11)

### Features

* **ci:** gate each measured package on its first CI mutation baseline ([9f8fa69](https://github.com/ExaDev/documents.js/commit/9f8fa6947795b2089bed03c936691893643ce2ae))


### Dependencies

- Updated document-schema.js to 7.11.0
- Updated archive-codec to 1.11.0

## [4.3.0](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.2.5...rtf-codec%404.3.0) (2026-09-11)

### Features

* **rtf-codec:** read and write \super/\sub and \upN/\dnN onto ContentRun.verticalAlign ([34efbd7](https://github.com/ExaDev/documents.js/commit/34efbd7e644c754639c66908700478f2468a8b76))
* **rtf-codec:** read and write cell vertical alignment onto ContentTableCell.verticalAlign ([100ad3f](https://github.com/ExaDev/documents.js/commit/100ad3f3f5f009e110727e4e297e370c4f9ec4fc))
* **rtf-codec:** read and write text direction at all four RTF scopes ([0565a5c](https://github.com/ExaDev/documents.js/commit/0565a5c0bda601e00aa6f4235d8cd6611618e5b7))


### Dependencies

- Updated document-schema.js to 7.10.0
- Updated archive-codec to 1.10.8

## [4.2.5](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.2.4...rtf-codec%404.2.5) (2026-09-11)


### Dependencies

- Updated document-schema.js to 7.9.1
- Updated archive-codec to 1.10.7

## [4.2.4](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.2.3...rtf-codec%404.2.4) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.9.0
- Updated archive-codec to 1.10.6

## [4.2.3](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.2.2...rtf-codec%404.2.3) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.8.0
- Updated archive-codec to 1.10.5

## [4.2.2](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.2.1...rtf-codec%404.2.2) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.7.0
- Updated archive-codec to 1.10.4

## [4.2.1](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.2.0...rtf-codec%404.2.1) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.6.1
- Updated archive-codec to 1.10.3

## [4.2.0](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.1.5...rtf-codec%404.2.0) (2026-09-10)

### Features

* **rtf-codec:** add a LibreOffice-produced real-rtf corpus layer ([c4fa340](https://github.com/ExaDev/documents.js/commit/c4fa3405b83b9b159c711d97d5a2fe968fb700c8))

## [4.1.5](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.1.4...rtf-codec%404.1.5) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.6.0
- Updated archive-codec to 1.10.2

## [4.1.4](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.1.3...rtf-codec%404.1.4) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.5.1
- Updated archive-codec to 1.10.1

## [4.1.3](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.1.2...rtf-codec%404.1.3) (2026-09-08)


### Dependencies

- Updated archive-codec to 1.10.0

## [4.1.2](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.1.1...rtf-codec%404.1.2) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.5.0
- Updated archive-codec to 1.9.2

## [4.1.1](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.1.0...rtf-codec%404.1.1) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.4.0
- Updated archive-codec to 1.9.1

## [4.1.0](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.0.9...rtf-codec%404.1.0) (2026-09-08)

### Features

* **rtf-codec:** decode East Asian DBCS code pages via a lead-byte state machine ([e0fbe75](https://github.com/ExaDev/documents.js/commit/e0fbe7550dcff586816a9e159d56192d36f955e7))
* **rtf-codec:** generate DBCS byte-to-character tables for code pages 932/936/949/950/1361 ([254f1a6](https://github.com/ExaDev/documents.js/commit/254f1a6279372d93504a5dc3d6aab8c306e24331))

### Documentation

* **rtf-codec:** document East Asian DBCS code page support ([9d1a53b](https://github.com/ExaDev/documents.js/commit/9d1a53bb8c72084e225173541fbe0a9d576bb9ef))

## [4.0.9](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.0.8...rtf-codec%404.0.9) (2026-09-08)


### Dependencies

- Updated archive-codec to 1.9.0

## [4.0.8](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.0.7...rtf-codec%404.0.8) (2026-09-08)


### Dependencies

- Updated archive-codec to 1.8.0

## [4.0.7](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.0.6...rtf-codec%404.0.7) (2026-09-08)


### Dependencies

- Updated archive-codec to 1.7.2

## [4.0.6](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.0.5...rtf-codec%404.0.6) (2026-09-08)

### Bug Fixes

* **deps:** pin @vitest/coverage-v8 to match its vitest runner ([6912e0e](https://github.com/ExaDev/documents.js/commit/6912e0e5c602f0c21d9df12d2dc9899422bf5bd2))

### Miscellaneous Chores

* **deps:** pin every workspace dependency to an exact fixed version ([6a38142](https://github.com/ExaDev/documents.js/commit/6a38142facc043dfa499573f37431d3b32ff602e))


### Dependencies

- Updated document-schema.js to 7.3.1
- Updated archive-codec to 1.7.1

## [4.0.5](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.0.4...rtf-codec%404.0.5) (2026-09-08)


### Dependencies

- Updated archive-codec to ^1.7.0

## [4.0.4](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.0.3...rtf-codec%404.0.4) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.3.0
- Updated archive-codec to ^1.6.8

## [4.0.3](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.0.2...rtf-codec%404.0.3) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.2.0
- Updated archive-codec to ^1.6.7

## [4.0.2](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.0.1...rtf-codec%404.0.2) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.1.0
- Updated archive-codec to ^1.6.6

## [4.0.1](https://github.com/ExaDev/documents.js/compare/rtf-codec%404.0.0...rtf-codec%404.0.1) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.0.0
- Updated archive-codec to ^1.6.5

## [4.0.0](https://github.com/ExaDev/documents.js/compare/rtf-codec%403.0.4...rtf-codec%404.0.0) (2026-09-07)

### ⚠ BREAKING CHANGES

* **rtf-codec:** resolve partially-shaded cell fills to real pattern fills

### Features

* **rtf-codec:** resolve partially-shaded cell fills to real pattern fills ([dc97e88](https://github.com/ExaDev/documents.js/commit/dc97e88b61c988ed29aeebe2ccb082feab417413))

## [3.0.4](https://github.com/ExaDev/documents.js/compare/rtf-codec%403.0.3...rtf-codec%403.0.4) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.3
- Updated archive-codec to ^1.6.4

## [3.0.3](https://github.com/ExaDev/documents.js/compare/rtf-codec%403.0.2...rtf-codec%403.0.3) (2026-09-07)

### Bug Fixes

* **rtf-codec:** sanitize invalid source residue before validating embedded objects ([174a098](https://github.com/ExaDev/documents.js/commit/174a09898b18e462bebd5931f4bcabe24705357a))


### Dependencies

- Updated document-schema.js to ^6.2.2
- Updated archive-codec to ^1.6.3

## [3.0.2](https://github.com/ExaDev/documents.js/compare/rtf-codec%403.0.1...rtf-codec%403.0.2) (2026-09-07)

### Bug Fixes

* **rtf-codec:** drop the later of two crossing bookmark block extents ([8b4800c](https://github.com/ExaDev/documents.js/commit/8b4800cc3187655be2c1f293a7cec203727b38c1)), closes [ExaDev/documents.js#1040](https://github.com/ExaDev/documents.js/issues/1040)


### Dependencies

- Updated document-schema.js to ^6.2.1
- Updated archive-codec to ^1.6.2

## [3.0.1](https://github.com/ExaDev/documents.js/compare/rtf-codec%403.0.0...rtf-codec%403.0.1) (2026-09-06)


### Dependencies

- Updated document-schema.js to ^6.2.0
- Updated archive-codec to ^1.6.1

## [3.0.0](https://github.com/ExaDev/documents.js/compare/rtf-codec%402.1.0...rtf-codec%403.0.0) (2026-09-06)

### ⚠ BREAKING CHANGES

* **rtf-codec:** RtfDiagnosticCodes.EMBEDDED_OBJECT_DROPPED, a public
  export since rtf-codec@1.0.0, is removed with no replacement and no
  deprecated alias, since every embeddedObject block now writes
  successfully and the code it named is unreachable.

### Features

* **rtf-codec:** build a real OLE compound file for an embedded object's \objdata ([96c5ad6](https://github.com/ExaDev/documents.js/commit/96c5ad63aac6753f941276f623ea2e73b869e86b))
* **rtf-codec:** map RTF form fields to the contentControl construct ([5eafb9e](https://github.com/ExaDev/documents.js/commit/5eafb9e7d204df956fb404345855446386a107b4))
* **rtf-codec:** read and write a dropdown's selected \ffl entry ([a537e1b](https://github.com/ExaDev/documents.js/commit/a537e1b75e92b155bbe926012c8e700aa5cf6e76))
* **rtf-codec:** report a dropDown's unmatched value through the diagnostic sink ([70f1b71](https://github.com/ExaDev/documents.js/commit/70f1b71d2aaab5d5b479860568e5b5363adae2b1))
* **rtf-codec:** truncate a dropDown's options at MS-DOC's 25-entry cap ([57d279c](https://github.com/ExaDev/documents.js/commit/57d279cd28c1ec7dcbe3d8f1eb9a99fa62ce4f7b))

### Bug Fixes

* **rtf-codec:** actually order a formfield payload's fields per RTF's grammar ([ead107d](https://github.com/ExaDev/documents.js/commit/ead107dada5794baff9a53e6a7039e7f3a5b7b31))
* **rtf-codec:** anchor form-field instruction keywords on the leading token ([711dc73](https://github.com/ExaDev/documents.js/commit/711dc732a622fe87619486a1467987377e92ac59))
* **rtf-codec:** decode \objdata as one ordered byte sequence, not two buffers ([46477c2](https://github.com/ExaDev/documents.js/commit/46477c28ce0afa64801150a7ffa93d24eee6e9e0)), references [#SDATA](https://github.com/ExaDev/documents.js/issues/SDATA)
* **rtf-codec:** default a bare \ffres/\ffdefres to 0, not undefined ([4189dd8](https://github.com/ExaDev/documents.js/commit/4189dd85ce791aedc622edb6479185dc543870a0))
* **rtf-codec:** default bare \ffownhelp/\ffprot to false, matching their Value-word classification ([b7e2757](https://github.com/ExaDev/documents.js/commit/b7e27573e19e07c6774b4a463f1426633d902547))
* **rtf-codec:** default fOwnHelp to false when \ffownhelp is absent from a form field ([bc096e6](https://github.com/ExaDev/documents.js/commit/bc096e639e6f968192d8df4c6b479bc6be8d2a5c))
* **rtf-codec:** diagnose \result's fallback when \object has no \objdata at all ([110609f](https://github.com/ExaDev/documents.js/commit/110609f63a5d9f659aa393f3e4489c109d036cf6))
* **rtf-codec:** drain unmatched form-field extents at paragraph end ([7fde988](https://github.com/ExaDev/documents.js/commit/7fde988f123a2e661fb5c4632a2478fe66b8d7a1))
* **rtf-codec:** drop a contentControl extent that crosses another instead of mis-nesting both ([f953370](https://github.com/ExaDev/documents.js/commit/f9533705a589c600650d198a839d8ef08d8fcd4d))
* **rtf-codec:** fall through a dropdown's undefined ffres sentinel to ffdefres ([ed9d4f4](https://github.com/ExaDev/documents.js/commit/ed9d4f4049e9daf9807baecaf792d3ce8bf6e591))
* **rtf-codec:** fix ffhaslistbox and ffdefres minting for a dropDown form field ([e1a0cfa](https://github.com/ExaDev/documents.js/commit/e1a0cfafb1a83d3850cbdde2c2c1a18079d879bb))
* **rtf-codec:** flush a cell's pending paragraph separator before a construct marker ([917641a](https://github.com/ExaDev/documents.js/commit/917641ac13fa7c1797c701b778e37509e4fdf955))
* **rtf-codec:** frame embedded-object data as a real MS-OLEDS EmbeddedObject ([b78c562](https://github.com/ExaDev/documents.js/commit/b78c562d7669c7069074676380a3c0861d62b84c))
* **rtf-codec:** mint a dropDown's \ffhaslistbox with its explicit 1 ([3d4f658](https://github.com/ExaDev/documents.js/commit/3d4f6581e0bfdbe0f200708db81a8fb4dda1b696))
* **rtf-codec:** mint ffhaslistbox and ffdefres when writing a dropDown form field ([7aad61f](https://github.com/ExaDev/documents.js/commit/7aad61fa59865021adabbf1020f68a87d59588a0))
* **rtf-codec:** name truncation, not a false mismatch, for a truncated dropDown selection ([9778953](https://github.com/ExaDev/documents.js/commit/9778953178a1cb1d73fe9c4cb75cbfa0b78df3c4))
* **rtf-codec:** order a \*\formfield payload's fields to match RTF's own grammar production ([919c1ff](https://github.com/ExaDev/documents.js/commit/919c1ff53c23f27e168ca853bf0d64d981f31ddd))
* **rtf-codec:** pair a form field's open/close on formFieldStarted, not a re-derived match ([75b6aa2](https://github.com/ExaDev/documents.js/commit/75b6aa2524a124d3e9d41686c9ec31cb3526e627))
* **rtf-codec:** read \ffdefres before \ffres for a checkbox's checked state ([30e258f](https://github.com/ExaDev/documents.js/commit/30e258f4a39ebe800294c5c26fd1a2aed154fbc2))
* **rtf-codec:** read \ffownhelp0 so auto-generated help text doesn't surface as an alias ([ff8cfe4](https://github.com/ExaDev/documents.js/commit/ff8cfe43efc0e252c819994c5ba809563500a721))
* **rtf-codec:** read a bare \ffownhelp as true, not the Value-word 0-default ([cd72202](https://github.com/ExaDev/documents.js/commit/cd72202a204f0ee6cfab08cb506f39662bb988e3))
* **rtf-codec:** recognise \oleclsid as a spec-legal \object sub-group ([616efe4](https://github.com/ExaDev/documents.js/commit/616efe471d81c5b957a1e1c21a1c9ed837e01ba1)), references [#PCDATA](https://github.com/ExaDev/documents.js/issues/PCDATA)
* **rtf-codec:** recognise and silently skip the remaining formstrings destinations ([1089d4d](https://github.com/ExaDev/documents.js/commit/1089d4d2de69d1bfc906e0048525e1176283ece0))
* **rtf-codec:** recover \result's fallback when \intbl is restated on \result's own group ([1b93875](https://github.com/ExaDev/documents.js/commit/1b9387557466533db2140a468bade73bd0048f8f))
* **rtf-codec:** recover \result's fallback when \object sits in a cell ([e9ea8ea](https://github.com/ExaDev/documents.js/commit/e9ea8eadbc3f21239277cd28f3405b08dbffe4b0))
* **rtf-codec:** recover \result's own paragraphs when \objdata cannot decode ([5de2614](https://github.com/ExaDev/documents.js/commit/5de2614f3b0bdd5914b83d6421a703849d233d17))
* **rtf-codec:** remove unreachable startRun check from form field close loop ([807ab05](https://github.com/ExaDev/documents.js/commit/807ab057fb5be49dc055e91f42470a0940f7a161))
* **rtf-codec:** render \result's fallback in an isolated scratch accumulator ([6c5de47](https://github.com/ExaDev/documents.js/commit/6c5de478fc194f9a7a2c465812875906614b8871))
* **rtf-codec:** report a checkbox's recorded value and cross-type fields rather than dropping them ([f83a8ed](https://github.com/ExaDev/documents.js/commit/f83a8edfe12a400d647cfb82b0cafacd5e8174e6))
* **rtf-codec:** report a dropDown's stray checked state through the diagnostic sink ([629cd49](https://github.com/ExaDev/documents.js/commit/629cd4929c44771e83e18320025cbb4e2f20f2f9))
* **rtf-codec:** report a form field's contentControl when \fldrslt spans a paragraph or cell ([f1f917b](https://github.com/ExaDev/documents.js/commit/f1f917b5c0b2c4dd32f2397510826e4cb75c0e93))
* **rtf-codec:** report a non-paragraph block dropped from a table cell ([ff76ff8](https://github.com/ExaDev/documents.js/commit/ff76ff873dc791e7e6c0ca411fa8d134d8c9a065))
* **rtf-codec:** report a partial \objw/\objh size hint instead of dropping it ([399338b](https://github.com/ExaDev/documents.js/commit/399338bf9a819694658326e57322e0e0bf6863ba))
* **rtf-codec:** report a plainText value written into \ffdeftext through the diagnostic sink ([c91dd9e](https://github.com/ExaDev/documents.js/commit/c91dd9eb3291b815c7649cfb2dc906a43c0a0e4e))
* **rtf-codec:** resolve \object's \result fallback before either sibling is read ([7897f20](https://github.com/ExaDev/documents.js/commit/7897f20b00e8731f5d21945e48aa7e70e2bf81e1))
* **rtf-codec:** restore real body when \result never closes ([c21a722](https://github.com/ExaDev/documents.js/commit/c21a72269c3ccc1f27aff8a31076d67eee3d083b))
* **rtf-codec:** retract \result's fallback once \objdata decodes, not via a lookahead ([6fcf7e8](https://github.com/ExaDev/documents.js/commit/6fcf7e8b0f8480e89581e4ad35e9ed24a28b5d59))
* **rtf-codec:** state the real reason a run-scoped contentControl drops ([2756842](https://github.com/ExaDev/documents.js/commit/27568429e87d77823694b171b20dbb79489af5f0))
* **rtf-codec:** stop a doctored \objdata payload overriding the block's kind ([3eaab96](https://github.com/ExaDev/documents.js/commit/3eaab962e792137eaaf8c4a69461a8077508e70b))
* **rtf-codec:** stop a nested group from re-firing \object/\objdata's own group-end handler ([677ce19](https://github.com/ExaDev/documents.js/commit/677ce1907832308fac697dae441bf980f0054c43))
* **rtf-codec:** stop a nested group inside \pict re-finalising the same picture ([b84c7a1](https://github.com/ExaDev/documents.js/commit/b84c7a10ad81096c66274fb122354700acb66e12))
* **rtf-codec:** stop collecting a form field's default text nowhere reads back ([3ef2a8c](https://github.com/ExaDev/documents.js/commit/3ef2a8c26b9ca2d6adc1b6b9a56b25511154a1e4))
* **rtf-codec:** stop discarding a dropDown selection that is a real empty-string option ([4602d1d](https://github.com/ExaDev/documents.js/commit/4602d1dceec771ad0769202b7357a5b26de6a057))
* **rtf-codec:** stop dropping a plainText form field's value ([371e606](https://github.com/ExaDev/documents.js/commit/371e606718147ff95a75937936f6e5c71d5f9938))
* **rtf-codec:** stop fabricating a default index for a dropDown's unselected value ([5220cd3](https://github.com/ExaDev/documents.js/commit/5220cd3a8ae5b4af37e5ac82d6205d3f7cd6d5a0))
* **rtf-codec:** stop flagging an empty options array as dropped data ([1228997](https://github.com/ExaDev/documents.js/commit/1228997579a41a6ac6e0af838eb0a7193d30d356))
* **rtf-codec:** stop form-field writer emitting unbalanced braces for a controlType it can't mint ([f2f2422](https://github.com/ExaDev/documents.js/commit/f2f2422cd96957d4eb3345fa9a0b4ed0a2705966))
* **rtf-codec:** stop fragmenting ordinary field text into extra runs ([6e94bbc](https://github.com/ExaDev/documents.js/commit/6e94bbcd791320edfa8e6c4b77cda0570bcc8213))
* **rtf-codec:** stop opening a Word-shaped nested \fldinst group's contentControl twice ([db52621](https://github.com/ExaDev/documents.js/commit/db52621a4a5d80073160ed394b3d0d6603fc29ed))
* **rtf-codec:** stop reporting a plainText form field's default text as its current value ([4acfc9d](https://github.com/ExaDev/documents.js/commit/4acfc9d374ec84541f9c7a16f88cac721b857a58))
* **rtf-codec:** stop silently dropping a form field's alias and lock ([9bad313](https://github.com/ExaDev/documents.js/commit/9bad3139a2737d7eaaa305bb2c99310e5dde2e9b))
* **rtf-codec:** stop stray par/page inside a form field destination splitting the document ([acb72ce](https://github.com/ExaDev/documents.js/commit/acb72ce1bbdf1e7848288ff6a6339b1148b1eb05))
* **rtf-codec:** treat a checkbox's \ffres as FFDataBits' own sentinel, not a constant to skip ([79e4870](https://github.com/ExaDev/documents.js/commit/79e487003b2ac2f6e7434f702992901edcb5132c))
* **rtf-codec:** treat a plainText contentControl's empty-string value as absent ([46b21e5](https://github.com/ExaDev/documents.js/commit/46b21e5f6d983ad3d9f1f1273a3fadd05059d87d))
* **rtf-codec:** treat an empty-string checkbox/dropDown value as absent ([198a26d](https://github.com/ExaDev/documents.js/commit/198a26dba8b1cc6379959290ed1760c20c2b7ae5))
* **rtf-codec:** trim a contentControl's alias/tag before writing \ffhelptext/\ffname ([acf2cc3](https://github.com/ExaDev/documents.js/commit/acf2cc310f12de40c56c745c6812d052eb2d5094))
* **rtf-codec:** validate an embedded object's residue before carrying it through ([36a8ed8](https://github.com/ExaDev/documents.js/commit/36a8ed86578031da2f1befd077f7f47d9f404f38))
* **rtf-codec:** write \ffres for a checkbox's own current state ([6b0f9ea](https://github.com/ExaDev/documents.js/commit/6b0f9ea095ae2e69e2390a6a86d58e4ae83965aa))
* **rtf-codec:** write \fftypeN on every minted form field ([0fc4dec](https://github.com/ExaDev/documents.js/commit/0fc4dec492cf9a082fdb4484aab3a10b107b8911))
* **rtf-codec:** write and validate the mandatory Presentation field in \objdata ([85b5eaa](https://github.com/ExaDev/documents.js/commit/85b5eaacad5c6a06688b13e6a0cc3d80cb469c87))
* **rtf-codec:** write constructStart/constructEnd markers inside table cells ([fe28d7d](https://github.com/ExaDev/documents.js/commit/fe28d7d3e29aad826c58600699a3441536a4d8ce))
* **rtf-codec:** write ffprot's explicit parameter and split its lock diagnostic ([bbc71ad](https://github.com/ExaDev/documents.js/commit/bbc71ad7538dde596649005e4698c8eb8ef36729))
* **rtf-codec:** write image and embedded-object blocks placed directly in a table cell ([042d4e8](https://github.com/ExaDev/documents.js/commit/042d4e855f9a3bcfd40924e58f95e3e1e78158b5))

### Code Refactoring

* **rtf-codec:** drop countGroupBraces's unused export ([f84fdd4](https://github.com/ExaDev/documents.js/commit/f84fdd4a1a6c84f48d52428274b7802cfb22e489))

### Documentation

* **rtf-codec:** cite <objhw> rather than <objsize> for the \objw/\objh pair ([fae8446](https://github.com/ExaDev/documents.js/commit/fae84460d4b7d72bb212d0637da0e022f6efa61e))
* **rtf-codec:** cite RTF 1.9.1's real Form Fields grammar instead of claiming none exists ([b5eb15f](https://github.com/ExaDev/documents.js/commit/b5eb15f0944a9e0cb6b1c21622e707c8e108cf7b))
* **rtf-codec:** correct stale references in the form-field sentinel comments ([cb29f5f](https://github.com/ExaDev/documents.js/commit/cb29f5fbfeb2eeaa92f39db84e347ff718b65974))
* **rtf-codec:** correct the claimed permissiveness of \obj's <objdata>/<result> ordering ([becb2f7](https://github.com/ExaDev/documents.js/commit/becb2f7df4df859ee764985436f7fda222ce4d8b))
* **rtf-codec:** correct the claimed splice position of \result's fallback ([230790d](https://github.com/ExaDev/documents.js/commit/230790d18452936f8ecfe075776b8175db3fa7bc))
* **rtf-codec:** correct the dropdown ffres/ffdefres omission rationale ([7987f0c](https://github.com/ExaDev/documents.js/commit/7987f0c6f49fc4161781e4c7e49370d53dc3ef75))
* **rtf-codec:** correct the form-field payload paragraph and add ffdeftext/ffprot1/ffownhelp notes ([1c89ca5](https://github.com/ExaDev/documents.js/commit/1c89ca58021beef323623651f34de4eb231e7503))
* **rtf-codec:** correct the form-field read row and document the checkbox/plainText value gaps ([78f677c](https://github.com/ExaDev/documents.js/commit/78f677cde56c90f5709b883c7e37331b08415c4e))
* **rtf-codec:** correct which field of \objdata is the real compound file ([44d953b](https://github.com/ExaDev/documents.js/commit/44d953b7fb23789f123d524c01b0d35ba75fe45f))
* **rtf-codec:** correct which spec section requires FormatID 0x00000002 ([4110257](https://github.com/ExaDev/documents.js/commit/411025786e935301a8b3ed3c96e7c48768633106))
* **rtf-codec:** describe \objdata's own hex payload as the full EmbeddedObject envelope ([5623ff5](https://github.com/ExaDev/documents.js/commit/5623ff5b057922bc361338fa6776607717adb368))
* **rtf-codec:** describe the real ObjectHeader/NativeDataSize \objdata framing ([3bd110c](https://github.com/ExaDev/documents.js/commit/3bd110c508706911ad2703a02ec2cbf8b8717ffe))
* **rtf-codec:** describe the table-cell write gap as table/pageBreak only ([36c730d](https://github.com/ExaDev/documents.js/commit/36c730da6227b9e37aa2588c7a94f419c54d8230))
* **rtf-codec:** document the form-field contentControl mapping ([0c04168](https://github.com/ExaDev/documents.js/commit/0c04168c06de372c0d185980d9539f2cea8ab9ae))
* **rtf-codec:** document the OLE embedded-object mechanism and the archive-codec dependency ([37ef85d](https://github.com/ExaDev/documents.js/commit/37ef85d987c969b055b3dbdb59e5fac12ef47f4b))
* **rtf-codec:** document the write-side drop for crossing contentControl extents ([bccb85e](https://github.com/ExaDev/documents.js/commit/bccb85ee37e65f17064cd0df281794aba4780d76))
* **rtf-codec:** fix a wrong wDef citation in the ffdeftext omission comment ([b9b7be9](https://github.com/ExaDev/documents.js/commit/b9b7be97da910cbeefe67b7efc37b66d0161fd33))
* **rtf-codec:** fix comment claiming a FORMDROPDOWN fixture never sees a value ([a5cb7f6](https://github.com/ExaDev/documents.js/commit/a5cb7f632f3f8b044bf2e2a4f9556f2c7f3dbae8))
* **rtf-codec:** fix FFDataBits' MS-DOC section number, mislabeled as FFData's 2.9.78 ([15538db](https://github.com/ExaDev/documents.js/commit/15538db2fddc68c3887bb234f891b9d8939c3e28))
* **rtf-codec:** qualify the writer's embeddedObject claim for table cells ([891ffe1](https://github.com/ExaDev/documents.js/commit/891ffe1edef50341c21fa451a759278d8b5cbaea))
* **rtf-codec:** quote FFData.xstzTextDef's real MS-DOC text and note value's write-only direction ([e8b04c4](https://github.com/ExaDev/documents.js/commit/e8b04c4c99750db4fc49230d90dc469ac5a19639))
* **rtf-codec:** quote RTF's Toggle definition in full and fix \b's citation ([6ea9562](https://github.com/ExaDev/documents.js/commit/6ea9562b300617b42a060837bed43bdd67238a51))
* **rtf-codec:** separate the Value-word default rule from its classification ([d7f5193](https://github.com/ExaDev/documents.js/commit/d7f5193a8834510ab2a08a9ba8806adb887019c2))
* **rtf-codec:** stop attributing formfield field order to a nonexistent RTF grammar production ([39c7cfa](https://github.com/ExaDev/documents.js/commit/39c7cfa847002dde7a1eccb54e3d119f09e922e1))
* **rtf-codec:** stop calling LibreOffice's bare \ffownhelp emission unconditional ([32caa84](https://github.com/ExaDev/documents.js/commit/32caa84be6cb8171b711fccfab51cd7a55893691))
* **rtf-codec:** stop claiming a bare \ffprot fixture proves what real producers write ([fe365f2](https://github.com/ExaDev/documents.js/commit/fe365f2df4595e7e07a1f73f3d9d1e12a85e34a3))
* **rtf-codec:** stop claiming the reader has a bare-\ffhaslistbox default ([c394521](https://github.com/ExaDev/documents.js/commit/c39452168bfa17d1ef3dc90bde15c073add15c0b))

### Styles

* **rtf-codec:** realign the deliberately-not-handled table's Construct column ([89acaeb](https://github.com/ExaDev/documents.js/commit/89acaebbc767920c7f27f0268c3941aee07209fe))

### Tests

* **rtf-codec:** assert brace balance across the write test suite ([a215ab0](https://github.com/ExaDev/documents.js/commit/a215ab08fdb92f33655662994c0b95e66a9a7dab))
* **rtf-codec:** assert the explicit \ffhaslistbox1 form, not a bare substring ([ef7ce6a](https://github.com/ExaDev/documents.js/commit/ef7ce6a8efe2763c9bcdb4c1803be386075cac4b))
* **rtf-codec:** assert the split-lock diagnostic's actual message text, not just its code ([9d55533](https://github.com/ExaDev/documents.js/commit/9d5553393c5e97ef9b0055b63fb1e92d8cd0f3ed))
* **rtf-codec:** correct the LinkedObject FormatID test's claim about ObjectHeader's own spec text ([36d1f33](https://github.com/ExaDev/documents.js/commit/36d1f33232fa4bc4d1b071fdc025e928239e7602))
* **rtf-codec:** cover \binN and \'hh-delivered \objdata payloads ([7b71dc0](https://github.com/ExaDev/documents.js/commit/7b71dc0649a09139282e4179361c8577115cad29)), references [#BDATA](https://github.com/ExaDev/documents.js/issues/BDATA) [#SDATA](https://github.com/ExaDev/documents.js/issues/SDATA) [#SDATA](https://github.com/ExaDev/documents.js/issues/SDATA)
* **rtf-codec:** cover embedded-object round-tripping and the foreign-payload degrade path ([6f22cbc](https://github.com/ExaDev/documents.js/commit/6f22cbca7b5e4afffb7332e935b96b877afbc806))
* **rtf-codec:** cover the form-field contentControl round trip ([6f7ee62](https://github.com/ExaDev/documents.js/commit/6f7ee623ca8a9dde2a95c19ec72351beddc1fb2a))
* **rtf-codec:** cover the ObjectHeader framing and the \result recovery path ([5ae34c8](https://github.com/ExaDev/documents.js/commit/5ae34c8c056047704272cc2f15e2dc80ca396a5b))


### Dependencies

- Updated archive-codec to ^1.6.0

## [2.1.0](https://github.com/ExaDev/documents.js/compare/rtf-codec%402.0.0...rtf-codec%402.1.0) (2026-09-06)

### Features

* **workspace:** add per-package Stryker mutation testing configuration ([ff3eacc](https://github.com/ExaDev/documents.js/commit/ff3eacc124577b163a1c13a63b83484d9611ae5a))

### Bug Fixes

* **workspace:** drop the unused per-package @stryker-mutator/api dependency ([69270b6](https://github.com/ExaDev/documents.js/commit/69270b6e7ad7163c3b76cd085f4e5f367433994c))


### Dependencies

- Updated document-schema.js to ^6.1.0

## [2.0.0](https://github.com/ExaDev/documents.js/compare/rtf-codec%401.1.2...rtf-codec%402.0.0) (2026-09-06)

### ⚠ BREAKING CHANGES

* **rtf-codec:** readRtfContent's ContentTableCell.background is now a
  discriminated ContentCellFill rather than a bare Color, matching
  document-schema.js's own breaking change to the shared schema.
  writeRtfContent's cell background parameter changes the same way. A
  caller reading a background as a Color directly, or constructing one,
  must wrap/unwrap it as { kind: 'solid', color }.

### Bug Fixes

* **rtf-codec:** adapt cell background to the new discriminated fill shape ([f6de374](https://github.com/ExaDev/documents.js/commit/f6de3745a7b03e256c80eb20f38a1e0717daac1e)), references [ExaDev/documents.js#951](https://github.com/ExaDev/documents.js/issues/951)

### Build System

* typecheck test/workers across every package where it is currently clean ([f340428](https://github.com/ExaDev/documents.js/commit/f340428b51a669010c0c4e5edb4310fe6ea4789a)), closes [#1021](https://github.com/ExaDev/documents.js/issues/1021)


### Dependencies

- Updated document-schema.js to ^6.0.0

## [1.1.2](https://github.com/ExaDev/documents.js/compare/rtf-codec%401.1.1...rtf-codec%401.1.2) (2026-09-05)

### Bug Fixes

* handle ContentImageBlock's widened svg/gif formats across every consumer ([875b10b](https://github.com/ExaDev/documents.js/commit/875b10b3281ca1ab598abc97230d82f8ff5cdaae))


### Dependencies

- Updated document-schema.js to ^5.6.0

## [1.1.1](https://github.com/ExaDev/documents.js/compare/rtf-codec%401.1.0...rtf-codec%401.1.1) (2026-09-04)


### Dependencies

- Updated document-schema.js to ^5.5.1

## [1.1.0](https://github.com/ExaDev/documents.js/compare/rtf-codec%401.0.0...rtf-codec%401.1.0) (2026-09-03)

### Features

* **rtf-codec:** apply listoverridetable's own \lfolevel level overrides ([88e5291](https://github.com/ExaDev/documents.js/commit/88e5291834804dd98f96b9a6865c6fff1f9109b1))
* **rtf-codec:** map bookmarks onto the anchor construct vocabulary ([06c2920](https://github.com/ExaDev/documents.js/commit/06c29202f9f7deb3131d0a1bc9ff361584dd0e8f)), references [#PCDATA](https://github.com/ExaDev/documents.js/issues/PCDATA)
* **rtf-codec:** map revision marks onto the provenance construct vocabulary ([6a0dba5](https://github.com/ExaDev/documents.js/commit/6a0dba55aa289598416c7804047d5bf26ab1ceda))
* **rtf-codec:** read and write cell borders, shading, and both merge directions ([8beecb5](https://github.com/ExaDev/documents.js/commit/8beecb5715867cdc60f81f5d711639f2841e2111))
* **rtf-codec:** read and write multiple sections ([fd7c8d0](https://github.com/ExaDev/documents.js/commit/fd7c8d0597b8b3653c37f8ea07a697ec77e0fa96))

### Documentation

* **rtf-codec:** restate the scope tables for what the codec now carries ([c90f453](https://github.com/ExaDev/documents.js/commit/c90f453f547e81c6bfe10b62b701ea4d89103259))


### Dependencies

- Updated document-schema.js to ^5.5.0

## 1.0.0 (2026-09-03)

### Features

* **rtf-codec:** add the RTF byte tokenizer and diagnostic tiers ([f47a34f](https://github.com/ExaDev/documents.js/commit/f47a34fd6f9b6cd1ef01c09baf04282bbabbd36d))
* **rtf-codec:** read and write Rich Text Format against the content pivot ([d4dfe94](https://github.com/ExaDev/documents.js/commit/d4dfe94480ea2b818d21a55c29d62e3204f20415))
* **rtf-codec:** report every content destination the reader discards ([69d5b16](https://github.com/ExaDev/documents.js/commit/69d5b16761a09fb1ced56807f95098564a7c8029))

### Bug Fixes

* **rtf-codec:** stop reporting skipped destinations that lose nothing ([73a1fef](https://github.com/ExaDev/documents.js/commit/73a1fef29d7f3c31cb2e18daa869dbfe7c9f768e))
* **rtf-codec:** stop spreading byte runs into argument lists ([a7a89b2](https://github.com/ExaDev/documents.js/commit/a7a89b2325ba044dacceb8877d019e6cf3485b48))

### Code Refactoring

* **rtf-codec:** name a diagnostic position for what it actually is ([bd528cd](https://github.com/ExaDev/documents.js/commit/bd528cdccbde346b7cf29bc876ca4dff2cce5cc3))

### Documentation

* **rtf-codec:** point the engine-wiring gap at its tracking issue ([8eb245d](https://github.com/ExaDev/documents.js/commit/8eb245dc9e7eabb43af1f6837a76ea83555b38f4))
