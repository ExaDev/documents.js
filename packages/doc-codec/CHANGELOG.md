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
