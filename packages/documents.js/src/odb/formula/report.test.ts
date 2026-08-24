import type { ContentCellValue } from "document-schema.js";
import { readOdbInventory } from "odf.js";
import { describe, expect, it } from "vitest";
import { formAndReportOdbPackage } from "../../test-support/odb-fixture";
import { readOdbReports } from "../components";
import { readOdbTables } from "../read";
import type { SqlResultSet } from "../sql/evaluate";
import { evaluateSelect } from "../sql/evaluate";
import { parseSelect } from "../sql/parser";
import { rptDefinitionFromReport } from "./definition";
import type { RptBandInstance } from "./evaluate";
import { runRptReport } from "./evaluate";

// The end-to-end proof for src/odb/formula/: a real Report Builder report, read out of a real .odb, run over that same .odb's own real data. Nothing here is hand-authored -- the report's bands, groups, named function, and every rpt formula come from the package itself via readOdbReport; the rows come from readOdbTables' Tier 3 Firebird decoder by way of src/odb/sql/'s own engine; so a regression in the parser, the scoping, the report reader, the query engine, or the fixture surfaces here rather than being papered over by a transcribed expectation.
//
// The fixture is ExaDev/odf.js's own form-and-report.odb (see src/test-support/odb-fixture.ts for its provenance). Its SalesByRegion report is exactly the shape this engine exists for: two nested groups, one report-level rpt:function wrapping rpt:LEFT, and rpt:SUM([AMOUNT]) at all three footer levels. Its inner group breaks on the quarter while its outer group breaks on the region, which is what makes it a genuine test of the enclosing-break cascade -- see the assertions on the North Q2 to South Q2 transition below.

const EXPECTED_FUNCTION_FORMULA = "rpt:LEFT([QUARTER];2)";
const EXPECTED_OUTER_GROUP_EXPRESSION = 'rpt:HASCHANGED("REGION")';
const EXPECTED_INNER_GROUP_EXPRESSION = 'rpt:HASCHANGED("LEFT_QUARTER")';
const EXPECTED_FOOTER_TOTAL_FORMULA = "rpt:SUM([AMOUNT])";

function salesReport() {
  const reports = readOdbReports(formAndReportOdbPackage());
  const report = reports[0];
  if (report === undefined) {
    throw new Error(
      "fixture regression: form-and-report.odb no longer declares any report",
    );
  }
  return report;
}

// The rows the report itself declares it renders: rpt:command names the HighValueSales saved query, so this runs that query rather than reading the SALES table wholesale.
function reportRows(): SqlResultSet {
  const pkg = formAndReportOdbPackage();
  const commandName = salesReport().command;
  const query = readOdbInventory(pkg).queries.find(
    (candidate) => candidate.name === commandName,
  );
  if (query?.command === undefined) {
    throw new Error(
      `fixture regression: the report's own rpt:command "${String(commandName)}" names no saved query with a db:command`,
    );
  }
  return evaluateSelect(parseSelect(query.command), readOdbTables(pkg));
}

// The whole SALES table under the report's own sort order, for the wider six-row exercise below -- the same REGION/QUARTER/AMOUNT ordering the saved query applies, with its AMOUNT >= 100 filter dropped so the two rows the query excludes take part in the grouping too.
function everySalesRow(): SqlResultSet {
  return evaluateSelect(
    parseSelect(
      "SELECT REGION, QUARTER, CUSTOMER, AMOUNT FROM SALES ORDER BY REGION ASC, QUARTER ASC, AMOUNT DESC",
    ),
    readOdbTables(formAndReportOdbPackage()),
  );
}

function numberAt(
  band: RptBandInstance | undefined,
  index: number,
): number | undefined {
  const value = band?.values[index];
  return value?.kind === "number" ? value.value : undefined;
}

function stringAt(
  band: RptBandInstance | undefined,
  index: number,
): string | undefined {
  const value = band?.values[index];
  return value?.kind === "string" ? value.value : undefined;
}

// Every band of one kind (and, for a group band, one level) in print order.
function bandsOfKind(
  bands: readonly RptBandInstance[],
  kind: RptBandInstance["kind"],
  groupLevel?: number,
): readonly RptBandInstance[] {
  return bands.filter(
    (band) =>
      band.kind === kind &&
      (groupLevel === undefined || band.groupLevel === groupLevel),
  );
}

describe("the real SalesByRegion report own formulas, read straight out of form-and-report.odb", () => {
  it("declares the formulas this engine is built for, rather than this test restating them", () => {
    const report = salesReport();
    expect(report.functions).toEqual([
      { name: "LEFT_QUARTER", formula: EXPECTED_FUNCTION_FORMULA },
    ]);

    const definition = rptDefinitionFromReport(report);
    expect(definition.groups.map((group) => group.groupExpression)).toEqual([
      EXPECTED_OUTER_GROUP_EXPRESSION,
      EXPECTED_INNER_GROUP_EXPRESSION,
    ]);

    // rpt:SUM([AMOUNT]) at all three real footer locations: the inner group's ("Quarter total:"), the outer group's ("Region total:"), and the report's ("Grand total:").
    expect(definition.groups[1]?.footer?.formulas).toEqual([
      undefined,
      EXPECTED_FOOTER_TOTAL_FORMULA,
    ]);
    expect(definition.groups[0]?.footer?.formulas).toEqual([
      undefined,
      EXPECTED_FOOTER_TOTAL_FORMULA,
    ]);
    expect(definition.reportFooter?.formulas).toEqual([
      undefined,
      EXPECTED_FOOTER_TOTAL_FORMULA,
    ]);

    // The detail band and both group headers are plain field: bindings -- no computation, just a column value passing through.
    expect(definition.detail?.formulas).toEqual([
      "field:[CUSTOMER]",
      "field:[AMOUNT]",
    ]);
    expect(definition.groups[0]?.header?.formulas).toEqual(["field:[REGION]"]);
    expect(definition.groups[1]?.header?.formulas).toEqual(["field:[QUARTER]"]);
  });

  it("runs over the four rows its own rpt:command query returns", () => {
    const rows = reportRows();
    expect(rows.columns).toEqual(["REGION", "QUARTER", "CUSTOMER", "AMOUNT"]);
    expect(
      rows.rows.map((row) =>
        row[2]?.kind === "string" ? row[2].value : undefined,
      ),
    ).toEqual(["Acme Ltd", "Bolt Supplies", "Crown Foods", "Everest Tools"]);
  });

  it("emits every band in print order, with the group breaks falling at exactly the right row transitions", () => {
    const { bands } = runRptReport(
      rptDefinitionFromReport(salesReport()),
      reportRows(),
    );

    expect(
      bands.map(
        (band) =>
          `${band.kind}${band.groupLevel === undefined ? "" : `:${String(band.groupLevel)}`}@${band.rowIndex === undefined ? "-" : String(band.rowIndex)}`,
      ),
    ).toEqual([
      "report-header@-",
      // Row 0 (North, Q1) opens both groups.
      "group-header:0@0",
      "group-header:1@0",
      "detail@0",
      // Row 1 (North, Q1) breaks nothing -- same region, same quarter.
      "detail@1",
      // Row 2 (North, Q2) breaks the inner group only: the quarter changed, the region did not.
      "group-footer:1@1",
      "group-header:1@2",
      "detail@2",
      // Row 3 (South, Q2) breaks the outer group, which CASCADES into the inner one even though the quarter is Q2 on both sides of the transition.
      "group-footer:1@2",
      "group-footer:0@2",
      "group-header:0@3",
      "group-header:1@3",
      "detail@3",
      // End of data closes both open groups, innermost first.
      "group-footer:1@3",
      "group-footer:0@3",
      "report-footer@-",
    ]);
  });

  it("computes LEFT_QUARTER through the named rpt:function, and each group header field", () => {
    const { bands } = runRptReport(
      rptDefinitionFromReport(salesReport()),
      reportRows(),
    );

    expect(
      bandsOfKind(bands, "group-header", 0).map((band) => stringAt(band, 0)),
    ).toEqual(["North", "South"]);
    // The inner group's own header prints field:[QUARTER], while the break it opens on is decided by rpt:HASCHANGED("LEFT_QUARTER") -- the named function wrapping rpt:LEFT([QUARTER];2).
    expect(
      bandsOfKind(bands, "group-header", 1).map((band) => stringAt(band, 0)),
    ).toEqual(["Q1", "Q2", "Q2"]);
  });

  it("totals exactly the right AMOUNT values in each of the three real SUM scopes", () => {
    const { bands } = runRptReport(
      rptDefinitionFromReport(salesReport()),
      reportRows(),
    );

    // Inner ("Quarter total:") -- North/Q1 is 1200.50 + 340.00; North/Q2 is Crown Foods alone; South/Q2 is Everest Tools alone. The middle number is the cascade's whole point: without it, North's Q2 and South's Q2 would total 4560.25 together.
    expect(
      bandsOfKind(bands, "group-footer", 1).map((band) => numberAt(band, 1)),
    ).toEqual([1540.5, 2750.25, 1810]);

    // Outer ("Region total:").
    expect(
      bandsOfKind(bands, "group-footer", 0).map((band) => numberAt(band, 1)),
    ).toEqual([4290.75, 1810]);

    // Report ("Grand total:") -- every row the query returned.
    expect(
      bandsOfKind(bands, "report-footer").map((band) => numberAt(band, 1)),
    ).toEqual([6100.75]);

    // The three scopes are consistent by construction: each level's totals sum to the level above it.
    expect(1540.5 + 2750.25 + 1810).toBeCloseTo(6100.75, 10);
    expect(4290.75 + 1810).toBeCloseTo(6100.75, 10);
  });

  it("passes each detail row own CUSTOMER and AMOUNT straight through its field: bindings", () => {
    const { bands } = runRptReport(
      rptDefinitionFromReport(salesReport()),
      reportRows(),
    );
    const detail = bandsOfKind(bands, "detail");

    expect(detail.map((band) => stringAt(band, 0))).toEqual([
      "Acme Ltd",
      "Bolt Supplies",
      "Crown Foods",
      "Everest Tools",
    ]);
    expect(detail.map((band) => numberAt(band, 1))).toEqual([
      1200.5, 340, 2750.25, 1810,
    ]);
  });
});

describe("the same real report own formulas over all six real SALES rows", () => {
  // The saved query filters two rows out, which happens to hide one instance of the cascade. Running the identical report definition over the whole table in the same REGION/QUARTER/AMOUNT order exercises it twice: at the North-to-South transition (Q2 to Q1, where the inner group would have broken anyway) and at the South-to-West one (Q2 to Q2, where only the cascade breaks it).
  it("breaks the inner group at the South-to-West transition, where the quarter itself does not change", () => {
    const { bands } = runRptReport(
      rptDefinitionFromReport(salesReport()),
      everySalesRow(),
    );

    expect(
      bandsOfKind(bands, "group-header", 0).map((band) => stringAt(band, 0)),
    ).toEqual(["North", "South", "West"]);
    expect(
      bandsOfKind(bands, "group-header", 1).map(
        (band) => `${String(band.rowIndex)}:${String(stringAt(band, 0))}`,
      ),
    ).toEqual(["0:Q1", "2:Q2", "3:Q1", "4:Q2", "5:Q2"]);
  });

  it("totals each scope over exactly its own rows", () => {
    const { bands } = runRptReport(
      rptDefinitionFromReport(salesReport()),
      everySalesRow(),
    );

    // North/Q1 (1200.50 + 340.00), North/Q2, South/Q1, South/Q2, West/Q2. The last two are the cascade: South's Q2 row and West's Q2 row are consecutive and share a quarter, and they are still separate totals.
    expect(
      bandsOfKind(bands, "group-footer", 1).map((band) => numberAt(band, 1)),
    ).toEqual([1540.5, 2750.25, 95.75, 1810, 60]);
    expect(
      bandsOfKind(bands, "group-footer", 0).map((band) => numberAt(band, 1)),
    ).toEqual([4290.75, 1905.75, 60]);
    expect(
      bandsOfKind(bands, "report-footer").map((band) => numberAt(band, 1)),
    ).toEqual([6256.5]);
  });

  // The per-region totals this report produces are the same numbers the SQL engine reaches by a completely different route -- GROUP BY REGION rather than report grouping -- so the two implementations cross-check each other on the same real data.
  it("reaches the same per-region totals the SQL engine own GROUP BY does", () => {
    const grouped = evaluateSelect(
      parseSelect(
        "SELECT REGION, SUM(AMOUNT) FROM SALES GROUP BY REGION ORDER BY REGION ASC",
      ),
      readOdbTables(formAndReportOdbPackage()),
    );
    const viaSql = grouped.rows.map((row) =>
      row[1]?.kind === "number" ? row[1].value : undefined,
    );

    const { bands } = runRptReport(
      rptDefinitionFromReport(salesReport()),
      everySalesRow(),
    );
    expect(
      bandsOfKind(bands, "group-footer", 0).map((band) => numberAt(band, 1)),
    ).toEqual(viaSql);
  });

  // rpt:HASCHANGED on its own, with no enclosing group to cascade from, is a purely per-row comparison -- which is exactly why the cascade above has to live in the report structure rather than inside HASCHANGED. Same expression, same rows, one group instead of two: South's Q2 row and West's Q2 row now fall in ONE instance, because nothing broke between them.
  it("groups South and West Q2 together when the quarter is the only group, proving HASCHANGED itself carries no nesting rule", () => {
    const report = salesReport();
    const inner = rptDefinitionFromReport(report).groups[1];
    if (inner === undefined) {
      throw new Error(
        "fixture regression: the report no longer declares a second, inner group",
      );
    }
    const { bands } = runRptReport(
      {
        functions: [
          { name: "LEFT_QUARTER", formula: EXPECTED_FUNCTION_FORMULA },
        ],
        reportHeader: undefined,
        groups: [inner],
        detail: undefined,
        reportFooter: undefined,
      },
      everySalesRow(),
    );

    expect(
      bandsOfKind(bands, "group-footer", 0).map((band) => numberAt(band, 1)),
    ).toEqual([1540.5, 2750.25, 95.75, 1870]);
    expect(1810 + 60).toBe(1870);
  });
});

describe("rpt:LEFT over real fixture data long enough to actually truncate", () => {
  // The report's own LEFT([QUARTER];2) runs over two-character quarters, so it is a real formula that happens not to shorten anything. Pointing the same function at the same fixture's CUSTOMER column proves the prefix logic itself.
  it("takes the first n characters of a real column value", () => {
    const rows = everySalesRow();
    const { bands } = runRptReport(
      {
        functions: [
          { name: "CUSTOMER_PREFIX", formula: "rpt:LEFT([CUSTOMER];4)" },
        ],
        reportHeader: undefined,
        groups: [],
        detail: { formulas: ["field:[CUSTOMER]", "rpt:LEFT([CUSTOMER];4)"] },
        reportFooter: undefined,
      },
      rows,
    );

    const detail = bands.filter((band) => band.kind === "detail");
    expect(detail.map((band) => stringAt(band, 0))).toEqual([
      "Acme Ltd",
      "Bolt Supplies",
      "Crown Foods",
      "Delta Print",
      "Everest Tools",
      "Foxglove Design",
    ]);
    expect(detail.map((band) => stringAt(band, 1))).toEqual([
      "Acme",
      "Bolt",
      "Crow",
      "Delt",
      "Ever",
      "Foxg",
    ]);
  });

  it("resolves the report own LEFT_QUARTER by name to the two-character quarter prefix", () => {
    const { bands } = runRptReport(
      {
        functions: [
          { name: "LEFT_QUARTER", formula: EXPECTED_FUNCTION_FORMULA },
        ],
        reportHeader: undefined,
        groups: [],
        detail: { formulas: ["field:[LEFT_QUARTER]"] },
        reportFooter: undefined,
      },
      everySalesRow(),
    );

    expect(
      bands
        .filter((band) => band.kind === "detail")
        .map((band) => stringAt(band, 0)),
    ).toEqual(["Q1", "Q1", "Q2", "Q1", "Q2", "Q2"]);
  });
});

describe("the report own data reaching a formula", () => {
  it("carries a field: value through unchanged, kind included", () => {
    const { bands } = runRptReport(
      {
        functions: [],
        reportHeader: undefined,
        groups: [],
        detail: { formulas: ["field:[AMOUNT]"] },
        reportFooter: undefined,
      },
      reportRows(),
    );
    const first: ContentCellValue | undefined = bands[0]?.values[0];

    expect(first).toEqual({ kind: "number", value: 1200.5 });
  });
});
