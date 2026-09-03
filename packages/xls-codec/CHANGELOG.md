## [1.0.1](https://github.com/ExaDev/documents.js/compare/xls-codec%401.0.0...xls-codec%401.0.1) (2026-09-03)

### Documentation

* record that archive-codec writes compound files, not only reads them ([b8873e7](https://github.com/ExaDev/documents.js/commit/b8873e7336ecbe41e2fdb4ff19afadc94c2f65bd)), references [#815](https://github.com/ExaDev/documents.js/issues/815)


### Dependencies

- Updated archive-codec to ^1.3.0

## 1.0.0 (2026-09-03)

### Features

* **xls-codec:** decode RK numbers, error values, substreams, formats, serials ([2bd5e08](https://github.com/ExaDev/documents.js/commit/2bd5e08796c725b8b3d4e385bb6c099ab5dfb5a3))
* **xls-codec:** read a BIFF8 workbook into the shared content schema ([6bd9cc7](https://github.com/ExaDev/documents.js/commit/6bd9cc7a88730cccd8031b2877eac172d951123b))
* **xls-codec:** read the BIFF record framing, strings, and continuations ([64bb7b8](https://github.com/ExaDev/documents.js/commit/64bb7b8f00ddd039e2181394812c996331c39080))
* **xls-codec:** scaffold package for the legacy .xls binary format ([f1a61c8](https://github.com/ExaDev/documents.js/commit/f1a61c8df41b07d574df91531b3020e3af6b0f4e))

### Bug Fixes

* **xls-codec:** correct the row-height flag and find a shared formula's result ([f998ea5](https://github.com/ExaDev/documents.js/commit/f998ea571f66458719bfa4cd5faa127333bac8cc))

### Documentation

* **xls-codec:** link the classifier-duplication issue from its own module ([467341c](https://github.com/ExaDev/documents.js/commit/467341cc24392c83a9fb9e3cff4f2855a19a3cf0))
* **xls-codec:** state the reader's real coverage and its gaps ([fb854bd](https://github.com/ExaDev/documents.js/commit/fb854bdb481a50edf0c7ccc0026c0a00becc63c5))

### Styles

* **xls-codec:** normalise README emphasis markers to Prettier's form ([421519a](https://github.com/ExaDev/documents.js/commit/421519a42e934e5aca036d71bdd2fa0766c5ca3d))

### Tests

* **xls-codec:** validate the reader's output against the schema itself ([f34fcdc](https://github.com/ExaDev/documents.js/commit/f34fcdcee03b5ca26f654047266ba44b77b7b90a))
