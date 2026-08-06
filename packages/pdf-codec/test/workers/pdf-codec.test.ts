import { describe, expect, it } from 'vitest';
import { readPdf } from '../../src';

// Proves pdf-codec's read path executes inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only APIs. The fixture is built inline rather than read from disk because workerd exposes no node:fs -- and building it from the package's own format rules (object table, classic cross-reference, parenthesised content-stream string) is itself a check that nothing in the construction path needs Node either. If readPdf (or any of its byte-codec/document-schema.js/fflate/zod dependencies) touched a Node-only API, the workerd isolate would throw rather than this passing. This is the runtime complement to attw's static module-resolution check.

// A minimal, structurally ordinary single-page PDF built by literal ASCII concatenation with inline byte-offset tracking -- the same construction idea src/test-support/pdf.ts uses for the node fixtures, reimplemented here so the workerd test stays self-contained and pulls in no test-support code (only the package src barrel). Produces: Catalog -> Pages -> one Page (MediaBox [0 0 200 100]) with a Helvetica /F1 font and a content stream drawing "(Hello)", plus a classic (ISO 32000-1 7.5.4) cross-reference table. Each xref entry is padded to the mandatory fixed 20 bytes.
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

describe('pdf-codec under the Cloudflare Workers runtime', () => {
  it('readPdf parses a minimal single-page PDF inside a workerd isolate (no Node API)', () => {
    const doc = readPdf(minimalClassicXrefPdf());
    expect(doc.pages.length).toBeGreaterThanOrEqual(1);
    // MediaBox [0 0 200 100] -> widthPt 200, heightPt 100, the same mapping the node read suite asserts.
    expect(doc.pages[0]).toMatchObject({ widthPt: 200, heightPt: 100 });
    // The "(Hello)" Tj operand is the one text item recovered from the content stream.
    const textItems = doc.pages[0]!.items.filter((item) => item.kind === 'text');
    expect(textItems[0]).toMatchObject({ kind: 'text', text: 'Hello' });
  });
});
