import { describe, expect, it } from 'vitest';
import { buildXml } from '../xml/build';
import { buildStylePropertyElements, canonicalPropertiesString } from './serialize';
import type { StyleProperties } from './properties';

describe('buildStylePropertyElements', () => {
  it('emits style:paragraph-properties before style:text-properties, matching real ODF producer output and the schema element sequence', () => {
    const elements = buildStylePropertyElements({ alignment: 'center', bold: true });
    expect(elements).toHaveLength(2);
    expect(elements[0]?.tag).toBe('style:paragraph-properties');
    expect(elements[1]?.tag).toBe('style:text-properties');
  });

  it('omits a properties element entirely when that half of the bag is unset, never emitting an empty element', () => {
    expect(buildStylePropertyElements({ bold: true }).map((e) => e.tag)).toEqual(['style:text-properties']);
    expect(buildStylePropertyElements({ alignment: 'left' }).map((e) => e.tag)).toEqual(['style:paragraph-properties']);
    expect(buildStylePropertyElements({})).toEqual([]);
  });

  it('serializes to the exact real-world XML shape', () => {
    const xml = buildXml(buildStylePropertyElements({ bold: true, color: { r: 1, g: 0, b: 0 } }));
    expect(xml).toBe('<style:text-properties fo:font-weight="bold" fo:color="#ff0000"></style:text-properties>');
  });
});

describe('canonicalPropertiesString', () => {
  it('is a pure function: the same bag produces byte-identical output on every call', () => {
    const properties: StyleProperties = { bold: true, alignment: 'center', sizePt: 12 };
    const first = canonicalPropertiesString(properties);
    const second = canonicalPropertiesString({ ...properties });
    expect(first).toBe(second);
    expect(canonicalPropertiesString(properties)).toBe(first);
  });

  it('is independent of the order keys were assigned on the property bag object', () => {
    const a: StyleProperties = { bold: true, italic: true, alignment: 'right' };
    const b: StyleProperties = { alignment: 'right', italic: true, bold: true };
    expect(canonicalPropertiesString(a)).toBe(canonicalPropertiesString(b));
  });

  it('differs when any single field differs', () => {
    const base: StyleProperties = { bold: true, sizePt: 12 };
    expect(canonicalPropertiesString(base)).not.toBe(canonicalPropertiesString({ bold: false, sizePt: 12 }));
    expect(canonicalPropertiesString(base)).not.toBe(canonicalPropertiesString({ bold: true, sizePt: 14 }));
    expect(canonicalPropertiesString(base)).not.toBe(canonicalPropertiesString({ bold: true }));
  });

  it('treats a field explicitly set to undefined the same as that field being entirely absent, matching StyleProperties\' own optional-field semantics', () => {
    expect(canonicalPropertiesString({})).toBe(canonicalPropertiesString({ bold: undefined }));
  });

  it('never confuses an unset field with one explicitly set to a coincidentally-matching value, since every entry names its own attribute', () => {
    // A bag with only alignment set to "left" must not produce the same string as some unrelated bag whose formatted output for a different field happens to be the literal text "left".
    const withAlignment = canonicalPropertiesString({ alignment: 'left' });
    expect(withAlignment).toBe('fo:text-align=left');
  });

  it('the empty bag produces the empty string', () => {
    expect(canonicalPropertiesString({})).toBe('');
  });
});
