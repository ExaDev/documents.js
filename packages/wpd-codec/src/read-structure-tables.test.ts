import type {} from "document-schema.js";
import { describe, expect, it } from "vitest";
import { WpdDiagnosticCodes, type WpdDiagnostic } from "./diagnostics";
import { readWpdContent } from "./read";
import {
  buildWpdFile,
  embeddedSubfunction,
  eolFunction,
  text,
  word,
} from "./test-support/build-wpd";
import {
  CELL_FILL_COLORS,
  CELL_INFORMATION,
  CELL_SPANNING,
  EOL_TABLE_CELL,
  EOL_TABLE_OFF,
  EOL_TABLE_ROW,
  HARD_EOL,
  ROW_INFORMATION,
  cellText,
  paragraphAlignment,
  paragraphsOf,
  readDocumentArea,
  readWithDiagnostics,
  tableColumn,
  tableDefinition,
  tablesOf,
} from "./test-support/structure-fixtures";

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
    expect(tables[0]?.columns.map((c) => c.widthPt)).toEqual([144, 216]);
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

  // "<number of cells spanned horizontally> bit 7 is set if spanned from left" — the spanning cell carries the count, and the position it covers carries the high bit; that position still holds its own grid entry in the shared schema, block-less and with no span of its own.
  it("reads a horizontal merge as one anchor with a colSpan followed by a block-less entry at the position it covers", () => {
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
    expect(row?.cells).toHaveLength(2);
    expect(row?.cells[0]?.colSpan).toBe(2);
    expect(row?.cells[1]).toEqual({ blocks: [] });
  });

  it("reads a vertical merge as a rowSpan on the anchor and a block-less entry at the same column of the row below", () => {
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
    expect(rows).toHaveLength(2);
    expect(rows?.[0]?.cells[0]?.rowSpan).toBe(2);
    expect(rows?.[1]?.cells).toEqual([{ blocks: [] }]);
  });

  it("reads a 2x2 merge as one anchor carrying both spans and a block-less entry at each of the three positions it covers", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200, 1200]),
      ...text("big"),
      ...eolFunction({
        subgroup: EOL_TABLE_CELL,
        embedded: embeddedSubfunction(CELL_SPANNING, [2, 2]),
      }),
      ...eolFunction({
        subgroup: EOL_TABLE_ROW,
        embedded: embeddedSubfunction(CELL_SPANNING, [0x81, 2]),
      }),
      ...eolFunction({
        subgroup: EOL_TABLE_CELL,
        embedded: embeddedSubfunction(CELL_SPANNING, [2, 0x81]),
      }),
      ...eolFunction({
        subgroup: EOL_TABLE_ROW,
        embedded: embeddedSubfunction(CELL_SPANNING, [0x81, 0x81]),
      }),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    const table = tablesOf(document)[0];
    expect(table?.rows.map((row) => row.cells.length)).toEqual([2, 2]);
    const anchor = table?.rows[0]?.cells[0];
    expect(anchor?.colSpan).toBe(2);
    expect(anchor?.rowSpan).toBe(2);
    expect(anchor === undefined ? undefined : cellText(anchor)).toBe("big");
    expect(table?.rows[0]?.cells[1]).toEqual({ blocks: [] });
    expect(table?.rows[1]?.cells).toEqual([{ blocks: [] }, { blocks: [] }]);
  });

  // A covered position's own fill is a fact the stream states for that position, and a covered entry may carry it; its spans, formula and justification belong to the region or have no paragraph to land on.
  it("carries a covered position's own fill onto its block-less entry", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200, 1200]),
      ...text("merged"),
      ...eolFunction({
        subgroup: EOL_TABLE_CELL,
        embedded: embeddedSubfunction(CELL_SPANNING, [2, 1]),
      }),
      ...eolFunction({
        subgroup: EOL_TABLE_ROW,
        embedded: [
          ...embeddedSubfunction(CELL_SPANNING, [0x81, 1]),
          ...embeddedSubfunction(
            CELL_FILL_COLORS,
            [0, 0, 0, 255, 0, 255, 0, 255],
          ),
        ],
      }),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    expect(tablesOf(document)[0]?.rows[0]?.cells[1]).toEqual({
      blocks: [],
      background: { kind: "solid", color: { r: 0, g: 1, b: 0 } },
    });
  });

  it("states no background on a covered position whose stream states no fill", () => {
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
    const covered = tablesOf(document)[0]?.rows[0]?.cells[1];
    expect(
      covered === undefined ? true : Object.hasOwn(covered, "background"),
    ).toBe(false);
  });

  it("reports content held by a covered cell instead of carrying it, and reports it once however many such cells there are", () => {
    const { document, diagnostics } = readWithDiagnostics([
      ...tableDefinition([1200, 1200, 1200]),
      ...text("merged"),
      ...eolFunction({
        subgroup: EOL_TABLE_CELL,
        embedded: embeddedSubfunction(CELL_SPANNING, [3, 1]),
      }),
      ...text("hidden one"),
      ...eolFunction({
        subgroup: EOL_TABLE_CELL,
        embedded: embeddedSubfunction(CELL_SPANNING, [0x81, 1]),
      }),
      ...text("hidden two"),
      ...eolFunction({
        subgroup: EOL_TABLE_ROW,
        embedded: embeddedSubfunction(CELL_SPANNING, [0x81, 1]),
      }),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    expect(tablesOf(document)[0]?.rows[0]?.cells.slice(1)).toEqual([
      { blocks: [] },
      { blocks: [] },
    ]);
    expect(
      diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === WpdDiagnosticCodes.CoveredCellContentDropped,
      ),
    ).toEqual([
      {
        code: WpdDiagnosticCodes.CoveredCellContentDropped,
        message:
          "A table cell covered by a neighbouring cell's merge held content of its own, which was not carried: a merged region's content belongs to the cell that anchors it.",
      },
    ]);
  });

  it("does not report a covered cell that holds no content", () => {
    const { diagnostics } = readWithDiagnostics([
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
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === WpdDiagnosticCodes.CoveredCellContentDropped,
      ),
    ).toBe(false);
  });

  // The shared schema's grid rule gives every row exactly one entry per grid column; a row the stream leaves short of the defined grid is filled out rather than handed on short.
  it("fills a row the stream leaves short of the defined grid with block-less entries", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200, 1200, 1200]),
      ...text("A"),
      ...eolFunction({ subgroup: EOL_TABLE_CELL }),
      ...text("B"),
      ...eolFunction({ subgroup: EOL_TABLE_CELL }),
      ...text("C"),
      ...eolFunction({ subgroup: EOL_TABLE_ROW }),
      ...text("D"),
      ...eolFunction({ subgroup: EOL_TABLE_ROW }),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    const table = tablesOf(document)[0];
    expect(table?.rows.map((row) => row.cells.length)).toEqual([3, 3]);
    expect(table?.rows[1]?.cells.map(cellText)).toEqual(["D", "", ""]);
    expect(table?.rows[1]?.cells[1]).toEqual({ blocks: [] });
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
    // closeCell's alignment walk must never run at all for a cell with no stated justification — not run and assign `undefined`, which the shared schema's own optional field cannot tell apart from "never set".
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
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    expect(
      diagnostics.some(
        (d) => d.code === WpdDiagnosticCodes.TableAttributesTruncated,
      ),
    ).toBe(false);
  });

  // A table definition the document never fills with a single row is dropped entirely — an empty grid the author never actually built is not real content.
  it("drops a table definition that closes with no rows at all", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200]),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    expect(tablesOf(document)).toHaveLength(0);
  });

  // A fixed row height set on an earlier cell within the same row must survive to the row's own close even when a later cell in that row carries no row-information subfunction of its own — the absence of a later statement is not itself a statement that clears the height.
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

  // The Row Information subfunction's own header-row flag (0x04) is the format's own statement that the row repeats at the top of each page the table continues onto, and it reaches ContentTableRow.isHeader rather than being parsed and dropped.
  it("reads the Row Information header-row flag onto the row's own isHeader", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200]),
      ...text("H"),
      ...eolFunction({
        subgroup: EOL_TABLE_ROW,
        embedded: embeddedSubfunction(ROW_INFORMATION, [0x04, ...word(0)]),
      }),
      ...text("B"),
      ...eolFunction({ subgroup: EOL_TABLE_ROW }),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    expect(tablesOf(document)[0]?.rows.map((row) => row.isHeader)).toEqual([
      true,
      undefined,
    ]);
  });

  it("reads a header row that also states a fixed height, carrying both", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200]),
      ...text("H"),
      ...eolFunction({
        subgroup: EOL_TABLE_ROW,
        embedded: embeddedSubfunction(ROW_INFORMATION, [0x06, ...word(1200)]),
      }),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    const row = tablesOf(document)[0]?.rows[0];
    expect(row?.isHeader).toBe(true);
    expect(row?.heightPt).toBe(72);
  });

  it("leaves a row whose Row Information states no header flag unflagged", () => {
    const document = readDocumentArea([
      ...tableDefinition([1200]),
      ...text("a"),
      ...eolFunction({
        subgroup: EOL_TABLE_ROW,
        embedded: embeddedSubfunction(ROW_INFORMATION, [0x02, ...word(1200)]),
      }),
      ...eolFunction({ subgroup: EOL_TABLE_OFF }),
    ]);
    expect(tablesOf(document)[0]?.rows[0]?.isHeader).toBeUndefined();
  });

  // A cell boundary must still close a cell whose pending text is empty but whose runs are not (a run already split off by an attribute change) — checking only pending text and accumulated cell blocks would wrongly drop it, even at Table Off, which otherwise skips closing an already-closed cell.
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

  // A cell boundary must still close a cell whose pending text and runs are both empty but which already holds a flushed paragraph (a hard return inside the cell) — Table Off otherwise skips closing an already-closed cell, and must not mistake "nothing pending" for "nothing to close".
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
    expect(tablesOf(document)[0]?.columns.map((c) => c.widthPt)).toEqual([72]);
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

  // A row still accumulating closed cells but never itself closed by any EOL boundary before the document area ends must still become a real row — not vanish along with the whole table, which happens only when it holds zero rows.
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
