import type { ContentDocument } from "document-schema.js";
import { ContentDocumentSchema } from "document-schema.js";
import { readOdbInventory } from "odf.js";
import {
  createFontMeasurer,
  createFontRegistry,
  loadMathFont,
  writePdf,
} from "pdf-codec";
const mathMetricsAt = (sizePt: number) => loadMathFont().metricsAt(sizePt);
import { describe, expect, it } from "vitest";
import { convertWordprocessingToLayout } from "../../layout/engine";
import { PAGE_SIZE_A4 } from "document-schema.js";
import { formAndReportOdbPackage } from "../../test-support/odb-fixture";
import { readOdbReports } from "../components";
import { readOdbTables } from "../read";
import type { SqlResultSet } from "../sql/evaluate";
import { evaluateSelect } from "../sql/evaluate";
import { parseSelect } from "../sql/parser";
import { readOdbReportContent } from "./content";
import { renderOdbReportContent } from "./render";
import {
  OdbReportDataSourceError,
  odbReportCommandSql,
  resolveOdbReportRows,
} from "./source";

// The end-to-end proof for the whole .odb report chain: a real Report Builder report, read out of a real .odb, bound to its own real saved query, run through this package's own SQL engine and rpt formula engine, and rendered to a real ContentDocument. Every link is genuine -- the report's bands, groups, named rpt:function and formulas come from the package via readOdbReport; the SQL comes from the package's own db:command; the rows come from readOdbTables' Tier 3 Firebird decoder -- so a regression anywhere along that chain surfaces here rather than being papered over by a transcribed expectation.
//
// THE EXPECTED TOTALS ARE COMPUTED BY HAND FROM THE REAL SALES DATA and asserted exactly, both as the text the document carries and as exact numbers. The fixture's SALES table holds six real rows (see src/test-support/odb-fixture.ts):
//
// North  Q1  Acme Ltd         1200.50 North  Q1  Bolt Supplies     340.00 North  Q2  Crown Foods      2750.25 South  Q1  Delta Print        95.75 South  Q2  Everest Tools    1810.00 West   Q2  Foxglove Design    60.00
//
// The report binds to the saved HighValueSales query, which keeps only AMOUNT >= 100 -- dropping Delta Print and Foxglove Design -- and orders by REGION, then QUARTER, then AMOUNT descending. Over those four rows, by hand:
//
// quarter totals: North/Q1 = 1200.50 + 340.00 = 1540.50; North/Q2 = 2750.25; South/Q2 = 1810.00 region totals:  North = 1200.50 + 340.00 + 2750.25 = 4290.75; South = 1810.00 grand total:    4290.75 + 1810.00 = 6100.75
//
// The second suite renders the identical report over all six rows, where the arithmetic is:
//
// quarter totals: North/Q1 = 1540.50; North/Q2 = 2750.25; South/Q1 = 95.75; South/Q2 = 1810.00; West/Q2 = 60.00 region totals:  North = 4290.75; South = 95.75 + 1810.00 = 1905.75; West = 60.00 grand total:    4290.75 + 1905.75 + 60.00 = 6256.50
//
// Every one of those values is exactly representable in binary floating point (each amount is a whole number of quarters), so exact equality is the right assertion here rather than a tolerance.

interface RenderedBand {
  readonly band: string;
  readonly cells: readonly string[];
}

function salesReport() {
  const report = readOdbReports(formAndReportOdbPackage())[0];
  if (report === undefined) {
    throw new Error(
      "fixture regression: form-and-report.odb no longer declares any report",
    );
  }
  return report;
}

// The whole SALES table under the same REGION/QUARTER/AMOUNT ordering the report's own saved query applies, with that query's AMOUNT >= 100 filter dropped, so the two rows it excludes take part in the grouping too.
function everySalesRow(): SqlResultSet {
  return evaluateSelect(
    parseSelect(
      "SELECT REGION, QUARTER, CUSTOMER, AMOUNT FROM SALES ORDER BY REGION ASC, QUARTER ASC, AMOUNT DESC",
    ),
    readOdbTables(formAndReportOdbPackage()),
  );
}

// The rendered document flattened back to the band structure it encodes: one entry per block, naming the band that printed it (from its cells' own paragraph style) and the text of each of its cells. Everything this test asserts about structure, ordering, and totals reads off this one projection, so a change to the mapping shows up as a change to every expectation rather than being absorbed by a lenient matcher.
function renderedBands(document: ContentDocument): readonly RenderedBand[] {
  if (document.kind !== "wordprocessing") {
    throw new Error(
      `expected a wordprocessing ContentDocument, got "${document.kind}"`,
    );
  }
  const section = document.sections[0];
  if (section === undefined || document.sections.length !== 1) {
    throw new Error(
      `expected exactly one section, got ${String(document.sections.length)}`,
    );
  }
  return section.blocks.map((block) => {
    if (block.kind !== "table") {
      throw new Error(
        `expected every band to render as a table, got a "${block.kind}" block`,
      );
    }
    const row = block.rows[0];
    if (row === undefined || block.rows.length !== 1) {
      throw new Error(
        `expected exactly one row per band table, got ${String(block.rows.length)}`,
      );
    }
    const paragraphs = row.cells.map((cell) => {
      const paragraph = cell.blocks[0];
      if (paragraph?.kind !== "paragraph" || cell.blocks.length !== 1) {
        throw new Error("expected exactly one paragraph per band cell");
      }
      return paragraph;
    });
    const bandStyles = new Set(
      paragraphs.map((paragraph) => paragraph.styleId),
    );
    const band = [...bandStyles][0];
    if (band === undefined || bandStyles.size !== 1) {
      throw new Error(
        `expected every cell of one band to carry one band style, got ${[...bandStyles].join(", ")}`,
      );
    }
    return {
      band,
      cells: paragraphs.map((paragraph) =>
        paragraph.runs.map((run) => run.text).join(""),
      ),
    };
  });
}

function cellsOfBand(
  bands: readonly RenderedBand[],
  band: string,
): readonly (readonly string[])[] {
  return bands
    .filter((rendered) => rendered.band === band)
    .map((rendered) => rendered.cells);
}

// A band's own total, as the exact number it renders. Number('1540.5') is exactly 1540.5, so this asserts the arithmetic itself rather than only its formatting.
function totalsOfBand(
  bands: readonly RenderedBand[],
  band: string,
): readonly number[] {
  return cellsOfBand(bands, band).map((cells) => Number(cells[1]));
}

describe("the real SalesByRegion report rendered end to end from form-and-report.odb", () => {
  it("binds to its own saved query, read straight out of the package rather than restated here", () => {
    const report = salesReport();
    expect(report.commandType).toBe("query");
    expect(report.command).toBe("HighValueSales");

    const inventory = readOdbInventory(formAndReportOdbPackage());
    // Resolving rpt:command-type "query" means finding that saved query and taking its own db:command -- the very SQL src/odb/sql/ then parses and runs.
    expect(odbReportCommandSql(report, inventory.queries)).toBe(
      inventory.queries[0]?.command,
    );
    expect(odbReportCommandSql(report, inventory.queries)).toContain(
      'WHERE "SALES"."AMOUNT" >= 100',
    );
  });

  it("renders every band in print order, with the right group structure, detail rows, and hand-computed totals", () => {
    const bands = renderedBands(
      readOdbReportContent(formAndReportOdbPackage()),
    );

    expect(bands).toEqual([
      { band: "Report Header", cells: ["Sales by region"] },
      // The page header prints once, below the report's own title and above the body -- this renderer's single logical page. The page footer declares no controls at all in this fixture, so it contributes no block, which is why nothing sits between the last region total and the grand total below.
      { band: "Page Header", cells: ["Customer", "Amount"] },
      { band: "Group Header 1", cells: ["North"] },
      { band: "Group Header 2", cells: ["Q1"] },
      { band: "Detail", cells: ["Acme Ltd", "1200.5"] },
      { band: "Detail", cells: ["Bolt Supplies", "340"] },
      { band: "Group Footer 2", cells: ["Quarter total:", "1540.5"] },
      { band: "Group Header 2", cells: ["Q2"] },
      { band: "Detail", cells: ["Crown Foods", "2750.25"] },
      { band: "Group Footer 2", cells: ["Quarter total:", "2750.25"] },
      // The inner group's footer closes before the outer one's, and both close before the next region opens.
      { band: "Group Footer 1", cells: ["Region total:", "4290.75"] },
      { band: "Group Header 1", cells: ["South"] },
      // South's first row is Q2, and the quarter did not change across the North-to-South transition -- the inner group still breaks, because its enclosing group did.
      { band: "Group Header 2", cells: ["Q2"] },
      { band: "Detail", cells: ["Everest Tools", "1810"] },
      { band: "Group Footer 2", cells: ["Quarter total:", "1810"] },
      { band: "Group Footer 1", cells: ["Region total:", "1810"] },
      { band: "Report Footer", cells: ["Grand total:", "6100.75"] },
    ]);
  });

  it("totals exactly the hand-computed amounts at each of the three real SUM scopes", () => {
    const bands = renderedBands(
      readOdbReportContent(formAndReportOdbPackage()),
    );

    expect(totalsOfBand(bands, "Group Footer 2")).toEqual([
      1540.5, 2750.25, 1810,
    ]);
    expect(totalsOfBand(bands, "Group Footer 1")).toEqual([4290.75, 1810]);
    expect(totalsOfBand(bands, "Report Footer")).toEqual([6100.75]);

    // Each level's own totals add up to the level above it, which is what makes these three numbers one consistent set rather than three independently plausible ones.
    expect(1200.5 + 340).toBe(1540.5);
    expect(1540.5 + 2750.25).toBe(4290.75);
    expect(4290.75 + 1810).toBe(6100.75);
  });

  it("carries each detail row own values through in the query own order", () => {
    const bands = renderedBands(
      readOdbReportContent(formAndReportOdbPackage()),
    );

    expect(cellsOfBand(bands, "Detail")).toEqual([
      ["Acme Ltd", "1200.5"],
      ["Bolt Supplies", "340"],
      ["Crown Foods", "2750.25"],
      ["Everest Tools", "1810"],
    ]);
    // The two rows the saved query's own AMOUNT >= 100 filter excludes are genuinely absent, not merely sorted elsewhere.
    expect(bands.flatMap((band) => band.cells)).not.toContain("Delta Print");
    expect(bands.flatMap((band) => band.cells)).not.toContain(
      "Foxglove Design",
    );
  });

  it("produces one A4 section whose band tables each span the full content width", () => {
    const document = readOdbReportContent(formAndReportOdbPackage());
    if (document.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing ContentDocument, got "${document.kind}"`,
      );
    }
    const section = document.sections[0];
    if (section === undefined) {
      throw new Error("expected the rendered report to carry a section");
    }

    expect(document.metadata.title).toBe("Sales by region"); // office:caption, not the db:component name.
    expect(section.pageSize).toEqual(PAGE_SIZE_A4);
    const contentWidthPt =
      PAGE_SIZE_A4.widthPt - (section.margins.leftPt + section.margins.rightPt);
    for (const block of section.blocks) {
      if (block.kind !== "table") {
        throw new Error(
          `expected every band to render as a table, got a "${block.kind}" block`,
        );
      }
      expect(
        block.columnWidthsPt.reduce((total, width) => total + width, 0),
      ).toBeCloseTo(contentWidthPt, 10);
    }
  });

  it("is a real ContentDocument the wordprocessing pipeline already consumes, not merely a schema-shaped one", () => {
    const document = readOdbReportContent(formAndReportOdbPackage());
    if (document.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing ContentDocument, got "${document.kind}"`,
      );
    }
    // The README's claim that a rendered report needs no odbToPdf of its own -- being an ordinary document of a variant this package already lays out -- proven rather than asserted.
    expect(() => ContentDocumentSchema.parse(document)).not.toThrow();
    const { document: layout } = convertWordprocessingToLayout(document, {
      measurer: createFontMeasurer(createFontRegistry()),
      mathMetricsAt,
    });
    expect(layout.pages.length).toBeGreaterThan(0);
    expect(writePdf(layout).length).toBeGreaterThan(0);
  });
});

describe("the same real report rendered over all six real SALES rows", () => {
  it("groups every region and quarter, and totals each scope to the hand-computed amount", () => {
    const bands = renderedBands(
      renderOdbReportContent(salesReport(), everySalesRow()),
    );

    expect(cellsOfBand(bands, "Group Header 1")).toEqual([
      ["North"],
      ["South"],
      ["West"],
    ]);
    // South's Q2 and West's Q2 are consecutive rows sharing a quarter, and are still separate quarter groups -- the enclosing region break cascades inward.
    expect(cellsOfBand(bands, "Group Header 2")).toEqual([
      ["Q1"],
      ["Q2"],
      ["Q1"],
      ["Q2"],
      ["Q2"],
    ]);

    expect(totalsOfBand(bands, "Group Footer 2")).toEqual([
      1540.5, 2750.25, 95.75, 1810, 60,
    ]);
    expect(totalsOfBand(bands, "Group Footer 1")).toEqual([
      4290.75, 1905.75, 60,
    ]);
    expect(totalsOfBand(bands, "Report Footer")).toEqual([6256.5]);

    expect(95.75 + 1810).toBe(1905.75);
    expect(4290.75 + 1905.75 + 60).toBe(6256.5);
  });

  it("renders the two rows the report own query excluded, in their real grouped positions", () => {
    const bands = renderedBands(
      renderOdbReportContent(salesReport(), everySalesRow()),
    );

    expect(cellsOfBand(bands, "Detail")).toEqual([
      ["Acme Ltd", "1200.5"],
      ["Bolt Supplies", "340"],
      ["Crown Foods", "2750.25"],
      ["Delta Print", "95.75"],
      ["Everest Tools", "1810"],
      ["Foxglove Design", "60"],
    ]);
  });
});

// The fixture's own report declares one of the three real rpt:command-type shapes ("query"), so the other two are exercised by re-binding that same real report to this same real package's own table -- still real data and a real engine on both sides, just a binding LibreOffice happened not to write here.
describe("the three real rpt:command-type binding shapes, resolved against the real package", () => {
  const queries = () => readOdbInventory(formAndReportOdbPackage()).queries;

  it("turns a table binding into a real SELECT-all that runs against the real table", () => {
    const asTable = {
      ...salesReport(),
      command: "SALES",
      commandType: "table",
    };

    expect(odbReportCommandSql(asTable, queries())).toBe(
      'SELECT * FROM "SALES"',
    );
    // Every row of the real table, since a table binding carries no filter of its own -- two more than the saved query keeps.
    expect(
      resolveOdbReportRows(formAndReportOdbPackage(), asTable).rows,
    ).toHaveLength(6);
  });

  it("passes an inline command binding through as the SQL it is", () => {
    const asCommand = {
      ...salesReport(),
      command: "SELECT CUSTOMER, AMOUNT FROM SALES WHERE AMOUNT < 100",
      commandType: "command",
    };

    expect(odbReportCommandSql(asCommand, queries())).toBe(
      "SELECT CUSTOMER, AMOUNT FROM SALES WHERE AMOUNT < 100",
    );
    expect(
      resolveOdbReportRows(formAndReportOdbPackage(), asCommand).rows,
    ).toEqual([
      [
        { kind: "string", value: "Delta Print" },
        { kind: "number", value: 95.75 },
      ],
      [
        { kind: "string", value: "Foxglove Design" },
        { kind: "number", value: 60 },
      ],
    ]);
  });

  it("names a binding it cannot resolve rather than falling back to another reading of it", () => {
    const report = salesReport();

    expect(() =>
      odbReportCommandSql({ ...report, command: "NoSuchQuery" }, queries()),
    ).toThrow(OdbReportDataSourceError);
    expect(() =>
      odbReportCommandSql({ ...report, commandType: undefined }, queries()),
    ).toThrow(/no rpt:command-type/);
    expect(() =>
      odbReportCommandSql({ ...report, command: undefined }, queries()),
    ).toThrow(/declares no rpt:command/);
    expect(() =>
      odbReportCommandSql(
        { ...report, commandType: "sql-pass-through" },
        queries(),
      ),
    ).toThrow(/not one of the three values/);
  });
});
