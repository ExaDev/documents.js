# CommonMark spec conformance corpus

Two files vendored from the official [commonmark/commonmark-spec](https://github.com/commonmark/commonmark-spec) repository, tag `0.31.2` (the latest tag at fetch time), commit `9103e341a973013013bb1a80e13567007c5cef6f`, fetched 2026-08-02:

- `spec.txt` — the CommonMark specification prose itself, fetched from `https://raw.githubusercontent.com/commonmark/commonmark-spec/0.31.2/spec.txt`.
- `spec.json` — the machine-readable conformance test corpus (652 `{markdown, html, example, start_line, end_line, section}` examples extracted from `spec.txt`'s own fenced example blocks), fetched from `https://spec.commonmark.org/0.31.2/spec.json` — the CommonMark project's own canonical hosted generation of this file (the `commonmark-spec` repository does not check `spec.json` in as a static file; it is generated on demand by `test/spec_tests.py` from `spec.txt` and served at this URL by the CommonMark project itself).

## Licence

Per the `commonmark-spec` repository's own `LICENSE` file (`https://raw.githubusercontent.com/commonmark/commonmark-spec/master/LICENSE`, fetched and read in full before vendoring):

> The CommonMark spec (spec.txt) and DTD (CommonMark.dtd) are Copyright (C) 2014-16 John MacFarlane. Released under the Creative Commons CC-BY-SA 4.0 license: <https://creativecommons.org/licenses/by-sa/4.0/>.

`spec.json` is a mechanical, non-creative extraction of the example blocks already embedded in `spec.txt` (each example's markdown/HTML pair is copied verbatim from the spec text; `example`/`start_line`/`end_line`/`section` are structural metadata locating that copy within the source document), so it is covered by the identical CC-BY-SA 4.0 licence as the prose it is drawn from.

CC-BY-SA 4.0 requires attribution and share-alike on adaptations; this vendoring is unmodified verbatim redistribution of both files for use as this package's own conformance test fixtures, with attribution recorded here.
