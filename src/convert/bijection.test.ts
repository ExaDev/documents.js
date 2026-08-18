import { describe, expect, it } from 'vitest';
import type { ContentDocument, DocumentPackage, PageSize } from 'document-schema.js';
import { ContentDocumentSchema, DocumentPackageSchema } from 'document-schema.js';
import { decodePackage as decodeOdfPackage } from 'odf.js';
import { buildXlsxPackage, decodePackage as decodeOoxmlPackage, readXlsxContent } from 'ooxml.js';
import { readCsvContent } from '../csv/read';
import { csvToPdf, docxToPdf, markdownToPdf, odfToPdf, odgToPdf, odpToPdf, odsToPdf, odtToPdf, pdfToDocx, pdfToOdg, pdfToOds, pptxToPdf, svgToPdf } from './convert';
import { assemblePackage, factorStyles } from './factor-styles';
import { flattenPackage } from './flatten';
import { canonicalise } from './canonicalise';
import { readMarkdownContent } from '../markdown/read';
import { readDocxContent } from '../ooxml/docx/read';
import { readPptxContent } from '../ooxml/pptx/read';
import { readOdfFormulaContent } from '../odf/formula/read';
import { readOdgContent } from '../odf/odg/read';
import { readOdpContent } from '../odf/odp/read';
import { readOdsContent } from '../odf/ods/read';
import { readOdtContent } from '../odf/odt/read';
import { readOdbReportContent } from '../odb/report/content';
import { odbTablesToSpreadsheetDocument } from '../odb/spreadsheet';
import { readOdbTables } from '../odb/read';
import { readSvgContent } from '../svg/read';
import { createDocx } from '../edit/docx/editor';
import { createOdg } from '../edit/odg/editor';
import { createOds } from '../edit/ods/editor';
import { docxWithExtrasPackage, minimalDocxBytes, minimalDocxPackage } from '../test-support/docx';
import { minimalPptxBytes } from '../test-support/pptx';
import { richMarkdownText } from '../test-support/markdown';
import { minimalOdgBytes } from '../test-support/odg';
import { minimalOdpBytes } from '../test-support/odp';
import { gridOdsBytes, minimalOdsBytes } from '../test-support/ods';
import { sheetFormulaOdsBytes } from '../test-support/ods-formula';
import { minimalOdtBytes } from '../test-support/odt';
import { embeddedHsqldbOdbPackage } from '../test-support/odb';
import { formAndReportOdbPackage } from '../test-support/odb-fixture';
import { FRACTION_FORMULA, odfFormulaBytes } from '../test-support/odf';

// THE PROMOTION'S MERGE GATE: the three bijection laws re-run over this repo's REAL corpus -- reader outputs for every format, editors per kind, xlsx via ooxml.js, csv/svg text, odf formulas (standalone, sheet-embedded, and odt-embedded), an .odb table extraction, a rendered .odb report, reconstruction outputs, and onDocument captures from every conversion family (each carrying the layout pass's real frames and pages). document-outline.js proved the laws property-wise over its local corpus in phase 1; this file is the phase-3 gate the plan makes the merge condition: the laws must hold over the documents this package actually produces, not only over hand-built fixtures.
//
// The laws (stated on ExaDev/document-schema.js#20 and its errata): (i) flatten(assemble(c)) reproduces c exactly, up to one declared normalisation (a present-but-empty embeddedObjects array normalises to the field absent); (ii) effective-property equality universally -- the flat codec-exchange form flatten produces is fully materialised (zero style refs) and structurally identical to the unfactored original, so a factored and an unfactored serialisation of one document compare equal; (iii) minting idempotence -- assembling the flattened tree again (and factoring an already-factored package) mints the identical table and the identical tree. Never an identity assertion: decompose embeds the source's own node objects, so toBe would pass even for an implementation that mutated its input -- structural comparison over a pre-roundtrip structuredClone snapshot is what actually pins the values, and re-comparing the source against its snapshot additionally pins that neither direction mutates the input in place.

function canon(value: unknown): unknown {
  return JSON.parse(JSON.stringify(normaliseEmbeddedObjects(canonicalise(value))));
}

// The bijection's one declared normalisation: decompose concatenates a sheet's images and embedded objects into a single children array and flatten rebuilds embeddedObjects only when an embedded object exists, so a present-but-empty array -- schema-legal, emitted by no codec -- cannot survive the round trip and normalises to the field absent. Applied to BOTH sides of every comparison so law (i) stays an equivalence over canonical forms; the direction is pinned outright in decompose.test.ts. Recursive because a sheet can sit inside an embedded document, whose own sheets can carry the same field.
function normaliseEmbeddedObjects(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normaliseEmbeddedObjects);
  if (typeof value !== 'object' || value === null) return value;
  const normalised: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'embeddedObjects' && Array.isArray(child) && child.length === 0) continue;
    normalised[key] = normaliseEmbeddedObjects(child);
  }
  return normalised;
}

function expectStructurallyEqual(actual: unknown, expected: unknown): void {
  expect(canon(actual)).toEqual(canon(expected));
}

// True when any object anywhere in the value carries a `style` key: "the flat encoding is always fully materialised, refs live only on tree wrappers" is the invariant minting depends on and law (ii) asserts.
function containsStyleRef(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsStyleRef);
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'style') return true;
      if (containsStyleRef(child)) return true;
    }
  }
  return false;
}

// One corpus entry: flat content, plus the pages a layout pass produced when the entry comes from an onDocument capture (the plan's must-have wrapped-run case needs real frames, which only a capture carries).
interface CorpusEntry {
  readonly name: string;
  readonly content: ContentDocument;
  readonly pages?: readonly PageSize[];
}

function captured(convert: (onDocument: (pkg: DocumentPackage) => void) => Uint8Array<ArrayBuffer>): { content: ContentDocument; pages: PageSize[] } {
  let capturedPkg: DocumentPackage | undefined;
  convert((pkg) => {
    capturedPkg = pkg;
  });
  if (capturedPkg === undefined) {
    throw new Error('conversion did not invoke onDocument');
  }
  return { content: flattenPackage(capturedPkg), pages: capturedPkg.pages ?? [] };
}

const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><title>Corpus drawing</title><rect x="1" y="1" width="20" height="10" fill="black"/><ellipse cx="30" cy="6" rx="4" ry="2"/><line x1="1" y1="20" x2="10" y2="20"/><path d="M 0 30 L 10 30 C 20 30 20 40 10 40 Z"/></svg>';

function corpus(): readonly CorpusEntry[] {
  const reader: ContentDocument[] = [
    readDocxContent(minimalDocxPackage()),
    readDocxContent(docxWithExtrasPackage()),
    readPptxContent(decodeOoxmlPackage(minimalPptxBytes())),
    readOdtContent(decodeOdfPackage(minimalOdtBytes())),
    readOdpContent(decodeOdfPackage(minimalOdpBytes())),
    readOdsContent(decodeOdfPackage(gridOdsBytes())),
    readOdsContent(decodeOdfPackage(minimalOdsBytes())),
    readOdgContent(decodeOdfPackage(minimalOdgBytes())),
    readOdfFormulaContent(decodeOdfPackage(odfFormulaBytes(FRACTION_FORMULA, { starMath: '{a} over {b}' }))),
    readOdsContent(decodeOdfPackage(sheetFormulaOdsBytes())),
    readMarkdownContent(richMarkdownText()),
    readCsvContent('h1,h2,h3\n42.5,TRUE,2024-01-15\n"1,234",plain,x'),
    readSvgContent(SVG_TEXT),
    // xlsx through ooxml.js's own spreadsheet pair -- the one ContentDocument source with no odf.js reader behind it.
    readXlsxContent(buildXlsxPackage(readOdsContent(decodeOdfPackage(gridOdsBytes())))),
    // Editors per kind: a live-view build, encoded and read back through the same reader every other corpus entry uses -- the editor surface, not a rebuild of reader output.
    readDocxContent(decodeOoxmlPackage(editorDocxBytes())),
    readOdsContent(decodeOdfPackage(editorOdsBytes())),
    readOdgContent(decodeOdfPackage(editorOdgBytes())),
    odbTablesToSpreadsheetDocument(readOdbTables(embeddedHsqldbOdbPackage())),
    readOdbReportContent(formAndReportOdbPackage()),
  ];
  const entries: CorpusEntry[] = reader.map((content, index) => ({ name: `reader output ${String(index)}`, content }));
  // A multi-section wordprocessing document -- the per-section geometry case section groups exist to carry (odmToPdf's own combined shape: two read chapters concatenated with a leading break).
  const chapterOne = readOdtContent(decodeOdfPackage(minimalOdtBytes()));
  const chapterTwo = readOdtContent(decodeOdfPackage(minimalOdtBytes()));
  if (chapterOne.kind === 'wordprocessing' && chapterTwo.kind === 'wordprocessing') {
    entries.push({
      name: 'multi-section wordprocessing (two chapters concatenated)',
      content: { kind: 'wordprocessing', metadata: chapterOne.metadata, sections: [...chapterOne.sections, ...chapterTwo.sections] },
    });
  }
  // onDocument captures: real frames, real pages, real styles minting over real formatting repetition.
  entries.push({ name: 'docxToPdf capture (wrapped runs carry multiple frames)', ...captured((onDocument) => docxToPdf(minimalDocxBytes(), { onDocument })) });
  entries.push({ name: 'pptxToPdf capture', ...captured((onDocument) => pptxToPdf(minimalPptxBytes(), { onDocument })) });
  entries.push({ name: 'odtToPdf capture', ...captured((onDocument) => odtToPdf(minimalOdtBytes(), { onDocument })) });
  entries.push({ name: 'odpToPdf capture', ...captured((onDocument) => odpToPdf(minimalOdpBytes(), { onDocument })) });
  entries.push({ name: 'odsToPdf capture', ...captured((onDocument) => odsToPdf(gridOdsBytes(), { onDocument })) });
  entries.push({ name: 'odgToPdf capture', ...captured((onDocument) => odgToPdf(minimalOdgBytes(), { onDocument })) });
  entries.push({ name: 'markdownToPdf capture', ...captured((onDocument) => markdownToPdf(new TextEncoder().encode(richMarkdownText()), { onDocument })) });
  entries.push({ name: 'csvToPdf capture', ...captured((onDocument) => csvToPdf(new TextEncoder().encode('a,b\n1,2'), { onDocument })) });
  entries.push({ name: 'svgToPdf capture', ...captured((onDocument) => svgToPdf(new TextEncoder().encode(SVG_TEXT), { onDocument })) });
  entries.push({ name: 'odfToPdf capture (formula tree)', ...captured((onDocument) => odfToPdf(odfFormulaBytes(FRACTION_FORMULA), { onDocument })) });
  entries.push({ name: 'odsToPdf capture with embedded formula', ...captured((onDocument) => odsToPdf(sheetFormulaOdsBytes(), { onDocument })) });
  // Reconstruction outputs: PDF bytes read back and reconstructed per direction.
  const pdfBytes = odsToPdf(gridOdsBytes());
  entries.push({ name: 'pdfToDocx reconstruction capture', ...captured((onDocument) => pdfToDocx(pdfBytes, { onDocument })) });
  entries.push({ name: 'pdfToOds reconstruction capture', ...captured((onDocument) => pdfToOds(pdfBytes, { onDocument })) });
  entries.push({ name: 'pdfToOdg reconstruction capture', ...captured((onDocument) => pdfToOdg(docxToPdf(minimalDocxBytes()), { onDocument })) });
  return entries;
}

// A live-view docx build carrying repeated direct formatting (two identically-styled runs), encoded through the editor's own bytes and read back -- the editor surface's contribution to the corpus.
function editorDocxBytes(): Uint8Array<ArrayBuffer> {
  const editor = createDocx();
  editor.body.appendParagraph().appendRun({ text: 'Hello from the editor' });
  const styled = editor.body.appendParagraph();
  styled.appendRun({ text: 'bold one', bold: true, sizePt: 14 });
  styled.appendRun({ text: 'bold two', bold: true, sizePt: 14 });
  return editor.toBytes();
}

function editorOdsBytes(): Uint8Array<ArrayBuffer> {
  const editor = createOds();
  const sheet = editor.addSheet('Editor');
  sheet.cell(0, 0).value = { kind: 'string', value: 'label' };
  sheet.cell(0, 1).value = { kind: 'number', value: 7 };
  return editor.toBytes();
}

function editorOdgBytes(): Uint8Array<ArrayBuffer> {
  const editor = createOdg();
  const page = editor.addPage();
  page.addRect({ frame: { xPt: 20, yPt: 20, widthPt: 100, heightPt: 60 }, fill: { r: 1, g: 0.5, b: 0 } });
  page.addTextBox({ frame: { xPt: 20, yPt: 200, widthPt: 300, heightPt: 30 }, text: 'A label on top' });
  return editor.toBytes();
}

describe('decompose/flatten bijection laws over the real corpus', () => {
  describe.each(corpus())('$name', ({ content, pages }) => {
    it('law (i): flattenPackage(assemblePackage(c)) reproduces c exactly', () => {
      expect(ContentDocumentSchema.safeParse(content).success).toBe(true);
      const snapshot = structuredClone(content);
      const tree = assemblePackage(content, pages);
      expect(DocumentPackageSchema.safeParse(tree).success).toBe(true);
      const flat = flattenPackage(tree);
      expect(ContentDocumentSchema.safeParse(flat).success).toBe(true);
      expectStructurallyEqual(flat, snapshot);
      // decompose embeds the source's own nodes, so re-comparing the source against its snapshot also pins that neither direction of the round trip mutated the input in place.
      expectStructurallyEqual(content, snapshot);
    });

    it('law (ii): the flat encoding is fully materialised and effective-equal to the original', () => {
      const snapshot = structuredClone(content);
      const tree = assemblePackage(content, pages);
      const flat = flattenPackage(tree);
      expect(containsStyleRef(flat)).toBe(false);
      // Resolve-then-compare in the flatten-as-resolver form: materialising every ref away and comparing structurally IS the effective-property comparison, because gap-fill restoration is exactly what resolution does.
      expectStructurallyEqual(flat, snapshot);
      expectStructurallyEqual(content, snapshot);
    });

    it('law (iii): assembling the flattened tree again mints the identical table and tree', () => {
      const first = assemblePackage(content, pages);
      const second = assemblePackage(flattenPackage(first), first.pages);
      expectStructurallyEqual(second, first);
      // Factoring an already-factored package is the same law through the public re-mint entry point.
      expectStructurallyEqual(factorStyles(first), first);
    });

    it('mints deterministically', () => {
      expectStructurallyEqual(assemblePackage(content, pages), assemblePackage(content, pages));
    });
  });

  // The gate must not pass vacuously: minting has to actually run over real corpus documents (repeated direct formatting is common reader output -- the docx extras and editor builds carry it), so at least one entry's tree carries a non-empty styles table and at least one wrapper ref. If this ever fails because no entry mints, the corpus has stopped exercising laws (ii) and (iii) and needs a real formatting-repetition fixture, not a weakened assertion.
  it('the corpus exercises real minting (at least one entry carries a styles table)', () => {
    const minting = corpus().filter((entry) => Object.keys(assemblePackage(entry.content, entry.pages).styles ?? {}).length > 0);
    expect(minting.length).toBeGreaterThan(0);
  });
});
