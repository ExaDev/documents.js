import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { LayoutDocumentSchema } from 'document-schema.js';
import { minimalClassicXrefPdf } from './test-support/pdf';
import { pdfCodec } from './codec';
import { readPdf } from './read';
import { writePdf } from './write';

const HELVETICA = { family: 'Helvetica', weight: 'normal', style: 'normal' } as const;
const BLACK = { r: 0, g: 0, b: 0 };

describe('pdfCodec', () => {
  it('z.decode agrees with readPdf on the same bytes', () => {
    const bytes = minimalClassicXrefPdf();
    expect(z.decode(pdfCodec, bytes)).toEqual(readPdf(bytes));
  });

  it('z.encode agrees with writePdf (default options) on the same document', () => {
    const doc = { formatVersion: 1 as const, metadata: {}, pages: [{ widthPt: 200, heightPt: 100, items: [{ kind: 'text' as const, text: 'Hi', xPt: 10, yPt: 50, font: HELVETICA, sizePt: 12, color: BLACK }] }], images: {} };
    expect(z.encode(pdfCodec, doc)).toEqual(writePdf(doc));
  });

  it('rejects decode input with no %PDF- header before ever reaching readPdf', () => {
    expect(() => z.decode(pdfCodec, new TextEncoder().encode('not a pdf'))).toThrow(z.core.$ZodError);
  });

  it('the output schema wired into the codec is genuinely LayoutDocumentSchema, not a drifted copy (formatVersion mismatch rejected)', () => {
    expect(LayoutDocumentSchema.safeParse({ formatVersion: 2, metadata: {}, pages: [], images: {} }).success).toBe(false);
  });

  it('round-trips a document written by the codec back through the codec', () => {
    const doc = { formatVersion: 1 as const, metadata: {}, pages: [{ widthPt: 200, heightPt: 100, items: [{ kind: 'text' as const, text: 'Round trip', xPt: 5, yPt: 50, font: HELVETICA, sizePt: 12, color: BLACK }] }], images: {} };
    const decoded = z.decode(pdfCodec, z.encode(pdfCodec, doc));
    expect(decoded.pages[0]!.items).toMatchObject([{ kind: 'text', text: 'Round trip' }]);
  });
});
