# [1.5.0](https://github.com/ExaDev/documents/compare/v1.4.0...v1.5.0) (2026-08-08)


### Features

* add toast notifications and a shared diagnostics panel ([212f73d](https://github.com/ExaDev/documents/commit/212f73df642b55664c5e920ba48067de8bc6edde))
* wire toast notifications into the four tool routes ([76c2790](https://github.com/ExaDev/documents/commit/76c2790d24fece108c72fbc5ca8ca1e3f807012d))

# [1.4.0](https://github.com/ExaDev/documents/compare/v1.3.0...v1.4.0) (2026-08-08)


### Features

* add drag-and-drop upload, shared across every tool ([e57e8e1](https://github.com/ExaDev/documents/commit/e57e8e141af3b954eab38a4419464a310c03169a))

# [1.3.0](https://github.com/ExaDev/documents/compare/v1.2.0...v1.3.0) (2026-08-08)


### Features

* redesign convert as a layout route with searchable dropdowns ([1739101](https://github.com/ExaDev/documents/commit/17391016961c454aa45b826640211440e7368681))
* replace the header-only nav with a persistent sidebar shell ([54d345b](https://github.com/ExaDev/documents/commit/54d345bfe63786eb8d5f27f68f27428cf0409694))

# [1.2.0](https://github.com/ExaDev/documents/compare/v1.1.0...v1.2.0) (2026-08-08)


### Features

* make the app installable as a PWA ([fc4564e](https://github.com/ExaDev/documents/commit/fc4564eb8ab9aff8584c45cb60eea041521ed8ba))
* switch from hash routing to clean browser-history URLs ([f96cd23](https://github.com/ExaDev/documents/commit/f96cd237ee6d2667dd74a1f65ce3fef2fd283b99))


### Reverts

* Revert "feat: switch from hash routing to clean browser-history URLs" ([8f0ab54](https://github.com/ExaDev/documents/commit/8f0ab542955c655fe743375bed24ba25c4485275))

# [1.1.0](https://github.com/ExaDev/documents/compare/v1.0.0...v1.1.0) (2026-08-08)


### Bug Fixes

* clone Uint8Array before transfer so callers can reuse source bytes ([b25fbf4](https://github.com/ExaDev/documents/commit/b25fbf4a1a795147c4f0a8934b3011d8d8ad64f6))


### Features

* add metadata, PDF inspect, and fonts tool routes ([3610c5b](https://github.com/ExaDev/documents/commit/3610c5b02549b3ab917ec7b0a79ac0f0c347e9d5))
* add pdf.inspect and fonts.extractSourceFonts procedures ([53fd8dc](https://github.com/ExaDev/documents/commit/53fd8dc46955c3cc8b2c962c1ab742e78258f8bc))

# 1.0.0 (2026-08-08)


### Features

* add Dexie schema for recent files and editor sessions ([3ceca29](https://github.com/ExaDev/documents/commit/3ceca292bfb26dd9ebbcf61c60bcb20aebc73dca))
* add document-converter and file-access ports/adapters ([f74ebc5](https://github.com/ExaDev/documents/commit/f74ebc52ca9a34871ccd25e50428cbb568f61157))
* add oRPC Worker boundary for documents.js conversions ([98ddedd](https://github.com/ExaDev/documents/commit/98ddedd012bfe8810e0d395a9fd61e9700736c0b))
* add the convert tool with hash-based routing ([fbccb2e](https://github.com/ExaDev/documents/commit/fbccb2e75239f15548400050015ff454d8776551))
