// Never generated via this package's own buildMarkdownText/markdown-codec's own writeMarkdownContent -- hand-authored literal markdown source text, matching this directory's own fixture-independence convention (docx.ts/odt.ts/pptx.ts/odp.ts/ods.ts/odg.ts: a fixture built independently of the very code under test, so a bug in that code cannot hide behind a fixture the same code produced). Unlike every other fixture in this directory, markdown IS its own on-the-wire byte format (see src/model/bytes.ts's own MarkdownBytesSchema comment) -- there is no zip/package structure to build, so this file is nothing more than a literal string.

// A heading, a bold+italic run, a second plain paragraph, a two-level bullet list, and a GFM table -- the same content shapes buildRichDocx/buildRichOdt (src/convert/bridges.test.ts) exercise for docx/odt, so markdown's own bridge/round-trip tests can assert the identical shapes survive. Markdown has no colour syntax of its own (unlike buildRichDocx/buildRichOdt's own coloured run), so that one shape is deliberately not mirrored here -- there is nothing CommonMark/GFM could have produced it from.
export function richMarkdownText(): string {
  return [
    '# Report Title',
    '',
    'Second paragraph with **bold** and *italic* text.',
    '',
    '- First item',
    '- Second item',
    '  - Nested item',
    '- Third top-level item',
    '',
    '| A | B |',
    '| --- | --- |',
    '| A1 | B1 |',
    '| A2 | B2 |',
    '',
  ].join('\n');
}

// A leading YAML front matter block (title/author), for a caller exercising ReadMarkdownOptions.frontMatter specifically -- kept separate from richMarkdownText() above rather than folded into it, since front matter is opt-in (markdown-codec's own DEFAULT_FRONT_MATTER is false) and a caller reading richMarkdownText() with default options must not see a stray thematic-break-then-paragraph pair where a front-matter-aware caller would see metadata.
export function richMarkdownTextWithFrontMatter(): string {
  return ['---', 'title: Sample Report', 'author: Ada Lovelace', '---', '', richMarkdownText()].join('\n');
}
