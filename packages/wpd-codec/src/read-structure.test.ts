import type {
  ContentDocument,
  ContentParagraph,
  ContentSection,
  ContentTable,
  ContentTableCell,
} from "document-schema.js";
import { describe, expect, it } from "vitest";
import { WpdDiagnosticCodes, type WpdDiagnostic } from "./diagnostics";
import { readWpdContent } from "./read";
import {
  buildWpdFile,
  embeddedSubfunction,
  eolFunction,
  summaryPacket,
  text,
  variableFunction,
  word,
  wordString,
} from "./test-support/build-wpd";

// -- The structure a WordPerfect document states about itself: its page, its tables, its styles, its outline numbering, and its own summary --
//
// Every byte sequence below is assembled from the specification's own field tables rather than captured from a file, which is what makes each expectation checkable against the SDK page it cites. See the README's "What is not yet proven" for exactly what that is and is not evidence of.

const HARD_EOL = 0xcc;
const PAGE_GROUP = 0xd1;
const COLUMN_GROUP = 0xd2;
const CHARACTER_GROUP = 0xd4;
const STYLE_GROUP = 0xdd;
const DISPLAY_NUMBER_GROUP = 0xda;
const TAB_GROUP = 0xe0;

// The End-of-Line subfunctions that bound a table's content: "10 (0x0A) Table Cell", "11 (0x0B) Table Row and Cell", "17 (0x11) Table Off".
const EOL_TABLE_CELL = 10;
const EOL_TABLE_ROW = 11;
const EOL_TABLE_OFF = 17;

// The embedded subfunctions a cell's own attributes ride in.
const ROW_INFORMATION = 0x80;
const CELL_INFORMATION = 0x84;
const CELL_SPANNING = 0x85;
const CELL_FILL_COLORS = 0x86;

function readDocumentArea(
  documentArea: readonly number[],
  packets: Parameters<typeof buildWpdFile>[1] = [],
): ContentDocument {
  return readWpdContent(buildWpdFile(documentArea, packets));
}

function readWithDiagnostics(documentArea: readonly number[]): {
  readonly document: ContentDocument;
  readonly diagnostics: WpdDiagnostic[];
} {
  const diagnostics: WpdDiagnostic[] = [];
  const document = readWpdContent(buildWpdFile(documentArea), {
    sink: (diagnostic) => diagnostics.push(diagnostic),
  });
  return { document, diagnostics };
}

function wordprocessingOf(document: ContentDocument): ContentSection[] {
  if (document.kind !== "wordprocessing") {
    throw new Error("expected a wordprocessing document");
  }
  return document.sections;
}

function sectionOf(document: ContentDocument): ContentSection {
  const section = wordprocessingOf(document)[0];
  if (section === undefined) {
    throw new Error("expected a section");
  }
  return section;
}

function paragraphsOf(document: ContentDocument): ContentParagraph[] {
  return wordprocessingOf(document)
    .flatMap((section) => section.blocks)
    .filter((block): block is ContentParagraph => block.kind === "paragraph");
}

function tablesOf(document: ContentDocument): ContentTable[] {
  return wordprocessingOf(document)
    .flatMap((section) => section.blocks)
    .filter((block): block is ContentTable => block.kind === "table");
}

function cellText(cell: ContentTableCell): string {
  return cell.blocks
    .filter((block): block is ContentParagraph => block.kind === "paragraph")
    .flatMap((paragraph) => paragraph.runs.map((run) => run.text))
    .join("");
}

function paragraphAlignment(cell: ContentTableCell): string | undefined {
  const block = cell.blocks[0];
  return block?.kind === "paragraph" ? block.alignment : undefined;
}

// The Form function's eighty-two-byte non-deletable region, per WPFF D1 Page: the desired length at offset 3, the desired width at offset 5, and the orientation at offset 8.
function pageForm(options: {
  readonly lengthWpu: number;
  readonly widthWpu: number;
  readonly orientation?: number;
}): number[] {
  const nonDeletable = new Array<number>(82).fill(0);
  nonDeletable.splice(3, 2, ...word(options.lengthWpu));
  nonDeletable.splice(5, 2, ...word(options.widthWpu));
  nonDeletable[8] = options.orientation ?? 0;
  return variableFunction({ group: PAGE_GROUP, subgroup: 0x11, nonDeletable });
}

function marginFunction(
  group: number,
  subgroup: number,
  wpu: number,
): number[] {
  return variableFunction({ group, subgroup, nonDeletable: word(wpu) });
}

// A Table Column function: "[size of non-deletable information = 17]", with the width as the word at offset 1.
function tableColumn(widthWpu: number): number[] {
  const nonDeletable = new Array<number>(17).fill(0);
  nonDeletable.splice(1, 2, ...word(widthWpu));
  return variableFunction({
    group: CHARACTER_GROUP,
    subgroup: 0x2c,
    nonDeletable,
  });
}

// Table Definition (Table On), one Table Column per column, and Define Table End -- the grid's own shape, stated before any of its content.
function tableDefinition(columnWidthsWpu: readonly number[]): number[] {
  return [
    ...variableFunction({ group: CHARACTER_GROUP, subgroup: 0x2a }),
    ...columnWidthsWpu.flatMap((width) => tableColumn(width)),
    ...variableFunction({ group: CHARACTER_GROUP, subgroup: 0x2b }),
  ];
}

// A Global On / Global Off pair, the encased spelling of a style region: "[hash of this Global On]" then "<system style number>".
function styleScope(
  systemStyleNumber: number,
  body: readonly number[],
): number[] {
  return [
    ...variableFunction({
      group: STYLE_GROUP,
      subgroup: 0x0a,
      nonDeletable: [0x00, 0x00, systemStyleNumber],
    }),
    ...body,
    ...variableFunction({ group: STYLE_GROUP, subgroup: 0x0b }),
  ];
}

describe("page geometry", () => {
  it("uses the WordPerfect default when the document states no geometry", () => {
    const section = sectionOf(readDocumentArea(text("plain")));
    expect(section.pageSize).toEqual({ widthPt: 612, heightPt: 792 });
    expect(section.margins).toEqual({
      topPt: 72,
      rightPt: 72,
      bottomPt: 72,
      leftPt: 72,
    });
  });

  // A4 is 210 by 297 millimetres, which is 9921 by 14031 of WordPerfect's own 1200ths of an inch.
  it("reads the page size out of the Form function", () => {
    const section = sectionOf(
      readDocumentArea([
        ...pageForm({ lengthWpu: 14031, widthWpu: 9921 }),
        ...text("A4"),
      ]),
    );
    expect(section.pageSize.widthPt).toBeCloseTo(595.26, 2);
    expect(section.pageSize.heightPt).toBeCloseTo(841.86, 2);
  });

  // The vertical pair lives in the Page group and the horizontal pair in the Column group -- a left or right margin is a column-oriented fact in this format.
  it("reads all four margins from their own two groups", () => {
    const section = sectionOf(
      readDocumentArea([
        ...marginFunction(PAGE_GROUP, 0x00, 600),
        ...marginFunction(PAGE_GROUP, 0x01, 900),
        ...marginFunction(COLUMN_GROUP, 0x00, 1800),
        ...marginFunction(COLUMN_GROUP, 0x01, 2400),
        ...text("margins"),
      ]),
    );
    expect(section.margins).toEqual({
      topPt: 36,
      bottomPt: 54,
      leftPt: 108,
      rightPt: 144,
    });
  });

  it("keeps the default for a dimension the document does not state", () => {
    const section = sectionOf(
      readDocumentArea([
        ...marginFunction(PAGE_GROUP, 0x00, 600),
        ...text("x"),
      ]),
    );
    expect(section.margins).toEqual({
      topPt: 36,
      rightPt: 72,
      bottomPt: 72,
      leftPt: 72,
    });
  });

  it("keeps the document's opening geometry and reports a later change", () => {
    const { document, diagnostics } = readWithDiagnostics([
      ...marginFunction(PAGE_GROUP, 0x00, 600),
      ...text("first"),
      HARD_EOL,
      ...marginFunction(PAGE_GROUP, 0x00, 2400),
      ...text("second"),
    ]);
    expect(sectionOf(document).margins.topPt).toBe(36);
    expect(
      diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === WpdDiagnosticCodes.PageGeometryChanged,
      ),
    ).toHaveLength(1);
  });

  it("reports a landscape form without rotating its stated dimensions", () => {
    const { document, diagnostics } = readWithDiagnostics([
      ...pageForm({ lengthWpu: 10200, widthWpu: 13200, orientation: 1 }),
      ...text("wide"),
    ]);
    expect(sectionOf(document).pageSize).toEqual({
      widthPt: 792,
      heightPt: 612,
    });
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === WpdDiagnosticCodes.LandscapeOrientationUnmapped,
      ),
    ).toBe(true);
  });

  it("does not report a landscape orientation for a portrait form", () => {
    const { diagnostics } = readWithDiagnostics([
      ...pageForm({ lengthWpu: 14031, widthWpu: 9921, orientation: 0 }),
      ...text("A4"),
    ]);
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === WpdDiagnosticCodes.LandscapeOrientationUnmapped,
      ),
    ).toBe(false);
  });

  it("does not report a page geometry change when the same value is stated twice", () => {
    const { diagnostics } = readWithDiagnostics([
      ...marginFunction(PAGE_GROUP, 0x00, 600),
      ...text("first"),
      HARD_EOL,
      ...marginFunction(PAGE_GROUP, 0x00, 600),
      ...text("second"),
    ]);
    expect(
      diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === WpdDiagnosticCodes.PageGeometryChanged,
      ),
    ).toHaveLength(0);
  });

  it("reports a page geometry change only once across more than one later change", () => {
    const { diagnostics } = readWithDiagnostics([
      ...marginFunction(PAGE_GROUP, 0x00, 600),
      ...text("first"),
      HARD_EOL,
      ...marginFunction(PAGE_GROUP, 0x00, 1200),
      ...text("second"),
      HARD_EOL,
      ...marginFunction(PAGE_GROUP, 0x00, 2400),
      ...text("third"),
    ]);
    expect(
      diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === WpdDiagnosticCodes.PageGeometryChanged,
      ),
    ).toHaveLength(1);
  });

  // applyPageGroup's own top/bottom dispatch must actually gate on the subgroup, not fall into the bottom-margin branch for any subgroup it does not recognise as either margin.
  it("does not apply a page margin function whose subgroup is neither top nor bottom", () => {
    const section = sectionOf(
      readDocumentArea([
        ...marginFunction(PAGE_GROUP, 0x02, 600),
        ...text("x"),
      ]),
    );
    expect(section.margins).toEqual({
      topPt: 72,
      rightPt: 72,
      bottomPt: 72,
      leftPt: 72,
    });
  });

  // applyColumnGroup's own left/right dispatch must actually gate on the subgroup, not fall into the right-margin branch for any subgroup it does not recognise as either margin.
  it("does not apply a column margin function whose subgroup is neither left nor right", () => {
    const section = sectionOf(
      readDocumentArea([
        ...marginFunction(COLUMN_GROUP, 0x02, 600),
        ...text("x"),
      ]),
    );
    expect(section.margins).toEqual({
      topPt: 72,
      rightPt: 72,
      bottomPt: 72,
      leftPt: 72,
    });
  });
});

describe("tables", () => {
  it("reconstructs a grid from a table definition and its cell boundaries", () => {
    const document = readDocumentArea([
      ...tableDefinition([2400, 3600]),
      ...text("A"),
      ...eolFunction({ subgroup: EOL_TABLE_CELL }),
      ...text("B"),
      ...eolFunction({ subgroup: EOL_TABLE_ROW }),
      ...text("C"),
      ...eolFunction({ subgroup: EOL_TABLE_CELL }),
      ...text("D"),
      ...eolFunction({ subgroup: EOL_TABLE_ROW }),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    const tables = tablesOf(document);
    expect(tables).toHaveLength(1);
    expect(tables[0]?.columnWidthsPt).toEqual([144, 216]);
    expect(tables[0]?.rows.map((row) => row.cells.map(cellText))).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);
  });

  // A document that has not already closed its last row leaves the final cell open when Table Off arrives, and one that has leaves nothing. Both spellings occur, and neither may produce a spurious empty row.
  it("closes a final row left open by a Table Off code", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200]),
      ...text("only"),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    expect(
      tablesOf(document)[0]?.rows.map((row) => row.cells.map(cellText)),
    ).toEqual([["only"]]);
  });

  it("does not append an empty row when Table Off follows a row code", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200]),
      ...text("only"),
      ...eolFunction({ subgroup: EOL_TABLE_ROW }),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    expect(tablesOf(document)[0]?.rows).toHaveLength(1);
  });

  it("keeps an empty cell in the middle of a row", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200, 1200, 1200]),
      ...text("A"),
      ...eolFunction({ subgroup: EOL_TABLE_CELL }),
      ...eolFunction({ subgroup: EOL_TABLE_CELL }),
      ...text("C"),
      ...eolFunction({ subgroup: EOL_TABLE_ROW }),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    expect(tablesOf(document)[0]?.rows[0]?.cells.map(cellText)).toEqual([
      "A",
      "",
      "C",
    ]);
  });

  // "<number of cells spanned horizontally> bit 7 is set if spanned from left" -- the spanning cell carries the count, and the position it covers carries the high bit and no entry of its own in the shared schema.
  it("reads a horizontal merge as one cell with a colSpan", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200, 1200]),
      ...text("merged"),
      ...eolFunction({
        subgroup: EOL_TABLE_CELL,
        embedded: embeddedSubfunction(CELL_SPANNING, [2, 1]),
      }),
      ...eolFunction({
        subgroup: EOL_TABLE_ROW,
        embedded: embeddedSubfunction(CELL_SPANNING, [0x81, 1]),
      }),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    const row = tablesOf(document)[0]?.rows[0];
    expect(row?.cells).toHaveLength(1);
    expect(row?.cells[0]?.colSpan).toBe(2);
  });

  it("reads a vertical merge as a rowSpan and drops the covered position", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200]),
      ...text("tall"),
      ...eolFunction({
        subgroup: EOL_TABLE_ROW,
        embedded: embeddedSubfunction(CELL_SPANNING, [1, 2]),
      }),
      ...eolFunction({
        subgroup: EOL_TABLE_ROW,
        embedded: embeddedSubfunction(CELL_SPANNING, [1, 0x82]),
      }),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    const rows = tablesOf(document)[0]?.rows;
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.cells[0]?.rowSpan).toBe(2);
  });

  it("reads a cell's background colour", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200]),
      ...text("filled"),
      ...eolFunction({
        subgroup: EOL_TABLE_ROW,
        embedded: embeddedSubfunction(
          CELL_FILL_COLORS,
          [0, 0, 0, 255, 0, 255, 0, 255],
        ),
      }),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    expect(tablesOf(document)[0]?.rows[0]?.cells[0]?.background).toEqual({
      kind: "solid",
      color: { r: 0, g: 1, b: 0 },
    });
  });

  // The shared schema carries alignment on the paragraph rather than the cell, so a cell that states its own justification states it for the paragraphs it holds.
  it("applies a cell's own justification to the paragraphs inside it", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200]),
      ...text("centred"),
      ...eolFunction({
        subgroup: EOL_TABLE_ROW,
        embedded: embeddedSubfunction(CELL_INFORMATION, [
          0x02,
          0x02,
          0x00,
          ...word(0),
          ...word(0),
        ]),
      }),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    const cell = tablesOf(document)[0]?.rows[0]?.cells[0];
    expect(cell === undefined ? undefined : paragraphAlignment(cell)).toBe(
      "center",
    );
  });

  // closeCell's own alignment walk narrows to paragraph blocks before setting alignment; a cell holding a non-paragraph block (a page break, here) alongside its paragraph must leave that other block alone rather than stamping an alignment field onto it too.
  it("applies a cell's own justification only to its paragraph blocks, not a page break sharing the cell", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200]),
      ...text("centred"),
      0xc7, // hard end of page
      ...eolFunction({
        subgroup: EOL_TABLE_ROW,
        embedded: embeddedSubfunction(CELL_INFORMATION, [
          0x02,
          0x02,
          0x00,
          ...word(0),
          ...word(0),
        ]),
      }),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    const cell = tablesOf(document)[0]?.rows[0]?.cells[0];
    const pageBreak = cell?.blocks.find((block) => block.kind === "pageBreak");
    expect(pageBreak).toBeDefined();
    expect(
      pageBreak === undefined ? true : Object.hasOwn(pageBreak, "alignment"),
    ).toBe(false);
  });

  it("gives a plain cell and row no optional keys at all, not keys holding undefined", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200]),
      ...text("plain"),
      ...eolFunction({ subgroup: EOL_TABLE_ROW }),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    const row = tablesOf(document)[0]?.rows[0];
    const cell = row?.cells[0];
    expect(cell).toBeDefined();
    for (const key of ["colSpan", "rowSpan", "background", "formula"]) {
      expect(cell === undefined ? false : Object.hasOwn(cell, key)).toBe(false);
    }
    expect(row === undefined ? false : Object.hasOwn(row, "heightPt")).toBe(
      false,
    );
    // closeCell's alignment walk must never run at all for a cell with no stated justification -- not run and assign `undefined`, which the shared schema's own optional field cannot tell apart from "never set".
    const paragraph = cell?.blocks[0];
    expect(
      paragraph === undefined ? false : Object.hasOwn(paragraph, "alignment"),
    ).toBe(false);
  });

  // readCellAttributes only reports a truncated attribute list when the walk actually stopped early; an ordinary cell with a well-formed (or absent) attribute list must never trigger it.
  it("does not report a truncated attribute list for a cell with well-formed attributes", () => {
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(
      buildWpdFile([
        ...tableDefinition([1200]),
        ...text("fine"),
        ...eolFunction({
          subgroup: EOL_TABLE_ROW,
          embedded: embeddedSubfunction(CELL_SPANNING, [1, 1]),
        }),
        ...eolFunction({ subgroup: EOL_TABLE_OFF }),
      ]),
      { sink: (d) => diagnostics.push(d) },
    );
    expect(
      diagnostics.some(
        (d) => d.code === WpdDiagnosticCodes.TableAttributesTruncated,
      ),
    ).toBe(false);
  });

  // A table definition the document never fills with a single row is dropped entirely -- an empty grid the author never actually built is not real content.
  it("drops a table definition that closes with no rows at all", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200]),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    expect(tablesOf(document)).toHaveLength(0);
  });

  // A fixed row height set on an earlier cell within the same row must survive to the row's own close even when a later cell in that row carries no row-information subfunction of its own -- the absence of a later statement is not itself a statement that clears the height.
  it("keeps a fixed row height set by an earlier cell once a later cell in the same row states none", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200, 1200]),
      ...text("A"),
      ...eolFunction({
        subgroup: EOL_TABLE_CELL,
        embedded: embeddedSubfunction(ROW_INFORMATION, [0x02, ...word(1200)]),
      }),
      ...text("B"),
      ...eolFunction({ subgroup: EOL_TABLE_ROW }),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    expect(tablesOf(document)[0]?.rows[0]?.heightPt).toBe(72);
  });

  // A cell boundary must still close a cell whose pending text is empty but whose runs are not (a run already split off by an attribute change) -- checking only pending text and accumulated cell blocks would wrongly drop it, even at Table Off, which otherwise skips closing an already-closed cell.
  it("closes a Table Off cell whose pending text is empty but whose runs are not", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200]),
      ...text("a"),
      0xf2, // ATTRIBUTE_ON (bold), a 3-byte fixed function: gate, attribute id, gate
      12, // BOLD
      0xf2,
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    expect(tablesOf(document)[0]?.rows[0]?.cells.map(cellText)).toEqual(["a"]);
  });

  // A cell boundary must still close a cell whose pending text and runs are both empty but which already holds a flushed paragraph (a hard return inside the cell) -- Table Off otherwise skips closing an already-closed cell, and must not mistake "nothing pending" for "nothing to close".
  it("closes a Table Off cell holding only an already-flushed paragraph", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200]),
      ...text("first"),
      HARD_EOL,
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    const cell = tablesOf(document)[0]?.rows[0]?.cells[0];
    expect(
      cell?.blocks.map((block) =>
        block.kind === "paragraph" ? block.runs[0]?.text : undefined,
      ),
    ).toEqual(["first"]);
  });

  // The definition function is not recursive: an already-open table is closed, and any paragraph mid-flight in the enclosing document is flushed, before a second Table Definition starts a fresh grid.
  it("closes an already-open table and flushes its paragraph when a new Table Definition arrives", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200]),
      ...text("first"),
      ...tableDefinition([1200]),
      ...text("second"),
      ...eolFunction({ subgroup: EOL_TABLE_ROW }),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    const tables = tablesOf(document);
    expect(tables).toHaveLength(1);
    expect(tables[0]?.rows[0]?.cells.map(cellText)).toEqual(["second"]);
    expect(paragraphsOf(document).map((p) => p.runs[0]?.text)).toEqual([
      "first",
    ]);
  });

  // Define Table End must clear the table's own "still defining columns" flag even when it fires directly rather than through a fresh Table Definition, so a Table Column function appearing after it (a document a hand-edit left in a state the format does not expect) is ignored rather than appended as a genuine extra column.
  it("ignores a Table Column function that arrives after Define Table End", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200]),
      ...tableColumn(2400),
      ...text("row"),
      ...eolFunction({ subgroup: EOL_TABLE_ROW }),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    expect(tablesOf(document)[0]?.columnWidthsPt).toEqual([72]);
  });

  it("reads a fixed row height", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200]),
      ...text("row"),
      ...eolFunction({
        subgroup: EOL_TABLE_ROW,
        embedded: embeddedSubfunction(ROW_INFORMATION, [0x02, ...word(1200)]),
      }),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    expect(tablesOf(document)[0]?.rows[0]?.heightPt).toBe(72);
  });

  it("keeps text on either side of a table out of it", () => {
    const document = readDocumentArea([
      ...text("before"),
      HARD_EOL,
      ...tableDefinition([1200]),
      ...text("inside"),
      ...eolFunction({ subgroup: EOL_TABLE_ROW }),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
      ...text("after"),
    ]);
    expect(paragraphsOf(document).map((p) => p.runs[0]?.text)).toEqual([
      "before",
      "after",
    ]);
    expect(tablesOf(document)[0]?.rows[0]?.cells.map(cellText)).toEqual([
      "inside",
    ]);
  });

  // A stream that ends inside a table has rows that are real content, so the table is closed rather than discarded.
  it("closes a table the document area ends inside", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200]),
      ...text("unterminated"),
      ...eolFunction({ subgroup: EOL_TABLE_ROW }),
    ]);
    expect(tablesOf(document)[0]?.rows).toHaveLength(1);
  });

  // A row still accumulating closed cells but never itself closed by any EOL boundary before the document area ends must still become a real row -- not vanish along with the whole table, which happens only when it holds zero rows.
  it("closes an unfinished row's own already-closed cells when the document area ends", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200]),
      ...text("A"),
      ...eolFunction({ subgroup: EOL_TABLE_CELL }),
      ...text("unclosed"),
    ]);
    const tables = tablesOf(document);
    expect(tables).toHaveLength(1);
    expect(tables[0]?.rows[0]?.cells.map(cellText)).toEqual(["A"]);
  });
});

describe("styles", () => {
  // "68 = heading level 1 style" through "75 = heading level 8 style", from the Global On function's own system style number.
  it("reads a heading level from the system style number", () => {
    const document = readDocumentArea([
      ...styleScope(68, text("Title")),
      HARD_EOL,
      ...text("Body"),
    ]);
    expect(paragraphsOf(document).map((p) => p.headingLevel)).toEqual([
      1,
      undefined,
    ]);
  });

  // A style region ends at its own closing code, which in a real document sits BEFORE the hard return that ends the paragraph -- so the heading is captured when the paragraph's first character arrives rather than when it closes.
  it("keeps the heading level when the style closes before the hard return", () => {
    const document = readDocumentArea([
      ...styleScope(70, text("Third level")),
      HARD_EOL,
    ]);
    expect(paragraphsOf(document)[0]?.headingLevel).toBe(3);
  });

  it("keeps the heading level when the hard return sits inside the style", () => {
    const document = readDocumentArea([
      ...styleScope(69, [...text("Second level"), HARD_EOL]),
    ]);
    expect(paragraphsOf(document)[0]?.headingLevel).toBe(2);
  });

  // The heading level is captured once, at the paragraph's own first character, and never re-derived from whatever style happens to be active later in the same paragraph -- a second, different structural style opening later must not overwrite it.
  it("keeps the first style's own heading level, not a second style's, within one paragraph", () => {
    const document = readDocumentArea([
      ...styleScope(70, text("a")),
      ...styleScope(69, text("b")),
      HARD_EOL,
    ]);
    expect(paragraphsOf(document)[0]?.headingLevel).toBe(3);
  });

  // "52 = level 1 style (indented)" -- an outline level, counted from zero by ContentListMembership.
  it("reads an outline level style as a list membership", () => {
    const document = readDocumentArea([
      ...styleScope(53, text("Nested item")),
      HARD_EOL,
    ]);
    expect(paragraphsOf(document)[0]?.list).toEqual({ level: 1 });
  });

  // Both structural facts (heading level and list membership) are captured together, at the paragraph's first character, from whichever single style is active then -- not independently, each from whatever style happens to be active when its own first non-undefined value shows up. A list style at the first character must keep the paragraph's own list membership even once a later, heading-only style becomes active in the same paragraph.
  it("keeps the first style's own list membership once a later style sets a heading instead", () => {
    const document = readDocumentArea([
      ...styleScope(53, text("a")),
      ...styleScope(68, text("b")),
      HARD_EOL,
    ]);
    const paragraph = paragraphsOf(document)[0];
    expect(paragraph?.list).toEqual({ level: 1 });
    expect(paragraph?.headingLevel).toBeUndefined();
  });

  // An enclosing Global On naming the document's own Normal style must not override a heading opened inside it.
  it("takes the innermost style that says something structural", () => {
    const document = readDocumentArea([
      ...styleScope(1, styleScope(68, text("Heading"))),
      HARD_EOL,
    ]);
    expect(paragraphsOf(document)[0]?.headingLevel).toBe(1);
  });

  // The reverse nesting: a structural style opened OUTSIDE a later, transparent one. effectiveStyle's own findLast walk must skip the innermost (Normal) scope, whose semantics are undefined, to reach the outer heading style rather than stopping at the first scope it sees regardless of what it means.
  it("reaches past an innermost style with no structural meaning to an outer heading style", () => {
    const document = readDocumentArea([
      ...styleScope(68, styleScope(1, text("Heading"))),
      HARD_EOL,
    ]);
    expect(paragraphsOf(document)[0]?.headingLevel).toBe(1);
  });
});

describe("outline numbering", () => {
  // "<level number to display (0 - n)>" -- the rendered digits between the pair are generated content, replaced by the list membership that regenerates them.
  it("reads a paragraph number display as a list membership and drops its digits", () => {
    const { document, diagnostics } = readWithDiagnostics([
      ...variableFunction({
        group: DISPLAY_NUMBER_GROUP,
        subgroup: 0x0c,
        nonDeletable: [2],
      }),
      ...text("III."),
      ...variableFunction({ group: DISPLAY_NUMBER_GROUP, subgroup: 0x0d }),
      ...text("Item text"),
      HARD_EOL,
    ]);
    const paragraph = paragraphsOf(document)[0];
    expect(paragraph?.list).toEqual({ level: 2 });
    expect(paragraph?.runs.map((run) => run.text).join("")).toBe("Item text");
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === WpdDiagnosticCodes.OutlineNumberRegenerated,
    );
    expect(found?.message).toBe(
      "An outline number's rendered digits were replaced by the list membership that regenerates them.",
    );
  });

  // Every other member of the group displays a counter inside running text and carries no structure, so its digits stay exactly where they are.
  // applyDisplayNumberGroup's own Off dispatch must actually gate on the subfunction being an Off, not decrement the suppression depth for any subgroup it does not recognise as one -- a page-number-display On (0x04) sits in the very same function group but names none of the paragraph-number On/Off codes.
  it("does not end paragraph-number suppression for an unrelated function in the same group", () => {
    const document = readDocumentArea([
      ...variableFunction({
        group: DISPLAY_NUMBER_GROUP,
        subgroup: 0x0c,
        nonDeletable: [0],
      }),
      ...text("hidden"),
      ...variableFunction({
        group: DISPLAY_NUMBER_GROUP,
        subgroup: 0x04, // page number display On -- a real function, but not a paragraph-number Off
        nonDeletable: [0],
      }),
      ...text("stillHidden"),
      ...variableFunction({ group: DISPLAY_NUMBER_GROUP, subgroup: 0x0d }),
      ...text("shown"),
    ]);
    expect(
      paragraphsOf(document)[0]
        ?.runs.map((r) => r.text)
        .join(""),
    ).toBe("shown");
  });

  it("leaves a page number display's own text in place", () => {
    const document = readDocumentArea([
      ...text("page "),
      ...variableFunction({
        group: DISPLAY_NUMBER_GROUP,
        subgroup: 0x04,
        nonDeletable: [0],
      }),
      ...text("7"),
      ...variableFunction({ group: DISPLAY_NUMBER_GROUP, subgroup: 0x05 }),
    ]);
    const paragraph = paragraphsOf(document)[0];
    expect(paragraph?.runs.map((run) => run.text).join("")).toBe("page 7");
    expect(paragraph?.list).toBeUndefined();
  });
});

describe("tabs", () => {
  // The Tab group has no subfunction catalogue: the byte in the subfunction position is the tab definition itself, whose top five bits name the type. Dropping the group ran real documents' columns together, which is a text loss rather than a formatting one.
  it("advances to a tab stop as a tab character", () => {
    const document = readDocumentArea([
      ...text("Name"),
      ...variableFunction({ group: TAB_GROUP, subgroup: 0b00010 << 3 }),
      ...text("Country"),
    ]);
    expect(
      paragraphsOf(document)[0]
        ?.runs.map((run) => run.text)
        .join(""),
    ).toBe("Name\tCountry");
  });

  // Centre-on-margins is the missing half of the construct the single-byte End of Center Align function already ends.
  it("centres the line a centring code begins", () => {
    const document = readDocumentArea([
      ...variableFunction({ group: TAB_GROUP, subgroup: 0b01000 << 3 }),
      ...text("Title"),
      HARD_EOL,
      ...text("Body"),
    ]);
    expect(paragraphsOf(document).map((p) => p.alignment)).toEqual([
      "center",
      undefined,
    ]);
  });

  it("right-aligns the line a flush-right code begins", () => {
    const document = readDocumentArea([
      ...variableFunction({ group: TAB_GROUP, subgroup: 0b10000 << 3 }),
      ...text("Date"),
      HARD_EOL,
    ]);
    expect(paragraphsOf(document)[0]?.alignment).toBe("right");
  });

  // A line-scoped centring code applies to the line it sits in; Set Justification Mode applies from where it sits onwards, so the narrower one wins for that paragraph and the wider one resumes after it.
  it("lets a line-scoped alignment outrank the document justification for its own paragraph", () => {
    const document = readDocumentArea([
      ...variableFunction({
        group: 0xd3,
        subgroup: 0x05,
        nonDeletable: [3],
      }),
      ...variableFunction({ group: TAB_GROUP, subgroup: 0b01000 << 3 }),
      ...text("centred"),
      HARD_EOL,
      ...text("right"),
      HARD_EOL,
    ]);
    expect(paragraphsOf(document).map((p) => p.alignment)).toEqual([
      "center",
      "right",
    ]);
  });
});

describe("document metadata", () => {
  it("reads the Extended Document Summary packet", () => {
    const document = readDocumentArea(text("body"), [
      summaryPacket([
        { tag: 17, type: 0x01, data: wordString("Annual review") },
        { tag: 5, type: 0x01, data: wordString("A. Writer") },
        { tag: 26, type: 0x01, data: wordString("annual, review") },
      ]),
    ]);
    expect(document.metadata).toEqual({
      title: "Annual review",
      author: "A. Writer",
      keywords: ["annual", "review"],
    });
  });

  it("answers an empty envelope for a document carrying no summary", () => {
    expect(readDocumentArea(text("body")).metadata).toEqual({});
  });

  // readMetadata's own packet lookup must actually filter on packet type, not just take the first packet in the index -- a document whose summary is not the first packet must still find it.
  it("finds the summary packet even when it is not the first packet in the index", () => {
    const document = readDocumentArea(text("body"), [
      { packetType: 0x08, bytes: new Uint8Array(0) }, // General WP Text, not a summary
      summaryPacket([{ tag: 17, type: 0x01, data: wordString("Found it") }]),
    ]);
    expect(document.metadata).toEqual({ title: "Found it" });
  });
});

describe("constructs this reader does not lift", () => {
  // Each of these is recognised by the tokeniser and skipped by the fold, so a document containing it still reads -- and says what it lost rather than passing over it in silence. Group 0xD6 no longer appears here: a header, footer, or watermark function is LIFTED into ContentSection.headers/footers/watermarks (see the page-furniture describe below), and a function whose occurrence bits claim neither parity is suppressed in its own file and lifts nothing with nothing to report.
  it.each([
    [
      0xdf,
      WpdDiagnosticCodes.BoxDropped,
      0x00,
      "This document contains a box -- a figure, text box, equation, or graphic -- whose function-level override names no content this reader can resolve.",
    ],
    [
      0xd7,
      WpdDiagnosticCodes.NoteDropped,
      0x00,
      "This document contains a footnote or endnote whose body packet this reader could not resolve; only its reference text survived.",
    ],
    [
      0xd5,
      WpdDiagnosticCodes.CrossReferenceFlattened,
      0x00,
      "This document contains a cross-reference; its displayed text survives as ordinary text, and the reference's own target binding does not.",
    ],
    [
      0xde,
      WpdDiagnosticCodes.MergeCodeDropped,
      0x00,
      "This document contains merge codes, which are a form-letter template's placeholders rather than text.",
    ],
  ])(
    "reports group %i through the diagnostic sink",
    (group, code, subgroup, message) => {
      const { document, diagnostics } = readWithDiagnostics([
        ...text("before"),
        ...variableFunction({ group, subgroup }),
        ...text("after"),
      ]);
      expect(
        paragraphsOf(document)[0]
          ?.runs.map((run) => run.text)
          .join(""),
      ).toBe("beforeafter");
      const matches = diagnostics.filter(
        (diagnostic) => diagnostic.code === code,
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]?.message).toBe(message);
    },
  );
});

describe("page geometry margin subgroup isolation", () => {
  it("sets only the bottom margin from PAGE_BOTTOM_MARGIN_SET, leaving the top at its default", () => {
    const section = sectionOf(
      readDocumentArea([
        ...marginFunction(PAGE_GROUP, 0x01, 900), // bottom only
        ...text("x"),
      ]),
    );
    expect(section.margins.bottomPt).toBe(54);
    expect(section.margins.topPt).toBe(72); // default, not touched
  });

  it("sets only the right margin from COLUMN_RIGHT_MARGIN_SET, leaving the left at its default", () => {
    const section = sectionOf(
      readDocumentArea([
        ...marginFunction(COLUMN_GROUP, 0x01, 2400), // right only
        ...text("x"),
      ]),
    );
    expect(section.margins.rightPt).toBe(144);
    expect(section.margins.leftPt).toBe(72); // default, not touched
  });

  it("reports the exact PageGeometryChanged message", () => {
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(
      buildWpdFile([
        ...marginFunction(PAGE_GROUP, 0x00, 600),
        ...text("first"),
        HARD_EOL,
        ...marginFunction(PAGE_GROUP, 0x00, 2400),
        ...text("second"),
      ]),
      { sink: (d) => diagnostics.push(d) },
    );
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.PageGeometryChanged,
    );
    expect(found?.message).toBe(
      "This document changes its page size or margins partway through; the section carries the geometry the document opens with.",
    );
  });

  it("reports the exact landscape-orientation message", () => {
    const { document, diagnostics } = (() => {
      const diagnostics: WpdDiagnostic[] = [];
      const document = readWpdContent(
        buildWpdFile([
          ...pageForm({ lengthWpu: 10200, widthWpu: 13200, orientation: 1 }),
          ...text("wide"),
        ]),
        { sink: (d) => diagnostics.push(d) },
      );
      return { document, diagnostics };
    })();
    void document;
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.LandscapeOrientationUnmapped,
    );
    expect(found?.message).toBe(
      "The document's form declares a landscape orientation; the form's own stated width and length are used as written, since a page size carries no orientation.",
    );
  });
});

describe("table cell attribute gaps", () => {
  const CELL_FORMULA = 0x81;

  it("reports a truncated embedded subfunction list with the exact message", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile([
        ...tableDefinition([1200]),
        ...text("cell"),
        ...variableFunction({
          group: 0xd0,
          subgroup: EOL_TABLE_ROW,
          // deletableSize word claims 50 bytes of deletable data, but none follow -- overruns the function's own nonDeletable region.
          nonDeletable: [...word(50)],
        }),
        ...eolFunction({ subgroup: EOL_TABLE_OFF }),
      ]),
      { sink: (d) => diagnostics.push(d) },
    );
    void document;
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.TableAttributesTruncated,
    );
    expect(found?.message).toBe(
      "A cell's embedded attribute list held a record of undocumented length, so the attributes after it were not read.",
    );
  });

  it("reports an unresolved table formula with the exact message, keeping the cell's own text", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile([
        ...tableDefinition([1200]),
        ...text("42"),
        ...eolFunction({
          subgroup: EOL_TABLE_ROW,
          // A formula subfunction whose own token bytes readTableFormula cannot decode with confidence.
          embedded: embeddedSubfunction(CELL_FORMULA, [
            ...word(1),
            0xff, // not a recognised formula token code
            0,
            0,
          ]),
        }),
        ...eolFunction({ subgroup: EOL_TABLE_OFF }),
      ]),
      { sink: (d) => diagnostics.push(d) },
    );
    void document;
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.TableFormulaUnresolved,
    );
    expect(found?.message).toBe(
      "A table cell carries a formula this reader could not decode with confidence, so the cell keeps its displayed text but not the formula that produced it.",
    );
  });

  it("carries a resolved table formula onto the cell, reporting nothing", () => {
    // A1+B1: a cell reference (code 64, absolute-flag word, row word, column word) for A1, the binary "+" token (1), then the same cell-reference shape for B1 -- the identical byte pattern stream/formula.test.ts proves readTableFormula resolves to "A1+B1" on its own, here wrapped in the embedded subfunction's own leading and trailing length-word framing.
    const cellA1 = [64, ...word(0), ...word(0)];
    const cellB1 = [64, ...word(0), ...word(1)];
    const formulaTokens = [...cellA1, 1, ...cellB1];
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile([
        ...tableDefinition([1200]),
        ...text("5"),
        ...eolFunction({
          subgroup: EOL_TABLE_ROW,
          embedded: embeddedSubfunction(CELL_FORMULA, [
            ...word(formulaTokens.length),
            ...formulaTokens,
            ...word(formulaTokens.length),
          ]),
        }),
        ...eolFunction({ subgroup: EOL_TABLE_OFF }),
      ]),
      { sink: (d) => diagnostics.push(d) },
    );
    const cell = tablesOf(document)[0]?.rows[0]?.cells[0];
    expect(cell?.formula).toBe("A1+B1");
    // A formula that DID resolve must not also trigger the "could not decode with confidence" diagnostic -- the two are mutually exclusive outcomes of the same read.
    expect(
      diagnostics.some(
        (d) => d.code === WpdDiagnosticCodes.TableFormulaUnresolved,
      ),
    ).toBe(false);
  });

  it("resolves a blended (pattern) cell fill and reports it", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile([
        ...tableDefinition([1200]),
        ...text("shaded"),
        ...eolFunction({
          subgroup: EOL_TABLE_ROW,
          // foreground (10,20,30) shade 200 (unused), background (0,255,0), background shade 128 -- not FULL_SHADE (255), so the fill blends.
          embedded: embeddedSubfunction(
            CELL_FILL_COLORS,
            [10, 20, 30, 200, 0, 255, 0, 128],
          ),
        }),
        ...eolFunction({ subgroup: EOL_TABLE_OFF }),
      ]),
      { sink: (d) => diagnostics.push(d) },
    );
    const cell = tablesOf(document)[0]?.rows[0]?.cells[0];
    expect(cell?.background?.kind).toBe("pattern");
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.CellFillBlended,
    );
    expect(found?.message).toBe(
      "A cell is filled with a shaded blend of two colours, resolved to a 'pattern' fill whose density is this reader's own best-effort derivation, not a value confirmed against a specification.",
    );
  });

  it("does not report an unresolved formula for a cell that carries no formula subfunction at all", () => {
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(
      buildWpdFile([
        ...tableDefinition([1200]),
        ...text("plain"),
        ...eolFunction({ subgroup: EOL_TABLE_ROW }),
        ...eolFunction({ subgroup: EOL_TABLE_OFF }),
      ]),
      { sink: (d) => diagnostics.push(d) },
    );
    expect(
      diagnostics.some(
        (d) => d.code === WpdDiagnosticCodes.TableFormulaUnresolved,
      ),
    ).toBe(false);
  });

  it("does not report a blended fill for a cell with a full-shade (solid) fill", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile([
        ...tableDefinition([1200]),
        ...text("solid"),
        ...eolFunction({
          subgroup: EOL_TABLE_ROW,
          // foreground unused (shade 0), background (0,0,255) at FULL_SHADE (255) -- a plain solid fill, not a blend.
          embedded: embeddedSubfunction(
            CELL_FILL_COLORS,
            [0, 0, 0, 0, 0, 0, 255, 255],
          ),
        }),
        ...eolFunction({ subgroup: EOL_TABLE_OFF }),
      ]),
      { sink: (d) => diagnostics.push(d) },
    );
    const cell = tablesOf(document)[0]?.rows[0]?.cells[0];
    expect(cell?.background?.kind).toBe("solid");
    expect(
      diagnostics.some((d) => d.code === WpdDiagnosticCodes.CellFillBlended),
    ).toBe(false);
  });
});

describe("style resolution depth and scope handling", () => {
  const GLOBAL_ON = 0x0a;
  const GLOBAL_OFF = 0x0b;
  const NORMAL_STYLE_PACKET_TYPE = 0x30;
  const NO_SYSTEM_STYLE = 0xff;

  function normalStylePacket(
    prefixIdOfNextStyle: number | undefined,
    beginBytes: readonly number[],
  ) {
    const headerSize = 2 + 2 + 16;
    const bytes = new Uint8Array(headerSize + beginBytes.length);
    bytes[2] = 4;
    const putUint32 = (offset: number, value: number) => {
      bytes[offset] = value & 0xff;
      bytes[offset + 1] = (value >>> 8) & 0xff;
      bytes[offset + 2] = (value >>> 16) & 0xff;
      bytes[offset + 3] = (value >>> 24) & 0xff;
    };
    putUint32(4, headerSize);
    putUint32(8, 0);
    putUint32(12, beginBytes.length);
    bytes.set(beginBytes, headerSize);
    void prefixIdOfNextStyle;
    return { packetType: NORMAL_STYLE_PACKET_TYPE, bytes };
  }

  // A style whose own begin block opens ANOTHER style scope (naming the same packet again, at a fresh prefix ID) recurses through applyStylePacketBegin; repeating that packet at every depth walks past MAX_STYLE_RESOLUTION_DEPTH (16) on genuinely self-referential input.
  it("stops resolving a style chain deeper than MAX_STYLE_RESOLUTION_DEPTH and reports it", () => {
    const prefixIds = Array.from({ length: 20 }, (_, i) => i + 1);
    const packets = prefixIds.map((id) =>
      normalStylePacket(
        id,
        variableFunction({
          group: STYLE_GROUP,
          subgroup: GLOBAL_ON,
          prefixIds: [id + 1],
          nonDeletable: [0, 0, NO_SYSTEM_STYLE],
        }),
      ),
    );
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile(
        [
          ...variableFunction({
            group: STYLE_GROUP,
            subgroup: GLOBAL_ON,
            prefixIds: [1],
            nonDeletable: [0, 0, NO_SYSTEM_STYLE],
          }),
          ...text("deep"),
        ],
        packets,
      ),
      { sink: (d) => diagnostics.push(d) },
    );
    void document;
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.StyleResolutionDepthExceeded,
    );
    expect(found?.message).toBe(
      "A chain of styles resolving one another's own packets ran deeper than this reader will follow, so the deepest style's own direct formatting was not applied.",
    );
  });

  // Exactly MAX_STYLE_RESOLUTION_DEPTH (16) successful recursions must leave the 17th attempt refused: a chain one level too shallow to force a refusal under `>` (which would only trigger once depth genuinely exceeds 16) must trigger the guard under the real `>=` boundary. With a chain of exactly 17 style packets and nothing left to recurse into after the 17th, an off-by-one guard would let the whole chain resolve and never report anything at all.
  it("refuses exactly the chain's 17th style recursion, not the 18th", () => {
    const depth = 17;
    const prefixIds = Array.from({ length: depth }, (_, i) => i + 1);
    const packets = prefixIds.map((id) =>
      normalStylePacket(
        id,
        id === depth
          ? variableFunction({
              group: CHARACTER_GROUP,
              subgroup: 0x1b, // a font size change: a real, non-empty begin block that opens no further style -- nothing left to over-recurse into
              nonDeletable: [0x58, 0x02, 0, 0, 0, 0, 0, 0],
            })
          : variableFunction({
              group: STYLE_GROUP,
              subgroup: GLOBAL_ON,
              prefixIds: [id + 1],
              nonDeletable: [0, 0, NO_SYSTEM_STYLE],
            }),
      ),
    );
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(
      buildWpdFile(
        [
          ...variableFunction({
            group: STYLE_GROUP,
            subgroup: GLOBAL_ON,
            prefixIds: [1],
            nonDeletable: [0, 0, NO_SYSTEM_STYLE],
          }),
          ...text("deep"),
        ],
        packets,
      ),
      { sink: (d) => diagnostics.push(d) },
    );
    expect(
      diagnostics.filter(
        (d) => d.code === WpdDiagnosticCodes.StyleResolutionDepthExceeded,
      ),
    ).toHaveLength(1);
  });

  // The resolution depth counter must return to its starting value once a style's own begin block finishes resolving, not keep climbing -- otherwise a long enough run of entirely separate, non-nested style scopes would eventually (and wrongly) trip the same depth guard a genuinely self-referential chain trips.
  it("never accumulates resolution depth across sibling, non-nested style scopes", () => {
    const siblingCount = 9; // enough that a counter incrementing instead of decrementing after each one would cross MAX_STYLE_RESOLUTION_DEPTH (16)
    const prefixIds = Array.from({ length: siblingCount }, (_, i) => i + 1);
    const packets = prefixIds.map((id) =>
      normalStylePacket(
        id,
        variableFunction({
          group: CHARACTER_GROUP,
          subgroup: 0x1b, // a font size change: real, harmless direct formatting that opens no further style
          nonDeletable: [0x58, 0x02, 0, 0, 0, 0, 0, 0],
        }),
      ),
    );
    const documentArea = prefixIds.flatMap((id) => [
      ...variableFunction({
        group: STYLE_GROUP,
        subgroup: GLOBAL_ON,
        prefixIds: [id],
        nonDeletable: [0, 0, NO_SYSTEM_STYLE],
      }),
      ...variableFunction({ group: STYLE_GROUP, subgroup: GLOBAL_OFF }),
    ]);
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(buildWpdFile([...documentArea, ...text("done")], packets), {
      sink: (d) => diagnostics.push(d),
    });
    expect(
      diagnostics.some(
        (d) => d.code === WpdDiagnosticCodes.StyleResolutionDepthExceeded,
      ),
    ).toBe(false);
  });

  // The four intermediate style subfunctions (per style.test.ts: 1, 2, 5, 6, 7, 8) delimit the style's own before/after codes but neither open nor close a scope -- one arriving mid-scope must not be mistaken for the scope's own closer.
  it("does not close a style scope on an intermediate subfunction", () => {
    const document = readDocumentArea([
      ...variableFunction({
        group: STYLE_GROUP,
        subgroup: GLOBAL_ON,
        prefixIds: [1],
        nonDeletable: [0, 0, 68], // heading level 1
      }),
      ...variableFunction({ group: STYLE_GROUP, subgroup: 1 }), // intermediate, neither opener nor closer
      ...text("Title"),
      HARD_EOL,
    ]);
    expect(paragraphsOf(document)[0]?.headingLevel).toBe(1);
  });

  // restoreFormattingSnapshot's own for-of loop must carry every attribute the snapshot held, not just the first: bold AND italic both open before the style scope, the style's own begin block changes neither, and both must survive the scope's close.
  it("restores every active attribute the snapshot held, not only one", () => {
    const document = readDocumentArea(
      [
        0xf2,
        12,
        0xf2, // bold on (ATTRIBUTE_ON, BOLD, ATTRIBUTE_ON)
        0xf2,
        8,
        0xf2, // italic on (ATTRIBUTE_ON, ITALICS, ATTRIBUTE_ON)
        ...variableFunction({
          group: STYLE_GROUP,
          subgroup: GLOBAL_ON,
          prefixIds: [1],
          nonDeletable: [0, 0, NO_SYSTEM_STYLE],
        }),
        ...text("styled"),
        ...variableFunction({ group: STYLE_GROUP, subgroup: GLOBAL_OFF }),
        ...text("after"),
      ],
      [normalStylePacket(undefined, [0xf2, 14, 0xf2])], // begin block turns on underline too
    );
    const runs = paragraphsOf(document)[0]?.runs;
    expect(runs?.[0]).toEqual({
      text: "styled",
      bold: true,
      italic: true,
      underline: true,
    });
    expect(runs?.[1]).toEqual({ text: "after", bold: true, italic: true });
  });
});

describe("outline numbering gaps", () => {
  it("keeps the first paragraph number display's level when a second one arrives before it closes", () => {
    const document = readDocumentArea([
      ...variableFunction({
        group: DISPLAY_NUMBER_GROUP,
        subgroup: 0x0c,
        nonDeletable: [1],
      }),
      ...variableFunction({
        group: DISPLAY_NUMBER_GROUP,
        subgroup: 0x0c,
        nonDeletable: [5], // a second On, nested -- must not overwrite the first level
      }),
      ...text("Item"),
      HARD_EOL,
    ]);
    expect(paragraphsOf(document)[0]?.list).toEqual({ level: 1 });
  });

  it("does not let numberDisplayDepth go negative, which would wrongly suppress later text", () => {
    const document = readDocumentArea([
      ...variableFunction({ group: DISPLAY_NUMBER_GROUP, subgroup: 0x0d }), // Off with no matching On
      ...variableFunction({ group: DISPLAY_NUMBER_GROUP, subgroup: 0x0d }), // a second stray Off
      ...variableFunction({
        group: DISPLAY_NUMBER_GROUP,
        subgroup: 0x0c,
        nonDeletable: [0],
      }), // On: depth must become exactly 1, not climb out of a negative hole
      ...text("hidden"),
      ...variableFunction({ group: DISPLAY_NUMBER_GROUP, subgroup: 0x0d }),
      ...text("shown"),
    ]);
    expect(
      paragraphsOf(document)[0]
        ?.runs.map((r) => r.text)
        .join(""),
    ).toBe("shown");
  });
});
