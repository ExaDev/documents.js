import type {
  ContentBlock,
  ContentDocument,
  ContentTable,
  ContentTableCell,
} from "document-schema.js";
import { tableGridColumnCount, walkTableGrid } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { DOCUMENT_FORMAT_CODECS } from "../codecs/registry";
import type { DocumentFormat } from "./port";

// The one cross-format check that ContentTableCell's grid rule actually holds in practice (ExaDev/documents.js#1316): every format's own reader and writer is driven from the SAME merged table here, so a codec that reverts to the sparse shape for a horizontal merge, or that pads a row it was handed, fails here rather than at whichever downstream consumer happens to notice first. The rule under test is stated once, on ContentTableCell in document-schema.js: a row holds exactly one cell per grid column, a merged region is an anchor carrying the spans plus a block-less cell at every position it covers, and array index is grid column.
//
// The format list is taken from DOCUMENT_FORMAT_CODECS rather than written out here, so a format added to the registry is covered by this suite the day it lands instead of the day someone remembers to add it. Which of those formats each case actually exercises is decided by the capability table below, and the completeness check at the end holds every registry entry to having an explicit entry there: a new format cannot be silently skipped, only deliberately excluded with a stated reason.

const PAGE = { widthPt: 612, heightPt: 792 };
const MARGINS = { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 };
const SLIDE = { widthPt: 720, heightPt: 540 };
const COLUMN_WIDTH_PT = 120;

function textCell(
  text: string,
  spans: { colSpan?: number; rowSpan?: number } = {},
): ContentTableCell {
  return { blocks: [{ kind: "paragraph", runs: [{ text }] }], ...spans };
}

function coveredCell(): ContentTableCell {
  return { blocks: [] };
}

function tableOf(rows: readonly (readonly ContentTableCell[])[]): ContentTable {
  const columnCount = Math.max(...rows.map((row) => row.length));
  return {
    kind: "table",
    rows: rows.map((cells) => ({ cells: [...cells] })),
    columnWidthsPt: Array.from({ length: columnCount }, () => COLUMN_WIDTH_PT),
  };
}

function wordprocessingDocument(table: ContentTable): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: [{ pageSize: PAGE, margins: MARGINS, blocks: [table] }],
  };
}

function presentationDocument(table: ContentTable): ContentDocument {
  return {
    kind: "presentation",
    metadata: {},
    slides: [
      {
        size: SLIDE,
        notes: "",
        shapes: [
          {
            frame: { xPt: 36, yPt: 36, widthPt: 480, heightPt: 240 },
            insetLeftPt: 0,
            insetTopPt: 0,
            insetRightPt: 0,
            insetBottomPt: 0,
            blocks: [table],
          },
        ],
      },
    ],
  };
}

// Every table anywhere in a document, whatever envelope it arrived in, so a reader that nests the table one layer deeper than its writer put it is still found rather than silently skipped.
function tablesOf(document: ContentDocument): ContentTable[] {
  const found: ContentTable[] = [];
  const walkBlocks = (blocks: readonly ContentBlock[]): void => {
    for (const block of blocks) {
      if (block.kind === "table") {
        found.push(block);
        for (const row of block.rows) {
          for (const cell of row.cells) {
            walkBlocks(cell.blocks);
          }
        }
      }
    }
  };
  if (document.kind === "wordprocessing") {
    for (const section of document.sections) {
      walkBlocks(section.blocks);
    }
  }
  if (document.kind === "presentation") {
    for (const slide of document.slides) {
      for (const shape of slide.shapes) {
        walkBlocks(shape.blocks);
      }
    }
  }
  return found;
}

function firstTable(document: ContentDocument): ContentTable {
  const tables = tablesOf(document);
  const table = tables[0];
  if (table === undefined) {
    throw new Error("the round trip produced a document holding no table");
  }
  return table;
}

function cellText(cell: ContentTableCell): string {
  return cell.blocks
    .flatMap((block) =>
      block.kind === "paragraph" ? block.runs.map((run) => run.text) : [],
    )
    .join("");
}

// The grid as a consumer indexing by column actually sees it: one string per grid position, an anchor's own text at its anchor position and the empty string at every position it covers. This is the value every format is held to, and it is the whole point of the rule -- two readers agreeing here is exactly what "the same merged table has one shape whatever it came from" means.
function gridText(table: ContentTable): string[][] {
  return table.rows.map((row) => row.cells.map(cellText));
}

function spanShape(table: ContentTable): string[][] {
  return walkTableGrid(table).map((row) =>
    row.map((position) =>
      position.anchorRowIndex === undefined
        ? `anchor ${position.cell.colSpan ?? 1}x${position.cell.rowSpan ?? 1}`
        : `covered by ${position.anchorRowIndex},${position.anchorColumnIndex}`,
    ),
  );
}

// A table every format can hold: three grid columns, a header merging the first two, and a vertically merged cell below it. Its own shape is the rule's worked example -- the header row has THREE entries for two visible cells, which is the exact thing a consumer written for the sparse convention got wrong (ExaDev/documents.js#1316's own "Region,Revenue,," report, pinned as its own case below).
function mergedTable(): ContentTable {
  return tableOf([
    [textCell("Region", { colSpan: 2 }), coveredCell(), textCell("Revenue")],
    [textCell("North", { rowSpan: 2 }), textCell("Q1"), textCell("10")],
    [coveredCell(), textCell("Q2"), textCell("20")],
  ]);
}

// A region covering two columns AND two rows, the case that distinguishes a reader deriving coverage properly from one handling each axis on its own.
function blockMergedTable(): ContentTable {
  return tableOf([
    [
      textCell("Block", { colSpan: 2, rowSpan: 2 }),
      coveredCell(),
      textCell("a"),
    ],
    [coveredCell(), coveredCell(), textCell("b")],
    [textCell("c"), textCell("d"), textCell("e")],
  ]);
}

type Envelope = "wordprocessing" | "presentation";

interface FormatCase {
  // Whether this format's own writer can state a merge at all. A format that cannot still has to hold the grid's shape: it writes the region's content once and keeps every grid position, so the table stays the right width and the anchor's text is not duplicated across the positions it covered.
  readonly spans: "stated" | "dropped";
  readonly envelope: Envelope;
  // What this format's writer does with a table whose covered position carries blocks of its own, which the grid rule forbids because a region's content belongs to its anchor. "refuses" throws rather than write a file that has lost the content; "keeps" is a format with no merge record at all, whose writer places every entry at its own grid position and so loses nothing, reporting the fault through its own diagnostic sink instead.
  readonly coveredContent: "refuses" | "keeps";
}

// Why a registry format is not exercised here. A spreadsheet or drawing format has no ContentTable to round-trip at all -- a sheet's merges live on ContentSheetCell, a separate sparse model the grid rule deliberately does not govern -- and a read-only format has no writer to round-trip through.
const EXCLUDED: Readonly<Partial<Record<DocumentFormat, string>>> = {
  ods: "spreadsheet: merges live on ContentSheetCell, not ContentTable",
  xls: "spreadsheet: merges live on ContentSheetCell, not ContentTable",
  xlsx: "spreadsheet: merges live on ContentSheetCell, not ContentTable",
  csv: "spreadsheet: a flat record list with no cell spans at all",
  odg: "drawing: holds vector shapes, not a block flow with tables",
  svg: "drawing: holds vector shapes, not a block flow with tables",
  odf: "formula: a standalone equation document, and read-only here",
  pdf: "layout: its codec carries a LayoutDocument, not a ContentDocument",
  wpd: "read-only: no writer to round-trip a table through",
};

const FORMATS: Readonly<Partial<Record<DocumentFormat, FormatCase>>> = {
  docx: {
    spans: "stated",
    envelope: "wordprocessing",
    coveredContent: "refuses",
  },
  odt: {
    spans: "stated",
    envelope: "wordprocessing",
    coveredContent: "refuses",
  },
  rtf: {
    spans: "stated",
    envelope: "wordprocessing",
    coveredContent: "refuses",
  },
  doc: {
    spans: "stated",
    envelope: "wordprocessing",
    coveredContent: "refuses",
  },
  epub: {
    spans: "stated",
    envelope: "wordprocessing",
    coveredContent: "refuses",
  },
  markdown: {
    spans: "stated",
    envelope: "wordprocessing",
    coveredContent: "refuses",
  },
  pptx: {
    spans: "stated",
    envelope: "presentation",
    coveredContent: "refuses",
  },
  odp: {
    spans: "stated",
    envelope: "presentation",
    coveredContent: "refuses",
  },
  // The legacy binary presentation format has no merge record of any kind, so its writer reports a dropped span rather than inventing one; the grid itself still survives.
  ppt: { spans: "dropped", envelope: "presentation", coveredContent: "keeps" },
};

function writeThrough(
  format: DocumentFormat,
  table: ContentTable,
): () => Uint8Array {
  const entry = FORMATS[format];
  if (entry === undefined) {
    throw new Error(`no conformance case declared for ${format}`);
  }
  const codec = DOCUMENT_FORMAT_CODECS[format].content;
  const write = codec?.write?.bind(codec);
  if (write === undefined) {
    throw new Error(`${format} has no content writer to round-trip through`);
  }
  const document =
    entry.envelope === "wordprocessing"
      ? wordprocessingDocument(table)
      : presentationDocument(table);
  return () => write(document);
}

function roundTrip(format: DocumentFormat, table: ContentTable): ContentTable {
  const codec = DOCUMENT_FORMAT_CODECS[format].content;
  if (codec === undefined) {
    throw new Error(`${format} has no content codec`);
  }
  return firstTable(codec.read(writeThrough(format, table)()));
}

const CASES = Object.entries(FORMATS) as [DocumentFormat, FormatCase][];

describe("every format reads back a merged table on the same grid", () => {
  it.each(CASES)("%s holds one cell per grid column", (format) => {
    const source = mergedTable();
    const read = roundTrip(format, source);
    expect(tableGridColumnCount(read)).toBe(tableGridColumnCount(source));
    expect(read.rows.map((row) => row.cells.length)).toEqual(
      source.rows.map((row) => row.cells.length),
    );
  });

  it.each(CASES)(
    "%s puts each cell's text at its own grid column",
    (format) => {
      expect(gridText(roundTrip(format, mergedTable()))).toEqual(
        gridText(mergedTable()),
      );
    },
  );

  it.each(CASES)(
    "%s leaves every covered position without blocks",
    (format) => {
      const read = roundTrip(format, mergedTable());
      for (const row of walkTableGrid(read)) {
        for (const position of row) {
          if (position.anchorRowIndex !== undefined) {
            expect(position.cell.blocks).toEqual([]);
          }
        }
      }
    },
  );

  const SPAN_STATING = CASES.filter(([, entry]) => entry.spans === "stated");

  it.each(SPAN_STATING)("%s reads back the same spans", (format) => {
    expect(spanShape(roundTrip(format, mergedTable()))).toEqual(
      spanShape(mergedTable()),
    );
  });

  it.each(SPAN_STATING)(
    "%s reads back a region spanning both axes",
    (format) => {
      const read = roundTrip(format, blockMergedTable());
      expect(spanShape(read)).toEqual(spanShape(blockMergedTable()));
      expect(gridText(read)).toEqual(gridText(blockMergedTable()));
    },
  );

  // The defect the rule was written for: a three-column table whose header merges two columns read back with a phantom column, because a consumer built for the sparse convention padded colSpan - 1 placeholders onto a row that already had them. Under the rule the header row is three entries whatever format it came from, so there is nothing left to pad: a consumer takes the array as it stands.
  it.each(CASES)(
    "%s reads the merged header as three columns, not four",
    (format) => {
      const read = roundTrip(format, mergedTable());
      expect(read.rows[0]?.cells.length).toBe(3);
      expect(read.rows[0]?.cells.map(cellText)).toEqual([
        "Region",
        "",
        "Revenue",
      ]);
    },
  );

  it("states a case or an exclusion for every format in the registry", () => {
    const registered = Object.keys(DOCUMENT_FORMAT_CODECS).sort();
    const accounted = [
      ...Object.keys(FORMATS),
      ...Object.keys(EXCLUDED),
    ].sort();
    expect(accounted).toEqual(registered);
  });
});

// A merged header whose covered position carries a second copy of content, the one thing the grid rule says has nowhere to go: the region's content belongs to its anchor, so a covered position holding blocks is a table that contradicts the rule (ExaDev/documents.js#1367). Before the shared check each writer had its own opinion of this input, and all but one silently dropped the blocks.
function coveredContentTable(): ContentTable {
  return tableOf([[textCell("Region", { colSpan: 2 }), textCell("stray")]]);
}

describe("every format refuses or reports a table whose covered position carries content", () => {
  it.each(CASES.filter(([, entry]) => entry.coveredContent === "refuses"))(
    "%s refuses to write it, rather than silently losing the covered content",
    (format) => {
      expect(writeThrough(format, coveredContentTable())).toThrow();
    },
  );

  it.each(CASES.filter(([, entry]) => entry.coveredContent === "keeps"))(
    "%s writes every entry at its own grid position, so the covered content survives",
    (format) => {
      expect(gridText(roundTrip(format, coveredContentTable()))[0]).toEqual([
        "Region",
        "stray",
      ]);
    },
  );
});

describe("every format's readers agree with each other", () => {
  // The cross-format half of the rule: it is not enough that each format round-trips itself consistently, since a format could be self-consistently wrong. Every reader's own view of the same merged table has to be one view.
  it("reads one grid from every format that states spans", () => {
    const shapes = CASES.filter(([, entry]) => entry.spans === "stated").map(
      ([format]) => ({
        format,
        grid: gridText(roundTrip(format, mergedTable())),
        spans: spanShape(roundTrip(format, mergedTable())),
      }),
    );
    const first = shapes[0];
    if (first === undefined) {
      throw new Error("no span-stating format to compare against");
    }
    for (const shape of shapes) {
      expect({ format: shape.format, grid: shape.grid }).toEqual({
        format: shape.format,
        grid: first.grid,
      });
      expect({ format: shape.format, spans: shape.spans }).toEqual({
        format: shape.format,
        spans: first.spans,
      });
    }
  });
});
