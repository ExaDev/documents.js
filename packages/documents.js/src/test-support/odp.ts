import type { Package } from 'odf.js';
import { bytesToBase64, decodePackage, el, encodePackage, ODF_MEDIA_TYPES, txt } from 'odf.js';
import { encodePng } from 'byte-codec';

// Never imported by src/index.ts and never reaches dist/. Mirrors src/test-support/odt.ts's own reasoning: hand-authored ODF XML assembled via odf.js's own el/txt fragment builders and serialized via odf.js's own encodePackage, never via this package's own createEmptyOdpPackage (src/edit/odp/scaffold.ts) or createOdp, so a bug in that scaffold/editor cannot hide behind a fixture built with the same code. Shape choices mirror odf.js's own src/typed/odp/read.test.ts fixture -- multiple draw:page elements, a rotated frame, a grouped pair of shapes, an image, a table, and speaker notes -- the same real-shape ground truth that fixture verified against genuine LibreOffice 26.2 output.

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

// A genuine, decodable 2x2 PNG (not just the bare magic-number stub some other tests use), since this fixture's image needs to survive all the way through writePdf's own image-embedding path, not merely readOdpContent's read-time format sniffing.
function tinyPngBase64(): string {
  const bytes = encodePng({ width: 2, height: 2, channels: 3, data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]) });
  return bytesToBase64(bytes);
}

function stylesXmlPart(): Package['parts'][string] {
  return {
    kind: 'xml',
    nodes: [
      el('office:document-styles', {}, [
        el('office:automatic-styles', {}, [el('style:page-layout', { 'style:name': 'PM1' }, [el('style:page-layout-properties', { 'fo:page-width': '720pt', 'fo:page-height': '540pt' })])]),
        el('office:master-styles', {}, [el('style:master-page', { 'style:name': 'Default', 'style:page-layout-name': 'PM1' })]),
      ]),
    ],
  };
}

// Slide 1: a rotated title frame with real text, a grouped pair of shapes, and speaker notes. Slide 2: an image and a table, no notes -- exercising the same shape variety (rotation, grouping, image, table, notes) odf.js's own odp-reader fixture already verified against genuine LibreOffice output, just re-assembled here so odpToPdf's own tests can drive it all the way through to PDF bytes.
function buildFixturePackage(): Package {
  const titleFrame = el('draw:frame', { 'draw:name': 'Title', 'svg:width': '200pt', 'svg:height': '60pt', 'draw:transform': 'rotate(0.5235987755982988) translate(50pt 50pt)' }, [
    el('draw:text-box', {}, [el('text:p', {}, [txt('Hello from odp')])]),
  ]);
  const groupShapeA = el('draw:frame', { 'draw:name': 'A', 'svg:x': '50pt', 'svg:y': '150pt', 'svg:width': '80pt', 'svg:height': '40pt' }, [el('draw:text-box', {}, [el('text:p', {}, [txt('Grouped A')])])]);
  const groupShapeB = el('draw:frame', { 'draw:name': 'B', 'svg:x': '150pt', 'svg:y': '150pt', 'svg:width': '80pt', 'svg:height': '40pt' }, [el('draw:text-box', {}, [el('text:p', {}, [txt('Grouped B')])])]);
  const group = el('draw:g', {}, [groupShapeA, groupShapeB]);
  const notes = el('presentation:notes', {}, [
    el('draw:frame', { 'svg:x': '20pt', 'svg:y': '400pt', 'svg:width': '300pt', 'svg:height': '100pt' }, [el('draw:text-box', {}, [el('text:p', {}, [txt('Speaker notes for slide one.')])])]),
  ]);
  const slide1 = el('draw:page', { 'draw:name': 'Slide1', 'draw:master-page-name': 'Default' }, [titleFrame, group, notes]);

  const imageFrame = el('draw:frame', { 'svg:x': '400pt', 'svg:y': '50pt', 'svg:width': '60pt', 'svg:height': '60pt' }, [el('draw:image', { 'xlink:href': 'Pictures/img1.png' })]);
  const table = el('table:table', {}, [
    el('table:table-column'),
    el('table:table-column'),
    el('table:table-row', {}, [el('table:table-cell', {}, [el('text:p', {}, [txt('A1')])]), el('table:table-cell', {}, [el('text:p', {}, [txt('B1')])])]),
  ]);
  const tableFrame = el('draw:frame', { 'svg:x': '50pt', 'svg:y': '200pt', 'svg:width': '300pt', 'svg:height': '100pt' }, [table]);
  const slide2 = el('draw:page', { 'draw:name': 'Slide2', 'draw:master-page-name': 'Default' }, [imageFrame, tableFrame]);

  const contentXml: Package['parts'][string] = {
    kind: 'xml',
    nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:presentation', {}, [slide1, slide2])])])],
  };

  const metaXml: Package['parts'][string] = {
    kind: 'xml',
    nodes: [el('office:document-meta', {}, [el('office:meta', {}, [el('dc:title', {}, [txt('My Presentation')])])])],
  };

  return {
    parts: {
      mimetype: { kind: 'binary', base64: bytesToBase64(enc(ODF_MEDIA_TYPES.odp)) },
      'content.xml': contentXml,
      'styles.xml': stylesXmlPart(),
      'meta.xml': metaXml,
      'Pictures/img1.png': { kind: 'binary', base64: tinyPngBase64() },
    },
  };
}

// A minimal but structurally authentic odp package (mimetype part first and stored, a real office:document-content with two slides, a rotated frame, a grouped pair of shapes, an image, a table, and speaker notes) -- enough to round-trip through decodePackage and readOdpContent without needing a real LibreOffice-exported binary.
export function minimalOdpBytes(): Uint8Array<ArrayBuffer> {
  return encodePackage(buildFixturePackage());
}

// The decoded-Package counterpart to minimalOdpBytes above, mirroring src/test-support/odt.ts's own minimalOdtPackage -- used by src/edit/odp/editor.test.ts's live-view fidelity tests (openOdp(minimalOdpBytes()) against this same fixture, decoded independently) to snapshot "before" state without going through the editor at all.
export function minimalOdpPackage(): Package {
  return decodePackage(minimalOdpBytes());
}
