import { decodePackage as decodeOoxmlPackage, readXlsxContent } from 'ooxml.js';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { createDocx, openDocx } from '../edit/docx/editor';
import { openOdg } from '../edit/odg/editor';
import { openOdp } from '../edit/odp/editor';
import { openOds } from '../edit/ods/editor';
import { openOdt } from '../edit/odt/editor';
import { createPptx, openPptx } from '../edit/pptx/editor';
import { minimalOdgBytes } from '../test-support/odg';
import { minimalOdpBytes } from '../test-support/odp';
import { gridOdsBytes } from '../test-support/ods';
import { minimalOdtBytes } from '../test-support/odt';
import { odsToXlsx } from './convert';
import { docxPdfCodec, odgPdfCodec, odpPdfCodec, odsPdfCodec, odtPdfCodec, pptxPdfCodec, xlsxPdfCodec } from './codec';

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

describe('odsPdfCodec', () => {
  it('z.decode produces valid PDF bytes from ods bytes', () => {
    const pdfBytes = z.decode(odsPdfCodec, gridOdsBytes());
    expect(pdfHeader(pdfBytes)).toBe('%PDF-');
  });

  // gridOdsBytes (src/test-support/ods.ts) has gridlines enabled, so this exercises the same gridline-lattice reconstruction path as convert.test.ts's own pdfToOds test -- see that test's own note for why.
  it('z.encode then z.decode round-trips every cell\'s text content, like odsToPdf/pdfToOds', () => {
    const pdfBytes = z.decode(odsPdfCodec, gridOdsBytes());
    const odsBytes = z.encode(odsPdfCodec, pdfBytes);
    const [sheet] = openOds(odsBytes).sheets();
    const text = sheet!.cell(0, 0).displayText + sheet!.cell(1, 1).displayText + sheet!.cell(2, 2).displayText;
    expect(text).toBe('AlphaTwoSix');
  });

  it('rejects decode input whose first zip entry is not a stored ods mimetype part before ever reaching odsToPdf', () => {
    expect(() => z.decode(odsPdfCodec, new TextEncoder().encode('not an ods'))).toThrow(z.core.$ZodError);
  });

  it('rejects encode input with no %PDF- header before ever reaching pdfToOds', () => {
    expect(() => z.encode(odsPdfCodec, new TextEncoder().encode('not a pdf'))).toThrow(z.core.$ZodError);
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

// gridOdsBytes -> odsToXlsx builds a genuine xlsx starting point (rather than a hand-rolled ooxml.js xlsx package), mirroring odsPdfCodec's own gridOdsBytes usage above -- xlsxToPdf/pdfToXlsx compose the ods<->xlsx bridge with the ods<->pdf layout pair internally (see convert.ts's own module comment on xlsxToPdf), so this exercises that composition through the codec, not a genuine xlsx-native layout engine.
describe('xlsxPdfCodec', () => {
  it('z.decode produces valid PDF bytes from xlsx bytes', () => {
    const xlsxBytes = odsToXlsx(gridOdsBytes());
    const pdfBytes = z.decode(xlsxPdfCodec, xlsxBytes);
    expect(pdfHeader(pdfBytes)).toBe('%PDF-');
  });

  it('z.encode then z.decode round-trips every cell\'s text content, like xlsxToPdf/pdfToXlsx', () => {
    const xlsxBytes = odsToXlsx(gridOdsBytes());
    const pdfBytes = z.decode(xlsxPdfCodec, xlsxBytes);
    const roundTrippedXlsxBytes = z.encode(xlsxPdfCodec, pdfBytes);
    const content = readXlsxContent(decodeOoxmlPackage(roundTrippedXlsxBytes));
    if (content.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    const sheet = content.sheets[0]!;
    const stringValueAt = (row: number, column: number): string => {
      const cell = sheet.cells.find((c) => c.row === row && c.column === column);
      if (cell?.value.kind !== 'string') {
        throw new Error(`expected a string cell at (${row}, ${column})`);
      }
      return cell.value.value;
    };
    expect(`${stringValueAt(0, 0)}${stringValueAt(1, 1)}${stringValueAt(2, 2)}`).toBe('AlphaTwoSix');
  });

  it('rejects decode input with no ZIP local-file-header before ever reaching xlsxToPdf', () => {
    expect(() => z.decode(xlsxPdfCodec, new TextEncoder().encode('not an xlsx'))).toThrow(z.core.$ZodError);
  });

  it('rejects encode input with no %PDF- header before ever reaching pdfToXlsx', () => {
    expect(() => z.encode(xlsxPdfCodec, new TextEncoder().encode('not a pdf'))).toThrow(z.core.$ZodError);
  });
});
