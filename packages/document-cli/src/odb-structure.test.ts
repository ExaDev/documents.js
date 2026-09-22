import type {
  OdbForm,
  OdbFormControl,
  OdbFormDefinition,
  OdbReport,
} from "documents.js";
import { describe, expect, it } from "vitest";
import {
  countOdbFormControls,
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

// Every assertion here is against the real `.odb` fixture (see test-support/odb-fixture.ts for its provenance) read through documents.js's own readOdbForms/readOdbReports — not a hand-built OdbForm/OdbReport value. A synthetic structure would prove only that this module renders what it was handed; against genuine LibreOffice output it proves the rendering matches the shape the reader beneath it actually produces, including the two things most easily got wrong by assumption: a sub-form sitting on a different command from its parent, and a group key that is an expression rather than a bare column name.

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
    // Five controls on SalesForm itself plus one on HighValueSubForm; five of the six are field-bound — only lblHeading, the fixed-text heading, carries no form:data-field.
    expect(describeOdbForm(onlyForm())).toBe(
      "SalesForm [forms/Obj11] — 1 form, 6 controls (5 bound)",
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
      'SalesByRegion [reports/Obj11] — on query "HighValueSales", 2 groups, 13 elements',
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

// The fixture's own SalesForm/SalesByRegion structures are rich enough to prove real-world fidelity, but every case below sits on a boundary (zero vs one vs many, present vs absent) the one fixture happens to land on only one side of. These build plain OdbForm/OdbReport/OdbFormControl/OdbFormDefinition values directly — still pure data, never bytes or I/O — specifically to reach the other side; onlyForm()'s own `document`/`href`/`name` are reused via spread since only `forms` varies here.
describe("form structure edge cases the fixture never reaches", () => {
  it("counts a control's own nested children, not just its top-level siblings", () => {
    const controls: OdbFormControl[] = [
      { tag: "form:text", controls: [{ tag: "form:text", controls: [] }] },
    ];
    expect(countOdbFormControls(controls)).toBe(2);
  });

  it("pluralises 'forms' for anything but exactly one, in both directions", () => {
    const base = onlyForm();
    expect(describeOdbForm({ ...base, forms: [] })).toContain("0 forms,");
    expect(
      describeOdbForm({ ...base, forms: [...base.forms, ...base.forms] }),
    ).toContain("2 forms,");
  });

  it("keeps 'control' singular for a form with exactly one, unbound, control", () => {
    const base = onlyForm();
    const definition: OdbFormDefinition = {
      controls: [{ tag: "form:fixed-text", controls: [] }],
      subForms: [],
    };
    expect(describeOdbForm({ ...base, forms: [definition] })).toBe(
      `${base.name} [${base.href}] — 1 form, 1 control (0 bound)`,
    );
  });

  it("counts a bound control nested inside another control, not just top-level ones", () => {
    const base = onlyForm();
    const definition: OdbFormDefinition = {
      controls: [
        {
          tag: "form:grid",
          controls: [{ tag: "form:text", dataField: "AMOUNT", controls: [] }],
        },
      ],
      subForms: [],
    };
    expect(describeOdbForm({ ...base, forms: [definition] })).toContain(
      "(1 bound)",
    );
  });

  it("reports when the document declares no form:form definitions at all", () => {
    const base = onlyForm();
    expect(formatOdbFormLines({ ...base, forms: [] })).toStrictEqual([
      "(this form document declares no form:form definitions)",
    ]);
  });

  it("omits a control's implementation when absent, and indents its own nested child one level deeper", () => {
    const base = onlyForm();
    const definition: OdbFormDefinition = {
      name: "PlainForm",
      controls: [
        {
          tag: "form:grid",
          controls: [{ tag: "form:text", name: "nested", controls: [] }],
        },
      ],
      subForms: [],
    };
    expect(formatOdbFormLines({ ...base, forms: [definition] })).toStrictEqual([
      "form PlainForm",
      "  form:grid",
      "    form:text nested",
    ]);
  });

  it("renders a definition's datasource, filter, and order, and marks a control-free definition", () => {
    const base = onlyForm();
    const definition: OdbFormDefinition = {
      name: "FilteredForm",
      datasource: "SALES",
      filter: "REGION = 'North'",
      order: "AMOUNT DESC",
      controls: [],
      subForms: [],
    };
    expect(formatOdbFormLines({ ...base, forms: [definition] })).toStrictEqual([
      "form FilteredForm",
      "  datasource: SALES",
      "  filter: REGION = 'North'",
      "  order: AMOUNT DESC",
      "  (no controls)",
    ]);
  });
});

describe("report structure edge cases the fixture never reaches", () => {
  it("reports 'no data source' when neither command nor commandType is set", () => {
    const report: OdbReport = {
      name: "PlainReport",
      href: "reports/Obj1",
      groups: [],
      functions: [],
    };
    expect(describeOdbReport(report)).toBe(
      "PlainReport [reports/Obj1] — no data source, 0 groups, 0 elements",
    );
  });

  it("keeps 'group'/'element' singular at exactly one, counting a page footer's own elements", () => {
    const report: OdbReport = {
      name: "OneOfEach",
      href: "reports/Obj2",
      groups: [{ functions: [], groups: [] }],
      pageFooter: {
        kind: "page-footer",
        elements: [{ tag: "rpt:fixed-content" }],
      },
      functions: [],
    };
    expect(describeOdbReport(report)).toBe(
      "OneOfEach [reports/Obj2] — no data source, 1 group, 1 element",
    );
  });

  it("renders only the bands actually present, and a band with no table:name of its own", () => {
    const report: OdbReport = {
      name: "Minimal",
      href: "reports/Obj3",
      groups: [],
      detail: { kind: "detail", elements: [] },
      functions: [],
    };
    expect(formatOdbReportLines(report)).toStrictEqual([
      "detail",
      "  (no elements)",
    ]);
  });

  it("renders caption, mime type, and a group with no sort/column/reset/keep-together attributes at all", () => {
    const report: OdbReport = {
      name: "Captioned",
      href: "reports/Obj4",
      caption: "A caption",
      mimeType: "text/plain",
      groups: [
        { groupExpression: 'rpt:HASCHANGED("X")', functions: [], groups: [] },
      ],
      functions: [],
    };
    expect(formatOdbReportLines(report)).toStrictEqual([
      "caption: A caption",
      "mime type: text/plain",
      'group rpt:HASCHANGED("X")',
    ]);
  });

  it("marks a descending sort explicitly, distinct from the ascending default", () => {
    const report: OdbReport = {
      name: "Descending",
      href: "reports/Obj5",
      groups: [
        {
          sortExpression: "AMOUNT",
          sortAscending: false,
          functions: [],
          groups: [],
        },
      ],
      functions: [],
    };
    expect(formatOdbReportLines(report)).toStrictEqual([
      "group (sort AMOUNT descending)",
    ]);
  });
});
