# WHATWG HTML5 named character reference (entity) table

`entities.json` fetched directly from `https://html.spec.whatwg.org/entities.json`, fetched 2026-08-02. Server-reported `Last-Modified: Wed, 12 Nov 2025 00:20:03 GMT`, `ETag: "6913d2b3-239e9"` (captured from the response headers at fetch time, recorded here since the WHATWG HTML Standard is a Living Standard with no discrete version numbers or tags the way CommonMark/GFM above have — the file has no fixed "version" to cite beyond the point-in-time snapshot this fetch captured). 2231 named character references (e.g. `&amp;`, `&AElig;`, `&nbsp`), each mapping to its Unicode codepoint(s) and literal character(s) — this package's own source for decoding a markdown document's HTML named entity references (CommonMark's own spec requires recognising the full HTML5 entity list, not just the handful of XML-predefined ones).

## Licence

Per the WHATWG HTML Standard's own footer (`https://html.spec.whatwg.org/`, read in full before vendoring):

> Copyright © WHATWG (Apple, Google, Mozilla, Microsoft). This work is licensed under a Creative Commons Attribution 4.0 International License. To the extent portions of it are incorporated into source code, such portions in the source code are licensed under the BSD 3-Clause License instead.

`entities.json` is data incorporated directly into this package's own source (read at build/run time by `src/inline`'s entity-decoding logic), so the WHATWG's own footer clause applies: the BSD 3-Clause License, not CC-BY 4.0, governs this vendored copy. This vendoring is unmodified verbatim redistribution of the table for use as this package's own entity-decoding data and test fixtures, with attribution recorded here.
