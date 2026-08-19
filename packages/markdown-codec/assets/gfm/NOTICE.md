# GitHub Flavored Markdown (GFM) spec extension examples

`spec.txt` vendored from the [github/cmark-gfm](https://github.com/github/cmark-gfm) repository's `test/spec.txt`, fetched from `https://raw.githubusercontent.com/github/cmark-gfm/master/test/spec.txt` (commit `828322d1ee4facdab56f0d3edccb13e9af90dcd2`, authored 2023-03-25), fetched 2026-08-02.

This is the official GitHub Flavored Markdown Spec source (version 0.29, dated 2019-04-06 per the document's own front-matter) — the same document published at <https://github.github.com/gfm/>. It is CommonMark's own `spec.txt` extended in place with GFM's own additional constructs (tables, strikethrough, autolinks, task list items, disallowed raw HTML) and their own fenced conformance examples, each following CommonMark's identical `example`-block convention — so this single file is both the GFM prose specification and the source `spec_tests.py`-style tooling extracts GFM's own conformance examples from, mirroring `assets/commonmark/spec.json`'s own extraction relationship to `assets/commonmark/spec.txt`.

## Licence

Stated directly in the document's own YAML front-matter (the first lines of the fetched file):

```yaml
title: GitHub Flavored Markdown Spec
version: 0.29
date: '2019-04-06'
license: '[CC-BY-SA 4.0](http://creativecommons.org/licenses/by-sa/4.0/)'
```

Creative Commons Attribution-ShareAlike 4.0 International — the same licence CommonMark's own `spec.txt` is released under (see `assets/commonmark/NOTICE.md`), consistent with GFM's spec being an in-place extension of the CommonMark document. This vendoring is unmodified verbatim redistribution for use as this package's own GFM conformance test fixtures, with attribution recorded here.
