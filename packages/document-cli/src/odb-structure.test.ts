import type { OdbForm, OdbReport } from "documents.js";
import { describe, expect, it } from "vitest";
import {
  describeOdbForm,
  describeOdbReport,
  formatOdbFormLines,
  formatOdbReportLines,
  odbFormSummary,
} from "./odb-structure";
import {
  loadFormAndReportOdbForms,
  loadFormAndReportOdbReports,
} from "./test-support/odb-fixture";

// Every assertion here is against the real `.odb` fixture (see test-support/odb-fixture.ts for its provenance) read through documents.js's own readOdbForms/readOdbReports -- not a hand-built OdbForm/OdbReport value. A synthetic structure would prove only that this module renders what it was handed; against genuine LibreOffice output it proves the rendering matches the shape the reader beneath it actually produces, including the two things most easily got wrong by assumption: a sub-form sitting on a different command from its parent, and a group key that is an expression rather than a bare column name.

function onlyForm(): OdbForm {
  const forms = loadFormAndReportOdbForms();
  const form = forms[0];
  if (form === undefined || forms.length !== 1) {
    throw new Error(
      `The fixture is expected to declare exactly one form; readOdbForms returned ${forms.length}.`,
    );
  }
  return form;
}

function onlyReport(): OdbReport {
  const reports = loadFormAndReportOdbReports();
  const report = reports[0];
  if (report === undefined || reports.length !== 1) {
    throw new Error(
      `The fixture is expected to declare exactly one report; readOdbReports returned ${reports.length}.`,
    );
  }
  return report;
}

describe("form rendering against the real fixture", () => {
  it("reads exactly the one form the fixture declares", () => {
    expect(loadFormAndReportOdbForms().map((form) => form.name)).toStrictEqual([
      "SalesForm",
    ]);
  });

  it("summarises the form with its href and its own control counts, counting a sub-form's controls too", () => {
    // Five controls on SalesForm itself plus one on HighValueSubForm; five of the six are field-bound -- only lblHeading, the fixed-text heading, carries no form:data-field.
    expect(describeOdbForm(onlyForm())).toBe(
      "SalesForm [forms/Obj11] -- 1 form, 6 controls (5 bound)",
    );
  });

  it("renders every control's own field binding, and the sub-form nested under its parent with its own query command", () => {
    expect(formatOdbFormLines(onlyForm())).toStrictEqual([
      'form SalesForm on table "SALES"',
      '  form:fixed-text lblHeading label "Customer record" (ooo:com.sun.star.form.component.FixedText)',
      "  form:text txtCustomer -> CUSTOMER (ooo:com.sun.star.form.component.TextField)",
      "  form:text txtRegion -> REGION (ooo:com.sun.star.form.component.TextField)",
      "  form:listbox lstQuarter -> QUARTER (ooo:com.sun.star.form.component.ListBox)",
      "  form:formatted-text numAmount -> AMOUNT (ooo:com.sun.star.form.component.NumericField)",
      '  subform HighValueSubForm on query "HighValueSales"',
      "    form:text txtSubCustomer -> CUSTOMER (ooo:com.sun.star.form.component.TextField)",
    ]);
  });

  it("drops the form sub-document from the JSON summary while keeping the structure, so a form's whole OdtDocument never lands in a caller's output", () => {
    const summary = odbFormSummary(onlyForm());
    expect(Object.keys(summary).sort()).toStrictEqual([
      "forms",
      "href",
      "name",
    ]);
    expect(summary.forms[0]?.subForms[0]?.command).toBe("HighValueSales");
    // The form's own OdtDocument (dropped here) is the only thing in an OdbForm that carries the sub-document's paragraph text; its heading label proves whether it leaked in.
    expect(JSON.stringify(summary)).not.toContain("Customer record heading");
  });
});

describe("report rendering against the real fixture", () => {
  it("reads exactly the one report the fixture declares", () => {
    expect(
      loadFormAndReportOdbReports().map((report) => report.name),
    ).toStrictEqual(["SalesByRegion"]);
  });

  it("summarises the report with its data-source command and its own group and element counts", () => {
    // Seven report-level elements (1 report header, 2 page header, 2 detail, 0 page footer, 2 report footer) plus three in each of the two groups' own header/footer bands.
    expect(describeOdbReport(onlyReport())).toBe(
      'SalesByRegion [reports/Obj11] -- on query "HighValueSales", 2 groups, 13 elements',
    );
  });

  it("renders the full band structure, both nested groups, every rpt: formula, and the user-defined function", () => {
    expect(formatOdbReportLines(onlyReport())).toStrictEqual([
      'data source: query "HighValueSales"',
      "caption: Sales by region",
      "mime type: application/vnd.oasis.opendocument.text",
      'report-header "Report Header"',
      '  rpt:fixed-content "Label field": "Sales by region"',
      'page-header "Page Header"',
      '  rpt:fixed-content "Label field": "Customer"',
      '  rpt:fixed-content "Label field": "Amount"',
      'group rpt:HASCHANGED("REGION") (sort REGION ascending)',
      '  group-header "Group Header"',
      '    rpt:formatted-text "Formatted field" = field:[REGION] -> REGION',
      '  group rpt:HASCHANGED("LEFT_QUARTER") (sort QUARTER ascending, new column, reset page number, keep together whole-group)',
      '    group-header "Group Header"',
      '      rpt:formatted-text "Formatted field" = field:[QUARTER] -> QUARTER',
      '    group-footer "Group Footer"',
      '      rpt:fixed-content "Label field": "Quarter total:"',
      '      rpt:formatted-text "Formatted field" = rpt:SUM([AMOUNT])',
      '  group-footer "Group Footer"',
      '    rpt:fixed-content "Label field": "Region total:"',
      '    rpt:formatted-text "Formatted field" = rpt:SUM([AMOUNT])',
      'detail "Detail"',
      '  rpt:formatted-text "Formatted field" = field:[CUSTOMER] -> CUSTOMER',
      '  rpt:formatted-text "Formatted field" = field:[AMOUNT] -> AMOUNT',
      'page-footer "Page Footer"',
      "  (no elements)",
      'report-footer "Report Footer"',
      '  rpt:fixed-content "Label field": "Grand total:"',
      '  rpt:formatted-text "Formatted field" = rpt:SUM([AMOUNT])',
      "functions",
      "  LEFT_QUARTER = rpt:LEFT([QUARTER];2)",
    ]);
  });
});
