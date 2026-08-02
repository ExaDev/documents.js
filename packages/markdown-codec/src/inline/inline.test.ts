// AST-level tests for the inline phase. These assert the NODE SHAPE parseInlines produces, which the CommonMark conformance suite (src/inline/conformance.test.ts) cannot: that suite compares rendered HTML, so it is blind to everything the AST records for the write side's benefit but HTML discards -- which of `*`/`_` an emphasis was written with, an entity's original source spelling, an autolink's email flag. It is also where GFM's own extensions are covered, since the CommonMark corpus by definition does not test them.

import { describe, expect, it } from 'vitest';
import type { MarkdownInlineNode } from '../ast/ast';
import { parseInlines } from './inline';
import type { LinkReferenceDefinition, LinkReferenceMap } from './link';

const NO_REFERENCES: LinkReferenceMap = new Map<string, LinkReferenceDefinition>();
const COMMONMARK_ONLY = { gfmAutolinks: false, gfmStrikethrough: false };

function parse(source: string, references: LinkReferenceMap = NO_REFERENCES): MarkdownInlineNode[] {
  return parseInlines(source, references, COMMONMARK_ONLY);
}

describe('text, escapes, and character references', () => {
  it('merges an escape into the surrounding run so plain text arrives as one node', () => {
    expect(parse('a\\*b')).toEqual([{ type: 'text', value: 'a*b' }]);
  });

  it('leaves a backslash before a non-punctuation character literal', () => {
    expect(parse('\\a')).toEqual([{ type: 'text', value: '\\a' }]);
  });

  it('keeps a character reference as its own node, recording both the source spelling and the decoded value', () => {
    expect(parse('&amp;')).toEqual([{ type: 'entity', raw: '&amp;', value: '&' }]);
    expect(parse('&#x41;')).toEqual([{ type: 'entity', raw: '&#x41;', value: 'A' }]);
  });

  it('decodes a disallowed numeric reference to the replacement character rather than failing', () => {
    expect(parse('&#0;')).toEqual([{ type: 'entity', raw: '&#0;', value: '�' }]);
  });

  it('leaves an unrecognised entity name as literal text', () => {
    expect(parse('&nope;')).toEqual([{ type: 'text', value: '&nope;' }]);
  });
});

describe('code spans', () => {
  it('closes only on a backtick run of exactly the opening length', () => {
    expect(parse('``a ` b``')).toEqual([{ type: 'codeSpan', literal: 'a ` b' }]);
  });

  it('strips a single surrounding space and converts line endings to spaces', () => {
    expect(parse('` a\nb `')).toEqual([{ type: 'codeSpan', literal: 'a b' }]);
  });

  it('treats an unclosed opening run as literal text', () => {
    expect(parse('`foo')).toEqual([{ type: 'text', value: '`foo' }]);
  });
});

describe('emphasis, strong emphasis, and the flanking rules', () => {
  it('records which marker character produced the emphasis', () => {
    expect(parse('_foo_')).toEqual([{ type: 'emphasis', marker: '_', children: [{ type: 'text', value: 'foo' }] }]);
    expect(parse('*foo*')).toEqual([{ type: 'emphasis', marker: '*', children: [{ type: 'text', value: 'foo' }] }]);
  });

  it('produces strong emphasis from a two-delimiter run', () => {
    expect(parse('**foo**')).toEqual([{ type: 'strong', marker: '*', children: [{ type: 'text', value: 'foo' }] }]);
  });

  it('allows intraword emphasis with `*` but not with `_`', () => {
    expect(parse('foo*bar*baz')).toEqual([
      { type: 'text', value: 'foo' },
      { type: 'emphasis', marker: '*', children: [{ type: 'text', value: 'bar' }] },
      { type: 'text', value: 'baz' },
    ]);
    expect(parse('foo_bar_baz')).toEqual([{ type: 'text', value: 'foo_bar_baz' }]);
  });

  it('nests strong inside emphasis for a three-delimiter run', () => {
    expect(parse('***foo***')).toEqual([
      { type: 'emphasis', marker: '*', children: [{ type: 'strong', marker: '*', children: [{ type: 'text', value: 'foo' }] }] },
    ]);
  });

  it('leaves an unmatched delimiter run as literal text', () => {
    expect(parse('*foo')).toEqual([{ type: 'text', value: '*foo' }]);
  });
});

describe('links and images', () => {
  it('parses an inline link with a title', () => {
    expect(parse('[a](/url "t")')).toEqual([{ type: 'link', destination: '/url', title: 't', children: [{ type: 'text', value: 'a' }] }]);
  });

  it('omits the title field entirely when the link has none', () => {
    expect(parse('[a](/url)')).toEqual([{ type: 'link', destination: '/url', children: [{ type: 'text', value: 'a' }] }]);
  });

  it('resolves full, collapsed, and shortcut references against the table handed in', () => {
    const references: LinkReferenceMap = new Map([['FOO', { destination: '/url', title: 'title' }]]);
    const expected = [{ type: 'link', destination: '/url', title: 'title', children: [{ type: 'text', value: 'foo' }] }];
    expect(parse('[foo][foo]', references)).toEqual(expected);
    expect(parse('[foo][]', references)).toEqual(expected);
    expect(parse('[foo]', references)).toEqual(expected);
  });

  it('matches a reference label case-insensitively and with internal whitespace collapsed', () => {
    const references: LinkReferenceMap = new Map([['FOO BAR', { destination: '/url' }]]);
    expect(parse('[Foo\n  Bar]', references)).toEqual([{ type: 'link', destination: '/url', children: [{ type: 'text', value: 'Foo' }, { type: 'softBreak' }, { type: 'text', value: 'Bar' }] }]);
  });

  it('leaves an unresolvable reference as literal text', () => {
    expect(parse('[foo]')).toEqual([{ type: 'text', value: '[foo]' }]);
  });

  it('flattens an image description to plain text rather than keeping inline children', () => {
    expect(parse('![a *b* `c`](/url)')).toEqual([{ type: 'image', destination: '/url', alt: 'a b c' }]);
  });

  it('forbids a link inside a link while allowing an image inside one', () => {
    const references: LinkReferenceMap = new Map([['INNER', { destination: '/inner' }]]);
    expect(parse('[outer [inner](/i)](/o)', references)).toEqual([
      { type: 'text', value: '[outer ' },
      { type: 'link', destination: '/i', children: [{ type: 'text', value: 'inner' }] },
      { type: 'text', value: '](/o)' },
    ]);
    expect(parse('[outer ![inner](/i)](/o)')).toEqual([
      { type: 'link', destination: '/o', children: [{ type: 'text', value: 'outer ' }, { type: 'image', destination: '/i', alt: 'inner' }] },
    ]);
  });

  it('resolves backslash escapes and character references inside a destination and title', () => {
    expect(parse('[a](/f\\(o\\)o "b&amp;r")')).toEqual([{ type: 'link', destination: '/f(o)o', title: 'b&r', children: [{ type: 'text', value: 'a' }] }]);
  });
});

describe('autolinks and raw HTML', () => {
  it('parses a URI autolink verbatim', () => {
    expect(parse('<https://a.example/b?c=d&e>')).toEqual([{ type: 'autolink', destination: 'https://a.example/b?c=d&e', email: false }]);
  });

  it('flags an email autolink', () => {
    expect(parse('<foo@bar.example.com>')).toEqual([{ type: 'autolink', destination: 'foo@bar.example.com', email: true }]);
  });

  it('keeps a raw inline HTML tag as its literal source text', () => {
    expect(parse('<span class="x">')).toEqual([{ type: 'rawHtml', literal: '<span class="x">' }]);
  });

  it('treats a `<` that starts neither an autolink nor a tag as ordinary text', () => {
    expect(parse('a < b')).toEqual([{ type: 'text', value: 'a < b' }]);
  });
});

describe('line breaks', () => {
  it('produces a hard break from two or more trailing spaces, dropping the spaces', () => {
    expect(parse('a  \nb')).toEqual([{ type: 'text', value: 'a' }, { type: 'hardBreak' }, { type: 'text', value: 'b' }]);
  });

  it('produces a hard break from a trailing backslash', () => {
    expect(parse('a\\\nb')).toEqual([{ type: 'text', value: 'a' }, { type: 'hardBreak' }, { type: 'text', value: 'b' }]);
  });

  it('produces a soft break from a bare line ending, dropping one trailing space', () => {
    expect(parse('a \nb')).toEqual([{ type: 'text', value: 'a' }, { type: 'softBreak' }, { type: 'text', value: 'b' }]);
  });
});

describe('GFM strikethrough', () => {
  it('matches one or two tildes through the shared delimiter stack', () => {
    expect(parseInlines('~~a~~', NO_REFERENCES)).toEqual([{ type: 'strikethrough', children: [{ type: 'text', value: 'a' }] }]);
    expect(parseInlines('~a~', NO_REFERENCES)).toEqual([{ type: 'strikethrough', children: [{ type: 'text', value: 'a' }] }]);
  });

  it('requires the opening and closing runs to be the same length', () => {
    expect(parseInlines('~~a~', NO_REFERENCES)).toEqual([{ type: 'text', value: '~~a~' }]);
  });

  it('treats a run of three or more tildes as literal text', () => {
    expect(parseInlines('~~~a~~~', NO_REFERENCES)).toEqual([{ type: 'text', value: '~~~a~~~' }]);
  });

  it('leaves every tilde literal when the extension is disabled', () => {
    expect(parse('~~a~~')).toEqual([{ type: 'text', value: '~~a~~' }]);
  });

  it('resolves emphasis nested inside strikethrough', () => {
    expect(parseInlines('~~*a*~~', NO_REFERENCES)).toEqual([
      { type: 'strikethrough', children: [{ type: 'emphasis', marker: '*', children: [{ type: 'text', value: 'a' }] }] },
    ]);
  });
});

describe('GFM extended autolinks', () => {
  it('links a www-prefixed run, prepending the scheme to the destination only', () => {
    expect(parseInlines('see www.example.com now', NO_REFERENCES)).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', destination: 'http://www.example.com', children: [{ type: 'text', value: 'www.example.com' }] },
      { type: 'text', value: ' now' },
    ]);
  });

  it('links a bare http(s) run', () => {
    expect(parseInlines('https://example.com/a', NO_REFERENCES)).toEqual([
      { type: 'link', destination: 'https://example.com/a', children: [{ type: 'text', value: 'https://example.com/a' }] },
    ]);
  });

  it('trims trailing punctuation and an unbalanced closing parenthesis', () => {
    expect(parseInlines('(https://example.com/a).', NO_REFERENCES)).toEqual([
      { type: 'text', value: '(' },
      { type: 'link', destination: 'https://example.com/a', children: [{ type: 'text', value: 'https://example.com/a' }] },
      { type: 'text', value: ').' },
    ]);
  });

  it('links a bare email address through a mailto: destination', () => {
    expect(parseInlines('mail me@example.com', NO_REFERENCES)).toEqual([
      { type: 'text', value: 'mail ' },
      { type: 'link', destination: 'mailto:me@example.com', children: [{ type: 'text', value: 'me@example.com' }] },
    ]);
  });

  it('rejects a domain with no dot', () => {
    expect(parseInlines('www.example', NO_REFERENCES)).toEqual([{ type: 'text', value: 'www.example' }]);
  });

  it('never creates an autolink inside an existing link or code span', () => {
    expect(parseInlines('[www.example.com](/u)', NO_REFERENCES)).toEqual([
      { type: 'link', destination: '/u', children: [{ type: 'text', value: 'www.example.com' }] },
    ]);
    expect(parseInlines('`www.example.com`', NO_REFERENCES)).toEqual([{ type: 'codeSpan', literal: 'www.example.com' }]);
  });

  it('leaves a bare URL as plain text when the extension is disabled', () => {
    expect(parse('www.example.com')).toEqual([{ type: 'text', value: 'www.example.com' }]);
  });
});
