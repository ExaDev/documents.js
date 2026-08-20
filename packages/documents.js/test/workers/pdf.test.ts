import { describe, expect, it } from 'vitest';
import { markdownToPdf } from '../../src';
import { decodeMarkdownText, encodeMarkdownText } from '../../src';
import { pdfToMarkdown } from '../../src/convert/from-pdf';

// Proves documents.js's PDF-pivot conversions execute inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only API usage -- the coverage documents.test.ts deliberately left out when it scoped itself to the PDF-bypassing paths. The read test imports through src/convert/from-pdf.ts, the module behind the package.json `documents.js/read` entry point, so one test proves both that pdfToMarkdown executes in the isolate and that the read-only entry itself works (the entry's graph-width guarantee is held separately by src/read-graph.test.ts). The write test goes through the root barrel on purpose: markdownToPdf runs the full write path -- markdown read, font-registry construction, measurement, the wordprocessing layout engine, and writePdf -- which is exactly the half the read entry excludes. The PDF fixture is built inline (workerd exposes no node:fs), the same literal-construction approach pdf-codec's own workerd suite uses.

// A minimal, structurally ordinary single-page PDF built by literal ASCII concatenation with inline byte-offset tracking (object table, classic ISO 32000-1 7.5.4 cross-reference, a parenthesised content-stream string) -- deliberately NOT produced by this package's own markdownToPdf, so a writer bug cannot cancel out against a reader bug the way a write-then-read fixture can.
function minimalClassicXrefPdf(): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets = new Map<number, number>();
  let length = 0;
  const ascii = (text: string): void => {
    const bytes = enc.encode(text);
    chunks.push(bytes);
    length += bytes.length;
  };
  const rawBytes = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (num: number, body: string): void => {
    offsets.set(num, length);
    ascii(`${num} 0 obj\n${body}\nendobj\n`);
  };
  // `dictWithoutLength` must omit /Length -- it is computed from the stream payload's actual byte length and inserted here, mirroring the real writer's guarantee that /Length can never drift from the bytes that follow.
  const stream = (num: number, dictWithoutLength: string, payload: Uint8Array): void => {
    offsets.set(num, length);
    const dict = dictWithoutLength.replace(/>>\s*$/, ` /Length ${payload.length} >>`);
    ascii(`${num} 0 obj\n${dict}\nstream\n`);
    rawBytes(payload);
    ascii('\nendstream\nendobj\n');
  };

  ascii('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>');
  object(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  stream(5, '<< >>', enc.encode('BT /F1 12 Tf 10 50 Td (Hello) Tj ET'));

  const xrefOffset = length;
  ascii(`xref\n0 6\n`);
  ascii('0000000000 65535 f \n');
  for (let n = 1; n <= 5; n++) {
    ascii(`${offsets.get(n)!.toString().padStart(10, '0')} 00000 n \n`);
  }
  ascii(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  const out = new Uint8Array(length);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

describe('documents.js PDF conversions under the Cloudflare Workers runtime', () => {
  it('pdfToMarkdown (via the read-only entry module) extracts text from a PDF inside a workerd isolate', () => {
    const markdownBytes = pdfToMarkdown(minimalClassicXrefPdf());
    const markdown = decodeMarkdownText(markdownBytes);
    // The single "(Hello)" Tj operand survives the whole read pipeline -- readPdf, reconstructWordprocessing, buildMarkdownText -- as the document's text.
    expect(markdown).toContain('Hello');
  });

  it('markdownToPdf renders a real PDF through the full write path inside a workerd isolate', () => {
    const pdfBytes = markdownToPdf(encodeMarkdownText('# Hi\n\nbody from the workers test\n'));
    expect(new TextDecoder('latin1').decode(pdfBytes.subarray(0, 5))).toBe('%PDF-');
    // A real object graph, not just a header: the file declares its page tree and carries a content stream.
    const raw = new TextDecoder('latin1').decode(pdfBytes);
    expect(raw).toContain('/Type /Catalog');
    expect(raw).toContain('/Type /Page');
    expect(raw).toContain('stream');

    // And the write path's output reads back through the read path in the same isolate.
    const markdown = decodeMarkdownText(pdfToMarkdown(pdfBytes));
    expect(markdown).toContain('body from the workers test');
  });
});
