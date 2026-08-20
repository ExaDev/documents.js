import { describe, expect, it } from 'vitest';
import { decodeMarkdownText, decodePackage, encodeMarkdownText, markdownToDocx, readDocxContent } from '../../src';

// Proves documents.js's PDF-bypassing paths execute inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only API usage. The functions exercised here -- markdownToDocx (a markdown-codec read -> buildDocxPackage composition that never touches a layout engine or pdf-codec's read/write), encodeMarkdownText/decodeMarkdownText (a TextEncoder/TextDecoder boundary), decodePackage (ooxml.js's OPC zip handling, fflate-backed), and readDocxContent (an ooxml.js readDocx adapter) -- are the PDF-free edge of the package; the PDF pivot itself (pdfToMarkdown through the read-only entry module, markdownToPdf through the full write path) is covered by this directory's own pdf.test.ts. If any exercised path (or its fflate/ooxml.js/markdown-codec dependency) touched node:fs/Buffer/process at module top level, the workerd isolate would throw at import rather than these passing.
describe('documents.js PDF-bypassing paths under the Cloudflare Workers runtime', () => {
  it('encodeMarkdownText/decodeMarkdownText round-trip through TextEncoder/TextDecoder (no Node Buffer)', () => {
    const text = '# Hi\n\nbody';
    expect(decodeMarkdownText(encodeMarkdownText(text))).toBe(text);
  });

  it('markdownToDocx produces non-empty docx bytes from an inline markdown string', () => {
    // A real markdown -> docx bridge: readMarkdownContent (markdown-codec) -> buildDocxPackage, no layout engine, no pdf-codec read/write. The docx is a zip package, so its bytes begin with the OPC/ZIP local-file-header signature PK\x03\x04.
    const markdownBytes = encodeMarkdownText('# Hi\n\nbody\n');
    const docxBytes = markdownToDocx(markdownBytes);
    expect(docxBytes.byteLength).toBeGreaterThan(0);
    expect(docxBytes[0]).toBe(0x50); // 'P'
    expect(docxBytes[1]).toBe(0x4b); // 'K'
  });

  it('the produced docx decodes and reads back as a wordprocessing ContentDocument', () => {
    const markdownBytes = encodeMarkdownText('# Heading\n\nA paragraph with **bold** text.\n');
    const docxBytes = markdownToDocx(markdownBytes);
    const pkg = decodePackage(docxBytes);
    const content = readDocxContent(pkg);
    expect(content.kind).toBe('wordprocessing');
    // The heading + one paragraph survive the markdown -> docx -> ContentDocument round trip into the section's blocks.
    expect(content.sections.length).toBeGreaterThan(0);
    expect(content.sections[0].blocks.length).toBeGreaterThanOrEqual(2);
  });
});
