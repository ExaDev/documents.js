// The bijection corpus, split from bijection.test.ts: the shared entry/leaf helpers and corpus() itself, the hand-built coverage of every document kind and grouping signal decompose reads. constructCorpus/runExtentCorpus live in bijection-constructs.ts and are called from corpus() at test time, so the import between the two modules is deferred past module evaluation.
import { expect } from "vitest";
import { canonicalise } from "./canonicalise";
import { constructCorpus } from "./bijection-constructs";
import {
  type ContentBlock,
  type ContentDocument,
  type ContentEmbeddedObject,
} from "./content";
import { type ContentOrigin } from "./content-vocabulary";
import {
  type ContentSheetCell,
  type ContentSheetConditionalFormat,
  type ContentSheetDataValidation,
  type ContentSheetImage,
  type ContentSheetPrintSettings,
} from "./content-sheet";
import { type ContentShape, type ContentVector } from "./content-drawing";

import type { PageSize } from "./geometry";
import type { SourceResidue } from "./source";

// THE PACKAGE BOUNDARY'S MERGE GATE: the three bijection laws run over a corpus spanning every document kind, every leaf the tree vocabulary admits, and every grouping signal decompose reads. document-outline.js proved the laws property-wise over its local corpus in phase 1, and documents.js runs this same law harness over its own REAL corpus — reader outputs for every format, editors per kind, onDocument captures carrying the layout pass's real frames and pages. That corpus cannot live here: every reader in it belongs to a package that depends on this one (ooxml.js, odf.js, markdown-codec, pdf-codec), so importing it would invert the dependency the schema layer exists to keep one-way. What lives here instead is the same harness over hand-built content covering the same structural ground, and documents.js's own suite stays the gate over real format output — the two are complementary, not redundant: this one pins the transform against the schema's whole vocabulary, that one pins it against what codecs actually emit.
//
// The laws (stated on #20 and its errata, and in src/package.ts's own header): (i) flatten(assemble(c)) reproduces c exactly, up to one declared normalisation (a present-but-empty embeddedObjects array normalises to the field absent); (ii) effective-property equality universally — the flat codec-exchange form flatten produces is fully materialised (zero style refs) and structurally identical to the unfactored original, so a factored and an unfactored serialisation of one document compare equal; (iii) minting idempotence — assembling the flattened tree again (and factoring an already-factored package) mints the identical table and the identical tree. Never an identity assertion: decompose embeds the source's own node objects, so toBe would pass even for an implementation that mutated its input — structural comparison over a pre-roundtrip structuredClone snapshot is what actually pins the values, and re-comparing the source against its snapshot additionally pins that neither direction mutates the input in place.

export function canon(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(normaliseEmbeddedObjects(canonicalise(value))),
  );
}

// The bijection's one declared normalisation: decompose concatenates a sheet's images and embedded objects into a single children array and flatten rebuilds embeddedObjects only when an embedded object exists, so a present-but-empty array — schema-legal, emitted by no codec — cannot survive the round trip and normalises to the field absent. Applied to BOTH sides of every comparison so law (i) stays an equivalence over canonical forms; the direction is pinned outright in decompose.test.ts. Recursive because a sheet can sit inside an embedded document, whose own sheets can carry the same field.
export function normaliseEmbeddedObjects(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normaliseEmbeddedObjects);
  if (typeof value !== "object" || value === null) return value;
  const normalised: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "embeddedObjects" && Array.isArray(child) && child.length === 0)
      continue;
    normalised[key] = normaliseEmbeddedObjects(child);
  }
  return normalised;
}

export function expectStructurallyEqual(
  actual: unknown,
  expected: unknown,
): void {
  expect(canon(actual)).toEqual(canon(expected));
}

// True when any object anywhere in the value is a tree group wrapper — `{ node, children }`, the only shape a style ref can sit on. "The flat encoding is always fully materialised, refs live only on tree wrappers" is the invariant minting depends on and law (ii) asserts, and "no wrapper survived at all" is the strongest form of it: a ref has nowhere else to go. Stated structurally rather than as a scan for any key named `style`, because `style` is also an ordinary content field — a ContentStroke's own solid/dashed/dotted/double, which a drawing page legitimately carries and which a key-name scan would misread as a leaked ref.
export function containsGroupWrapper(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsGroupWrapper);
  if (typeof value !== "object" || value === null) return false;
  if ("node" in value && "children" in value) return true;
  return Object.values(value).some(containsGroupWrapper);
}

// One corpus entry: flat content, plus the pages a layout pass would have produced for the entries that carry fused frames (the wrapped-run case needs real per-page frames, and `pages` is what a frame's own pageIndex indexes into).
export interface CorpusEntry {
  readonly name: string;
  readonly content: ContentDocument;
  readonly pages?: readonly PageSize[];
}

// --- Shared fixture vocabulary ---------------------------------------------------------------------------

const SECTION_GEOMETRY = {
  pageSize: { widthPt: 595, heightPt: 842 },
  margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
};
export const SLIDE_SIZE = { widthPt: 960, heightPt: 540 };
const SHAPE_FRAME = { xPt: 0, yPt: 0, widthPt: 400, heightPt: 300 };
const PNG_BASE64 = "aW1hZ2U=";
const PRINT_SETTINGS: ContentSheetPrintSettings = {
  pageSize: { widthPt: 595, heightPt: 842 },
  margins: { topPt: 20, rightPt: 20, bottomPt: 20, leftPt: 20 },
  gridlines: true,
  headers: true,
  pageOrder: "downThenOver",
};

// One residue value for the corpus's per-node positions and one for its descriptor positions, so the laws pin both spellings of the channel — the field on ordinary content nodes, and the field inside a construct descriptor riding a marker pair across the boundary.
const DOCX_RESIDUE: SourceResidue = {
  format: "docx",
  xml: '<w:proofErr w:type="spellStart"/>',
};
export const GALLERY_RESIDUE: SourceResidue = {
  format: "docx",
  xml: '<w:docPartObj><w:docPartGallery w:val="Cover Pages"/></w:docPartObj>',
};

interface ParagraphOptions {
  readonly headingLevel?: number;
  readonly listLevel?: number;
  readonly numId?: string;
  readonly alignment?: "left" | "center" | "right" | "justify";
  readonly indentLeftPt?: number;
  readonly lineSpacing?: number;
  readonly styleId?: string;
  readonly sourcePath?: string;
  readonly residue?: SourceResidue;
  readonly frames?: readonly {
    pageIndex: number;
    xPt: number;
    yPt: number;
    widthPt: number;
    heightPt: number;
  }[];
  readonly bold?: boolean;
  readonly sizePt?: number;
  readonly origin?: ContentOrigin;
}

export function paragraph(
  text: string,
  options: ParagraphOptions = {},
): ContentBlock {
  return {
    kind: "paragraph",
    runs: [
      {
        text,
        ...(options.bold !== undefined ? { bold: options.bold } : {}),
        ...(options.sizePt !== undefined ? { sizePt: options.sizePt } : {}),
      },
    ],
    ...(options.headingLevel !== undefined
      ? { headingLevel: options.headingLevel }
      : {}),
    ...(options.listLevel !== undefined
      ? {
          list: {
            level: options.listLevel,
            ...(options.numId !== undefined ? { numId: options.numId } : {}),
          },
        }
      : {}),
    ...(options.alignment !== undefined
      ? { alignment: options.alignment }
      : {}),
    ...(options.indentLeftPt !== undefined
      ? { indentLeftPt: options.indentLeftPt }
      : {}),
    ...(options.lineSpacing !== undefined
      ? { lineSpacing: options.lineSpacing }
      : {}),
    ...(options.styleId !== undefined ? { styleId: options.styleId } : {}),
    ...(options.sourcePath !== undefined
      ? { sourcePath: options.sourcePath }
      : {}),
    ...(options.residue !== undefined ? { source: options.residue } : {}),
    ...(options.frames !== undefined
      ? { frames: options.frames.map((frame) => ({ ...frame })) }
      : {}),
    ...(options.origin !== undefined ? { origin: options.origin } : {}),
  };
}

export function shape(
  blocks: readonly ContentBlock[],
  overrides: Partial<ContentShape> = {},
): ContentShape {
  return {
    frame: SHAPE_FRAME,
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    ...overrides,
    blocks: [...blocks],
  };
}

export function wordprocessing(
  blocksPerSection: readonly (readonly ContentBlock[])[],
): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: blocksPerSection.map((blocks) => ({
      ...SECTION_GEOMETRY,
      blocks: [...blocks],
    })),
  };
}

// --- The corpus -------------------------------------------------------------------------------------------

export function corpus(): readonly CorpusEntry[] {
  const embeddedDrawing: ContentEmbeddedObject = {
    objectKind: "drawing",
    document: {
      kind: "drawing",
      metadata: {},
      pages: [
        {
          size: { widthPt: 300, heightPt: 300 },
          shapes: [],
          vectors: [
            {
              kind: "rect",
              frame: { xPt: 1, yPt: 2, widthPt: 3, heightPt: 4 },
            },
          ],
        },
      ],
    },
    frame: { xPt: 10, yPt: 20, widthPt: 120, heightPt: 90 },
  };
  const table: ContentBlock = {
    kind: "table",
    // A cell's own blocks stay flat in BOTH encodings — decomposition treats a table as one leaf and never descends — so the marker pair inside this cell must ride through untouched and unpromoted, which is the one place a construct is spelled the same way on both sides of the boundary.
    rows: [
      {
        cells: [
          {
            blocks: [
              paragraph("cell one"),
              {
                kind: "constructStart",
                descriptor: { kind: "field", instruction: "PAGE" },
              },
              paragraph("inside a cell construct"),
              { kind: "constructEnd" },
            ],
          },
          { blocks: [paragraph("cell two", { headingLevel: 2 })], colSpan: 2 },
        ],
      },
    ],
    columns: [{ widthPt: 80 }, { widthPt: 120 }],
  };

  const entries: CorpusEntry[] = [
    {
      name: "empty wordprocessing document (no sections at all)",
      content: wordprocessing([]),
    },
    {
      name: "wordprocessing section with no blocks",
      content: wordprocessing([[]]),
    },
    {
      name: "wordprocessing heading hierarchy with a level jump and a pop back to the root",
      content: wordprocessing([
        [
          paragraph("front matter, before any heading"),
          paragraph("Chapter", { headingLevel: 1 }),
          paragraph("under the chapter"),
          paragraph("Deep", { headingLevel: 4 }),
          paragraph("under the deep heading"),
          paragraph("Next chapter", { headingLevel: 1 }),
          paragraph("under the next chapter"),
        ],
      ]),
    },
    {
      name: "wordprocessing list nesting, closed by a plain paragraph and reopened",
      content: wordprocessing([
        [
          paragraph("item one", { listLevel: 0, numId: "n1" }),
          paragraph("item one a", { listLevel: 1, numId: "n1" }),
          paragraph("item one a i", { listLevel: 2, numId: "n1" }),
          paragraph("item two", { listLevel: 0, numId: "n1" }),
          paragraph("a plain paragraph closes the list nesting"),
          paragraph("a fresh item", { listLevel: 1, numId: "n1" }),
        ],
      ]),
    },
    {
      name: "wordprocessing with every block leaf kind the tree admits",
      content: wordprocessing([
        [
          paragraph("Chapter", { headingLevel: 1 }),
          table,
          {
            kind: "image",
            format: "png",
            base64: PNG_BASE64,
            widthPt: 100,
            heightPt: 60,
            altText: "a picture",
            // The annotation channel and the lifted-inline-image anchor pair, pinned at a block leaf: both ride the flat/tree boundary untouched (decompose embeds node objects), so the laws hold over them exactly as over every channel field beside them.
            origin: "image",
            interpretation: {
              transcript: {
                text: "revenue rose in EMEA and fell in APAC",
                confidence: "high",
                mechanism: "model",
              },
              description: "A grouped bar chart of regional revenue.",
              by: { model: "some-vision-model", at: "2026-09-10T12:00:00Z" },
            },
          },
          {
            kind: "image",
            format: "png",
            base64: PNG_BASE64,
            widthPt: 12,
            heightPt: 12,
            // An image a reader lifted out of the following paragraph's run stream, carrying where it sat.
            anchorRunIndex: 0,
            anchorOffset: 8,
          },
          { kind: "paragraph", runs: [{ text: "approved " }] },
          { kind: "pageBreak" },
          { ...embeddedDrawing, kind: "embeddedObject" },
          paragraph("after the leaves", { origin: "body" }),
        ],
      ]),
    },
    {
      name: "multi-section wordprocessing (each section resets the heading stack)",
      content: wordprocessing([
        [
          paragraph("Chapter", { headingLevel: 1 }),
          paragraph("body of chapter one"),
        ],
        [
          paragraph("Method", { headingLevel: 2 }),
          paragraph("body of chapter two"),
        ],
      ]),
    },
    {
      name: "wordprocessing with repeated direct formatting on both halves (mints paragraph and run tuples)",
      content: wordprocessing([
        [
          paragraph("one", {
            alignment: "left",
            indentLeftPt: 20,
            bold: true,
            sizePt: 12,
          }),
          paragraph("two", {
            alignment: "left",
            indentLeftPt: 20,
            bold: true,
            sizePt: 12,
          }),
          paragraph("three", {
            alignment: "left",
            indentLeftPt: 20,
            bold: true,
            sizePt: 12,
          }),
        ],
      ]),
    },
    {
      name: "wordprocessing whose repetition is nested under a heading (the ref lands on the heading group)",
      content: wordprocessing([
        [
          paragraph("intro carries no mintable key"),
          paragraph("Chapter", { headingLevel: 1, alignment: "center" }),
          paragraph("a", { alignment: "center" }),
          paragraph("b", { alignment: "center" }),
        ],
      ]),
    },
    {
      name: "wordprocessing carrying the ban-list fields alongside mintable ones",
      // styleId, sourcePath, frames, and per-node source residue repeat exactly as often as the mintable keys do, and must stay per-node throughout the round trip — minting must never factor residue into a styles entry any more than it factors a position or a path.
      content: wordprocessing([
        [
          paragraph("one", {
            styleId: "Body",
            sourcePath: "word/document.xml#p1",
            indentLeftPt: 20,
            residue: DOCX_RESIDUE,
            frames: [
              { pageIndex: 0, xPt: 72, yPt: 700, widthPt: 451, heightPt: 14 },
            ],
          }),
          paragraph("two", {
            styleId: "Body",
            sourcePath: "word/document.xml#p1",
            indentLeftPt: 20,
            residue: DOCX_RESIDUE,
            frames: [
              { pageIndex: 0, xPt: 72, yPt: 680, widthPt: 451, heightPt: 14 },
            ],
          }),
        ],
      ]),
    },
    {
      name: "wordprocessing with per-node residue on a container, a run, and a table cell, and descriptor residue inside a construct pair",
      // Every spelling of the channel in one document: source on the section container (rides the tree's section descriptor through omit+extend), on a run, on a table cell (flat in both encodings), and inside a construct descriptor (rides the marker pair's own payload across the boundary). All three laws must hold verbatim — the channel is carried, never interpreted, never factored.
      content: {
        kind: "wordprocessing",
        metadata: {},
        sections: [
          {
            ...SECTION_GEOMETRY,
            source: DOCX_RESIDUE,
            blocks: [
              {
                kind: "constructStart",
                descriptor: {
                  kind: "contentControl",
                  controlType: "richText",
                  source: GALLERY_RESIDUE,
                },
              },
              paragraph("in a degraded gallery control", {
                residue: DOCX_RESIDUE,
              }),
              { kind: "constructEnd" },
              {
                kind: "paragraph",
                runs: [{ text: "run-level residue", source: DOCX_RESIDUE }],
              },
              {
                kind: "table",
                rows: [
                  {
                    cells: [
                      { blocks: [paragraph("cell")], source: DOCX_RESIDUE },
                    ],
                  },
                ],
                columns: [{ widthPt: 100 }],
              },
            ],
          },
        ],
      },
    },
    {
      name: "wordprocessing with fused frames across two pages and a populated pages array",
      // The wrapped-run case: one paragraph rendered into two places by pagination, so its frames array names two different pages.
      content: wordprocessing([
        [
          paragraph("wraps across the page boundary", {
            frames: [
              { pageIndex: 0, xPt: 72, yPt: 90, widthPt: 451, heightPt: 14 },
              { pageIndex: 1, xPt: 72, yPt: 760, widthPt: 451, heightPt: 14 },
            ],
          }),
          paragraph("lands on the second page", {
            frames: [
              { pageIndex: 1, xPt: 72, yPt: 740, widthPt: 451, heightPt: 14 },
            ],
          }),
        ],
      ]),
      pages: [
        { widthPt: 595, heightPt: 842 },
        { widthPt: 595, heightPt: 842 },
      ],
    },
    {
      name: "wordprocessing carrying document metadata and a symbol table on the envelope",
      content: {
        kind: "wordprocessing",
        metadata: {
          title: "Envelope",
          author: "A. Author",
          keywords: ["one", "two"],
          createdIso: "2026-01-15T00:00:00Z",
        },
        symbolTable: { symbols: [], units: [] },
        sections: [{ ...SECTION_GEOMETRY, blocks: [paragraph("body")] }],
      },
    },
    {
      name: "wordprocessing section carrying page furniture in every slot (ExaDev/documents.js#1128)",
      content: {
        kind: "wordprocessing",
        metadata: {},
        sections: [
          {
            ...SECTION_GEOMETRY,
            headers: {
              default: [paragraph("header default")],
              even: [paragraph("header even")],
              first: [paragraph("header first")],
            },
            footers: {
              default: [paragraph("footer default")],
              even: [paragraph("footer even")],
            },
            blocks: [paragraph("body")],
          },
        ],
      },
    },
    {
      name: "presentation with several shapes, list nesting inside each, and a heading-styled leaf",
      content: {
        kind: "presentation",
        metadata: {},
        slides: [
          {
            size: SLIDE_SIZE,
            notes: "notes ride the slide descriptor",
            shapes: [
              shape(
                [
                  paragraph("top", { listLevel: 0 }),
                  paragraph("nested", { listLevel: 1 }),
                ],
                { name: "Body" },
              ),
              // headingLevel in a shape flow is deliberately not a grouping signal, so this paragraph stays a bare leaf carrying the field.
              shape(
                [
                  paragraph("plain"),
                  paragraph("heading-styled, still a leaf here", {
                    headingLevel: 2,
                  }),
                ],
                { rotationDeg: 15, paintOrder: 2 },
              ),
            ],
          },
          { size: SLIDE_SIZE, notes: "", shapes: [] },
        ],
      },
    },
    {
      name: "presentation with run formatting repeated across two shapes (mints on the slide wrapper)",
      content: {
        kind: "presentation",
        metadata: {},
        slides: [
          {
            size: SLIDE_SIZE,
            notes: "",
            shapes: [
              shape([paragraph("a", { bold: true, sizePt: 12 })]),
              shape([paragraph("b", { bold: true, sizePt: 12 })]),
            ],
          },
        ],
      },
    },
    {
      name: "spreadsheet with a populated grid, anchored images, and an embedded document",
      content: {
        kind: "spreadsheet",
        metadata: {},
        names: [
          { name: "Revenue", refersTo: "=Data!$B$2:$B$9" },
          { name: "Revenue", refersTo: "=Summary!$A$1", scopeSheetIndex: 1 },
          {
            name: "_xlnm.Print_Area",
            refersTo: "Data!$A$1:$B$2",
            scopeSheetIndex: 0,
          },
        ],
        sheets: [
          {
            name: "Data",
            cells: [
              {
                row: 0,
                column: 0,
                value: { kind: "string", value: "label" },
                displayText: "label",
              },
              {
                row: 0,
                column: 1,
                value: { kind: "number", value: 42.5 },
                displayText: "42.50",
                formula: "=SUM(B2:B9)",
              },
              {
                row: 1,
                column: 0,
                value: { kind: "boolean", value: true },
                displayText: "TRUE",
              },
              {
                row: 1,
                column: 1,
                value: { kind: "empty" },
                displayText: "",
                comment: { text: "a note", author: "A. Author" },
              },
            ] satisfies ContentSheetCell[],
            columns: [
              { index: 0, widthPt: 60 },
              { index: 1, hidden: true },
            ],
            rows: [{ index: 0, heightPt: 12 }],
            images: [
              {
                kind: "image",
                format: "png",
                base64: PNG_BASE64,
                widthPt: 10,
                heightPt: 10,
                anchorRow: 0,
                anchorColumn: 0,
                offsetXPt: 2,
                offsetYPt: 3,
              },
            ] satisfies ContentSheetImage[],
            printSettings: PRINT_SETTINGS,
            embeddedObjects: [embeddedDrawing],
            dataValidations: [
              {
                ranges: [
                  { startRow: 2, startColumn: 0, endRow: 2, endColumn: 0 },
                ],
                type: "list",
                formula1: '"A,B,C"',
                allowBlank: true,
                showErrorMessage: true,
                errorStyle: "stop",
                error: "Pick A, B or C.",
              },
            ] satisfies ContentSheetDataValidation[],
            conditionalFormats: [
              {
                type: "cellIs",
                ranges: [
                  { startRow: 0, startColumn: 1, endRow: 1, endColumn: 1 },
                ],
                priority: 1,
                operator: "greaterThan",
                formula1: "10",
                style: { background: { r: 0.8, g: 1, b: 0.8 } },
              },
            ] satisfies ContentSheetConditionalFormat[],
          },
          {
            name: "Empty",
            cells: [],
            columns: [],
            rows: [],
            images: [],
            printSettings: PRINT_SETTINGS,
          },
        ],
      },
    },
    {
      name: "spreadsheet whose embeddedObjects array is present but empty (the one declared normalisation)",
      content: {
        kind: "spreadsheet",
        metadata: {},
        sheets: [
          {
            name: "Declared empty",
            cells: [],
            columns: [],
            rows: [],
            images: [],
            printSettings: PRINT_SETTINGS,
            embeddedObjects: [],
          },
        ],
      },
    },
    {
      name: "drawing page with a text shape and every vector primitive",
      content: {
        kind: "drawing",
        metadata: {},
        pages: [
          {
            size: { widthPt: 300, heightPt: 300 },
            shapes: [shape([paragraph("a label on the drawing")])],
            vectors: [
              {
                kind: "rect",
                frame: { xPt: 1, yPt: 1, widthPt: 20, heightPt: 10 },
                fill: { r: 1, g: 0.5, b: 0 },
              },
              {
                kind: "ellipse",
                frame: { xPt: 30, yPt: 4, widthPt: 8, heightPt: 4 },
                rotationDeg: 30,
              },
              {
                kind: "line",
                from: { xPt: 1, yPt: 20 },
                to: { xPt: 10, yPt: 20 },
                stroke: {
                  color: { r: 0, g: 0, b: 0 },
                  widthPt: 1,
                  style: "dashed",
                },
              },
              {
                kind: "path",
                frame: { xPt: 0, yPt: 30, widthPt: 20, heightPt: 10 },
                subpaths: [
                  {
                    start: { xPt: 0, yPt: 0 },
                    segments: [
                      { kind: "line", to: { xPt: 10, yPt: 0 } },
                      {
                        kind: "cubic",
                        control1: { xPt: 20, yPt: 0 },
                        control2: { xPt: 20, yPt: 10 },
                        to: { xPt: 10, yPt: 10 },
                      },
                    ],
                    closed: true,
                  },
                ],
                fillRule: "evenodd",
              },
            ] satisfies ContentVector[],
          },
          { size: { widthPt: 300, heightPt: 300 }, shapes: [], vectors: [] },
        ],
      },
    },
    {
      name: "formula document (the one tree shape with no container)",
      content: {
        kind: "formula",
        metadata: {},
        formula: {
          mathml: [
            {
              type: "element",
              tag: "math",
              attributes: [],
              children: [{ type: "text", value: "a/b" }],
            },
          ],
          starMath: "{a} over {b}",
          presentation: { latex: "\\frac{a}{b}" },
          provenance: { source: "odf:content.xml#Object1", editTrail: [] },
        },
      },
    },
  ];
  entries.push(...constructCorpus());
  return entries;
}
