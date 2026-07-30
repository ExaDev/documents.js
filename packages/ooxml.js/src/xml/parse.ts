import { XMLParser } from 'fast-xml-parser';
import type { Attribute, XmlNode } from '../model/node';

// preserveOrder keeps child order and mixed content; processEntities:false keeps the original entity encoding (e.g. &amp;) so round-trip is faithful, not re-encoded.
const PARSER = new XMLParser({
  preserveOrder: true,
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  textNodeName: '#text',
  cdataPropName: '__cdata',
  commentPropName: '__comment',
  processEntities: false,
  parseTagValue: false,
  trimValues: false,
});

export function parseXml(xml: string): XmlNode[] {
  return parseNodes(PARSER.parse(xml));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Array.isArray narrows unknown to any[], not unknown[] -- lib.es5.d.ts types its parameter as `any`, so TypeScript can't do better even after the check. This guard exists so indexing the result stays unknown rather than silently reintroducing any.
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function asString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(`expected string while parsing XML, got ${typeof value}`);
  }
  return value;
}

function parseNodes(raw: unknown): XmlNode[] {
  if (!isUnknownArray(raw)) {
    throw new Error('fast-xml-parser output was not an ordered array');
  }
  return raw.map(parseNode);
}

function parseNode(raw: unknown): XmlNode {
  if (!isRecord(raw)) {
    throw new Error('fast-xml-parser node was not an object');
  }
  let tagKey: string | undefined;
  for (const key of Object.keys(raw)) {
    if (key !== ':@') {
      if (tagKey !== undefined) {
        throw new Error('XML node had multiple tag keys');
      }
      tagKey = key;
    }
  }
  if (tagKey === undefined) {
    throw new Error('XML node had no tag key');
  }
  const attributes = parseAttributes(raw[':@']);

  if (tagKey === '#text') {
    return { type: 'text', value: asString(raw['#text']) };
  }
  if (tagKey === '__comment') {
    return { type: 'comment', value: scalarText(raw.__comment) };
  }
  if (tagKey === '__cdata') {
    return { type: 'cdata', value: scalarText(raw.__cdata) };
  }
  if (tagKey === '?xml') {
    return { type: 'declaration', attributes };
  }
  if (tagKey.startsWith('?')) {
    return { type: 'pi', target: tagKey.slice(1), content: scalarText(raw[tagKey]) };
  }
  return { type: 'element', tag: tagKey, attributes, children: parseNodes(raw[tagKey]) };
}

function parseAttributes(raw: unknown): Attribute[] {
  if (raw === undefined) {
    return [];
  }
  if (!isRecord(raw)) {
    throw new Error('XML attributes were not an object');
  }
  const attrs: Attribute[] = [];
  for (const key of Object.keys(raw)) {
    if (!key.startsWith('@_')) {
      throw new Error(`unexpected attribute key without @_ prefix: ${key}`);
    }
    attrs.push({ name: key.slice(2), value: asString(raw[key]) });
  }
  return attrs;
}

// Comments, CDATA and PIs wrap their text as [{ '#text': string }].
function scalarText(raw: unknown): string {
  if (!isUnknownArray(raw) || raw.length === 0) {
    throw new Error('expected a scalar-text wrapper array');
  }
  const first = raw[0];
  if (!isRecord(first)) {
    throw new Error('scalar-text wrapper was not an object');
  }
  return asString(first['#text']);
}
