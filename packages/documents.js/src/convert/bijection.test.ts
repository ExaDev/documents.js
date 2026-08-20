import { describe, expect, it } from 'vitest';
import type { ConstructDescriptor, ContentBlock, ContentDocument, ContentShape, DocumentPackage, PageSize } from 'document-schema.js';
import { assemblePackage, ContentDocumentSchema, DocumentPackageSchema, factorStyles, flattenPackage } from 'document-schema.js';
// The canonicaliser is deliberately absent from document-schema.js's index barrel (it exists to give the minting pass one tuple-identity recipe, not to publish a sort order as an API guarantee), so it comes in by subpath -- the same one recipe the transform itself uses, never a second one restated here.
import { canonicalise } from 'document-schema.js/canonicalise';
import { decodePackage as decodeOdfPackage } from 'odf.js';
import { buildXlsxPackageFromContent, decodePackage as decodeOoxmlPackage, readXlsxContent } from 'ooxml.js';
import { readCsvContent } from '../csv/read';
import { csvToPdf, docxToPdf, markdownToPdf, odfToPdf, odgToPdf, odpToPdf, odsToPdf, odtToPdf, pptxToPdf, svgToPdf } from './convert';
import { pdfToDocx, pdfToOdg, pdfToOds } from './from-pdf';
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
import { oleEmbeddedDocxBytes, oleEmbeddedPptxBytes } from '../test-support/ole';
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

// The bijection's one declared normalisation: decompose concatenates a sheet's images and embedded objects into a single children array and flatten rebuilds embeddedObjects only when an embedded object exists, so a present-but-empty array -- schema-legal, emitted by no codec -- cannot survive the round trip and normalises to the field absent. Applied to BOTH sides of every comparison so law (i) stays an equivalence over canonical forms; the direction is pinned outright by the transform's own decompose tests, which live with the transform in document-schema.js. Recursive because a sheet can sit inside an embedded document, whose own sheets can carry the same field.
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
    readXlsxContent(buildXlsxPackageFromContent(readOdsContent(decodeOdfPackage(gridOdsBytes())))),
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
  // OLE-embedded OOXML hosts: the ContentEmbeddedObjectBlock both ooxml.js readers emit when an embeddings part is itself a ZIP package -- a nested ContentDocument riding a block, the one block shape whose content is itself a whole document, so the three laws must hold over it in both the section flow (docx) and the shape flow (pptx).
  entries.push({ name: 'reader output: docx with an OLE-embedded xlsx', content: readDocxContent(decodeOoxmlPackage(oleEmbeddedDocxBytes())) });
  entries.push({ name: 'reader output: pptx with an OLE-embedded xlsx', content: readPptxContent(decodeOoxmlPackage(oleEmbeddedPptxBytes())) });
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
  // The OLE hosts through the full conversion path too: the layout engines skip non-formula embeddedObject kinds harmlessly (the pptx fallback picture still renders), and the laws must hold over the stamped-frames tree these captures carry.
  entries.push({ name: 'docxToPdf capture with an OLE-embedded xlsx', ...captured((onDocument) => docxToPdf(oleEmbeddedDocxBytes(), { onDocument })) });
  entries.push({ name: 'pptxToPdf capture with an OLE-embedded xlsx', ...captured((onDocument) => pptxToPdf(oleEmbeddedPptxBytes(), { onDocument })) });
  // Reconstruction outputs: PDF bytes read back and reconstructed per direction.
  const pdfBytes = odsToPdf(gridOdsBytes());
  entries.push({ name: 'pdfToDocx reconstruction capture', ...captured((onDocument) => pdfToDocx(pdfBytes, { onDocument })) });
  entries.push({ name: 'pdfToOds reconstruction capture', ...captured((onDocument) => pdfToOds(pdfBytes, { onDocument })) });
  entries.push({ name: 'pdfToOdg reconstruction capture', ...captured((onDocument) => pdfToOdg(docxToPdf(minimalDocxBytes()), { onDocument })) });
  entries.push(...constructCorpus());
  return entries;
}

// --- The construct-boundary corpus ------------------------------------------------------------------------

// document-schema.js 4.2.0 gave ContentBlock the constructStart/constructEnd marker pair, so a construct boundary is now a flat-form signal decompose promotes to a construct group and flatten reproduces, exactly like a heading level or a list level. No reader in this package emits a marker yet (the format codecs' own construct extraction is document-schema.js#22's separate track), so the vocabulary reaches this gate only through hand-built content -- but the gate itself is unchanged: these entries run the identical three laws every reader entry does, which is what makes them the proof the promotion is correct rather than merely typed. One entry per placement, so a failure names the case.

const CONSTRUCT_SECTION = { pageSize: { widthPt: 595, heightPt: 842 }, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 } };
const CONSTRUCT_SHAPE_FRAME = { xPt: 0, yPt: 0, widthPt: 400, heightPt: 300 };
const CONSTRUCT_END: ContentBlock = { kind: 'constructEnd' };

function constructStart(descriptor: ConstructDescriptor): ContentBlock {
  return { kind: 'constructStart', descriptor };
}

function constructParagraph(text: string, options: { headingLevel?: number; listLevel?: number; indentLeftPt?: number } = {}): ContentBlock {
  return {
    kind: 'paragraph',
    runs: [{ text }],
    ...(options.headingLevel !== undefined ? { headingLevel: options.headingLevel } : {}),
    ...(options.listLevel !== undefined ? { list: { level: options.listLevel } } : {}),
    ...(options.indentLeftPt !== undefined ? { indentLeftPt: options.indentLeftPt } : {}),
  };
}

function constructSectionEntry(name: string, blocks: readonly ContentBlock[]): CorpusEntry {
  return { name, content: { kind: 'wordprocessing', metadata: {}, sections: [{ ...CONSTRUCT_SECTION, blocks: [...blocks] }] } };
}

function constructShape(blocks: readonly ContentBlock[]): ContentShape {
  return { frame: CONSTRUCT_SHAPE_FRAME, insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0, blocks: [...blocks] };
}

function constructCorpus(): readonly CorpusEntry[] {
  // Repeated indentLeftPt inside each construct region so the entries mint for real rather than round-tripping a styles-free tree: the ref lands on the construct group itself (the enclosing section's extent also holds the unindented paragraphs, so no ancestor can factor the key), which is what makes laws (ii) and (iii) bite on a construct wrapper and not just on the leaves under it.
  const shapeWithConstruct = constructShape([
    constructParagraph('before the construct'),
    constructStart({ kind: 'field', instruction: 'PAGE' }),
    constructParagraph('in a shape construct', { indentLeftPt: 18 }),
    constructParagraph('also in it', { indentLeftPt: 18 }),
    CONSTRUCT_END,
  ]);
  return [
    constructSectionEntry('construct at a section root', [
      constructParagraph('before'),
      constructStart({ kind: 'field', instruction: 'PAGE', cachedResult: '1' }),
      constructParagraph('in a field', { indentLeftPt: 24 }),
      constructParagraph('still in the field', { indentLeftPt: 24 }),
      CONSTRUCT_END,
      constructParagraph('after'),
    ]),
    constructSectionEntry('construct nested inside a heading group', [
      constructParagraph('Chapter', { headingLevel: 1 }),
      constructParagraph('under the heading'),
      constructStart({ kind: 'contentControl', controlType: 'richText', tag: 'body', alias: 'Body' }),
      constructParagraph('in a content control', { indentLeftPt: 24 }),
      constructParagraph('still in it', { indentLeftPt: 24 }),
      CONSTRUCT_END,
      constructParagraph('after the control, still under the heading'),
    ]),
    constructSectionEntry('construct nested inside a list group', [
      constructParagraph('item one', { listLevel: 0 }),
      constructStart({ kind: 'anchor', anchorType: 'bookmark', name: 'b1' }),
      constructParagraph('in a bookmark', { indentLeftPt: 24 }),
      constructParagraph('still in it', { indentLeftPt: 24 }),
      CONSTRUCT_END,
      // A deeper item after the region: the round trip only reproduces it in place if stepping through the construct left the list stack alone.
      constructParagraph('item two, nested', { listLevel: 1 }),
    ]),
    constructSectionEntry('two constructs of different kinds nested inside each other', [
      constructStart({ kind: 'provenance', change: 'insertion', author: 'A', dateIso: '2024-01-15T00:00:00Z' }),
      constructParagraph('inserted'),
      constructStart({ kind: 'link', target: { kind: 'external', uri: 'https://example.invalid/' }, title: 'Example' }),
      constructParagraph('linked and inserted', { indentLeftPt: 24 }),
      constructParagraph('also linked', { indentLeftPt: 24 }),
      CONSTRUCT_END,
      constructParagraph('inserted again'),
      CONSTRUCT_END,
    ]),
    constructSectionEntry('construct with no children (an open marker immediately closed)', [
      constructParagraph('before'),
      constructStart({ kind: 'division', name: 'empty', columnCount: 2 }),
      CONSTRUCT_END,
      constructParagraph('after'),
    ]),
    {
      name: 'construct inside a presentation shape flow',
      content: { kind: 'presentation', metadata: {}, slides: [{ size: { widthPt: 960, heightPt: 540 }, shapes: [shapeWithConstruct], notes: '' }] },
    },
    {
      name: 'construct inside a drawing page shape flow',
      content: { kind: 'drawing', metadata: {}, pages: [{ size: { widthPt: 300, heightPt: 300 }, shapes: [shapeWithConstruct], vectors: [] }] },
    },
  ];
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

  // The same anti-vacuity guard, narrowed to the construct entries: laws (ii) and (iii) say nothing about construct groups unless a construct group actually carries a ref, and a construct entry that minted nothing would pass all three laws while proving only that its leaves round-trip. Every construct entry except the deliberately empty one is built to mint on its own construct wrapper, so this pins that the promotion and minting really do compose over the corpus rather than only over the hand-built fixture document-schema.js's own minting tests use.
  it('the construct corpus mints refs onto the construct groups themselves', () => {
    const withConstructRefs = constructCorpus().filter((entry) => constructGroupRefsOf(assemblePackage(entry.content, entry.pages)).length > 0);
    expect(withConstructRefs.map((entry) => entry.name)).toEqual(constructCorpus().filter((entry) => entry.name !== 'construct with no children (an open marker immediately closed)').map((entry) => entry.name));
  });

  // And narrowed to the OLE-embedded entries: the laws would hold vacuously over an entry whose embedded block never materialised, so every OLE entry (reader outputs and conversion captures alike) must genuinely carry an embeddedObject block holding a recovered nested spreadsheet -- the shape the entries exist to pin.
  it('the OLE corpus entries carry genuinely recovered embeddedObject blocks', () => {
    const oleEntries = corpus().filter((entry) => entry.name.includes('OLE-embedded'));
    expect(oleEntries.length).toBeGreaterThan(0);
    for (const entry of oleEntries) {
      const blocks =
        entry.content.kind === 'wordprocessing'
          ? entry.content.sections.flatMap((section) => section.blocks)
          : entry.content.kind === 'presentation'
            ? entry.content.slides.flatMap((slide) => slide.shapes.flatMap((shape) => shape.blocks))
            : [];
      const embedded = blocks.find((block) => block.kind === 'embeddedObject');
      if (embedded?.kind !== 'embeddedObject') {
        throw new Error(`${entry.name}: no embeddedObject block anywhere in the document`);
      }
      expect(embedded.objectKind).toBe('spreadsheet');
      if (embedded.document.kind !== 'spreadsheet') {
        throw new Error(`${entry.name}: the embedded block carries no spreadsheet document`);
      }
      expect(embedded.document.sheets[0]?.name).toBe('Embedded');
      expect(embedded.document.sheets[0]?.cells[0]?.value).toEqual({ kind: 'string', value: 'Recovered cell' });
    }
  });
});

// Every style ref sitting on a construct-descriptor wrapper anywhere in a minted tree: a group node carrying a `kind` that is neither 'paragraph' nor a container discriminant is a ConstructDescriptor, which is exactly what construct groups (and nothing else) hold.
function constructGroupRefsOf(pkg: DocumentPackage): string[] {
  const refs: string[] = [];
  function walk(value: unknown): void {
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    if ('node' in value && 'children' in value && 'style' in value && typeof value.style === 'string') {
      const node: unknown = value.node;
      if (typeof node === 'object' && node !== null && 'kind' in node && typeof node.kind === 'string' && !['paragraph', 'section', 'slide', 'sheet', 'drawPage'].includes(node.kind)) {
        refs.push(value.style);
      }
    }
    for (const child of Object.values(value)) walk(child);
  }
  walk(pkg.children);
  return refs;
}
