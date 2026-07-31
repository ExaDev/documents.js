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
