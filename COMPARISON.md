# Comparison to alternatives

> **Landscape snapshot — verified 2 September 2026.** This document is a dated snapshot, not a living reference: package landscapes, pricing, and GitHub activity drift constantly. Every entry was verified by fetching its own npm/PyPI/crates.io registry page, GitHub repo, or vendor pricing page — see the "Sources" line under each entry. Adoption figures (stars, forks, contributors, commit frequency) were fetched live from the GitHub API on the date above for the entries with a public repository; entries with none show "—".

Scope: how the [documents.js ecosystem](README.md) compares against real alternatives across 11 categories and 108 verified entries — open-source libraries, cross-format conversion engines, CLI tools, MCP servers, equivalents in other language ecosystems, hyperscaler document-AI platforms, and third-party commercial/SaaS vendors. Comparison axes: direction (does it read, write, or genuinely round-trip), approach (hand-written codec vs. wraps an external engine vs. ML/OCR-based vs. template-fill), deployment model (embeddable library vs. self-hosted server vs. SaaS), licence, pricing model, and — using [CHAOSS](https://chaoss.community/) and [OpenSSF](https://github.com/ossf/criticality_score) accepted definitions rather than an invented scoring scheme — adoption and maintenance health.

## Contents

- [Foundation: byte-level codecs & archive/OLE readers](#foundation-byte-level-codecs--archiveole-readers)
- [OOXML: docx/pptx/xlsx read+write](#ooxml-docxpptxxlsx-readwrite)
- [OpenDocument: odt/ods/odp read+write](#opendocument-odtodsodp-readwrite)
- [Markdown to/from structured content (AST)](#markdown-tofrom-structured-content-ast)
- [PDF parsing & generation](#pdf-parsing--generation)
- [Cross-format document conversion engines/services](#cross-format-document-conversion-enginesservices)
- [CLI / TUI tools for document conversion](#cli--tui-tools-for-document-conversion)
- [MCP servers for document/office file manipulation](#mcp-servers-for-documentoffice-file-manipulation)
- [Equivalent packages in other language ecosystems](#equivalent-packages-in-other-language-ecosystems)
- [Platform-native document-AI conversion services](#platform-native-document-ai-conversion-services)
- [Third-party commercial document-conversion APIs & hosted LLM/RAG parsing platforms](#third-party-commercial-document-conversion-apis--hosted-llmrag-parsing-platforms)

## Foundation: byte-level codecs & archive/OLE readers

**documents.js counterpart:** byte-codec, archive-codec

This is the category where documents.js's 'hand-written, dependency-minimal' claim is least differentiating — essentially every alternative is also hand-written or ported-from-C with no dependencies. The real question byte-codec has to answer is why it exists rather than depending on fflate. For archive-codec, the closest true counterpart is SheetJS's cfb (same MS-CFB target, plus limited writing) — but cfb has no ZIP awareness, and no ZIP library has OLE/CFB support, so the combination of recursive ZIP-in-ZIP walking with depth/size guards alongside bounded CFB reading in one package is genuinely unmatched, though narrow.

| Package / service                                              | Direction    | Approach     | Deployment | Licence                   | Pricing model      | Status    |
| -------------------------------------------------------------- | ------------ | ------------ | ---------- | ------------------------- | ------------------ | --------- |
| [pako](https://www.npmjs.com/package/pako)                     | —            | Structural   | Library    | (MIT AND Zlib)            | Free / open source | Active    |
| [fflate](https://www.npmjs.com/package/fflate)                 | —            | Structural   | Library    | MIT                       | Free / open source | Active    |
| [pngjs](https://www.npmjs.com/package/pngjs)                   | —            | Structural   | Library    | MIT                       | Free / open source | Stale     |
| [jpeg-js](https://www.npmjs.com/package/jpeg-js)               | —            | Structural   | Library    | BSD-3-Clause              | Free / open source | Active    |
| [crc-32](https://www.npmjs.com/package/crc-32)                 | —            | Structural   | Library    | Apache-2.0                | Free / open source | Abandoned |
| [cfb (js-cfb)](https://www.npmjs.com/package/cfb)              | Read + Write | Structural   | Library    | Apache-2.0                | Free / open source | Abandoned |
| [jszip](https://www.npmjs.com/package/jszip)                   | Read + Write | Structural   | Library    | (MIT OR GPL-3.0-or-later) | Free / open source | Stale     |
| [@zip.js/zip.js](https://www.npmjs.com/package/@zip.js/zip.js) | Read + Write | Structural   | Library    | BSD-3-Clause              | Free / open source | Active    |
| [unzipper](https://www.npmjs.com/package/unzipper)             | Read only    | Engine / SDK | Library    | MIT                       | Free / open source | Active    |

<details>
<summary><strong>pako</strong> — full detail, pricing, and citations</summary>

High-speed zlib port to JS: deflate/inflate/gzip, byte-identical to the C zlib library. (npm · v3.0.1 · actively maintained)

**vs. documents.js:** byte-codec writes its own deflate/inflate as one primitive inside a shared foundation package; pako is a standalone compression-only library other tools pull in as a dependency.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 6.1k stars, 801 forks, 26 contributors, 1.3 commits/week avg (trailing 52wk), last push 2026-08-13

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/pako) · [github.com](https://github.com/nodeca/pako)

</details>

<details>
<summary><strong>fflate</strong> — full detail, pricing, and citations</summary>

Very fast, tree-shakeable DEFLATE/GZIP/Zlib plus high-speed ZIP archiving/extraction. (npm · v0.8.3 · ~8kB, zero deps)

**vs. documents.js:** Closest philosophical match to byte-codec's own ethos and appears to satisfy the Worker-isomorphic constraint on its own — the sharpest 'why not just depend on this' case in the whole survey.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 3.0k stars, 124 forks, 8 contributors, 0.2 commits/week avg (trailing 52wk), last release v0.8.3 (2026-05-16)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/fflate) · [github.com](https://github.com/101arrowz/fflate)

</details>

<details>
<summary><strong>pngjs</strong> — full detail, pricing, and citations</summary>

Pure-JS PNG encoder/decoder, all standard bit depths/colour types/interlacing. (npm · v7.0.0 · 2023-02-20)

**vs. documents.js:** Same hand-written approach as byte-codec's PNG support, but built on Node's Duplex/Readable stream classes — not Worker-isomorphic.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 741 stars, 105 forks, 42 contributors, 0.0 commits/week avg (trailing 52wk), last push 2024-03-23

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/pngjs) · [github.com](https://github.com/pngjs/pngjs)

</details>

<details>
<summary><strong>jpeg-js</strong> — full detail, pricing, and citations</summary>

Pure-JS JPEG encoder/decoder for Node.js. (npm · v0.4.4 · 2022-06-07)

**vs. documents.js:** Comparable hand-written approach, but its own README flags it as synchronous and slower than native alternatives; no document-format awareness.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 588 stars, 125 forks, 30 contributors, 0.0 commits/week avg (trailing 52wk), last release v0.4.4 (2022-06-07)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/jpeg-js) · [github.com](https://github.com/jpeg-js/jpeg-js)

</details>

<details>
<summary><strong>crc-32</strong> — full detail, pricing, and citations</summary>

Standard CRC-32/CRC-32C checksum implementation with a bundled CLI. (npm · v1.2.2 · 2022-04-04)

**vs. documents.js:** Directly comparable to byte-codec's CRC-32 primitive, but shipped as a standalone SheetJS utility rather than inside a broader foundation layer.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 351 stars, 34 forks, 6 contributors, 0.0 commits/week avg (trailing 52wk), last push 2022-08-20

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/crc-32) · [github.com](https://github.com/SheetJS/js-crc32)

</details>

<details>
<summary><strong>cfb (js-cfb)</strong> — full detail, pricing, and citations</summary>

Pure-JS MS-CFB (classic OLE) container reader/writer, part of SheetJS. (npm · v1.2.2 · 2022-04-06)

**vs. documents.js:** Closest direct counterpart to archive-codec's CFB reader — same approach, same target — and goes further with limited CFB writing, but has zero ZIP awareness.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 78 stars, 15 forks, 6 contributors, 0.0 commits/week avg (trailing 52wk), last push 2022-11-10

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/cfb) · [github.com](https://github.com/SheetJS/js-cfb)

</details>

<details>
<summary><strong>jszip</strong> — full detail, pricing, and citations</summary>

Create/read/edit .zip files with a Promise-based API; used as the ZIP layer under many OOXML tools. (npm · v3.10.1 · 2022-08-02)

**vs. documents.js:** The most common third-party ZIP dependency other tools reach for — exactly what archive-codec deliberately avoids; also dual MIT/GPL-3.0 licensed, no OLE/CFB support.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 10.4k stars, 1.3k forks, 63 contributors, 0.0 commits/week avg (trailing 52wk), last push 2025-03-28

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/jszip) · [github.com](https://github.com/Stuk/jszip)

</details>

<details>
<summary><strong>@zip.js/zip.js</strong> — full detail, pricing, and citations</summary>

ZIP with parallel compression, Web Streams, pluggable JS/WASM/native backends, Zip64, encryption. (npm · v2.9.0)

**vs. documents.js:** Far more feature-rich as a general ZIP engine than archive-codec needs to be — fine given its narrow job, but no OLE/CFB support at all.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 3.9k stars, 548 forks, 41 contributors, 15.6 commits/week avg (trailing 52wk), last release v2.9.0 (2026-08-31)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/@zip.js/zip.js) · [github.com](https://github.com/gildas-lormeau/zip.js)

</details>

<details>
<summary><strong>unzipper</strong> — full detail, pricing, and citations</summary>

Node.js ZIP parsing/extraction via streams, delegating inflation to Node's built-in zlib. (npm · v0.12.5 · read-only)

**vs. documents.js:** Read-only and Node-specific (node:zlib, Node streams) — the opposite of archive-codec's Worker-isomorphic, zero-Node-built-in design.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 473 stars, 124 forks, 57 contributors, 0.9 commits/week avg (trailing 52wk), last release v0.12.3 (2024-07-31)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/unzipper) · [github.com](https://github.com/ZJONSSON/node-unzipper)

</details>

## OOXML: docx/pptx/xlsx read+write

**documents.js counterpart:** ooxml.js, documents.js (engine)

The npm OOXML landscape is sharply partitioned by direction and format; ooxml.js's differentiation is one package covering all three formats bidirectionally against a shared, validated schema. The write-only cluster is largest and most-adopted (docx, PptxGenJS, officegen — unmaintained since 2021); the read-only cluster is deliberately lossy (Mammoth.js, docx4js). xlsx-populate deserves credit for a genuinely different lossless strategy: preserving unmodelled parts byte-for-byte rather than fully decomposing/reassembling. Template-population tools (Docxtemplater, docx-templates, pptx-automizer, Carbone) address a large real-world niche ooxml.js doesn't touch. The commercial tier reaches these formats too — Adobe PDF Services exports PDF to Word/Excel/PPT and generates docx from templates, and OnlyOffice/Collabora convert all three natively — but always as a hosted transaction or an always-on server, never an embeddable schema-backed library.

| Package / service                                                        | Direction    | Approach     | Deployment | Licence                                    | Pricing model       | Status |
| ------------------------------------------------------------------------ | ------------ | ------------ | ---------- | ------------------------------------------ | ------------------- | ------ |
| [docx](https://www.npmjs.com/package/docx)                               | Write only   | Structural   | Library    | MIT                                        | Free / open source  | Active |
| [PptxGenJS](https://www.npmjs.com/package/pptxgenjs)                     | Write only   | Structural   | Library    | MIT                                        | Free / open source  | Active |
| [ExcelJS](https://www.npmjs.com/package/exceljs)                         | Read + Write | Structural   | Library    | MIT                                        | Free / open source  | Stale  |
| [SheetJS (xlsx)](https://www.npmjs.com/package/xlsx)                     | Read + Write | Structural   | Library    | Apache-2.0                                 | Free / open source  | Stale  |
| [docx4js](https://www.npmjs.com/package/docx4js)                         | Read + Write | Structural   | Library    | MIT                                        | Free / open source  | Active |
| [Mammoth.js](https://www.npmjs.com/package/mammoth)                      | Read only    | Structural   | Library    | BSD-2-Clause                               | Free / open source  | Active |
| [Docxtemplater](https://docxtemplater.com/)                              | Write only   | Template     | Library    | MIT core; 19 modules commercially licensed | Freemium            | Active |
| [docx-templates](https://www.npmjs.com/package/docx-templates)           | Write only   | Template     | Library    | MIT                                        | Free / open source  | Active |
| [pptx-automizer](https://www.npmjs.com/package/pptx-automizer)           | Read + Write | Template     | Library    | MIT                                        | Free / open source  | Active |
| [xlsx-populate](https://www.npmjs.com/package/xlsx-populate)             | Read + Write | Structural   | Library    | MIT                                        | Free / open source  | Stale  |
| [officegen](https://www.npmjs.com/package/officegen)                     | Write only   | Structural   | Library    | MIT                                        | Free / open source  | Stale  |
| [Aspose.Words Cloud SDK](https://www.npmjs.com/package/asposewordscloud) | Read + Write | Engine / SDK | SaaS       | MIT SDK client; service is commercial      | Per-page / per-unit | Active |

<details>
<summary><strong>docx</strong> — full detail, pricing, and citations</summary>

Generates .docx (and some pptx) from scratch via a fluent object model — Document, Paragraph, Table, TextRun. (npm · v9.7.1 · ~4.5M weekly downloads)

**vs. documents.js:** Write-only, docx/pptx-specific, bespoke object model — no read/round-trip path, no xlsx, no cross-format schema.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 5.9k stars, 609 forks, 147 contributors, 2.5 commits/week avg (trailing 52wk), last release 9.7.1 (2026-05-27)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/docx) · [github.com](https://github.com/dolanmiu/docx)

</details>

<details>
<summary><strong>PptxGenJS</strong> — full detail, pricing, and citations</summary>

Generates .pptx from scratch — slides, shapes, text, tables, charts, media. (npm · v4.0.1 · ~395 dependents)

**vs. documents.js:** pptx-only, write-only, zero runtime deps — a separate hand-rolled model per format family rather than one shared AST.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 6.1k stars, 951 forks, 68 contributors, 0.0 commits/week avg (trailing 52wk), last release v4.0.1 (2025-06-26)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/pptxgenjs) · [github.com](https://github.com/gitbrent/PptxGenJS)

</details>

<details>
<summary><strong>ExcelJS</strong> — full detail, pricing, and citations</summary>

Reads and writes .xlsx (cells, styles, formulas, images, frozen panes) in Node and browser. (npm · v4.4.0 · widely used)

**vs. documents.js:** Genuinely round-trips xlsx like ooxml.js does, but xlsx-only — no docx/pptx counterpart, no cross-format schema.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 15.5k stars, 2.0k forks, 226 contributors, 0.0 commits/week avg (trailing 52wk), last release v4.4.0 (2023-10-19)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/exceljs) · [github.com](https://github.com/exceljs/exceljs)

</details>

<details>
<summary><strong>SheetJS (xlsx)</strong> — full detail, pricing, and citations</summary>

Parses/writes a very broad range of spreadsheet formats (xlsx, xls, csv, ods, many legacy formats). (npm · npm frozen at 0.18.5; current releases via SheetJS's own CDN)

**vs. documents.js:** Format-breadth-first rather than format-agnostic — reads far more legacy spreadsheet formats, but only spreadsheets.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 36.3k stars, 7.9k forks, 201 contributors, 0.0 commits/week avg (trailing 52wk), last push 2024-04-18

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/xlsx) · [github.com](https://github.com/SheetJS/sheetjs)

</details>

<details>
<summary><strong>docx4js</strong> — full detail, pricing, and citations</summary>

Parses docx/pptx/xlsx, rendering via a caller-supplied createElement or event-handler API. (npm · v3.3.0 · last published ~2 years ago)

**vs. documents.js:** Covers all three OOXML formats like ooxml.js, but output is a render-callback/event model aimed at display, not a validated schema.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 402 stars, 71 forks, 4 contributors, 0.0 commits/week avg (trailing 52wk), last push 2026-03-31

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/docx4js) · [github.com](https://github.com/lalalic/docx4js)

</details>

<details>
<summary><strong>Mammoth.js</strong> — full detail, pricing, and citations</summary>

Converts .docx to HTML or Markdown by semantic style mapping. (npm · v1.12.2 · ~1500 dependents)

**vs. documents.js:** Deliberately lossy — drops formatting that doesn't map cleanly to HTML; one-way, no writing, no other formats.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 6.3k stars, 667 forks, 17 contributors, 0.5 commits/week avg (trailing 52wk), last release 1.2.5 (2016-11-13)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/mammoth) · [github.com](https://github.com/mwilliamson/mammoth.js)

</details>

<details>
<summary><strong>Docxtemplater</strong> — full detail, pricing, and citations</summary>

Template-fill: author docx/pptx/xlsx with {tag} placeholders, fill from JSON. (saas-api + npm · v3.69.3 · actively maintained)

**vs. documents.js:** Solves template population, not general lossless conversion; commercial-module licensing (appliance pricing $6.5k–$15k/yr) is the opposite of documents.js's fully-MIT posture.

**Free tier:** The core library is free and dual-licensed MIT/GPLv3, covering tag replacement, conditions, loops, delimiter customization.

**Pricing tiers:**

| Tier                    | Price     | Unit                                               |
| ----------------------- | --------- | -------------------------------------------------- |
| Free (open source core) | €0        | MIT or GPLv3 dual-licensed                         |
| One Module              | €500/yr   | 1 module, commercial licence                       |
| PRO                     | €1,250/yr | 4 modules                                          |
| Enterprise              | €3,000/yr | all 18 modules + Docker HTTP API                   |
| Premium                 | €9,000/yr | all 18 modules + full browser version + consulting |

**Repository health (as of 2 September 2026):** 3.6k stars, 383 forks, 36 contributors, 1.8 commits/week avg (trailing 52wk), last push 2026-08-04

**Sources:** [docxtemplater.com](https://docxtemplater.com/) · [github.com](https://github.com/open-xml-templating/docxtemplater) · [docxtemplater.com](https://docxtemplater.com/pricing/)

</details>

<details>
<summary><strong>docx-templates</strong> — full detail, pricing, and citations</summary>

Free alternative to Docxtemplater: JS-expression placeholders, no paywalled modules. (npm · v4.15.0)

**vs. documents.js:** Same template-population niche, fully MIT, but docx-only and not a general lossless editor.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 1.1k stars, 173 forks, 36 contributors, 0.1 commits/week avg (trailing 52wk), last release v4.15.0 (2025-12-03)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/docx-templates) · [github.com](https://github.com/guigrpa/docx-templates)

</details>

<details>
<summary><strong>pptx-automizer</strong> — full detail, pricing, and citations</summary>

Edits/merges existing .pptx by importing slides/shapes from template libraries. (npm · v0.9.3)

**vs. documents.js:** Optimised for reusing designer-built PowerPoint templates, not general-purpose lossless read/write; pptx-only.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 238 stars, 44 forks, 16 contributors, 2.5 commits/week avg (trailing 52wk), last release v0.9.2 (2026-08-22)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/pptx-automizer) · [github.com](https://github.com/singerla/pptx-automizer)

</details>

<details>
<summary><strong>xlsx-populate</strong> — full detail, pricing, and citations</summary>

Reads, edits, and writes .xlsx while preserving unsupported content byte-for-byte. (npm · v1.21.0)

**vs. documents.js:** A genuinely different lossless strategy — passthrough-of-the-unknown rather than ooxml.js's complete-modelling-of-the-known; xlsx-only.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 1.0k stars, 199 forks, 24 contributors, 0.0 commits/week avg (trailing 52wk), last release v1.19.1 (2019-02-13)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/xlsx-populate) · [github.com](https://github.com/dtjohnson/xlsx-populate)

</details>

<details>
<summary><strong>officegen</strong> — full detail, pricing, and citations</summary>

Generates docx/pptx/xlsx from scratch via a stream-based API. (npm · v0.6.5 · last published 2021-03-31, unmaintained)

**vs. documents.js:** Historically the closest single-package docx+pptx+xlsx generator, but write-only and abandoned — the gap documents.js's active maintenance fills.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 2.7k stars, 466 forks, 58 contributors, 0.0 commits/week avg (trailing 52wk), last release v0.6.5 (2021-03-06)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/officegen) · [github.com](https://github.com/Ziv-Barber/officegen)

</details>

<details>
<summary><strong>Aspose.Words Cloud SDK</strong> — full detail, pricing, and citations</summary>

Node SDK over the Aspose.Words Cloud REST API — create/edit/inspect/convert Word docs via a hosted service. (saas-api · actively maintained SDK)

**vs. documents.js:** Outsources parsing to a paid closed-source cloud service — no offline use, no browser/Worker execution, ongoing per-call cost.

**Free tier:** 150 API calls per month free, no credit card required; same rates apply to self-hosted Docker deployments except storage calls aren't billed there.

**Pricing tiers:**

| Tier                               | Price    | Unit             |
| ---------------------------------- | -------- | ---------------- |
| Free allowance                     | $0       | 150 API calls/mo |
| First 1,000 API calls (after free) | $30 flat | per month        |
| Next 14,000 API calls              | $0.090   | per call         |
| Next 15,000 API calls              | $0.070   | per call         |
| Next 60,000 API calls              | $0.050   | per call         |
| Beyond that                        | $0.007   | per call         |

**Repository health (as of 2 September 2026):** 30 stars, 5 forks, 12 contributors, 0.7 commits/week avg (trailing 52wk), last release asposewordscloud-26.8.0 (2026-08-10)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/asposewordscloud) · [github.com](https://github.com/aspose-words-cloud/aspose-words-cloud-node) · [docs.aspose.cloud](https://docs.aspose.cloud/words/getting-started/pricing-plan/)

</details>

## OpenDocument: odt/ods/odp read+write

**documents.js counterpart:** odf.js

The thinnest actively-maintained library category, correspondingly odf.js's strongest standalone position; odf-kit is the only serious live npm competitor and has NO ODP support at all. ODF is the format family the platform document-AI services ignore entirely, and the commercial conversion APIs and RAG-parsing platforms barely touch it. The real ODF competition isn't a library at all but the two self-hostable office servers — OnlyOffice Docs and Collabora Online — which handle odt/ods/odp comprehensively via a LibreOffice-class engine, at the cost of running a server under AGPLv3 or per-user commercial terms rather than importing a package.

| Package / service                                               | Direction    | Approach     | Deployment | Licence                             | Pricing model      | Status    |
| --------------------------------------------------------------- | ------------ | ------------ | ---------- | ----------------------------------- | ------------------ | --------- |
| [odf-kit](https://www.npmjs.com/package/odf-kit)                | Read + Write | Structural   | Library    | Apache-2.0                          | Free / open source | Active    |
| [simple-odf](https://www.npmjs.com/package/simple-odf)          | Write only   | Structural   | Library    | MIT                                 | Free / open source | Stale     |
| [odfjs](https://github.com/odfjs/odfjs)                         | Read + Write | Structural   | Library    | CC0-1.0                             | Free / open source | Active    |
| [officeparser](https://www.npmjs.com/package/officeparser)      | Read only    | Structural   | Library    | MIT                                 | Free / open source | Active    |
| [SheetJS (xlsx/CE)](https://www.npmjs.com/package/xlsx)         | Read + Write | Structural   | Library    | Apache-2.0                          | Free / open source | Active    |
| [Carbone](https://www.npmjs.com/package/carbone)                | Write only   | Template     | Library    | Commons Clause License              | Free / open source | Active    |
| [unoconv / node-unoconv](https://www.npmjs.com/package/unoconv) | Read + Write | Engine / SDK | CLI        | MIT wrapper; unoconv itself GPL-2.0 | Free / open source | Abandoned |
| [odt (legacy)](https://www.npmjs.com/package/odt)               | —            | Structural   | Library    | BSD                                 | Free / open source | Abandoned |

<details>
<summary><strong>odf-kit</strong> — full detail, pricing, and citations</summary>

Generate/fill/read/convert ODT+ODS; also converts HTML/Markdown/TipTap/Lexical/DOCX to ODT and XLSX to ODS. (npm · v0.14.1 · publishing rapidly)

**vs. documents.js:** No ODP support at all, unlike odf.js's uniform odt/ods/odp coverage; converts formats as hand-wired pairs rather than through a shared schema. The velocity risk to watch.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 26 stars, 4 forks, 2 contributors, 7.3 commits/week avg (trailing 52wk), last release v0.14.1 (2026-08-11)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/odf-kit) · [github.com](https://github.com/GitHubNewbie0/odf-kit)

</details>

<details>
<summary><strong>simple-odf</strong> — full detail, pricing, and citations</summary>

Creates OpenDocument text (and minimal spreadsheet) files. (npm · v3.0.3 · abandoned since Jan 2023)

**vs. documents.js:** Write-only, only ever produced flat .fodt XML rather than proper .odt ZIP packages, per odf-kit's own comparison.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 26 stars, 9 forks, 6 contributors, 0.0 commits/week avg (trailing 52wk), last release v3.0.3 (2023-01-12)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/simple-odf) · [github.com](https://github.com/connium/simple-odf)

</details>

<details>
<summary><strong>odfjs</strong> — full detail, pricing, and citations</summary>

Small toolbox to parse/generate ODT+ODS: typed cell reads and ODT template filling. (npm · v0.30.0 on GitHub, not conventionally npm-published)

**vs. documents.js:** Template-filling and typed-cell-read oriented, not a full lossless bidirectional codec; no ODP support.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 2 stars, 0 forks, 4 contributors, 0.3 commits/week avg (trailing 52wk), last push 2025-09-22

**Sources:** [github.com](https://github.com/odfjs/odfjs)

</details>

<details>
<summary><strong>officeparser</strong> — full detail, pricing, and citations</summary>

Extracts plain text from odt/odp/ods plus docx/pptx/xlsx/pdf/rtf/csv/md/html/epub. (npm · v7.8.0)

**vs. documents.js:** Read-only, text-extraction-only — discards structure/styling entirely; no write path.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/officeparser)

</details>

<details>
<summary><strong>SheetJS (xlsx/CE)</strong> — full detail, pricing, and citations</summary>

Covers ODS (including FODS/UOS variants) as one of many supported spreadsheet formats. (npm · v0.18.5 (npm CE build))

**vs. documents.js:** Spreadsheet-only, tuned for tabular interchange rather than a general document-tree schema; no ODT/ODP.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/xlsx) · [git.sheetjs.com](https://git.sheetjs.com/sheetjs/sheetjs)

</details>

<details>
<summary><strong>Carbone</strong> — full detail, pricing, and citations</summary>

Injects JSON data into ODT/DOCX/ODS/XLSX/ODP/PPTX templates authored in LibreOffice/MS Office. (npm · v3.8.2)

**vs. documents.js:** Data-merge/reporting, not general lossless read+write; non-permissive source-available licence versus odf.js's MIT.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 2.1k stars, 262 forks, 12 contributors, 0.2 commits/week avg (trailing 52wk), last push 2026-04-07

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/carbone) · [github.com](https://github.com/Ideolys/carbone)

</details>

<details>
<summary><strong>unoconv / node-unoconv</strong> — full detail, pricing, and citations</summary>

Node wrappers around the Python 'unoconv' CLI, which drives LibreOffice/OpenOffice for any-to-any conversion. (npm + external CLI · npm wrapper last published 2012; unoconv archived 2025)

**vs. documents.js:** Requires installing and running a full LibreOffice install — not Worker/browser-portable, black-box conversion with no structural access.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 2.7k stars, 375 forks, 52 contributors, 0.0 commits/week avg (trailing 52wk), last release 0.8.2 (2017-12-07), archived by owner

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/unoconv) · [github.com](https://github.com/unoconv/unoconv)

</details>

<details>
<summary><strong>odt (legacy)</strong> — full detail, pricing, and citations</summary>

Early Node.js tool for working with OpenDocument text files. (npm · v1.1.0 · last published 2013)

**vs. documents.js:** Historical data point only — ODT-only, over a decade without release, illustrates how thin this space is.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/odt)

</details>

## Markdown to/from structured content (AST)

**documents.js counterpart:** markdown-codec

The category where documents.js has the least room to claim novelty in parsing itself; markdown-codec is the most substitutable component in the family. remark/mdast plus micromark are the mature, bidirectional, plugin-rich, MIT, actively-maintained AST standard — a 'remark plus a mapper to ContentDocument' implementation is a credible alternative that would inherit remark's ecosystem for free. Markdown is also where the platform vendors (Cloudflare, Azure, Bedrock) and the commercial RAG-parsing platforms (LlamaParse, Reducto, Chunkr) have converged as an output target — but every one of them emits it only as a terminus, with no reader back into a document format.

| Package / service                                                          | Direction    | Approach   | Deployment | Licence          | Pricing model      | Status    |
| -------------------------------------------------------------------------- | ------------ | ---------- | ---------- | ---------------- | ------------------ | --------- |
| [remark / mdast](https://www.npmjs.com/package/remark)                     | Read + Write | Structural | Library    | MIT              | Free / open source | Active    |
| [micromark](https://www.npmjs.com/package/micromark)                       | Read only    | Structural | Library    | MIT              | Free / open source | Stale     |
| [markdown-it](https://www.npmjs.com/package/markdown-it)                   | Read only    | Structural | Library    | MIT              | Free / open source | Active    |
| [marked](https://www.npmjs.com/package/marked)                             | Read only    | Structural | Library    | MIT              | Free / open source | Active    |
| [commonmark.js](https://www.npmjs.com/package/commonmark)                  | Read only    | Structural | Library    | BSD-2-Clause     | Free / open source | Active    |
| [prosemirror-markdown](https://www.npmjs.com/package/prosemirror-markdown) | Read + Write | Structural | Library    | MIT              | Free / open source | Abandoned |
| [MDX (@mdx-js/mdx)](https://www.npmjs.com/package/@mdx-js/mdx)             | Read only    | Structural | Library    | MIT              | Free / open source | Active    |
| [Pandoc](https://pandoc.org/)                                              | Read + Write | Structural | CLI        | GPL-2.0-or-later | Free / open source | Active    |

<details>
<summary><strong>remark / mdast</strong> — full detail, pricing, and citations</summary>

Parses CommonMark+GFM into mdast (a plugin-extensible AST), serializes back via remark-stringify. (npm · remark@15.0.1 · huge plugin ecosystem)

**vs. documents.js:** mdast is markdown-only; cross-format interchange goes through separate mdast-to-hast bridges to HTML, not to docx/odt directly.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 9.0k stars, 384 forks, 142 contributors, 0.1 commits/week avg (trailing 52wk), last release remark-cli@12.0.0 (2023-09-18)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/remark) · [github.com](https://github.com/remarkjs/remark)

</details>

<details>
<summary><strong>micromark</strong> — full detail, pricing, and citations</summary>

Low-level, spec-compliant CommonMark tokenizer underneath remark/mdast. (npm · v4.0.2)

**vs. documents.js:** The closest philosophical sibling to markdown-codec (hand-written, dependency-minimal, spec-driven) but markdown-only, no shared schema.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 2.2k stars, 88 forks, 21 contributors, 0.0 commits/week avg (trailing 52wk), last release 4.0.2 (2025-02-27)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/micromark) · [github.com](https://github.com/micromark/micromark)

</details>

<details>
<summary><strong>markdown-it</strong> — full detail, pricing, and citations</summary>

Extensible, plugin-based Markdown-to-HTML renderer with a token stream. (npm · v15.0.1)

**vs. documents.js:** HTML-output oriented — no first-class serializer back to markdown, no bridge to office formats.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 21.9k stars, 1.8k forks, 97 contributors, 2.3 commits/week avg (trailing 52wk), last push 2026-08-27

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/markdown-it) · [github.com](https://github.com/markdown-it/markdown-it)

</details>

<details>
<summary><strong>marked</strong> — full detail, pricing, and citations</summary>

Fast, low-dependency Markdown-to-HTML compiler. (npm · v18.0.11)

**vs. documents.js:** One-directional (markdown to HTML), not CommonMark-strict by default, no serialization back to markdown.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 37.1k stars, 3.7k forks, 241 contributors, 4.1 commits/week avg (trailing 52wk), last release v18.0.11 (2026-08-24)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/marked) · [github.com](https://github.com/markedjs/marked)

</details>

<details>
<summary><strong>commonmark.js</strong> — full detail, pricing, and citations</summary>

Official reference implementation of the CommonMark spec, parses to a manipulable AST. (npm · v0.31.2 · 2024-09-19)

**vs. documents.js:** Base CommonMark only (no GFM tables/strikethrough without extensions), HTML/XML output only, no markdown serializer.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 1.6k stars, 228 forks, 52 contributors, 0.1 commits/week avg (trailing 52wk), last release 0.31.2 (2024-09-19)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/commonmark) · [github.com](https://github.com/commonmark/commonmark.js)

</details>

<details>
<summary><strong>prosemirror-markdown</strong> — full detail, pricing, and citations</summary>

Converts between ProseMirror's rich-text editor model and CommonMark markdown. (npm · v1.13.7)

**vs. documents.js:** Its target tree is an editor-oriented WYSIWYG schema, not a general document-interchange schema — no docx/odt/pdf concept.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 435 stars, 92 forks, 42 contributors, 0.1 commits/week avg (trailing 52wk), last push 2026-04-01, archived by owner

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/prosemirror-markdown) · [github.com](https://github.com/ProseMirror/prosemirror-markdown)

</details>

<details>
<summary><strong>MDX (@mdx-js/mdx)</strong> — full detail, pricing, and citations</summary>

Compiles Markdown-with-JSX through remark/mdast into executable JSX/JS components. (npm · v3.1.1)

**vs. documents.js:** Aimed at compiling to React components for web rendering, not lossless round-trip document conversion.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 19.8k stars, 1.2k forks, 196 contributors, 0.4 commits/week avg (trailing 52wk), last release 3.1.1 (2025-08-29)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/@mdx-js/mdx) · [github.com](https://github.com/mdx-js/mdx)

</details>

<details>
<summary><strong>Pandoc</strong> — full detail, pricing, and citations</summary>

Universal markup converter — readers parse markdown (and 50+ formats) into a shared AST, writers render any target. (cli-tool (Haskell) · v3.11 · 46k+ stars, continuous development)

**vs. documents.js:** The one alternative that genuinely does markdown-to-docx/odt through a shared AST — but GPL, a native binary, untyped, not embeddable.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 46.1k stars, 4.0k forks, 646 contributors, 16.6 commits/week avg (trailing 52wk), last release 3.11 (2026-08-29)

**Sources:** [pandoc.org](https://pandoc.org/) · [github.com](https://github.com/jgm/pandoc)

</details>

## PDF parsing & generation

**documents.js counterpart:** pdf-codec

The most crowded category, and the one where the commercial tier is most concentrated — Adobe, Nutrient and PDF.co all sell PDF creation, conversion, OCR and redaction as metered services. No package or service combines parse+generate with participation in a cross-format schema. unpdf is the closest to pdf-codec's Worker-isomorphism (explicitly targets Cloudflare Workers) but is extraction-only; mupdf brings Artifex-grade fidelity via WASM but is AGPL-3.0. PDF remains the one format every platform and commercial document-AI service accepts, with trained models aimed squarely at scanned/handwritten pages — exposing that documents.js has no OCR or ML-assisted layout recovery at all, in a field where OCR is a standard line item on every commercial price list.

| Package / service                                                        | Direction    | Approach     | Deployment | Licence                                          | Pricing model      | Status |
| ------------------------------------------------------------------------ | ------------ | ------------ | ---------- | ------------------------------------------------ | ------------------ | ------ |
| [pdf-lib](https://www.npmjs.com/package/pdf-lib)                         | Read + Write | Structural   | Library    | MIT                                              | Free / open source | Stale  |
| [pdfkit](https://www.npmjs.com/package/pdfkit)                           | Write only   | Structural   | Library    | MIT                                              | Free / open source | Active |
| [pdf-parse](https://www.npmjs.com/package/pdf-parse)                     | Read only    | Engine / SDK | Library    | MIT                                              | Free / open source | Active |
| [pdfjs-dist (PDF.js)](https://www.npmjs.com/package/pdfjs-dist)          | Read only    | Structural   | Library    | Apache-2.0                                       | Free / open source | Active |
| [mupdf (MuPDF.js)](https://www.npmjs.com/package/mupdf)                  | Read + Write | Engine / SDK | Library    | AGPL-3.0-or-later (commercial licence available) | Free / open source | Active |
| [unpdf](https://www.npmjs.com/package/unpdf)                             | Read only    | Engine / SDK | Library    | MIT                                              | Free / open source | Active |
| [jsPDF](https://github.com/parallax/jsPDF)                               | Write only   | Structural   | Library    | MIT                                              | Free / open source | Active |
| [muhammara](https://www.npmjs.com/package/muhammara)                     | Read + Write | Engine / SDK | Library    | Apache-2.0                                       | Free / open source | Active |
| [pdfmake](https://www.npmjs.com/package/pdfmake)                         | Write only   | Structural   | Library    | MIT                                              | Free / open source | Active |
| [@react-pdf/renderer](https://www.npmjs.com/package/@react-pdf/renderer) | Write only   | Structural   | Library    | MIT                                              | Free / open source | Active |

<details>
<summary><strong>pdf-lib</strong> — full detail, pricing, and citations</summary>

Create and modify PDFs — merge, split, fill forms, watermarks — in any JS environment. (npm · v1.17.1 · dormant since ~2021 (fork @cantoo/pdf-lib carries on))

**vs. documents.js:** Works against PDF's own low-level object graph as its public API; the direct MIT parse+generate comparator, but no shared cross-format schema.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 8.6k stars, 911 forks, 35 contributors, 0.0 commits/week avg (trailing 52wk), last release v1.17.1 (2021-11-06)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/pdf-lib) · [github.com](https://github.com/Hopding/pdf-lib)

</details>

<details>
<summary><strong>pdfkit</strong> — full detail, pricing, and citations</summary>

Generate PDFs from scratch with a chainable, imperative drawing API. (npm · v0.20.2 · 2024-10-16)

**vs. documents.js:** Generation-only, imperative/procedural rather than schema-driven — no parsing/round-trip at all.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 10.7k stars, 1.2k forks, 124 contributors, 2.1 commits/week avg (trailing 52wk), last release v0.20.2 (2026-08-30)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/pdfkit) · [github.com](https://github.com/foliojs/pdfkit)

</details>

<details>
<summary><strong>pdf-parse</strong> — full detail, pricing, and citations</summary>

Extracts text (and newer: images/tables/metadata) from PDFs. (npm · 1M+ weekly downloads)

**vs. documents.js:** One-directional text extraction — flattens to plain text, no generation or write-back at all.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/pdf-parse) · [github.com](https://github.com/UpLab/pdf-parse)

</details>

<details>
<summary><strong>pdfjs-dist (PDF.js)</strong> — full detail, pricing, and citations</summary>

General-purpose PDF rendering/parsing engine built on web standards. (npm · v6.3.289 · Mozilla, 3500+ dependents)

**vs. documents.js:** Primarily a rendering engine (content streams to pixels/DOM), not a bidirectional schema codec — no generation capability.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 53.8k stars, 10.7k forks, 525 contributors, 47.0 commits/week avg (trailing 52wk), last release v6.3.289 (2026-08-29)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/pdfjs-dist) · [github.com](https://github.com/mozilla/pdf.js)

</details>

<details>
<summary><strong>mupdf (MuPDF.js)</strong> — full detail, pricing, and citations</summary>

Official JS/WASM bindings to Artifex's MuPDF C engine, runs in Node/Bun/browsers identically. (npm · v1.28.0 · 2026-06-29)

**vs. documents.js:** Wraps a large native engine rather than a from-scratch codec; AGPL/paid-dual licensing is a real adoption blocker documents.js's MIT sidesteps.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 607 stars, 50 forks, 16 contributors, 0.1 commits/week avg (trailing 52wk), last release v0.3.0 (2024-08-27)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/mupdf) · [github.com](https://github.com/ArtifexSoftware/mupdf.js)

</details>

<details>
<summary><strong>unpdf</strong> — full detail, pricing, and citations</summary>

Serverless/edge-friendly PDF text/image/link extraction, wraps a serverless PDF.js build. (npm · v1.8.1 · UnJS ecosystem)

**vs. documents.js:** Closest to pdf-codec's Worker-isomorphism (explicitly targets Cloudflare Workers/edge) but extraction-only, no generation side.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 1.2k stars, 46 forks, 17 contributors, 1.1 commits/week avg (trailing 52wk), last release v1.8.1 (2026-08-13)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/unpdf) · [github.com](https://github.com/unjs/unpdf)

</details>

<details>
<summary><strong>jsPDF</strong> — full detail, pricing, and citations</summary>

Client-side-first PDF generation directly in the browser. (npm · long-running, widely used)

**vs. documents.js:** Generation-only, biased toward simple/imperative browser use; no parsing of existing PDFs, no shared schema.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 31.3k stars, 4.8k forks, 228 contributors, 0.8 commits/week avg (trailing 52wk), last release v4.2.1 (2026-03-17)

**Sources:** [github.com](https://github.com/parallax/jsPDF)

</details>

<details>
<summary><strong>muhammara</strong> — full detail, pricing, and citations</summary>

High-performance native-bound PDF creation/modification/parsing for Node/Electron. (npm · v6.0.6 · active fork of discontinued HummusJS)

**vs. documents.js:** Depends on native C++ bindings — not Worker-isomorphic, ties consumers to Node's native-addon toolchain.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 306 stars, 63 forks, 52 contributors, 1.8 commits/week avg (trailing 52wk), last release 6.0.6 (2026-08-23)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/muhammara) · [github.com](https://github.com/julianhille/MuhammaraJS)

</details>

<details>
<summary><strong>pdfmake</strong> — full detail, pricing, and citations</summary>

Declarative PDF generation from a JSON/JS document-definition object. (npm · long-running, widely used)

**vs. documents.js:** Its declarative document-definition is PDF-generation-specific — no parsing, no other target formats.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 12.3k stars, 2.1k forks, 107 contributors, 2.0 commits/week avg (trailing 52wk), last release 0.3.11 (2026-06-12)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/pdfmake) · [github.com](https://github.com/bpampuch/pdfmake)

</details>

<details>
<summary><strong>@react-pdf/renderer</strong> — full detail, pricing, and citations</summary>

React renderer turning component trees into PDF via a Yoga Flexbox layout engine. (npm · v4.9.0 · ~2.2M weekly downloads)

**vs. documents.js:** Its 'schema' is JSX/React trees, not a format-agnostic content schema; generation-only.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 16.8k stars, 1.3k forks, 168 contributors, 4.2 commits/week avg (trailing 52wk), last release @react-pdf/ui@1.0.0 (2026-08-27)

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/@react-pdf/renderer) · [github.com](https://github.com/diegomura/react-pdf)

</details>

## Cross-format document conversion engines/services

**documents.js counterpart:** documents.js (engine) plus document-schema.js + codecs

The shared-AST claim needs qualifying most sharply here: Pandoc has shipped readers-and-writers-through-one-AST since 2006, and Docling explicitly calls its export lossless — the idea itself is not novel. What's unmatched is the combination: symmetric bidirectionality, a runtime-validated typed schema, MIT licensing, and in-process execution with no external runtime or server. Gotenberg is the live counter-example to 'PDF is a peer, not a junction' — PDF-output-only by construction, MIT, widely used — showing the market tolerates the hub model when PDF is the only wanted output. The two self-hostable structural servers (OnlyOffice, Collabora) prove 'no external server' is doing real work: they match on 'free to run', but each is an always-on LibreOffice-class server under AGPLv3 or per-user licensing, not an embeddable dependency. This capability is now sold as a metered primitive by every major cloud vendor and by a durable tier of independent API vendors.

| Package / service                                                        | Direction    | Approach     | Deployment | Licence                                         | Pricing model       | Status |
| ------------------------------------------------------------------------ | ------------ | ------------ | ---------- | ----------------------------------------------- | ------------------- | ------ |
| [Pandoc](https://pandoc.org/)                                            | Read + Write | Structural   | CLI        | GPL-2.0-or-later                                | Free / open source  | Active |
| [Gotenberg](https://gotenberg.dev/)                                      | Write only   | Engine / SDK | Server     | MIT                                             | Free / open source  | Active |
| [unoserver / LibreOffice headless](https://github.com/unoconv/unoserver) | Read + Write | Engine / SDK | Server     | MIT (unoserver); unoconv GPL-2.0, archived 2025 | Free / open source  | Active |
| [Apache Tika](https://tika.apache.org/)                                  | Read only    | Structural   | Library    | Apache-2.0                                      | Free / open source  | Active |
| [CloudConvert API](https://cloudconvert.com/api/v2)                      | Read + Write | Engine / SDK | SaaS       | Proprietary                                     | Credit-based        | Active |
| [Aspose Cloud (Words/Cells/Slides)](https://docs.aspose.cloud/words/)    | Read + Write | Engine / SDK | SaaS       | Proprietary                                     | Per-page / per-unit | Active |
| [Zamzar API](https://developers.zamzar.com/)                             | Read + Write | Engine / SDK | SaaS       | Proprietary                                     | Subscription        | Active |
| [Microsoft MarkItDown](https://github.com/microsoft/markitdown)          | Read only    | Engine / SDK | CLI        | MIT                                             | Free / open source  | Active |
| [Docling](https://docling-project.github.io/docling/)                    | Read only    | ML / OCR     | CLI        | MIT                                             | Free / open source  | Active |
| [Unstructured](https://github.com/Unstructured-IO/unstructured)          | Read only    | ML / OCR     | CLI        | Apache-2.0                                      | Free / open source  | Active |

<details>
<summary><strong>Pandoc</strong> — full detail, pricing, and citations</summary>

Dozens of readers/writers pivoting through one shared internal document tree, with a Lua filter system. (cli-tool (Haskell) · v3.8.3 · 46k+ stars, ~19k commits)

**vs. documents.js:** Same core idea (one shared AST) but decades-old GPL Haskell, not Worker/browser-isomorphic, semantic/textual AST rather than layout+style-fused.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 46.1k stars, 4.0k forks, 646 contributors, 16.6 commits/week avg (trailing 52wk), last release 3.11 (2026-08-29)

**Sources:** [pandoc.org](https://pandoc.org/) · [github.com](https://github.com/jgm/pandoc)

</details>

<details>
<summary><strong>Gotenberg</strong> — full detail, pricing, and citations</summary>

Docker-based HTTP API converting HTML/Markdown/Office to PDF by orchestrating Chromium + LibreOffice. (self-hosted-server (Docker) · major version 8, widely used)

**vs. documents.js:** A thin API shell over two heavyweight external programs, PDF-output-only by construction — the exact hub model documents.js's 'PDF is a peer' stance rejects.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 13.0k stars, 850 forks, 83 contributors, 6.6 commits/week avg (trailing 52wk), last release v8.36.0 (2026-08-14)

**Sources:** [gotenberg.dev](https://gotenberg.dev/) · [github.com](https://github.com/gotenberg/gotenberg)

</details>

<details>
<summary><strong>unoserver / LibreOffice headless</strong> — full detail, pricing, and citations</summary>

Runs LibreOffice as a persistent server, exposing import/export via a lightweight protocol. (self-hosted-server · unoserver active, successor to unoconv)

**vs. documents.js:** Delegates all format understanding to LibreOffice's own closed-loop logic — no shared inspectable schema, fidelity is whatever LibreOffice's filters produce.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 931 stars, 107 forks, 19 contributors, 0.6 commits/week avg (trailing 52wk), last push 2026-06-10

**Sources:** [github.com](https://github.com/unoconv/unoserver)

</details>

<details>
<summary><strong>Apache Tika</strong> — full detail, pricing, and citations</summary>

Detects file types and extracts text/metadata from 1000+ formats via a pluggable Parser interface. (maven (Java) · v4.0.0, 3.x still supported)

**vs. documents.js:** One-directional extraction/normalisation — no writers to regenerate a docx/pptx/odt, JVM-based rather than Worker-isomorphic.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 4.0k stars, 960 forks, 194 contributors, 23.6 commits/week avg (trailing 52wk), last push 2026-09-01

**Sources:** [tika.apache.org](https://tika.apache.org/) · [github.com](https://github.com/apache/tika)

</details>

<details>
<summary><strong>CloudConvert API</strong> — full detail, pricing, and citations</summary>

Hosted file-conversion API orchestrating LibreOffice/Chromium/FFmpeg/ImageMagick behind one job-based API. (saas-api · 212 formats across 11 categories)

**vs. documents.js:** Black-box hosted service — no shared schema exposed, no self-hosting, metered per conversion.

**Free tier:** 10 conversion credits per day free, capped at 1GB files, 5-minute processing, 5 concurrent tasks with low priority.

**Pricing tiers:**

| Tier                   | Price                         | Unit                                                   |
| ---------------------- | ----------------------------- | ------------------------------------------------------ |
| Free                   | $0                            | 10 credits/day — 1GB max file size, 5 concurrent tasks |
| Package (one-time)     | from ~$17 per 1,000 credits   | one-time, never expires                                |
| Subscription (monthly) | from ~$9/mo per 1,000 credits | per month, resets monthly                              |
| Enterprise             | Custom                        | custom volumes                                         |

**Sources:** [cloudconvert.com](https://cloudconvert.com/api/v2) · [cloudconvert.com](https://cloudconvert.com/pricing)

</details>

<details>
<summary><strong>Aspose Cloud (Words/Cells/Slides)</strong> — full detail, pricing, and citations</summary>

Commercial SDKs/cloud APIs, one product per format family, each with a full read/write/convert model. (saas-api · long-running commercial product line)

**vs. documents.js:** Each product is its own closed-source object model — N formats still means N separate proprietary engines, not one AST.

**Free tier:** 150 API calls per month free across all Aspose Cloud products, no credit card required.

**Pricing tiers:**

| Tier                               | Price    | Unit                             |
| ---------------------------------- | -------- | -------------------------------- |
| Free allowance                     | $0       | 150 API calls/mo across products |
| First 1,000 API calls (after free) | $30 flat | per month                        |
| Next 14,000 API calls              | $0.090   | per call                         |
| Next 15,000 API calls              | $0.070   | per call                         |
| Next 60,000 API calls              | $0.050   | per call                         |
| Beyond that                        | $0.007   | per call                         |

**Sources:** [docs.aspose.cloud](https://docs.aspose.cloud/words/) · [docs.aspose.cloud](https://docs.aspose.cloud/words/getting-started/pricing-plan/)

</details>

<details>
<summary><strong>Zamzar API</strong> — full detail, pricing, and citations</summary>

Hosted conversion API covering documents/video/images/audio/CAD/ebooks. (saas-api · 1,100+ conversion pairs, since 2015)

**vs. documents.js:** Metered, closed-source hosted API with no exposed intermediate schema and no self-hosting option.

**Free tier:** Free test account with 100 conversion credits, no card required, limited to 1MB files stored for 1 day.

**Pricing tiers:**

| Tier        | Price   | Unit                             |
| ----------- | ------- | -------------------------------- |
| Test (free) | $0      | 100 credits, 1MB file limit      |
| Startup     | $25/mo  | 500 credits/mo ($0.05/credit)    |
| Growth      | $99/mo  | 2,500 credits/mo ($0.04/credit)  |
| Scale       | $299/mo | 10,000 credits/mo ($0.03/credit) |
| Enterprise  | Custom  | custom, NDA, volume discounts    |

**Sources:** [developers.zamzar.com](https://developers.zamzar.com/) · [developers.zamzar.com](https://developers.zamzar.com/pricing)

</details>

<details>
<summary><strong>Microsoft MarkItDown</strong> — full detail, pricing, and citations</summary>

Converts PDF/DOCX/PPTX/XLSX/HTML/EPUB/images/audio to Markdown for LLM/RAG ingestion. (pypi (Python) · 178k+ stars, actively maintained)

**vs. documents.js:** One-way, one-target (anything to Markdown only) — optimises for LLM-readability, not reconstructing the original document; Python.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 177.7k stars, 13.1k forks, 106 contributors, 0.9 commits/week avg (trailing 52wk), last release v0.1.7 (2026-07-29)

**Sources:** [github.com](https://github.com/microsoft/markitdown)

</details>

<details>
<summary><strong>Docling</strong> — full detail, pricing, and citations</summary>

Parses complex documents into one unified DoclingDocument with ML-based layout/table understanding. (pypi (Python) · v2.124.0 · 8,000+ stars, LF AI & Data)

**vs. documents.js:** Closest in spirit to 'one shared representation, many readers' — but read-only (no writers back) and ML-model-based rather than hand-written.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 65.9k stars, 4.7k forks, 295 contributors, 14.2 commits/week avg (trailing 52wk), last release v2.124.0 (2026-08-31)

**Sources:** [docling-project.github.io](https://docling-project.github.io/docling/) · [github.com](https://github.com/docling-project/docling)

</details>

<details>
<summary><strong>Unstructured</strong> — full detail, pricing, and citations</summary>

ETL library partitioning documents into typed 'document elements' for chunking/embedding. (pypi (Python) · v0.27.5 · active, plus a commercial Platform)

**vs. documents.js:** One-directional extraction/ETL for LLM consumption — discards layout/style fidelity by design, no write-back.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 15.4k stars, 1.3k forks, 148 contributors, 2.9 commits/week avg (trailing 52wk), last release 0.27.5 (2026-08-28)

**Sources:** [github.com](https://github.com/Unstructured-IO/unstructured)

</details>

## CLI / TUI tools for document conversion

**documents.js counterpart:** document-cli

document-cli's trifecta — the full docx/pptx/xlsx/odt/ods/odp/odg/odm/odb/pdf/markdown matrix, a bundled interactive Ink TUI editor, and a shared lossless schema — is unmatched as a whole but contested leg by leg. Pandoc wins comprehensively on breadth but has no interactive mode and is GPL. The Rust cluster (office2pdf, rdocx-cli) is the closest philosophical match — hand-written, dependency-minimal, single self-contained binaries — but docx-family-only and one-directional. The TUI leg is essentially uncontested for documents specifically (glow/mdcat/md-tui are markdown-only viewers, not converters/editors). None of the commercial vendors or hosted RAG platforms compete here at all — their surface is an HTTP API or a hosted UI, so the local-CLI form factor is uncontested by that whole tier. Practical risk: Rust/Go competitors install as single binaries while document-cli requires Node.

| Package / service                                                                                           | Direction    | Approach     | Deployment | Licence                                         | Pricing model      | Status    |
| ----------------------------------------------------------------------------------------------------------- | ------------ | ------------ | ---------- | ----------------------------------------------- | ------------------ | --------- |
| [Pandoc](https://pandoc.org/)                                                                               | Read + Write | Structural   | CLI        | GPL-2.0-or-later                                | Free / open source | Active    |
| [MarkItDown](https://pypi.org/project/markitdown/)                                                          | Read only    | Engine / SDK | CLI        | MIT                                             | Free / open source | Active    |
| [Docling](https://pypi.org/project/docling/)                                                                | Read only    | ML / OCR     | CLI        | MIT                                             | Free / open source | Active    |
| [unoserver / unoconv](https://github.com/unoconv/unoserver)                                                 | Read + Write | Engine / SDK | CLI        | MIT (unoserver); unoconv GPL-2.0, archived 2025 | Free / open source | Active    |
| [LibreOffice --headless](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html) | Read + Write | Engine / SDK | CLI        | MPL-2.0 (with LGPL-3.0 components)              | Free / open source | Active    |
| [office2pdf](https://crates.io/crates/office2pdf)                                                           | Write only   | Structural   | CLI        | Apache-2.0                                      | Free / open source | Active    |
| [rdocx-cli](https://lib.rs/crates/rdocx-cli)                                                                | Read + Write | Structural   | CLI        | MIT OR Apache-2.0                               | Free / open source | Active    |
| [anydoc](https://crates.io/crates/anydoc)                                                                   | Read only    | Structural   | CLI        | MIT                                             | Free / open source | Active    |
| [glow](https://github.com/charmbracelet/glow)                                                               | —            | Structural   | CLI        | MIT                                             | Free / open source | Active    |
| [mdcat](https://github.com/swsnr/mdcat)                                                                     | —            | Structural   | CLI        | MIT/Apache-2.0                                  | Free / open source | Abandoned |
| [md-tui](https://crates.io/crates/md-tui)                                                                   | —            | Structural   | CLI        | AGPL-3.0-or-later                               | Free / open source | Active    |

<details>
<summary><strong>Pandoc</strong> — full detail, pricing, and citations</summary>

The best-known universal document converter CLI, 40+ formats via its own AST. (cli-tool (Haskell) · v3.11 · 2026-08-28)

**vs. documents.js:** Its own AST is the interchange layer but untyped/unvalidated; PDF output routes through an external LaTeX-class engine; no interactive mode; GPL.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 46.1k stars, 4.0k forks, 646 contributors, 16.6 commits/week avg (trailing 52wk), last release 3.11 (2026-08-29)

**Sources:** [pandoc.org](https://pandoc.org/) · [github.com](https://github.com/jgm/pandoc)

</details>

<details>
<summary><strong>MarkItDown</strong> — full detail, pricing, and citations</summary>

Python CLI converting PDF/DOCX/PPTX/XLSX/images/audio/HTML to Markdown. (pypi (Python) · 178k+ stars)

**vs. documents.js:** One-directional flatten-to-markdown for LLM consumption, not lossless bidirectional conversion; no interactive editor.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 177.7k stars, 13.1k forks, 106 contributors, 0.9 commits/week avg (trailing 52wk), last release v0.1.7 (2026-07-29)

**Sources:** [pypi.org](https://pypi.org/project/markitdown/) · [github.com](https://github.com/microsoft/markitdown)

</details>

<details>
<summary><strong>Docling</strong> — full detail, pricing, and citations</summary>

Python SDK/CLI parsing documents into a unified DoclingDocument, exports to Markdown/HTML/JSON. (pypi (Python) · v2.124.0)

**vs. documents.js:** ML/layout-model-based, targets extraction/RAG over faithful lossless generation; no document-writing story.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 65.9k stars, 4.7k forks, 295 contributors, 14.2 commits/week avg (trailing 52wk), last release v2.124.0 (2026-08-31)

**Sources:** [pypi.org](https://pypi.org/project/docling/) · [github.com](https://github.com/docling-project/docling)

</details>

<details>
<summary><strong>unoserver / unoconv</strong> — full detail, pricing, and citations</summary>

CLI/server pair driving headless LibreOffice for conversion. (pypi (Python) · unoserver active successor)

**vs. documents.js:** Zero own codec logic — total dependency on a running LibreOffice binary, opposite of documents.js's dependency-minimal design.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 931 stars, 107 forks, 19 contributors, 0.6 commits/week avg (trailing 52wk), last push 2026-06-10

**Sources:** [github.com](https://github.com/unoconv/unoserver)

</details>

<details>
<summary><strong>LibreOffice --headless</strong> — full detail, pricing, and citations</summary>

LibreOffice's own headless CLI mode for batch conversion. (native application (C++) · part of actively-developed LibreOffice)

**vs. documents.js:** A full desktop-application binary rather than a lightweight package; no shared schema, no Worker/browser portability.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 4.3k stars, 930 forks, 2915 contributors, 162.0 commits/week avg (trailing 52wk), last push 2026-09-02

**Sources:** [help.libreoffice.org](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html) · [github.com](https://github.com/LibreOffice/core)

</details>

<details>
<summary><strong>office2pdf</strong> — full detail, pricing, and citations</summary>

Pure-Rust CLI converting DOCX/XLSX/PPTX to PDF via the Typst engine, no LibreOffice/Chromium dependency. (crates.io (Rust) · v0.6.7 · 2026-08-13, actively updated)

**vs. documents.js:** Philosophically closest match in this category — hand-written, dependency-minimal, single binary — but one-directional OOXML-to-PDF only, no shared schema.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Sources:** [crates.io](https://crates.io/crates/office2pdf)

</details>

<details>
<summary><strong>rdocx-cli</strong> — full detail, pricing, and citations</summary>

Rust CLI for DOCX inspect/extract/convert (PDF/HTML/Markdown)/diff, own layout engine. (crates.io (Rust) · v0.11.1 · 2026-08-29, actively updated)

**vs. documents.js:** Hand-written native codec with a built-in layout engine, no LibreOffice dependency, but DOCX-only, no bundled TUI editor.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Sources:** [lib.rs](https://lib.rs/crates/rdocx-cli) · [crates.io](https://crates.io/crates/rdocx)

</details>

<details>
<summary><strong>anydoc</strong> — full detail, pricing, and citations</summary>

Rust library/CLI converting Word/PPT/Excel/ODF/RTF/EPUB/CSV/PDF into GFM Markdown. (crates.io (Rust) · v0.2.4 · 2026-08-27)

**vs. documents.js:** One-way to Markdown only, no round-trip fidelity claim, no shared typed schema.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Sources:** [crates.io](https://crates.io/crates/anydoc)

</details>

<details>
<summary><strong>glow</strong> — full detail, pricing, and citations</summary>

Terminal Markdown reader/pager with styled rendering and a file-browser TUI. (Go (standalone binary) · 874+ commits, active)

**vs. documents.js:** Not a converter — a viewer/pager. No OOXML/ODF/PDF support, no conversion, no editing.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 27.2k stars, 759 forks, 53 contributors, 0.5 commits/week avg (trailing 52wk), last release v3.0.0 (2026-08-11)

**Sources:** [github.com](https://github.com/charmbracelet/glow)

</details>

<details>
<summary><strong>mdcat</strong> — full detail, pricing, and citations</summary>

'cat for markdown' — renders CommonMark to the terminal with inline images. (crates.io (Rust) · active, maintained fork mdcat-ng)

**vs. documents.js:** Pure rendering, not a converter; same category gap as glow.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 2.4k stars, 104 forks, 30 contributors, 0.0 commits/week avg (trailing 52wk), last release mdcat-2.7.1 (2024-12-14), archived by owner

**Sources:** [github.com](https://github.com/swsnr/mdcat)

</details>

<details>
<summary><strong>md-tui</strong> — full detail, pricing, and citations</summary>

Terminal Markdown viewer/navigator ('mdt') with keyboard-driven navigation. (crates.io (Rust) · v0.10.4 · 2026-08-31, actively updated)

**vs. documents.js:** Viewer/navigator, not a converter or editor; AGPL is notably more restrictive than documents.js's MIT.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 543 stars, 32 forks, 24 contributors, 1.5 commits/week avg (trailing 52wk), last release v0.10.4 (2026-08-31)

**Sources:** [crates.io](https://crates.io/crates/md-tui) · [github.com](https://github.com/henriklovhaug/md-tui)

</details>

## MCP servers for document/office file manipulation

**documents.js counterpart:** document-mcp

The clearest structural differentiation in the whole survey and the weakest competition — every MCP server found wraps something else: mcp-pandoc shells to Pandoc, mcp-libre drives LibreOffice, OfficeMCP wraps DocumentFormat.OpenXml+itext7 with no licence at all, @docx-mcp/docx-mcp wraps the docx npm library, Aspose.Words-MCP is non-functional without a paid SDK, CloudConvert MCP is a pure SaaS call-through. Maturity is uniformly low — several are archived or self-labelled work-in-progress. The threat has partially materialised from the commercial side too: Unstructured Platform already ships an official MCP interface over its hosted pipeline (see the Commercial & RAG SaaS category). document-mcp is plausibly the only MCP document server built on one shared typed AST with hand-written codecs and no external application or proprietary dependency at runtime — a genuine first-mover position, though the moat is thin since MCP servers are cheap to write.

| Package / service                                                                     | Direction    | Approach     | Deployment | Licence                                  | Pricing model      | Status    |
| ------------------------------------------------------------------------------------- | ------------ | ------------ | ---------- | ---------------------------------------- | ------------------ | --------- |
| [mcp-pandoc](https://pypi.org/project/mcp-pandoc/)                                    | Read + Write | Engine / SDK | CLI        | MIT                                      | Free / open source | Active    |
| [Office-Word-MCP-Server](https://github.com/GongRzhe/Office-Word-MCP-Server)          | Read + Write | Engine / SDK | CLI        | MIT                                      | Free / open source | Abandoned |
| [docx-mcp](https://github.com/hongkongkiwi/docx-mcp)                                  | Read + Write | Structural   | CLI        | MIT                                      | Free / open source | Stale     |
| [@docx-mcp/docx-mcp](https://www.npmjs.com/package/@docx-mcp/docx-mcp)                | Write only   | Engine / SDK | CLI        | MIT                                      | Free / open source | Active    |
| [OfficeMCP](https://github.com/mhackermsft/OfficeMCP)                                 | Read + Write | Engine / SDK | CLI        | No formal license specified              | Free / open source | Active    |
| [mcp-libre](https://github.com/patrup/mcp-libre)                                      | Read + Write | Engine / SDK | CLI        | MIT                                      | Free / open source | Stale     |
| [Aspose.Words-MCP](https://docs.aspose.com/words/python-net/aspose-words-mcp-server/) | Read + Write | Engine / SDK | CLI        | MIT wrapper; needs paid Aspose.Words SDK | Freemium           | Active    |
| [CloudConvert MCP](https://zapier.com/mcp/cloudconvert)                               | Read + Write | Engine / SDK | SaaS       | Proprietary SaaS                         | Credit-based       | Active    |
| [mcp-pdf-tools](https://github.com/hanweg/mcp-pdf-tools)                              | Read + Write | Engine / SDK | CLI        | Unlicense                                | Free / open source | Stale     |

<details>
<summary><strong>mcp-pandoc</strong> — full detail, pricing, and citations</summary>

MCP server exposing Pandoc as tools for Markdown/HTML/PDF/DOCX/LaTeX/RST/EPUB/ODT/IPYNB/TXT conversion. (pypi (Python) · ~579 stars, listed in modelcontextprotocol/servers)

**vs. documents.js:** Delegates every format's parsing/writing to Pandoc's own AST; requires a native binary, so no Worker/browser.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 579 stars, 60 forks, 11 contributors, 0.4 commits/week avg (trailing 52wk), last release v0.11.1 (2026-08-15)

**Sources:** [pypi.org](https://pypi.org/project/mcp-pandoc/) · [github.com](https://github.com/vivekVells/mcp-pandoc)

</details>

<details>
<summary><strong>Office-Word-MCP-Server</strong> — full detail, pricing, and citations</summary>

MCP server for creating/reading/manipulating .docx documents. (pypi (Python) · Archived by its owner in 2026)

**vs. documents.js:** Single-format, abandoned; wraps python-docx rather than a hand-written codec, no cross-format schema.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 2.1k stars, 284 forks, 17 contributors, 0.2 commits/week avg (trailing 52wk), last release v1.1.11 (2025-12-31), archived by owner

**Sources:** [github.com](https://github.com/GongRzhe/Office-Word-MCP-Server)

</details>

<details>
<summary><strong>docx-mcp</strong> — full detail, pricing, and citations</summary>

MCP server for .docx manipulation as a standalone Rust binary. (cli-tool (Rust) · 19 commits, in development)

**vs. documents.js:** Closest in spirit (hand-written, dependency-light) but single-format and Rust, so can't share a schema with sibling format tools.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 32 stars, 11 forks, 1 contributors, 0.0 commits/week avg (trailing 52wk), last push 2025-08-12

**Sources:** [github.com](https://github.com/hongkongkiwi/docx-mcp)

</details>

<details>
<summary><strong>@docx-mcp/docx-mcp</strong> — full detail, pricing, and citations</summary>

Node MCP server letting clients create/query/edit/save DOCX via a JSON schema, built on the docx npm library. (npm · v0.5.0 · Aug 2025)

**vs. documents.js:** npm/TypeScript like documents.js, but single-format, write/edit-only, wraps a third-party library rather than a hand-written codec.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Sources:** [www.npmjs.com](https://www.npmjs.com/package/@docx-mcp/docx-mcp)

</details>

<details>
<summary><strong>OfficeMCP</strong> — full detail, pricing, and citations</summary>

MCP server for Word/Excel/PowerPoint/PDF/Markdown via unified office_* tools. (cli-tool / .NET (C#) · ~12 commits, no release tags, early-stage)

**vs. documents.js:** Broadest single-project format coverage among alternatives, but no licence at all, wraps two libraries with no unifying model.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 4 stars, 2 forks, 2 contributors, 0.2 commits/week avg (trailing 52wk), last push 2026-03-04

**Sources:** [github.com](https://github.com/mhackermsft/OfficeMCP)

</details>

<details>
<summary><strong>mcp-libre</strong> — full detail, pricing, and citations</summary>

LibreOffice MCP server for Writer/Calc/Impress/Draw across 50+ formats via soffice CLI or UNO extension. (cli-tool (Python/Node) · 31 commits, actively developed)

**vs. documents.js:** Broadest raw format coverage of the survey, but requires a full LibreOffice install; not lossless/type-safe by design, can't run in a Worker/browser.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 101 stars, 31 forks, 2 contributors, 0.0 commits/week avg (trailing 52wk), last push 2025-06-28

**Sources:** [github.com](https://github.com/patrup/mcp-libre)

</details>

<details>
<summary><strong>Aspose.Words-MCP</strong> — full detail, pricing, and citations</summary>

MCP server automating Word creation/editing built on Aspose.Words. (pypi (Python) · 32 commits, tracks upstream SDK)

**vs. documents.js:** Single-format, non-functional without a paid commercial SDK — the opposite of documents.js's free, no-proprietary-dependency model.

**Free tier:** The MCP server wrapper itself is MIT-licensed and free, and runs in a limited Evaluation mode without a paid Aspose.Words for Python via .NET licence.

**Pricing tiers:**

| Tier                                 | Price          | Unit                                  |
| ------------------------------------ | -------------- | ------------------------------------- |
| Developer Small Business (perpetual) | $1,199         | one-time + 1yr updates                |
| Site SDK (perpetual)                 | $59,950        | one-time + 1yr updates, up to 10 devs |
| Metered (pay-per-use)                | from $1,999/mo | per month, unlimited developers       |

**Repository health (as of 2 September 2026):** 4 stars, 1 forks, 2 contributors, 0.6 commits/week avg (trailing 52wk), last push 2026-08-07

**Sources:** [docs.aspose.com](https://docs.aspose.com/words/python-net/aspose-words-mcp-server/) · [github.com](https://github.com/aspose-words/Aspose.Words-MCP) · [purchase.aspose.com](https://purchase.aspose.com/pricing/words/python-net/)

</details>

<details>
<summary><strong>CloudConvert MCP</strong> — full detail, pricing, and citations</summary>

MCP integration connecting agents to the CloudConvert cloud API. (saas-api · offered via Composio/Zapier/Activepieces)

**vs. documents.js:** Zero local/offline capability, requires sending documents to a third-party cloud service — the polar opposite of documents.js's local, privacy-preserving design.

**Free tier:** No distinct MCP pricing exists: the MCP server authenticates with the user's own CloudConvert API key and consumes that account's regular credits.

**Pricing tiers:**

| Tier                   | Price                   | Unit                                                                                   |
| ---------------------- | ----------------------- | -------------------------------------------------------------------------------------- |
| Free                   | $0                      | 10 credits/day — Sandbox API also allows unlimited free test jobs on whitelisted files |
| Package / Subscription | $9-17 per 1,000 credits | one-time or monthly                                                                    |
| Enterprise             | Custom                  | custom                                                                                 |

**Sources:** [zapier.com](https://zapier.com/mcp/cloudconvert) · [cloudconvert.com](https://cloudconvert.com/pricing)

</details>

<details>
<summary><strong>mcp-pdf-tools</strong> — full detail, pricing, and citations</summary>

MCP server for merging PDFs, extracting pages, text-search across PDFs. (cli-tool (Python) · Marked 'WORK IN PROGRESS'; 17 commits)

**vs. documents.js:** Narrow page-level PDF ops only, no generation or cross-format conversion.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 76 stars, 9 forks, 2 contributors, 0.0 commits/week avg (trailing 52wk), last push 2024-12-22

**Sources:** [github.com](https://github.com/hanweg/mcp-pdf-tools)

</details>

## Equivalent packages in other language ecosystems

**documents.js counterpart:** the documents.js family as a whole

Looking outside JS/TS confirms rather than undermines the shared-schema thesis — every mature per-format library in Java and Python uses an independent object model with no cross-format layer: Apache POI's three unrelated APIs (XSSF/XWPF/XSLF), docx4j's XSD-derived JAXB bindings, ODF Toolkit's thin DOM, python-docx/openpyxl/python-pptx as three separate unconnected projects. pypdf is the philosophical twin of pdf-codec; PyMuPDF is the counter-model (wraps native MuPDF, AGPL-3.0). Aspose.Total has the broadest commercial coverage but is closed, paid, and siloed per format — even the market leader doesn't solve the N-squared problem. documents.js's exact combination appears unreplicated in any ecosystem, but its components are individually well-precedented and the incumbents carry decades of edge-case hardening it does not.

| Package / service                                                             | Direction    | Approach     | Deployment | Licence                                     | Pricing model      | Status |
| ----------------------------------------------------------------------------- | ------------ | ------------ | ---------- | ------------------------------------------- | ------------------ | ------ |
| [Apache POI](https://poi.apache.org/)                                         | Read + Write | Structural   | Library    | Apache-2.0                                  | Free / open source | Active |
| [docx4j](https://www.docx4java.org/trac/docx4j)                               | Read + Write | Structural   | Library    | Apache-2.0                                  | Free / open source | Active |
| [ODF Toolkit (ODFDOM)](https://odftoolkit.org/)                               | Read + Write | Structural   | Library    | Apache-2.0                                  | Free / open source | Active |
| [python-docx / openpyxl / python-pptx](https://pypi.org/project/python-docx/) | Read + Write | Structural   | Library    | MIT                                         | Free / open source | Active |
| [odfpy](https://pypi.org/project/odfpy/)                                      | Read + Write | Structural   | Library    | Apache-2.0 / GPL / LGPL (dual/tri-licensed) | Free / open source | Active |
| [pypdf](https://pypi.org/project/pypdf/)                                      | Read + Write | Structural   | Library    | BSD-3-Clause                                | Free / open source | Active |
| [PyMuPDF (fitz)](https://pypi.org/project/pymupdf/)                           | Read + Write | Engine / SDK | Library    | AGPL-3.0 (commercial licence available)     | Free / open source | Active |
| [Pandoc](https://pandoc.org/)                                                 | Read + Write | Structural   | CLI        | GPL-2.0-or-later                            | Free / open source | Active |
| [Docling](https://docling-project.github.io/docling/)                         | Read only    | ML / OCR     | CLI        | MIT                                         | Free / open source | Active |
| [Unstructured](https://github.com/Unstructured-IO/unstructured)               | Read only    | ML / OCR     | CLI        | Apache-2.0                                  | Free / open source | Active |
| [MarkItDown](https://github.com/microsoft/markitdown)                         | Read only    | Engine / SDK | CLI        | MIT                                         | Free / open source | Active |
| [Aspose.Total](https://www.aspose.com/)                                       | Read + Write | Engine / SDK | Library    | Proprietary                                 | Sales quote        | Active |

<details>
<summary><strong>Apache POI</strong> — full detail, pricing, and citations</summary>

The dominant Java library for reading/writing MS Office formats via three separate object models. (maven (Java) · v5.5.1 · 2025-11-30)

**vs. documents.js:** XSSF/XWPF/XSLF are unrelated APIs — no shared AST, no N-codecs-not-N² benefit; converting spreadsheet content to a document means hand-mapping APIs.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 2.3k stars, 843 forks, 75 contributors, 10.1 commits/week avg (trailing 52wk), last push 2026-09-01

**Sources:** [poi.apache.org](https://poi.apache.org/) · [github.com](https://github.com/apache/poi)

</details>

<details>
<summary><strong>docx4j</strong> — full detail, pricing, and citations</summary>

JAXB-generated object model bound to OOXML XML schemas for docx/pptx/xlsx. (maven (Java) · v17.0.4 · targets Java 11–25)

**vs. documents.js:** The model is OOXML's own XML schema reflected into Java, not an independent semantic schema — can't express 'convert docx to odt' without a bespoke bridge.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 2.4k stars, 1.2k forks, 61 contributors, 8.5 commits/week avg (trailing 52wk), last push 2026-09-02

**Sources:** [www.docx4java.org](https://www.docx4java.org/trac/docx4j) · [github.com](https://github.com/plutext/docx4j)

</details>

<details>
<summary><strong>ODF Toolkit (ODFDOM)</strong> — full detail, pricing, and citations</summary>

Java toolkit for odt/ods/odp manipulation, validation, and XSLT application. (maven (Java) · v0.13.0 · 2026-01-23, under The Document Foundation)

**vs. documents.js:** A thin DOM over the ODF package structure, no independent semantic tree — no companion sharing a schema with an OOXML/PDF sibling.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 152 stars, 58 forks, 42 contributors, 0.5 commits/week avg (trailing 52wk), last release v0.13.0 (2026-01-23)

**Sources:** [odftoolkit.org](https://odftoolkit.org/) · [github.com](https://github.com/tdf/odftoolkit)

</details>

<details>
<summary><strong>python-docx / openpyxl / python-pptx</strong> — full detail, pricing, and citations</summary>

The three standard Python libraries for docx/xlsx/pptx respectively. (pypi (Python) · python-docx 1.2.0, openpyxl 3.1.5, python-pptx 1.0.2)

**vs. documents.js:** Closest Python analogue to ooxml.js in philosophy, but three entirely separate projects/models with no shared schema or maintainer.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 5.7k stars, 1.3k forks, 16 contributors, 0.0 commits/week avg (trailing 52wk), last push 2026-08-01

**Sources:** [pypi.org](https://pypi.org/project/python-docx/) · [github.com](https://github.com/python-openxml/python-docx)

</details>

<details>
<summary><strong>odfpy</strong> — full detail, pricing, and citations</summary>

Python library for odt/ods/odp, generated from and validated against the ODF RelaxNG schema. (pypi (Python) · v1.4.1 · 2020-01-18, unmaintained upstream)

**vs. documents.js:** Python's odf.js counterpart, stale since 2020; a community fork carries on maintenance.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 363 stars, 73 forks, 33 contributors, 0.1 commits/week avg (trailing 52wk), last push 2026-04-07

**Sources:** [pypi.org](https://pypi.org/project/odfpy/) · [github.com](https://github.com/eea/odfpy)

</details>

<details>
<summary><strong>pypdf</strong> — full detail, pricing, and citations</summary>

Pure-Python, dependency-light PDF codec — read/write/merge/split/crop/extract. (pypi (Python) · v6.16.2 · 2026-08-23)

**vs. documents.js:** Closest philosophical match to pdf-codec (hand-written, no native binding) but PDF-only, no cross-format schema.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 10.2k stars, 1.6k forks, 324 contributors, 8.3 commits/week avg (trailing 52wk), last release 6.16.2 (2026-08-23)

**Sources:** [pypi.org](https://pypi.org/project/pypdf/) · [github.com](https://github.com/py-pdf/pypdf)

</details>

<details>
<summary><strong>PyMuPDF (fitz)</strong> — full detail, pricing, and citations</summary>

High-performance PDF/XPS/EPUB library built as bindings to the native MuPDF engine. (pypi (Python) · actively maintained, dual open/commercial)

**vs. documents.js:** The 'wrap a native library' approach documents.js avoids — large native C dependency, AGPL license is a real adoption constraint.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 10.6k stars, 790 forks, 96 contributors, 8.1 commits/week avg (trailing 52wk), last release 1.28.2 (2026-08-06)

**Sources:** [pypi.org](https://pypi.org/project/pymupdf/) · [github.com](https://github.com/pymupdf/PyMuPDF)

</details>

<details>
<summary><strong>Pandoc</strong> — full detail, pricing, and citations</summary>

Readers parse ~50 formats into one AST, writers render any target — M readers × N writers, not M×N. (cli-tool / hackage (Haskell) · actively maintained since 2006)

**vs. documents.js:** The architecture documents.js's claim most directly parallels — but markup-oriented, weaker OOXML/ODF fidelity, GPL, not embeddable.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 46.1k stars, 4.0k forks, 646 contributors, 16.6 commits/week avg (trailing 52wk), last release 3.11 (2026-08-29)

**Sources:** [pandoc.org](https://pandoc.org/) · [github.com](https://github.com/jgm/pandoc)

</details>

<details>
<summary><strong>Docling</strong> — full detail, pricing, and citations</summary>

Unifies many formats into one DoclingDocument, exports to Markdown/HTML/JSON/DocTags. (pypi (Python) · v2.124.0 · IBM Research / LF AI & Data)

**vs. documents.js:** The most direct single-shared-schema analogue — but built for extraction/AI consumption, not symmetric bidirectional authoring; ML-based.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 65.9k stars, 4.7k forks, 295 contributors, 14.2 commits/week avg (trailing 52wk), last release v2.124.0 (2026-08-31)

**Sources:** [docling-project.github.io](https://docling-project.github.io/docling/) · [github.com](https://github.com/docling-project/docling)

</details>

<details>
<summary><strong>Unstructured</strong> — full detail, pricing, and citations</summary>

Partitions documents into a common typed Element schema for LLM ingestion. (pypi (Python) · v0.27.5 · Unstructured-IO)

**vs. documents.js:** Shares 'one schema, many readers' but only read-direction and coarser fidelity — no write-back path.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 15.4k stars, 1.3k forks, 148 contributors, 2.9 commits/week avg (trailing 52wk), last release 0.27.5 (2026-08-28)

**Sources:** [github.com](https://github.com/Unstructured-IO/unstructured)

</details>

<details>
<summary><strong>MarkItDown</strong> — full detail, pricing, and citations</summary>

Converts documents/images/audio into Markdown for LLM/RAG ingestion. (pypi (Python) · v0.1.7 · Microsoft)

**vs. documents.js:** Composes existing per-format libraries behind one Markdown output — no round-trip, no write path back.

**Free tier:** N/A — the package itself is free and open source; no paid tiers exist.

**Repository health (as of 2 September 2026):** 177.7k stars, 13.1k forks, 106 contributors, 0.9 commits/week avg (trailing 52wk), last release v0.1.7 (2026-07-29)

**Sources:** [github.com](https://github.com/microsoft/markitdown)

</details>

<details>
<summary><strong>Aspose.Total</strong> — full detail, pricing, and citations</summary>

Dominant commercial multi-format SDK suite — separate proprietary products per format family. (commercial SDK (.NET/Java/C++/Python) · actively maintained, frequent releases)

**vs. documents.js:** Broad coverage and mature fidelity, but proprietary, closed-source, and siloed per format — even the market leader doesn't solve the N² problem.

**Free tier:** Full-featured evaluation SDKs are downloadable free with no credit card required, but are time/feature-limited for evaluation only.

**Pricing tiers:**

| Tier                                 | Price          | Unit                                  |
| ------------------------------------ | -------------- | ------------------------------------- |
| Developer Small Business (perpetual) | $5,999         | one-time + 1yr updates                |
| Site SDK (perpetual)                 | $299,950       | one-time + 1yr updates, up to 10 devs |
| Metered (pay-per-use)                | from $1,999/mo | per month, unlimited developers       |

**Sources:** [www.aspose.com](https://www.aspose.com/) · [purchase.aspose.com](https://purchase.aspose.com/pricing/total/family/)

</details>

## Platform-native document-AI conversion services

**documents.js counterpart:** The ecosystem's whole positioning — MIT, hand-written, dependency-minimal, one shared schema, bidirectional, no account or per-page billing

This is the category that most directly attacks documents.js's positioning while sharing almost none of its architecture. Cloudflare's env.AI.toMarkdown() is a GA first-party binding running natively inside the exact runtime documents.js's Worker-isomorphism targets — a Worker author who wants a document turned into Markdown now has a zero-install, mostly-free path documents.js has to beat on merits rather than availability. Its hybrid architecture (structural for HTML/XML/spreadsheets, ML models for images, PDF-UA StructTree with raw-text fallback for PDF) makes it a closer technical neighbour than the other four, and also exposes its ceiling: an untagged PDF degrades to sequential text, exactly the fidelity cliff a structural codec exists to avoid. The other four are hyperscaler extraction platforms: proprietary, ML/OCR- or foundation-model-based, billed per page, strictly one-way, none capable of regenerating a document file. Textract is narrowest (JPEG/PNG/PDF/TIFF only, no office formats, $0.0015–$0.07/page); Bedrock Data Automation is a genuinely different foundation-model pipeline attaching Markdown/HTML/CSV to every extracted entity, but converts DOCX to PDF first, breaking page mapping; Document AI has the widest native ingestion (PDF, images, HTML/DOCX/PPTX/XLSX via its Layout parser) at $0.65–$30 per 1,000 pages; Azure is closest to Cloudflare on output shape (Markdown via outputContentFormat) and uniquely offers a disconnected on-premises container, but behind a commitment plan as an opaque model image. These services and documents.js solve adjacent problems with opposite emphases: they're better at scanned pages, handwriting, and semantic field extraction; documents.js is the only option for writing a document back out and preserving structure through a round trip without an account or per-page charge. ODF is entirely unserved by every one of the five.

| Package / service                                                                                                    | Direction | Approach | Deployment | Licence                                 | Pricing model       | Status |
| -------------------------------------------------------------------------------------------------------------------- | --------- | -------- | ---------- | --------------------------------------- | ------------------- | ------ |
| [Cloudflare Workers AI toMarkdown](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/)       | Read only | ML / OCR | SaaS       | Proprietary Cloudflare platform feature | Freemium            | Active |
| [Amazon Textract](https://aws.amazon.com/textract/)                                                                  | Read only | ML / OCR | SaaS       | Proprietary AWS service                 | Per-page / per-unit | Active |
| [Amazon Bedrock Data Automation](https://docs.aws.amazon.com/bedrock/latest/userguide/bda-how-it-works.html)         | Read only | ML / OCR | SaaS       | Proprietary AWS service                 | Per-page / per-unit | Active |
| [Google Cloud Document AI](https://cloud.google.com/document-ai)                                                     | Read only | ML / OCR | SaaS       | Proprietary Google Cloud service        | Per-page / per-unit | Active |
| [Azure AI Document Intelligence](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/overview) | Read only | ML / OCR | SaaS       | Proprietary Microsoft Azure service     | Freemium            | Active |

<details>
<summary><strong>Cloudflare Workers AI toMarkdown</strong> — full detail, pricing, and citations</summary>

env.AI.toMarkdown() binding + REST API converting PDF, images, HTML, XML, docx/xlsx, odt/ods, CSV and .numbers to Markdown, callable from a Worker. (cloud-platform-binding · GA)

**vs. documents.js:** Hybrid: structural for HTML/XML/spreadsheets, two chained Workers AI models for images, PDF-UA StructTree with raw-text fallback for PDF. One-directional, no writers back, Cloudflare-account-only; free for most conversions.

**Free tier:** The toMarkdown conversion itself is free for most format conversions; only image conversions that invoke Workers AI models can incur cost, and only once usage exceeds the Workers AI free tier allocation.

**Pricing tiers:**

| Tier                                                                    | Price                                                                              | Unit                          |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------- |
| toMarkdown document/text conversion                                     | Free                                                                               | per conversion                |
| Image conversion (object detection/summarization via Workers AI models) | Billed at Workers AI model rates once usage exceeds the Workers AI free allocation | per Workers AI neuron/request |

**Sources:** [developers.cloudflare.com](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/)

</details>

<details>
<summary><strong>Amazon Textract</strong> — full detail, pricing, and citations</summary>

ML extraction of text, handwriting, forms, tables and structured data from scans/images via feature-specific APIs. (saas-api · GA, long-standing)

**vs. documents.js:** Input limited to JPEG/PNG/PDF/TIFF only — no office formats at all; per-feature JSON output, $0.0015–$0.07/page, no self-hosted option.

**Free tier:** New AWS customers get a 3-month free tier: 1,000 pages/mo for Detect Document Text; 100-1,000 pages/mo for the various Analyze Document features; 100 pages/mo for Analyze Expense/ID; 2,000 pages/mo for Analyze Lending.

**Pricing tiers:**

| Tier                                              | Price   | Unit                                                 |
| ------------------------------------------------- | ------- | ---------------------------------------------------- |
| Detect Document Text (OCR) - first 1M pages/mo    | $0.0015 | per page                                             |
| Detect Document Text (OCR) - after 1M pages/mo    | $0.0006 | per page                                             |
| Analyze Document - Forms - first 1M pages/mo      | $0.05   | per page                                             |
| Analyze Document - Tables - first 1M pages/mo     | $0.015  | per page                                             |
| Analyze Document - Queries - first 1M pages/mo    | $0.015  | per page                                             |
| Analyze Document - Signatures - first 1M pages/mo | $0.0035 | per page                                             |
| Analyze Expense - first 1M pages/mo               | $0.01   | per page                                             |
| Analyze ID - first 100K pages/mo                  | $0.025  | per page                                             |
| Analyze Lending - first 1M pages/mo               | $0.07   | per page — Only supported document types are charged |

**Sources:** [aws.amazon.com](https://aws.amazon.com/textract/) · [aws.amazon.com](https://aws.amazon.com/textract/pricing/)

</details>

<details>
<summary><strong>Amazon Bedrock Data Automation</strong> — full detail, pricing, and citations</summary>

Foundation-model multimodal pipeline (documents/images/video/audio) attaching plaintext/Markdown/HTML/CSV to every extracted entity. (saas-api · GA, newer than Textract)

**vs. documents.js:** Accepts DOCX only by converting to PDF first (breaks page mapping, unsupported synchronously); one-directional, separate per-unit pricing.

**Free tier:** None published; no free tier or trial allowance for Bedrock Data Automation was found on AWS's own pricing page or documentation.

**Pricing tiers:**

| Tier                                         | Price  | Unit                                                                |
| -------------------------------------------- | ------ | ------------------------------------------------------------------- |
| Standard Output - Documents                  | $0.010 | per page                                                            |
| Standard Output - Images                     | $0.003 | per image                                                           |
| Standard Output - Audio                      | $0.006 | per minute                                                          |
| Standard Output - Video                      | $0.050 | per minute                                                          |
| Custom Output (blueprint schema) - Documents | $0.040 | per page                                                            |
| Custom Output (blueprint schema) - Images    | $0.005 | per image — Extra charge if a blueprint defines more than 30 fields |

**Sources:** [docs.aws.amazon.com](https://docs.aws.amazon.com/bedrock/latest/userguide/bda-how-it-works.html) · [aws.amazon.com](https://aws.amazon.com/bedrock/pricing/)

</details>

<details>
<summary><strong>Google Cloud Document AI</strong> — full detail, pricing, and citations</summary>

OCR, Layout parser, and prebuilt/custom field-extraction processors for documents. (saas-api · GA)

**vs. documents.js:** Widest native office ingestion of the four (via Layout parser) but outputs Document.proto JSON only, never Markdown or a regenerated file; $0.65–$30 per 1,000 pages.

**Free tier:** Google's own pricing page did not confirm a free-tier quota on this fetch; third-party sources mention one but it was not independently verified, so it is not asserted here.

**Pricing tiers:**

| Tier                                               | Price | Unit                                                   |
| -------------------------------------------------- | ----- | ------------------------------------------------------ |
| Enterprise Document OCR - 1 to 5,000,000 pages/mo  | $1.50 | per 1,000 pages                                        |
| Enterprise Document OCR - above 5,000,000 pages/mo | $0.60 | per 1,000 pages                                        |
| Layout Parser                                      | $10   | per 1,000 pages — Flat rate, includes initial chunking |
| Form Parser - 1 to 1,000,000 pages/mo              | $30   | per 1,000 pages                                        |
| Form Parser - above 1,000,000 pages/mo             | $20   | per 1,000 pages                                        |
| Custom Extractor - 1 to 1,000,000 pages/mo         | $30   | per 1,000 pages                                        |
| Custom Extractor - above 1,000,000 pages/mo        | $20   | per 1,000 pages                                        |

**Sources:** [cloud.google.com](https://cloud.google.com/document-ai) · [cloud.google.com](https://cloud.google.com/document-ai/pricing)

</details>

<details>
<summary><strong>Azure AI Document Intelligence</strong> — full detail, pricing, and citations</summary>

Read/Layout models plus prebuilt and custom-trainable extraction models for forms/PDFs/images. (saas-api · GA, v4.0 current)

**vs. documents.js:** Layout model can output structured Markdown, closest to Cloudflare on shape; uniquely offers a disconnected on-prem container, but behind a commitment plan as an opaque model image.

**Free tier:** F0 free tier: up to 500 pages per month across features, for evaluation/testing.

**Pricing tiers:**

| Tier                                             | Price                                                             | Unit                      |
| ------------------------------------------------ | ----------------------------------------------------------------- | ------------------------- |
| Free (F0)                                        | $0                                                                | up to 500 pages per month |
| Standard (S0) - Read (OCR)                       | $1.50                                                             | per 1,000 pages           |
| Standard (S0) - Layout / all prebuilt models     | $10                                                               | per 1,000 pages           |
| Standard (S0) - Custom Extraction                | $30                                                               | per 1,000 pages           |
| Standard (S0) - Query Fields add-on              | $10                                                               | per 1,000 pages           |
| Standard (S0) - High-res/formula/barcode add-ons | $6                                                                | per 1,000 pages           |
| Commitment tiers (volume)                        | as low as ~$0.53 per 1,000 pages at 8M pages/mo annual commitment | per 1,000 pages           |

**Sources:** [learn.microsoft.com](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/overview) · [azure.microsoft.com](https://azure.microsoft.com/en-us/pricing/details/ai-document-intelligence/)

</details>

## Third-party commercial document-conversion APIs & hosted LLM/RAG parsing platforms

**documents.js counterpart:** The whole documents.js ecosystem: self-hosted, MIT, no-account, install-and-run packages doing bidirectional lossless conversion with zero network calls or per-document billing

This tier splits into two clusters that pressure documents.js in opposite ways. Cluster A — Adobe, PDF.co, Nutrient, ConvertAPI, ABBYY, Docparser, Parseur, plus the self-hostable office servers OnlyOffice and Collabora — is the established conversion/extraction market: mostly proprietary, cloud-only, metered per transaction, credit, or page. Nutrient is the sole proprietary vendor with a real self-hosted product (Document Engine, annual licence); OnlyOffice and Collabora are the only genuinely open, free-to-run structural converters found anywhere in the survey — but OnlyOffice Community is AGPLv3 with network-use copyleft and a 20-connection cap, and Collabora's free tier is explicitly scoped to testing/home use, with Business from €3/user/month; both are always-on LibreOffice-class servers, not embeddable libraries. Cluster B — LlamaParse, Reducto, Chunkr, Unstructured Platform, Affinda — is the LLM/RAG-era parsing wave: vision- and language-model-based, priced per page or credit, lossy-by-design because the target is clean chunks for retrieval, not a document you can write back out. Chunkr is the one Cluster B entry with a genuine open-source self-hosted path, and it's AGPL-3.0, GPU-oriented, model-weight-dependent. Across all fourteen, none is simultaneously permissively licensed, embeddable as a library, bidirectional, and runnable with no GPU, no account, and no Node-only dependency — exactly the intersection documents.js occupies. Two structural gaps this category exposes: OCR/ICR is a standard commercial line item everywhere here, and documents.js has none; and template-driven document generation from data (Adobe's Word-template generation, Docparser's/Parseur's template engines) is large, monetised demand documents.js doesn't address.

| Package / service                                                                          | Direction    | Approach     | Deployment    | Licence                                                        | Pricing model | Status |
| ------------------------------------------------------------------------------------------ | ------------ | ------------ | ------------- | -------------------------------------------------------------- | ------------- | ------ |
| [Adobe PDF Services API](https://developer.adobe.com/document-services/apis/pdf-services/) | Read + Write | Engine / SDK | SaaS          | Proprietary, cloud-only                                        | Freemium      | Active |
| [PDF.co](https://pdf.co/pricing)                                                           | Read + Write | Engine / SDK | SaaS          | Proprietary, cloud-only                                        | Credit-based  | Active |
| [Nutrient (formerly PSPDFKit)](https://www.nutrient.io/api/pricing/)                       | Read + Write | Engine / SDK | SaaS + Server | Proprietary; self-hosted Document Engine under annual licence  | Credit-based  | Active |
| [ConvertAPI](https://www.convertapi.com/pricing)                                           | Read + Write | Engine / SDK | SaaS          | Proprietary, cloud-only                                        | Credit-based  | Active |
| [ABBYY (FineReader Engine / Cloud OCR SDK / Vantage)](https://www.abbyy.com/vantage/)      | Read + Write | ML / OCR     | SaaS + Server | Proprietary commercial, sales-quote only                       | Sales quote   | Active |
| [Docparser](https://docparser.com/pricing/)                                                | Read only    | Template     | SaaS          | Proprietary, cloud-only                                        | Credit-based  | Active |
| [Parseur](https://parseur.com/pricing)                                                     | Read only    | Template     | SaaS          | Proprietary, cloud-only                                        | Freemium      | Active |
| [OnlyOffice Docs (Document Server)](https://www.onlyoffice.com/compare-editions)           | Read + Write | Engine / SDK | Server        | Community: AGPLv3; Enterprise: proprietary                     | Freemium      | Active |
| [Collabora Online](https://www.collaboraonline.com/pricing/)                               | Read + Write | Engine / SDK | Server        | LibreOffice-derived (MPL/LGPL); Business/Enterprise commercial | Freemium      | Active |
| [LlamaCloud / LlamaParse](https://developers.llamaindex.ai/llamaparse/general/pricing/)    | Read only    | ML / OCR     | SaaS + Server | Proprietary; credit-based                                      | Credit-based  | Active |
| [Reducto](https://reducto.ai/pricing)                                                      | Read only    | ML / OCR     | SaaS + Server | Proprietary; pay-as-you-go                                     | Credit-based  | Active |
| [Chunkr](https://github.com/lumina-ai-inc/chunkr)                                          | Read only    | ML / OCR     | SaaS + Server | AGPL-3.0 (self-hosted); commercial (Cloud API)                 | Freemium      | Active |
| [Unstructured Platform](https://unstructured.io/platform)                                  | Read only    | ML / OCR     | SaaS + Server | Proprietary managed platform (built on Apache-2.0 library)     | Freemium      | Active |
| [Affinda](https://www.affinda.com/pricing-plans/)                                          | Read only    | ML / OCR     | SaaS          | Proprietary; usage-based                                       | Sales quote   | Active |

<details>
<summary><strong>Adobe PDF Services API</strong> — full detail, pricing, and citations</summary>

PDF creation, export/conversion, combine, OCR, redaction, and document generation from Word templates + JSON. (saas-api · mature enterprise API)

**vs. documents.js:** Free tier covers 500 self-serve Document Transactions/month with no card required; beyond that, pricing is sales-quote only with nothing published (a widely-repeated ~$0.05/transaction figure is a third-party forum anecdote, not Adobe's own pricing) — versus documents.js's free, unlimited, local, no-account conversion with fully transparent (zero) cost.

**Free tier:** 500 free Document Transactions per month via self-serve API credentials, no credit card or commitment required.

**Pricing tiers:**

| Tier          | Price                  | Unit                                                                                                                                                                                                              |
| ------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free Tier     | $0                     | up to 500 Document Transactions/month — No credit card required; self-serve API credentials                                                                                                                       |
| Paid Plans    | Custom (contact sales) | per Document Transaction, volume-based — No self-serve pricing published; a widely-cited ~$0.05/transaction figure with a 500,000/year minimum is a third-party forum anecdote, not Adobe's own published pricing |
| PDF Embed API | $0                     | unlimited — Separate product (JS viewer only, not the processing API)                                                                                                                                             |

**Sources:** [developer.adobe.com](https://developer.adobe.com/document-services/apis/pdf-services/) · [developer.adobe.com](https://developer.adobe.com/document-services/pricing/main/) · [developer.adobe.com](https://developer.adobe.com/document-services/docs/overview/limits)

</details>

<details>
<summary><strong>PDF.co</strong> — full detail, pricing, and citations</summary>

Cloud API for PDF/document manipulation: conversion, generation, OCR, extraction, split/merge. (saas-api · mature commercial API vendor)

**vs. documents.js:** Credit-metered per operation, $8.99–$270/month subscription tiers plus an Enterprise tier — no self-hosting path at all.

**Free tier:** A free trial is referenced on the pricing page but its exact duration/credit allowance is not specified there.

**Pricing tiers:**

| Tier       | Price      | Unit                             |
| ---------- | ---------- | -------------------------------- |
| Basic      | $8.99/mo   | 16,500 credits/mo                |
| Personal   | $22.49/mo  | 37,000 credits/mo                |
| Business 1 | $44.99/mo  | 80,500 credits/mo — Most popular |
| Business 2 | $89.99/mo  | 159,850 credits/mo               |
| Business 3 | $270.00/mo | 483,000 credits/mo               |
| Enterprise | Custom     | above 500,000 credits/mo         |

**Sources:** [pdf.co](https://pdf.co/pricing)

</details>

<details>
<summary><strong>Nutrient (formerly PSPDFKit)</strong> — full detail, pricing, and citations</summary>

Data Extraction, Processor (convert/merge/OCR/redact/watermark), Accessibility and Viewer APIs, plus a self-hostable Document Engine. (saas-api + self-hosted-server · mature, long-established PDF SDK vendor)

**vs. documents.js:** The only Cluster A vendor offering a genuine self-hosted deployment path — but still proprietary and commercially licensed, unlike documents.js's auditable, forkable MIT source.

**Free tier:** Every one of Nutrient's four APIs (Processor, Data Extraction, Accessibility, Viewer) has its own free tier with no credit card required.

**Pricing tiers:**

| Tier                          | Price   | Unit               |
| ----------------------------- | ------- | ------------------ |
| Processor API - Free          | $0/mo   | 50 credits/mo      |
| Processor API - Starter       | $75/mo  | 1,000 credits/mo   |
| Processor API - Growth        | $275/mo | 5,000 credits/mo   |
| Processor API - Pro           | $445/mo | 10,000 credits/mo  |
| Data Extraction API - Free    | $0/mo   | 5,000 credits/mo   |
| Data Extraction API - Starter | $59/mo  | 25,000 credits/mo  |
| Data Extraction API - Pro     | $500/mo | 500,000 credits/mo |
| Viewer API - Free             | $0/mo   | 250 sessions/mo    |
| Viewer API - Starter          | $199/mo | 5,000 sessions/mo  |
| Viewer API - Growth           | $399/mo | 20,000 sessions/mo |

**Sources:** [www.nutrient.io](https://www.nutrient.io/api/pricing/)

</details>

<details>
<summary><strong>ConvertAPI</strong> — full detail, pricing, and citations</summary>

Cloud REST API/SDK/no-code platform for broad document, image and PDF conversions. (saas-api · established mid-size vendor)

**vs. documents.js:** Per-conversion billing, $9–$99/month tiers plus 250 free conversions on signup — versus zero-cost, no-signup, unlimited local conversion.

**Free tier:** Free signup grants 250 conversions with no credit card required.

**Pricing tiers:**

| Tier       | Price   | Unit                                       |
| ---------- | ------- | ------------------------------------------ |
| Developer  | $9/mo   | 1,000-12,000 conversions/mo, 200MB limit   |
| Startup    | $29/mo  | 5,000-60,000 conversions/mo, 300MB limit   |
| Growth     | $99/mo  | 15,000-180,000 conversions/mo, 500MB limit |
| Business   | $249/mo | 50,000-600,000 conversions/mo, 1GB limit   |
| Enterprise | Custom  | 100,000+ conversions/mo, 2GB limit         |

**Sources:** [www.convertapi.com](https://www.convertapi.com/pricing)

</details>

<details>
<summary><strong>ABBYY (FineReader Engine / Cloud OCR SDK / Vantage)</strong> — full detail, pricing, and citations</summary>

OCR/ICR SDK plus Vantage, a low-code Intelligent Document Processing platform with 150+ prebuilt extraction skills. (self-hosted-server + saas-api · mature, decades-old OCR/IDP vendor)

**vs. documents.js:** A fundamentally different problem — image-to-structured-data via ML — from documents.js's structural, lossless format-to-format conversion of already-digital documents.

**Free tier:** ABBYY Vantage offers a 45-day free trial (request-based, page-limited, not for production); no published free tier for FineReader Engine or Cloud OCR SDK.

**Sources:** [www.abbyy.com](https://www.abbyy.com/vantage/) · [www.abbyy.com](https://www.abbyy.com/marketplace/start-trial/)

</details>

<details>
<summary><strong>Docparser</strong> — full detail, pricing, and citations</summary>

Extracts structured data (tables, fields, checkboxes) from PDF/Word/image documents via rule-based parsers. (saas-api · established extraction vendor)

**vs. documents.js:** Solves structured-data extraction (not format conversion), $32.50–$159/month subscriptions — a different problem from documents.js's structural round-tripping.

**Free tier:** 14-day free trial, no credit card required (no permanent free plan).

**Pricing tiers:**

| Tier         | Price                     | Unit                                 |
| ------------ | ------------------------- | ------------------------------------ |
| Starter      | $39/mo ($32.50/mo annual) | 100 credits/mo, up to 15 parsers     |
| Professional | $74/mo ($61.50/mo annual) | 250 credits/mo, up to 50 parsers     |
| Business     | $159/mo ($133/mo annual)  | 1,000 credits/mo, up to 500 parsers  |
| Enterprise   | Custom                    | custom credits/mo, unlimited parsers |

**Sources:** [docparser.com](https://docparser.com/pricing/)

</details>

<details>
<summary><strong>Parseur</strong> — full detail, pricing, and citations</summary>

Extracts structured data from emails, PDFs and invoices via AI or template parsing engines. (saas-api · established extraction vendor)

**vs. documents.js:** Same category as Docparser; free tier capped at 20 pages/month then paid tiers to 1M pages/month, cloud-only.

**Free tier:** Free plan forever: 20 pages/credits per month, 1 user, no credit card required.

**Pricing tiers:**

| Tier       | Price     | Unit                                      |
| ---------- | --------- | ----------------------------------------- |
| Free       | $0        | 20 pages/credits per month — Free forever |
| Micro      | $49/mo    | 100 pages/mo                              |
| Starter    | $129/mo   | 1,000 pages/mo                            |
| Premium    | $269/mo   | 3,000 pages/mo                            |
| Pro        | $499/mo   | 10,000 pages/mo                           |
| 100k       | $3,699/mo | 100,000 pages/mo                          |
| 250k       | $8,499/mo | 250,000 pages/mo                          |
| Enterprise | Custom    | up to 10M pages/mo                        |

**Sources:** [parseur.com](https://parseur.com/pricing)

</details>

<details>
<summary><strong>OnlyOffice Docs (Document Server)</strong> — full detail, pricing, and citations</summary>

Self-hostable collaborative office document server for docx/xlsx/pptx/odt/ods/odp conversion and editing. (self-hosted-server · mature, widely deployed (Nextcloud/ownCloud))

**vs. documents.js:** Genuinely self-hostable and open source, but AGPLv3's network-use copyleft requires publishing modifications and caps Community at 20 concurrent connections — versus MIT with no copyleft obligation.

**Free tier:** Community Edition is free and open source (AGPLv3), self-hosted, recommended for up to ~20 users, community/GitHub support only.

**Pricing tiers:**

| Tier       | Price          | Unit                                                                    |
| ---------- | -------------- | ----------------------------------------------------------------------- |
| Community  | Free           | AGPLv3, self-hosted, up to ~20 users recommended                        |
| Enterprise | From $1,500/yr | 50 connections minimum — Cloud or on-prem; configurable support/add-ons |
| Developer  | From $3,500/yr | 20 connections per server — For embedding into a branded service        |

**Sources:** [www.onlyoffice.com](https://www.onlyoffice.com/compare-editions) · [www.onlyoffice.com](https://www.onlyoffice.com/docs-enterprise-prices)

</details>

<details>
<summary><strong>Collabora Online</strong> — full detail, pricing, and citations</summary>

Self-hostable collaborative document server built on LibreOffice (Writer/Calc/Impress/Draw). (self-hosted-server · mature, used by governments/enterprises)

**vs. documents.js:** A genuine self-hosted alternative, but ships as a heavyweight always-on LibreOffice server; free CODE tier is testing/home-use only, Business from €3/user/month.

**Free tier:** Development Edition is free for home use, testing, and startups (on-premise, unlimited, no SLA/support).

**Pricing tiers:**

| Tier                | Price      | Unit                                               |
| ------------------- | ---------- | -------------------------------------------------- |
| Development Edition | Free       | on-premise, home/testing/startups — No SLA/support |
| Business            | €3/user/mo | up to 99 users — LTS, SLA, signed security updates |
| Enterprise          | Custom     | 100+ users, quote-based                            |

**Sources:** [www.collaboraonline.com](https://www.collaboraonline.com/pricing/)

</details>

<details>
<summary><strong>LlamaCloud / LlamaParse</strong> — full detail, pricing, and citations</summary>

GenAI-native hosted parsing for RAG, 130+ input formats, four tiers trading cost/latency/accuracy. (saas-api (BYOC option) · widely adopted in LLM/RAG tooling)

**vs. documents.js:** Optimises for LLM-readability — one-way, lossy-by-design extraction into markdown/text — versus documents.js's lossless, type-safe, bidirectional round-tripping.

**Free tier:** No published free tier on the pricing page itself; docs suggest contacting LlamaParse for trial/demo access.

**Pricing tiers:**

| Tier                   | Price           | Unit     |
| ---------------------- | --------------- | -------- |
| Fast parse             | 1 credit/page   | per page |
| Cost-effective parse   | 3 credits/page  | per page |
| Agentic parse          | 10 credits/page | per page |
| Agentic Plus parse     | 45 credits/page | per page |
| Cost-effective extract | 8 credits/page  | per page |
| Agentic extract        | 25 credits/page | per page |
| Agentic Plus extract   | 60 credits/page | per page |

**Sources:** [developers.llamaindex.ai](https://developers.llamaindex.ai/llamaparse/general/pricing/)

</details>

<details>
<summary><strong>Reducto</strong> — full detail, pricing, and citations</summary>

Vision-model 'agentic document platform' — Parse/Extract/Split/Classify/Edit across PDFs, images, spreadsheets, documents. (saas-api (on-prem for Enterprise) · newer LLM-era, enterprise-focused)

**vs. documents.js:** ML/vision-model pricing-per-page ($7.50–$60 per 1,000 pages) aimed at LLM-ready extraction — lossy and one-directional, versus documents.js's deterministic, zero-cost codecs.

**Free tier:** New accounts start with $150 of free usage on the Standard pay-as-you-go tier.

**Pricing tiers:**

| Tier                     | Price                                     | Unit                     |
| ------------------------ | ----------------------------------------- | ------------------------ |
| Standard (pay-as-you-go) | $150 free usage, then per-operation rates | per 1,000 pages          |
| Growth                   | Custom (volume discounts)                 | quote-based              |
| Enterprise               | Custom                                    | quote-based, VPC/on-prem |

**Sources:** [reducto.ai](https://reducto.ai/pricing)

</details>

<details>
<summary><strong>Chunkr</strong> — full detail, pricing, and citations</summary>

Vision-language-model document intelligence converting PDFs/PPT/Word/images to structured HTML/Markdown chunks. (self-hosted-server + saas-api · newer (YC-backed), actively developed)

**vs. documents.js:** The one Cluster B entry that's genuinely open-source and self-hostable — but AGPL-3.0, GPU-oriented, model-weight-dependent, versus documents.js's permissive, no-GPU codecs.

**Free tier:** The hosted Cloud API gives 200 free credits to start; separately, the entire engine is open source (AGPL-3.0) and free to self-host indefinitely, using community models rather than the Cloud API's proprietary models.

**Pricing tiers:**

| Tier                      | Price     | Unit                       |
| ------------------------- | --------- | -------------------------- |
| Open source (self-hosted) | Free      | AGPL-3.0, community models |
| Dev (Cloud API)           | $375/mo   | 25,000 credits included    |
| Growth (Cloud API)        | $750/mo   | 75,000 credits included    |
| Scale (Cloud API)         | $2,000/mo | 250,000 credits included   |
| Enterprise (Cloud API)    | Custom    | quote-based                |

**Repository health (as of 2 September 2026):** 4.1k stars, 275 forks, 19 contributors, 0.0 commits/week avg (trailing 52wk), last release v2.2.1 (2025-07-31)

**Sources:** [github.com](https://github.com/lumina-ai-inc/chunkr) · [www.chunkr.ai](https://www.chunkr.ai/pricing)

</details>

<details>
<summary><strong>Unstructured Platform</strong> — full detail, pricing, and citations</summary>

Hosted end-to-end pipeline extracting/transforming/loading data from 65+ file types into vector databases, with an MCP interface. (saas-api (VPC/hybrid/bare-metal options) · enterprise-compliance certified (FedRAMP/HIPAA/GDPR/SOC2))

**vs. documents.js:** A full managed ETL pipeline for LLM/vector-store destinations, several layers above documents.js's scope as a direct-conversion library; no lossless round-trip guarantee.

**Free tier:** 10,000 pages processed free with no card required, all features included.

**Pricing tiers:**

| Tier            | Price  | Unit                       |
| --------------- | ------ | -------------------------- |
| Let's Go (Free) | $0     | 10,000 pages included      |
| Pay-As-You-Go   | $0.015 | per page after free 10,000 |
| Business        | Custom | quote-based                |

**Sources:** [unstructured.io](https://unstructured.io/platform) · [unstructured.io](https://unstructured.io/pricing)

</details>

<details>
<summary><strong>Affinda</strong> — full detail, pricing, and citations</summary>

AI-powered Identity/Financial/Resume parsers extracting structured data from resumes, invoices, contracts. (saas-api · established, HR/finance-focused)

**vs. documents.js:** Narrow ML-driven vertical extraction (~$0.070 per file/page), fundamentally different in scope from documents.js's general-purpose format conversion.

**Free tier:** A two-week free trial with 200 credits included to test on real documents.

**Pricing tiers:**

| Tier                       | Price        | Unit                        |
| -------------------------- | ------------ | --------------------------- |
| Trial                      | Free         | 2-week trial, 200 credits   |
| Flexible usage (Monthly)   | Custom quote | per page, billed monthly    |
| Predictable scale (Annual) | Custom quote | per page, annual commitment |

**Sources:** [www.affinda.com](https://www.affinda.com/pricing-plans/)

</details>
