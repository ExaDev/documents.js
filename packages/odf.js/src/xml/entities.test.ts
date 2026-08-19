import { describe, expect, it } from 'vitest';
import { encodeXmlText, decodeXmlText } from './entities';

describe('encodeXmlText', () => {
  it('encodes all five XML-significant characters', () => {
    expect(encodeXmlText(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });

  it('leaves ordinary text untouched', () => {
    expect(encodeXmlText('Hello world')).toBe('Hello world');
  });
});

describe('decodeXmlText', () => {
  it('decodes all five predefined XML entities', () => {
    expect(decodeXmlText('&amp;&lt;&gt;&quot;&apos;')).toBe(`&<>"'`);
  });

  it('leaves ordinary text untouched', () => {
    expect(decodeXmlText('Hello world')).toBe('Hello world');
  });

  it('round-trips through encodeXmlText then decodeXmlText unchanged', () => {
    const original = `AT&T said "hello" <world> it's <fine>`;
    expect(decodeXmlText(encodeXmlText(original))).toBe(original);
  });

  it('decodes entities embedded inside a longer string, leaving the rest alone', () => {
    expect(decodeXmlText('Ben &amp; Jerry&apos;s')).toBe("Ben & Jerry's");
  });

  it('does not double-decode or mis-decode a literal ampersand that is not part of a recognised entity', () => {
    expect(decodeXmlText('a & b')).toBe('a & b');
    expect(decodeXmlText('a &unknown; b')).toBe('a &unknown; b');
  });
});
