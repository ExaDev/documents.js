import type { Package, XmlNode } from 'ooxml.js';
import { el } from '../../xml/fragment';

const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WORDML_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function declaration(): XmlNode {
  return {
    type: 'declaration',
    attributes: [
      { name: 'version', value: '1.0' },
      { name: 'encoding', value: 'UTF-8' },
      { name: 'standalone', value: 'yes' },
    ],
  };
}

// Builds a minimal but valid, openable docx package from nothing: [Content_Types].xml, the root relationship to word/document.xml, an empty body with a default US-Letter section, and a styles part with just the mandatory default Normal paragraph style.
export function createEmptyDocxPackage(): Package {
  const contentTypes = el('Types', { xmlns: CONTENT_TYPES_NS }, [
    el('Default', { Extension: 'rels', ContentType: 'application/vnd.openxmlformats-package.relationships+xml' }),
    el('Default', { Extension: 'xml', ContentType: 'application/xml' }),
    el('Override', {
      PartName: '/word/document.xml',
      ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }),
    el('Override', {
      PartName: '/word/styles.xml',
      ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
    }),
  ]);

  const rootRels = el('Relationships', { xmlns: RELS_NS }, [
    el('Relationship', {
      Id: 'rId1',
      Type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
      Target: 'word/document.xml',
    }),
  ]);

  const documentRels = el('Relationships', { xmlns: RELS_NS }, [
    el('Relationship', {
      Id: 'rId1',
      Type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
      Target: 'styles.xml',
    }),
  ]);

  const sectPr = el('w:sectPr', {}, [
    el('w:pgSz', { 'w:w': '12240', 'w:h': '15840' }),
    el('w:pgMar', {
      'w:top': '1440',
      'w:right': '1440',
      'w:bottom': '1440',
      'w:left': '1440',
      'w:header': '720',
      'w:footer': '720',
      'w:gutter': '0',
    }),
  ]);
  const document = el('w:document', { 'xmlns:w': WORDML_NS }, [el('w:body', {}, [sectPr])]);

  const styles = el('w:styles', { 'xmlns:w': WORDML_NS }, [
    el('w:style', { 'w:type': 'paragraph', 'w:default': '1', 'w:styleId': 'Normal' }, [
      el('w:name', { 'w:val': 'Normal' }),
    ]),
  ]);

  return {
    parts: {
      '[Content_Types].xml': { kind: 'xml', nodes: [declaration(), contentTypes] },
      '_rels/.rels': { kind: 'xml', nodes: [declaration(), rootRels] },
      'word/document.xml': { kind: 'xml', nodes: [declaration(), document] },
      'word/_rels/document.xml.rels': { kind: 'xml', nodes: [declaration(), documentRels] },
      'word/styles.xml': { kind: 'xml', nodes: [declaration(), styles] },
    },
  };
}
