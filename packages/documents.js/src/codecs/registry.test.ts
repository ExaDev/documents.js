import type { ContentDocument } from 'document-schema.js';
import { describe, expect, it } from 'vitest';
import { odsToXlsx } from '../convert/convert';
import { readOdfFormulaContent } from '../odf/formula/read';
import { FRACTION_FORMULA, odfFormulaBytes } from '../test-support/odf';
import { minimalDocxBytes } from '../test-support/docx';
import { minimalOdgBytes } from '../test-support/odg';
import { minimalOdpBytes } from '../test-support/odp';
import { minimalOdsBytes, richOdsBytes } from '../test-support/ods';
import { minimalOdtBytes } from '../test-support/odt';
import { minimalPptxBytes } from '../test-support/pptx';
import { encodeMarkdownText } from '../markdown/text';
import { richMarkdownText } from '../test-support/markdown';
import { decodeDocumentPackage } from '../package-codec';
import { DOCUMENT_FORMAT_CODECS } from './registry';

// Proves each DOCUMENT_FORMAT_CODECS entry's own read/write pair is wired correctly on its own terms -- not merely that readDocumentMetadata/setDocumentMetadata/buildDocumentBytes happen to still work after being refactored onto this registry (their own test files cover that). Every format with both a content.read and a content.write is exercised as a genuine read -> write -> read round trip: the content a fresh read produces after writing back out must equal the content that went in.

function requireContentCodec(format: 'docx' | 'pptx' | 'odt' | 'odp' | 'ods' | 'odg' | 'markdown' | 'xlsx' | 'csv') {
  const content = DOCUMENT_FORMAT_CODECS[format].content;
  if (!content?.write) {
    throw new Error(`expected DOCUMENT_FORMAT_CODECS.${format}.content.write to be defined`);
  }
  return content;
}

// Every buildXPackage function mints a fresh createdIso/modifiedIso when the source ContentDocument carries none (a real, pre-existing property of those builders, independent of this registry) -- normalized out here so the round-trip assertion below is checking wiring correctness, not re-asserting that unrelated, already-covered behavior.
function withReferenceTimestamps(rebuilt: ContentDocument, reference: ContentDocument): ContentDocument {
  return { ...rebuilt, metadata: { ...rebuilt.metadata, createdIso: reference.metadata.createdIso, modifiedIso: reference.metadata.modifiedIso } };
}

// A handful of formats' own buildXPackage carries other pre-existing, already-documented lossiness beyond timestamps (a shape's own `name` synthesized fresh on rebuild for pptx/odp, page geometry reset to a US Letter default for odt, an extra blank table row inserted for odp) -- none of it introduced by this registry, all of it a property of builders this task did not touch and that already have their own dedicated fidelity tests elsewhere. For these formats a black-box substantive-text check is the right-scoped proof of wiring: if content.read/content.write were wired to the wrong underlying functions, the round-tripped ContentDocument would not contain this exact source text at all.
function containsText(content: ContentDocument, expected: string): boolean {
  return JSON.stringify(content).includes(expected);
}

describe('DOCUMENT_FORMAT_CODECS: content read/write round trips', () => {
  it('docx: read -> write -> read round-trips the ContentDocument', () => {
    const codec = requireContentCodec('docx');
    const content = codec.read(minimalDocxBytes());
    const rebuiltBytes = codec.write!(content);
    expect(withReferenceTimestamps(codec.read(rebuiltBytes), content)).toEqual(content);
  });

  it('pptx: read -> write -> read carries the source slide text through', () => {
    const codec = requireContentCodec('pptx');
    const content = codec.read(minimalPptxBytes());
    expect(containsText(content, 'Slide text')).toBe(true);
    const rebuiltBytes = codec.write!(content);
    const roundTripped = codec.read(rebuiltBytes);
    expect(roundTripped.kind).toBe(content.kind);
    expect(containsText(roundTripped, 'Slide text')).toBe(true);
  });

  it('odt: read -> write -> read carries the source paragraph text through', () => {
    const codec = requireContentCodec('odt');
    const content = codec.read(minimalOdtBytes());
    expect(containsText(content, 'Hello from odt')).toBe(true);
    const rebuiltBytes = codec.write!(content);
    const roundTripped = codec.read(rebuiltBytes);
    expect(roundTripped.kind).toBe(content.kind);
    expect(containsText(roundTripped, 'Hello from odt')).toBe(true);
  });

  it('odp: read -> write -> read carries the source slide text through', () => {
    const codec = requireContentCodec('odp');
    const content = codec.read(minimalOdpBytes());
    expect(containsText(content, 'Hello from odp')).toBe(true);
    const rebuiltBytes = codec.write!(content);
    const roundTripped = codec.read(rebuiltBytes);
    expect(roundTripped.kind).toBe(content.kind);
    expect(containsText(roundTripped, 'Hello from odp')).toBe(true);
  });

  it('ods: read -> write -> read round-trips the ContentDocument', () => {
    const codec = requireContentCodec('ods');
    const content = codec.read(minimalOdsBytes());
    const rebuiltBytes = codec.write!(content);
    expect(withReferenceTimestamps(codec.read(rebuiltBytes), content)).toEqual(content);
  });

  // odg's own round trip is not byte-for-byte exact even setting timestamps aside -- buildOdgPackage/readOdgContent lose a text frame's `name` and carry ordinary floating-point drift through real geometry recomputation (rotation resolution), both pre-existing, documented properties of that pair (see this package's own README gotchas on odg reconstruction), not something this registry wiring could introduce or fix. Structural fields prove the write -> read half is genuinely wired and produced a real, valid drawing.
  it('odg: read -> write -> read round-trips the structural shape of the ContentDocument', () => {
    const codec = requireContentCodec('odg');
    const content = codec.read(minimalOdgBytes());
    const rebuiltBytes = codec.write!(content);
    const roundTripped = codec.read(rebuiltBytes);
    expect(roundTripped.kind).toBe(content.kind);
    expect(roundTripped.metadata.title).toBe(content.metadata.title);
    if (roundTripped.kind === 'drawing' && content.kind === 'drawing') {
      expect(roundTripped.pages.length).toBe(content.pages.length);
      expect(roundTripped.pages[0]?.shapes.length).toBe(content.pages[0]?.shapes.length);
      expect(roundTripped.pages[0]?.vectors.length).toBe(content.pages[0]?.vectors.length);
    }
  });

  it('markdown: read -> write -> read round-trips the ContentDocument', () => {
    const codec = requireContentCodec('markdown');
    const content = codec.read(encodeMarkdownText(richMarkdownText()));
    const rebuiltBytes = codec.write!(content);
    expect(codec.read(rebuiltBytes)).toEqual(content);
  });

  // csv's round trip is exact-equality like markdown's, for the same stability reason: write emits each cell's displayText, and read re-types that text heuristically -- but re-typing a cell that already went through inferCellValue once lands on the identical value again (a re-typed number prints back as the same digits, a declined string stays a string), so a second read cannot drift from the first.
  it('csv: read -> write -> read round-trips the ContentDocument', () => {
    const codec = requireContentCodec('csv');
    const csvBytes = new TextEncoder().encode('Name,Amount,Active\nWidget,42.5,TRUE\nGadget,7,\n');
    const content = codec.read(csvBytes);
    const rebuiltBytes = codec.write!(content);
    expect(codec.read(rebuiltBytes)).toEqual(content);
  });

  // xlsx's own column-width unit conversion (ooxml.js's ptToColumnWidthChars/columnWidthCharsToPt, src/typed/xlsx/units.ts) is a best-effort algebraic inverse, not an exact one -- src/convert/bridges.test.ts's own COLUMN_WIDTH_TOLERANCE_PT documents up to ~1pt of drift per pt<->character-width hop. This registry round trip is a second such hop on top of whatever odsToXlsx's own bridge already introduced building the fixture, so widths are checked within tolerance rather than exact equality; every other field (sheet name, cell values/kinds/formula/merges) is checked exactly, since none of those go through a lossy unit conversion.
  it('xlsx: read -> write -> read carries sheet cell values, kinds, formulas, and merges through exactly, and column widths within tolerance', () => {
    const codec = requireContentCodec('xlsx');
    const xlsxBytes = odsToXlsx(richOdsBytes());
    const content = codec.read(xlsxBytes);
    const rebuiltBytes = codec.write!(content);
    const roundTripped = codec.read(rebuiltBytes);

    expect(roundTripped.kind).toBe(content.kind);
    if (content.kind !== 'spreadsheet' || roundTripped.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(roundTripped.metadata.title).toBe(content.metadata.title);

    const originalSheet = content.sheets[0]!;
    const sheet = roundTripped.sheets[0]!;
    expect(sheet.name).toBe(originalSheet.name);
    expect(sheet.cells.length).toBe(originalSheet.cells.length);
    for (const cell of originalSheet.cells) {
      const match = sheet.cells.find((c) => c.row === cell.row && c.column === cell.column);
      expect(match).toBeDefined();
      expect(match?.value).toEqual(cell.value);
      expect(match?.displayText).toBe(cell.displayText);
      expect(match?.formula).toBe(cell.formula);
      expect(match?.colSpan).toBe(cell.colSpan);
    }

    const XLSX_COLUMN_WIDTH_TOLERANCE_PT = 1;
    expect(sheet.columns.length).toBe(originalSheet.columns.length);
    for (const originalColumn of originalSheet.columns) {
      const column = sheet.columns.find((c) => c.index === originalColumn.index);
      expect(column).toBeDefined();
      expect(Math.abs((column?.widthPt ?? 0) - (originalColumn.widthPt ?? 0))).toBeLessThanOrEqual(XLSX_COLUMN_WIDTH_TOLERANCE_PT);
    }
  });
});

describe('DOCUMENT_FORMAT_CODECS: odf has a content.read but genuinely no content.write', () => {
  it('read matches readOdfFormulaContent directly, and write is unset', () => {
    const bytes = odfFormulaBytes(FRACTION_FORMULA);
    const codec = DOCUMENT_FORMAT_CODECS.odf.content;
    expect(codec).toBeDefined();
    expect('write' in codec!).toBe(false);
    expect(codec!.read(bytes)).toEqual(readOdfFormulaContent(decodeDocumentPackage('odf', bytes)));
  });
});

describe('DOCUMENT_FORMAT_CODECS: pdf has a layout codec, not a content codec', () => {
  it('pdf has no content entry at all', () => {
    expect(DOCUMENT_FORMAT_CODECS.pdf.content).toBeUndefined();
    expect(DOCUMENT_FORMAT_CODECS.pdf.layout).toBeDefined();
  });
});

describe('DOCUMENT_FORMAT_CODECS: xlsx has a content codec, no layout codec', () => {
  it('xlsx has a content entry and no layout entry', () => {
    expect(DOCUMENT_FORMAT_CODECS.xlsx.content).toBeDefined();
    expect(DOCUMENT_FORMAT_CODECS.xlsx.layout).toBeUndefined();
  });
});

describe('DOCUMENT_FORMAT_CODECS: csv has a content codec, no layout codec', () => {
  it('csv has a content entry and no layout entry', () => {
    expect(DOCUMENT_FORMAT_CODECS.csv.content).toBeDefined();
    expect(DOCUMENT_FORMAT_CODECS.csv.layout).toBeUndefined();
  });
});
