import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HTML_ENTITY_TABLE } from './entity-table';

interface HtmlEntity {
  readonly codepoints: number[];
  readonly characters: string;
}

function isHtmlEntity(value: unknown): value is HtmlEntity {
  if (typeof value !== 'object' || value === null) return false;
  if (!('codepoints' in value) || !('characters' in value)) return false;
  return Array.isArray(value.codepoints) && typeof value.characters === 'string';
}

function isHtmlEntitySource(value: unknown): value is Record<string, HtmlEntity> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(isHtmlEntity);
}

describe('HTML_ENTITY_TABLE', () => {
  it('resolves common named entities to their real characters', () => {
    expect(HTML_ENTITY_TABLE.amp).toBe('&');
    expect(HTML_ENTITY_TABLE.lt).toBe('<');
    expect(HTML_ENTITY_TABLE.gt).toBe('>');
    expect(HTML_ENTITY_TABLE.nbsp).toBe(' ');
    expect(HTML_ENTITY_TABLE.copy).toBe('©');
    expect(HTML_ENTITY_TABLE.AElig).toBe('Æ');
  });

  it('resolves a multi-codepoint entity to its full character sequence', () => {
    // '&NotEqualTilde;' decodes to U+2242 U+0338 -- proves this table doesn't truncate a value to a single code unit.
    expect(HTML_ENTITY_TABLE.NotEqualTilde).toBe('≂̸');
  });

  it('has no leading "&" or trailing ";" left on any key', () => {
    for (const name of Object.keys(HTML_ENTITY_TABLE)) {
      expect(name.startsWith('&')).toBe(false);
      expect(name.endsWith(';')).toBe(false);
    }
  });

  it('matches exactly the semicolon-terminated subset of the vendored WHATWG source, name-for-name and value-for-value', () => {
    const assetsRoot = fileURLToPath(new URL('../../assets', import.meta.url));
    const parsed: unknown = JSON.parse(readFileSync(`${assetsRoot}/html-entities/entities.json`, 'utf8'));
    if (!isHtmlEntitySource(parsed)) throw new Error('entities.json did not parse as a named-character-reference table');

    const expectedNames = Object.keys(parsed)
      .filter((name) => name.endsWith(';'))
      .map((name) => name.slice(1, -1));

    expect(Object.keys(HTML_ENTITY_TABLE).sort()).toEqual(expectedNames.sort());

    for (const name of expectedNames) {
      const source = parsed[`&${name};`];
      expect(source).toBeDefined();
      expect(HTML_ENTITY_TABLE[name]).toBe(source?.characters);
    }
  });
});
