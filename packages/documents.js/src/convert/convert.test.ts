import { describe, expect, it } from 'vitest';
import { createDocx, openDocx } from '../edit/docx/editor';
import { openOdt } from '../edit/odt/editor';
import { createPptx, openPptx } from '../edit/pptx/editor';
import { readPdf } from '../pdf/read';
import { minimalOdtBytes } from '../test-support/odt';
import { docxToPdf, odtToPdf, pdfToDocx, pdfToOdt, pdfToPptx, pptxToPdf } from './convert';

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

describe('odtToPdf', () => {
  // Proves the whole architectural point: an odt package, decoded via odf.js's own decodePackage (not ooxml.js's) and read via readOdtContent, feeds convertWordprocessingToLayout completely unmodified -- the identical engine docxToPdf feeds -- and comes out as a genuine, non-empty PDF page.
  it('produces valid PDF bytes with non-empty page content from an odt heading, paragraph, and table', () => {
    const pdfBytes = odtToPdf(minimalOdtBytes());
    expect(pdfHeader(pdfBytes)).toBe('%PDF-');

    const layout = readPdf(pdfBytes);
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]?.items.length).toBeGreaterThan(0);
    const text = layout.pages[0]?.items.filter((item) => item.kind === 'text').map((item) => item.text).join(' ');
    expect(text).toContain('Hello from odt');
    expect(text).toContain('bold text');
    expect(text).toContain('A1');
  });

  it('throws when the signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => odtToPdf(minimalOdtBytes(), { signal: controller.signal })).toThrow();
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

describe('pdfToOdt', () => {
  it('round-trips text content through odtToPdf then pdfToOdt', () => {
    const pdfBytes = odtToPdf(minimalOdtBytes());
    const odtBytes = pdfToOdt(pdfBytes);
    const editor = openOdt(odtBytes);
    const text = editor
      .paragraphs()
      .map((p) => p.text)
      .join(' ');
    expect(text).toContain('bold text');
  });

  // Mirrors pdfToDocx's own equivalent test: exercises the full pipeline (readPdf -> reconstructWordprocessing, entirely unmodified -- the same architectural bet odtToPdf's own build already proved -- -> buildOdtPackage) through a fresh, hand-built odt rather than the minimalOdtBytes fixture, so a bold/coloured/sized run really is recovered from PDF geometry, not merely carried through unchanged.
  it('round-trips a bold, coloured, sized run through docxToPdf then pdfToOdt', () => {
    const docxEditor = createDocx();
    const run = docxEditor.body.appendParagraph().appendRun({ text: 'StyledRun' });
    run.bold = true;
    run.color = { r: 1, g: 0, b: 0 };
    run.sizePt = 24;

    const pdfBytes = docxToPdf(docxEditor.toBytes());
    const odtBytes = pdfToOdt(pdfBytes);
    const roundTripped = openOdt(odtBytes);

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
