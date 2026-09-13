## [1.4.7](https://github.com/ExaDev/documents.js/compare/document-rest%401.4.6...document-rest%401.4.7) (2026-09-13)

### Bug Fixes

* **document-rest:** abort the operation's signal via the response's close event, not the request's ([8307617](https://github.com/ExaDev/documents.js/commit/8307617458f1f44d7e9b1c247ced9d2a1b3d0f17))

### Code Refactoring

* **document-rest:** build the error-mapper registry per call instead of at module scope ([d226ad2](https://github.com/ExaDev/documents.js/commit/d226ad287161bb59453f5b0aced302e5dd0b1bae))
* **document-rest:** slice off the pathname's leading slash instead of a regex replace ([fc24de8](https://github.com/ExaDev/documents.js/commit/fc24de86b67865c2ad75e2c5af1928deb8b5f2fb))

### Tests

* **document-rest:** cover the CLI's port/host flag parsing edge cases ([4e0fb3f](https://github.com/ExaDev/documents.js/commit/4e0fb3fdcf0043358c0b079eec15dff16fbc80c5))
* **document-rest:** cover the CLI's TCP-address invariant via a mocked http server ([4d3f03b](https://github.com/ExaDev/documents.js/commit/4d3f03b0cfead0f86de3487524f1a598a1949565))
* **document-rest:** cover the malformed-request guard for a missing url or method ([33b523d](https://github.com/ExaDev/documents.js/commit/33b523d71740700f78fc473b9e33499665b9df70))
* **document-rest:** cover the SEA entry point's error handling ([161bf51](https://github.com/ExaDev/documents.js/commit/161bf5181cf88a03d5bc46206c82605ca5b10f38))
* **document-rest:** strengthen response-body assertions on the REST server's HTTP tests ([ce26a4f](https://github.com/ExaDev/documents.js/commit/ce26a4f92905089fc813e9508e36bb92d21e91ac))

### Miscellaneous Chores

* **document-rest:** raise the mutation break threshold to 100 ([77e254e](https://github.com/ExaDev/documents.js/commit/77e254e72c2df8244a9fd393a66cc4330e8322d2))


### Dependencies

- Updated odf.js to 7.25.3
- Updated documents.js to 7.20.7
- Updated document-operations to 1.1.7

## [1.4.6](https://github.com/ExaDev/documents.js/compare/document-rest%401.4.5...document-rest%401.4.6) (2026-09-12)


### Dependencies

- Updated documents.js to 7.20.6
- Updated document-operations to 1.1.6

## [1.4.5](https://github.com/ExaDev/documents.js/compare/document-rest%401.4.4...document-rest%401.4.5) (2026-09-12)


### Dependencies

- Updated documents.js to 7.20.5
- Updated document-operations to 1.1.5

## [1.4.4](https://github.com/ExaDev/documents.js/compare/document-rest%401.4.3...document-rest%401.4.4) (2026-09-12)


### Dependencies

- Updated documents.js to 7.20.4
- Updated document-operations to 1.1.4

## [1.4.3](https://github.com/ExaDev/documents.js/compare/document-rest%401.4.2...document-rest%401.4.3) (2026-09-11)


### Dependencies

- Updated document-operations to 1.1.3

## [1.4.2](https://github.com/ExaDev/documents.js/compare/document-rest%401.4.1...document-rest%401.4.2) (2026-09-11)


### Dependencies

- Updated documents.js to 7.20.3
- Updated document-operations to 1.1.2

## [1.4.1](https://github.com/ExaDev/documents.js/compare/document-rest%401.4.0...document-rest%401.4.1) (2026-09-11)


### Dependencies

- Updated odf.js to 7.25.2
- Updated documents.js to 7.20.2
- Updated document-operations to 1.1.1

## [1.4.0](https://github.com/ExaDev/documents.js/compare/document-rest%401.3.0...document-rest%401.4.0) (2026-09-11)

### Features

* **ci:** publish document-rest and document-mcp as GHCR container images ([8cf783b](https://github.com/ExaDev/documents.js/commit/8cf783b6087f78319276e317401c2106c1aca8d0))
* **document-rest:** add a --host flag, defaulting to loopback ([21c9b1d](https://github.com/ExaDev/documents.js/commit/21c9b1dddec686bcbf3c43e726187e2ffc9de394))

## [1.3.0](https://github.com/ExaDev/documents.js/compare/document-rest%401.2.0...document-rest%401.3.0) (2026-09-11)

### Features

* **ci:** build ARM64 Linux and Windows SEA binaries too ([78cfe9f](https://github.com/ExaDev/documents.js/commit/78cfe9fae5c8478ea47a69a9a6dcc723bb696bb4))

## [1.2.0](https://github.com/ExaDev/documents.js/compare/document-rest%401.1.0...document-rest%401.2.0) (2026-09-11)

### Features

* **ci:** build Intel macOS SEA binaries alongside Apple Silicon ([f0a48a1](https://github.com/ExaDev/documents.js/commit/f0a48a19050089f14ecc8a94430a0278bb2b35d8))

## [1.1.0](https://github.com/ExaDev/documents.js/compare/document-rest%401.0.0...document-rest%401.1.0) (2026-09-11)

### Features

* **document-rest:** build a Node SEA single-executable binary ([39b484c](https://github.com/ExaDev/documents.js/commit/39b484c69cafc43e9e641e1f0236e9a67fbe9dd2))

### Documentation

* document the Node SEA binary distribution for cli/mcp/rest ([420ea7c](https://github.com/ExaDev/documents.js/commit/420ea7cf34e2073950f7e1b823c86f403a8bf25a))

## 1.0.0 (2026-09-11)

### Features

* **document-rest:** add a plain REST API server over document-operations ([5f6e748](https://github.com/ExaDev/documents.js/commit/5f6e7481a731f80e30a584a1a1614b42b0a956fe))

### Bug Fixes

* **document-rest:** add the real smoke test its package.json promised ([7d2a351](https://github.com/ExaDev/documents.js/commit/7d2a351c383056bdf9e539ad0ecc1daa8f9882ac))
* **document-rest:** pin document-operations to its released 1.0.0 ([08330d7](https://github.com/ExaDev/documents.js/commit/08330d7ff09ad00de4f49a0e0e14dc47942f7908))
* **document-rest:** scope test:coverage to the unit vitest project ([55fbe20](https://github.com/ExaDev/documents.js/commit/55fbe202b1a18d7806ac2e0a25dd4c2c886c4d8f))

### Code Refactoring

* **document-rest:** write the smoke test as TypeScript, not .mjs ([aaa0e8f](https://github.com/ExaDev/documents.js/commit/aaa0e8fc116c4835c28638343beb79be383bfa83))


### Dependencies

- Updated document-operations to 1.1.0
