import { describe, expect, it } from 'vitest';
import { decodePackage, readOdt, zipPackage, type ZipEntry } from '../../src';

// Proves odf.js's ODF package parsing and content reading execute inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only APIs. The pipeline exercised -- zipPackage (fflate, pure JS), decodePackage (zip + manifest parse), readOdt (fast-xml-parser over content.xml, pure JS) -- is deliberately Node-free; if any path touched node:fs/Buffer/process the workerd isolate would throw instead of these passing. The minimal .odt is built INLINE (no fs): an ODF package is a zip whose first entry must be the uncompressed "mimetype" part, followed by content.xml and META-INF/manifest.xml, mirroring the inline fixture shape src/round-trip.test.ts already uses.
describe('odf.js under the Cloudflare Workers runtime', () => {
  it('decodes a minimal odt and reads its wordprocessing content (no Node fs, no Buffer)', () => {
    const encoder = new TextEncoder();
    const mimetype = 'application/vnd.oasis.opendocument.text';
    const contentXml = encoder.encode(
      '<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>Hello &amp; world</text:p></office:text></office:body></office:document-content>',
    );
    const manifestXml = encoder.encode(
      '<?xml version="1.0" encoding="UTF-8"?>\n<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>',
    );
    const entries: [string, ZipEntry][] = [
      ['mimetype', { bytes: encoder.encode(mimetype), stored: true }],
      ['content.xml', { bytes: contentXml }],
      ['META-INF/manifest.xml', { bytes: manifestXml }],
    ];

    const pkg = decodePackage(zipPackage(entries));
    const document = readOdt(pkg);

    // readOdt returns the same { metadata, sections } shape documents.js's readOdtContent adapter wraps into a 'wordprocessing' ContentDocument. The single text:p round-trips as one paragraph block whose run text is the XML-decoded content.
    expect(document.sections).toHaveLength(1);
    const blocks = document.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('paragraph');
    const paragraph = blocks[0];
    if (paragraph?.kind === 'paragraph') {
      expect(paragraph.runs.map((run) => run.text).join('')).toBe('Hello & world');
    }
  });
});
