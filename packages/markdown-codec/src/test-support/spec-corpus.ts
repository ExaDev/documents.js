// Loads the vendored conformance corpora (assets/commonmark/spec.json and assets/gfm/spec.txt -- see each directory's own NOTICE.md for provenance and licence).
//
// The CommonMark corpus ships machine-readable, so it is parsed as JSON. JSON.parse returns `any`, so the parsed value is assigned to `unknown` and narrowed by a real type guard rather than asserted. That is this repository's own standing rule, and it earns its keep here: the corpus is a vendored third-party file, so a shape change on a future re-fetch should fail loudly at load time rather than silently produce examples with undefined fields.
//
// The GFM corpus ships only as prose (assets/gfm/spec.txt), with its examples in the same fenced format the CommonMark spec source uses: a line of at least 32 backticks followed by the word `example` and -- for an extension example -- the extension's own name; then the markdown; then a line containing only `.`; then the expected HTML; then a closing line of backticks. Extracting them here rather than vendoring a second, pre-built JSON keeps that asset exactly as fetched from its canonical source, which is what assets/gfm/NOTICE.md records.

import { readFileSync } from 'node:fs';

export interface SpecExample {
  readonly markdown: string;
  readonly html: string;
  readonly example: number;
  readonly section: string;
}

function isSpecExample(value: unknown): value is SpecExample {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('markdown' in value) || !('html' in value) || !('example' in value) || !('section' in value)) {
    return false;
  }
  return typeof value.markdown === 'string' && typeof value.html === 'string' && typeof value.example === 'number' && typeof value.section === 'string';
}

function isSpecExampleArray(value: unknown): value is SpecExample[] {
  return Array.isArray(value) && value.every(isSpecExample);
}

export function loadSpecExamples(): SpecExample[] {
  const raw: unknown = JSON.parse(readFileSync(new URL('../../assets/commonmark/spec.json', import.meta.url), 'utf8'));
  if (!isSpecExampleArray(raw)) {
    throw new Error('assets/commonmark/spec.json is not an array of {markdown, html, example, section} examples');
  }
  return raw;
}

// The spec source's own example fence: at least 32 backticks, then `example`, then optionally the extension name tagging it.
const GFM_EXAMPLE_START_PATTERN = /^`{32,} example(?: (\S+))?\s*$/;
const GFM_EXAMPLE_END_PATTERN = /^`{32,}\s*$/;
const GFM_SECTION_PATTERN = /^#{1,6} (.+)$/;

// The spec source writes a literal tab as U+2192 (RIGHTWARDS ARROW) inside its own examples so tabs stay visible in the rendered prose; the corpus generator substitutes it back. Doing the same here is not a convenience -- several examples depend on the character really being a tab.
const VISIBLE_TAB = '→';

// Every example in assets/gfm/spec.txt tagged with `extension` (`table`, `strikethrough`, `autolink`, ...), in document order. Untagged examples are deliberately not returned: those are the CommonMark base, which the machine-readable CommonMark corpus already covers at its own pinned spec version.
export function loadGfmExtensionExamples(extension: string): SpecExample[] {
  const lines = readFileSync(new URL('../../assets/gfm/spec.txt', import.meta.url), 'utf8').split('\n');
  const examples: SpecExample[] = [];
  let section = '';
  let index = 0;
  let exampleNumber = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const heading = GFM_SECTION_PATTERN.exec(line);
    if (heading !== null) {
      section = heading[1] ?? '';
      index += 1;
      continue;
    }
    const start = GFM_EXAMPLE_START_PATTERN.exec(line);
    if (start === null) {
      index += 1;
      continue;
    }

    exampleNumber += 1;
    index += 1;
    const markdown: string[] = [];
    while (index < lines.length && lines[index] !== '.') {
      markdown.push(lines[index] ?? '');
      index += 1;
    }
    index += 1;
    const html: string[] = [];
    while (index < lines.length && !GFM_EXAMPLE_END_PATTERN.test(lines[index] ?? '')) {
      html.push(lines[index] ?? '');
      index += 1;
    }
    index += 1;

    if (start[1] === extension) {
      examples.push({
        markdown: `${markdown.join('\n')}\n`.replaceAll(VISIBLE_TAB, '\t'),
        html: `${html.join('\n')}\n`.replaceAll(VISIBLE_TAB, '\t'),
        example: exampleNumber,
        section,
      });
    }
  }
  return examples;
}
