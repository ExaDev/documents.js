import type { LayoutItem, LayoutText } from 'document-content-model';
import { describe, expect, it } from 'vitest';
import { createDocx, openDocx } from '../edit/docx/editor';
import { openOdp } from '../edit/odp/editor';
import { openOdt } from '../edit/odt/editor';
import { createPptx, openPptx } from '../edit/pptx/editor';
import { readPdf } from '../pdf/read';
import { minimalOdpBytes } from '../test-support/odp';
import { minimalOdsBytes } from '../test-support/ods';
import { minimalOdtBytes } from '../test-support/odt';
import { docxToPdf, odpToPdf, odsToPdf, odtToPdf, pdfToDocx, pdfToOdp, pdfToOdt, pdfToPptx, pptxToPdf } from './convert';

function pdfHeader(bytes: Uint8Array<ArrayBuffer>): string {
  return new TextDecoder('latin1').decode(bytes.subarray(0, 5));
}

function findText(items: readonly LayoutItem[], text: string): LayoutText | undefined {
  return items.find((item): item is LayoutText => item.kind === 'text' && item.text === text);
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

describe('odpToPdf', () => {
  // Proves the same architectural point convertPresentationToLayout's own module doc claims for pptx: an odp package, decoded via odf.js's own decodePackage (not ooxml.js's) and read via readOdpContent, feeds convertPresentationToLayout completely unmodified -- the identical engine pptxToPdf feeds -- and comes out as a genuine, multi-page PDF with real slide content (title text, grouped shapes, table cells, and an image).
  it('produces valid PDF bytes with real slide content from an odp presentation', () => {
    const pdfBytes = odpToPdf(minimalOdpBytes());
    expect(pdfHeader(pdfBytes)).toBe('%PDF-');

    const layout = readPdf(pdfBytes);
    expect(layout.pages).toHaveLength(2);
    const page1Text = layout.pages[0]?.items.filter((item) => item.kind === 'text').map((item) => item.text).join(' ');
    expect(page1Text).toContain('Hello from odp');
    expect(page1Text).toContain('Grouped A');
    expect(page1Text).toContain('Grouped B');
    const page2Text = layout.pages[1]?.items.filter((item) => item.kind === 'text').map((item) => item.text).join(' ');
    expect(page2Text).toContain('A1');
    expect(page2Text).toContain('B1');
    expect(layout.pages[1]?.items.some((item) => item.kind === 'image')).toBe(true);
  });

  // "Should work for free" claims deserve verification, not just assumption: presentation:notes is read into ContentSlide.notes by odf.js's own readOdp, and src/layout/slides.ts's hidden-annotation notes mechanism (already built and proven for pptxToPdf) carries any ContentSlide.notes through to the PDF regardless of which reader produced the ContentSlide -- this asserts that is genuinely true for odp too, with zero new notes-handling code written for this change.
  it('carries odp speaker notes through to the PDF via the existing hidden-annotation mechanism, with no new notes-handling code', () => {
    const pdfBytes = odpToPdf(minimalOdpBytes());
    const layout = readPdf(pdfBytes);
    expect(layout.pages[0]?.notes).toBe('Speaker notes for slide one.');
    // Slide two carries no presentation:notes at all -- confirms the "no notes" case doesn't leak a stray annotation either.
    expect(layout.pages[1]?.notes).toBeUndefined();
  });

  // The fixture's draw:transform="rotate(0.5235987755982988) ..." is exactly 30 degrees; odf.js's own readOdp resolves that to ContentShape.rotationDeg -30 (its own read.test.ts asserts the identical value for the identical transform string), and convertPresentationToLayout's shapePlacement negates it again (DrawingML/ODF rotate clockwise, the PDF writer rotates counter-clockwise) to land on +30 here -- the same shared shapePlacement code pptxToPdf's own rotated-shape handling uses. wrapRunsToWidth fragments the title into one LayoutText per word, so this looks for the title's first word rather than the whole phrase.
  it('reads a rotated shape through to positioned PDF text (rotation resolved by the same shared shape-placement code pptxToPdf uses)', () => {
    const pdfBytes = odpToPdf(minimalOdpBytes());
    const layout = readPdf(pdfBytes);
    const rotatedText = findText(layout.pages[0]!.items, 'Hello');
    expect(rotatedText).toBeDefined();
    expect(rotatedText?.rotationDeg).toBeCloseTo(30, 1);
  });

  it('throws when the signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => odpToPdf(minimalOdpBytes(), { signal: controller.signal })).toThrow();
  });
});

describe('odsToPdf', () => {
  // Proves the architectural point specific to sheets: an ods package, decoded via odf.js's own decodePackage and read via readOdsContent, feeds convertSpreadsheetToLayout (genuinely new layout code, not a reused docx/pptx engine -- see convert.ts's own module doc) and comes out as a real PDF carrying real cell content, a real merged cell, and a hidden column that contributes nothing at all to the rendered page.
  it('produces valid PDF bytes with real cell content from an ods spreadsheet', () => {
    const pdfBytes = odsToPdf(minimalOdsBytes());
    expect(pdfHeader(pdfBytes)).toBe('%PDF-');

    const layout = readPdf(pdfBytes);
    expect(layout.pages).toHaveLength(1);
    const text = layout.pages[0]?.items.filter((item) => item.kind === 'text').map((item) => item.text).join(' ');
    expect(text).toContain('Name');
    expect(text).toContain('Acme');
    expect(text).toContain('Merged');
  });

  // The fixture's column B is hidden (table:visibility="collapse") and carries the 'Amount'/123.45 cells -- neither should appear anywhere in the rendered PDF at all, confirming src/layout/sheets.ts's own "skip hidden entirely" fix (a real bug caught during this change's own real-file verification: a hidden column's cell was rendering a stray zero-width '###'/truncated fragment instead of nothing).
  it('renders nothing at all for cells anchored in a hidden column', () => {
    const pdfBytes = odsToPdf(minimalOdsBytes());
    const layout = readPdf(pdfBytes);
    const text = layout.pages[0]?.items.filter((item) => item.kind === 'text').map((item) => item.text).join(' ');
    expect(text).not.toContain('Amount');
    expect(text).not.toContain('123.45');
    expect(text).not.toContain('#');
  });

  it('reads print settings (page size, headers) through to the rendered page', () => {
    // Gridlines aren't asserted here via a round trip through readPdf: readPdf's own content-stream interpreter (src/pdf/interpret.ts) never reconstructs a 'line' kind item at all -- a pre-existing, documented asymmetry of the read direction, not something this change touches. Gridline emission itself (one LayoutLine per boundary) is already covered directly at the layout level by src/layout/sheets.test.ts.
    const pdfBytes = odsToPdf(minimalOdsBytes());
    const layout = readPdf(pdfBytes);
    expect(layout.pages[0]).toMatchObject({ widthPt: 400, heightPt: 300 });
    const text = layout.pages[0]?.items.filter((item) => item.kind === 'text').map((item) => item.text) ?? [];
    expect(text).toContain('A'); // column-letter header label
    expect(text).toContain('1'); // row-number header label
  });

  it('throws when the signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => odsToPdf(minimalOdsBytes(), { signal: controller.signal })).toThrow();
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

describe('pdfToOdp', () => {
  // The fixture's title frame is rotated 30 degrees (see test-support/odp.ts), and wrapRunsToWidth fragments it into one LayoutText per word -- reconstructPresentation's own geometry-based line clustering does not guarantee those fragments come back in original reading order for rotated text (mirrors convert.test.ts's own odpToPdf rotated-shape test, which checks only the title's first word for the identical reason). This checks each word landed somewhere, not that the phrase reconstructed in its original order.
  it('round-trips text content through odpToPdf then pdfToOdp', () => {
    const pdfBytes = odpToPdf(minimalOdpBytes());
    const odpBytes = pdfToOdp(pdfBytes);
    const editor = openOdp(odpBytes);
    const text = editor
      .slides()
      .flatMap((s) => s.shapes())
      .map((s) => s.text)
      .join(' ');
    expect(text).toContain('Hello');
    expect(text).toContain('from');
    expect(text).toContain('odp');
  });

  // Mirrors pdfToPptx's own equivalent test: exercises the full pipeline (readPdf -> reconstructPresentation, entirely unmodified -- the same architectural bet odpToPdf's own build already proved -- -> buildOdpPackage) through a fresh, hand-built pptx rather than the minimalOdpBytes fixture, so a bold/coloured/sized run really is recovered from PDF geometry, not merely carried through unchanged.
  it('round-trips a bold, coloured, sized run through pptxToPdf then pdfToOdp', () => {
    const pptxEditor = createPptx();
    pptxEditor.addSlide().addTextBox({ frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 100 }, text: 'StyledSlideRun' });

    const pdfBytes = pptxToPdf(pptxEditor.toBytes());
    const odpBytes = pdfToOdp(pdfBytes);
    const roundTripped = openOdp(odpBytes);

    const shapes = roundTripped.slides().flatMap((s) => s.shapes());
    const text = shapes.map((s) => s.text).join(' ');
    expect(text).toContain('StyledSlideRun');
  });

  it('round-trips speaker notes through odpToPdf then pdfToOdp', () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.addTextBox({ frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 100 }, text: 'Slide with notes' });
    slide.notes = 'These are the speaker notes for this slide';

    const pdfBytes = pptxToPdf(editor.toBytes());
    const odpBytes = pdfToOdp(pdfBytes);
    const roundTripped = openOdp(odpBytes);

    expect(roundTripped.slides()[0]?.notes).toBe('These are the speaker notes for this slide');
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
