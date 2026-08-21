import { describe, expect, it } from 'vitest';
import type { XmlElement } from '../../model/node';
import { el, txt } from '../../xml/fragment';
import { getOdfSpaceCount, measureOdfNodeLength, sumOdfNodeLength, decodeOdfText } from './text';

function paragraphOf(...children: XmlElement['children']): XmlElement {
  return el('text:p', {}, children);
}

describe('getOdfSpaceCount', () => {
  it('defaults to 1 when text:c is absent', () => {
    expect(getOdfSpaceCount(el('text:s'))).toBe(1);
  });

  it('parses an explicit text:c', () => {
    expect(getOdfSpaceCount(el('text:s', { 'text:c': '5' }))).toBe(5);
  });

  it('throws for a malformed text:c', () => {
    expect(() => getOdfSpaceCount(el('text:s', { 'text:c': 'not-a-number' }))).toThrow(/malformed/);
  });
});

describe('measureOdfNodeLength / sumOdfNodeLength', () => {
  it('measures a text node by its string length', () => {
    expect(measureOdfNodeLength(txt('abc'))).toBe(3);
  });

  it('measures text:s by its space count, text:tab and text:line-break as exactly 1', () => {
    expect(measureOdfNodeLength(el('text:s', { 'text:c': '4' }))).toBe(4);
    expect(measureOdfNodeLength(el('text:tab'))).toBe(1);
    expect(measureOdfNodeLength(el('text:line-break'))).toBe(1);
  });

  it('measures a text:span recursively as the sum of its own children', () => {
    const span = el('text:span', {}, [txt('ab'), el('text:tab'), txt('c')]);
    expect(measureOdfNodeLength(span)).toBe(4);
  });

  it('measures an inline field recursively as the sum of its own children -- a field displays its cached text', () => {
    const field = el('text:page-number', {}, [txt('12')]);
    expect(measureOdfNodeLength(field)).toBe(2);
  });

  it('measures a comment, CDATA, bookmark, or other zero-width marker element as zero-width', () => {
    expect(measureOdfNodeLength({ type: 'comment', value: 'x' })).toBe(0);
    expect(measureOdfNodeLength({ type: 'cdata', value: 'x' })).toBe(0);
    expect(measureOdfNodeLength(el('text:bookmark'))).toBe(0);
    expect(measureOdfNodeLength(el('text:title'))).toBe(0);
  });

  it('sums a flat node list', () => {
    expect(sumOdfNodeLength([txt('ab'), el('text:s', { 'text:c': '2' }), txt('c')])).toBe(5);
  });
});

describe('decodeOdfText', () => {
  it('decodes plain text-node content verbatim', () => {
    expect(decodeOdfText(paragraphOf(txt('Hello world')))).toBe('Hello world');
  });

  it('expands text:s into its text:c space count, defaulting to 1 when absent', () => {
    expect(decodeOdfText(paragraphOf(txt('a'), el('text:s'), txt('b')))).toBe('a b');
    expect(decodeOdfText(paragraphOf(txt('a'), el('text:s', { 'text:c': '3' }), txt('b')))).toBe('a   b');
  });

  it('decodes text:tab as a literal tab character', () => {
    expect(decodeOdfText(paragraphOf(txt('a'), el('text:tab'), txt('b')))).toBe('a\tb');
  });

  it('decodes text:line-break as a literal newline character', () => {
    expect(decodeOdfText(paragraphOf(txt('a'), el('text:line-break'), txt('b')))).toBe('a\nb');
  });

  it('decodes a text:s immediately adjacent to a text:tab, keeping both distinct', () => {
    const paragraph = paragraphOf(txt('a'), el('text:s', { 'text:c': '2' }), el('text:tab'), txt('b'));
    expect(decodeOdfText(paragraph)).toBe('a  \tb');
  });

  it('recurses into a nested text:span, decoding its children in place', () => {
    const span = el('text:span', { 'text:style-name': 'T1' }, [txt('bold')]);
    expect(decodeOdfText(paragraphOf(txt('a '), span, txt(' b')))).toBe('a bold b');
  });

  it('recurses through multiple levels of nested text:span', () => {
    const inner = el('text:span', { 'text:style-name': 'T2' }, [txt('inner')]);
    const outer = el('text:span', { 'text:style-name': 'T1' }, [txt('outer-before '), inner, txt(' outer-after')]);
    expect(decodeOdfText(paragraphOf(outer))).toBe('outer-before inner outer-after');
  });

  it('decodes a nested span containing its own text:s and text:tab', () => {
    const span = el('text:span', { 'text:style-name': 'T1' }, [txt('a'), el('text:s', { 'text:c': '2' }), el('text:tab'), txt('b')]);
    expect(decodeOdfText(paragraphOf(span))).toBe('a  \tb');
  });

  it('decodes an inline field as its cached text content, exactly as the run model reads it', () => {
    const paragraph = paragraphOf(txt('page '), el('text:page-number', {}, [txt('3')]), txt(' of 10'));
    expect(decodeOdfText(paragraph)).toBe('page 3 of 10');
  });

  it('contributes nothing for a bookmark or other zero-width marker element', () => {
    const paragraph = paragraphOf(txt('a'), el('text:bookmark', { 'text:name': 'mark' }), txt('b'));
    expect(decodeOdfText(paragraph)).toBe('ab');
  });

  it('contributes nothing for a comment or CDATA node', () => {
    const paragraph = el('text:p', {}, [txt('a'), { type: 'comment', value: 'x' }, txt('b')]);
    expect(decodeOdfText(paragraph)).toBe('ab');
  });

  it('decodes XML entities in text-node content -- the lossless model keeps them raw, this projection undoes that', () => {
    expect(decodeOdfText(paragraphOf(txt('AT&amp;T said &quot;hi&quot;')))).toBe('AT&T said "hi"');
  });

  it('returns an empty string for a paragraph with no children', () => {
    expect(decodeOdfText(paragraphOf())).toBe('');
  });

  it('does not silently drop whitespace elements the way a naive text-node-only walk would', () => {
    // The exact regression this module exists to prevent: a paragraph reading "Hello[tab]world[space][space][space]!" must decode with every whitespace unit intact, not collapse to "Helloworld!".
    const paragraph = paragraphOf(txt('Hello'), el('text:tab'), txt('world'), el('text:s', { 'text:c': '3' }), txt('!'));
    expect(decodeOdfText(paragraph)).toBe('Hello\tworld   !');
  });
});
