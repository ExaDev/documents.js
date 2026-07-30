import { describe, expect, it } from 'vitest';
import { createDocx, openDocx } from '../edit/docx/editor';
import { createPptx, openPptx } from '../edit/pptx/editor';
import { docxToPdf, pdfToDocx, pdfToPptx, pptxToPdf } from './convert';

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

describe('docxToPdf', () => {
  it('produces valid PDF bytes from a docx paragraph', () => {
    const pdfBytes = docxToPdf(buildSampleDocx('Hello from docx'));
    expect(pdfHeader(pdfBytes)).toBe('%PDF-');
  });

  it('throws when the signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => docxToPdf(buildSampleDocx('X'), { signal: controller.signal })).toThrow();
  });
});

describe('pptxToPdf', () => {
  it('produces valid PDF bytes from a pptx text box', () => {
    const pdfBytes = pptxToPdf(buildSamplePptx('Hello from pptx'));
    expect(pdfHeader(pdfBytes)).toBe('%PDF-');
  });
});

describe('pdfToDocx', () => {
  it('round-trips text content through docxToPdf then pdfToDocx', () => {
    const pdfBytes = docxToPdf(buildSampleDocx('Round trip content'));
    const docxBytes = pdfToDocx(pdfBytes);
    const editor = openDocx(docxBytes);
    const text = editor
      .paragraphs()
      .map((p) => p.text)
      .join(' ');
    expect(text).toContain('Round trip content');
  });
});

describe('pdfToPptx', () => {
  it('round-trips text content through pptxToPdf then pdfToPptx', () => {
    const pdfBytes = pptxToPdf(buildSamplePptx('Slide round trip'));
    const pptxBytes = pdfToPptx(pdfBytes);
    const editor = openPptx(pptxBytes);
    const text = editor
      .slides()
      .flatMap((s) => s.shapes())
      .map((s) => s.text)
      .join(' ');
    expect(text).toContain('Slide round trip');
  });
});
