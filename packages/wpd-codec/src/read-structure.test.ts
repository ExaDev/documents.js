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

  // "52 = level 1 style (indented)" -- an outline level, counted from zero by ContentListMembership.
  it("reads an outline level style as a list membership", () => {
    const document = readDocumentArea([
      ...styleScope(53, text("Nested item")),
      HARD_EOL,
    ]);
    expect(paragraphsOf(document)[0]?.list).toEqual({ level: 1 });
  });

  // An enclosing Global On naming the document's own Normal style must not override a heading opened inside it.
  it("takes the innermost style that says something structural", () => {
    const document = readDocumentArea([
      ...styleScope(1, styleScope(68, text("Heading"))),
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
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === WpdDiagnosticCodes.OutlineNumberRegenerated,
      ),
    ).toBe(true);
  });

  // Every other member of the group displays a counter inside running text and carries no structure, so its digits stay exactly where they are.
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
});

describe("constructs this reader does not lift", () => {
  // Each of these is recognised by the tokeniser and skipped by the fold, so a document containing it still reads -- and says what it lost rather than passing over it in silence.
  it.each([
    [0xdf, WpdDiagnosticCodes.BoxDropped],
    [0xd7, WpdDiagnosticCodes.NoteDropped],
    [0xd6, WpdDiagnosticCodes.HeaderFooterDropped],
    [0xd5, WpdDiagnosticCodes.CrossReferenceFlattened],
    [0xde, WpdDiagnosticCodes.MergeCodeDropped],
  ])("reports group %i through the diagnostic sink", (group, code) => {
    const { document, diagnostics } = readWithDiagnostics([
      ...text("before"),
      ...variableFunction({ group, subgroup: 0x00 }),
      ...text("after"),
    ]);
    expect(
      paragraphsOf(document)[0]
        ?.runs.map((run) => run.text)
        .join(""),
    ).toBe("beforeafter");
    expect(
      diagnostics.filter((diagnostic) => diagnostic.code === code),
    ).toHaveLength(1);
  });
});
