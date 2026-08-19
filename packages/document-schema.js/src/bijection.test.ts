import { describe, expect, it } from 'vitest';
import { canonicalise } from './canonicalise';
import type { ConstructDescriptor } from './construct';
import {
  ContentDocumentSchema,
  type ContentBlock,
  type ContentDocument,
  type ContentEmbeddedObject,
  type ContentSheetCell,
  type ContentSheetImage,
  type ContentSheetPrintSettings,
  type ContentShape,
  type ContentVector,
} from './content';
import { assemblePackage, factorStyles } from './factor-styles';
import { flattenPackage } from './flatten';
import type { PageSize } from './geometry';
import { DocumentPackageSchema, type DocumentPackage } from './package';

// THE PACKAGE BOUNDARY'S MERGE GATE: the three bijection laws run over a corpus spanning every document kind, every leaf the tree vocabulary admits, and every grouping signal decompose reads. document-outline.js proved the laws property-wise over its local corpus in phase 1, and documents.js runs this same law harness over its own REAL corpus -- reader outputs for every format, editors per kind, onDocument captures carrying the layout pass's real frames and pages. That corpus cannot live here: every reader in it belongs to a package that depends on this one (ooxml.js, odf.js, markdown-codec, pdf-codec), so importing it would invert the dependency the schema layer exists to keep one-way. What lives here instead is the same harness over hand-built content covering the same structural ground, and documents.js's own suite stays the gate over real format output -- the two are complementary, not redundant: this one pins the transform against the schema's whole vocabulary, that one pins it against what codecs actually emit.
//
// The laws (stated on #20 and its errata, and in src/package.ts's own header): (i) flatten(assemble(c)) reproduces c exactly, up to one declared normalisation (a present-but-empty embeddedObjects array normalises to the field absent); (ii) effective-property equality universally -- the flat codec-exchange form flatten produces is fully materialised (zero style refs) and structurally identical to the unfactored original, so a factored and an unfactored serialisation of one document compare equal; (iii) minting idempotence -- assembling the flattened tree again (and factoring an already-factored package) mints the identical table and the identical tree. Never an identity assertion: decompose embeds the source's own node objects, so toBe would pass even for an implementation that mutated its input -- structural comparison over a pre-roundtrip structuredClone snapshot is what actually pins the values, and re-comparing the source against its snapshot additionally pins that neither direction mutates the input in place.

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

// True when any object anywhere in the value is a tree group wrapper -- `{ node, children }`, the only shape a style ref can sit on. "The flat encoding is always fully materialised, refs live only on tree wrappers" is the invariant minting depends on and law (ii) asserts, and "no wrapper survived at all" is the strongest form of it: a ref has nowhere else to go. Stated structurally rather than as a scan for any key named `style`, because `style` is also an ordinary content field -- a ContentStroke's own solid/dashed/dotted/double, which a drawing page legitimately carries and which a key-name scan would misread as a leaked ref.
function containsGroupWrapper(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsGroupWrapper);
  if (typeof value !== 'object' || value === null) return false;
  if ('node' in value && 'children' in value) return true;
  return Object.values(value).some(containsGroupWrapper);
}

// One corpus entry: flat content, plus the pages a layout pass would have produced for the entries that carry fused frames (the wrapped-run case needs real per-page frames, and `pages` is what a frame's own pageIndex indexes into).
interface CorpusEntry {
  readonly name: string;
  readonly content: ContentDocument;
  readonly pages?: readonly PageSize[];
}

// --- Shared fixture vocabulary ---------------------------------------------------------------------------

const SECTION_GEOMETRY = { pageSize: { widthPt: 595, heightPt: 842 }, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 } };
const SLIDE_SIZE = { widthPt: 960, heightPt: 540 };
const SHAPE_FRAME = { xPt: 0, yPt: 0, widthPt: 400, heightPt: 300 };
const PNG_BASE64 = 'aW1hZ2U=';
const PRINT_SETTINGS: ContentSheetPrintSettings = {
  pageSize: { widthPt: 595, heightPt: 842 },
  margins: { topPt: 20, rightPt: 20, bottomPt: 20, leftPt: 20 },
  gridlines: true,
  headers: true,
  pageOrder: 'downThenOver',
};

interface ParagraphOptions {
  readonly headingLevel?: number;
  readonly listLevel?: number;
  readonly numId?: string;
  readonly alignment?: 'left' | 'center' | 'right' | 'justify';
  readonly indentLeftPt?: number;
  readonly lineSpacing?: number;
  readonly styleId?: string;
  readonly sourcePath?: string;
  readonly frames?: readonly { pageIndex: number; xPt: number; yPt: number; widthPt: number; heightPt: number }[];
  readonly bold?: boolean;
  readonly sizePt?: number;
}

function paragraph(text: string, options: ParagraphOptions = {}): ContentBlock {
  return {
    kind: 'paragraph',
    runs: [{ text, ...(options.bold !== undefined ? { bold: options.bold } : {}), ...(options.sizePt !== undefined ? { sizePt: options.sizePt } : {}) }],
    ...(options.headingLevel !== undefined ? { headingLevel: options.headingLevel } : {}),
    ...(options.listLevel !== undefined ? { list: { level: options.listLevel, ...(options.numId !== undefined ? { numId: options.numId } : {}) } } : {}),
    ...(options.alignment !== undefined ? { alignment: options.alignment } : {}),
    ...(options.indentLeftPt !== undefined ? { indentLeftPt: options.indentLeftPt } : {}),
    ...(options.lineSpacing !== undefined ? { lineSpacing: options.lineSpacing } : {}),
    ...(options.styleId !== undefined ? { styleId: options.styleId } : {}),
    ...(options.sourcePath !== undefined ? { sourcePath: options.sourcePath } : {}),
    ...(options.frames !== undefined ? { frames: options.frames.map((frame) => ({ ...frame })) } : {}),
  };
}

function shape(blocks: readonly ContentBlock[], overrides: Partial<ContentShape> = {}): ContentShape {
  return { frame: SHAPE_FRAME, insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0, ...overrides, blocks: [...blocks] };
}

function wordprocessing(blocksPerSection: readonly (readonly ContentBlock[])[]): ContentDocument {
  return { kind: 'wordprocessing', metadata: {}, sections: blocksPerSection.map((blocks) => ({ ...SECTION_GEOMETRY, blocks: [...blocks] })) };
}

// --- The corpus -------------------------------------------------------------------------------------------

function corpus(): readonly CorpusEntry[] {
  const embeddedDrawing: ContentEmbeddedObject = {
    objectKind: 'drawing',
    document: { kind: 'drawing', metadata: {}, pages: [{ size: { widthPt: 300, heightPt: 300 }, shapes: [], vectors: [{ kind: 'rect', frame: { xPt: 1, yPt: 2, widthPt: 3, heightPt: 4 } }] }] },
    frame: { xPt: 10, yPt: 20, widthPt: 120, heightPt: 90 },
  };
  const table: ContentBlock = {
    kind: 'table',
    // A cell's own blocks stay flat in BOTH encodings -- decomposition treats a table as one leaf and never descends -- so the marker pair inside this cell must ride through untouched and unpromoted, which is the one place a construct is spelled the same way on both sides of the boundary.
    rows: [
      {
        cells: [
          { blocks: [paragraph('cell one'), { kind: 'constructStart', descriptor: { kind: 'field', instruction: 'PAGE' } }, paragraph('inside a cell construct'), { kind: 'constructEnd' }] },
          { blocks: [paragraph('cell two', { headingLevel: 2 })], colSpan: 2 },
        ],
      },
    ],
    columnWidthsPt: [80, 120],
  };

  const entries: CorpusEntry[] = [
    { name: 'empty wordprocessing document (no sections at all)', content: wordprocessing([]) },
    { name: 'wordprocessing section with no blocks', content: wordprocessing([[]]) },
    {
      name: 'wordprocessing heading hierarchy with a level jump and a pop back to the root',
      content: wordprocessing([[
        paragraph('front matter, before any heading'),
        paragraph('Chapter', { headingLevel: 1 }),
        paragraph('under the chapter'),
        paragraph('Deep', { headingLevel: 4 }),
        paragraph('under the deep heading'),
        paragraph('Next chapter', { headingLevel: 1 }),
        paragraph('under the next chapter'),
      ]]),
    },
    {
      name: 'wordprocessing list nesting, closed by a plain paragraph and reopened',
      content: wordprocessing([[
        paragraph('item one', { listLevel: 0, numId: 'n1' }),
        paragraph('item one a', { listLevel: 1, numId: 'n1' }),
        paragraph('item one a i', { listLevel: 2, numId: 'n1' }),
        paragraph('item two', { listLevel: 0, numId: 'n1' }),
        paragraph('a plain paragraph closes the list nesting'),
        paragraph('a fresh item', { listLevel: 1, numId: 'n1' }),
      ]]),
    },
    {
      name: 'wordprocessing with every block leaf kind the tree admits',
      content: wordprocessing([[
        paragraph('Chapter', { headingLevel: 1 }),
        table,
        { kind: 'image', format: 'png', base64: PNG_BASE64, widthPt: 100, heightPt: 60, altText: 'a picture' },
        { kind: 'pageBreak' },
        { ...embeddedDrawing, kind: 'embeddedObject' },
        paragraph('after the leaves'),
      ]]),
    },
    {
      name: 'multi-section wordprocessing (each section resets the heading stack)',
      content: wordprocessing([
        [paragraph('Chapter', { headingLevel: 1 }), paragraph('body of chapter one')],
        [paragraph('Method', { headingLevel: 2 }), paragraph('body of chapter two')],
      ]),
    },
    {
      name: 'wordprocessing with repeated direct formatting on both halves (mints paragraph and run tuples)',
      content: wordprocessing([[
        paragraph('one', { alignment: 'left', indentLeftPt: 20, bold: true, sizePt: 12 }),
        paragraph('two', { alignment: 'left', indentLeftPt: 20, bold: true, sizePt: 12 }),
        paragraph('three', { alignment: 'left', indentLeftPt: 20, bold: true, sizePt: 12 }),
      ]]),
    },
    {
      name: 'wordprocessing whose repetition is nested under a heading (the ref lands on the heading group)',
      content: wordprocessing([[
        paragraph('intro carries no mintable key'),
        paragraph('Chapter', { headingLevel: 1, alignment: 'center' }),
        paragraph('a', { alignment: 'center' }),
        paragraph('b', { alignment: 'center' }),
      ]]),
    },
    {
      name: 'wordprocessing carrying the ban-list fields alongside mintable ones',
      // styleId, sourcePath, and frames repeat exactly as often as the mintable keys do, and must stay per-node throughout the round trip.
      content: wordprocessing([[
        paragraph('one', { styleId: 'Body', sourcePath: 'word/document.xml#p1', indentLeftPt: 20, frames: [{ pageIndex: 0, xPt: 72, yPt: 700, widthPt: 451, heightPt: 14 }] }),
        paragraph('two', { styleId: 'Body', sourcePath: 'word/document.xml#p1', indentLeftPt: 20, frames: [{ pageIndex: 0, xPt: 72, yPt: 680, widthPt: 451, heightPt: 14 }] }),
      ]]),
    },
    {
      name: 'wordprocessing with fused frames across two pages and a populated pages array',
      // The wrapped-run case: one paragraph rendered into two places by pagination, so its frames array names two different pages.
      content: wordprocessing([[
        paragraph('wraps across the page boundary', { frames: [{ pageIndex: 0, xPt: 72, yPt: 90, widthPt: 451, heightPt: 14 }, { pageIndex: 1, xPt: 72, yPt: 760, widthPt: 451, heightPt: 14 }] }),
        paragraph('lands on the second page', { frames: [{ pageIndex: 1, xPt: 72, yPt: 740, widthPt: 451, heightPt: 14 }] }),
      ]]),
      pages: [{ widthPt: 595, heightPt: 842 }, { widthPt: 595, heightPt: 842 }],
    },
    {
      name: 'wordprocessing carrying document metadata and a symbol table on the envelope',
      content: {
        kind: 'wordprocessing',
        metadata: { title: 'Envelope', author: 'A. Author', keywords: ['one', 'two'], createdIso: '2026-01-15T00:00:00Z' },
        symbolTable: { symbols: [], units: [] },
        sections: [{ ...SECTION_GEOMETRY, blocks: [paragraph('body')] }],
      },
    },
    {
      name: 'presentation with several shapes, list nesting inside each, and a heading-styled leaf',
      content: {
        kind: 'presentation',
        metadata: {},
        slides: [
          {
            size: SLIDE_SIZE,
            notes: 'notes ride the slide descriptor',
            shapes: [
              shape([paragraph('top', { listLevel: 0 }), paragraph('nested', { listLevel: 1 })], { name: 'Body' }),
              // headingLevel in a shape flow is deliberately not a grouping signal, so this paragraph stays a bare leaf carrying the field.
              shape([paragraph('plain'), paragraph('heading-styled, still a leaf here', { headingLevel: 2 })], { rotationDeg: 15, paintOrder: 2 }),
            ],
          },
          { size: SLIDE_SIZE, notes: '', shapes: [] },
        ],
      },
    },
    {
      name: 'presentation with run formatting repeated across two shapes (mints on the slide wrapper)',
      content: {
        kind: 'presentation',
        metadata: {},
        slides: [{
          size: SLIDE_SIZE,
          notes: '',
          shapes: [shape([paragraph('a', { bold: true, sizePt: 12 })]), shape([paragraph('b', { bold: true, sizePt: 12 })])],
        }],
      },
    },
    {
      name: 'spreadsheet with a populated grid, anchored images, and an embedded document',
      content: {
        kind: 'spreadsheet',
        metadata: {},
        sheets: [
          {
            name: 'Data',
            cells: [
              { row: 0, column: 0, value: { kind: 'string', value: 'label' }, displayText: 'label' },
              { row: 0, column: 1, value: { kind: 'number', value: 42.5 }, displayText: '42.50', formula: '=SUM(B2:B9)' },
              { row: 1, column: 0, value: { kind: 'boolean', value: true }, displayText: 'TRUE' },
              { row: 1, column: 1, value: { kind: 'empty' }, displayText: '', comment: { text: 'a note', author: 'A. Author' } },
            ] satisfies ContentSheetCell[],
            columns: [{ index: 0, widthPt: 60 }, { index: 1, hidden: true }],
            rows: [{ index: 0, heightPt: 12 }],
            images: [{ kind: 'image', format: 'png', base64: PNG_BASE64, widthPt: 10, heightPt: 10, anchorRow: 0, anchorColumn: 0, offsetXPt: 2, offsetYPt: 3 }] satisfies ContentSheetImage[],
            printSettings: PRINT_SETTINGS,
            embeddedObjects: [embeddedDrawing],
          },
          { name: 'Empty', cells: [], columns: [], rows: [], images: [], printSettings: PRINT_SETTINGS },
        ],
      },
    },
    {
      name: 'spreadsheet whose embeddedObjects array is present but empty (the one declared normalisation)',
      content: {
        kind: 'spreadsheet',
        metadata: {},
        sheets: [{ name: 'Declared empty', cells: [], columns: [], rows: [], images: [], printSettings: PRINT_SETTINGS, embeddedObjects: [] }],
      },
    },
    {
      name: 'drawing page with a text shape and every vector primitive',
      content: {
        kind: 'drawing',
        metadata: {},
        pages: [
          {
            size: { widthPt: 300, heightPt: 300 },
            shapes: [shape([paragraph('a label on the drawing')])],
            vectors: [
              { kind: 'rect', frame: { xPt: 1, yPt: 1, widthPt: 20, heightPt: 10 }, fill: { r: 1, g: 0.5, b: 0 } },
              { kind: 'ellipse', frame: { xPt: 30, yPt: 4, widthPt: 8, heightPt: 4 }, rotationDeg: 30 },
              { kind: 'line', from: { xPt: 1, yPt: 20 }, to: { xPt: 10, yPt: 20 }, stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: 'dashed' } },
              {
                kind: 'path',
                frame: { xPt: 0, yPt: 30, widthPt: 20, heightPt: 10 },
                subpaths: [{ start: { xPt: 0, yPt: 0 }, segments: [{ kind: 'line', to: { xPt: 10, yPt: 0 } }, { kind: 'cubic', control1: { xPt: 20, yPt: 0 }, control2: { xPt: 20, yPt: 10 }, to: { xPt: 10, yPt: 10 } }], closed: true }],
                fillRule: 'evenodd',
              },
            ] satisfies ContentVector[],
          },
          { size: { widthPt: 300, heightPt: 300 }, shapes: [], vectors: [] },
        ],
      },
    },
    {
      name: 'formula document (the one tree shape with no container)',
      content: {
        kind: 'formula',
        metadata: {},
        formula: {
          mathml: [{ type: 'element', tag: 'math', attributes: [], children: [{ type: 'text', value: 'a/b' }] }],
          starMath: '{a} over {b}',
          presentation: { latex: '\\frac{a}{b}' },
          provenance: { source: 'odf:content.xml#Object1', editTrail: [] },
        },
      },
    },
  ];
  entries.push(...constructCorpus());
  return entries;
}

// --- The construct-boundary corpus ------------------------------------------------------------------------

// 4.2.0 gave ContentBlock the constructStart/constructEnd marker pair, so a construct boundary is a flat-form signal decompose promotes to a construct group and flatten reproduces, exactly like a heading level or a list level. One entry per placement, so a failure names the case.

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
      content: { kind: 'presentation', metadata: {}, slides: [{ size: SLIDE_SIZE, shapes: [shapeWithConstruct], notes: '' }] },
    },
    {
      name: 'construct inside a drawing page shape flow',
      content: { kind: 'drawing', metadata: {}, pages: [{ size: { widthPt: 300, heightPt: 300 }, shapes: [shapeWithConstruct], vectors: [] }] },
    },
  ];
}

describe('decompose/flatten bijection laws over the schema-vocabulary corpus', () => {
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
      expect(containsGroupWrapper(flat)).toBe(false);
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

  // The gate must not pass vacuously: minting has to actually run over corpus documents, so at least one entry's tree carries a non-empty styles table and at least one wrapper ref. If this ever fails because no entry mints, the corpus has stopped exercising laws (ii) and (iii) and needs a real formatting-repetition fixture, not a weakened assertion.
  it('the corpus exercises real minting (at least one entry carries a styles table)', () => {
    const minting = corpus().filter((entry) => Object.keys(assemblePackage(entry.content, entry.pages).styles ?? {}).length > 0);
    expect(minting.length).toBeGreaterThan(0);
  });

  // The same anti-vacuity guard, narrowed to the construct entries: laws (ii) and (iii) say nothing about construct groups unless a construct group actually carries a ref, and a construct entry that minted nothing would pass all three laws while proving only that its leaves round-trip. Every construct entry except the deliberately empty one is built to mint on its own construct wrapper, so this pins that the promotion and minting really do compose over the corpus rather than only in factor-styles.test.ts's single fixture.
  it('the construct corpus mints refs onto the construct groups themselves', () => {
    const withConstructRefs = constructCorpus().filter((entry) => constructGroupRefsOf(assemblePackage(entry.content, entry.pages)).length > 0);
    expect(withConstructRefs.map((entry) => entry.name)).toEqual(constructCorpus().filter((entry) => entry.name !== 'construct with no children (an open marker immediately closed)').map((entry) => entry.name));
  });

  // Every ContentDocument kind must be represented, or a kind could quietly stop being exercised while the suite still passed on the other four.
  it('the corpus covers every document kind', () => {
    expect([...new Set(corpus().map((entry) => entry.content.kind))].sort()).toEqual(['drawing', 'formula', 'presentation', 'spreadsheet', 'wordprocessing']);
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
