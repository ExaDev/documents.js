## [11.1.1](https://github.com/ExaDev/documents.js/compare/markdown-codec%4011.1.0...markdown-codec%4011.1.1) (2026-09-23)


### Dependencies

- Updated byte-codec to 1.9.0

## [11.1.0](https://github.com/ExaDev/documents.js/compare/markdown-codec%4011.0.2...markdown-codec%4011.1.0) (2026-09-22)

### Features

* **markdown-codec:** report a dropped header column via a diagnostic ([8d216db](https://github.com/ExaDev/documents.js/commit/8d216db61d189de3fa626d83122abc313c26a34a))


### Dependencies

- Updated document-schema.js to 7.15.0

## [11.0.2](https://github.com/ExaDev/documents.js/compare/markdown-codec%4011.0.1...markdown-codec%4011.0.2) (2026-09-22)

### Bug Fixes

* **workspace:** replace the spaced double-hyphen dash substitute with a real em-dash workspace-wide ([c42a9c7](https://github.com/ExaDev/documents.js/commit/c42a9c7e0bc7cd87456ca72204a5ac423a7ca341))


### Dependencies

- Updated byte-codec to 1.8.1
- Updated document-schema.js to 7.14.1

## [11.0.1](https://github.com/ExaDev/documents.js/compare/markdown-codec%4011.0.0...markdown-codec%4011.0.1) (2026-09-21)

### Tests

* **markdown-codec:** assert MarkdownBytesSchema rejects undecodable bytes on its own ([f79d50b](https://github.com/ExaDev/documents.js/commit/f79d50b6ac6c601af8dccd967cde903ea7e6e2d6))
* **markdown-codec:** pin the synthesised-header-row diagnostic to isHeader's own value ([a8ee1a4](https://github.com/ExaDev/documents.js/commit/a8ee1a4d17bab95fc62fc7bcbc78c3fa0ad28248))

## [11.0.0](https://github.com/ExaDev/documents.js/compare/markdown-codec%4010.0.0...markdown-codec%4011.0.0) (2026-09-21)

### ⚠ BREAKING CHANGES

* **markdown-codec:** the HTML-table fallback writes th for the cells of a
  row carrying isHeader rather than for every cell of row 0, so a table
  whose rows state no header at all now writes td throughout where it
  previously wrote a th row. A table read from markdown carries isHeader
  on its first row, so a markdown-to-markdown round trip is unchanged.

### Features

* **markdown-codec:** state a table's header rows instead of assuming row zero ([f527ff0](https://github.com/ExaDev/documents.js/commit/f527ff0b7bf146b0ed0806c7f45c99c4540de756)), references [#1377](https://github.com/ExaDev/documents.js/issues/1377)


### Dependencies

- Updated byte-codec to 1.8.0
- Updated document-schema.js to 7.14.0

## [10.0.0](https://github.com/ExaDev/documents.js/compare/markdown-codec%409.0.0...markdown-codec%4010.0.0) (2026-09-21)

### ⚠ BREAKING CHANGES

* **markdown-codec:** MarkdownInvalidUtf8Error is now
  MarkdownUndecodableTextError, and its code is md/undecodable-text
  rather than md/invalid-utf8.
  MarkdownBytesSchema and markdownCodec accept bytes in any encoding
  byte-codec's decodeText recognises, and refuse bytes carrying a NUL or
  a density of other C0 control bytes even where those bytes are
  well-formed UTF-8.

### Features

* **markdown-codec:** accept markdown bytes in any detected character encoding ([e0f638f](https://github.com/ExaDev/documents.js/commit/e0f638f7c60eb6653a814be1a075f76aed7793d2))

## [9.0.0](https://github.com/ExaDev/documents.js/compare/markdown-codec%408.0.1...markdown-codec%409.0.0) (2026-09-21)

### ⚠ BREAKING CHANGES

* **markdown-codec:** a ContentTable violating the grid rule stated on ContentTableCell
  is now refused rather than written with the offending content silently dropped. A
  caller building a table by hand must give every row one cell per grid column, keep
  a merged region's content on its anchor, and state each span once, on the anchor.

### Bug Fixes

* **markdown-codec:** refuse a table that breaks the grid rule rather than writing past it ([c78ca62](https://github.com/ExaDev/documents.js/commit/c78ca6207f2f0fe99dcf57983c0c02a577fd25df))


### Dependencies

- Updated document-schema.js to 7.13.0

## [8.0.1](https://github.com/ExaDev/documents.js/compare/markdown-codec%408.0.0...markdown-codec%408.0.1) (2026-09-21)


### Dependencies

- Updated byte-codec to 1.7.0

## [8.0.0](https://github.com/ExaDev/documents.js/compare/markdown-codec%407.0.1...markdown-codec%408.0.0) (2026-09-21)

### ⚠ BREAKING CHANGES

* **markdown-codec:** an HTML table read by this package now has one ContentTableCell per
  grid column in every row.

### Bug Fixes

* **markdown-codec:** place HTML table cells on the grid their spans imply ([ad4933d](https://github.com/ExaDev/documents.js/commit/ad4933d1f6d03d9f631537289bfdb475d58d28db))


### Dependencies

- Updated document-schema.js to 7.12.0

## [7.0.1](https://github.com/ExaDev/documents.js/compare/markdown-codec%407.0.0...markdown-codec%407.0.1) (2026-09-20)

### Documentation

* make a hand-typed scoped mutation run find its package's Stryker config ([ed3297b](https://github.com/ExaDev/documents.js/commit/ed3297b6aa71b2d94913519e6960537ca5ac0f61))


### Dependencies

- Updated byte-codec to 1.6.3
- Updated document-schema.js to 7.11.5

## [7.0.0](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.7.6...markdown-codec%407.0.0) (2026-09-20)

### ⚠ BREAKING CHANGES

* **markdown-codec:** markdown-codec/image/image no longer exports
  bytesToBase64 or base64ToBytes; both come from byte-codec now.
  The module itself remains, and still reads PNG/JPEG dimensions.
  Neither name was ever on this package's barrel. The removal
  already shipped, unmarked, in 6.7.5.

### Documentation

* **markdown-codec:** state that base64 moved out of the image module ([71efdad](https://github.com/ExaDev/documents.js/commit/71efdadb6109e1f24da1643061c2688a42a97045))

### Styles

* write the base64 module's own prose without a double hyphen ([c58e8b5](https://github.com/ExaDev/documents.js/commit/c58e8b5035dfbe940aeff377773948b7e5c5c8c1))


### Dependencies

- Updated byte-codec to 1.6.2

## [6.7.6](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.7.5...markdown-codec%406.7.6) (2026-09-20)

### Bug Fixes

* **markdown-codec:** stop an unterminated inline tag repeating its cell's preceding text ([0a8fdcf](https://github.com/ExaDev/documents.js/commit/0a8fdcf1d65b7886774e8bf5e11bfadf554e233b))

### Code Refactoring

* **markdown-codec:** ask whether a block suppresses starts rather than whether it accepts lines ([d1e5bdc](https://github.com/ExaDev/documents.js/commit/d1e5bdc2ee4c41506ac6c5634bdd7b4b1b83d861))
* **markdown-codec:** claim the inline scanner's plain-text run before its construct dispatch ([8be0870](https://github.com/ExaDev/documents.js/commit/8be0870dbc7c1c4b99b25dcc1f9bebfb7f51ae4b))
* **markdown-codec:** derive the block parser's open-paragraph tests from the tip itself ([129918c](https://github.com/ExaDev/documents.js/commit/129918c7f416c3d9d496c4e5d09706834aa2c721))
* **markdown-codec:** drop isDelimiterChar, which no longer has a caller ([c974000](https://github.com/ExaDev/documents.js/commit/c9740004b36c898cd2c883b529551c96b3ec09ce))
* **markdown-codec:** drop lowering guards the parser's own output already settles ([9ef1dd1](https://github.com/ExaDev/documents.js/commit/9ef1dd15538180bbd57f01686b58accd9e57fca2))
* **markdown-codec:** drop the markdown writers' length bounds and seeds that decide nothing ([9f74c59](https://github.com/ExaDev/documents.js/commit/9f74c591764d7f06754b2153250e805d38831c86))
* **markdown-codec:** end gfm-autolink's scans on the empty string charAt returns past the text ([2b0f774](https://github.com/ExaDev/documents.js/commit/2b0f774e5ffa09c9e5e530472ff8dc34b96b9f97))
* **markdown-codec:** match the html-table reader's open and close tags in one scan ([8e37e67](https://github.com/ExaDev/documents.js/commit/8e37e671f5299b289f19278ae56789b1b1c99674))
* **markdown-codec:** read JPEG markers only at indices the input reaches ([cb8750b](https://github.com/ExaDev/documents.js/commit/cb8750b44726232adad7b8439579522de48b3a41))

### Styles

* **markdown-codec:** write this branch's own prose with a real em dash ([8b15857](https://github.com/ExaDev/documents.js/commit/8b158577577ffcb9afebf138281eb0b3829222f7))

### Tests

* **markdown-codec:** cover gfm-autolink's start boundaries, trimming and email rules ([c8b735a](https://github.com/ExaDev/documents.js/commit/c8b735a384a1674ee00a0d516a9fea3c3238f4e6))
* **markdown-codec:** cover the block parser's container continuation and promotion boundaries ([dacca0c](https://github.com/ExaDev/documents.js/commit/dacca0ca3a75487bd2379da4e73749cb8a995315))
* **markdown-codec:** cover the html-table reader's refusals and the writer's cell attributes ([04b7436](https://github.com/ExaDev/documents.js/commit/04b7436cff47693000804c2040ca7995840c39f6))
* **markdown-codec:** cover the inline phase's code spans, escapes and link grammar ([04a322e](https://github.com/ExaDev/documents.js/commit/04a322e029bf5553473c1b838e583ec337e242ed))
* **markdown-codec:** cover the JPEG marker walk's refusals and boundaries ([3f81782](https://github.com/ExaDev/documents.js/commit/3f8178211dc9202296a6e5e4a47ac75a6266890f))
* **markdown-codec:** cover the lowering stage's degrade diagnostics and fallbacks ([0a78877](https://github.com/ExaDev/documents.js/commit/0a78877e810f28b0c9caeaf9cfd77330f82c6288))
* **markdown-codec:** cover the markdown writers' escaping, delimiters and list regions ([e35ccc6](https://github.com/ExaDev/documents.js/commit/e35ccc6ae0d7396aa3dcbadfd8fc21800bd9a393))

### Miscellaneous Chores

* **markdown-codec:** raise the mutation break threshold to 100 ([68530a7](https://github.com/ExaDev/documents.js/commit/68530a7e32291a309a5afde57d6d57352aa71e43))

## [6.7.5](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.7.4...markdown-codec%406.7.5) (2026-09-20)

### Bug Fixes

* **markdown-codec:** remove an exhausted closer's delimiter before it can be reused ([ffe3a44](https://github.com/ExaDev/documents.js/commit/ffe3a4423892bc46cbd93f8f7dc34a63b0f81630))
* **markdown-codec:** stop building the function-with-fields test fixture via Object.assign ([23d011d](https://github.com/ExaDev/documents.js/commit/23d011d03287f247e56729846d304d15791b2e5d))
* **markdown-codec:** stop importing base64 from a module that no longer exports it ([8aed93d](https://github.com/ExaDev/documents.js/commit/8aed93d64b6354249a3aedf4a7b9a97a1bbaf58c))

### Code Refactoring

* **markdown-codec:** always splice readMarkdown's own definitions/source table ([4c9271c](https://github.com/ExaDev/documents.js/commit/4c9271c6742928e05d09dfaaa6e327cf1138783b))
* **markdown-codec:** derive stripGlyph from the detected checkbox text ([26e288e](https://github.com/ExaDev/documents.js/commit/26e288e4481e0721ac42b89df23beed8771eee70))
* **markdown-codec:** drop canInterruptOpenParagraph's own ([1b514d3](https://github.com/ExaDev/documents.js/commit/1b514d36d523b11cb5cb197fec4fa473721cedcd))
* **markdown-codec:** drop codePointAt's unreachable undefined guard ([2cd5a45](https://github.com/ExaDev/documents.js/commit/2cd5a459a6b062f6d94d064c54140647e8c97d49))
* **markdown-codec:** drop collectListItem's own unkillable ([b44df0f](https://github.com/ExaDev/documents.js/commit/b44df0f0693a09767a6460a132d611f474d58a69))
* **markdown-codec:** drop definitions.ts's redundant label-length guard ([b3addd5](https://github.com/ExaDev/documents.js/commit/b3addd5ad0288c1085da3ca708c30a870c3e9e04))
* **markdown-codec:** drop emit.ts's own unkillable length-bound loops ([78d5a65](https://github.com/ExaDev/documents.js/commit/78d5a650ebd544e06d639f37bdb16e60b7a2755d))
* **markdown-codec:** drop front-matter.ts's own unkillable loops ([bdfce43](https://github.com/ExaDev/documents.js/commit/bdfce43821015b5ad14dbdf4e727a29aced2904e))
* **markdown-codec:** drop list.ts's redundant marker-match fields ([1dec1a0](https://github.com/ExaDev/documents.js/commit/1dec1a03afa11939b1c81d91317a2afaca68c082))
* **markdown-codec:** drop render.ts's cr() calls that can never fire ([f293e5f](https://github.com/ExaDev/documents.js/commit/f293e5f6ac4487b9f7641614098952c4d4804a4a))
* **markdown-codec:** drop render.ts's unkillable guards and case bodies ([6ea592c](https://github.com/ExaDev/documents.js/commit/6ea592cb4c8efc08f815282a29927b3e81dca705))
* **markdown-codec:** drop renderConstruct's own redundant ([0526fa3](https://github.com/ExaDev/documents.js/commit/0526fa3473ff61146ee93f89606ba1b3141985e5))
* **markdown-codec:** drop renderListRegion's own unreachable ([b2393d1](https://github.com/ExaDev/documents.js/commit/b2393d1b168b54194f75f658411728d2cb693b42))
* **markdown-codec:** drop skipInlineWhitespace's redundant range guard ([1fe0bc7](https://github.com/ExaDev/documents.js/commit/1fe0bc7851548ca96a2d1dbdb5c91c339caabde6))
* **markdown-codec:** drop table.ts's redundant escaped-pipe lookahead guard ([19fddd7](https://github.com/ExaDev/documents.js/commit/19fddd78dfbcb992f7f92b561f20e3d652d0a816))
* **markdown-codec:** drop two more of chars.ts's unkillable guards ([dacc909](https://github.com/ExaDev/documents.js/commit/dacc9092bc251f5e5ac2651f9230656f722a2260))
* **markdown-codec:** drop two redundant '<'-prefix guards in the HTML recogniser ([35b1d7f](https://github.com/ExaDev/documents.js/commit/35b1d7f6f703bae6f4629182b2c828cb5ab3993a))
* **markdown-codec:** drop two unobservable branches in LineCursor ([df237d8](https://github.com/ExaDev/documents.js/commit/df237d8e4a457f8f295ec29cd4b241bc5cb07692))
* **markdown-codec:** drop unescapeString's redundant '&'-prefix guard ([0b84df6](https://github.com/ExaDev/documents.js/commit/0b84df6c7e74d926db3fcfce4b641a876437aab9))
* **markdown-codec:** drop unobservable guards in list-marker/tightness logic ([3bc7ce7](https://github.com/ExaDev/documents.js/commit/3bc7ce78cb9643585cfdb143e88e7ce3129eba9e))
* **markdown-codec:** drop validateRunConstructExtents' own ([a0ff89f](https://github.com/ExaDev/documents.js/commit/a0ff89f2a31c8cadf71a59330fbc2113f96f771d))
* **markdown-codec:** encode and decode base64 through byte-codec ([bee852e](https://github.com/ExaDev/documents.js/commit/bee852e7d9d60a8a291150de2346846d3f82ee5a))
* **markdown-codec:** make link primitives' loop bounds mutation-testable ([a7dac47](https://github.com/ExaDev/documents.js/commit/a7dac4724988ef8628ec95e5c439ad2262a1108d))
* **markdown-codec:** merge lowerInlineNodes' text and entity cases ([d1f8536](https://github.com/ExaDev/documents.js/commit/d1f853606ea176c5b59a9643641fef5b73811799))
* **markdown-codec:** remove leadingIndentReachesCodeThreshold's dead loop-exhausted fallback ([f4f8c58](https://github.com/ExaDev/documents.js/commit/f4f8c586e6c499011b2598bca0fa3a4b63f639b1))
* **markdown-codec:** remove length bounds absorbed by charAt's own out-of-range "" ([d6c8656](https://github.com/ExaDev/documents.js/commit/d6c86562a96c130b26b9d1c815da3abd2fe657c2))
* **markdown-codec:** remove three dead split-result fallbacks with one helper ([25fd81f](https://github.com/ExaDev/documents.js/commit/25fd81f793d75ea4bd7c1450cb3acdc6f61b7b37))
* **markdown-codec:** remove three provably-unreachable guards from MarkdownScanCursor ([cd84720](https://github.com/ExaDev/documents.js/commit/cd847209d684a44778093d32f4ac605d4bd86ae9))
* **markdown-codec:** remove two more redundant guards, add codepoint-boundary coverage ([56ed82b](https://github.com/ExaDev/documents.js/commit/56ed82bc1f508d0d72f9ae1a2d2b0c11233c3c40))
* **markdown-codec:** return the code-indent threshold boolean directly ([3c0b357](https://github.com/ExaDev/documents.js/commit/3c0b35751b38a55be58ae4d5529a2c01deddbe05))
* **markdown-codec:** strip the checkbox glyph once, in firstBlockCheckbox itself ([31b1ea2](https://github.com/ExaDev/documents.js/commit/31b1ea200c23a1635761efab9e1a8bad1be909f1))

### Tests

* **markdown-codec:** add a dedicated unit suite for the corpus loader ([33a22c6](https://github.com/ExaDev/documents.js/commit/33a22c62a2d7b403419a7bf8b5a068ff889b2f8b))
* **markdown-codec:** add direct coverage for BlockNode's own methods and canContain ([6a1d3e7](https://github.com/ExaDev/documents.js/commit/6a1d3e7e7683a36ce2277e746b5f62f485e13130))
* **markdown-codec:** add direct coverage for chars.ts's own boundaries ([a8b21e1](https://github.com/ExaDev/documents.js/commit/a8b21e195a8e64af01c549bad265d068f6e51d38))
* **markdown-codec:** add direct coverage for front-matter parsing ([9d34a96](https://github.com/ExaDev/documents.js/commit/9d34a96a20d17f3a2b932fdfcb630da6f844f07a))
* **markdown-codec:** add direct coverage for InlineNode's linked-list operations ([fae477b](https://github.com/ExaDev/documents.js/commit/fae477b7d70139ed25107777bebd738b1b84fe92))
* **markdown-codec:** add direct coverage for isMarkdownBlockNode/isMarkdownInlineNode ([4659084](https://github.com/ExaDev/documents.js/commit/465908434326e512de194e988a71cb4eda7cbe7b))
* **markdown-codec:** add direct coverage for lowerInlineNodes' own leaves ([1750bf6](https://github.com/ExaDev/documents.js/commit/1750bf68061a9e604d4d6c8d483d35cbf2d0f5ad))
* **markdown-codec:** add direct coverage for matchMathInlineSpan's guard clauses ([da9dd2a](https://github.com/ExaDev/documents.js/commit/da9dd2adeef7e9f392a3be51d5ff775d7bca546a))
* **markdown-codec:** add direct coverage for the footnote label/marker grammar ([111b31a](https://github.com/ExaDev/documents.js/commit/111b31a4061fbbb14ca1f3152008e240c0a2d056))
* **markdown-codec:** add direct coverage for the HTML render oracle ([3e8a057](https://github.com/ExaDev/documents.js/commit/3e8a05787dd6ea10ce06282ca89994db7e0bdebd))
* **markdown-codec:** assert diagnostic message content for ([b865ff6](https://github.com/ExaDev/documents.js/commit/b865ff6e61d73847f06007c9423fcf9c50ef43a2))
* **markdown-codec:** assert message content for the two remaining ([f6a3116](https://github.com/ExaDev/documents.js/commit/f6a31164a1a4fac2db32646cd7079ce3346bcc50))
* **markdown-codec:** cover an empty construct child defaulting to interrupting a paragraph ([441d8e8](https://github.com/ExaDev/documents.js/commit/441d8e861a986281fd607320818299980dcb4824))
* **markdown-codec:** cover blank-line indentation for a LATER ([3e155c1](https://github.com/ExaDev/documents.js/commit/3e155c1f36b00b9a3f1c46e0134784b3557a7315))
* **markdown-codec:** cover checkbox glyph stripping and ([201c369](https://github.com/ExaDev/documents.js/commit/201c369a195f912bb712fa607cacb2b138f68e31))
* **markdown-codec:** cover constructCarriesListItemId's own ([1054089](https://github.com/ExaDev/documents.js/commit/1054089b3edcdbf5df16748d45aff62ffa049063))
* **markdown-codec:** cover divisionDepth's own restore-on-exit and ([89905ba](https://github.com/ExaDev/documents.js/commit/89905bade518f3ee52159de065fac819adf0f04a))
* **markdown-codec:** cover emit.ts's line-break-collapse message ([dc9e15c](https://github.com/ExaDev/documents.js/commit/dc9e15ca28fe9c086184802e8f878cec0a021510))
* **markdown-codec:** cover emit.ts's quote/fence/tab-stop boundaries ([fe4046f](https://github.com/ExaDev/documents.js/commit/fe4046fbbe36c5bde3bc7034f172efc0de2ea9be))
* **markdown-codec:** cover emit.ts's terminatesCleanly, isQuotableStyle, ([90e7563](https://github.com/ExaDev/documents.js/commit/90e7563b2f5702535ab0f5bd4b9a0b68efd883d5))
* **markdown-codec:** cover firstBlockCheckbox's own stripGlyph: ([9dd5262](https://github.com/ExaDev/documents.js/commit/9dd526257bdd865f20b6dbccc5ec2ad3aea1aa54))
* **markdown-codec:** cover HEADING_LEVEL_CLAMPED's own false case and ([cf2db1b](https://github.com/ExaDev/documents.js/commit/cf2db1b22508f624db97c76cfafa5457f4a05e36))
* **markdown-codec:** cover image.ts's base64 codec and format-sniffing paths ([ba86bde](https://github.com/ExaDev/documents.js/commit/ba86bde8ed64fe881660358b23f51559c292a751))
* **markdown-codec:** cover interruptsSetextParagraph's own ([d66dea9](https://github.com/ExaDev/documents.js/commit/d66dea9b99e914c3c1551e987b2bc8c6a1226173))
* **markdown-codec:** cover isMaterialisedDivision's own every-vs-some ([4aa4677](https://github.com/ExaDev/documents.js/commit/4aa46771ddfd3d61e40d3b00ec5089e91d94159c))
* **markdown-codec:** cover lastStyleIdOf's own last-child lookup ([56026d1](https://github.com/ExaDev/documents.js/commit/56026d195ef744eacb0836bc303cf5a37af89766))
* **markdown-codec:** cover non-paragraph list children interrupting a paragraph ([20eb0e8](https://github.com/ExaDev/documents.js/commit/20eb0e80f702b96c1baa845f1225a1ae554f1e7a))
* **markdown-codec:** cover openMemberships' own same-level pop ([da1f6ae](https://github.com/ExaDev/documents.js/commit/da1f6ae10cbc98c8470985f8b16913411b32d426))
* **markdown-codec:** cover parseHeadingStyleId's integer and positivity guards ([728f5c3](https://github.com/ExaDev/documents.js/commit/728f5c3b15b9f67018880f5f87d2b75230d3129c))
* **markdown-codec:** cover renderConstruct's unrepresentable shapes ([1fe1758](https://github.com/ExaDev/documents.js/commit/1fe1758bf55cca33f3eecbab242222cd56b9cdcd))
* **markdown-codec:** cover the ballot-box-glyph/task-flag guard and ([16d0677](https://github.com/ExaDev/documents.js/commit/16d067756eefb799dd8398512b88ca414adc8fe4))
* **markdown-codec:** cover the link construct's own exact-one-child ([a305dd3](https://github.com/ExaDev/documents.js/commit/a305dd33607e5da4142b8a35ffa4faf0023b92e0))
* **markdown-codec:** cover the nested sub-list's own last-block ([7416a17](https://github.com/ExaDev/documents.js/commit/7416a17701b9034da105ba8b0ed27fe8b11d8d65))
* **markdown-codec:** cover the unsafe-setext branch requiring setextRequested itself ([5b79e95](https://github.com/ExaDev/documents.js/commit/5b79e95914a0fedba5cf73e98459ad2bc2945cc2))
* **markdown-codec:** cover the unsafe-setext branches own level ceiling ([99fc8b7](https://github.com/ExaDev/documents.js/commit/99fc8b739afab8586bd01e41a2133fa63e8065d8))
* **markdown-codec:** cover validateRunConstructExtents' own ([c7b23d9](https://github.com/ExaDev/documents.js/commit/c7b23d9e7d079647aa4d20284314400ecd5dbd94))
* **markdown-codec:** cover willRenderAsSetext's own level boundary ([1e8f99e](https://github.com/ExaDev/documents.js/commit/1e8f99e1e91526c621244f35a3400778dae3d75a))
* **markdown-codec:** fix the UNCHECKED glyph test to actually ([75a4554](https://github.com/ExaDev/documents.js/commit/75a4554906cc38c52e354cc73ce94def083ebd2c))
* **markdown-codec:** kill diagnostics.ts's this.name assignment mutants ([19b672f](https://github.com/ExaDev/documents.js/commit/19b672f18d396dcdce0a58c5a0deee928268d71b))
* **markdown-codec:** kill emit/front-matter.ts's quoting and escaping mutants ([860fb2e](https://github.com/ExaDev/documents.js/commit/860fb2e4d998702ef2e129dc5cde8a7fc51e2133))
* **markdown-codec:** kill list-id numId mutants and drop an unreachable undefined branch ([a06b9ad](https://github.com/ExaDev/documents.js/commit/a06b9ad4afb7db8a1f134a0303ab9839464fca71))
* **markdown-codec:** pin chars.ts's own boundaries the fresh run found ([13d7acd](https://github.com/ExaDev/documents.js/commit/13d7acd102a4939e36eb2489cb1bfe9d25f13117))
* **markdown-codec:** pin construct-extent, marker-balance, and write-side error fields ([abe12e5](https://github.com/ExaDev/documents.js/commit/abe12e5bcfd3142ed231a9f5c3620f1bbd79558e))
* **markdown-codec:** pin emitImage's alt fallback for altText-less images ([719c443](https://github.com/ExaDev/documents.js/commit/719c443836283fdf3b7c4a0129aad48f610f7ef8))
* **markdown-codec:** pin front-matter.ts's remaining boundaries ([aa9aade](https://github.com/ExaDev/documents.js/commit/aa9aaded6350d72d6f70b2b8a5ca0d3de118c998))
* **markdown-codec:** pin lowerTable's column-width division and absent keys ([d5a144e](https://github.com/ExaDev/documents.js/commit/d5a144e87a22a3c2c05c313fd02047f01c577031))
* **markdown-codec:** pin mathBlock's and footnoteDefinition's own cr() ([c3b3444](https://github.com/ExaDev/documents.js/commit/c3b3444539cae40d14c9fe63e09f5ee095ad605c))
* **markdown-codec:** pin next() leaving cursor state untouched past end ([6caf7fd](https://github.com/ExaDev/documents.js/commit/6caf7fddcaa9c93d3b2f3e9fbbe533729971ab1e))
* **markdown-codec:** pin resolveMarkdownImage's independent width/height axes ([138736c](https://github.com/ExaDev/documents.js/commit/138736c18171d79591ad37020b05ce5233e4fec5))
* **markdown-codec:** pin table cell diagnostics and drop two redundant guards ([e8cd734](https://github.com/ExaDev/documents.js/commit/e8cd734e19c60628cfd2eadb24eda5ebc22015b4))
* **markdown-codec:** pin the remaining render.ts mutants directly ([63f6897](https://github.com/ExaDev/documents.js/commit/63f68975a13daa6afe378cf88eeb408b4aa85bc3))
* **markdown-codec:** pin throw-tier error classes' own fields ([221a319](https://github.com/ExaDev/documents.js/commit/221a319784b4f716f2daa173daa1f646bc40d3b1))


### Dependencies

- Updated byte-codec to 1.6.1

## [6.7.4](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.7.3...markdown-codec%406.7.4) (2026-09-20)


### Dependencies

- Updated document-schema.js to 7.11.4

## [6.7.3](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.7.2...markdown-codec%406.7.3) (2026-09-14)

### Miscellaneous Chores

* bump pinned pnpm to 12.4.1 across the workspace ([4e81c2d](https://github.com/ExaDev/documents.js/commit/4e81c2dfdb08fff226c20a0f267baffa87758e0f))
* **lint:** except each package's own measured eslint-config 2.12.1 debt ([11c35bc](https://github.com/ExaDev/documents.js/commit/11c35bc61db74c68b4be725c34452509fba00c2a))


### Dependencies

- Updated document-schema.js to 7.11.3

## [6.7.2](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.7.1...markdown-codec%406.7.2) (2026-09-13)


### Dependencies

- Updated document-schema.js to 7.11.2

## [6.7.1](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.7.0...markdown-codec%406.7.1) (2026-09-11)

### Code Refactoring

* load stryker.config.ts directly instead of a jiti .mjs bootstrap ([4221520](https://github.com/ExaDev/documents.js/commit/42215205caa1c8fc6368ed38729d15836bdd613b))


### Dependencies

- Updated document-schema.js to 7.11.1

## [6.7.0](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.6.7...markdown-codec%406.7.0) (2026-09-11)

### Features

* **ci:** gate each measured package on its first CI mutation baseline ([9f8fa69](https://github.com/ExaDev/documents.js/commit/9f8fa6947795b2089bed03c936691893643ce2ae))


### Dependencies

- Updated document-schema.js to 7.11.0

## [6.6.7](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.6.6...markdown-codec%406.6.7) (2026-09-11)


### Dependencies

- Updated document-schema.js to 7.10.0

## [6.6.6](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.6.5...markdown-codec%406.6.6) (2026-09-11)


### Dependencies

- Updated document-schema.js to 7.9.1

## [6.6.5](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.6.4...markdown-codec%406.6.5) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.9.0

## [6.6.4](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.6.3...markdown-codec%406.6.4) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.8.0

## [6.6.3](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.6.2...markdown-codec%406.6.3) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.7.0

## [6.6.2](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.6.1...markdown-codec%406.6.2) (2026-09-10)

### Documentation

* state the npm aliases as registered and republishing ([8bb4de8](https://github.com/ExaDev/documents.js/commit/8bb4de80a954b7dc728776a761cf63a344eb6f71))


### Dependencies

- Updated document-schema.js to 7.6.1

## [6.6.1](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.6.0...markdown-codec%406.6.1) (2026-09-10)


### Dependencies

- Updated document-schema.js to 7.6.0

## [6.6.0](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.5.2...markdown-codec%406.6.0) (2026-09-08)

### Features

* **markdown-codec:** stop degrading a heading inside a quote or footnote body ([9dd9504](https://github.com/ExaDev/documents.js/commit/9dd9504555dcf03654f827f96156dcd7967b4629))


### Dependencies

- Updated document-schema.js to 7.5.1

## [6.5.2](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.5.1...markdown-codec%406.5.2) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.5.0

## [6.5.1](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.5.0...markdown-codec%406.5.1) (2026-09-08)


### Dependencies

- Updated document-schema.js to 7.4.0

## [6.5.0](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.4.3...markdown-codec%406.5.0) (2026-09-08)

### Features

* **markdown-codec:** add a bounded HTML table read/write pair ([02c8f38](https://github.com/ExaDev/documents.js/commit/02c8f38f5ebd311ee6e4d52c1365bf3dda3757f4))
* **markdown-codec:** fall back to a raw HTML table for colSpan/rowSpan/background/a nested block ([7e0dd11](https://github.com/ExaDev/documents.js/commit/7e0dd1189a4df058a61a357ffeab09d61dcccc88)), closes [#1089](https://github.com/ExaDev/documents.js/issues/1089)
* **markdown-codec:** recognise a footnote definition inside a quote or list item ([3803957](https://github.com/ExaDev/documents.js/commit/38039572f5af4176b85002010ed82fd5f314d5e4))
* **markdown-codec:** recognise every LayoutMetadata field in front matter ([b014d91](https://github.com/ExaDev/documents.js/commit/b014d91ad38d29794e5ecd3f9a6522a9c4d7fbfc))

### Bug Fixes

* **markdown-codec:** alternate marker glyph between adjacent same-type lists ([a11a7c5](https://github.com/ExaDev/documents.js/commit/a11a7c5cb809f4d91282cedf6399f99853c37954))
* **markdown-codec:** pick a per-window nesting order for bold/italic/strike ([53d4cf2](https://github.com/ExaDev/documents.js/commit/53d4cf2b7951e9168444120306dea56c4395f851))

### Documentation

* **markdown-codec:** document the HTML-table fallback ([2f64b60](https://github.com/ExaDev/documents.js/commit/2f64b60ad891a55119cb9e764b1c52d04078f375))

## [6.4.3](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.4.2...markdown-codec%406.4.3) (2026-09-08)

### Bug Fixes

* **deps:** pin @vitest/coverage-v8 to match its vitest runner ([6912e0e](https://github.com/ExaDev/documents.js/commit/6912e0e5c602f0c21d9df12d2dc9899422bf5bd2))

### Miscellaneous Chores

* **deps:** pin every workspace dependency to an exact fixed version ([6a38142](https://github.com/ExaDev/documents.js/commit/6a38142facc043dfa499573f37431d3b32ff602e))


### Dependencies

- Updated document-schema.js to 7.3.1

## [6.4.2](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.4.1...markdown-codec%406.4.2) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.3.0

## [6.4.1](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.4.0...markdown-codec%406.4.1) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.2.0

## [6.4.0](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.3.7...markdown-codec%406.4.0) (2026-09-07)

### Features

* **markdown-codec:** stop dropping table cell images, join cells with a real line break ([5e3b337](https://github.com/ExaDev/documents.js/commit/5e3b3371820a97c419cb4f55c17bbe92de40e421)), references [#1089](https://github.com/ExaDev/documents.js/issues/1089)

## [6.3.7](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.3.6...markdown-codec%406.3.7) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.1.0

## [6.3.6](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.3.5...markdown-codec%406.3.6) (2026-09-07)

### Bug Fixes

* **markdown-codec:** anchor a list item whose entire content is a construct ([fab3277](https://github.com/ExaDev/documents.js/commit/fab3277d7ab809e180ea1b991cebfda8cd05760d))

## [6.3.5](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.3.4...markdown-codec%406.3.5) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^7.0.0

## [6.3.4](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.3.3...markdown-codec%406.3.4) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.3

## [6.3.3](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.3.2...markdown-codec%406.3.3) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.2

## [6.3.2](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.3.1...markdown-codec%406.3.2) (2026-09-07)


### Dependencies

- Updated document-schema.js to ^6.2.1

## [6.3.1](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.3.0...markdown-codec%406.3.1) (2026-09-07)

### Bug Fixes

* **markdown-codec:** set preformatted: true on a code block's paragraph ([16d6220](https://github.com/ExaDev/documents.js/commit/16d6220424151e65f11da55ecb45683c84a60dc9))

## [6.3.0](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.2.0...markdown-codec%406.3.0) (2026-09-06)

### Features

* **markdown-codec:** diagnose an ATX heading style silently overridden by a line break ([f7a1214](https://github.com/ExaDev/documents.js/commit/f7a121478a57b7ea5121eafe6f9f3d6138556da8))

### Bug Fixes

* **markdown-codec:** bound the setext leading-blank-line exemption to a single line ([4642da2](https://github.com/ExaDev/documents.js/commit/4642da251eaefc5bab658ad776dc3e3b17e6bc35))
* **markdown-codec:** check a heading's first line for an interrupting construct ([5acf9ca](https://github.com/ExaDev/documents.js/commit/5acf9ca196a6753711e2c1db01df1bba03d23d72))
* **markdown-codec:** collapse a bare CR or CRLF in a GFM table cell's line-ending run ([39beb08](https://github.com/ExaDev/documents.js/commit/39beb08845f9397ceb0f9b5348199ec7f0b45e77))
* **markdown-codec:** collapse a table cell's soft-break residue to a space ([0e532bd](https://github.com/ExaDev/documents.js/commit/0e532bd281d331a582438a46a6f952283f4a6b99))
* **markdown-codec:** key the list-item interrupt guard off a heading's actual setext rendering ([407d9a8](https://github.com/ExaDev/documents.js/commit/407d9a8e4ae62b84a0ce4e1fb20b10a639648f16))
* **markdown-codec:** measure a setext underline against the CommonMark first line ([4a8d337](https://github.com/ExaDev/documents.js/commit/4a8d33705910b14402a2e726180fe9a631dcc610))
* **markdown-codec:** normalise a bare CR/CRLF hard break to a single backslash-LF ([4ee33bb](https://github.com/ExaDev/documents.js/commit/4ee33bb36e5c10b17f9835bc865b3641252dc1a9))
* **markdown-codec:** recognize a bare CR or CRLF as a heading's embedded break, not just LF ([64b6ae3](https://github.com/ExaDev/documents.js/commit/64b6ae36c235fffdfb948798b7ec1a6e7c8846f4))
* **markdown-codec:** refuse setext promotion when a later line would itself start a block ([c14aad1](https://github.com/ExaDev/documents.js/commit/c14aad112d0a09a1b50a06e429262d193a9907a1))
* **markdown-codec:** refuse setext promotion when it would leave a blank line before the underline ([70e350e](https://github.com/ExaDev/documents.js/commit/70e350e9542e8fcee1bbff6a5127916ad699d68a))
* **markdown-codec:** refuse setext promotion when the first content line is indented 4+ columns ([4fca0db](https://github.com/ExaDev/documents.js/commit/4fca0db8b90b385f35c3363fddfbd4acf1a01ef0))
* **markdown-codec:** report an unsafe setext promotion even without an embedded break ([59bbe23](https://github.com/ExaDev/documents.js/commit/59bbe2331a44a314eff039acef58329b91a4a6f7))
* **markdown-codec:** restore soft line break as literal newline, not a space ([b4b303c](https://github.com/ExaDev/documents.js/commit/b4b303c3acaf6416c56430b6fe921ef312bffc58))
* **markdown-codec:** stop a heading whose own text is entirely blank from promoting to setext ([3b091ae](https://github.com/ExaDev/documents.js/commit/3b091ae39ef6a312fbed7199b5251bf43973b9a1))
* **markdown-codec:** stop claiming an absorbed leading heading break survives setext promotion ([5ec7403](https://github.com/ExaDev/documents.js/commit/5ec740318c7a93348c9b38a037ab01f83a835081))
* **markdown-codec:** strip an escaped hard break's backslash with a line-ending-aware pattern ([c2e8428](https://github.com/ExaDev/documents.js/commit/c2e8428761230021539aec9b5c4b8879223fc37a))
* **markdown-codec:** treat a math block and table delimiter row as setext-interrupting too ([161b938](https://github.com/ExaDev/documents.js/commit/161b93882a1a134b1144288f9f77413dd5a3ef62))
* **markdown-codec:** treat a whitespace-only line as blank in the setext break-safety guard ([175343b](https://github.com/ExaDev/documents.js/commit/175343b8b8d7a514ce10a19061c7aa6c838d8560))
* **markdown-codec:** trim only ASCII space/tab from a block's raw content ([0bc57d4](https://github.com/ExaDev/documents.js/commit/0bc57d46563f6a7327a971de38b80fabc3d9e1a8))

### Code Refactoring

* **markdown-codec:** extract shared LINE_ENDING_PATTERN constant ([4705f3c](https://github.com/ExaDev/documents.js/commit/4705f3c4664740e3c74feb731fb7de897c1c2791))

### Documentation

* **markdown-codec:** document the unsafe-break-placement collapse for level 1/2 headings ([4bcdac6](https://github.com/ExaDev/documents.js/commit/4bcdac6b0133ea00cecf2b71bd7961371a35ab4f))
* **markdown-codec:** fix a stale cross-reference to the retired SOFT_BREAK exclusion reason ([588a53a](https://github.com/ExaDev/documents.js/commit/588a53aab598c6200ae59c5a86a50cabd38cb94d)), references [ExaDev/documents.js#940](https://github.com/ExaDev/documents.js/issues/940)
* **markdown-codec:** fix remaining stale renderItems cross-references ([27910f7](https://github.com/ExaDev/documents.js/commit/27910f751e5efcde9e21172ad349d391cb50ef3d))
* **markdown-codec:** heading-style-override diagnostic describes the effective style ([d8f3d04](https://github.com/ExaDev/documents.js/commit/d8f3d04e6ea28c68510f6f51792f9f36f40a6a2c))
* **markdown-codec:** scope the leading-break setext exemption's own claim ([c37bf99](https://github.com/ExaDev/documents.js/commit/c37bf99441ed8e2455dd24c0ded859ef3b6f0905))
* **markdown-codec:** update conformance numbers and document the two heading-line-break diagnostics ([1e3ffca](https://github.com/ExaDev/documents.js/commit/1e3ffca279573c0cd842f9b2956097a52361d420))

### Tests

* **markdown-codec:** cover soft-break, heading, and block-edge whitespace round trips ([9b719dd](https://github.com/ExaDev/documents.js/commit/9b719ddd9683f2554e4bca57b4954d9dbe136910))
* **markdown-codec:** cover the setext leading-blank-line exemption with a genuinely bare newline ([70a3013](https://github.com/ExaDev/documents.js/commit/70a3013ecd61c67e6a2cb89397390b27f6d226e8))
* **markdown-codec:** cover whitespace-only break lines and leading-break list/blockquote contexts ([dec32ed](https://github.com/ExaDev/documents.js/commit/dec32edb7fa079f81ee19a971d3c9b13bbb43281))
* **markdown-codec:** drop conformance examples the soft-break fix now passes ([d4cfae9](https://github.com/ExaDev/documents.js/commit/d4cfae992dec279ccfd714bf281230ceab8437d9))


### Dependencies

- Updated document-schema.js to ^6.2.0

## [6.2.0](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.1.7...markdown-codec%406.2.0) (2026-09-06)

### Features

* **workspace:** add per-package Stryker mutation testing configuration ([ff3eacc](https://github.com/ExaDev/documents.js/commit/ff3eacc124577b163a1c13a63b83484d9611ae5a))

### Bug Fixes

* **workspace:** drop the unused per-package @stryker-mutator/api dependency ([69270b6](https://github.com/ExaDev/documents.js/commit/69270b6e7ad7163c3b76cd085f4e5f367433994c))


### Dependencies

- Updated document-schema.js to ^6.1.0

## [6.1.7](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.1.6...markdown-codec%406.1.7) (2026-09-06)

### Bug Fixes

* **markdown-codec:** absorb a construct whose item's itemId resumes right after it ([afa87fd](https://github.com/ExaDev/documents.js/commit/afa87fd8befc84e40eb85af8a43565987e38b812))
* **markdown-codec:** keep a construct nested inside a multi-block list item on write ([b7204fb](https://github.com/ExaDev/documents.js/commit/b7204fb61235d2d06a417ba72e5d100cfc7d70eb))
* **markdown-codec:** match a resumed construct against every open list level ([55fa9af](https://github.com/ExaDev/documents.js/commit/55fa9af85ffd1dfd037e9cb6fc9ac21eac9294c6))
* **markdown-codec:** preserve a multi-block list item's own boundary on write ([594b318](https://github.com/ExaDev/documents.js/commit/594b318aacc7cdd92a17e33cc7c64b61023f0e5a))
* **markdown-codec:** report LIST_ITEM_MULTI_BLOCK_FLATTENED when a construct interrupts a list item ([80b65d9](https://github.com/ExaDev/documents.js/commit/80b65d9a9b260159f7010c125a0a0c655781aef4))
* **markdown-codec:** require a blank line after any open HTML block regardless of what follows ([bdf0c70](https://github.com/ExaDev/documents.js/commit/bdf0c701557ad0b41d9b909eb24ae4a494d625f7))
* **markdown-codec:** split requiresBlankLineBefore into two directional, option-aware checks ([9bbcab4](https://github.com/ExaDev/documents.js/commit/9bbcab46ecc888c06f2ed931a80019ba6b103cb5))
* **markdown-codec:** stop merging a Quote-styled list block into its next sibling ([2fe0a28](https://github.com/ExaDev/documents.js/commit/2fe0a28e8e67bbcf4eeeb1a9bef2cd21fbde34de))
* **markdown-codec:** tag a blockquote's fresh nested list with its enclosing item's own itemId ([063f98d](https://github.com/ExaDev/documents.js/commit/063f98dc4c564e4f47e0c48bebc39a8985184b72))

### Code Refactoring

* **markdown-codec:** drop the -1 sentinel from collectListItem's nested-level scan ([3013aad](https://github.com/ExaDev/documents.js/commit/3013aad624cb2328c0f5280ce0b8e1aa2e0da76c))

### Documentation

* **markdown-codec:** correct consumeSameItemRun's stale from-always-matches invariant ([b3ce00c](https://github.com/ExaDev/documents.js/commit/b3ce00cb73638cbf50266ead09dcf8810902c990))

### Build System

* typecheck test/workers across every package where it is currently clean ([f340428](https://github.com/ExaDev/documents.js/commit/f340428b51a669010c0c4e5edb4310fe6ea4789a)), closes [#1021](https://github.com/ExaDev/documents.js/issues/1021)

### Miscellaneous Chores

* **markdown-codec:** remove LIST_ITEM_MULTI_BLOCK_FLATTENED, now unreachable ([8670a10](https://github.com/ExaDev/documents.js/commit/8670a102fb84d9069a4775d2919d644ca782aaba))


### Dependencies

- Updated document-schema.js to ^6.0.0

## [6.1.6](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.1.5...markdown-codec%406.1.6) (2026-09-05)


### Dependencies

- Updated document-schema.js to ^5.6.0

## [6.1.5](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.1.4...markdown-codec%406.1.5) (2026-09-04)


### Dependencies

- Updated document-schema.js to ^5.5.1

## [6.1.4](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.1.3...markdown-codec%406.1.4) (2026-09-03)


### Dependencies

- Updated document-schema.js to ^5.5.0

## [6.1.3](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.1.2...markdown-codec%406.1.3) (2026-09-02)

### Miscellaneous Chores

* **deps:** bump document-schema.js to ^5.4.0 in markdown-codec [skip ci] ([06bf2aa](https://github.com/ExaDev/documents.js/commit/06bf2aa035433efefaf5cbf491c81eca64e68a87))


### Dependencies

- Updated document-schema.js to ^5.4.0

## [6.1.2](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.1.1...markdown-codec%406.1.2) (2026-09-02)

### Miscellaneous Chores

* **deps:** bump document-schema.js to ^5.3.0 in markdown-codec [skip ci] ([996d22f](https://github.com/ExaDev/documents.js/commit/996d22f20dad985f9b7d0f52e941fddc5c4b964a))


### Dependencies

- Updated document-schema.js to ^5.3.0

## [6.1.1](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.1.0...markdown-codec%406.1.1) (2026-09-02)

### Miscellaneous Chores

* **deps:** bump document-schema.js to ^5.2.0 in markdown-codec [skip ci] ([a7df916](https://github.com/ExaDev/documents.js/commit/a7df916cb18ed97db693eec933ca5e4e5a268d0f))


### Dependencies

- Updated document-schema.js to ^5.2.0

## [6.1.0](https://github.com/ExaDev/documents.js/compare/markdown-codec%406.0.0...markdown-codec%406.1.0) (2026-08-24)

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

* **deps:** bump document-schema.js to ^5.1.0 in markdown-codec [skip ci] ([37dd669](https://github.com/ExaDev/documents.js/commit/37dd6696707d482872e6bf05418bfe9e86136c5c))
* **deps:** drop the dependencies each package no longer uses ([80094aa](https://github.com/ExaDev/documents.js/commit/80094aa6db412392ef6e6457014d5963a5e910a7))


### Dependencies

- Updated document-schema.js to ^5.1.0

# [6.0.0](https://github.com/ExaDev/documents.js/compare/markdown-codec@5.0.3...markdown-codec@6.0.0) (2026-08-23)


* refactor(markdown-codec)!: rename DocumentPackage to DocumentTree ([23cb131](https://github.com/ExaDev/documents.js/commit/23cb131c76998410cd955e2adac767f0b2caddfd)), closes [#661](https://github.com/ExaDev/documents.js/issues/661)


### BREAKING CHANGES

* every DocumentPackage-rooted export this package
consumes or re-exports (DocumentTree, TreeNode/Group/Leaf and their
*Schema/isTreeX siblings, assembleTree, flattenTree) tracks
document-schema.js 5.0.0's rename.


### Dependencies

- Updated document-schema.js to ^5.0.0

## [5.0.3](https://github.com/ExaDev/documents.js/compare/markdown-codec@5.0.2...markdown-codec@5.0.3) (2026-08-23)


### Dependencies

- Updated document-schema.js to ^4.10.0

## [5.0.2](https://github.com/ExaDev/documents.js/compare/markdown-codec@5.0.1...markdown-codec@5.0.2) (2026-08-23)


### Dependencies

- Updated document-schema.js to ^4.9.1

## [5.0.1](https://github.com/ExaDev/documents.js/compare/markdown-codec@5.0.0...markdown-codec@5.0.1) (2026-08-22)


### Dependencies

- Updated document-schema.js to ^4.9.0

# [5.0.0](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.1.1...markdown-codec@5.0.0) (2026-08-22)

## [4.1.1](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.1.0...markdown-codec@4.1.1) (2026-08-21)

# [4.1.0](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.0.15...markdown-codec@4.1.0) (2026-08-21)


### Bug Fixes

* **documents.js:** pass construct markers through to markdown-codec's writer ([ea4c625](https://github.com/ExaDev/documents.js/commit/ea4c625c621fca63d82b37aa9527647bc99852ca))


### Features

* **markdown-codec:** blockquote container as a division construct pair ([c9d2fc0](https://github.com/ExaDev/documents.js/commit/c9d2fc0596c0ccee8406418e99d9ae859617607d))
* **markdown-codec:** carry a fence's info string as the code language plus quarantined remainder ([ee9c859](https://github.com/ExaDev/documents.js/commit/ee9c859d4eb5ae7b97d54fb52f7f1186f46fad9e))
* **markdown-codec:** carry link and image titles as link construct annotations ([579f09d](https://github.com/ExaDev/documents.js/commit/579f09dd44b7156d3d2196eb73efc9d25a608e11))
* **markdown-codec:** display math as an embedded formula document ([e4ff1d5](https://github.com/ExaDev/documents.js/commit/e4ff1d5b97df092650db3a410dbb020a6b3ea58f))
* **markdown-codec:** raw HTML restorable through quarantined markdown residue ([2a1fcb0](https://github.com/ExaDev/documents.js/commit/2a1fcb049d0c6d8548ee170c9d3332fb4f6f0a70))
* **markdown-codec:** reference definitions and front matter through the package tree ([697c4c6](https://github.com/ExaDev/documents.js/commit/697c4c68f49e00d6b9ee2d7aa8e24b1ffbc7275c))
* **markdown-codec:** task checkbox state and item identity on the list membership ([e948e4e](https://github.com/ExaDev/documents.js/commit/e948e4e66ca93de745324919fce5cac8df403a85))


### Dependencies

- Updated document-schema.js to ^4.8.0

## [4.0.15](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.0.14...markdown-codec@4.0.15) (2026-08-21)


### Dependencies

- Updated document-schema.js to ^4.7.0

## [4.0.14](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.0.13...markdown-codec@4.0.14) (2026-08-21)


### Dependencies

- Updated document-schema.js to ^4.6.0

## [4.0.13](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.0.12...markdown-codec@4.0.13) (2026-08-21)


### Dependencies

- Updated document-schema.js to ^4.5.0

## [4.0.12](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.0.11...markdown-codec@4.0.12) (2026-08-20)

## [4.0.11](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.0.10...markdown-codec@4.0.11) (2026-08-20)

## [4.0.10](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.0.9...markdown-codec@4.0.10) (2026-08-20)


### Dependencies

- Updated document-schema.js to ^4.3.7

## [4.0.9](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.0.8...markdown-codec@4.0.9) (2026-08-20)


### Dependencies

- Updated document-schema.js to ^4.3.6

## [4.0.8](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.0.7...markdown-codec@4.0.8) (2026-08-20)


### Bug Fixes

* point package homepage and bugs URLs at the monorepo, not the old standalone repos ([1b605e8](https://github.com/ExaDev/documents.js/commit/1b605e846393f417001227758a8606347c04e219))


### Dependencies

- Updated document-schema.js to ^4.3.5

## [4.0.7](https://github.com/ExaDev/documents.js/compare/markdown-codec@4.0.6...markdown-codec@4.0.7) (2026-08-20)


### Dependencies

- Updated document-schema.js to ^4.3.4

# [4.0.0](https://github.com/ExaDev/markdown-codec/compare/v3.1.1...v4.0.0) (2026-08-19)


* feat(api)!: make readMarkdown/writeMarkdown DocumentPackage-native ([6ce1abf](https://github.com/ExaDev/markdown-codec/commit/6ce1abf840f6e1bf3620a2a283b3bf725b12fd76))


### Bug Fixes

* **write:** report dropped package tables and type flattenPackage's own errors ([4655d5e](https://github.com/ExaDev/markdown-codec/commit/4655d5e53f921287b989e98427f68883cf42c932))


### BREAKING CHANGES

* readMarkdown returns { documentPackage: DocumentPackage },
not { document: ContentDocument }; writeMarkdown accepts a DocumentPackage,
not a ContentDocument; and markdownCodec decodes to a DocumentPackage. A
caller that wants the previous flat behaviour should rename its calls to
readMarkdownContent, writeMarkdownContent, and markdownContentCodec, whose
signatures and behaviour are unchanged. The result field is documentPackage
rather than package because package is a reserved word in strict mode.

## [3.1.1](https://github.com/ExaDev/markdown-codec/compare/v3.1.0...v3.1.1) (2026-08-19)

# [3.1.0](https://github.com/ExaDev/markdown-codec/compare/v3.0.1...v3.1.0) (2026-08-18)


### Bug Fixes

* **block:** recognise a footnote definition following a still-open top-level list ([3309f63](https://github.com/ExaDev/markdown-codec/commit/3309f630de448a8b5bc8ce7c16a20cd4cc3de0a8))
* **emit:** decline to spell a footnote anchor name that would reparse as something else ([04b2e9e](https://github.com/ExaDev/markdown-codec/commit/04b2e9ec0fd433a43746ad6c4794e9898d55c7c0))


### Features

* lower a footnote definition to an anchor construct and its reference to a marked run ([afc72fe](https://github.com/ExaDev/markdown-codec/commit/afc72febdf440a8384b919d01155db4572b6d34f))
* parse GitHub footnote definitions and references ([0167c1c](https://github.com/ExaDev/markdown-codec/commit/0167c1c2a513c5217943f1638cf02ffa2143c0bb))
* render construct boundary markers back to markdown ([aa5d3b1](https://github.com/ExaDev/markdown-codec/commit/aa5d3b14d14ec728c6ec1ba2feea68be811df83c))

## [3.0.1](https://github.com/ExaDev/markdown-codec/compare/v3.0.0...v3.0.1) (2026-08-18)

# [3.0.0](https://github.com/ExaDev/markdown-codec/compare/v2.0.0...v3.0.0) (2026-08-18)


* feat!: migrate to document-schema.js 4.0.0 (formatVersion retired, depth-only list memberships) ([226463a](https://github.com/ExaDev/markdown-codec/commit/226463a7b43ba788369b50c9b0004437d623c04b))


### BREAKING CHANGES

* readMarkdown's emitted ContentDocuments no longer
carry formatVersion and validate against document-schema.js 4;
consumers still validating against schema 3 must move to 4.

# [2.0.0](https://github.com/ExaDev/markdown-codec/compare/v1.4.2...v2.0.0) (2026-08-17)


* feat!: populate canonical headingLevel on read and clamp write-side levels via the shared helper ([32bc2de](https://github.com/ExaDev/markdown-codec/commit/32bc2de55c5945356ec6375c763043f598192c0c)), closes [#-depth](https://github.com/ExaDev/markdown-codec/issues/-depth)


### BREAKING CHANGES

* readMarkdown's emitted ContentDocuments now carry
CONTENT_FORMAT_VERSION 3 and validate against document-schema.js 3;
consumers still validating against schema 2 must move to 3.

## [1.4.2](https://github.com/ExaDev/markdown-codec/compare/v1.4.1...v1.4.2) (2026-08-17)

## [1.4.1](https://github.com/ExaDev/markdown-codec/compare/v1.4.0...v1.4.1) (2026-08-17)

# [1.4.0](https://github.com/ExaDev/markdown-codec/compare/v1.3.31...v1.4.0) (2026-08-17)


### Features

* recognise $$ display math and \( \) inline math ([f21ee9b](https://github.com/ExaDev/markdown-codec/commit/f21ee9b8f774cd092b70bf26ce6f7ca17c1693d4)), closes [ExaDev/documents.js#563](https://github.com/ExaDev/documents.js/issues/563)

## [1.3.31](https://github.com/ExaDev/markdown-codec/compare/v1.3.30...v1.3.31) (2026-08-17)

## [1.3.30](https://github.com/ExaDev/markdown-codec/compare/v1.3.29...v1.3.30) (2026-08-17)

## [1.3.29](https://github.com/ExaDev/markdown-codec/compare/v1.3.28...v1.3.29) (2026-08-17)

## [1.3.28](https://github.com/ExaDev/markdown-codec/compare/v1.3.27...v1.3.28) (2026-08-17)

## [1.3.27](https://github.com/ExaDev/markdown-codec/compare/v1.3.26...v1.3.27) (2026-08-17)

## [1.3.26](https://github.com/ExaDev/markdown-codec/compare/v1.3.25...v1.3.26) (2026-08-17)

## [1.3.25](https://github.com/ExaDev/markdown-codec/compare/v1.3.24...v1.3.25) (2026-08-17)

## [1.3.24](https://github.com/ExaDev/markdown-codec/compare/v1.3.23...v1.3.24) (2026-08-17)

## [1.3.23](https://github.com/ExaDev/markdown-codec/compare/v1.3.22...v1.3.23) (2026-08-14)

## [1.3.22](https://github.com/ExaDev/markdown-codec/compare/v1.3.21...v1.3.22) (2026-08-13)

## [1.3.21](https://github.com/ExaDev/markdown-codec/compare/v1.3.20...v1.3.21) (2026-08-13)

## [1.3.20](https://github.com/ExaDev/markdown-codec/compare/v1.3.19...v1.3.20) (2026-08-12)

## [1.3.19](https://github.com/ExaDev/markdown-codec/compare/v1.3.18...v1.3.19) (2026-08-12)

## [1.3.18](https://github.com/ExaDev/markdown-codec/compare/v1.3.17...v1.3.18) (2026-08-12)

## [1.3.17](https://github.com/ExaDev/markdown-codec/compare/v1.3.16...v1.3.17) (2026-08-12)

## [1.3.16](https://github.com/ExaDev/markdown-codec/compare/v1.3.15...v1.3.16) (2026-08-12)


### Bug Fixes

* **ci:** exempt dependabot commits from commitlint body-line-length ([f34e8c4](https://github.com/ExaDev/markdown-codec/commit/f34e8c47dafd49fe399eb0ca9d62a13fcaff6a3c))

## [1.3.15](https://github.com/ExaDev/markdown-codec/compare/v1.3.14...v1.3.15) (2026-08-12)

## [1.3.14](https://github.com/ExaDev/markdown-codec/compare/v1.3.13...v1.3.14) (2026-08-12)

## [1.3.13](https://github.com/ExaDev/markdown-codec/compare/v1.3.12...v1.3.13) (2026-08-12)

## [1.3.12](https://github.com/ExaDev/markdown-codec/compare/v1.3.11...v1.3.12) (2026-08-12)

## [1.3.11](https://github.com/ExaDev/markdown-codec/compare/v1.3.10...v1.3.11) (2026-08-12)

## [1.3.10](https://github.com/ExaDev/markdown-codec/compare/v1.3.9...v1.3.10) (2026-08-10)

## [1.3.9](https://github.com/ExaDev/markdown-codec/compare/v1.3.8...v1.3.9) (2026-08-10)

## [1.3.8](https://github.com/ExaDev/markdown-codec/compare/v1.3.7...v1.3.8) (2026-08-08)

## [1.3.7](https://github.com/ExaDev/markdown-codec/compare/v1.3.6...v1.3.7) (2026-08-08)

## [1.3.6](https://github.com/ExaDev/markdown-codec/compare/v1.3.5...v1.3.6) (2026-08-07)

## [1.3.5](https://github.com/ExaDev/markdown-codec/compare/v1.3.4...v1.3.5) (2026-08-07)

## [1.3.4](https://github.com/ExaDev/markdown-codec/compare/v1.3.3...v1.3.4) (2026-08-07)

## [1.3.3](https://github.com/ExaDev/markdown-codec/compare/v1.3.2...v1.3.3) (2026-08-07)

## [1.3.2](https://github.com/ExaDev/markdown-codec/compare/v1.3.1...v1.3.2) (2026-08-07)

## [1.3.1](https://github.com/ExaDev/markdown-codec/compare/v1.3.0...v1.3.1) (2026-08-07)

# [1.3.0](https://github.com/ExaDev/markdown-codec/compare/v1.2.5...v1.3.0) (2026-08-07)


### Features

* ban split-statement import-then-export re-exports ([38e01cb](https://github.com/ExaDev/markdown-codec/commit/38e01cb8667c57d2b6d5d301be57cd2cdb5c0d5a))

## [1.2.5](https://github.com/ExaDev/markdown-codec/compare/v1.2.4...v1.2.5) (2026-08-07)

## [1.2.4](https://github.com/ExaDev/markdown-codec/compare/v1.2.3...v1.2.4) (2026-08-07)

## [1.2.3](https://github.com/ExaDev/markdown-codec/compare/v1.2.2...v1.2.3) (2026-08-06)

## [1.2.2](https://github.com/ExaDev/markdown-codec/compare/v1.2.1...v1.2.2) (2026-08-06)

## [1.2.1](https://github.com/ExaDev/markdown-codec/compare/v1.2.0...v1.2.1) (2026-08-06)

# [1.2.0](https://github.com/ExaDev/markdown-codec/compare/v1.1.25...v1.2.0) (2026-08-06)


### Features

* cache typecheck/lint/test/build tasks with turbo ([14e9604](https://github.com/ExaDev/markdown-codec/commit/14e9604c6abaf486d07897402c4a962822ce8f39))

## [1.1.25](https://github.com/ExaDev/markdown-codec/compare/v1.1.24...v1.1.25) (2026-08-06)

## [1.1.24](https://github.com/ExaDev/markdown-codec/compare/v1.1.23...v1.1.24) (2026-08-06)

## [1.1.23](https://github.com/ExaDev/markdown-codec/compare/v1.1.22...v1.1.23) (2026-08-06)

## [1.1.22](https://github.com/ExaDev/markdown-codec/compare/v1.1.21...v1.1.22) (2026-08-06)

## [1.1.21](https://github.com/ExaDev/markdown-codec/compare/v1.1.20...v1.1.21) (2026-08-06)

## [1.1.20](https://github.com/ExaDev/markdown-codec/compare/v1.1.19...v1.1.20) (2026-08-06)

## [1.1.19](https://github.com/ExaDev/markdown-codec/compare/v1.1.18...v1.1.19) (2026-08-06)

## [1.1.18](https://github.com/ExaDev/markdown-codec/compare/v1.1.17...v1.1.18) (2026-08-06)

## [1.1.17](https://github.com/ExaDev/markdown-codec/compare/v1.1.16...v1.1.17) (2026-08-06)

## [1.1.16](https://github.com/ExaDev/markdown-codec/compare/v1.1.15...v1.1.16) (2026-08-06)

## [1.1.15](https://github.com/ExaDev/markdown-codec/compare/v1.1.14...v1.1.15) (2026-08-06)

## [1.1.14](https://github.com/ExaDev/markdown-codec/compare/v1.1.13...v1.1.14) (2026-08-05)

## [1.1.13](https://github.com/ExaDev/markdown-codec/compare/v1.1.12...v1.1.13) (2026-08-05)

## [1.1.12](https://github.com/ExaDev/markdown-codec/compare/v1.1.11...v1.1.12) (2026-08-05)

## [1.1.11](https://github.com/ExaDev/markdown-codec/compare/v1.1.10...v1.1.11) (2026-08-05)

## [1.1.10](https://github.com/ExaDev/markdown-codec/compare/v1.1.9...v1.1.10) (2026-08-05)

## [1.1.9](https://github.com/ExaDev/markdown-codec/compare/v1.1.8...v1.1.9) (2026-08-05)

## [1.1.8](https://github.com/ExaDev/markdown-codec/compare/v1.1.7...v1.1.8) (2026-08-05)

## [1.1.7](https://github.com/ExaDev/markdown-codec/compare/v1.1.6...v1.1.7) (2026-08-04)

## [1.1.6](https://github.com/ExaDev/markdown-codec/compare/v1.1.5...v1.1.6) (2026-08-04)

## [1.1.5](https://github.com/ExaDev/markdown-codec/compare/v1.1.4...v1.1.5) (2026-08-04)

## [1.1.4](https://github.com/ExaDev/markdown-codec/compare/v1.1.3...v1.1.4) (2026-08-04)

## [1.1.3](https://github.com/ExaDev/markdown-codec/compare/v1.1.2...v1.1.3) (2026-08-04)

## [1.1.2](https://github.com/ExaDev/markdown-codec/compare/v1.1.1...v1.1.2) (2026-08-04)

## [1.1.1](https://github.com/ExaDev/markdown-codec/compare/v1.1.0...v1.1.1) (2026-08-04)

# [1.1.0](https://github.com/ExaDev/markdown-codec/compare/v1.0.10...v1.1.0) (2026-08-03)


### Features

* export internal style-constants and list-id vocabulary for sibling packages ([a9c2fac](https://github.com/ExaDev/markdown-codec/commit/a9c2fac1897b9731a4928d57ee5b0ae68af2b087))

## [1.0.10](https://github.com/ExaDev/markdown-codec/compare/v1.0.9...v1.0.10) (2026-08-03)

## [1.0.9](https://github.com/ExaDev/markdown-codec/compare/v1.0.8...v1.0.9) (2026-08-03)


### Bug Fixes

* **ci:** use pull_request_target so dependabot auto-merge can read secrets ([f0dfce7](https://github.com/ExaDev/markdown-codec/commit/f0dfce773c5715e60c00b07525b8cb5bad7fa6fc))

## [1.0.8](https://github.com/ExaDev/markdown-codec/compare/v1.0.7...v1.0.8) (2026-08-03)


### Bug Fixes

* **ci:** wait for a real check-run to register before requesting auto-merge ([bdd906d](https://github.com/ExaDev/markdown-codec/commit/bdd906d31a16c2eaaf68bbee1d63e44fa638098b))

## [1.0.7](https://github.com/ExaDev/markdown-codec/compare/v1.0.6...v1.0.7) (2026-08-03)


### Bug Fixes

* **ci:** use the GitHub App token for the branch push and PR creation too ([8f536da](https://github.com/ExaDev/markdown-codec/commit/8f536dae04c3e2c4f1bc349b5d1e00b4b17e0f88))

## [1.0.6](https://github.com/ExaDev/markdown-codec/compare/v1.0.5...v1.0.6) (2026-08-03)


### Bug Fixes

* **ci:** wrap the sibling-bump commit body onto two lines under commitlint's limit ([a8dfc97](https://github.com/ExaDev/markdown-codec/commit/a8dfc97750a8ae4cc1b1232ce85c25e5540b3eb7))

## [1.0.5](https://github.com/ExaDev/markdown-codec/compare/v1.0.4...v1.0.5) (2026-08-03)


### Bug Fixes

* **ci:** use single-quoted string literals in workflow if-conditions ([e6d5bf1](https://github.com/ExaDev/markdown-codec/commit/e6d5bf184e1894d6770925cf345e4e5a10714887))

## [1.0.4](https://github.com/ExaDev/markdown-codec/compare/v1.0.3...v1.0.4) (2026-08-03)

## [1.0.3](https://github.com/ExaDev/markdown-codec/compare/v1.0.2...v1.0.3) (2026-08-03)

## [1.0.2](https://github.com/ExaDev/markdown-codec/compare/v1.0.1...v1.0.2) (2026-08-03)

## [1.0.1](https://github.com/ExaDev/markdown-codec/compare/v1.0.0...v1.0.1) (2026-08-03)

# 1.0.0 (2026-08-03)


### Bug Fixes

* force tsdown's unrun config loader in the prepare script ([1134222](https://github.com/ExaDev/markdown-codec/commit/11342229e6e6b7c0a773af199b1d0352611c9c6b))
* recognise ftp:// extended autolinks and reject email addresses ending in - or _ ([873b900](https://github.com/ExaDev/markdown-codec/commit/873b900152f727c8df7307eb07b30a499b179d8e))
* ship a prebuilt dist to make git-dependency consumption reliable ([beda0a8](https://github.com/ExaDev/markdown-codec/commit/beda0a89d92fffd153d5dcd05d767b404b721cda))


### Features

* add CommonMark-HTML conformance oracle ([1c3dec4](https://github.com/ExaDev/markdown-codec/commit/1c3dec4669fdd48dd82c7cb2dfea3b3939e278b3))
* add L0 primitives (diagnostics, ast, options, scan, image, entity table) ([bbed266](https://github.com/ExaDev/markdown-codec/commit/bbed266f929deec6927a7d1cc0df10257d62119f))
* implement block phase (containers, lists, tables, setext headings) ([09b2b5a](https://github.com/ExaDev/markdown-codec/commit/09b2b5a367a1db31aa0d9be4a2d3ab630742df6c))
* implement inline phase (emphasis, links, autolinks, entities) ([20d41f4](https://github.com/ExaDev/markdown-codec/commit/20d41f41586fd36b48e7d2afecc9ff3d052220ee))
* map AST to and from ContentDocument ([6740d83](https://github.com/ExaDev/markdown-codec/commit/6740d83bcc7e397af4696b896f4560b5fd2a386b))
* wire public readMarkdown/writeMarkdown API and pass CommonMark+GFM conformance ([d9afdb6](https://github.com/ExaDev/markdown-codec/commit/d9afdb68887c51b07e38137b1d83e846e07d80d0))
