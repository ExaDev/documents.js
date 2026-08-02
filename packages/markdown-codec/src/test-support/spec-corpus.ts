// Loads the vendored CommonMark conformance corpus (assets/commonmark/spec.json -- see that directory's own NOTICE.md for provenance and licence) and narrows it to the sections whose behaviour the inline phase owns.
//
// JSON.parse returns `any`, so the parsed value is assigned to `unknown` and narrowed by a real type guard rather than asserted. That is this repository's own standing rule, and it earns its keep here: the corpus is a vendored third-party file, so a shape change on a future re-fetch should fail loudly at load time rather than silently produce examples with undefined fields.

import { readFileSync } from 'node:fs';

export interface SpecExample {
  readonly markdown: string;
  readonly html: string;
  readonly example: number;
  readonly section: string;
}

// The corpus sections that test inline-level behaviour. The remaining sections (Tabs, Thematic breaks, ATX/Setext headings, code blocks, HTML blocks, Link reference definitions, Paragraphs, Blank lines, Block quotes, List items, Lists, Precedence, Inlines, Textual content) test BLOCK structure, which src/block/ owns and which the trivial paragraph-only block parser this suite runs against cannot produce at all.
export const INLINE_SPEC_SECTIONS: readonly string[] = [
  'Backslash escapes',
  'Entity and numeric character references',
  'Code spans',
  'Emphasis and strong emphasis',
  'Links',
  'Images',
  'Autolinks',
  'Raw HTML',
  'Hard line breaks',
  'Soft line breaks',
];

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

export function loadInlineSpecExamples(): SpecExample[] {
  const sections = new Set(INLINE_SPEC_SECTIONS);
  return loadSpecExamples().filter((example) => sections.has(example.section));
}
