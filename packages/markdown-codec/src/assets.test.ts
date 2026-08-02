// Regression coverage for the vendored conformance corpora (assets/) -- not a placeholder: these fixtures are the actual test data src/scan, src/block, and src/inline will validate against once implemented, so a corrupted, truncated, or accidentally-replaced-with-a-stub fetch needs to fail CI immediately rather than silently drift until someone reaches for the corpus much later.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ASSETS_ROOT = fileURLToPath(new URL('../assets', import.meta.url));

interface CommonMarkExample {
  markdown: string;
  html: string;
  example: number;
  start_line: number;
  end_line: number;
  section: string;
}

function isCommonMarkExample(value: unknown): value is CommonMarkExample {
  if (typeof value !== 'object' || value === null) return false;
  if (!('markdown' in value) || !('html' in value) || !('example' in value) || !('section' in value)) return false;
  return typeof value.markdown === 'string' && typeof value.html === 'string' && typeof value.example === 'number' && typeof value.section === 'string';
}

function isCommonMarkExampleArray(value: unknown): value is CommonMarkExample[] {
  return Array.isArray(value) && value.every(isCommonMarkExample);
}

interface HtmlEntity {
  codepoints: number[];
  characters: string;
}

function isHtmlEntity(value: unknown): value is HtmlEntity {
  if (typeof value !== 'object' || value === null) return false;
  if (!('codepoints' in value) || !('characters' in value)) return false;
  return Array.isArray(value.codepoints) && typeof value.characters === 'string';
}

function isHtmlEntityTable(value: unknown): value is Record<string, HtmlEntity> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(isHtmlEntity);
}

describe('assets/commonmark', () => {
  it('spec.txt is the real CommonMark specification prose', () => {
    const text = readFileSync(`${ASSETS_ROOT}/commonmark/spec.txt`, 'utf8');
    expect(text.length).toBeGreaterThan(150_000);
    expect(text).toContain('# Introduction');
    expect(text).toContain('CommonMark');
  });

  it('spec.json is the real conformance example corpus', () => {
    const parsed: unknown = JSON.parse(readFileSync(`${ASSETS_ROOT}/commonmark/spec.json`, 'utf8'));
    if (!isCommonMarkExampleArray(parsed)) throw new Error('spec.json did not parse as CommonMarkExample[]');
    expect(parsed.length).toBeGreaterThan(600);
    const sections = new Set(parsed.map((example) => example.section));
    expect(sections.size).toBeGreaterThan(20);
  });
});

describe('assets/gfm', () => {
  it('spec.txt is the real GFM specification, extending CommonMark in place', () => {
    const text = readFileSync(`${ASSETS_ROOT}/gfm/spec.txt`, 'utf8');
    expect(text.length).toBeGreaterThan(150_000);
    expect(text).toContain('GitHub Flavored Markdown');
    expect(text).toContain('CC-BY-SA 4.0');
  });
});

describe('assets/html-entities', () => {
  it('entities.json is the real WHATWG named character reference table', () => {
    const parsed: unknown = JSON.parse(readFileSync(`${ASSETS_ROOT}/html-entities/entities.json`, 'utf8'));
    if (!isHtmlEntityTable(parsed)) throw new Error('entities.json did not parse as a named-character-reference table');
    const names = Object.keys(parsed);
    expect(names.length).toBeGreaterThan(2000);
    const amp = parsed['&amp;'];
    expect(amp?.characters).toBe('&');
  });
});
