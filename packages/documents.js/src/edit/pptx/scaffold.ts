import type { Package, XmlNode } from 'ooxml.js';
import { el } from '../../xml/fragment';

const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const PML_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// PowerPoint's default 16:9 widescreen size: 12192000 x 6858000 EMU (960 x 540 pt).
const DEFAULT_SLIDE_WIDTH_EMU = '12192000';
const DEFAULT_SLIDE_HEIGHT_EMU = '6858000';

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

// Builds a minimal but valid, openable pptx package from nothing: [Content_Types].xml, the root relationship to ppt/presentation.xml, a widescreen presentation with an empty p:sldIdLst.
export function createEmptyPptxPackage(): Package {
  const contentTypes = el('Types', { xmlns: CONTENT_TYPES_NS }, [
    el('Default', { Extension: 'rels', ContentType: 'application/vnd.openxmlformats-package.relationships+xml' }),
    el('Default', { Extension: 'xml', ContentType: 'application/xml' }),
    el('Override', {
      PartName: '/ppt/presentation.xml',
      ContentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
    }),
  ]);

  const rootRels = el('Relationships', { xmlns: RELS_NS }, [
    el('Relationship', {
      Id: 'rId1',
      Type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
      Target: 'ppt/presentation.xml',
    }),
  ]);

  const presentation = el('p:presentation', { 'xmlns:p': PML_NS, 'xmlns:r': R_NS }, [
    el('p:sldIdLst'),
    el('p:sldSz', { cx: DEFAULT_SLIDE_WIDTH_EMU, cy: DEFAULT_SLIDE_HEIGHT_EMU }),
  ]);

  const presentationRels = el('Relationships', { xmlns: RELS_NS }, []);

  return {
    parts: {
      '[Content_Types].xml': { kind: 'xml', nodes: [declaration(), contentTypes] },
      '_rels/.rels': { kind: 'xml', nodes: [declaration(), rootRels] },
      'ppt/presentation.xml': { kind: 'xml', nodes: [declaration(), presentation] },
      'ppt/_rels/presentation.xml.rels': { kind: 'xml', nodes: [declaration(), presentationRels] },
    },
  };
}
