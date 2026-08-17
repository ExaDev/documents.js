import { decodePackage as decodeOoxmlPackage, readXlsxContent } from 'ooxml.js';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { decodeCsvText, encodeCsvText } from '../csv/text';
import { parseCsvRecords } from '../csv/records';
import { createDocx, openDocx } from '../edit/docx/editor';
import { openOdg } from '../edit/odg/editor';
import { openOdp } from '../edit/odp/editor';
import { openOds } from '../edit/ods/editor';
import { openOdt } from '../edit/odt/editor';
import { createPptx, openPptx } from '../edit/pptx/editor';
import { decodeMarkdownText, encodeMarkdownText } from '../markdown/text';
import { richMarkdownText } from '../test-support/markdown';
import { minimalOdgBytes } from '../test-support/odg';
import { minimalOdpBytes } from '../test-support/odp';
import { gridOdsBytes } from '../test-support/ods';
import { minimalOdtBytes } from '../test-support/odt';
import { odsToXlsx } from './convert';
import { csvMarkdownCodec, csvPdfCodec, docxPdfCodec, markdownDocxCodec, markdownOdtCodec, markdownPdfCodec, odgPdfCodec, odpPdfCodec, odsCsvCodec, odsPdfCodec, odtPdfCodec, pptxPdfCodec, xlsxCsvCodec, xlsxPdfCodec } from './codec';

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

describe('markdownPdfCodec', () => {
  it('z.decode produces valid PDF bytes from markdown bytes', () => {
    const pdfBytes = z.decode(markdownPdfCodec, encodeMarkdownText('# Hello from markdown'));
    expect(pdfHeader(pdfBytes)).toBe('%PDF-');
  });

  it('z.encode then z.decode round-trips text content, like markdownToPdf/pdfToMarkdown', () => {
    const pdfBytes = z.decode(markdownPdfCodec, encodeMarkdownText('Round trip content'));
    const markdownBytes = z.encode(markdownPdfCodec, pdfBytes);
    expect(decodeMarkdownText(markdownBytes)).toContain('Round trip content');
  });

  it('rejects decode input with malformed UTF-8 before ever reaching markdownToPdf', () => {
    expect(() => z.decode(markdownPdfCodec, new Uint8Array([0xff, 0xfe, 0x00]))).toThrow(z.core.$ZodError);
  });

  it('rejects encode input with no %PDF- header before ever reaching pdfToMarkdown', () => {
    expect(() => z.encode(markdownPdfCodec, new TextEncoder().encode('not a pdf'))).toThrow(z.core.$ZodError);
  });
});

// csvToPdf composes the csv -> ods bridge with ods -> pdf internally (csv has no layout engine of its own, exactly like xlsxPdfCodec above), and pdfToCsv composes pdf -> ods -> csv -- so this pair carries the same stacked-reconstruction caveat as xlsxPdfCodec, with csv read's heuristic re-typing on top.
describe('csvPdfCodec', () => {
  it('z.decode produces valid PDF bytes from csv bytes', () => {
    const pdfBytes = z.decode(csvPdfCodec, encodeCsvText('Name,Amount\nWidget,42.5\n'));
    expect(pdfHeader(pdfBytes)).toBe('%PDF-');
  });

  it('z.encode then z.decode round-trips text content, like csvToPdf/pdfToCsv', () => {
    const pdfBytes = z.decode(csvPdfCodec, encodeCsvText('Name,Amount\nWidget,42.5\n'));
    const csvBytes = z.encode(csvPdfCodec, pdfBytes);
    const records = parseCsvRecords(decodeCsvText(csvBytes));
    expect(records[0]).toEqual(['Name', 'Amount']);
    expect(records[1]?.[0]).toBe('Widget');
  });

  it('rejects decode input with malformed UTF-8 before ever reaching csvToPdf', () => {
    expect(() => z.decode(csvPdfCodec, new Uint8Array([0xff, 0xfe, 0x00]))).toThrow(z.core.$ZodError);
  });

  it('rejects encode input with no %PDF- header before ever reaching pdfToCsv', () => {
    expect(() => z.encode(csvPdfCodec, new TextEncoder().encode('not a pdf'))).toThrow(z.core.$ZodError);
  });
});

// The same-variant spreadsheet bridges: direct ContentDocument pivot copies with no layout engine and no reconstruction, exactly like odsXlsxCodec. The csv boundary is displayText-only -- a typed ods/xlsx cell re-reads as whatever inferCellValue re-types its printed text as on the way back through the encode side.
describe('odsCsvCodec', () => {
  it('z.decode produces csv text carrying every rendered cell of the ods fixture', () => {
    const csvBytes = z.decode(odsCsvCodec, gridOdsBytes());
    const records = parseCsvRecords(decodeCsvText(csvBytes));
    expect(records[0]).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(records[1]).toEqual(['One', 'Two', 'Three']);
  });

  it('z.encode then z.decode round-trips the parsed records, like csvToOds/odsToCsv', () => {
    const odsBytes = z.encode(odsCsvCodec, encodeCsvText('Name,Amount\nWidget,42.5\n'));
    const csvBytes = z.decode(odsCsvCodec, odsBytes);
    expect(parseCsvRecords(decodeCsvText(csvBytes))).toEqual([['Name', 'Amount'], ['Widget', '42.5']]);
  });

  it('rejects decode input whose first zip entry is not a stored ods mimetype part before ever reaching odsToCsv', () => {
    expect(() => z.decode(odsCsvCodec, new TextEncoder().encode('not an ods'))).toThrow(z.core.$ZodError);
  });

  it('rejects encode input with malformed UTF-8 before ever reaching csvToOds', () => {
    expect(() => z.encode(odsCsvCodec, new Uint8Array([0xff, 0xfe, 0x00]))).toThrow(z.core.$ZodError);
  });
});

describe('xlsxCsvCodec', () => {
  it('z.decode produces csv text carrying every rendered cell of the xlsx fixture', () => {
    const csvBytes = z.decode(xlsxCsvCodec, odsToXlsx(gridOdsBytes()));
    const records = parseCsvRecords(decodeCsvText(csvBytes));
    expect(records[0]).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('z.encode then z.decode round-trips the parsed records, like csvToXlsx/xlsxToCsv', () => {
    const xlsxBytes = z.encode(xlsxCsvCodec, encodeCsvText('Name,Amount\nWidget,42.5\n'));
    const csvBytes = z.decode(xlsxCsvCodec, xlsxBytes);
    expect(parseCsvRecords(decodeCsvText(csvBytes))).toEqual([['Name', 'Amount'], ['Widget', '42.5']]);
  });

  it('rejects decode input with no ZIP local-file-header before ever reaching xlsxToCsv', () => {
    expect(() => z.decode(xlsxCsvCodec, new TextEncoder().encode('not an xlsx'))).toThrow(z.core.$ZodError);
  });

  it('rejects encode input with malformed UTF-8 before ever reaching csvToXlsx', () => {
    expect(() => z.encode(xlsxCsvCodec, new Uint8Array([0xff, 0xfe, 0x00]))).toThrow(z.core.$ZodError);
  });
});

// The pdf-composed last-resort pair, mirroring xlsxMarkdownCodec's own shape: neither direction is remotely round-trip-lossless (spreadsheet render stacked on markdown reconstruction and back), so the assertions are structural -- valid output of the target schema carrying real text on the decode side.
describe('csvMarkdownCodec', () => {
  it('z.decode produces markdown carrying the rendered cell text, like csvToMarkdown', () => {
    const markdownBytes = z.decode(csvMarkdownCodec, encodeCsvText('Name,Amount\nWidget,42.5\n'));
    const text = decodeMarkdownText(markdownBytes);
    expect(text).toContain('Name');
    expect(text).toContain('Widget');
  });

  it('z.encode produces csv bytes that parse as well-formed RFC 4180 records, like markdownToCsv', () => {
    const csvBytes = z.encode(csvMarkdownCodec, encodeMarkdownText('| A | B |\n| --- | --- |\n| one | two |\n'));
    expect(parseCsvRecords(decodeCsvText(csvBytes)).length).toBeGreaterThan(0);
  });

  it('rejects decode input with malformed UTF-8 before ever reaching csvToMarkdown', () => {
    expect(() => z.decode(csvMarkdownCodec, new Uint8Array([0xff, 0xfe, 0x00]))).toThrow(z.core.$ZodError);
  });

  it('rejects encode input with malformed UTF-8 before ever reaching markdownToCsv', () => {
    expect(() => z.encode(csvMarkdownCodec, new Uint8Array([0xff, 0xfe, 0x00]))).toThrow(z.core.$ZodError);
  });
});

describe('markdownDocxCodec', () => {
  it('z.decode produces valid docx bytes from markdown bytes', () => {
    const docxBytes = z.decode(markdownDocxCodec, encodeMarkdownText(richMarkdownText()));
    const text = openDocx(docxBytes).paragraphs().map((p) => p.text).join(' ');
    expect(text).toContain('Report Title');
  });

  it('z.encode then z.decode round-trips text content, like markdownToDocx/docxToMarkdown', () => {
    const docxBytes = z.decode(markdownDocxCodec, encodeMarkdownText(richMarkdownText()));
    const markdownBytes = z.encode(markdownDocxCodec, docxBytes);
    expect(decodeMarkdownText(markdownBytes)).toContain('Report Title');
  });

  it('rejects decode input with malformed UTF-8 before ever reaching markdownToDocx', () => {
    expect(() => z.decode(markdownDocxCodec, new Uint8Array([0xff, 0xfe, 0x00]))).toThrow(z.core.$ZodError);
  });

  it('rejects encode input with no ZIP local-file-header before ever reaching docxToMarkdown', () => {
    expect(() => z.encode(markdownDocxCodec, new TextEncoder().encode('not a docx'))).toThrow(z.core.$ZodError);
  });
});

describe('markdownOdtCodec', () => {
  it('z.decode produces valid odt bytes from markdown bytes', () => {
    const odtBytes = z.decode(markdownOdtCodec, encodeMarkdownText(richMarkdownText()));
    const text = openOdt(odtBytes).paragraphs().map((p) => p.text).join(' ');
    expect(text).toContain('Report Title');
  });

  it('z.encode then z.decode round-trips text content, like markdownToOdt/odtToMarkdown', () => {
    const odtBytes = z.decode(markdownOdtCodec, encodeMarkdownText(richMarkdownText()));
    const markdownBytes = z.encode(markdownOdtCodec, odtBytes);
    expect(decodeMarkdownText(markdownBytes)).toContain('Report Title');
  });

  it('rejects decode input with malformed UTF-8 before ever reaching markdownToOdt', () => {
    expect(() => z.decode(markdownOdtCodec, new Uint8Array([0xff, 0xfe, 0x00]))).toThrow(z.core.$ZodError);
  });

  it('rejects encode input whose first zip entry is not a stored odt mimetype part before ever reaching odtToMarkdown', () => {
    expect(() => z.encode(markdownOdtCodec, new TextEncoder().encode('not an odt'))).toThrow(z.core.$ZodError);
  });
});
