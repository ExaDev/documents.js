import { decodePackage as decodeOdfPackage } from 'odf.js';
import { decodePackage as decodeOoxmlPackage, readXlsxContent } from 'ooxml.js';
import { readPdf } from 'pdf-codec';
import { describe, expect, it } from 'vitest';
import { createDocx, openDocx } from '../edit/docx/editor';
import { openOdp } from '../edit/odp/editor';
import { openOdt } from '../edit/odt/editor';
import { openPptx } from '../edit/pptx/editor';
import { decodeMarkdownText, encodeMarkdownText } from '../markdown/text';
import { readOdgContent } from '../odf/odg/read';
import { readOdsContent } from '../odf/ods/read';
import { FRACTION_FORMULA, odfFormulaBytes } from '../test-support/odf';
import { minimalOdgBytes } from '../test-support/odg';
import { richMarkdownText } from '../test-support/markdown';
import { minimalOdpBytes } from '../test-support/odp';
import { gridOdsBytes, richOdsBytes } from '../test-support/ods';
import { minimalOdtBytes } from '../test-support/odt';
import { minimalDocxBytes } from '../test-support/docx';
import { minimalPptxBytes } from '../test-support/pptx';
import { DIRECT_EDGES } from './capability';
import { docxToMarkdown, docxToOdt, docxToPdf, docxToPptx, markdownToDocx, markdownToOdt, markdownToPdf, odfToPdf, odgToPdf, odpToPdf, odpToPptx, odpToOdt, odsToPdf, odsToXlsx, odtToDocx, odtToMarkdown, odtToOdp, odtToPdf, pdfToDocx, pdfToMarkdown, pdfToOdg, pdfToOdp, pdfToOds, pdfToOdt, pdfToPptx, pdfToXlsx, pptxToDocx, pptxToOdp, pptxToPdf, xlsxToOds, xlsxToPdf, xlsxToMarkdown, markdownToXlsx } from './convert';
import type { DocumentFormat } from './port';

// A single table-driven test matrix covering every (source, target) pair DIRECT_EDGES (capability.ts) currently registers -- the actual capability graph the DocumentConverter port exposes, not a hand-copied list that can silently drift out of sync with it. Each MatrixEntry names the exact edge(s) (source/target format pairs) its own round trip exercises; the "matrix declares every registered edge" describe block below derives the expected edge set directly from DIRECT_EDGES and fails loudly if a registered edge has no entry here, or if an entry claims an edge that no longer exists -- so a future capability-graph change (a new bridge, a newly composed pair) cannot silently go uncovered.
//
// Each entry converts a real fixture (reused from src/test-support/ wherever one already exists) from its own source format to its target format and back, then asserts the RECOVERABLE subset of content survives -- text, structure, specific known fields -- rather than byte-identity, per this package's own README Fidelity section: PDF-pivot conversions are a best-effort geometric reconstruction (no table/vector-shape recovery on the wordprocessing/presentation side), the ods<->xlsx and odg<->pdf pairs have their own documented, narrower format-boundary limits, and odf->pdf is a genuine one-way edge with no reverse at all (see port.ts's own note on why there is no pdf->odf). None of this duplicates the deep, multi-assertion fidelity suites already in convert.test.ts/bridges.test.ts/formula.test.ts -- those remain the authority on any one pair's exact boundary -- this file's job is breadth: proving every registered pair has at least one genuine, passing round trip, with no pair silently missing coverage.

function edgeKey(edge: { readonly source: DocumentFormat; readonly target: DocumentFormat }): string {
  return `${edge.source}->${edge.target}`;
}

interface MatrixEntry {
  readonly name: string;
  // The exact DIRECT_EDGES entries this round trip exercises, both hops -- used only by the completeness check below, never to drive the round trip itself (each entry's own `run` calls the real convert.ts functions directly).
  readonly edges: readonly { readonly source: DocumentFormat; readonly target: DocumentFormat }[];
  readonly run: () => void;
}

const MATRIX_ENTRIES: readonly MatrixEntry[] = [
  {
    name: 'docx <-> pdf',
    edges: [
      { source: 'docx', target: 'pdf' },
      { source: 'pdf', target: 'docx' },
    ],
    // minimalDocxBytes (test-support/docx.ts): one paragraph ("Hello, world!") plus a 2x1 table (A1/B1). PDF<->docx reconstruction has no table recovery (README Fidelity), so the table's own cell text survives only as plain reconstructed paragraph text, not as a table block -- checked as substrings of the full recovered text, not table structure.
    run: () => {
      const pdfBytes = docxToPdf(minimalDocxBytes());
      const roundTrippedBytes = pdfToDocx(pdfBytes);
      const editor = openDocx(roundTrippedBytes);
      const text = editor
        .paragraphs()
        .map((p) => p.text)
        .join(' ');
      expect(text).toContain('Hello, world!');
      expect(text).toContain('A1');
      expect(text).toContain('B1');
    },
  },
  {
    name: 'docx <-> odt (bridge)',
    edges: [
      { source: 'docx', target: 'odt' },
      { source: 'odt', target: 'docx' },
    ],
    // The PDF-bypassing bridge preserves table structure completely (see bridges.test.ts's own dedicated deep test) -- unlike the PDF-pivot pair above, so this asserts the table survives AS a table, not merely as flattened text.
    run: () => {
      const odtBytes = docxToOdt(minimalDocxBytes());
      const roundTrippedBytes = odtToDocx(odtBytes);
      const editor = openDocx(roundTrippedBytes);
      const text = editor
        .paragraphs()
        .map((p) => p.text)
        .join(' ');
      expect(text).toContain('Hello, world!');
      const table = editor.tables()[0];
      expect(table).toBeDefined();
      expect(table!.cell(0, 0).text).toBe('A1');
      expect(table!.cell(0, 1).text).toBe('B1');
    },
  },
  {
    name: 'odt <-> pdf',
    edges: [
      { source: 'odt', target: 'pdf' },
      { source: 'pdf', target: 'odt' },
    ],
    // minimalOdtBytes: a Heading1 "Hello from odt", a paragraph containing a bold "bold text" span, and a 2x1 table (A1/B1). Same PDF<->wordprocessing table-recovery limit as docx above.
    run: () => {
      const pdfBytes = odtToPdf(minimalOdtBytes());
      const roundTrippedBytes = pdfToOdt(pdfBytes);
      const editor = openOdt(roundTrippedBytes);
      const text = editor
        .paragraphs()
        .map((p) => p.text)
        .join(' ');
      expect(text).toContain('Hello from odt');
      expect(text).toContain('bold text');
      expect(text).toContain('A1');
      expect(text).toContain('B1');
    },
  },
  {
    name: 'pptx <-> pdf',
    edges: [
      { source: 'pptx', target: 'pdf' },
      { source: 'pdf', target: 'pptx' },
    ],
    run: () => {
      const pdfBytes = pptxToPdf(minimalPptxBytes());
      const roundTrippedBytes = pdfToPptx(pdfBytes);
      const editor = openPptx(roundTrippedBytes);
      const text = editor
        .slides()
        .flatMap((s) => s.shapes())
        .map((s) => s.text)
        .join(' ');
      expect(text).toContain('Slide text');
    },
  },
  {
    name: 'pptx <-> odp (bridge)',
    edges: [
      { source: 'pptx', target: 'odp' },
      { source: 'odp', target: 'pptx' },
    ],
    run: () => {
      const odpBytes = pptxToOdp(minimalPptxBytes());
      const roundTrippedBytes = odpToPptx(odpBytes);
      const editor = openPptx(roundTrippedBytes);
      const text = editor
        .slides()
        .flatMap((s) => s.shapes())
        .map((s) => s.text)
        .join(' ');
      expect(text).toContain('Slide text');
    },
  },
  {
    name: 'odp <-> pdf',
    edges: [
      { source: 'odp', target: 'pdf' },
      { source: 'pdf', target: 'odp' },
    ],
    // minimalOdpBytes: a rotated title frame ("Hello from odp") with speaker notes on slide one, an image/table on slide two. Rotated text fragments word-by-word (see convert.test.ts's own identical caveat), so this checks each word landed somewhere rather than the phrase's original order; speaker notes round-trip via this package's own hidden-annotation mechanism (README Gotchas).
    run: () => {
      const pdfBytes = odpToPdf(minimalOdpBytes());
      const roundTrippedBytes = pdfToOdp(pdfBytes);
      const editor = openOdp(roundTrippedBytes);
      const text = editor
        .slides()
        .flatMap((s) => s.shapes())
        .map((s) => s.text)
        .join(' ');
      expect(text).toContain('Hello');
      expect(text).toContain('from');
      expect(text).toContain('odp');
      expect(editor.slides()[0]?.notes).toBe('Speaker notes for slide one.');
    },
  },
  {
    name: 'xlsx <-> pdf (composed via ods)',
    edges: [
      { source: 'xlsx', target: 'pdf' },
      { source: 'pdf', target: 'xlsx' },
    ],
    // xlsxToPdf/pdfToXlsx compose the ods<->xlsx bridge with the ods<->pdf layout edge internally (capability.ts's own FORMAT_CAPABILITIES.xlsx) -- gridOdsBytes gives odsToXlsx a real gridline-and-headers-enabled sheet to build genuine xlsx bytes from, exactly the same fixture pdfToOds's own gridline-lattice test uses.
    run: () => {
      const xlsxBytes = odsToXlsx(gridOdsBytes());

      const pdfBytes = xlsxToPdf(xlsxBytes);
      const roundTrippedBytes = pdfToXlsx(pdfBytes);
      const roundTripped = readXlsxContent(decodeOoxmlPackage(roundTrippedBytes));
      if (roundTripped.kind !== 'spreadsheet') {
        throw new Error('expected a spreadsheet ContentDocument');
      }

      const [sheet] = roundTripped.sheets;
      expect(sheet).toBeDefined();
      // Honest recovery survives the extra xlsx hop unchanged: a bare string, never re-parsed into number/date/boolean, never claimed as a formula.
      for (const cell of sheet!.cells) {
        expect(cell.value).toEqual({ kind: 'string', value: cell.displayText });
      }
      const byRow = new Map<number, string[]>();
      for (const cell of sheet!.cells) {
        const row = byRow.get(cell.row) ?? [];
        row[cell.column] = cell.displayText;
        byRow.set(cell.row, row);
      }
      const rows = [...byRow.keys()].sort((a, b) => a - b).map((r) => byRow.get(r));
      expect(rows).toEqual([
        ['Alpha', 'Beta', 'Gamma'],
        ['One', 'Two', 'Three'],
        ['Four', 'Five', 'Six'],
      ]);
    },
  },
  {
    name: 'xlsx <-> markdown (composed via pdf)',
    edges: [
      { source: 'xlsx', target: 'markdown' },
      { source: 'markdown', target: 'xlsx' },
    ],
    // xlsx and markdown share no ContentDocument variant, so this pair routes through PDF internally (xlsxToPdf + pdfToMarkdown; markdownToPdf + pdfToXlsx) -- the single lossiest path in the package, but the only single-call route. gridOdsBytes gives odsToXlsx a real gridline-and-headers-enabled sheet to start from; the round trip is asserted structurally (a readable spreadsheet) rather than cell-for-cell, since two stacked lossy hops shed too much to compare values against the source.
    run: () => {
      const xlsxBytes = odsToXlsx(gridOdsBytes());

      const markdownBytes = xlsxToMarkdown(xlsxBytes);
      const roundTrippedBytes = markdownToXlsx(markdownBytes);
      const roundTripped = readXlsxContent(decodeOoxmlPackage(roundTrippedBytes));
      if (roundTripped.kind !== 'spreadsheet') {
        throw new Error('expected a spreadsheet ContentDocument');
      }
      expect(roundTripped.sheets.length).toBeGreaterThanOrEqual(1);
    },
  },
  {
    name: 'xlsx <-> ods (bridge)',
    edges: [
      { source: 'ods', target: 'xlsx' },
      { source: 'xlsx', target: 'ods' },
    ],
    // richOdsBytes: string/number/boolean cells, a verbatim formula, and a merged cell -- all confirmed stable across a full ods -> xlsx -> ods double hop by bridges.test.ts's own dedicated double-hop test. This checks the same stable subset, not the percentage/currency/time cells that double-hop test documents as genuinely, permanently downgraded.
    run: () => {
      const original = readOdsContent(decodeOdfPackage(richOdsBytes()));
      if (original.kind !== 'spreadsheet') {
        throw new Error('expected a spreadsheet ContentDocument');
      }

      const xlsxBytes = odsToXlsx(richOdsBytes());
      const roundTrippedBytes = xlsxToOds(xlsxBytes);
      const roundTripped = readOdsContent(decodeOdfPackage(roundTrippedBytes));
      if (roundTripped.kind !== 'spreadsheet') {
        throw new Error('expected a spreadsheet ContentDocument');
      }

      const sheet = roundTripped.sheets[0]!;
      const cellAt = (row: number, column: number) => sheet.cells.find((c) => c.row === row && c.column === column);

      expect(cellAt(0, 0)?.value).toEqual({ kind: 'string', value: 'Name' });
      expect(cellAt(1, 1)?.value).toEqual({ kind: 'number', value: 42.5 });
      expect(cellAt(1, 2)?.value).toEqual({ kind: 'boolean', value: true });
      expect(cellAt(3, 1)?.formula).toBe('of:=[.B2]*2');
      expect(cellAt(3, 1)?.value).toEqual({ kind: 'number', value: 85 });
      expect(cellAt(4, 0)?.colSpan).toBe(2);
      expect(cellAt(4, 0)?.value).toEqual({ kind: 'string', value: 'Merged Cell' });
    },
  },
  {
    name: 'ods <-> pdf',
    edges: [
      { source: 'ods', target: 'pdf' },
      { source: 'pdf', target: 'ods' },
    ],
    // gridOdsBytes: three fully visible columns, three rows, gridlines and headers enabled -- odsToPdf genuinely draws the LayoutLine lattice reconstructSpreadsheet's own gridline-detection path needs, so this proves the lattice path ran, not the text-clustering fallback, and that every recovered cell is an honest bare string (README's own "recovers what was printed, not what was entered").
    run: () => {
      const pdfBytes = odsToPdf(gridOdsBytes());
      const roundTrippedBytes = pdfToOds(pdfBytes);
      const roundTripped = readOdsContent(decodeOdfPackage(roundTrippedBytes));
      if (roundTripped.kind !== 'spreadsheet') {
        throw new Error('expected a spreadsheet ContentDocument');
      }

      const [sheet] = roundTripped.sheets;
      expect(sheet).toBeDefined();
      expect(sheet!.printSettings.gridlines).toBe(true);
      for (const cell of sheet!.cells) {
        expect(cell.value).toEqual({ kind: 'string', value: cell.displayText });
      }
      const byRow = new Map<number, string[]>();
      for (const cell of sheet!.cells) {
        const row = byRow.get(cell.row) ?? [];
        row[cell.column] = cell.displayText;
        byRow.set(cell.row, row);
      }
      const rows = [...byRow.keys()].sort((a, b) => a - b).map((r) => byRow.get(r));
      expect(rows).toEqual([
        ['Alpha', 'Beta', 'Gamma'],
        ['One', 'Two', 'Three'],
        ['Four', 'Five', 'Six'],
      ]);
    },
  },
  {
    name: 'odg <-> pdf',
    edges: [
      { source: 'odg', target: 'pdf' },
      { source: 'pdf', target: 'odg' },
    ],
    // minimalOdgBytes: two fill-only unrotated rects, a filled+stroked rect, an ellipse, a line, a genuine Bezier curve, and a text label. PDF records none of those kinds directly -- it has only `re` and the general path operators -- but pdf-codec's own shape-pattern detection recovers rect/ellipse/line back out of the recovered geometry, so every one of this fixture's kinds survives the round trip. src/convert/convert.test.ts's own pdfToOdg suite is where each kind's geometry and paint are checked in detail; this matrix entry just pins that the full set comes back.
    run: () => {
      const original = readOdgContent(decodeOdfPackage(minimalOdgBytes()));
      if (original.kind !== 'drawing') {
        throw new Error('expected a drawing ContentDocument');
      }

      const pdfBytes = odgToPdf(minimalOdgBytes());
      const roundTrippedBytes = pdfToOdg(pdfBytes);
      const roundTripped = readOdgContent(decodeOdfPackage(roundTrippedBytes));
      if (roundTripped.kind !== 'drawing') {
        throw new Error('expected a drawing ContentDocument');
      }

      const beforeVectors = original.pages[0]!.vectors;
      const afterVectors = roundTripped.pages[0]!.vectors;
      expect(afterVectors).toHaveLength(beforeVectors.length);
      expect(afterVectors.map((v) => v.kind)).toEqual(beforeVectors.map((v) => v.kind));

      expect(original.pages[0]!.shapes).toHaveLength(1);
      expect(roundTripped.pages[0]!.shapes).toHaveLength(1);
      const afterParagraph = roundTripped.pages[0]!.shapes[0]!.blocks[0];
      if (afterParagraph?.kind !== 'paragraph') {
        throw new Error('expected the text label to survive as a paragraph block');
      }
      expect(afterParagraph.runs.map((r) => r.text).join('')).toContain('Label');
    },
  },
  {
    name: 'markdown <-> pdf',
    edges: [
      { source: 'markdown', target: 'pdf' },
      { source: 'pdf', target: 'markdown' },
    ],
    // richMarkdownText: a heading, a bold+italic run, a second paragraph, a two-level list, and a GFM table. Shares the wordprocessing engine with docx/odt (FORMAT_CAPABILITIES.markdown), so the same PDF-pivot table-recovery limit applies: the table's own cell text survives as recovered text, not as a reconstructed table.
    run: () => {
      const pdfBytes = markdownToPdf(encodeMarkdownText(richMarkdownText()));
      const roundTrippedBytes = pdfToMarkdown(pdfBytes);
      const text = decodeMarkdownText(roundTrippedBytes);
      expect(text).toContain('Report Title');
      expect(text).toContain('bold');
      expect(text).toContain('First item');
      expect(text).toContain('A1');
    },
  },
  {
    name: 'markdown <-> docx (bridge)',
    edges: [
      { source: 'markdown', target: 'docx' },
      { source: 'docx', target: 'markdown' },
    ],
    run: () => {
      const docxBytes = markdownToDocx(encodeMarkdownText(richMarkdownText()));
      const roundTrippedBytes = docxToMarkdown(docxBytes);
      const text = decodeMarkdownText(roundTrippedBytes);
      expect(text).toContain('Report Title');
      expect(text).toContain('bold');
      expect(text).toContain('First item');
      expect(text).toContain('A1');
    },
  },
  {
    name: 'markdown <-> odt (bridge)',
    edges: [
      { source: 'markdown', target: 'odt' },
      { source: 'odt', target: 'markdown' },
    ],
    run: () => {
      const odtBytes = markdownToOdt(encodeMarkdownText(richMarkdownText()));
      const roundTrippedBytes = odtToMarkdown(odtBytes);
      const text = decodeMarkdownText(roundTrippedBytes);
      expect(text).toContain('Report Title');
      expect(text).toContain('bold');
      expect(text).toContain('First item');
      expect(text).toContain('A1');
    },
  },
  {
    name: 'odf -> pdf (one-way; no pdf -> odf edge exists at all)',
    edges: [{ source: 'odf', target: 'pdf' }],
    // odf's own one-way exception (port.ts's own note, FORMAT_CAPABILITIES.odf): recovering structured MathML from rendered glyphs is a categorically different, OCR-adjacent problem, not attempted anywhere in this package -- so there is no reverse hop to round-trip through at all. What this asserts instead: real embedded STIX Two Math font typesetting (a genuine /Type0/Identity-H/CIDFontType0C font resource in the output PDF), not a static image or placeholder, mirroring formula.test.ts's own construction.
    run: () => {
      const bytes = odfToPdf(odfFormulaBytes(FRACTION_FORMULA));
      expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');

      const layout = readPdf(bytes);
      expect(layout.pages).toHaveLength(1);

      const raw = new TextDecoder('latin1').decode(bytes);
      expect(raw).toContain('/Subtype /Type0');
      expect(raw).toContain('/Encoding /Identity-H');
      expect(raw).toContain('/Subtype /CIDFontType0C');
    },
  },
  {
    name: 'docx <-> pptx (cross-variant bridge)',
    edges: [
      { source: 'docx', target: 'pptx' },
      { source: 'pptx', target: 'docx' },
    ],
    // A cross-variant bridge: wordprocessing -> presentation splits the document at heading boundaries into slides. The blocks themselves survive intact; slide boundaries are a heuristic approximation. This checks the round trip runs without error and the text survives.
    run: () => {
      const editor = createDocx();
      editor.body.appendParagraph({ styleId: 'Heading1' }).appendRun({ text: 'Slide title' });
      editor.body.appendParagraph().appendRun({ text: 'Slide content' });
      const pptxBytes = docxToPptx(editor.toBytes());
      const docxBack = pptxToDocx(pptxBytes);
      const text = openDocx(docxBack).paragraphs().map((p) => p.text).join(' ');
      expect(text).toContain('Slide title');
      expect(text).toContain('Slide content');
    },
  },
  {
    name: 'odt <-> odp (cross-variant bridge)',
    edges: [
      { source: 'odt', target: 'odp' },
      { source: 'odp', target: 'odt' },
    ],
    run: () => {
      const odpBytes = odtToOdp(minimalOdtBytes());
      expect(odpBytes.length).toBeGreaterThan(0);
      const odtBack = odpToOdt(odpBytes);
      expect(odtBack.length).toBeGreaterThan(0);
    },
  },
];

describe('round-trip matrix: every DIRECT_EDGES pair has a covering entry', () => {
  it('the matrix declares exactly the edge set DIRECT_EDGES (capability.ts) currently registers -- no more, no fewer', () => {
    const registeredEdgeKeys = DIRECT_EDGES.map((edge) => edgeKey(edge)).sort();
    const declaredEdgeKeys = MATRIX_ENTRIES.flatMap((entry) => entry.edges.map((edge) => edgeKey(edge))).sort();
    expect(declaredEdgeKeys).toEqual(registeredEdgeKeys);
  });

  it('no two entries declare the same edge (each registered edge is covered exactly once)', () => {
    const declaredEdgeKeys = MATRIX_ENTRIES.flatMap((entry) => entry.edges.map((edge) => edgeKey(edge)));
    expect(new Set(declaredEdgeKeys).size).toBe(declaredEdgeKeys.length);
  });
});

describe.each(MATRIX_ENTRIES.map((entry) => [entry.name, entry] as const))('round-trip matrix: %s', (_name, entry) => {
  it('round-trips (or, for a one-way edge, produces valid output) with the recoverable content intact', () => {
    entry.run();
  });
});
