# document-outline.js

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/document-outline.js) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/document-outline.js) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/document-outline.js/ci.yml?branch=main)](https://github.com/ExaDev/document-outline.js/actions)

> Heading- and level-driven hierarchical outlines over any `ContentDocument` — all five document kinds — for the [documents.js family](https://github.com/ExaDev). Worker-isomorphic: the same code runs under Node and inside a Cloudflare Workers isolate.

Created for [document-schema.js#14](https://github.com/ExaDev/document-schema.js/issues/14): none of `ContentDocument`'s shapes groups content by heading or list level — a heading paragraph sits in a flat `blocks` array like any other — so every consumer needing a nested tree (chunking a document for retrieval, generating a table of contents, structural diffing) had to rebuild one for itself. This package is that transform, once, depending only on `document-schema`.

## Status

Bootstrapped; implementation arriving via pull request. See the issue for the per-kind hierarchy design.

## License

MIT
