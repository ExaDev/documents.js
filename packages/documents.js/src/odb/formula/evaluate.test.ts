import type { ContentCellValue } from "document-schema.js";
import { describe, expect, it } from "vitest";
import type { SqlResultSet } from "../sql/evaluate";
import {
  RptFormulaEvaluationError,
  RptFormulaUnsupportedError,
} from "./errors";
import type {
  RptBandDefinition,
  RptBandInstance,
  RptGroupDefinition,
  RptReportDefinition,
} from "./evaluate";
import { runRptReport } from "./evaluate";

// Unit coverage for the scoping rule and the failure policy, over synthetic data chosen to isolate one behaviour at a time. The real report's own formulas over the real fixture's own rows are in src/odb/formula/report.test.ts; this file exists to pin down the cases that fixture happens not to contain -- three levels of nesting rather than two, NULLs, an empty result set, an aggregate declared on a group rather than on the report, and every error path.

function text(value: string): ContentCellValue {
  return { kind: "string", value };
}

function amount(value: number): ContentCellValue {
  return { kind: "number", value };
}

const NULL_VALUE: ContentCellValue = { kind: "empty" };

function resultSet(
  columns: readonly string[],
  rows: readonly (readonly ContentCellValue[])[],
): SqlResultSet {
  return { columns, rows };
}

function band(...formulas: readonly (string | undefined)[]): RptBandDefinition {
  return { formulas };
}

function group(
  groupExpression: string,
  options: Partial<Omit<RptGroupDefinition, "groupExpression">> = {},
): RptGroupDefinition {
  return {
    groupExpression,
    functions: options.functions ?? [],
    header: options.header,
    footer: options.footer,
  };
}

function report(definition: Partial<RptReportDefinition>): RptReportDefinition {
  return {
    functions: definition.functions ?? [],
    reportHeader: definition.reportHeader,
    groups: definition.groups ?? [],
    detail: definition.detail,
    reportFooter: definition.reportFooter,
  };
}

function numberAt(
  instance: RptBandInstance,
  index: number,
): number | undefined {
  const value = instance.values[index];
  return value?.kind === "number" ? value.value : undefined;
}

function totalsOf(
  bands: readonly RptBandInstance[],
  kind: RptBandInstance["kind"],
  groupLevel?: number,
): readonly (number | undefined)[] {
  return bands
    .filter(
      (instance) =>
        instance.kind === kind &&
        (groupLevel === undefined || instance.groupLevel === groupLevel),
    )
    .map((instance) => numberAt(instance, 0));
}

// Three nested groups over five rows, arranged so that the last row breaks the OUTERMOST group while both inner group expressions are unchanged across that same transition -- the cascade has to propagate two levels deep, not one.
const THREE_LEVEL_ROWS = resultSet(
  ["A", "B", "C", "V"],
  [
    [text("x"), text("p"), text("1"), amount(10)],
    [text("x"), text("p"), text("1"), amount(20)],
    [text("x"), text("p"), text("2"), amount(30)],
    [text("x"), text("q"), text("2"), amount(40)],
    [text("y"), text("q"), text("2"), amount(50)],
  ],
);

const THREE_LEVEL_REPORT = report({
  groups: [
    group('rpt:HASCHANGED("A")', { footer: band("rpt:SUM([V])") }),
    group('rpt:HASCHANGED("B")', { footer: band("rpt:SUM([V])") }),
    group('rpt:HASCHANGED("C")', { footer: band("rpt:SUM([V])") }),
  ],
  detail: band("field:[V]"),
  reportFooter: band("rpt:SUM([V])"),
});

describe("group scoping", () => {
  it("cascades an enclosing break through every level beneath it", () => {
    const { bands } = runRptReport(THREE_LEVEL_REPORT, THREE_LEVEL_ROWS);

    // Row 4 changes only A. B is "q" and C is "2" on both rows 3 and 4, so neither inner group expression fires there -- yet both inner groups must still start a new instance, which is what splits 40 and 50 rather than totalling them together.
    expect(totalsOf(bands, "group-footer", 2)).toEqual([30, 30, 40, 50]);
    expect(totalsOf(bands, "group-footer", 1)).toEqual([60, 40, 50]);
    expect(totalsOf(bands, "group-footer", 0)).toEqual([100, 50]);
    expect(totalsOf(bands, "report-footer")).toEqual([150]);
  });

  it("closes group footers innermost first and opens group headers outermost first", () => {
    const { bands } = runRptReport(
      report({
        groups: [
          group('rpt:HASCHANGED("A")', { header: band(), footer: band() }),
          group('rpt:HASCHANGED("B")', { header: band(), footer: band() }),
        ],
        detail: band(),
      }),
      resultSet(
        ["A", "B"],
        [
          [text("x"), text("p")],
          [text("y"), text("q")],
        ],
      ),
    );

    expect(
      bands.map(
        (instance) => `${instance.kind}:${String(instance.groupLevel ?? "-")}`,
      ),
    ).toEqual([
      "group-header:0",
      "group-header:1",
      "detail:-",
      "group-footer:1",
      "group-footer:0",
      "group-header:0",
      "group-header:1",
      "detail:-",
      "group-footer:1",
      "group-footer:0",
    ]);
  });

  it("gives a group HEADER the true total for the group it is opening, not a running total of its first row", () => {
    const { bands } = runRptReport(
      report({
        groups: [
          group('rpt:HASCHANGED("A")', {
            header: band("rpt:SUM([V])"),
            footer: band("rpt:SUM([V])"),
          }),
        ],
      }),
      resultSet(
        ["A", "V"],
        [
          [text("x"), amount(1)],
          [text("x"), amount(2)],
          [text("x"), amount(4)],
        ],
      ),
    );

    expect(totalsOf(bands, "group-header", 0)).toEqual([7]);
    expect(totalsOf(bands, "group-footer", 0)).toEqual([7]);
  });

  it("scopes a detail-band aggregate to the innermost group, and to the whole report when there are none", () => {
    const rows = resultSet(
      ["A", "V"],
      [
        [text("x"), amount(1)],
        [text("x"), amount(2)],
        [text("y"), amount(4)],
      ],
    );

    const grouped = runRptReport(
      report({
        groups: [group('rpt:HASCHANGED("A")')],
        detail: band("rpt:SUM([V])"),
      }),
      rows,
    );
    expect(totalsOf(grouped.bands, "detail")).toEqual([3, 3, 4]);

    const ungrouped = runRptReport(
      report({ detail: band("rpt:SUM([V])") }),
      rows,
    );
    expect(totalsOf(ungrouped.bands, "detail")).toEqual([7, 7, 7]);
  });

  it("scopes a named rpt:function aggregate to where it was DECLARED, not to the band that referenced it", () => {
    const rows = resultSet(
      ["A", "V"],
      [
        [text("x"), amount(1)],
        [text("x"), amount(2)],
        [text("y"), amount(4)],
      ],
    );
    const definition = report({
      functions: [{ name: "REPORT_TOTAL", formula: "rpt:SUM([V])" }],
      groups: [
        group('rpt:HASCHANGED("A")', {
          functions: [{ name: "GROUP_TOTAL", formula: "rpt:SUM([V])" }],
          footer: band("field:[GROUP_TOTAL]", "field:[REPORT_TOTAL]"),
        }),
      ],
      detail: band("field:[GROUP_TOTAL]", "field:[REPORT_TOTAL]"),
    });

    const { bands } = runRptReport(definition, rows);
    const footers = bands.filter(
      (instance) => instance.kind === "group-footer",
    );
    // GROUP_TOTAL is declared on the group, so it totals that group's rows even when read from the detail band inside it; REPORT_TOTAL is declared on the report, so it totals everything from either place.
    expect(footers.map((instance) => numberAt(instance, 0))).toEqual([3, 4]);
    expect(footers.map((instance) => numberAt(instance, 1))).toEqual([7, 7]);
    expect(
      bands
        .filter((instance) => instance.kind === "detail")
        .map((instance) => numberAt(instance, 0)),
    ).toEqual([3, 3, 4]);
  });
});

describe("rpt:HASCHANGED", () => {
  it("is true on the first row and whenever the value differs from the immediately preceding one", () => {
    const { bands } = runRptReport(
      report({ detail: band("rpt:HASCHANGED([A])") }),
      resultSet(
        ["A"],
        [[text("x")], [text("x")], [text("y")], [text("y")], [text("x")]],
      ),
    );

    expect(bands.map((instance) => instance.values[0])).toEqual([
      { kind: "boolean", value: true },
      { kind: "boolean", value: false },
      { kind: "boolean", value: true },
      { kind: "boolean", value: false },
      { kind: "boolean", value: true },
    ]);
  });

  it("treats two NULLs as unchanged and a NULL against a value as changed", () => {
    const { bands } = runRptReport(
      report({ detail: band("rpt:HASCHANGED([A])") }),
      resultSet(["A"], [[NULL_VALUE], [NULL_VALUE], [text("x")], [NULL_VALUE]]),
    );

    expect(bands.map((instance) => instance.values[0])).toEqual([
      { kind: "boolean", value: true },
      { kind: "boolean", value: false },
      { kind: "boolean", value: true },
      { kind: "boolean", value: true },
    ]);
  });

  it("compares the value of a named function, not the function name", () => {
    const { bands } = runRptReport(
      report({
        functions: [{ name: "PREFIX", formula: "rpt:LEFT([A];1)" }],
        detail: band('rpt:HASCHANGED("PREFIX")'),
      }),
      resultSet(["A"], [[text("alpha")], [text("apple")], [text("beta")]]),
    );

    // "alpha" and "apple" differ, but their one-character prefixes do not.
    expect(bands.map((instance) => instance.values[0])).toEqual([
      { kind: "boolean", value: true },
      { kind: "boolean", value: false },
      { kind: "boolean", value: true },
    ]);
  });
});

describe("rpt:LEFT", () => {
  it("takes a prefix, passes a shorter value through whole, and propagates NULL", () => {
    const { bands } = runRptReport(
      report({ detail: band("rpt:LEFT([A];3)") }),
      resultSet(
        ["A"],
        [[text("abcdef")], [text("ab")], [text("")], [NULL_VALUE]],
      ),
    );

    expect(bands.map((instance) => instance.values[0])).toEqual([
      { kind: "string", value: "abc" },
      { kind: "string", value: "ab" },
      { kind: "string", value: "" },
      NULL_VALUE,
    ]);
  });

  it("counts characters rather than UTF-16 code units, so it never splits a surrogate pair", () => {
    const { bands } = runRptReport(
      report({ detail: band("rpt:LEFT([A];2)") }),
      resultSet(["A"], [[text("\u{1F600}\u{1F601}\u{1F602}")]]),
    );

    expect(bands[0]?.values[0]).toEqual({
      kind: "string",
      value: "\u{1F600}\u{1F601}",
    });
  });

  it("refuses a non-text value rather than inventing a number format for it", () => {
    expect(() =>
      runRptReport(
        report({ detail: band("rpt:LEFT([A];2)") }),
        resultSet(["A"], [[amount(1234)]]),
      ),
    ).toThrow(/rpt:LEFT requires a text value, but found a number value/);
  });
});

describe("aggregates", () => {
  const ROWS = resultSet(
    ["V"],
    [[amount(1)], [amount(2)], [amount(6)], [NULL_VALUE]],
  );

  it("implements the same five the SQL engine does, skipping NULLs", () => {
    const { bands } = runRptReport(
      report({
        reportFooter: band(
          "rpt:SUM([V])",
          "rpt:COUNT([V])",
          "rpt:AVG([V])",
          "rpt:MIN([V])",
          "rpt:MAX([V])",
        ),
      }),
      ROWS,
    );

    expect(bands[0]?.values).toEqual([
      amount(9),
      amount(3),
      amount(3),
      amount(1),
      amount(6),
    ]);
  });

  it("returns NULL from every aggregate but COUNT when a scope holds no non-NULL value", () => {
    const { bands } = runRptReport(
      report({
        reportFooter: band(
          "rpt:SUM([V])",
          "rpt:COUNT([V])",
          "rpt:AVG([V])",
          "rpt:MIN([V])",
          "rpt:MAX([V])",
        ),
      }),
      resultSet(["V"], [[NULL_VALUE], [NULL_VALUE]]),
    );

    expect(bands[0]?.values).toEqual([
      NULL_VALUE,
      amount(0),
      NULL_VALUE,
      NULL_VALUE,
      NULL_VALUE,
    ]);
  });

  it("refuses to total non-numeric values rather than coercing them", () => {
    expect(() =>
      runRptReport(
        report({ reportFooter: band("rpt:SUM([A])") }),
        resultSet(["A"], [[text("12")]]),
      ),
    ).toThrow(/SUM requires numeric values, but found a string value/);
  });

  it("still emits the report header and footer over an empty result set", () => {
    const { bands } = runRptReport(
      report({
        reportHeader: band(undefined),
        groups: [
          group('rpt:HASCHANGED("A")', { footer: band("rpt:SUM([V])") }),
        ],
        detail: band("field:[V]"),
        reportFooter: band("rpt:SUM([V])", "rpt:COUNT([V])"),
      }),
      resultSet(["A", "V"], []),
    );

    expect(bands.map((instance) => instance.kind)).toEqual([
      "report-header",
      "report-footer",
    ]);
    expect(bands[1]?.values).toEqual([NULL_VALUE, amount(0)]);
  });
});

describe("the failure policy", () => {
  const ROWS = resultSet(["A", "V"], [[text("x"), amount(1)]]);

  it("refuses a reference naming neither a column nor a declared function", () => {
    expect(() =>
      runRptReport(report({ detail: band("field:[MISSING]") }), ROWS),
    ).toThrow(/names neither a declared rpt:function nor a column/);
    expect(() =>
      runRptReport(report({ reportFooter: band("rpt:SUM([MISSING])") }), ROWS),
    ).toThrow(/names neither a declared rpt:function nor a column/);
  });

  it("refuses an unresolvable rpt:HASCHANGED reference on the very first row, without waiting for a second row to compare against", () => {
    expect(() =>
      runRptReport(report({ detail: band("rpt:HASCHANGED([MISSING])") }), ROWS),
    ).toThrow(/names neither a declared rpt:function nor a column/);
    expect(() =>
      runRptReport(
        report({ groups: [group('rpt:HASCHANGED("MISSING")')] }),
        ROWS,
      ),
    ).toThrow(/names neither a declared rpt:function nor a column/);
  });

  it("refuses a reference that matches both a declared function and a column, rather than letting one shadow the other", () => {
    expect(() =>
      runRptReport(
        report({
          functions: [{ name: "A", formula: "rpt:LEFT([A];1)" }],
          detail: band("field:[A]"),
        }),
        ROWS,
      ),
    ).toThrow(/reference "A" is ambiguous/);
  });

  it("refuses a function name declared twice", () => {
    const definition = report({
      functions: [{ name: "F", formula: "field:[A]" }],
      groups: [
        group('rpt:HASCHANGED("A")', {
          functions: [{ name: "F", formula: "field:[V]" }],
        }),
      ],
    });
    expect(() => runRptReport(definition, ROWS)).toThrow(
      /declared more than once/,
    );
  });

  it("refuses a self-referential function rather than recursing until the stack runs out", () => {
    expect(() =>
      runRptReport(
        report({
          functions: [{ name: "F", formula: "field:[F]" }],
          detail: band("field:[F]"),
        }),
        ROWS,
      ),
    ).toThrow(/refers to itself/);
    expect(() =>
      runRptReport(
        report({
          functions: [
            { name: "F", formula: "field:[G]" },
            { name: "G", formula: "field:[F]" },
          ],
          detail: band("field:[F]"),
        }),
        ROWS,
      ),
    ).toThrow(/refers to itself/);
  });

  it("refuses a group expression that depends on an aggregate, before reading a single row", () => {
    expect(() =>
      runRptReport(report({ groups: [group("rpt:SUM([V])")] }), ROWS),
    ).toThrow(/a group expression cannot depend on the aggregate/);
    expect(() =>
      runRptReport(
        report({
          functions: [{ name: "T", formula: "rpt:SUM([V])" }],
          groups: [group('rpt:HASCHANGED("T")')],
        }),
        ROWS,
      ),
    ).toThrow(/a group expression cannot depend on the aggregate/);
  });

  it("catches a circular group expression even when the result set is empty", () => {
    expect(() =>
      runRptReport(
        report({ groups: [group("rpt:SUM([V])")] }),
        resultSet(["A", "V"], []),
      ),
    ).toThrow(RptFormulaEvaluationError);
  });

  it("refuses a group expression that does not evaluate to a boolean break test", () => {
    expect(() =>
      runRptReport(report({ groups: [group("field:[A]")] }), ROWS),
    ).toThrow(/must evaluate to a boolean break test/);
  });

  it("refuses a per-row formula in the report header or footer, which belong to no row", () => {
    expect(() =>
      runRptReport(report({ reportHeader: band("field:[A]") }), ROWS),
    ).toThrow(/needs a data row/);
    expect(() =>
      runRptReport(report({ reportFooter: band("rpt:LEFT([A];1)") }), ROWS),
    ).toThrow(/needs a data row/);
    expect(() =>
      runRptReport(report({ reportFooter: band("rpt:HASCHANGED([A])") }), ROWS),
    ).toThrow(/needs a data row/);
  });

  it("refuses an unsupported function anywhere in the report before running it", () => {
    expect(() =>
      runRptReport(report({ detail: band("rpt:PAGENUMBER()") }), ROWS),
    ).toThrow(RptFormulaUnsupportedError);
    expect(() =>
      runRptReport(
        report({ functions: [{ name: "F", formula: "rpt:TODAY()" }] }),
        ROWS,
      ),
    ).toThrow(RptFormulaUnsupportedError);
    expect(() =>
      runRptReport(report({ groups: [group("rpt:WHENEVER([A])")] }), ROWS),
    ).toThrow(RptFormulaUnsupportedError);
  });

  it("leaves an element with no formula of its own as an undefined value rather than inventing one", () => {
    const { bands } = runRptReport(
      report({ detail: band(undefined, "field:[A]", undefined) }),
      ROWS,
    );

    expect(bands[0]?.values).toEqual([undefined, text("x"), undefined]);
  });
});
