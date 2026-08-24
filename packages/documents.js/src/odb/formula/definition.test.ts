import type { OdbReport, OdbReportGroup } from "odf.js";
import { describe, expect, it } from "vitest";
import { formAndReportOdbPackage } from "../../test-support/odb-fixture";
import { readOdbReports } from "../components";
import { rptDefinitionFromReport } from "./definition";
import { RptReportStructureError } from "./errors";

// Coverage for the one file in src/odb/formula/ that knows odf.js's own report shape. The happy path runs on the real fixture (nested groups, a report-level function, bands with a mix of bound and fixed-content elements); the two refusals need hand-built OdbReport values, because no real .odb this package has ever read produces either shape.

function emptyReport(overrides: Partial<OdbReport> = {}): OdbReport {
  return {
    name: "R",
    href: "reports/R",
    groups: [],
    functions: [],
    ...overrides,
  };
}

function chainGroup(
  groupExpression: string | undefined,
  child?: OdbReportGroup,
): OdbReportGroup {
  return {
    groupExpression,
    functions: [],
    groups: child === undefined ? [] : [child],
  };
}

describe("rptDefinitionFromReport over the real fixture report", () => {
  it("flattens the nested rpt:group chain into an outermost-first list", () => {
    const report = readOdbReports(formAndReportOdbPackage())[0];
    if (report === undefined) {
      throw new Error(
        "fixture regression: form-and-report.odb no longer declares any report",
      );
    }

    // odf.js models the chain as a tree because the XML nests it: one group at the top, holding one child.
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]?.groups).toHaveLength(1);

    const definition = rptDefinitionFromReport(report);
    expect(definition.groups.map((group) => group.groupExpression)).toEqual([
      'rpt:HASCHANGED("REGION")',
      'rpt:HASCHANGED("LEFT_QUARTER")',
    ]);
    expect(definition.functions).toEqual([
      { name: "LEFT_QUARTER", formula: "rpt:LEFT([QUARTER];2)" },
    ]);
  });

  it("keeps one formula slot per band element, undefined where the element carries none", () => {
    const report = readOdbReports(formAndReportOdbPackage())[0];
    if (report === undefined) {
      throw new Error(
        "fixture regression: form-and-report.odb no longer declares any report",
      );
    }
    const definition = rptDefinitionFromReport(report);

    // Each footer is a "Region total:"/"Quarter total:"/"Grand total:" label with no formula, then the bound total.
    expect(definition.reportFooter?.formulas).toEqual([
      undefined,
      "rpt:SUM([AMOUNT])",
    ]);
    expect(definition.reportFooter?.formulas.length).toBe(
      report.reportFooter?.elements.length,
    );
    expect(definition.reportHeader?.formulas).toEqual([undefined]);
  });

  it("drops the page bands, which the formula evaluator has no pagination to place them against", () => {
    const report = readOdbReports(formAndReportOdbPackage())[0];
    if (report === undefined) {
      throw new Error(
        "fixture regression: form-and-report.odb no longer declares any report",
      );
    }

    // The fixture really does declare both, and neither carries an rpt:formula -- so dropping them here loses nothing evaluable.
    expect(report.pageHeader).toBeDefined();
    expect(report.pageFooter).toBeDefined();
    expect(
      [
        ...(report.pageHeader?.elements ?? []),
        ...(report.pageFooter?.elements ?? []),
      ].every((element) => element.formula === undefined),
    ).toBe(true);
    expect(Object.keys(rptDefinitionFromReport(report))).toEqual([
      "functions",
      "reportHeader",
      "groups",
      "detail",
      "reportFooter",
    ]);
  });
});

describe("rptDefinitionFromReport refusals", () => {
  it("refuses a group declaring no break test", () => {
    expect(() =>
      rptDefinitionFromReport(emptyReport({ groups: [chainGroup(undefined)] })),
    ).toThrow(RptReportStructureError);
    expect(() =>
      rptDefinitionFromReport(emptyReport({ groups: [chainGroup(undefined)] })),
    ).toThrow(/declares no rpt:group-expression/);
  });

  it("refuses sibling groups at one nesting level rather than keeping the first and dropping the rest", () => {
    const siblings = emptyReport({
      groups: [
        chainGroup('rpt:HASCHANGED("A")'),
        chainGroup('rpt:HASCHANGED("B")'),
      ],
    });
    expect(() => rptDefinitionFromReport(siblings)).toThrow(
      RptReportStructureError,
    );
    expect(() => rptDefinitionFromReport(siblings)).toThrow(
      /2 sibling groups are declared at one nesting level/,
    );
  });

  it("walks a chain of any depth", () => {
    const deep = emptyReport({
      groups: [
        chainGroup(
          'rpt:HASCHANGED("A")',
          chainGroup('rpt:HASCHANGED("B")', chainGroup('rpt:HASCHANGED("C")')),
        ),
      ],
    });
    expect(
      rptDefinitionFromReport(deep).groups.map(
        (group) => group.groupExpression,
      ),
    ).toEqual([
      'rpt:HASCHANGED("A")',
      'rpt:HASCHANGED("B")',
      'rpt:HASCHANGED("C")',
    ]);
  });
});
