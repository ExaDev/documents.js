import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { createDocx, openDocx } from '../edit/docx/editor';
import { openOdg } from '../edit/odg/editor';
import { openOdp } from '../edit/odp/editor';
import { openOdt } from '../edit/odt/editor';
import { createPptx, openPptx } from '../edit/pptx/editor';
import { minimalOdgBytes } from '../test-support/odg';
import { minimalOdpBytes } from '../test-support/odp';
import { minimalOdtBytes } from '../test-support/odt';
import { docxPdfCodec, odgPdfCodec, odpPdfCodec, odtPdfCodec, pptxPdfCodec } from './codec';

function pdfHeader(bytes: Uint8Array<ArrayBuffer>): string {
  return new TextDecoder('latin1').decode(bytes.subarray(0, 5));
}

function buildSampleDocx(text: string): Uint8Array<ArrayBuffer> {
  const editor = createDocx();
  editor.body.appendParagraph().appendRun({ text });
  return editor.toBytes();
}

function buildSamplePptx(text: string): Uint8Array<ArrayBuffer> {
  const editor = createPptx();
  editor.addSlide().addTextBox({ frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 100 }, text });
  return editor.toBytes();
}

describe('docxPdfCodec', () => {
  it('z.decode produces valid PDF bytes from docx bytes', () => {
    const pdfBytes = z.decode(docxPdfCodec, buildSampleDocx('Hello from docx'));
    expect(pdfHeader(pdfBytes)).toBe('%PDF-');
  });

  it('z.encode then z.decode round-trips text content, like docxToPdf/pdfToDocx', () => {
    const pdfBytes = z.decode(docxPdfCodec, buildSampleDocx('Round trip content'));
    const docxBytes = z.encode(docxPdfCodec, pdfBytes);
    const text = openDocx(docxBytes)
      .paragraphs()
      .map((p) => p.text)
      .join(' ');
    expect(text).toContain('Round trip content');
  });

  it('rejects decode input with no ZIP local-file-header before ever reaching docxToPdf', () => {
    expect(() => z.decode(docxPdfCodec, new TextEncoder().encode('not a docx'))).toThrow(z.core.$ZodError);
  });

  it('rejects encode input with no %PDF- header before ever reaching pdfToDocx', () => {
    expect(() => z.encode(docxPdfCodec, new TextEncoder().encode('not a pdf'))).toThrow(z.core.$ZodError);
  });
});

describe('pptxPdfCodec', () => {
  it('z.decode produces valid PDF bytes from pptx bytes', () => {
    const pdfBytes = z.decode(pptxPdfCodec, buildSamplePptx('Hello from pptx'));
    expect(pdfHeader(pdfBytes)).toBe('%PDF-');
  });

  it('z.encode then z.decode round-trips text content, like pptxToPdf/pdfToPptx', () => {
    const pdfBytes = z.decode(pptxPdfCodec, buildSamplePptx('Slide round trip'));
    const pptxBytes = z.encode(pptxPdfCodec, pdfBytes);
    const text = openPptx(pptxBytes)
      .slides()
      .flatMap((s) => s.shapes())
      .map((s) => s.text)
      .join(' ');
    expect(text).toContain('Slide round trip');
  });

  it('rejects decode input with no ZIP local-file-header before ever reaching pptxToPdf', () => {
    expect(() => z.decode(pptxPdfCodec, new TextEncoder().encode('not a pptx'))).toThrow(z.core.$ZodError);
  });
});

describe('odtPdfCodec', () => {
  it('z.decode produces valid PDF bytes from odt bytes', () => {
    const pdfBytes = z.decode(odtPdfCodec, minimalOdtBytes());
    expect(pdfHeader(pdfBytes)).toBe('%PDF-');
  });

  it('z.encode then z.decode round-trips text content, like odtToPdf/pdfToOdt', () => {
    const pdfBytes = z.decode(odtPdfCodec, minimalOdtBytes());
    const odtBytes = z.encode(odtPdfCodec, pdfBytes);
    const text = openOdt(odtBytes)
      .paragraphs()
      .map((p) => p.text)
      .join(' ');
    expect(text).toContain('bold text');
  });

  it('rejects decode input whose first zip entry is not a stored odt mimetype part before ever reaching odtToPdf', () => {
    expect(() => z.decode(odtPdfCodec, new TextEncoder().encode('not an odt'))).toThrow(z.core.$ZodError);
  });

  it('rejects encode input with no %PDF- header before ever reaching pdfToOdt', () => {
    expect(() => z.encode(odtPdfCodec, new TextEncoder().encode('not a pdf'))).toThrow(z.core.$ZodError);
  });
});

describe('odpPdfCodec', () => {
  it('z.decode produces valid PDF bytes from odp bytes', () => {
    const pdfBytes = z.decode(odpPdfCodec, minimalOdpBytes());
    expect(pdfHeader(pdfBytes)).toBe('%PDF-');
  });

  // The fixture's title frame is rotated (see test-support/odp.ts), so reconstructPresentation's word-level fragments are not guaranteed to reconstruct in original reading order -- see convert.test.ts's own pdfToOdp test for the identical reasoning. Checked word-by-word rather than as one phrase.
  it('z.encode then z.decode round-trips text content, like odpToPdf/pdfToOdp', () => {
    const pdfBytes = z.decode(odpPdfCodec, minimalOdpBytes());
    const odpBytes = z.encode(odpPdfCodec, pdfBytes);
    const text = openOdp(odpBytes)
      .slides()
      .flatMap((s) => s.shapes())
      .map((s) => s.text)
      .join(' ');
    expect(text).toContain('Hello');
    expect(text).toContain('odp');
  });

  it('rejects decode input whose first zip entry is not a stored odp mimetype part before ever reaching odpToPdf', () => {
    expect(() => z.decode(odpPdfCodec, new TextEncoder().encode('not an odp'))).toThrow(z.core.$ZodError);
  });

  it('rejects encode input with no %PDF- header before ever reaching pdfToOdp', () => {
    expect(() => z.encode(odpPdfCodec, new TextEncoder().encode('not a pdf'))).toThrow(z.core.$ZodError);
  });
});

describe('odgPdfCodec', () => {
  it('z.decode produces valid PDF bytes from odg bytes', () => {
    const pdfBytes = z.decode(odgPdfCodec, minimalOdgBytes());
    expect(pdfHeader(pdfBytes)).toBe('%PDF-');
  });

  it('z.encode then z.decode round-trips the drawing\'s text label, like odgToPdf/pdfToOdg', () => {
    const pdfBytes = z.decode(odgPdfCodec, minimalOdgBytes());
    const odgBytes = z.encode(odgPdfCodec, pdfBytes);
    const text = openOdg(odgBytes)
      .pages()
      .flatMap((p) => p.shapes())
      .map((s) => s.text)
      .join(' ');
    expect(text).toContain('Label');
  });

  it('rejects decode input whose first zip entry is not a stored odg mimetype part before ever reaching odgToPdf', () => {
    expect(() => z.decode(odgPdfCodec, new TextEncoder().encode('not an odg'))).toThrow(z.core.$ZodError);
  });

  it('rejects encode input with no %PDF- header before ever reaching pdfToOdg', () => {
    expect(() => z.encode(odgPdfCodec, new TextEncoder().encode('not a pdf'))).toThrow(z.core.$ZodError);
  });
});
