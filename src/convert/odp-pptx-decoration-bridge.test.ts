import { decodePackage as decodeOdfPackage } from 'odf.js';
import { decodePackage as decodeOoxmlPackage } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import { createOdp } from '../edit/odp/editor';
import { createPptx } from '../edit/pptx/editor';
import { readOdpContent } from '../odf/odp/read';
import { readPptxContent } from '../ooxml/pptx/read';
import { odpToPptx, pptxToOdp } from './convert';

// Round-trip proofs for run-level decoration (underline, strike) across the odp <-> pptx bridge. ooxml.js's readPptxContent already reads a:u/a:strike into ContentRun.underline/strike, and odf.js's readOdpContent already reads them via the shared paragraph reader. OdtRun already has underline/strike setters and buildOdpPackage's populateParagraph already threads them, so the odp WRITE side was never the gap. The gap this suite guards against is the pptx WRITE side: buildPptxPackage's appendShape/populateCellParagraphs run mappings dropped underline/strike, and DrawingRunInit/ buildDrawingRun (shape.ts) had no fields/attributes for them. These tests prove both directions now carry them.

function pptxContentOf(bytes: Uint8Array<ArrayBuffer>) {
  const content = readPptxContent(decodeOoxmlPackage(bytes));
  if (content.kind !== 'presentation') {
    throw new Error('expected a presentation ContentDocument');
  }
  return content;
}

function odpContentOf(bytes: Uint8Array<ArrayBuffer>) {
  const content = readOdpContent(decodeOdfPackage(bytes));
  if (content.kind !== 'presentation') {
    throw new Error('expected a presentation ContentDocument');
  }
  return content;
}

function firstRun(content: ReturnType<typeof pptxContentOf>) {
  const block = content.slides[0]?.shapes[0]?.blocks[0];
  if (block?.kind !== 'paragraph') {
    throw new Error('expected a paragraph block');
  }
  return block.runs[0];
}

function firstOdpRun(content: ReturnType<typeof odpContentOf>) {
  const shape = content.slides[0]?.shapes[0];
  const block = shape?.blocks[0];
  if (block?.kind !== 'paragraph') {
    throw new Error('expected a paragraph block');
  }
  return block.runs[0];
}

describe('odp -> pptx: run underline and strike survive odpToPptx', () => {
  it('writes a:u/a:strike for an underlined-and-struck odp run', () => {
    const editor = createOdp();
    const slide = editor.addSlide();
    const shape = slide.addTextBox({ frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 80 }, text: 'placeholder' });
    shape.paragraphs()[0]?.remove();
    const run = shape.appendParagraph().appendRun({ text: 'decorated' });
    run.underline = true;
    run.strike = true;

    const pptxBytes = odpToPptx(editor.toBytes());
    const runAfter = firstRun(pptxContentOf(pptxBytes));

    expect(runAfter?.text).toBe('decorated');
    expect(runAfter?.underline).toBe(true);
    expect(runAfter?.strike).toBe(true);
  });
});

describe('pptx -> odp: run underline and strike survive pptxToOdp', () => {
  it('carries underline/strike from a pptx run through to an odp run', () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    const shape = slide.addTextBox({ frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 80 }, text: '' });
    shape.setParagraphs([{ runs: [{ text: 'decorated', underline: true, strike: true }] }]);

    const odpBytes = pptxToOdp(editor.toBytes());
    const runAfter = firstOdpRun(odpContentOf(odpBytes));

    expect(runAfter?.text).toBe('decorated');
    expect(runAfter?.underline).toBe(true);
    expect(runAfter?.strike).toBe(true);
  });
});
