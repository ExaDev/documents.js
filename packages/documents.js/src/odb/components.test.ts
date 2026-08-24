import { describe, expect, it } from "vitest";
import { odbWithFormsAndReportsPackage } from "../test-support/odb";
import { readOdbForms, readOdbReports } from "./components";

describe("readOdbForms", () => {
  it("reads every declared form, resolving its own bound controls", () => {
    const forms = readOdbForms(odbWithFormsAndReportsPackage());
    expect(forms).toHaveLength(1);
    const form = forms[0]!;
    expect(form.name).toBe("CustomerForm");
    expect(form.href).toBe("forms/CustomerForm");
    expect(form.document.metadata).toBeDefined();
    expect(form.forms).toHaveLength(1);
    const definition = form.forms[0]!;
    expect(definition.name).toBe("CustomerForm");
    expect(definition.command).toBe("CUSTOMERS");
    expect(definition.commandType).toBe("table");
    expect(definition.controls).toHaveLength(1);
    expect(definition.controls[0]).toMatchObject({
      tag: "form:text",
      name: "NAME",
      dataField: "NAME",
      label: "Name",
    });
  });
});

describe("readOdbReports", () => {
  it("reads every declared report, resolving its own bands and bound controls", () => {
    const reports = readOdbReports(odbWithFormsAndReportsPackage());
    expect(reports).toHaveLength(1);
    const report = reports[0]!;
    expect(report.name).toBe("CustomerReport");
    expect(report.href).toBe("reports/CustomerReport");
    expect(report.command).toBe("CUSTOMERS");
    expect(report.commandType).toBe("table");
    expect(report.caption).toBe("Customer Report");

    expect(report.reportHeader?.elements).toHaveLength(1);
    expect(report.reportHeader?.elements[0]).toMatchObject({
      tag: "rpt:fixed-content",
      name: "Title",
      text: "Customer Report",
    });

    expect(report.detail?.elements).toHaveLength(1);
    expect(report.detail?.elements[0]).toMatchObject({
      tag: "rpt:formatted-text",
      name: "NameField",
      dataField: "NAME",
      formula: "field:[NAME]",
    });
  });
});
