import type { Package } from '../../model/package';
import type { XmlElement } from '../../model/node';
import { describe, expect, it } from 'vitest';
import { el, txt } from '../../xml/fragment';
import { readCoreProperties } from './metadata';

// Ported verbatim from documents.js's src/ooxml/core-properties.test.ts.

function packageWith(core: XmlElement | undefined, app: XmlElement | undefined): Package {
  const parts: Package['parts'] = {};
  if (core !== undefined) {
    parts['docProps/core.xml'] = { kind: 'xml', nodes: [core] };
  }
  if (app !== undefined) {
    parts['docProps/app.xml'] = { kind: 'xml', nodes: [app] };
  }
  return { parts };
}

describe('readCoreProperties', () => {
  it('reads title, subject, author, keywords, and dates from docProps/core.xml', () => {
    const core = el('cp:coreProperties', {}, [
      el('dc:title', {}, [txt('Quarterly Report')]),
      el('dc:subject', {}, [txt('Q3 Results')]),
      el('dc:creator', {}, [txt('Jane Doe')]),
      el('cp:keywords', {}, [txt('finance, quarterly, results')]),
      el('dcterms:created', {}, [txt('2024-01-01T00:00:00Z')]),
      el('dcterms:modified', {}, [txt('2024-02-01T00:00:00Z')]),
    ]);
    const metadata = readCoreProperties(packageWith(core, undefined));
    expect(metadata.title).toBe('Quarterly Report');
    expect(metadata.subject).toBe('Q3 Results');
    expect(metadata.author).toBe('Jane Doe');
    expect(metadata.keywords).toEqual(['finance', 'quarterly', 'results']);
    expect(metadata.createdIso).toBe('2024-01-01T00:00:00Z');
    expect(metadata.modifiedIso).toBe('2024-02-01T00:00:00Z');
  });

  it('reads the originating application from docProps/app.xml into `creator`, distinct from dc:creator', () => {
    const core = el('cp:coreProperties', {}, [el('dc:creator', {}, [txt('Jane Doe')])]);
    const app = el('Properties', {}, [el('Application', {}, [txt('Microsoft Office PowerPoint')])]);
    const metadata = readCoreProperties(packageWith(core, app));
    expect(metadata.author).toBe('Jane Doe');
    expect(metadata.creator).toBe('Microsoft Office PowerPoint');
  });

  it('leaves fields undefined when the source parts or elements are missing, and never sets producer', () => {
    const metadata = readCoreProperties(packageWith(undefined, undefined));
    expect(metadata.title).toBeUndefined();
    expect(metadata.author).toBeUndefined();
    expect(metadata.creator).toBeUndefined();
    expect(metadata.keywords).toBeUndefined();
    expect('producer' in metadata).toBe(false);
  });

  it('treats an empty keywords element as no keywords rather than an array with one blank entry', () => {
    const core = el('cp:coreProperties', {}, [el('cp:keywords')]);
    const metadata = readCoreProperties(packageWith(core, undefined));
    expect(metadata.keywords).toBeUndefined();
  });
});
