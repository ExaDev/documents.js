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

  // Exercises the full ooxml.js-backed docx read path (readDocx's style cascade) through the layout render and back: a bold, coloured, explicitly-sized run must still read back as bold/coloured/sized after the round trip, not just as plain text. A single word (rather than a phrase) sidesteps the reconstruction pipeline's separately-documented word-spacing-inference quirk, which is unrelated to this migration and not what this test targets.
  it('round-trips a bold, coloured, sized run through docxToPdf then pdfToDocx', () => {
    const editor = createDocx();
    const run = editor.body.appendParagraph().appendRun({ text: 'StyledRun' });
    run.bold = true;
    run.color = { r: 1, g: 0, b: 0 };
    run.sizePt = 24;

    const pdfBytes = docxToPdf(editor.toBytes());
    const docxBytes = pdfToDocx(pdfBytes);
    const roundTripped = openDocx(docxBytes);

    const runs = roundTripped.paragraphs().flatMap((p) => p.runs());
    const text = runs.map((r) => r.text).join(' ');
    expect(text).toContain('StyledRun');
    expect(runs.some((r) => r.bold)).toBe(true);
    expect(runs.some((r) => r.color?.r === 1 && r.color.g === 0 && r.color.b === 0)).toBe(true);
    expect(runs.some((r) => r.sizePt === 24)).toBe(true);
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

  // Confirmed missing by round-tripping a real Keynote-authored pptx with speaker notes through this exact pipeline: notes came back empty. Fixed via a hidden /Subtype /Text PDF annotation (see pdf/write.ts's buildNotesAnnotDict / pdf/read.ts's readPageNotes) -- PDF has no native presenter-notes concept, so this is this package's own round-trip mechanism, not a real PDF feature a third-party PDF would carry.
  it('round-trips speaker notes through pptxToPdf then pdfToPptx', () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.addTextBox({ frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 100 }, text: 'Slide with notes' });
    slide.notes = 'These are the speaker notes for this slide';

    const pdfBytes = pptxToPdf(editor.toBytes());
    const pptxBytes = pdfToPptx(pdfBytes);
    const roundTripped = openPptx(pptxBytes);

    expect(roundTripped.slides()[0]?.notes).toBe('These are the speaker notes for this slide');
  });
});
